"""
Cabinet Estimate calculation engine.
Converts box-level measurements to LF-based estimates with multipliers.
Supports perimeter vs island location separation.
"""

import logging
import math
from dataclasses import dataclass
from typing import List, Optional

from app.domains.unit_prices.tables import material_share as price_share

from .appliance_labor import appliance_pricing_dict
from .pricing import (
    ANGLED_JOINT_PRICING,
    APPLIANCE_RESET_PRICES,
    BACKSPLASH_TYPES,
    BASE_RATES,
    COUNTERTOP_ANGLED_CUT_EACH,
    COUNTERTOP_BACKSPLASH_PER_LF,
    COUNTERTOP_MATERIALS,
    COUNTERTOP_SUPPORT_PRICING,
    COUNTERTOP_SUPPORT_RULE,
    CROWN_MOLDING_PRICING,
    DEFAULT_OVERHEAD_PCT,
    DEFAULT_PROFIT_PCT,
    DOOR_PATTERN_LABELS,
    DOOR_PATTERN_PREMIUM,
    DOOR_STYLE_MULTIPLIER,
    DOUBLE_BOWL_MIN_SINK_WIDTH,
    END_PANEL_PRICING,
    END_PANEL_TYPES,
    FILLER_PRICING,
    FINISH_MULTIPLIER,
    FLAT_PRICES,
    GLASS_DOOR_PREMIUM,
    ISLAND_PANEL_PRICING,
    LIGHT_RAIL_PRICING,
    MATERIAL_MULTIPLIER,
    MATERIAL_SHARE,
    NON_STANDARD_WIDTH_MULTIPLIER,
    OVERLAY_STYLE_MULTIPLIER,
    PAINTED_FINISHES,
    PREFAB_ISLAND_INSTALL,
    PREFAB_ISLAND_PRICING,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    SPECIALTY_PREMIUM_TIER_SCALE,
    SPECIALTY_SUPPLY_MULTIPLIER,
    SPECIALTY_TALL_TYPES,
    TALL_CABINET_TYPES,
    TALL_HEIGHT_MULTIPLIER,
    TALL_TYPE_BASE_WIDTH,
    TALL_WIDTH_MULTIPLIER,
    UNMEASURED_SPECIALTIES,
    VOLATILE_DOOR_STYLES,
    VOLATILE_FINISHES,
    WALL_HEIGHT_MULTIPLIER,
    get_labor_multiplier,
    is_standard_width,
    permit_fee,
    permit_jurisdiction,
    sink_for_base,
    size_tier_value,
    width_efficiency,
)
from .rate_meta import Basis, resolve_basis
from .selections import (
    COUNTERTOP_DEPTH_IN,
    COUNTERTOP_OVERAGE,
    TILE_OVERAGE,
    backsplash_install_type,
    cabinet_kind,
    clean_selections,
    each_price,
    lf_price,
    product_name,
    product_note,
    sf_price,
    with_handling,
)

logger = logging.getLogger(__name__)


@dataclass
class BoxInput:
    code: str
    cab_type: str       # base / wall / tall / specialty
    location: str       # perimeter / island
    width_inches: int
    height_inches: float
    is_specialty: bool
    specialty_type: Optional[str]
    has_glass_door: bool
    qty: int
    # Finished end panels flanking a slide-in range opening (0-2).
    range_panel_count: Optional[int] = None
    # A pattern in the doors' frames: see DOOR_PATTERN_PREMIUM.
    door_pattern: Optional[str] = None


# Boxes with no door to put a pattern in: all drawers, or an open bay.
_NO_DOOR_SPECIALTIES = {
    "drawer_base",
    "trash_pullout",
    "microwave_drawer_base",
    "range_base_slide_in",
    "range_base_drop_in",
}


def _plain_door_count(width_inches: float) -> int:
    """Doors across a plain box. A door is never over about 24" wide."""
    if width_inches < 24:
        return 1
    if width_inches <= 48:
        return 2
    return math.ceil(width_inches / 24)


def _door_count(box: BoxInput) -> int:
    """Doors on a wall, base or tall box's front, as the sketch draws them
    (cabinetFronts.ts)."""
    if box.cab_type not in ("wall", "base", "tall"):
        return 0
    sp = box.specialty_type
    if sp in _NO_DOOR_SPECIALTIES:
        return 0
    if box.cab_type == "tall":
        # An oven or fridge cabinet has one row of doors over its opening
        # (an oven's drawer is no door); a pantry a tall row and a short one.
        row = _plain_door_count(box.width_inches)
        if sp in ("oven_cabinet", "double_oven_cabinet", "refrigerator_cabinet"):
            return row
        return 2 * row
    if sp in ("three_door_corner_wall", "three_door_angle_end_wall"):
        return 3
    if sp in ("lazy_susan", "diagonal_corner_base", "diagonal_corner_wall"):
        return 1
    if sp in ("easy_reach_corner_wall", "two_door_angle_end_wall"):
        return 2
    if sp in ("blind_corner", "blind_corner_wall"):
        # Only the part the other run doesn't cover opens.
        covered = 24 if box.cab_type == "base" else 12
        return _plain_door_count(box.width_inches - covered)
    return _plain_door_count(box.width_inches)


def _patterned(box: BoxInput) -> bool:
    """A box with a door pattern to bill: a known pattern and doors to put it in."""
    return box.door_pattern in DOOR_PATTERN_PREMIUM and _door_count(box) > 0


def _glass_doors(box: BoxInput) -> int:
    """Glass doors on a box ticked Glass: all its doors, and at least one so a
    tick on a box the door count doesn't know is never dropped."""
    return max(1, _door_count(box))


@dataclass
class LineItem:
    description: str
    quantity: float
    unit: str           # LF, EA, SF, HR
    unit_price: float   # material + labor combined
    total: float
    category: str       # supply / labor / scope / premium
    location: str = "perimeter"  # perimeter / island / shared
    notes: Optional[str] = None
    # Share of unit_price that is non-labor cost (material/equipment/fees).
    # The split itself is filled in once O&P is baked in, so that
    # material + labor always adds back up to the price shown on the estimate.
    material_share: float = 0.0
    material_unit_price: float = 0.0
    labor_unit_price: float = 0.0
    material_total: float = 0.0
    labor_total: float = 0.0


@dataclass
class CalculationResult:
    line_items: List[LineItem]
    subtotal: float
    overhead_pct: float
    overhead_amount: float
    profit_pct: float
    profit_amount: float
    adjustment_factor: Optional[float]
    total: float
    methodology_notes: str
    warning_flags: List[str]
    base_lf: float
    wall_lf: float
    tall_count: int
    total_mult: float


def _merge_repeated_lines(items: List[LineItem]) -> List[LineItem]:
    """One line for lines that only repeat each other (same text, unit and
    price), with their quantities and totals added up, where the first one
    stood."""
    merged: dict = {}
    for item in items:
        key = (
            item.description, item.unit, item.unit_price, item.category,
            item.location, item.notes, item.material_share,
        )
        first = merged.get(key)
        if first is None:
            merged[key] = item
            continue
        first.quantity = round(first.quantity + item.quantity, 2)
        first.total = round(first.total + item.total, 2)
    return list(merged.values())


def _check_island_end_panels(
    sqft: float,
    island_boxes: List[BoxInput],
    two_sided: bool,
    seating_overhang_in: Optional[float],
    warnings: List[str],
) -> None:
    """Warn when the island end panel SF is more than a straight island's two
    ends can take. The SF is typed in (LF x a height on the Edit tab, the
    height not saved), so a slip like the LF of the island's length shows up
    only as a big number on the estimate.

    An end is as deep as the island: a base row, two back to back, plus a
    seating overhang the panel may run out under. Panels as tall as bar
    height are taken as normal, full height ones only with a tall cabinet in
    the island."""
    depth_in = (48 if two_sided else 24) + (seating_overhang_in or 0)
    has_tall = any(b.cab_type == "tall" for b in island_boxes)
    ceiling_h = 84 if has_tall else 42
    most = 2 * depth_in * ceiling_h / 144
    if sqft <= most + 0.05:
        return
    base = 2 * depth_in * 34.5 / 144
    warnings.append(
        f"Island end panels: {sqft:g} SF is more than both ends of a "
        f"{depth_in:g}\"-deep island ({base:.1f} SF at 34.5\" high, "
        f"{most:.1f} SF at {ceiling_h}\") — measure the panels and "
        f"correct the SF."
    )


def _calc_location_cabinets(
    boxes: List[BoxInput],
    loc: str,
    tier: str,
    rates: dict,
    total_mult: float,
    include_install: bool,
    include_hardware: bool,
    include_crown_molding: bool,
    include_toe_kick: bool,
    warnings: List[str],
    spec_mult: float = 1.0,
    hardware_product: Optional[dict] = None,
    finish: Optional[str] = None,
    include_quarter_round: bool = False,
) -> tuple[List[LineItem], float, float, int]:
    """Calculate cabinet supply/install items for a location.

    `total_mult` scales cabinet SUPPLY - it carries the regional labor
    multiplier plus the box material, finish and door style factors.
    `spec_mult` scales specialty premiums by tier; see
    SPECIALTY_PREMIUM_TIER_SCALE.
    `hardware_product`, an option's chosen pull or knob, prices the hardware
    supply at its own price instead of the mid-grade allowance.
    `finish` decides whether the toe kick and quarter round are painted;
    see PAINTED_FINISHES.
    """
    line_items: List[LineItem] = []
    loc_label = "Island" if loc == "island" else ""
    prefix = f"{loc_label} " if loc_label else ""

    base_boxes = [b for b in boxes if b.cab_type == "base"]
    wall_boxes = [b for b in boxes if b.cab_type == "wall"]
    tall_boxes = [b for b in boxes if b.cab_type == "tall"]

    base_lf = sum(
        b.width_inches * b.qty for b in base_boxes
    ) / 12
    wall_lf = sum(
        b.width_inches * b.qty for b in wall_boxes
    ) / 12
    tall_count = sum(b.qty for b in tall_boxes)

    # Classify wall boxes by height tier.
    # The short end is banded rather than lumped together: a 12" bridge and
    # a 27" upper are nothing like the same box. See
    # WALL_HEIGHT_MULTIPLIER.
    def _wall_height_tier(height: float) -> str:
        if height <= 15:
            return "bridge"
        elif height <= 21:
            return "short"
        elif height <= 24:
            return "mid"
        elif height <= 27:
            return "near_standard"
        elif height <= 30:
            return "standard"
        elif height <= 36:
            return "tall"
        else:
            return "extra_tall"

    _WALL_TIER_LABELS = {
        "bridge": "Bridge (12-15\"H)",
        "short": "Short (18-21\"H)",
        "mid": "Mid (24\"H)",
        "near_standard": "Near-Standard (27\"H)",
        "standard": "Standard",
        "tall": "Tall (36\"H)",
        "extra_tall": "Extra Tall (42\"H)",
    }

    # A box milled off the standard 3" grid costs more to build, so it is
    # quoted on its own line at a higher per-LF rate rather than being
    # averaged into the standard run. Supply only — see
    # NON_STANDARD_WIDTH_MULTIPLIER.
    _NON_STD_SUFFIX = " (Non-Standard Width)"

    # Narrow boxes cost more per LF than wide ones - every box carries
    # the same hardware, deck and assembly labor regardless of width. The
    # boxes in a group are billed as one pooled LF figure, so the group
    # takes an LF-weighted average of its boxes' efficiency factors
    # rather than a per-box multiplier. See WIDTH_EFFICIENCY_MULTIPLIER
    # and, past 36", WIDE_BOX_EFFICIENCY.
    def _avg_width_efficiency(group: List[BoxInput]) -> float:
        total_in = sum(b.width_inches * b.qty for b in group)
        if total_in <= 0:
            return 1.0
        weighted = sum(
            width_efficiency(b.width_inches, b.cab_type)
            * b.width_inches * b.qty
            for b in group
        )
        return round(weighted / total_in, 4)

    # A box that measures cheaper than the standard one of its width (sink
    # base, blind corner, angle end) goes on its own supply line at a lower
    # LF rate - see SPECIALTY_SUPPLY_MULTIPLIER. None for every other box.
    def _cheaper_box(b: BoxInput) -> Optional[str]:
        sp = b.specialty_type if b.is_specialty else None
        return sp if sp in SPECIALTY_SUPPLY_MULTIPLIER else None

    def _cheaper_label(sp: Optional[str]) -> str:
        return f" - {sp.replace('_', ' ').title()}" if sp else ""

    # ── Cabinet supply ──
    base_by_std: dict[tuple[bool, Optional[str]], float] = {}
    base_boxes_by_std: dict[tuple[bool, Optional[str]], List[BoxInput]] = {}
    for b in base_boxes:
        key = (is_standard_width(b.width_inches), _cheaper_box(b))
        base_by_std[key] = base_by_std.get(key, 0) + (
            b.width_inches * b.qty
        ) / 12
        base_boxes_by_std.setdefault(key, []).append(b)

    # Standard widths first, plain boxes before the cheaper ones.
    for key in sorted(base_by_std, key=lambda k: (not k[0], k[1] or "")):
        std, sp = key
        std_lf = base_by_std[key]
        if std_lf <= 0:
            continue
        w_mult = 1.0 if std else NON_STANDARD_WIDTH_MULTIPLIER
        sp_mult = SPECIALTY_SUPPLY_MULTIPLIER.get(sp, 1.0) if sp else 1.0
        eff_mult = _avg_width_efficiency(
            base_boxes_by_std.get(key, []),
        )
        base_unit = round(
            rates["base_lf"] * total_mult * w_mult * eff_mult * sp_mult, 2,
        )
        base_total = round(std_lf * base_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Base Cabinets{_cheaper_label(sp)} - {tier}"
                f"{'' if std else _NON_STD_SUFFIX}"
            ),
            quantity=round(std_lf, 2),
            unit="LF",
            unit_price=base_unit,
            total=base_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    # Wall cabinets: split by height tier, then by standard/non-standard width
    wall_by_tier: dict[tuple[str, bool, Optional[str]], float] = {}
    wall_boxes_by_tier: dict[tuple[str, bool, Optional[str]], List[BoxInput]] = {}
    for b in wall_boxes:
        htier = _wall_height_tier(b.height_inches)
        key = (htier, is_standard_width(b.width_inches), _cheaper_box(b))
        wall_by_tier[key] = wall_by_tier.get(
            key, 0,
        ) + (b.width_inches * b.qty) / 12
        wall_boxes_by_tier.setdefault(key, []).append(b)

    for (htier, std, sp), tier_lf in wall_by_tier.items():
        if tier_lf <= 0:
            continue
        h_mult = WALL_HEIGHT_MULTIPLIER.get(htier, 1.0)
        w_mult = 1.0 if std else NON_STANDARD_WIDTH_MULTIPLIER
        sp_mult = SPECIALTY_SUPPLY_MULTIPLIER.get(sp, 1.0) if sp else 1.0
        eff_mult = _avg_width_efficiency(
            wall_boxes_by_tier.get((htier, std, sp), []),
        )
        wall_unit = round(
            rates["wall_lf"] * total_mult * h_mult * w_mult * eff_mult * sp_mult,
            2,
        )
        wall_total = round(tier_lf * wall_unit, 2)
        h_label = _WALL_TIER_LABELS.get(htier, htier)
        line_items.append(LineItem(
            description=(
                f"{prefix}Wall Cabinets {h_label}{_cheaper_label(sp)} - {tier}"
                f"{'' if std else _NON_STD_SUFFIX}"
            ),
            quantity=round(tier_lf, 2),
            unit="LF",
            unit_price=wall_unit,
            total=wall_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    # Tall cabinets are per-EA, so the box size has to come in through a
    # multiplier - the LF-based rates already carry it for base/wall.
    def _tall_size_mult(box: BoxInput, base_width: int = 24) -> float:
        w_mult, w_approx = size_tier_value(
            TALL_WIDTH_MULTIPLIER, box.width_inches,
        )
        base_w_mult, _ = size_tier_value(
            TALL_WIDTH_MULTIPLIER, base_width,
        )
        h_mult, h_approx = size_tier_value(
            TALL_HEIGHT_MULTIPLIER, box.height_inches,
        )
        if w_approx is not None:
            warnings.append(
                f"{box.code}: {box.width_inches}\"W priced at the "
                f"{w_approx}\"W rate (nearest listed size)"
            )
        if h_approx is not None:
            warnings.append(
                f"{box.code}: {box.height_inches:g}\"H priced at the "
                f"{h_approx}\"H rate (nearest listed size)"
            )
        # Off-grid widths cost more to build. Checked against the standard
        # 3" lineup rather than the multiplier table, which lists only the
        # few sizes the curve is calibrated on.
        nonstd_mult = 1.0
        if not is_standard_width(box.width_inches):
            nonstd_mult = NON_STANDARD_WIDTH_MULTIPLIER
            warnings.append(
                f"{box.code}: {box.width_inches}\"W is off the standard 3\" "
                f"lineup — supply priced at "
                f"{NON_STANDARD_WIDTH_MULTIPLIER}x"
            )
        return round(
            (w_mult / base_w_mult) * h_mult * nonstd_mult, 4,
        )

    # Tall cabinets: split by type
    generic_tall = [
        b for b in tall_boxes
        if not b.specialty_type
        or b.specialty_type not in TALL_CABINET_TYPES
    ]
    typed_tall = [
        b for b in tall_boxes
        if b.specialty_type
        and b.specialty_type in TALL_CABINET_TYPES
    ]

    # Group by size so boxes of the same size share one line
    generic_by_size: dict = {}
    for b in generic_tall:
        key = (b.width_inches, b.height_inches)
        generic_by_size.setdefault(key, []).append(b)

    for (w, h), size_boxes in generic_by_size.items():
        size_qty = sum(b.qty for b in size_boxes)
        if size_qty <= 0:
            continue
        size_mult = _tall_size_mult(size_boxes[0])
        tall_unit = round(
            rates["tall_each"] * total_mult * size_mult, 2,
        )
        tall_total = round(size_qty * tall_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Tall Cabinets {w}\"W x {h:g}\"H - {tier}"
            ),
            quantity=size_qty,
            unit="EA",
            unit_price=tall_unit,
            total=tall_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    for box in typed_tall:
        type_prices = TALL_CABINET_TYPES[
            box.specialty_type
        ]
        type_unit = round(
            type_prices.get(tier, rates["tall_each"])
            * total_mult * _tall_size_mult(
                box,
                TALL_TYPE_BASE_WIDTH.get(
                    box.specialty_type, 24,
                ),
            ), 2,
        )
        type_total = round(box.qty * type_unit, 2)
        type_label = (
            box.specialty_type.replace("_", " ").title()
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}{type_label} "
                f"{box.width_inches}\"W x {box.height_inches:g}\"H "
                f"- {tier}"
            ),
            quantity=box.qty,
            unit="EA",
            unit_price=type_unit,
            total=type_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
            notes=f"{box.code} — {type_label}",
        ))

    # The lines from here to the installation are one per box row, and the
    # sketch often leaves two rows of the same cabinet (one each side of the
    # hood, one at each end of a run); they're merged at the end of the
    # section so the estimate reads "2 EA" instead of the same line twice.
    per_box_start = len(line_items)

    # ── Specialty premiums ──
    specialty_boxes = [
        b for b in boxes
        if b.is_specialty and b.specialty_type
    ]
    for box in specialty_boxes:
        premium_entry = SPECIALTY_PREMIUM.get(
            box.specialty_type, 0,
        )
        # Support size-based premiums (dict keyed by width_inches)
        if isinstance(premium_entry, dict):
            premium, approx_width = size_tier_value(
                premium_entry, box.width_inches,
            )
            if approx_width is not None:
                warnings.append(
                    f"{box.code}: {box.width_inches}\"W "
                    f"{box.specialty_type.replace('_', ' ')} premium "
                    f"priced at the {approx_width}\"W rate "
                    f"(nearest listed size)"
                )
        else:
            premium = premium_entry
        # A better box carries better hardware and tighter joinery around
        # the same feature, so the premium scales with tier. Tall types
        # are priced per EA through TALL_CABINET_TYPES, which already
        # reflects tier, so they must not be scaled twice.
        if premium > 0 and box.specialty_type not in SPECIALTY_TALL_TYPES:
            premium = round(premium * spec_mult, 2)
        if premium > 0:
            item_total = round(premium * box.qty, 2)
            sp_type = box.specialty_type.replace(
                "_", " ",
            )
            line_items.append(LineItem(
                description=(
                    f"Specialty Premium - {box.code} "
                    f"({sp_type.title()})"
                ),
                quantity=box.qty,
                unit="EA",
                unit_price=premium,
                total=item_total,
                material_share=MATERIAL_SHARE["cabinet_supply"],
                category="premium",
                location=loc,
                notes=(
                    f"Additional cost for {sp_type} "
                    f"cabinet"
                ),
            ))
            warnings.append(
                f"{sp_type.title()} premium applied: "
                f"{box.code}"
            )
            if box.specialty_type in UNMEASURED_SPECIALTIES:
                warnings.append(
                    f"{box.code}: not a stock catalog box, so its premium is "
                    f"an allowance derived from similar corners — confirm "
                    f"the price with the supplier."
                )

    # ── Slide-in range finished end panels ──
    # Priced per panel rather than as a flat specialty premium: an opening
    # between two cabinets exposes two ends, one at a wall exposes one.
    for box in boxes:
        if box.specialty_type != "range_base_slide_in":
            continue
        panels = box.range_panel_count
        if panels is None:
            panels = 2  # both flanking ends, the common case
        panel_qty = panels * box.qty
        if panel_qty <= 0:
            continue
        panel_total = round(FLAT_PRICES["RANGE_END_PANEL_EACH"] * panel_qty, 2)
        line_items.append(LineItem(
            description=(
                f"Range End Panel (Finished) - {box.code}"
            ),
            quantity=panel_qty,
            unit="EA",
            unit_price=FLAT_PRICES["RANGE_END_PANEL_EACH"],
            total=panel_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="premium",
            location=loc,
            notes=(
                f"{panels} panel(s) per opening — slide-in range"
            ),
        ))

    # ── Glass door premiums ──
    # Per door, as GLASS_DOOR_PREMIUM is priced: a two-door W3030 has two
    # glass doors (billed per cabinet before 2026-11-08, half the glass on
    # any box of two doors or more). A box whose doors carry a pattern and
    # glass is billed below, with its pattern, as one glass door per door.
    glass_premium = GLASS_DOOR_PREMIUM.get(
        tier, GLASS_DOOR_PREMIUM["Stock"],
    )
    all_glass = [b for b in boxes if b.has_glass_door]
    if all_glass:
        warnings.append(
            f"Glass door upgrade applied to "
            f"{sum(_glass_doors(b) * b.qty for b in all_glass)} door(s)"
            + (f" ({loc_label})" if loc_label else "")
        )
    for box in all_glass:
        if _patterned(box):
            continue
        doors = _glass_doors(box)
        glass_qty = doors * box.qty
        line_items.append(LineItem(
            description=f"Glass Door - {box.code}",
            quantity=glass_qty,
            unit="EA",
            unit_price=glass_premium,
            total=round(glass_premium * glass_qty, 2),
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="premium",
            location=loc,
            notes=f"{doors} per cabinet, {tier} tier; frame and glass",
        ))

    # ── Door pattern premiums ──
    # With glass, a patterned door is a finished glass door with bars over the
    # glass. GLASS_DOOR_PREMIUM is that door, frame and glass, so it's billed
    # once per door, plus what the pattern costs over a plain mullion grid
    # (the lattice band's carving). Billing the pattern's frame and a glass
    # door on top of it paid for the frame twice.
    mullion_prices = DOOR_PATTERN_PREMIUM["mullion"]
    mullion_unit = mullion_prices.get(tier, mullion_prices["Stock"])
    for box in boxes:
        if not _patterned(box):
            continue
        pattern_prices = DOOR_PATTERN_PREMIUM[box.door_pattern]
        doors = _door_count(box)
        pattern_unit = pattern_prices.get(tier, pattern_prices["Stock"])
        label = DOOR_PATTERN_LABELS[box.door_pattern]
        if box.has_glass_door:
            pattern_unit = glass_premium + max(0, pattern_unit - mullion_unit)
            if "Glass" not in label:
                label = f"{label} Glass"
            what = "frame and glass"
        else:
            what = "glass not included"
        pattern_qty = doors * box.qty
        line_items.append(LineItem(
            description=f"{label} Door - {box.code}",
            quantity=pattern_qty,
            unit="EA",
            unit_price=pattern_unit,
            total=round(pattern_unit * pattern_qty, 2),
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="premium",
            location=loc,
            notes=f"{doors} per cabinet, {tier} tier; {what}",
        ))

    line_items[per_box_start:] = _merge_repeated_lines(
        line_items[per_box_start:],
    )

    # ── Installation ──
    if include_install:
        if base_lf > 0:
            install_base_rate = SCOPE_ITEMS[
                "install_base_per_lf"
            ].get(
                tier,
                SCOPE_ITEMS["install_base_per_lf"]["Stock"],
            )
            install_base = round(
                base_lf * install_base_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Base Cabinet Installation"
                ),
                quantity=round(base_lf, 2),
                unit="LF",
                unit_price=install_base_rate,
                total=install_base,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))
        # wall_by_tier is keyed by (height_tier, is_standard_width,
        # cheaper-box type). Install labor varies with none but the height,
        # so merge the rest back out - else one tier yields several lines.
        install_wall_by_tier: dict[str, float] = {}
        for (htier, _std, _sp), tier_lf in wall_by_tier.items():
            install_wall_by_tier[htier] = (
                install_wall_by_tier.get(htier, 0) + tier_lf
            )
        for htier, tier_lf in install_wall_by_tier.items():
            if tier_lf <= 0:
                continue
            h_label = _WALL_TIER_LABELS.get(
                htier, htier,
            )
            install_wall_rate = SCOPE_ITEMS[
                "install_wall_per_lf"
            ].get(
                tier,
                SCOPE_ITEMS["install_wall_per_lf"]["Stock"],
            )
            install_wall = round(
                tier_lf * install_wall_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Wall Cabinet {h_label} "
                    f"Installation"
                ),
                quantity=round(tier_lf, 2),
                unit="LF",
                unit_price=install_wall_rate,
                total=install_wall,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))
        if tall_count > 0:
            install_tall_rate = SCOPE_ITEMS[
                "install_tall_per_each"
            ].get(
                tier,
                SCOPE_ITEMS["install_tall_per_each"]["Stock"],
            )
            install_tall = round(
                tall_count * install_tall_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Tall Cabinet Installation"
                ),
                quantity=tall_count,
                unit="EA",
                unit_price=install_tall_rate,
                total=install_tall,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))

    # ── Hardware ──
    # Each door and drawer front gets 1 pull/knob
    if include_hardware:
        total_openings = 0
        for b in boxes:
            if b.specialty_type == "drawer_base":
                # All-drawer cabinet:
                # ≤18": 3 drawers, 21"-30": 4, 36"+: 5
                if b.width_inches <= 18:
                    openings = 3
                elif b.width_inches >= 36:
                    openings = 5
                else:
                    openings = 4
            elif b.specialty_type in ("lazy_susan", "diagonal_corner_base"):
                # Single door
                openings = 1
            elif b.specialty_type in ("three_door_corner_wall", "three_door_angle_end_wall"):
                openings = 3
            elif b.specialty_type == "two_door_angle_end_wall":
                openings = 2
            elif b.specialty_type == "angle_end_base":
                # Two full-height doors, no drawer (KCD BEC24)
                openings = 2
            elif b.specialty_type == "blind_corner":
                # 1 door + 1 drawer
                openings = 2
            elif b.specialty_type == "range_base_slide_in":
                # No cabinet under a slide-in: the flanking bases are
                # simply spaced apart and the range fills the gap, so
                # there is no door or drawer front to put a pull on.
                openings = 0
            elif b.specialty_type == "range_base_drop_in":
                # Drop-in cabinets are open-topped for the unit to sit
                # in, with a single drawer below (e.g. 27estore BRC-30).
                openings = 1
            elif b.specialty_type == "sink_base":
                # False front drawer (1) + doors
                # ≤33": 1 false front + 2 doors = 3
                # 36"+: 1 false front + 2 doors = 3
                openings = 3
            elif b.cab_type == "base":
                # Standard base: 1 drawer + door(s)
                # ≤21": 1 drawer + 1 door = 2
                # >21": 1 drawer + 2 doors = 3
                # 39"+: a drawer over each door (2 + 2 up to 48")
                if b.width_inches <= 21:
                    openings = 2
                elif b.width_inches < 39:
                    openings = 3
                else:
                    openings = 2 * _plain_door_count(b.width_inches)
            elif b.cab_type == "wall":
                # Wall: door(s) only, no drawers
                # ≤21": 1 door
                # >21": 2 doors, more past 48"
                openings = (
                    1 if b.width_inches <= 21
                    else _plain_door_count(max(b.width_inches, 24))
                )
            elif b.cab_type == "tall":
                if b.specialty_type == "oven_cabinet":
                    # 1-2 doors + 1 drawer
                    openings = 3
                elif b.specialty_type == (
                    "refrigerator_cabinet"
                ):
                    # Above-fridge panel, 1-2 doors
                    openings = 2
                else:
                    # Pantry: 2 doors (upper) + 2 doors
                    # (lower) = 4 for tall pantry
                    openings = 4
            else:
                openings = 1
            total_openings += openings * b.qty
        if total_openings > 0:
            hw_supply_unit = SCOPE_ITEMS[
                "hardware_per_opening"
            ]
            hw_install_unit = SCOPE_ITEMS[
                "hardware_install_per_opening"
            ]
            hw_description = f"{prefix}Cabinet Hardware (Knobs/Pulls)"
            hw_notes = "Mid-grade brushed nickel"
            if hardware_product:
                hw_each = each_price(hardware_product)
                if hw_each is not None:
                    hw_supply_unit = with_handling(hw_each)
                    hw_description = (
                        f"{prefix}Cabinet Hardware - "
                        f"{product_name(hardware_product)}"
                    )
                    hw_notes = product_note(
                        hardware_product, "one per door and drawer front",
                    )
                elif loc == "perimeter":
                    warnings.append(
                        f"Hardware: {product_name(hardware_product)} isn't "
                        f"priced per piece, so the hardware is quoted at the "
                        f"mid-grade allowance."
                    )
            hw_supply_total = round(
                total_openings * hw_supply_unit, 2,
            )
            line_items.append(LineItem(
                description=hw_description,
                quantity=total_openings,
                unit="EA",
                unit_price=hw_supply_unit,
                total=hw_supply_total,
                material_share=MATERIAL_SHARE["cabinet_supply"],
                category="supply",
                location=loc,
                notes=hw_notes,
            ))
            hw_install_total = round(
                total_openings * hw_install_unit, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Hardware Installation"
                ),
                quantity=total_openings,
                unit="EA",
                unit_price=hw_install_unit,
                total=hw_install_total,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))

    # ── Crown molding (perimeter only) ──
    if include_crown_molding and wall_lf > 0:
        molding_mat = CROWN_MOLDING_PRICING.get(
            tier, 15,
        )
        molding_inst = CROWN_MOLDING_PRICING[
            "install_per_lf"
        ]
        molding_mat_total = round(
            wall_lf * molding_mat, 2,
        )
        molding_inst_total = round(
            wall_lf * molding_inst, 2,
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}Crown Molding - {tier} "
                f"(Material)"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_mat,
            total=molding_mat_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))
        line_items.append(LineItem(
            description=(
                f"{prefix}Crown Molding Installation"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_inst,
            total=molding_inst_total,
            material_share=MATERIAL_SHARE["cabinet_install"],
            category="install",
            location=loc,
        ))

    # Toe kick and quarter round run along the base cabinets and take the
    # cabinet finish: painted on site, or prefinished to match.
    trim_finish = finish or "Stained"
    if trim_finish in PAINTED_FINISHES:
        trim_scope = "Install & Paint"
        trim_notes = "Supply, install, and paint to match"
    else:
        trim_scope = "Install (Prefinished)"
        trim_notes = (
            f"Supply and install, prefinished to match the "
            f"{trim_finish.lower()} cabinets"
        )

    # ── Toe kick ──
    if include_toe_kick and base_lf > 0:
        tk_unit = SCOPE_ITEMS["toe_kick_per_lf"]
        tk_total = round(base_lf * tk_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Toe Kick — {trim_scope}"
            ),
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=tk_unit,
            total=tk_total,
            notes=trim_notes,
            material_share=price_share(
                "SCOPE_ITEMS.toe_kick_per_lf", MATERIAL_SHARE["toe_kick"],
            ),
            category="install",
            location=loc,
        ))

    # ── Quarter round ──
    # Only some kitchens have it: shoe molding along the toe kick, covering
    # the gap at the floor.
    if include_quarter_round and base_lf > 0:
        qr_unit = SCOPE_ITEMS["quarter_round_per_lf"]
        qr_total = round(base_lf * qr_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Quarter Round — {trim_scope}"
            ),
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=qr_unit,
            total=qr_total,
            notes=trim_notes,
            material_share=price_share(
                "SCOPE_ITEMS.quarter_round_per_lf", MATERIAL_SHARE["quarter_round"],
            ),
            category="install",
            location=loc,
        ))

    return line_items, base_lf, wall_lf, tall_count


def _blended_share(parts: List[tuple], default: float) -> float:
    """Material share of a line summed from several prices: each part's
    amount at its own price's share (unit_prices.tables.material_share)."""
    whole = sum(amount for amount, _ in parts)
    if whole <= 0:
        return default
    material = sum(amount * price_share(path, default) for amount, path in parts)
    return round(material / whole, 4)


def _apply_material_labor_split(line_items: List[LineItem]) -> None:
    """Fill in each item's material/labor breakdown from its material_share.

    Run this after every step that moves prices (O&P, reverse pricing) so the
    two halves always add back up to the unit price and total the estimate
    shows - the labor side is taken as the remainder rather than rounded
    independently, which is what guarantees it.
    """
    for item in line_items:
        share = min(max(item.material_share, 0.0), 1.0)
        item.material_unit_price = round(item.unit_price * share, 2)
        item.labor_unit_price = round(
            item.unit_price - item.material_unit_price, 2,
        )
        # Split the total off the total itself, not off quantity x unit price:
        # reverse pricing nudges a line's total to hit the target exactly, so
        # the two can differ by a cent or two and that drift would otherwise
        # land in - and could go negative on - the labor half.
        item.material_total = round(item.total * share, 2)
        item.labor_total = round(item.total - item.material_total, 2)


def calculate_estimate(
    boxes: List[BoxInput],
    tier: str,
    zip_code: str,
    # Box construction and door options. These scale cabinet supply and
    # were previously defined in pricing.py but never actually applied.
    box_material: Optional[str] = None,
    finish: Optional[str] = None,
    door_style: Optional[str] = None,
    overlay_style: Optional[str] = None,
    # Which pricing world to quote in. Insurance and retail price the
    # same physical work differently; see appliance_labor.py.
    pricing_basis: Optional[str] = None,
    include_demo: bool = True,
    include_install: bool = True,
    include_delivery: bool = True,
    include_plumbing: bool = False,
    sink_type: Optional[str] = "single",
    # Under-sink components, quoted for a single sink. The core hookup is
    # in plumbing_reconnect; these are the extras, at marginal labor.
    include_aav: bool = False,
    include_air_gap: bool = False,
    include_soap_dispenser: bool = False,
    include_instant_hot: bool = False,
    include_dw_hookup: bool = False,
    include_countertop_reset: bool = False,
    include_hardware: bool = True,
    include_crown_molding: bool = False,
    include_backsplash: bool = False,
    backsplash_type: Optional[str] = None,
    backsplash_sqft: Optional[float] = None,
    include_toe_kick: bool = True,
    include_quarter_round: bool = False,
    include_countertop: bool = False,
    countertop_material: Optional[str] = None,
    countertop_sqft: Optional[float] = None,
    include_countertop_backsplash: bool = False,
    countertop_backsplash_lf: Optional[float] = None,
    island_countertop_material: Optional[str] = None,
    island_countertop_sqft: Optional[float] = None,
    include_drywall_repair: bool = False,
    drywall_repair_type: Optional[str] = "patch",
    drywall_repair_sqft: Optional[float] = None,
    include_painting: bool = False,
    painting_sqft: Optional[float] = None,
    include_appliance_rr: bool = False,
    appliance_list: Optional[List[dict]] = None,
    include_dumpster: bool = True,
    include_electrical: bool = False,
    include_permit: bool = False,
    # Trim and panel scope. Fillers and finished end panels appear on
    # essentially every real kitchen but had no line item before.
    filler_count: int = 0,
    # Places a run or island turns at an angle other than 90°.
    angled_joint_count: int = 0,
    # Brackets / corbels under an island top's seating overhang, and the
    # overhang itself (inches), which says whether they are needed.
    countertop_support_count: int = 0,
    island_seating_overhang_in: Optional[float] = None,
    end_panel_counts: Optional[dict] = None,
    dishwasher_return_panel_count: int = 0,
    include_light_rail: bool = False,
    light_rail_lf: Optional[float] = None,
    outlet_relocation_count: int = 0,
    delivery_floor: int = 1,
    island_type: str = "custom",
    island_prefab_size: Optional[str] = None,
    island_prefab_price: Optional[float] = None,
    island_end_panel_sqft: float = 0,
    island_back_panel_sqft: float = 0,
    # Cabinets on both long sides of the island, back to back.
    island_two_sided: bool = False,
    overhead_pct: float = DEFAULT_OVERHEAD_PCT,
    profit_pct: float = DEFAULT_PROFIT_PCT,
    target_total: Optional[float] = None,
    # An upgrade option's products from the library, by slot
    # (selections.SLOTS). Each prices its material at the product's own
    # price; our labor stays on the rate tables. Never passed for a
    # restoration.
    products: Optional[dict] = None,
) -> CalculationResult:
    """
    Main calculation: Box inputs -> LF-based estimate.

    Algorithm:
    1. Split boxes by location (perimeter / island)
    2. Calculate each location independently
    3. Add shared scope items (demo, delivery, etc.)
    4. Calculate O&P
    """
    warnings: List[str] = []
    line_items: List[LineItem] = []

    # ── 1. Get rates & multipliers ──
    rates = BASE_RATES.get(tier)
    if not rates:
        raise ValueError(f"Unknown tier: {tier}")

    # Resolve the pricing basis once, up front. Everything basis-
    # sensitive reads from here so a single estimate cannot end up with
    # some lines priced for a carrier and others for a homeowner.
    basis = resolve_basis(pricing_basis)
    appliance_prices = appliance_pricing_dict(basis)
    if basis is Basis.RETAIL_INSTALL:
        warnings.append(
            "Retail basis: appliance resets carry a per-unit trip "
            "minimum. On a job that moves several appliances in one "
            "visit, confirm the trip is not being billed per appliance."
        )

    labor_mult = get_labor_multiplier(zip_code)

    # Cabinet supply scales with what the box is made of and how the door
    # is built, on top of the regional multiplier. These tables existed in
    # pricing.py but nothing ever read them, so every estimate was priced
    # as Plywood / Stained / Shaker / Full Overlay regardless of what the
    # user picked.
    mat_mult = MATERIAL_MULTIPLIER.get(box_material or "Plywood", 1.0)
    fin_mult = FINISH_MULTIPLIER.get(finish or "Stained", 1.0)
    door_mult = DOOR_STYLE_MULTIPLIER.get(door_style or "Shaker", 1.0)
    overlay_mult = OVERLAY_STYLE_MULTIPLIER.get(
        overlay_style or "Full Overlay", 1.0,
    )
    total_mult = round(
        labor_mult * mat_mult * fin_mult * door_mult * overlay_mult, 4,
    )

    if finish in VOLATILE_FINISHES:
        warnings.append(
            f"{finish} finish is priced at a {fin_mult:.2f}x table value, "
            f"but manufacturers charge anywhere from 0% to 50% for it — "
            f"confirm the actual upcharge with the supplier."
        )
    if door_style in VOLATILE_DOOR_STYLES:
        warnings.append(
            f"{door_style} doors are priced at a {door_mult:.2f}x table "
            f"value with no published figure behind it — confirm the actual "
            f"upcharge with the supplier."
        )

    spec_mult = SPECIALTY_PREMIUM_TIER_SCALE.get(tier, 1.0)

    products = clean_selections(products)
    product_lines: List[str] = []
    cabinet_product = products.get("cabinets")
    if cabinet_product:
        # A cabinet line is sold box by box, so its price sets the level the
        # whole cabinet supply is priced at: the product's price per foot
        # over our tier's rate for the same kind of cabinet. It stands in
        # for the region, material, finish and door multipliers, which the
        # retail price already reflects.
        kind = cabinet_kind(cabinet_product)
        price_each = each_price(cabinet_product)
        if kind == "tall" and price_each is not None:
            product_rate = with_handling(price_each)
            table_rate = rates["tall_each"]
            rate_label = f"${product_rate:,.0f}/EA tall vs our ${table_rate:,.0f}"
        else:
            per_lf = lf_price(cabinet_product)
            product_rate = with_handling(per_lf) if per_lf is not None else None
            table_rate = rates["wall_lf" if kind == "wall" else "base_lf"]
            rate_label = (
                f"${product_rate:,.0f}/LF {kind} vs our ${table_rate:,.0f}"
                if product_rate is not None else ""
            )
        if product_rate:
            total_mult = round(product_rate / table_rate, 4)
            product_lines.append(
                f"Cabinets: {product_name(cabinet_product)} - supply priced "
                f"at its level, {rate_label} {tier} rate "
                f"(supply multiplier {total_mult:.2f})"
            )
        else:
            warnings.append(
                f"Cabinets: {product_name(cabinet_product)} has no price "
                f"per cabinet with a width, or per linear foot, so cabinet "
                f"supply stays at the {tier} rate."
            )
    hardware_product = products.get("cabinet_hardware")

    # ── 2. Split by location ──
    perimeter_boxes = [
        b for b in boxes if b.location != "island"
    ]
    island_boxes = [
        b for b in boxes if b.location == "island"
    ]

    # ── 3. Calculate perimeter cabinets ──
    p_items, p_base_lf, p_wall_lf, p_tall = (
        _calc_location_cabinets(
            perimeter_boxes, "perimeter", tier, rates,
            total_mult, include_install,
            include_hardware, include_crown_molding,
            include_toe_kick, warnings, spec_mult,
            hardware_product, finish, include_quarter_round,
        )
    )
    line_items.extend(p_items)

    # ── 4. Calculate island ──
    i_base_lf = i_wall_lf = 0.0
    i_tall = 0
    is_prefab = island_type == "prefab"

    # Cabinets on both long sides stand back to back: their backs face each
    # other, so no back panel shows, and neither side is free for a seating
    # overhang or the brackets under one. What those fields still hold from
    # before the island turned two-sided is left out, not billed.
    two_sided = island_two_sided and not is_prefab
    if two_sided:
        island_back_panel_sqft = 0
        island_seating_overhang_in = None
        countertop_support_count = 0

    if is_prefab and island_prefab_size:
        # Prefab island: EA-based pricing
        size_info = PREFAB_ISLAND_PRICING.get(
            island_prefab_size, {},
        )
        # Use user-override price, or tier default
        supply_price = (
            island_prefab_price
            if island_prefab_price is not None
            else size_info.get(tier, size_info.get("Stock", 900))
        )
        size_label = size_info.get(
            "label", island_prefab_size,
        )
        line_items.append(LineItem(
            description=(
                f"Prefab Island - {size_label} "
                f"(Supply)"
            ),
            quantity=1,
            unit="EA",
            unit_price=round(supply_price, 2),
            total=round(supply_price, 2),
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location="island",
            notes=(
                "Prefab island supply — actual price "
                "may vary by product selection"
            ),
        ))
        if include_install:
            inst_cost = PREFAB_ISLAND_INSTALL.get(
                island_prefab_size, 350,
            )
            line_items.append(LineItem(
                description=(
                    "Prefab Island Installation"
                ),
                quantity=1,
                unit="EA",
                unit_price=round(inst_cost, 2),
                total=round(inst_cost, 2),
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location="island",
            ))
        warnings.append(
            "Prefab island: price is an estimate "
            "based on size/tier. Actual cost may "
            "vary depending on the specific product "
            "selected."
        )
    elif island_boxes:
        # Custom build: LF-based pricing
        i_items, i_base_lf, i_wall_lf, i_tall = (
            _calc_location_cabinets(
                island_boxes, "island", tier, rates,
                total_mult, include_install,
                include_hardware,
                False,  # no crown molding on island
                include_toe_kick, warnings, spec_mult,
                hardware_product, finish, include_quarter_round,
            )
        )
        line_items.extend(i_items)

    # Totals across locations
    base_lf = p_base_lf + i_base_lf
    wall_lf = p_wall_lf + i_wall_lf
    tall_count = p_tall + i_tall
    total_lf = base_lf + wall_lf

    # ── 5. Island panels (SF-based, custom build only) ──
    if not is_prefab and island_end_panel_sqft > 0:
        _check_island_end_panels(
            island_end_panel_sqft, island_boxes, two_sided,
            island_seating_overhang_in, warnings,
        )
        ep_mat = ISLAND_PANEL_PRICING[
            "end_panel_per_sf"
        ].get(
            tier,
            ISLAND_PANEL_PRICING["end_panel_per_sf"]["Stock"],
        )
        ep_inst = ISLAND_PANEL_PRICING["install_per_sf"]
        ep_sqft = round(island_end_panel_sqft, 2)
        ep_mat_total = round(ep_sqft * ep_mat, 2)
        ep_inst_total = round(ep_sqft * ep_inst, 2)
        line_items.append(LineItem(
            description=(
                f"Island End Panel - {tier} (Material)"
            ),
            quantity=ep_sqft,
            unit="SF",
            unit_price=ep_mat,
            total=ep_mat_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location="island",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description="Island End Panel Installation",
            quantity=ep_sqft,
            unit="SF",
            unit_price=ep_inst,
            total=ep_inst_total,
            material_share=MATERIAL_SHARE["cabinet_install"],
            category="install",
            location="island",
        ))

    if not is_prefab and island_back_panel_sqft > 0:
        bp_mat = ISLAND_PANEL_PRICING[
            "back_panel_per_sf"
        ].get(
            tier,
            ISLAND_PANEL_PRICING["back_panel_per_sf"]["Stock"],
        )
        bp_inst = ISLAND_PANEL_PRICING["install_per_sf"]
        bp_sqft = round(island_back_panel_sqft, 2)
        bp_mat_total = round(bp_sqft * bp_mat, 2)
        bp_inst_total = round(bp_sqft * bp_inst, 2)
        line_items.append(LineItem(
            description=(
                f"Island Back Panel - {tier} "
                f"(Material)"
            ),
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_mat,
            total=bp_mat_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location="island",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description=(
                "Island Back Panel Installation"
            ),
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_inst,
            total=bp_inst_total,
            material_share=MATERIAL_SHARE["cabinet_install"],
            category="install",
            location="island",
        ))

    # ── 6. Shared scope items ──

    # Demolition
    if include_demo and total_lf > 0:
        # Perimeter demo
        if p_base_lf + p_wall_lf > 0:
            p_demo_lf = p_base_lf + p_wall_lf
            p_demo_cost = round(max(
                p_demo_lf
                * SCOPE_ITEMS["demo_per_lf"],
                SCOPE_ITEMS["demo_min"],
            ), 2)
            line_items.append(LineItem(
                description=(
                    "Cabinet Demolition & Removal"
                ),
                quantity=round(p_demo_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["demo_per_lf"],
                total=p_demo_cost,
                material_share=MATERIAL_SHARE["demo"],
                category="demo",
                location="perimeter",
            ))
        # Island demo (no minimum — small scope)
        if i_base_lf + i_wall_lf > 0:
            i_demo_lf = i_base_lf + i_wall_lf
            i_demo_cost = round(
                i_demo_lf
                * SCOPE_ITEMS["demo_per_lf"], 2,
            )
            line_items.append(LineItem(
                description=(
                    "Island Cabinet Demolition & "
                    "Removal"
                ),
                quantity=round(i_demo_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["demo_per_lf"],
                total=i_demo_cost,
                material_share=MATERIAL_SHARE["demo"],
                category="demo",
                location="island",
            ))

    # Delivery
    if include_delivery:
        floor_extra = max(0, (delivery_floor or 1) - 1)
        floor_surcharge = (
            floor_extra
            * SCOPE_ITEMS["delivery_floor_surcharge"]
        )
        delivery_cost = round(max(
            SCOPE_ITEMS["delivery_base"]
            + total_lf * SCOPE_ITEMS["delivery_per_lf"]
            + floor_surcharge,
            SCOPE_ITEMS["delivery_min"],
        ), 2)
        # Customer-facing note: state what the charge covers, not how it
        # is computed - the rate breakdown is internal pricing.
        floor_note = (
            f"Includes {delivery_floor}F carry-up"
            if floor_extra > 0 else None
        )
        line_items.append(LineItem(
            description="Cabinet Delivery",
            quantity=1,
            unit="EA",
            unit_price=delivery_cost,
            total=delivery_cost,
            material_share=MATERIAL_SHARE["delivery"],
            category="misc",
            location="shared",
            notes=floor_note,
        ))

    # Plumbing
    if include_plumbing:
        plumbing_items = [
            (
                "Plumbing Disconnect "
                "(sink, disposal, DW supply/drain)",
                SCOPE_ITEMS["plumbing_disconnect"],
                None,
                0.0,
            ),
            (
                "Plumbing Reconnect "
                "(trip + sink drain & supply hookup)",
                SCOPE_ITEMS["plumbing_reconnect"],
                (
                    "Core hookup and trip charge; parts below are "
                    "itemized at marginal labor"
                ),
                0.0,
            ),
            (
                "Garbage Disposal 3/4 HP "
                "- supply only",
                SCOPE_ITEMS["disposal_supply"],
                "One disposer, on the main sink",
                1.0,
            ),
        ]

        # ── Sinks, sized off their base cabinets ──
        # A sink is bought to fit its base (width - ~3"), so group the
        # sink bases by width and quote the matching sink for each.
        sink_bases: dict[int, int] = {}
        for b in boxes:
            if b.specialty_type == "sink_base":
                sink_bases[b.width_inches] = (
                    sink_bases.get(b.width_inches, 0) + b.qty
                )
        # No sink base drawn: fall back to a single 30" base so the
        # plumbing scope still quotes a sink.
        if not sink_bases:
            sink_bases = {30: 1}

        sink_count = sum(sink_bases.values())
        is_double = sink_type == "double"
        # Quoted with the other per-sink items so a base row with qty > 1
        # yields that many sinks, not one.
        sink_lines: list = []

        for base_w in sorted(sink_bases):
            qty = sink_bases[base_w]
            sink_w, single_price, double_price = sink_for_base(base_w)
            price = double_price if is_double else single_price
            bowl = "Double Bowl" if is_double else "Single Bowl"
            if is_double and sink_w < DOUBLE_BOWL_MIN_SINK_WIDTH:
                warnings.append(
                    f"{sink_w}\"W double bowl in a {base_w}\"W sink base: "
                    f"bowls under {DOUBLE_BOWL_MIN_SINK_WIDTH}\" are "
                    f"cramped — a single bowl is usually the better fit"
                )
            sink_lines.append((
                f"Undermount SS {bowl} Sink {sink_w}\" "
                f"- supply only",
                price,
                qty,
                1.0,
                (
                    f"16-gauge stainless steel, sound-dampened; "
                    f"sized for a {base_w}\"W sink base"
                ),
            ))

        # An option's chosen sink, at its own price, in every sink base.
        sink_product = products.get("kitchen_sink")
        if sink_product:
            sink_each = each_price(sink_product)
            if sink_each is None:
                warnings.append(
                    f"Sink: {product_name(sink_product)} isn't priced per "
                    f"sink, so the stock sink allowance stays."
                )
            else:
                sink_lines = []
                product_w = sink_product.get("width_in") or 0
                for base_w in sorted(sink_bases):
                    sink_w, _, _ = sink_for_base(base_w)
                    if product_w and product_w > sink_w + 0.5:
                        warnings.append(
                            f"Sink: {product_name(sink_product)} is "
                            f"{product_w:g}\"W; a {base_w}\"W sink base takes "
                            f"about {sink_w}\" - check it fits."
                        )
                    sink_lines.append((
                        f"{product_name(sink_product)} - supply only",
                        with_handling(sink_each),
                        sink_bases[base_w],
                        1.0,
                        product_note(sink_product, f"in the {base_w}\"W sink base"),
                    ))
                product_lines.append(f"Sink: {product_name(sink_product)}")

        # Under-sink components, per sink: 1 P-trap, 2 supply lines,
        # 2 angle stops. Material share is the part's share of
        # part + marginal labor.
        under_sink = list(sink_lines)
        if sink_count > 1:
            # The trip is in plumbing_reconnect; each extra sink adds its
            # own drain and supply hookup, not another trip.
            under_sink.append((
                "Additional Sink Hookup (drain & supply)",
                SCOPE_ITEMS["plumbing_reconnect_additional_sink"],
                sink_count - 1, 0.0,
                "Second and later sinks; trip already charged above",
            ))
        faucet_line = (
            "Pull-Down Kitchen Faucet "
            "(Moen/Delta mid-range) - supply only",
            SCOPE_ITEMS["faucet_supply"], 1 * sink_count, 1.0,
            "One faucet per sink",
        )
        faucet_product = products.get("kitchen_faucet")
        if faucet_product:
            faucet_each = each_price(faucet_product)
            if faucet_each is None:
                warnings.append(
                    f"Faucet: {product_name(faucet_product)} isn't priced "
                    f"per faucet, so the mid-range faucet allowance stays."
                )
            else:
                faucet_line = (
                    f"{product_name(faucet_product)} - supply only",
                    with_handling(faucet_each), 1 * sink_count, 1.0,
                    product_note(faucet_product, "one per sink"),
                )
                product_lines.append(f"Faucet: {product_name(faucet_product)}")
        under_sink += [
            faucet_line,
            (
                "P-Trap Assembly (sink drain)",
                SCOPE_ITEMS["p_trap_assembly"], 1 * sink_count, price_share("SCOPE_ITEMS.p_trap_assembly", 0.56),
                "Part + marginal labor; crew already on site",
            ),
            (
                "Supply Line - Braided (hot/cold)",
                SCOPE_ITEMS["supply_line_each"], 2 * sink_count, price_share("SCOPE_ITEMS.supply_line_each", 0.42),
                None,
            ),
            (
                "Angle Stop Valve (hot/cold)",
                SCOPE_ITEMS["angle_stop_each"], 2 * sink_count, price_share("SCOPE_ITEMS.angle_stop_each", 0.38),
                None,
            ),
        ]
        if include_aav:
            under_sink.append((
                "Air Admittance Valve / Loop Vent",
                SCOPE_ITEMS["aav_vent"], 1, price_share("SCOPE_ITEMS.aav_vent", 0.44),
                "Island or where a stack vent is impractical",
            ))
        if include_air_gap:
            under_sink.append((
                "Dishwasher Air Gap (countertop)",
                SCOPE_ITEMS["air_gap"], 1, price_share("SCOPE_ITEMS.air_gap", 0.35),
                "Countertop penetration, reset",
            ))
        if include_soap_dispenser:
            under_sink.append((
                "Soap Dispenser (countertop)",
                SCOPE_ITEMS["soap_dispenser"], 1, price_share("SCOPE_ITEMS.soap_dispenser", 0.46),
                "Countertop penetration, reset",
            ))
        if include_instant_hot:
            under_sink.append((
                "Instant Hot Water Dispenser",
                SCOPE_ITEMS["instant_hot_dispenser"], 1, price_share("SCOPE_ITEMS.instant_hot_dispenser", 0.63),
                "Unit + tank mount, 2-3 hr install",
            ))
        if include_dw_hookup:
            under_sink.extend([
                (
                    "DW Supply Line - Braided",
                    SCOPE_ITEMS["dw_supply_line"], 1, price_share("SCOPE_ITEMS.dw_supply_line", 0.42), None,
                ),
                (
                    "DW Angle Stop Valve",
                    SCOPE_ITEMS["dw_angle_stop"], 1, price_share("SCOPE_ITEMS.dw_angle_stop", 0.38), None,
                ),
            ])

        for desc, cost, notes, share in plumbing_items:
            line_items.append(LineItem(
                description=desc,
                quantity=1,
                unit="EA",
                unit_price=cost,
                total=cost,
                material_share=share,
                category="plumbing",
                location="shared",
                notes=notes,
            ))

        for desc, unit_cost, qty, share, notes in under_sink:
            line_items.append(LineItem(
                description=desc,
                quantity=qty,
                unit="EA",
                unit_price=unit_cost,
                total=round(unit_cost * qty, 2),
                material_share=share,
                category="plumbing",
                location="shared",
                notes=notes,
            ))

    # Countertop detach & reset — per LF of base run rather than a flat
    # fee, so a galley and a big U-shape are not charged the same.
    if include_countertop_reset:
        ct_reset_lf = round(base_lf, 2)
        ct_reset_rate = SCOPE_ITEMS["countertop_reset_per_lf"]
        ct_reset_min = SCOPE_ITEMS["countertop_reset_min"]
        ct_reset_total = round(ct_reset_lf * ct_reset_rate, 2)
        if ct_reset_total < ct_reset_min or ct_reset_lf <= 0:
            # Short runs still carry the trip and the two-person lift.
            line_items.append(LineItem(
                description="Countertop Detach & Reset (minimum)",
                quantity=1,
                unit="LS",
                unit_price=ct_reset_min,
                total=ct_reset_min,
                material_share=MATERIAL_SHARE["countertop_reset"],
                category="countertop",
                location="shared",
                notes=(
                    f"{ct_reset_lf:g} LF at ${ct_reset_rate}/LF is below "
                    f"the ${ct_reset_min} minimum"
                ),
            ))
        else:
            line_items.append(LineItem(
                description="Countertop Detach & Reset",
                quantity=ct_reset_lf,
                unit="LF",
                unit_price=ct_reset_rate,
                total=ct_reset_total,
                material_share=MATERIAL_SHARE["countertop_reset"],
                category="countertop",
                location="shared",
            ))

    # Site protection & cleanup
    site_prot_base = SCOPE_ITEMS["site_protection_base"]
    site_prot_lf = total_lf * SCOPE_ITEMS["site_protection_per_lf"]
    site_prot_cost = round(site_prot_base + site_prot_lf, 2)
    site_prot_share = _blended_share([
        (site_prot_base, "SCOPE_ITEMS.site_protection_base"),
        (site_prot_lf, "SCOPE_ITEMS.site_protection_per_lf"),
    ], MATERIAL_SHARE["site_protection"])
    line_items.append(LineItem(
        description=(
            "Site Protection "
            "(floor, countertop, walls)"
        ),
        quantity=1,
        unit="EA",
        unit_price=site_prot_cost,
        total=site_prot_cost,
        material_share=site_prot_share,
        category="misc",
        location="shared",
    ))

    cleanup_base = SCOPE_ITEMS["cleanup_base"]
    cleanup_lf = total_lf * SCOPE_ITEMS["cleanup_per_lf"]
    cleanup_cost = round(cleanup_base + cleanup_lf, 2)
    cleanup_share = _blended_share([
        (cleanup_base, "SCOPE_ITEMS.cleanup_base"),
        (cleanup_lf, "SCOPE_ITEMS.cleanup_per_lf"),
    ], MATERIAL_SHARE["cleanup"])
    line_items.append(LineItem(
        description="Final Cleanup & Debris Removal",
        quantity=1,
        unit="EA",
        unit_price=cleanup_cost,
        total=cleanup_cost,
        material_share=cleanup_share,
        category="misc",
        location="shared",
    ))

    # ── 7. Backsplash ──
    backsplash_product = products.get("backsplash")
    bs_product_sf = (
        sf_price(backsplash_product) if backsplash_product else None
    )
    if backsplash_product and bs_product_sf is None:
        warnings.append(
            f"Backsplash: {product_name(backsplash_product)} has no price "
            f"per sq ft, per box with its coverage, or per tile with its "
            f"size, so the backsplash stays at the table rate."
        )
    if (
        include_backsplash
        and backsplash_sqft
        and backsplash_product
        and bs_product_sf is not None
    ):
        # The chosen tile at its own price with overage, set at our rate
        # for that kind of tile.
        bs_type = backsplash_install_type(backsplash_product, backsplash_type)
        bs_info = BACKSPLASH_TYPES.get(bs_type) or BACKSPLASH_TYPES["ceramic_tile"]
        bs_sqft = round(backsplash_sqft, 2)
        misc_per_sf = SCOPE_ITEMS["backsplash_misc_per_sf"]
        bs_material = round(
            with_handling(bs_product_sf) * TILE_OVERAGE + misc_per_sf, 2,
        )
        bs_combined_unit = round(bs_material + bs_info["install_per_sf"], 2)
        line_items.append(LineItem(
            description=(
                f"Backsplash - {product_name(backsplash_product)} "
                f"(supply + install)"
            ),
            quantity=bs_sqft,
            unit="SF",
            unit_price=bs_combined_unit,
            total=round(bs_sqft * bs_combined_unit, 2),
            material_share=round(bs_material / bs_combined_unit, 4),
            category="backsplash",
            location="perimeter",
            notes=product_note(
                backsplash_product,
                f"{(TILE_OVERAGE - 1) * 100:.0f}% overage; set as "
                f"{bs_info['label'].lower()}; grout, thinset, tape",
            ),
        ))
        product_lines.append(
            f"Backsplash: {product_name(backsplash_product)} "
            f"({bs_sqft:g} SF)"
        )
    elif (
        include_backsplash
        and backsplash_type
        and backsplash_sqft
    ):
        bs_info = BACKSPLASH_TYPES.get(backsplash_type)
        if bs_info:
            bs_sqft = round(backsplash_sqft, 2)
            misc_per_sf = SCOPE_ITEMS[
                "backsplash_misc_per_sf"
            ]
            bs_combined_unit = round(
                bs_info["material_per_sf"]
                + bs_info["install_per_sf"]
                + misc_per_sf, 2,
            )
            bs_total = round(
                bs_sqft * bs_combined_unit, 2,
            )
            # Real split - this table quotes material and install separately
            bs_material_share = round(
                (bs_info["material_per_sf"] + misc_per_sf)
                / bs_combined_unit, 4,
            ) if bs_combined_unit else 0.0
            line_items.append(LineItem(
                description=(
                    f"Backsplash - {bs_info['label']} "
                    f"(supply + install)"
                ),
                quantity=bs_sqft,
                unit="SF",
                unit_price=bs_combined_unit,
                total=bs_total,
                material_share=bs_material_share,
                category="backsplash",
                location="perimeter",
                notes=(
                    "Incl. miscellaneous materials "
                    "(grout, thinset, tape, etc.)"
                ),
            ))

    # ── 8. Countertop (perimeter) ──
    # An option's chosen top: its own price per SF (with overage) as the
    # material, our fabrication, template and install as the labor - the
    # labor share of the table rate for its material.
    countertop_product = products.get("countertop")
    ct_product_sf = (
        sf_price(countertop_product, COUNTERTOP_DEPTH_IN)
        if countertop_product else None
    )
    if countertop_product and ct_product_sf is None:
        warnings.append(
            f"Countertop: {product_name(countertop_product)} has no price "
            f"per sq ft, per linear foot, or per piece with its size, so "
            f"the countertop stays at the table rate."
        )

    def _product_countertop_line(sqft: float, table_material: Optional[str], loc: str) -> LineItem:
        mat = table_material or "Quartz"
        table_rate = COUNTERTOP_MATERIALS.get(mat, {"rate": 90})["rate"]
        table_share = price_share(
            f"COUNTERTOP_MATERIALS.{mat}.rate", MATERIAL_SHARE["countertop"],
        )
        labor = round(table_rate * (1 - table_share), 2)
        material = round(with_handling(ct_product_sf) * COUNTERTOP_OVERAGE, 2)
        unit = round(material + labor, 2)
        return LineItem(
            description=(
                f"{'Island ' if loc == 'island' else ''}Countertop - "
                f"{product_name(countertop_product)} (supply + install)"
            ),
            quantity=round(sqft, 2),
            unit="SF",
            unit_price=unit,
            total=round(round(sqft, 2) * unit, 2),
            material_share=round(material / unit, 4),
            category="countertop",
            location=loc,
            notes=product_note(
                countertop_product,
                f"{(COUNTERTOP_OVERAGE - 1) * 100:.0f}% overage; our "
                f"fabrication, template and install at ${labor:,.2f}/SF",
            ),
        )

    if include_countertop and countertop_sqft and ct_product_sf is not None:
        line_items.append(_product_countertop_line(
            countertop_sqft, countertop_material, "perimeter",
        ))
        product_lines.append(
            f"Countertop: {product_name(countertop_product)} "
            f"({countertop_sqft:g} SF)"
        )
    elif include_countertop and countertop_sqft:
        ct_mat = countertop_material or "Laminate"
        ct_info = COUNTERTOP_MATERIALS.get(
            ct_mat, {"rate": 35, "label": ct_mat},
        )
        ct_rate = ct_info["rate"]
        ct_label = ct_info["label"]
        ct_sqft = round(countertop_sqft, 2)
        ct_total = round(ct_sqft * ct_rate, 2)
        line_items.append(LineItem(
            description=(
                f"Countertop - {ct_label} "
                f"(supply + install)"
            ),
            quantity=ct_sqft,
            unit="SF",
            unit_price=ct_rate,
            total=ct_total,
            material_share=price_share(
                f"COUNTERTOP_MATERIALS.{ct_mat}.rate", MATERIAL_SHARE["countertop"],
            ),
            category="countertop",
            location="perimeter",
        ))

    # ── 8b. Countertop (island, custom build only) ──
    if (include_countertop and island_countertop_sqft and not is_prefab
            and ct_product_sf is not None):
        line_items.append(_product_countertop_line(
            island_countertop_sqft,
            island_countertop_material or countertop_material, "island",
        ))
    elif include_countertop and island_countertop_sqft and not is_prefab:
        ict_mat = island_countertop_material or "Laminate"
        ict_info = COUNTERTOP_MATERIALS.get(
            ict_mat, {"rate": 35, "label": ict_mat},
        )
        ict_rate = ict_info["rate"]
        ict_label = ict_info["label"]
        ict_sqft = round(island_countertop_sqft, 2)
        ict_total = round(ict_sqft * ict_rate, 2)
        line_items.append(LineItem(
            description=(
                f"Island Countertop - {ict_label} "
                f"(supply + install)"
            ),
            quantity=ict_sqft,
            unit="SF",
            unit_price=ict_rate,
            total=ict_total,
            material_share=price_share(
                f"COUNTERTOP_MATERIALS.{ict_mat}.rate", MATERIAL_SHARE["countertop"],
            ),
            category="countertop",
            location="island",
        ))

    # ── 8b2. Island top overhang supports ──
    # A seating overhang past what the top can carry on its own needs steel
    # brackets or corbels under it, set before the top is templated.
    if (include_countertop and countertop_support_count
            and countertop_support_count > 0):
        sup_mat = COUNTERTOP_SUPPORT_PRICING["bracket_each"]
        sup_inst = COUNTERTOP_SUPPORT_PRICING["install_each"]
        sup_unit = round(sup_mat + sup_inst, 2)
        line_items.append(LineItem(
            description="Countertop Overhang Support Bracket (steel)",
            quantity=countertop_support_count,
            unit="EA",
            unit_price=sup_unit,
            total=round(countertop_support_count * sup_unit, 2),
            material_share=round(sup_mat / sup_unit, 4) if sup_unit else 0.0,
            category="countertop",
            location="island",
            notes="Under the seating overhang, set before the top is templated",
        ))
    elif (include_countertop and island_countertop_sqft and not is_prefab
            and island_seating_overhang_in):
        # The overhang is past what the top carries on its own, yet no
        # supports are billed: a missed line rather than a choice.
        sup_top = island_countertop_material or countertop_material or "Laminate"
        limit = COUNTERTOP_SUPPORT_RULE["max_unsupported_in"].get(sup_top)
        if limit is not None and island_seating_overhang_in > limit:
            warnings.append(
                f"Island seating overhang {island_seating_overhang_in:g}\" is "
                f"past the {limit}\" {sup_top} carries unsupported, but no "
                f"overhang supports are billed."
            )

    # ── 8c. 4" Countertop Backsplash ──
    if (include_countertop_backsplash
            and countertop_backsplash_lf
            and countertop_backsplash_lf > 0):
        cb_mat = countertop_material or "Laminate"
        cb_rate = COUNTERTOP_BACKSPLASH_PER_LF.get(
            cb_mat, 20,
        )
        cb_lf = round(countertop_backsplash_lf, 2)
        cb_total = round(cb_lf * cb_rate, 2)
        cb_label = COUNTERTOP_MATERIALS.get(
            cb_mat, {"label": cb_mat},
        )["label"]
        line_items.append(LineItem(
            description=(
                f"4\" Countertop Backsplash - "
                f"{cb_label} (supply + install)"
            ),
            quantity=cb_lf,
            unit="LF",
            unit_price=cb_rate,
            total=cb_total,
            material_share=price_share(
                f"COUNTERTOP_BACKSPLASH_PER_LF.{cb_mat}", MATERIAL_SHARE["countertop"],
            ),
            category="countertop",
            location="perimeter",
        ))

    # ── 9. Drywall repair ──
    if include_drywall_repair and drywall_repair_sqft:
        dw_sqft = round(drywall_repair_sqft, 2)
        dw_type = drywall_repair_type or "patch"
        if dw_type == "rr":
            dw_rate = SCOPE_ITEMS["drywall_rr_per_sf"]
            dw_share = price_share(
                "SCOPE_ITEMS.drywall_rr_per_sf", MATERIAL_SHARE["drywall_rr"],
            )
            dw_desc = (
                "R&R Sheetrock "
                "(behind cabinets)"
            )
        else:
            dw_rate = SCOPE_ITEMS[
                "drywall_patch_per_sf"
            ]
            dw_share = price_share(
                "SCOPE_ITEMS.drywall_patch_per_sf", MATERIAL_SHARE["drywall_patch"],
            )
            dw_desc = (
                "Drywall Patch & Repair "
                "(nail holes, minor damage)"
            )
        dw_total = round(dw_sqft * dw_rate, 2)
        line_items.append(LineItem(
            description=dw_desc,
            quantity=dw_sqft,
            unit="SF",
            unit_price=dw_rate,
            total=dw_total,
            material_share=dw_share,
            category="finishing",
            location="perimeter",
        ))

    # ── 10. Painting ──
    if include_painting and painting_sqft:
        p_sqft = round(painting_sqft, 2)
        prep_rate = SCOPE_ITEMS["paint_prep_per_sf"]
        paint_rate = SCOPE_ITEMS[
            "paint_primer_paint_per_sf"
        ]
        prep_total = round(p_sqft * prep_rate, 2)
        paint_total = round(p_sqft * paint_rate, 2)
        line_items.append(LineItem(
            description=(
                "Prep for Painting: "
                "Compound, Sanding"
            ),
            quantity=p_sqft,
            unit="SF",
            unit_price=prep_rate,
            total=prep_total,
            material_share=price_share(
                "SCOPE_ITEMS.paint_prep_per_sf", MATERIAL_SHARE["paint_prep"],
            ),
            category="finishing",
            location="perimeter",
        ))
        line_items.append(LineItem(
            description="Primer & Paint; Color Match",
            quantity=p_sqft,
            unit="SF",
            unit_price=paint_rate,
            total=paint_total,
            material_share=price_share(
                "SCOPE_ITEMS.paint_primer_paint_per_sf", MATERIAL_SHARE["paint_finish"],
            ),
            category="finishing",
            location="perimeter",
        ))

    # ── 11. Appliance Detach & Reset ──
    if include_appliance_rr and appliance_list:
        app_total = 0
        app_labels = []
        for appl in appliance_list:
            atype = appl.get("type", "")
            aqty = appl.get("qty", 1)
            # Skip disposal if plumbing already handles it
            if atype == "garbage_disposal" and include_plumbing:
                continue
            info = appliance_prices.get(atype)
            if not info or aqty <= 0:
                continue
            cost = APPLIANCE_RESET_PRICES.get(basis.value, {}).get(atype, info["cost"])
            item_cost = cost * aqty
            app_total += item_cost
            label = info["label"]
            if aqty > 1:
                label = f"{label} x{aqty}"
            app_labels.append(label)
        if app_total > 0:
            desc = (
                "Detach & Reset Appliances "
                f"({', '.join(app_labels)})"
            )
            line_items.append(LineItem(
                description=desc,
                quantity=1,
                unit="SET",
                unit_price=app_total,
                total=app_total,
                material_share=MATERIAL_SHARE["appliance_rr"],
                category="misc",
                location="shared",
            ))

    # ── 11b. Electrical Disconnect/Reconnect ──
    if include_electrical:
        elec_cost = SCOPE_ITEMS[
            "electrical_disconnect_reconnect"
        ]
        line_items.append(LineItem(
            description=(
                "Electrical Disconnect & Reconnect "
                "(DW, under-cabinet "
                "lighting, range)"
            ),
            quantity=1,
            unit="EA",
            unit_price=elec_cost,
            total=elec_cost,
            material_share=price_share(
                "SCOPE_ITEMS.electrical_disconnect_reconnect", MATERIAL_SHARE["electrical"],
            ),
            category="misc",
            location="shared",
            notes="Licensed electrician",
        ))

    # ── 11c. Outlet Relocation ──
    if outlet_relocation_count and outlet_relocation_count > 0:
        outlet_unit = SCOPE_ITEMS[
            "outlet_relocation_each"
        ]
        outlet_total = round(
            outlet_relocation_count * outlet_unit, 2,
        )
        line_items.append(LineItem(
            description="Outlet Relocation",
            quantity=outlet_relocation_count,
            unit="EA",
            unit_price=outlet_unit,
            total=outlet_total,
            material_share=price_share(
                "SCOPE_ITEMS.outlet_relocation_each", MATERIAL_SHARE["outlet_relocation"],
            ),
            category="misc",
            location="shared",
            notes=(
                "Relocate to match new cabinet "
                "layout; licensed electrician"
            ),
        ))

    # ── 11e. Fillers / scribe molding ──
    # Walls are never plumb and cabinet runs never land exactly on the
    # wall, so a filler strip goes in at essentially every run end and
    # inside corner. Billed per piece: material by tier + fit labor.
    if filler_count and filler_count > 0:
        filler_mat = FILLER_PRICING.get(
            tier, FILLER_PRICING["Stock"],
        )
        filler_inst = FILLER_PRICING["install_each"]
        filler_unit = round(filler_mat + filler_inst, 2)
        line_items.append(LineItem(
            description=f"Filler / Scribe Molding - {tier}",
            quantity=filler_count,
            unit="EA",
            unit_price=filler_unit,
            total=round(filler_count * filler_unit, 2),
            material_share=round(
                filler_mat / filler_unit, 4,
            ) if filler_unit else 0.0,
            category="premium",
            location="shared",
            notes="Scribed and fitted to the wall",
        ))

    # ── 11e2. Angled (non-90°) joints ──
    # The boxes stay square; each place the run turns at an angle takes a
    # 45° angled filler and extra fitting, and the top an angled cut.
    if angled_joint_count and angled_joint_count > 0:
        aj_mat = ANGLED_JOINT_PRICING.get(
            tier, ANGLED_JOINT_PRICING["Stock"],
        )
        aj_inst = ANGLED_JOINT_PRICING["install_each"]
        aj_unit = round(aj_mat + aj_inst, 2)
        line_items.append(LineItem(
            description=f"Angled Cabinet Joint - Angled Filler + Fitting - {tier}",
            quantity=angled_joint_count,
            unit="EA",
            unit_price=aj_unit,
            total=round(angled_joint_count * aj_unit, 2),
            material_share=round(aj_mat / aj_unit, 4) if aj_unit else 0.0,
            category="premium",
            location="shared",
            notes="Boxes set at the angle; the wedge taken up by an angled filler",
        ))
        # The top turns with the run. An island top is the likelier one to
        # be angled, so its material sets the rate when there is one.
        has_island_top = bool(island_countertop_sqft) and not is_prefab
        if include_countertop and (countertop_sqft or has_island_top):
            cut_mat = (
                island_countertop_material if has_island_top
                else countertop_material
            ) or "Laminate"
            cut_rate = COUNTERTOP_ANGLED_CUT_EACH.get(
                cut_mat, COUNTERTOP_ANGLED_CUT_EACH["Laminate"],
            )
            line_items.append(LineItem(
                description=f"Countertop Angled Cut - {cut_mat}",
                quantity=angled_joint_count,
                unit="EA",
                unit_price=cut_rate,
                total=round(angled_joint_count * cut_rate, 2),
                material_share=0.0,
                category="countertop",
                location="island" if has_island_top else "perimeter",
                notes=(
                    "Fabrication for a non-90° corner; the extra slab "
                    "waste belongs in the countertop SF"
                ),
            ))

    # ── 11f. Finished end panels ──
    # A run that ends in open space shows a raw box side without one.
    if end_panel_counts:
        for panel_type, count in end_panel_counts.items():
            if not count or count <= 0:
                continue
            prices = END_PANEL_PRICING.get(panel_type)
            if not prices:
                continue
            panel_mat = prices.get(tier, prices["Stock"])
            panel_inst = END_PANEL_PRICING["install_each"]
            panel_unit = round(panel_mat + panel_inst, 2)
            line_items.append(LineItem(
                description=(
                    f"{END_PANEL_TYPES.get(panel_type, panel_type)} "
                    f"- {tier}"
                ),
                quantity=count,
                unit="EA",
                unit_price=panel_unit,
                total=round(count * panel_unit, 2),
                material_share=round(
                    panel_mat / panel_unit, 4,
                ) if panel_unit else 0.0,
                category="premium",
                location="shared",
                notes="Finished to match cabinet doors",
            ))

    # ── 11g. Dishwasher return panel ──
    if (dishwasher_return_panel_count
            and dishwasher_return_panel_count > 0):
        line_items.append(LineItem(
            description="Dishwasher Return Panel",
            quantity=dishwasher_return_panel_count,
            unit="EA",
            unit_price=FLAT_PRICES["DISHWASHER_RETURN_PANEL"],
            total=round(
                dishwasher_return_panel_count
                * FLAT_PRICES["DISHWASHER_RETURN_PANEL"], 2,
            ),
            material_share=price_share("DISHWASHER_RETURN_PANEL", 0.65),
            category="premium",
            location="shared",
            notes="Finished filler beside the dishwasher opening",
        ))

    # ── 11h. Light rail molding ──
    # Trim under the wall cabinets that conceals under-cabinet lighting.
    # Defaults to the wall run when no explicit length is given.
    if include_light_rail:
        lr_lf = light_rail_lf if light_rail_lf else wall_lf
        lr_lf = round(lr_lf or 0, 2)
        if lr_lf > 0:
            lr_mat = LIGHT_RAIL_PRICING["material_per_lf"]
            lr_inst = LIGHT_RAIL_PRICING["install_per_lf"]
            lr_unit = round(lr_mat + lr_inst, 2)
            line_items.append(LineItem(
                description="Light Rail Molding",
                quantity=lr_lf,
                unit="LF",
                unit_price=lr_unit,
                total=round(lr_lf * lr_unit, 2),
                material_share=round(
                    lr_mat / lr_unit, 4,
                ) if lr_unit else 0.0,
                category="premium",
                location="perimeter",
                notes="Conceals under-cabinet lighting",
            ))

    # ── 12. Dumpster ──
    if include_dumpster:
        demo_cuft = (
            base_lf * 5.75
            + wall_lf * 2.5
            + tall_count * 28
        )
        if include_countertop and countertop_sqft:
            demo_cuft += countertop_sqft * 0.15
        if include_countertop and island_countertop_sqft:
            demo_cuft += island_countertop_sqft * 0.15
        if include_backsplash and backsplash_sqft:
            demo_cuft += backsplash_sqft * 0.3
        demo_cuyd = (demo_cuft * 1.3) / 27

        # Thresholds allow for the fact that a container's rated volume is
        # usable capacity for loose demo debris - cabinets are broken down
        # flat when loaded. A typical kitchen (~9-11 cu yd) fits a 15 yard.
        if demo_cuyd <= 7:
            dump_size = 10
            dump_key = "dumpster_10yard"
        elif demo_cuyd <= 11:
            dump_size = 15
            dump_key = "dumpster_15yard"
        elif demo_cuyd <= 16:
            dump_size = 20
            dump_key = "dumpster_20yard"
        else:
            dump_size = 30
            dump_key = "dumpster_30yard"

        dump_cost = SCOPE_ITEMS[dump_key]
        line_items.append(LineItem(
            description=(
                f"Trash Disposal with "
                f"{dump_size} Yard Dumpster"
            ),
            quantity=1,
            unit="EA",
            unit_price=dump_cost,
            total=dump_cost,
            material_share=MATERIAL_SHARE["dumpster"],
            category="demo",
            location="shared",
            notes=(
                f"Est. {demo_cuyd:.1f} cu yd "
                f"demo volume"
            ),
        ))

        # DC rowhouses rarely have off-street space for a container, so
        # the dumpster goes in the street or alley - which in DC needs a
        # DDOT public space occupancy permit. Only DC has this regime.
        if permit_jurisdiction(zip_code) == "DC":
            ps_cost = SCOPE_ITEMS["dc_dumpster_public_space_permit"]
            line_items.append(LineItem(
                description=(
                    "DC Public Space Occupancy Permit (dumpster)"
                ),
                quantity=1,
                unit="EA",
                unit_price=ps_cost,
                total=ps_cost,
                material_share=MATERIAL_SHARE["permit"],
                category="demo",
                location="shared",
                notes=(
                    "DDOT permit for a container in the street, alley "
                    "or sidewalk; 2-week allowance. Not required if the "
                    "container sits on private property."
                ),
            ))

    # ── 13. Calculate totals ──
    # Raw subtotal before O&P
    raw_subtotal = round(
        sum(item.total for item in line_items), 2,
    )
    overhead_amount = round(
        raw_subtotal * overhead_pct, 2,
    )
    profit_amount = round(
        raw_subtotal * profit_pct, 2,
    )

    # Bake O&P into line item unit prices
    # so PDF shows all-inclusive pricing
    op_mult = 1 + overhead_pct + profit_pct
    for item in line_items:
        item.unit_price = round(
            item.unit_price * op_mult, 2,
        )
        item.total = round(
            item.quantity * item.unit_price, 2,
        )

    # ── 13a. Permit allowance ──
    # Added last, and deliberately outside the O&P loop above.
    # Jurisdictions bill the permit off the DECLARED VALUE of the work -
    # the number on the application, which is the customer-facing price
    # including O&P - so it has to be computed after O&P is baked in.
    # It is also a pass-through government fee, not work the contractor
    # marks up, so it does not get O&P applied on top of itself.
    # (Was a flat $270 allowance regardless of jurisdiction or project
    # size; DC alone runs ~$1,100 on a $50k kitchen.)
    if include_permit:
        declared_value = round(
            sum(item.total for item in line_items), 2,
        )
        permit_cost, permit_label = permit_fee(
            zip_code, declared_value,
        )
        line_items.append(LineItem(
            description=(
                "Permit Allowance "
                "(plumbing/electrical)"
            ),
            quantity=1,
            unit="EA",
            unit_price=permit_cost,
            total=permit_cost,
            material_share=MATERIAL_SHARE["permit"],
            category="misc",
            location="shared",
            notes=(
                f"{permit_label} — allowance on a declared value of "
                f"${declared_value:,.0f}; actual fee set by the "
                f"permit office"
            ),
        ))

    # Subtotal now includes O&P (= total)
    subtotal = round(
        sum(item.total for item in line_items), 2,
    )
    total = subtotal

    _apply_material_labor_split(line_items)

    # ── 13b. Target total adjustment (reverse pricing) ──
    # The permit is a government fee at a rate the jurisdiction sets, so
    # it is held fixed and the remaining items absorb the adjustment -
    # scaling it would quote a permit cost that no office would charge.
    adjustment_factor = None
    if (
        target_total
        and target_total > 0
        and subtotal > 0
        and total > 0
    ):
        def _is_adjustable(it: LineItem) -> bool:
            return not it.description.startswith("Permit Allowance")

        adjustable = [it for it in line_items if _is_adjustable(it)]
        fixed_total = round(
            sum(it.total for it in line_items if not _is_adjustable(it)),
            2,
        )
        adjustable_total = round(
            sum(it.total for it in adjustable), 2,
        )
        # Solve over the adjustable half only.
        if adjustable_total > 0:
            adjustment_factor = (
                target_total - fixed_total
            ) / adjustable_total
        else:
            adjustment_factor = target_total / total

        for item in adjustable:
            item.unit_price = round(
                item.unit_price * adjustment_factor, 2,
            )
            item.total = round(
                item.quantity * item.unit_price, 2,
            )

        subtotal = round(
            sum(item.total for item in line_items), 2,
        )
        total = subtotal

        # Fix rounding drift: adjust largest line item to hit target exactly
        rounding_diff = round(target_total - total, 2)
        if rounding_diff != 0 and adjustable:
            largest = max(adjustable, key=lambda x: x.total)
            largest.total = round(largest.total + rounding_diff, 2)
            if largest.quantity:
                largest.unit_price = round(
                    largest.total / largest.quantity, 2
                )
            subtotal = round(
                sum(item.total for item in line_items), 2,
            )
            total = subtotal

        _apply_material_labor_split(line_items)

    # ── 14. Methodology notes ──
    _BASIS_LABELS = {
        Basis.INSURANCE_DR: (
            "Insurance (Xactimate detach & reset)"
        ),
        Basis.RETAIL_INSTALL: "Retail remodel (installer pricing)",
    }
    methodology_lines = [
        f"Estimate based on {tier} tier cabinets.",
        f"Pricing basis: {_BASIS_LABELS.get(basis, basis.value)}",
    ]
    if perimeter_boxes:
        methodology_lines.append(
            f"Perimeter: Base {p_base_lf:.1f} LF, "
            f"Wall {p_wall_lf:.1f} LF, "
            f"Tall {p_tall} EA"
        )
    if is_prefab and island_prefab_size:
        size_info = PREFAB_ISLAND_PRICING.get(
            island_prefab_size, {},
        )
        size_label = size_info.get(
            "label", island_prefab_size,
        )
        methodology_lines.append(
            f"Island: Prefab {size_label} "
            f"(price may vary by product)"
        )
    elif island_boxes:
        methodology_lines.append(
            f"Island: Base {i_base_lf:.1f} LF, "
            f"Wall {i_wall_lf:.1f} LF, "
            f"Tall {i_tall} EA"
            + (
                " — cabinets on both sides, back to back"
                " (no back panel or seating overhang)"
                if two_sided else ""
            )
        )
    methodology_lines.extend([
        (
            f"Multipliers: "
            f"Labor(ZIP {zip_code})={labor_mult}, "
            f"Material({box_material or 'Plywood'})={mat_mult}, "
            f"Finish({finish or 'Stained'})={fin_mult}, "
            f"Door({door_style or 'Shaker'})={door_mult}, "
            f"Overlay({overlay_style or 'Full Overlay'})="
            f"{overlay_mult}"
        ),
        f"Combined supply multiplier: {total_mult:.2f}",
        (
            f"O&P: {overhead_pct*100:.0f}% / "
            f"{profit_pct*100:.0f}%"
        ),
    ])
    if island_end_panel_sqft or island_back_panel_sqft:
        methodology_lines.append(
            f"Island panels: "
            f"end {island_end_panel_sqft} SF, "
            f"back {island_back_panel_sqft} SF"
        )
    if include_backsplash and backsplash_type:
        methodology_lines.append(
            f"Backsplash: {backsplash_type} "
            f"({backsplash_sqft or 0} SF)"
        )
    if adjustment_factor:
        methodology_lines.append(
            f"Target total: ${target_total:,.2f} "
            f"(adjusted)"
        )
    # Products chosen for scope that isn't on: nothing to price them in
    for slot, on, label in (
        ("cabinet_hardware", include_hardware, "the hardware"),
        ("countertop", include_countertop and bool(countertop_sqft), "the countertop (with its sq ft)"),
        ("backsplash", include_backsplash and bool(backsplash_sqft), "the backsplash (with its sq ft)"),
        ("kitchen_sink", include_plumbing, "the plumbing"),
        ("kitchen_faucet", include_plumbing, "the plumbing"),
    ):
        if products.get(slot) and not on:
            warnings.append(
                f"{product_name(products[slot])} is chosen, but "
                f"{label} isn't in the scope, so it isn't priced."
            )
    if products.get("cabinet_hardware") and include_hardware:
        product_lines.append(
            f"Hardware: {product_name(products['cabinet_hardware'])}"
        )
    if product_lines:
        methodology_lines.append(
            "Products (retail price + "
            f"{(with_handling(100) - 100):.0f}% handling; our labor):"
        )
        methodology_lines.extend(f"  {line}" for line in product_lines)
    methodology = "\n".join(methodology_lines)

    return CalculationResult(
        line_items=line_items,
        subtotal=subtotal,
        overhead_pct=overhead_pct,
        overhead_amount=overhead_amount,
        profit_pct=profit_pct,
        profit_amount=profit_amount,
        adjustment_factor=(
            round(adjustment_factor, 6)
            if adjustment_factor else None
        ),
        total=total,
        methodology_notes=methodology,
        # The same note twice says nothing more (two rows of one specialty
        # cabinet each add theirs).
        warning_flags=list(dict.fromkeys(warnings)),
        base_lf=base_lf,
        wall_lf=wall_lf,
        tall_count=tall_count,
        total_mult=total_mult,
    )
