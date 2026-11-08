"""
Bathroom Remodel Estimate calculator.
7-Phase calculation engine matching DMV contractor standards.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from .cabinets import CABINET_TYPES, cabinet_groups
from .layout_changes import layout_change_line_items
from .lights import LIGHT_TYPES, light_groups
from .mirrors import mirror_count, mirror_groups, price_by_width
from .pricing import (
    ACCESSORY_FINISH_MULTIPLIER,
    ACCESSORY_GRADE_MULTIPLIER,
    ACCESSORY_PRICES,
    BASEBOARD_PRICES,
    BATHTUB_EXTRAS,
    BATHTUB_INSTALL,
    BATHTUB_PRICES,
    CUSTOM_TILE_SHOWER_TYPES,
    DEMO_RATES,
    DETACH_RESET_COSTS,
    ELECTRICAL_RATES,
    FAUCET_PRICES,
    FLAT_PRICES,
    HIDDEN_COSTS,
    MIRROR_PRICES,
    MOISTURE_RESISTANT_PAINT_MULT,
    NEO_ANGLE_BASE_PRICES,
    NEO_ANGLE_DOOR_INSTALL,
    NEO_ANGLE_DOOR_PRICES,
    NEO_ANGLE_KIT_PRICES,
    NEO_ANGLE_WALL_SURROUND_PRICES,
    PAINT_GRADE_MULTIPLIER,
    PAINT_PREP,
    PAINT_RATES,
    PLUMBING_RATES,
    PUNCH_LIST_BASIS,
    QUARTER_ROUND_PRICES,
    SHOWER_CUSTOM_EXTRAS,
    SHOWER_DOOR_INSTALL,
    SHOWER_DOOR_PRICES,
    SHOWER_INSERT_PRICES,
    SHOWER_PAN_COSTS,
    SHOWER_VALVE_PRICES,
    SHOWERHEAD_PRICES,
    SINK_INSTALL,
    SINK_PRICES,
    SUBSTRATE_RATES,
    TILE_BASEBOARD_PRICES,
    TILE_EXTRAS,
    TILE_LABOR_RATES,
    TILE_MATERIAL_RATES,
    TOILET_EXTRAS,
    TOILET_PRICES,
    TRIM_GRADE_MULTIPLIER,
    TUB_FAUCET_PRICES,
    VANITY_EXTRAS,
    VANITY_PRICES,
    VANITY_TOP_PRICES,
    apply_material_handling,
    get_curbless_floor_cost,
    get_labor_multiplier,
    get_material_share,
    get_material_tax_loading,
    get_permit_info,
    get_punch_list_cost,
    get_punch_list_note,
    get_tile_complexity_multiplier,
    get_tile_waste,
    is_curbless,
)
from .selections import Picks

logger = logging.getLogger(__name__)

_DOLLAR_RE = re.compile(r'\$([0-9,]+(?:\.[0-9]+)?)')


def _scale_dollar_amounts(text: str, factor: float) -> str:
    """Scale every $amount in a note string by factor."""
    def _replace(m: re.Match) -> str:
        raw = float(m.group(1).replace(',', ''))
        return f"${round(raw * factor, 2):,.2f}"
    return _DOLLAR_RE.sub(_replace, text)


# Legacy `shower_spec["enclosure"]` values → canonical door_type keys.
# The old SHOWER_ENCLOSURE_PRICES lookup table was removed (§7-3): it was a
# second, staler price list for selections SHOWER_DOOR_PRICES already covers,
# so the same choice priced differently depending on which field was set.
_LEGACY_ENCLOSURE_MAP = {
    "curtain": "curtain",
    "sliding": "framed_sliding",
    "pivot": "framed_pivot",
    "frameless": "frameless_sliding",
    "half_wall_glass": "fixed_panel",
}


def calculate_estimate(estimate, layout_changes=None) -> Dict[str, Any]:
    """Calculate all line items for a bathroom estimate.

    Args:
        estimate: BathroomEstimate ORM object
        layout_changes: for an option, how its sketch differs from its job's
            baseline (layout_changes.layout_changes); priced as rough-in,
            framing and demo work

    Returns:
        Dict with line_items, subtotal, overhead, profit, total, etc.
        (tax_amount is always 0 — material tax is loaded into line pricing.)
    """
    line_items: List[Dict] = []
    warnings: List[str] = []
    # An option's picked products: their retail price is the material cost
    picks = Picks(estimate)
    zip_code = estimate.zip_code or ""
    labor_mult = get_labor_multiplier(zip_code)

    floor_sf = estimate.floor_sf or 0
    wall_sf = estimate.wall_sf or 0

    # Derive "replace floor" from floor_spec having a material (or an option's picked floor tile)
    _floor_spec = estimate.floor_spec or {}
    replace_floor = bool(_floor_spec.get("material")) or bool(picks.get("floor_tile"))

    # Auto-compute floor/wall SF if dimensions provided
    if not floor_sf and estimate.length_ft and estimate.width_ft:
        floor_sf = estimate.length_ft * estimate.width_ft

    height = estimate.height_ft or 8.0
    if not wall_sf and estimate.length_ft and estimate.width_ft:
        perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        wall_sf = perimeter * height
        # Subtract ~20 SF for door opening
        wall_sf = max(wall_sf - 20, 0)

    # ── Tile floor SF: subtract fixture footprints from total floor ──
    # Shower & bathtub (except freestanding) sit on subfloor — no tile
    # Built-in (freestanding-mount) vanity: no tile under cabinet
    # Wall-mounted vanity: tile goes under (no floor contact)
    tile_floor_sf = floor_sf
    _sketch = estimate.sketch_data or {}
    _sk_fix = _sketch.get("fixtures", [])

    _tub_spec = estimate.bathtub_spec or {}
    if estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False):
        if _tub_spec.get("type", "alcove") != "freestanding":
            _sk_tub = next((f for f in _sk_fix
                            if f.get("type") == "bathtub"), None)
            if _sk_tub:
                _d = _sk_tub.get("dimensions", {})
                _tl = max(_d.get("width", 60), _d.get("height", 32))
                _td = min(_d.get("width", 60), _d.get("height", 32))
            else:
                _tl = _tub_spec.get("tub_length_in") or 60
                _td = _tub_spec.get("tub_depth_in") or 32
            tile_floor_sf -= (_tl * _td) / 144

    _shower_spec = estimate.shower_spec or {}
    if estimate.replace_shower or getattr(
            estimate, 'detach_reset_shower', False):
        _sk_sh = next((f for f in _sk_fix
                       if f.get("type") == "shower"), None)
        if _sk_sh:
            _sd = _sk_sh.get("dimensions", {})
            _sw, _sdp = _sd.get("width", 36), _sd.get("height", 36)
        else:
            _sw = _shower_spec.get("width_in") or 36
            _sdp = _shower_spec.get("depth_in") or 36
        tile_floor_sf -= (_sw * _sdp) / 144

    _vanity_spec = estimate.vanity_spec or {}
    if estimate.replace_vanity or getattr(
            estimate, 'detach_reset_vanity', False):
        _vi_list = _vanity_spec.get("items") or [_vanity_spec]
        _v_mount_default = _vanity_spec.get("mounting", "freestanding")
        for _vi in _vi_list:
            if _vi.get("mounting", _v_mount_default) != "wall_mount":
                _sk_vans = [f for f in _sk_fix
                            if f.get("type") == "vanity"]
                _vw = _vi.get("width") or 36
                _vd = 22  # standard vanity depth (inches)
                if _sk_vans:
                    _sv = _sk_vans[0]
                    _vw = _sv.get("dimensions", {}).get("width", _vw)
                    _vd = _sv.get("dimensions", {}).get("height", _vd)
                tile_floor_sf -= (_vw * _vd) / 144

    tile_floor_sf = max(round(tile_floor_sf, 1), 0)

    # Water damage source — plumber already repaired this fixture's plumbing
    # Supports multiple sources: "shower,bathtub" or single "shower"
    _wd_raw = getattr(estimate, 'water_damage_source', None) or ""
    wd_sources = [s.strip() for s in _wd_raw.split(",") if s.strip()]
    plumber_fixed_shower = "shower" in wd_sources
    plumber_fixed_tub = "bathtub" in wd_sources
    plumber_fixed_vanity = "vanity" in wd_sources
    plumber_fixed_toilet = "toilet" in wd_sources

    # ── Auto-derive demo flags from scope ──
    # demo_floor: new floor tile requires removing old tile first
    # demo_walls: custom tile shower or tub surround requires removing old wall surface
    _shower_spec_demo = estimate.shower_spec or {}
    _tub_spec_demo = estimate.bathtub_spec or {}
    demo_floor = replace_floor or getattr(estimate, 'demo_floor', False)

    # Wall demo: auto-derive from shower/tub surround OR manual flag
    _auto_wall_shower = (estimate.replace_shower
                         and _shower_spec_demo.get("type") in CUSTOM_TILE_SHOWER_TYPES)
    _auto_wall_tub = (_tub_spec_demo.get("surround_tile", False)
                      and (estimate.replace_tub
                           or getattr(estimate, 'detach_reset_tub', False)))
    _manual_wall_demo = getattr(estimate, 'demo_walls', False)
    demo_walls = _auto_wall_shower or _auto_wall_tub or _manual_wall_demo
    demo_ceiling = getattr(estimate, 'demo_ceiling', False)

    # Demo-specific SF (override or fallback to bathroom SF)
    # Floor tile comes out where there's tile: not under the tub, shower or vanity
    demo_floor_sf = getattr(estimate, 'demo_floor_sf', None) or tile_floor_sf
    demo_ceiling_sf = getattr(estimate, 'demo_ceiling_sf', None) or floor_sf

    # Wall demo SF: if user provided override, use it.
    # If auto-derived from shower/tub surround only (not manual full-wall demo),
    # calculate actual demo area from those specific zones instead of entire bathroom.
    _manual_demo_wall_sf = getattr(estimate, 'demo_wall_sf', None)
    if _manual_demo_wall_sf:
        demo_wall_sf = _manual_demo_wall_sf
    elif _manual_wall_demo:
        # User explicitly checked "demo walls" → full bathroom wall area
        demo_wall_sf = wall_sf
    elif demo_walls:
        # Auto-derived: only shower surround + tub surround areas
        _auto_wall_sf = 0.0
        if _auto_wall_shower:
            _sw = _shower_spec_demo.get("width_in", 0) or 36
            _sd = _shower_spec_demo.get("depth_in", 0) or 36
            _sh = _shower_spec_demo.get("tile_height_in", 0) or 84
            _auto_wall_sf += (_sw + 2 * _sd) * _sh / 144
        if _auto_wall_tub:
            _tl = _tub_spec_demo.get("tub_length_in", 0) or 60
            _td = _tub_spec_demo.get("tub_depth_in", 0) or 32
            _th = _tub_spec_demo.get("surround_height_in", 0) or 60
            _twc = _tub_spec_demo.get("surround_wall_count", 3) or 3
            if _twc >= 3:
                _auto_wall_sf += (_tl + 2 * _td) * _th / 144
            elif _twc == 2:
                _auto_wall_sf += (_tl + _td) * _th / 144
            else:
                _auto_wall_sf += _tl * _th / 144
        demo_wall_sf = round(_auto_wall_sf, 1) if _auto_wall_sf > 0 else wall_sf
    else:
        demo_wall_sf = wall_sf

    # Lead RRP check
    year_built = estimate.year_built or 2000
    needs_lead_rrp = year_built < 1978

    # Demo already done? (mitigation team completed demo before remodel)
    demo_already_done = getattr(estimate, 'demo_already_done', False) or False

    # ────────────────────────────────────────
    # Phase 1: Demo & Disposal (consolidated into single line item + dumpster)
    # ────────────────────────────────────────
    demo_total = 0
    demo_parts = []

    # Tile comes out for the remodel whoever did the water-damage demo:
    # mitigation tears out the wet drywall and ceiling, not the floor tile or
    # the tub/shower wall tile, so "demo already done" drops the ceiling only
    if demo_floor and demo_floor_sf > 0:
        cost = round(demo_floor_sf * DEMO_RATES["floor_tile_per_sf"] * labor_mult, 2)
        demo_total += cost
        demo_parts.append(f"Floor tile {demo_floor_sf:.0f}SF ${cost:,.2f}")

    if demo_walls and demo_wall_sf > 0:
        if _manual_wall_demo and not (_auto_wall_shower or _auto_wall_tub):
            # User manually checked "demo walls" → full bathroom walls
            cost = round(demo_wall_sf * DEMO_RATES["wall_tile_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Wall tile {demo_wall_sf:.0f}SF ${cost:,.2f}")
        else:
            # Auto-derived: itemize by zone for clarity
            # Shower wall tile cost is accumulated and merged with shower unit tear-out below
            if _auto_wall_shower:
                _dsw = _shower_spec_demo.get("width_in", 0) or 36
                _dsd = _shower_spec_demo.get("depth_in", 0) or 36
                _dsh = _shower_spec_demo.get("tile_height_in", 0) or 84
                _shower_demo_sf = round((_dsw + 2 * _dsd) * _dsh / 144, 1)
                _shower_tile_cost = round(_shower_demo_sf * DEMO_RATES["wall_tile_per_sf"] * labor_mult, 2)
                demo_total += _shower_tile_cost
                # Note: label added later when merged with shower unit tear-out
            if _auto_wall_tub:
                _dtl = _tub_spec_demo.get("tub_length_in", 0) or 60
                _dtd = _tub_spec_demo.get("tub_depth_in", 0) or 32
                _dth = _tub_spec_demo.get("surround_height_in", 0) or 60
                _dtwc = _tub_spec_demo.get("surround_wall_count", 3) or 3
                if _dtwc >= 3:
                    _tub_demo_sf = round((_dtl + 2 * _dtd) * _dth / 144, 1)
                elif _dtwc == 2:
                    _tub_demo_sf = round((_dtl + _dtd) * _dth / 144, 1)
                else:
                    _tub_demo_sf = round(_dtl * _dth / 144, 1)
                _tc = round(_tub_demo_sf * DEMO_RATES["wall_tile_per_sf"] * labor_mult, 2)
                demo_total += _tc
                demo_parts.append(f"Tub surround tile removal {_tub_demo_sf:.0f}SF ${_tc:,.2f}")

    if demo_ceiling and demo_ceiling_sf > 0:
        if demo_already_done:
            demo_parts.append("Ceiling demo already completed by mitigation")
        else:
            cost = round(demo_ceiling_sf * DEMO_RATES["ceiling_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Ceiling {demo_ceiling_sf:.0f}SF ${cost:,.2f}")

    if estimate.replace_tub:
        tub_mat = (estimate.bathtub_spec or {}).get("material", "acrylic")
        if tub_mat == "cast_iron":
            cost = round(DEMO_RATES["bathtub_cast_iron"] * labor_mult, 2)
            demo_parts.append(f"Cast iron tub ${cost:,.2f}")
        else:
            cost = round(DEMO_RATES["bathtub_standard"] * labor_mult, 2)
            demo_parts.append(f"Bathtub ${cost:,.2f}")
        demo_total += cost

    if estimate.replace_shower:
        shower_spec = estimate.shower_spec or {}
        stype = shower_spec.get("type", "one_piece")
        if stype in CUSTOM_TILE_SHOWER_TYPES:
            _unit_cost = round(DEMO_RATES["shower_custom_tile"] * labor_mult, 2)
            # Merge wall tile removal + unit tear-out into one line
            if _auto_wall_shower and '_shower_tile_cost' in dir():
                _shower_combined = _shower_tile_cost + _unit_cost
                demo_parts.append(
                    f"Shower demo {_shower_demo_sf:.0f}SF ${_shower_combined:,.2f}")
                demo_total += _unit_cost
            else:
                demo_parts.append(f"Shower tear-out ${_unit_cost:,.2f}")
                demo_total += _unit_cost
        else:
            cost = round(DEMO_RATES["shower_surround"] * labor_mult, 2)
            demo_parts.append(f"Shower surround ${cost:,.2f}")
            demo_total += cost
    elif _auto_wall_shower and '_shower_tile_cost' in dir():
        # D&R shower or no replace, but surround tile still needed demo
        demo_parts.append(f"Shower wall tile removal {_shower_demo_sf:.0f}SF ${_shower_tile_cost:,.2f}")

    if estimate.replace_vanity:
        _van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        for _vi in _van_items:
            if not _vi or not isinstance(_vi, dict):
                continue
            _sink_t = _vi.get("sink_type", "cabinet")
            _demo_key = _sink_t if _sink_t in DEMO_RATES else "vanity"
            _demo_label = {
                "pedestal_sink": "Pedestal sink",
                "wall_mount_sink": "Wall-mount sink",
            }.get(_sink_t, "Vanity")
            cost = round(DEMO_RATES[_demo_key] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"{_demo_label} ${cost:,.2f}")

    # Mirror demo only if replacing with new mirror (not D&R, not None)
    if getattr(estimate, 'replace_mirror', False):
        mirror_van_count = mirror_count(estimate) or 1
        mirror_cost = round(mirror_van_count * DEMO_RATES["mirror"] * labor_mult, 2)
        demo_total += mirror_cost
        demo_parts.append(f"Mirror x{mirror_van_count} ${mirror_cost:,.2f}")

    if estimate.replace_toilet:
        cost = round(DEMO_RATES["toilet"] * labor_mult, 2)
        demo_total += cost
        demo_parts.append(f"Toilet ${cost:,.2f}")

    # Cement board: demo section requiring replacement
    cb_repair_sf = 0
    if estimate.water_damage and getattr(estimate, 'demo_cement_board', False):
        cb_repair_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        if cb_repair_sf > 0:
            cost = round(cb_repair_sf * DEMO_RATES["durock_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Cement board {cb_repair_sf:.0f}SF ${cost:,.2f}")

    # Existing wall tile removal (walls marked 'already tiled' in sketch,
    # outside the shower/tub surround zones). Skip if the manual "demo
    # walls" flag already covers the full bathroom wall area — that would
    # double count this SF.
    existing_tile_wall_sf = 0
    if not _manual_wall_demo:
        existing_tile_wall_sf = (estimate.walls_spec or {}).get(
            "existing_tile_wall_sf", 0) or 0
        if existing_tile_wall_sf > 0:
            cost = round(
                existing_tile_wall_sf * DEMO_RATES["wall_tile_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(
                f"Existing wall tile removal {existing_tile_wall_sf:.0f}SF ${cost:,.2f}")

    # Tub deck/rim tile demo for detach & reset (deck must come off to free
    # the tub, and — unlike the tub itself — the tile is destroyed on
    # removal, so it counts toward tile demo/debris even with no other demo).
    # Folded into the "Demo & removal" line below rather than its own line
    # item, since the deck coming off is just up-front demo scope needed
    # before the D&R tub work further down can happen.
    _dr_deck_demo_sf = 0
    if getattr(estimate, 'detach_reset_tub', False):
        _dr_tub_spec_demo = estimate.bathtub_spec or {}
        if _dr_tub_spec_demo.get("deck_tile"):
            _dr_deck_demo_sf = _dr_tub_spec_demo.get("deck_tile_sf", 0) or 0
            if _dr_deck_demo_sf > 0:
                _dr_deck_sides_demo = _dr_tub_spec_demo.get("deck_tile_sides", 2)
                cost = round(
                    _dr_deck_demo_sf * DEMO_RATES["deck_tile_per_sf"] * labor_mult, 2)
                demo_total += cost
                demo_parts.append(
                    f"Tub deck tile removal ({_dr_deck_sides_demo} sides) "
                    f"{_dr_deck_demo_sf:.0f}SF ${cost:,.2f} — deck must come "
                    f"off to free the tub for detach & reset")

    has_tile_demo = demo_floor or demo_walls or demo_ceiling or existing_tile_wall_sf > 0 or _dr_deck_demo_sf > 0

    if demo_total > 0:
        has_fixture_replace = (estimate.replace_tub or estimate.replace_shower
                               or estimate.replace_vanity or estimate.replace_toilet
                               or getattr(estimate, 'replace_mirror', False))
        has_fixture_dr = (getattr(estimate, 'detach_reset_tub', False)
                          or getattr(estimate, 'detach_reset_shower', False)
                          or getattr(estimate, 'detach_reset_vanity', False)
                          or getattr(estimate, 'detach_reset_toilet', False)
                          or getattr(estimate, 'detach_reset_mirror', False))
        if has_fixture_replace and not has_fixture_dr:
            demo_label = "Demo & removal - complete"
        elif has_fixture_replace and has_fixture_dr:
            demo_label = "Demo & removal - partial"
        elif has_tile_demo:
            demo_label = "Tile & surface demo"
        else:
            demo_label = "Selective demo"
        _add(line_items, 1, demo_label,
             1, "LS", demo_total, "demo",
             notes=" | ".join(demo_parts))

    # Dumpster / disposal (separate line - disposal is distinct from labor)
    # Size is estimated by cubic yard volume of debris:
    #   - Tile/surface demo: ~0.5 CY per 100 SF (thin-set + tile ≈ 0.5" thick)
    #   - Bathtub: ~2 CY (standard acrylic), ~2.5 CY (cast iron)
    #   - Shower surround: ~1.5 CY, custom tile shower: ~2 CY
    #   - Vanity: ~1 CY each (cabinet + countertop)
    #   - Toilet: ~0.5 CY
    #   - Cement board: ~0.3 CY per 100 SF
    #   - D&R fixtures: ~0.2 CY each (packaging, old hardware, sealant)
    hc = estimate.hidden_costs or {}

    has_fixture_replace = (estimate.replace_tub or estimate.replace_shower
                           or estimate.replace_vanity or estimate.replace_toilet)
    has_demo = has_tile_demo or has_fixture_replace

    if has_demo:
        debris_cy = 0.0

        # Tile/surface demo volume
        if demo_floor:
            debris_cy += demo_floor_sf * 0.005  # 0.5 CY per 100 SF
        if demo_walls:
            debris_cy += demo_wall_sf * 0.005
        if existing_tile_wall_sf > 0:
            debris_cy += existing_tile_wall_sf * 0.005
        if _dr_deck_demo_sf > 0:
            debris_cy += _dr_deck_demo_sf * 0.005
        if demo_ceiling and not demo_already_done:  # mitigation hauled its own
            debris_cy += demo_ceiling_sf * 0.003  # thinner than tile

        # Fixture demo volume (replace only — D&R fixtures are stored, not disposed)
        if estimate.replace_tub:
            tub_mat = (estimate.bathtub_spec or {}).get("material", "acrylic")
            debris_cy += 2.5 if tub_mat == "cast_iron" else 2.0
        if estimate.replace_shower:
            shower_spec_d = estimate.shower_spec or {}
            stype_d = shower_spec_d.get("type", "one_piece")
            debris_cy += 2.0 if stype_d in CUSTOM_TILE_SHOWER_TYPES else 1.5
        if estimate.replace_vanity:
            van_ct = len((estimate.vanity_spec or {}).get("items", [])) or 1
            debris_cy += 1.0 * van_ct
        if estimate.replace_toilet:
            debris_cy += 0.5
        if getattr(estimate, 'replace_mirror', False):
            debris_cy += 0.2

        # Cement board demo (water damage repair)
        if cb_repair_sf > 0:
            debris_cy += cb_repair_sf * 0.003

        # Determine disposal method based on volume
        if debris_cy <= 1.5:
            # Small job: debris bags only (no dumpster needed)
            bag_count = max(int(debris_cy / 0.15) + 1, 2)  # ~4 cu ft per bag
            _add(line_items, 1,
                 f"Debris disposal ({bag_count} bags, {debris_cy:.1f} CY est.)",
                 bag_count, "EA",
                 DEMO_RATES["debris_bag"] * labor_mult,
                 "demo",
                 notes="Heavy-duty contractor bags + haul-away")
        # Dumpster tiers allow for the container's rated volume being
        # usable capacity for loose bath demo debris (tile, board, fixtures).
        # The bag cutoff stays at 1.5 CY so fixture jobs never fall back
        # to contractor bags.
        elif debris_cy <= 7:
            _add(line_items, 1,
                 f"Dumpster rental (10yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_10yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")
        elif debris_cy <= 13:
            _add(line_items, 1,
                 f"Dumpster rental (15yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_15yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")
        else:
            _add(line_items, 1,
                 f"Dumpster rental (20yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_20yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")

    # ────────────────────────────────────────
    # Phase 2: Plumbing Rough
    # ────────────────────────────────────────
    plumb = estimate.plumbing_spec or {}

    # Auto-calculate shutoff valves & supply lines from ALL plumbing fixtures
    # (both Replace and D&R). Each fixture has valves & supply lines that
    # should be replaced when disconnected to prevent future leaks. A fixture
    # the plumber already repaired (water_damage_source) keeps the shut-off
    # valves the plumber put in: it adds none.
    _plumb_fixtures = []
    _plumber_valve_fixtures = []
    _auto_valve_count = 0
    _auto_supply_count = 0

    def _count_valves(label, valves, plumber_fixed):
        nonlocal _auto_valve_count
        if plumber_fixed:
            _plumber_valve_fixtures.append(label)
        else:
            _auto_valve_count += valves
            _plumb_fixtures.append(label)

    # Vanity: 2 valves (hot/cold) per sink (double-sink vanity = 2x)
    if estimate.replace_vanity or getattr(estimate, 'detach_reset_vanity', False):
        _van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        _van_sink_count = sum(
            (v.get("sinks", 1) or 1) for v in _van_items if v and isinstance(v, dict)
        )
        _count_valves(f"vanity sink x{_van_sink_count}", _van_sink_count * 2,
                      plumber_fixed_vanity)
        _auto_supply_count += _van_sink_count * 2
    # Bathtub: 2 valves (hot/cold)
    if estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False):
        _count_valves("bathtub", 2, plumber_fixed_tub)
        _auto_supply_count += 2
    # Standalone shower: 2 valves (hot/cold)
    if estimate.replace_shower or getattr(estimate, 'detach_reset_shower', False):
        _count_valves("shower", 2, plumber_fixed_shower)
        _auto_supply_count += 2
    # Toilet: 1 valve (cold only)
    if estimate.replace_toilet or getattr(estimate, 'detach_reset_toilet', False):
        _count_valves("toilet", 1, plumber_fixed_toilet)
        _auto_supply_count += 1

    if _auto_valve_count > 0:
        _fix_list = ", ".join(_plumb_fixtures)
        _valve_note = f"Quarter-turn ball valve | {_fix_list}"
        if _plumber_valve_fixtures:
            _valve_note += (" | Not included (plumber already replaced): "
                            + ", ".join(_plumber_valve_fixtures))
        _add(line_items, 2, "Shut-off valve replacement",
             _auto_valve_count, "EA",
             PLUMBING_RATES["shutoff_valve_each"] * labor_mult, "plumbing",
             notes=_valve_note)
    if _plumber_valve_fixtures:
        warnings.append("Shut-off valves: plumber already replaced ("
                        + ", ".join(_plumber_valve_fixtures)
                        + ") — excluded from estimate")

    if _auto_supply_count > 0:
        _add(line_items, 2, "Supply line replacement (braided SS)",
             _auto_supply_count, "EA",
             PLUMBING_RATES["supply_line_each"] * labor_mult, "plumbing",
             notes="Braided stainless steel | replace while disconnected")

    # Auto-calculate P-traps from drain-bearing fixtures.
    # Toilet does NOT have a P-trap (direct wax-ring flange connection).
    # Each vanity sink, bathtub, and shower has 1 P-trap.
    _auto_ptrap_count = 0
    _ptrap_fixtures = []
    if estimate.replace_vanity or getattr(estimate, 'detach_reset_vanity', False):
        _pt_van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        _pt_van_sink_count = sum(
            (v.get("sinks", 1) or 1) for v in _pt_van_items if v and isinstance(v, dict)
        )
        _auto_ptrap_count += _pt_van_sink_count
        _ptrap_fixtures.append(f"vanity sink x{_pt_van_sink_count}")
    if estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False):
        _auto_ptrap_count += 1
        _ptrap_fixtures.append("bathtub")
    if estimate.replace_shower or getattr(estimate, 'detach_reset_shower', False):
        _auto_ptrap_count += 1
        _ptrap_fixtures.append("shower")

    # Use whichever is greater: auto-count or manual override
    _manual_ptrap = plumb.get("p_trap_count") or 0
    p_trap_count = max(_auto_ptrap_count, _manual_ptrap)
    if p_trap_count > 0:
        _pt_fix_list = ", ".join(_ptrap_fixtures) if _ptrap_fixtures else "manual"
        _add(line_items, 2, "P-trap replacement", p_trap_count, "EA",
             PLUMBING_RATES["p_trap_each"] * labor_mult, "plumbing",
             notes=f"Replace while disconnected | {_pt_fix_list}")

    if plumb.get("drain_modification"):
        _add(line_items, 2, "Drain line modification", 1, "EA",
             PLUMBING_RATES["drain_modification"] * labor_mult, "plumbing")

    if plumb.get("pressure_balance_valve"):
        _add(line_items, 2, "Pressure balance valve (code required)", 1, "EA",
             PLUMBING_RATES["pressure_balance_valve"] * labor_mult, "plumbing")

    if plumb.get("rough_inspection"):
        _add(line_items, 2, "Plumbing rough inspection fee", 1, "EA",
             PLUMBING_RATES["rough_inspection_fee"], "plumbing")

    # Layout changes (an option only): fixtures moved, added or taken out,
    # a tub converted to a shower, walls and doors moved. The estimator can
    # leave a change out; its key is then in plumbing_spec.layout_change_skips.
    _layout_rough = False
    if layout_changes:
        _layout_items, _layout_rough, _layout_warnings = layout_change_line_items(
            layout_changes, labor_mult,
            set(plumb.get("layout_change_skips") or []),
        )
        line_items.extend(_layout_items)
        warnings.extend(_layout_warnings)

    # ────────────────────────────────────────
    # Phase 3: Substrate
    # ────────────────────────────────────────
    sub = estimate.substrate_spec or {}

    # Auto-calculate wet-area SF from shower/tub tile areas if not manually specified
    auto_wet_sf = 0
    shower_spec = estimate.shower_spec or {}
    tub_spec_sub = estimate.bathtub_spec or {}

    # Shower wall tile SF
    if (estimate.replace_shower
            and shower_spec.get("type") in CUSTOM_TILE_SHOWER_TYPES):
        s_tile = shower_spec.get("tile_spec", {})
        s_sf = s_tile.get("sf", 0)
        if not s_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get("tile_height_in", 0) or 0
            if sw and sd and sh:
                s_sf = (sw + 2 * sd) * sh / 144
        auto_wet_sf += s_sf or 0

        # Shower floor SF (also needs waterproofing)
        s_floor_w = shower_spec.get("width_in", 0) or 0
        s_floor_d = shower_spec.get("depth_in", 0) or 0
        if s_floor_w and s_floor_d:
            auto_wet_sf += s_floor_w * s_floor_d / 144

    # Tub surround tile SF
    if tub_spec_sub.get("surround_tile") and tub_spec_sub.get("type") in ("drop_in", "alcove"):
        t_sf = tub_spec_sub.get("surround_tile_sf", 0)
        if not t_sf:
            tl = tub_spec_sub.get("tub_length_in", 0) or 0
            tsh = tub_spec_sub.get("surround_height_in", 0) or 0
            td = tub_spec_sub.get("tub_depth_in", 30) or 30
            if tl and tsh:
                t_sf = (tl + 2 * td) * tsh / 144
        auto_wet_sf += t_sf or 0

    # Durock: use manual value if provided, else auto from wet areas
    durock_sf = sub.get("durock_sf", 0) or auto_wet_sf
    if durock_sf > 0:
        _add(line_items, 3, "Cement board (Durock) - wet area", durock_sf, "SF",
             SUBSTRATE_RATES["durock_per_sf"] * labor_mult, "substrate",
             notes="1/2\" cement board on shower/tub surround walls "
                   "(behind wall tile) — waterproof substrate for wet "
                   "vertical surfaces, separate from floor underlayment below")

    # Floor cement board (1/4") — only when demo removed the old substrate
    # If existing cement board is intact (no demo), tile directly over it
    if replace_floor and demo_floor and tile_floor_sf > 0:
        floor_spec_sub = estimate.floor_spec or {}
        floor_mat = floor_spec_sub.get("material", "porcelain")
        if floor_mat in ("porcelain", "ceramic", "natural_stone",
                        "glass_mosaic"):
            _add(line_items, 3, "Cement board (1/4\") - floor underlayment",
                 tile_floor_sf, "SF",
                 SUBSTRATE_RATES["durock_floor_per_sf"] * labor_mult,
                 "substrate",
                 notes="1/4\" cement board under new floor tile "
                       "(bathroom floor, not shower/tub walls) — rigid "
                       "underlayment for floor tile after old flooring "
                       "demo, separate from wet-wall cement board above")

    greenboard_sf = sub.get("greenboard_sf") or 0
    if greenboard_sf > 0:
        _add(line_items, 3, "Moisture-resistant drywall (greenboard)", greenboard_sf, "SF",
             SUBSTRATE_RATES["greenboard_per_sf"] * labor_mult, "substrate")

    # Waterproofing: use manual value if provided, else same as durock (wet areas)
    wp_type = sub.get("waterproof_type", "paint_on")
    # Backward compat: map old brand names to generic types
    _wp_migrate = {"redgard": "paint_on", "hydroban": "paint_on", "kerdi": "sheet"}
    wp_type = _wp_migrate.get(wp_type, wp_type)
    wp_sf = sub.get("waterproof_sf", 0) or durock_sf
    if wp_sf > 0 and wp_type != "none":
        wp_rate = SUBSTRATE_RATES.get(f"{wp_type}_per_sf", SUBSTRATE_RATES["paint_on_per_sf"])
        wp_label = {"paint_on": "Paint-on membrane", "sheet": "Sheet membrane"}.get(wp_type, wp_type)
        _add(line_items, 3, f"Waterproofing - {wp_label}", wp_sf, "SF",
             wp_rate * labor_mult, "substrate")

    # Subfloor repair — manual SF if specified, else auto-include when demo floor
    # Skip auto-include if repair_subfloor is explicitly set (handled separately below)
    has_explicit_repair_subfloor = getattr(estimate, 'repair_subfloor', False)
    subfloor_repair_sf = sub.get("subfloor_repair_sf") or 0
    subfloor_explicit = sub.get("subfloor_repair", None)
    if not has_explicit_repair_subfloor and subfloor_explicit is True and subfloor_repair_sf > 0:
        # Explicit: user specified repair area
        _add(line_items, 3, "Subfloor repair - partial (plywood)", subfloor_repair_sf, "SF",
             SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
             notes="Subfloor integrity verification + replacement as needed per industry standard")
    # Auto-include removed — subfloor repair only when explicitly checked

    # Self-leveling compound — auto-include when demo floor + tile install
    leveling_explicit = sub.get("self_leveling", None)
    leveling_sf = sub.get("self_leveling_sf") or 0
    if leveling_explicit is True and leveling_sf > 0:
        _add(line_items, 3, "Self-leveling compound", leveling_sf, "SF",
             SUBSTRATE_RATES["self_leveling_per_sf"] * labor_mult, "substrate")
    elif leveling_explicit is not False and demo_floor and replace_floor and tile_floor_sf > 0:
        _add(line_items, 3, "Self-leveling compound", tile_floor_sf, "SF",
             SUBSTRATE_RATES["self_leveling_per_sf"] * labor_mult, "substrate",
             notes="Level subfloor after old tile removal — "
                   "required for proper tile adhesion + prevent lippage")

    # Cement board replacement for the board demoed for water damage. Where the
    # wet-area cement board above goes in, it's the new board there already, so
    # only what it doesn't cover is a line of its own (none when it covers it all)
    cb_replace_sf = max(0, cb_repair_sf - durock_sf)
    if cb_replace_sf > 0:
        _add(line_items, 3,
             "Cement board replacement - water damage repair (partial)",
             cb_replace_sf, "SF",
             SUBSTRATE_RATES["durock_per_sf"] * labor_mult,
             "substrate",
             notes=(f"Damaged board beyond the {durock_sf:.0f} SF of wet-area cement "
                    "board above — " if durock_sf > 0 else
                    "Separate from wet-area/floor cement board above — ")
                   + "replaces water-damaged section only, not full "
                   "re-installation. Replace section per code-compliant "
                   "installation; overlap to nearest studs; reuse "
                   "serviceable board")

    # ── Substrate Repair: Drywall & Subfloor ──
    # Wall drywall replacement (hang + tape + mud + sand + prime)
    if getattr(estimate, 'repair_drywall_walls', False):
        repair_wall_sf = getattr(estimate, 'repair_drywall_walls_sf', None) or demo_wall_sf
        if repair_wall_sf > 0:
            use_moisture = estimate.water_damage or estimate.mold_suspected
            rate_key = "drywall_replace_moisture_per_sf" if use_moisture else "drywall_replace_per_sf"
            board_label = "moisture-resistant" if use_moisture else "standard"
            board_note = 'Greenboard per code for wet area' if use_moisture else 'Standard 1/2" drywall'
            _add(line_items, 3,
                 f"Drywall replacement - walls ({board_label})",
                 repair_wall_sf, "SF",
                 SUBSTRATE_RATES[rate_key] * labor_mult, "substrate",
                 notes=f"Hang + tape + mud + sand + prime | {board_note}")

    # Ceiling drywall replacement
    if getattr(estimate, 'repair_drywall_ceiling', False):
        repair_ceil_sf = getattr(estimate, 'repair_drywall_ceiling_sf', None) or floor_sf
        if repair_ceil_sf > 0:
            use_mold = estimate.water_damage or estimate.mold_suspected
            if use_mold:
                _add(line_items, 3,
                     "Drywall replacement - ceiling (moisture-resistant)",
                     repair_ceil_sf, "SF",
                     SUBSTRATE_RATES["mold_resistant_drywall_per_sf"] * labor_mult,
                     "substrate",
                     notes="Moisture-resistant drywall per code for wet area | Hang + tape + mud + prime")
            else:
                _add(line_items, 3,
                     "Drywall replacement - ceiling",
                     repair_ceil_sf, "SF",
                     SUBSTRATE_RATES["drywall_replace_per_sf"] * labor_mult,
                     "substrate",
                     notes="Standard 1/2\" drywall | Hang + tape + mud + prime")

    # Subfloor replacement (explicit repair flag)
    if getattr(estimate, 'repair_subfloor', False):
        repair_floor_sf = getattr(estimate, 'repair_subfloor_sf', None) or floor_sf
        if repair_floor_sf > 0:
            _add(line_items, 3,
                 "Subfloor repair - partial (plywood)",
                 repair_floor_sf, "SF",
                 SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
                 notes="Plywood replacement per code-compliant installation + fasteners")

    # ── Insulation: Demo + Install ──
    walls_spec = estimate.walls_spec or {}
    ins_type = walls_spec.get("insulation_type", "fiberglass_batt")
    ins_r_value = walls_spec.get("insulation_r_value", 13)

    # Insulation demo - walls
    if getattr(estimate, 'demo_insulation_walls', False):
        demo_ins_wall_sf = getattr(estimate, 'demo_insulation_walls_sf', None) or 0
        if demo_ins_wall_sf > 0:
            _add(line_items, 1,
                 "Demo insulation - walls",
                 demo_ins_wall_sf, "SF",
                 SUBSTRATE_RATES["insulation_demo_per_sf"] * labor_mult, "demo",
                 notes="Remove existing wall insulation + disposal")

    # Insulation demo - ceiling
    if getattr(estimate, 'demo_insulation_ceiling', False):
        demo_ins_ceil_sf = getattr(estimate, 'demo_insulation_ceiling_sf', None) or 0
        if demo_ins_ceil_sf > 0:
            _add(line_items, 1,
                 "Demo insulation - ceiling",
                 demo_ins_ceil_sf, "SF",
                 SUBSTRATE_RATES["insulation_demo_per_sf"] * labor_mult, "demo",
                 notes="Remove existing ceiling insulation + disposal")

    # Insulation install - walls
    if getattr(estimate, 'install_insulation_walls', False):
        inst_wall_sf = getattr(estimate, 'install_insulation_walls_sf', None) or 0
        if inst_wall_sf > 0:
            ins_rate_key = f"insulation_{ins_type}_per_sf"
            ins_rate = SUBSTRATE_RATES.get(ins_rate_key, SUBSTRATE_RATES["insulation_fiberglass_batt_per_sf"])
            ins_label = ins_type.replace("_", " ").title()
            _add(line_items, 3,
                 f"Install insulation - walls ({ins_label}, R-{ins_r_value})",
                 inst_wall_sf, "SF",
                 ins_rate * labor_mult, "substrate",
                 notes=f"{ins_label} R-{ins_r_value} | Supply + install")

    # Insulation install - ceiling
    if getattr(estimate, 'install_insulation_ceiling', False):
        inst_ceil_sf = getattr(estimate, 'install_insulation_ceiling_sf', None) or 0
        if inst_ceil_sf > 0:
            ins_rate_key = f"insulation_{ins_type}_per_sf"
            ins_rate = SUBSTRATE_RATES.get(ins_rate_key, SUBSTRATE_RATES["insulation_fiberglass_batt_per_sf"])
            ins_label = ins_type.replace("_", " ").title()
            _add(line_items, 3,
                 f"Install insulation - ceiling ({ins_label}, R-{ins_r_value})",
                 inst_ceil_sf, "SF",
                 ins_rate * labor_mult, "substrate",
                 notes=f"{ins_label} R-{ins_r_value} | Supply + install")

    # ────────────────────────────────────────
    # Phase 4: Tile & Flooring
    # ────────────────────────────────────────
    # Floor tile (consolidated: material + labor + supplies → 1 item)
    floor_spec = estimate.floor_spec or {}
    if not replace_floor and demo_floor and tile_floor_sf > 0:
        # Floor is being demoed but no replacement material specified —
        # flag as TBD so the estimator doesn't miss it.
        _add(line_items, 4, "Floor finish - NOT SPECIFIED (TBD)",
             tile_floor_sf, "SF", 0, "tile",
             notes=(
                 "Floor demo is included but finish material has not been "
                 "selected. Please specify floor tile/flooring to complete "
                 "this section (existing finish kept or new material)."
             ))
    if replace_floor and tile_floor_sf > 0:
        tile_mat = picks.tile_material("floor_tile", floor_spec.get("material", "porcelain"))
        pattern = floor_spec.get("pattern", "straight")
        tile_size = picks.tile_size("floor_tile") or floor_spec.get("size", "12x12")
        _pick = picks.per_sf("floor_tile")
        mat_rate = apply_material_handling(TILE_MATERIAL_RATES.get(
            tile_mat, TILE_MATERIAL_RATES["porcelain"]) if _pick is None else _pick)
        ft_name, ft_allow = (tile_mat, " allowance") if _pick is None else (picks.name("floor_tile"), "")
        labor_rate = TILE_LABOR_RATES["floor_per_sf"] * labor_mult
        complexity_mult = get_tile_complexity_multiplier(pattern, tile_size)
        waste = get_tile_waste(pattern, tile_size)

        ft_mat_cost = round(
            tile_floor_sf * (1 + waste) * mat_rate, 2)
        ft_labor_cost = round(
            tile_floor_sf * labor_rate * complexity_mult, 2)
        ft_sealer_cost = 0
        if tile_mat == "natural_stone":
            ft_sealer_cost = round(
                tile_floor_sf * TILE_EXTRAS["sealer_per_sf"], 2)

        ft_total = (ft_mat_cost + ft_labor_cost + ft_sealer_cost)

        ft_parts = [
            f"Material: {ft_name} ${mat_rate:.2f}/SF{ft_allow}, "
            f"{tile_floor_sf*(1+waste):.0f}SF ${ft_mat_cost:,.2f} "
            f"(incl {int(waste*100)}% waste)",
            f"Install: {pattern} ${ft_labor_cost:,.2f} "
            f"(incl. thinset, grout, setting supplies)",
        ]
        if ft_sealer_cost:
            ft_parts.append(f"Sealer: ${ft_sealer_cost:,.2f}")
        if tile_floor_sf < floor_sf:
            ft_parts.append(
                f"Tile area: {tile_floor_sf:.1f}SF "
                f"(total {floor_sf:.0f}SF minus fixture "
                f"footprints)")

        _add(line_items, 4,
             f"Floor tile complete - {ft_name} "
             f"({tile_size}, {pattern})",
             tile_floor_sf, "SF",
             round(ft_total / tile_floor_sf, 2), "tile",
             notes=" | ".join(ft_parts))

    # Shower wall tile (consolidated)
    shower_spec = estimate.shower_spec or {}
    _shower_tile_types = CUSTOM_TILE_SHOWER_TYPES
    _s_wall_mat = shower_spec.get("wall_material", "tile")
    _s_is_tile_shower = (
        estimate.replace_shower
        and shower_spec.get("type") in _shower_tile_types)
    # Floor tile + pan/pre-slope are needed whenever the shower TYPE is a
    # real tiled-floor build (custom_tile/curbless/neo_angle_custom), even
    # if the WALLS are a non-tile prefab surround (wall_material != "tile")
    # — floor and walls are independent selections in the sketch UI, and a
    # prefab-wall + tiled-pan-floor combo is a normal, user-reachable one.
    tile_spec = shower_spec.get("tile_spec", {})
    _s_layout = shower_spec.get("layout", "alcove")
    if _s_is_tile_shower and _s_wall_mat == "tile":
        shower_wall_sf = tile_spec.get("sf", 0)
        if not shower_wall_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get(
                "tile_height_in", 0) or 0
            if sw and sd and sh:
                if _s_layout in (
                        "neo_angle",
                        "neo_angle_right",
                        "corner",
                        "corner_right"):
                    # 2 walls only
                    shower_wall_sf = (
                        (sw + sd) * sh / 144)
                else:
                    shower_wall_sf = (
                        (sw + 2 * sd) * sh / 144)
        # Where the room's wall tile runs over the whole of a shower wall
        # (a wall tiled floor to ceiling), that wall is one tile: priced
        # with the wall tile below, not here
        s_with_wall = min(shower_wall_sf, shower_spec.get("tiled_with_wall_sf", 0) or 0)
        shower_wall_sf -= s_with_wall
        if shower_wall_sf > 0:
            stile_mat = picks.tile_material("shower_wall_tile", tile_spec.get("material", "porcelain"))
            spattern = tile_spec.get("pattern", "straight")
            stile_size = picks.tile_size("shower_wall_tile") or tile_spec.get("size", "12x12")
            _pick = picks.per_sf("shower_wall_tile")
            smat_rate = apply_material_handling(TILE_MATERIAL_RATES.get(
                stile_mat, TILE_MATERIAL_RATES["porcelain"]) if _pick is None else _pick)
            st_name, st_allow = (stile_mat, " allowance") if _pick is None else (picks.name("shower_wall_tile"), "")
            slabor_rate = TILE_LABOR_RATES["shower_wall_per_sf"] * labor_mult
            scomplexity_mult = get_tile_complexity_multiplier(
                spattern, stile_size)
            swaste = get_tile_waste(spattern, stile_size)
            st_mat_cost = round(shower_wall_sf * (1 + swaste) * smat_rate, 2)
            st_labor_cost = round(shower_wall_sf * slabor_rate * scomplexity_mult, 2)
            st_sealer_cost = 0
            if stile_mat == "natural_stone":
                st_sealer_cost = round(shower_wall_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            st_total = st_mat_cost + st_labor_cost + st_sealer_cost

            st_parts = [
                f"Material: {st_name} ${smat_rate:.2f}/SF{st_allow}, {shower_wall_sf*(1+swaste):.0f}SF ${st_mat_cost:,.2f} (incl {int(swaste*100)}% waste)",
                f"Install: {spattern} ${st_labor_cost:,.2f} (incl. thinset, grout, setting supplies)",
            ]
            if st_sealer_cost:
                st_parts.append(f"Sealer: ${st_sealer_cost:,.2f}")
            if s_with_wall:
                st_parts.append(f"Less {s_with_wall:.1f}SF tiled with the wall tile")

            _add(line_items, 4,
                 f"Shower wall tile complete - {st_name} ({stile_size}, {spattern})",
                 shower_wall_sf, "SF", round(st_total / shower_wall_sf, 2), "tile",
                 notes=" | ".join(st_parts))

    # Shower floor tile + pan/pre-slope — needed whenever the shower TYPE is
    # a real tiled-floor build, independent of wall_material (fixed 2026-08-26:
    # previously nested inside the wall-tile `if` above, so picking a non-tile
    # wall surround on a custom_tile/curbless shower silently dropped floor
    # tile, mortar pre-slope, and pan liner costs even though a real floor
    # still needs them)
    if _s_is_tile_shower:
        shower_floor_sf = 0
        sf_w = shower_spec.get("width_in", 0) or 0
        sf_d = shower_spec.get("depth_in", 0) or 0
        if sf_w and sf_d:
            if _s_layout in (
                    "neo_angle", "neo_angle_right"):
                # Pentagon: rect minus corner triangle
                cut_w = sf_w * 0.5
                cut_d = sf_d * 0.5
                shower_floor_sf = (
                    sf_w * sf_d
                    - 0.5 * cut_w * cut_d) / 144
            else:
                shower_floor_sf = sf_w * sf_d / 144

        if shower_floor_sf > 0:
            sf_tile_mat = picks.tile_material("shower_floor_tile", tile_spec.get("material", "porcelain"))
            sf_pattern = tile_spec.get("pattern", "straight")
            sf_tile_size = picks.tile_size("shower_floor_tile") or tile_spec.get("size", "12x12")
            _pick = picks.per_sf("shower_floor_tile")
            sf_mat_rate = apply_material_handling(TILE_MATERIAL_RATES.get(
                sf_tile_mat, TILE_MATERIAL_RATES["porcelain"]) if _pick is None else _pick)
            sft_name, sft_allow = (sf_tile_mat, " allowance") if _pick is None else (picks.name("shower_floor_tile"), "")
            sf_labor_rate = TILE_LABOR_RATES["shower_floor_per_sf"] * labor_mult
            sf_complexity_mult = get_tile_complexity_multiplier(
                sf_pattern, sf_tile_size)
            sf_waste = get_tile_waste(sf_pattern, sf_tile_size)

            sf_mat_cost = round(shower_floor_sf * (1 + sf_waste) * sf_mat_rate, 2)
            sf_labor_cost = round(shower_floor_sf * sf_labor_rate * sf_complexity_mult, 2)
            sf_sealer_cost = 0
            if sf_tile_mat == "natural_stone":
                sf_sealer_cost = round(shower_floor_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            sf_total = sf_mat_cost + sf_labor_cost + sf_sealer_cost

            sf_parts = [
                f"Material: {sft_name} ${sf_mat_rate:.2f}/SF{sft_allow}, {shower_floor_sf*(1+sf_waste):.0f}SF ${sf_mat_cost:,.2f} (incl {int(sf_waste*100)}% waste)",
                f"Install: {sf_pattern} ${sf_labor_cost:,.2f} (slope to drain, incl. thinset, grout, setting supplies)",
            ]
            if sf_sealer_cost:
                sf_parts.append(f"Sealer: ${sf_sealer_cost:,.2f}")

            _add(line_items, 4,
                 f"Shower floor tile complete - {sft_name} ({sf_tile_size}, {sf_pattern})",
                 shower_floor_sf, "SF", round(sf_total / shower_floor_sf, 2), "tile",
                 notes=" | ".join(sf_parts))

        # Shower pan liner + pre-slope (required for custom tile / curbless)
        shower_floor_w = shower_spec.get("width_in", 0) or 0
        shower_floor_d = shower_spec.get("depth_in", 0) or 0
        pan_sf = (shower_floor_w * shower_floor_d / 144) if (shower_floor_w and shower_floor_d) else 0
        if pan_sf > 0:
            pan_preslope = round(pan_sf * SHOWER_PAN_COSTS["mortar_preslope_per_sf"] * labor_mult, 2)
            pan_liner = round(SHOWER_PAN_COSTS["pan_liner"] * labor_mult, 2)
            pan_curb_wp = (
                0 if is_curbless(stype)
                else round(
                    SHOWER_PAN_COSTS["curb_waterproof"] * labor_mult, 2)
            )
            pan_total = pan_preslope + pan_liner + pan_curb_wp

            pan_parts = [
                f"Mortar pre-slope {pan_sf:.1f}SF ${pan_preslope:,.2f}",
                f"PVC liner + drain ${pan_liner:,.2f}",
            ]
            if pan_curb_wp:
                pan_parts.append(f"Curb waterproof ${pan_curb_wp:,.2f}")

            _add(line_items, 3,
                 "Shower pan (pre-slope + liner + drain)",
                 1, "LS", pan_total, "substrate",
                 notes=" | ".join(pan_parts))

    # Bathtub surround tile (consolidated: material + labor + supplies → 1 item)
    # Uses sketch fixture dimensions when available for accurate wall tile calc
    tub_spec = estimate.bathtub_spec or {}
    sketch = estimate.sketch_data or {}
    sk_fixtures = sketch.get("fixtures", [])
    sk_tub = next((f for f in sk_fixtures if f.get("type") == "bathtub"), None)

    # Determine if surround tile is needed:
    # 1) sketch hasSurround property, or 2) legacy surround_tile flag in spec
    has_surround = False
    if sk_tub:
        has_surround = sk_tub.get("properties", {}).get("hasSurround", False)
    if not has_surround:
        has_surround = tub_spec.get("surround_tile", False)

    if has_surround and tub_spec.get("type") not in (None, "none", "freestanding"):
        surround_sf = tub_spec.get("surround_tile_sf", 0)
        # Always resolve dimensions for notes (even if surround_sf is manual)
        if sk_tub:
            sk_dims = sk_tub.get("dimensions", {})
            sk_props = sk_tub.get("properties", {})
            dim_a = sk_dims.get("width", 60)
            dim_b = sk_dims.get("height", 32)
            # Tub length is always the longer side, depth the shorter
            tl = max(dim_a, dim_b)
            td = min(dim_a, dim_b)
            sh = sk_props.get("surroundHeight", 60)
            wall_count = sk_props.get("surroundWallCount", 3)
        else:
            raw_l = tub_spec.get("tub_length_in", 0) or 60
            raw_d = tub_spec.get("tub_depth_in", 0) or 32
            tl = max(raw_l, raw_d)
            td = min(raw_l, raw_d)
            sh = tub_spec.get("surround_height_in", 0) or 60
            wall_count = tub_spec.get("surround_wall_count", 3) or 3
        # Auto-calculate SF from dimensions if not manually provided
        if not surround_sf and tl and sh:
            if wall_count >= 3:
                surround_sf = (tl + 2 * td) * sh / 144
            elif wall_count == 2:
                surround_sf = (tl + td) * sh / 144
            else:
                surround_sf = tl * sh / 144
        # The part the room's wall tile runs over is that wall tile
        t_with_wall = min(surround_sf, tub_spec.get("tiled_with_wall_sf", 0) or 0)
        surround_whole_sf = surround_sf
        surround_sf -= t_with_wall
        if surround_sf > 0:
            sur_mat = picks.tile_material("shower_wall_tile", tub_spec.get("surround_tile_material", "porcelain"))
            sur_pattern = tub_spec.get("surround_tile_pattern", "straight")
            sur_size = picks.tile_size("shower_wall_tile") or tub_spec.get("surround_tile_size", "12x12")
            _pick = picks.per_sf("shower_wall_tile")
            sur_mat_rate = apply_material_handling(TILE_MATERIAL_RATES.get(
                sur_mat, TILE_MATERIAL_RATES["porcelain"]) if _pick is None else _pick)
            sur_name, sur_allow = (sur_mat, " allowance") if _pick is None else (picks.name("shower_wall_tile"), "")
            sur_labor_rate = BATHTUB_EXTRAS["surround_tile_labor_per_sf"] * labor_mult
            sur_complexity_mult = get_tile_complexity_multiplier(
                sur_pattern, sur_size)
            sur_waste = get_tile_waste(sur_pattern, sur_size)

            bt_mat_cost = round(surround_sf * (1 + sur_waste) * sur_mat_rate, 2)
            bt_labor_cost = round(surround_sf * sur_labor_rate * sur_complexity_mult, 2)
            bt_sealer_cost = 0
            if sur_mat == "natural_stone":
                bt_sealer_cost = round(surround_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            bt_total = bt_mat_cost + bt_labor_cost + bt_sealer_cost

            # Build wall dimension note
            wall_dim_note = f"{wall_count} walls: {tl:.0f}\"L × {td:.0f}\"D × {sh:.0f}\"H = {surround_whole_sf:.1f}SF"
            if t_with_wall:
                wall_dim_note += f", less {t_with_wall:.1f}SF tiled with the wall tile = {surround_sf:.1f}SF"

            bt_parts = [
                wall_dim_note,
                f"Material: {sur_name} ${sur_mat_rate:.2f}/SF{sur_allow}, {surround_sf*(1+sur_waste):.0f}SF ${bt_mat_cost:,.2f} (incl {int(sur_waste*100)}% waste)",
                f"Install: {sur_pattern} ${bt_labor_cost:,.2f} (incl. thinset, grout, setting supplies)",
            ]
            if bt_sealer_cost:
                bt_parts.append(f"Sealer: ${bt_sealer_cost:,.2f}")

            _add(line_items, 4,
                 f"Bathtub surround tile complete - {sur_name} ({sur_size}, {sur_pattern})",
                 surround_sf, "SF", round(bt_total / surround_sf, 2), "tile",
                 notes=" | ".join(bt_parts))

    # Bathtub deck tile (platform top surface)
    if estimate.replace_tub and tub_spec.get("deck_tile"):
        deck_sf = tub_spec.get("deck_tile_sf", 0) or 0
        deck_sides = tub_spec.get("deck_tile_sides", 2)
        deck_w_in = tub_spec.get("deck_width_in", 0) or 0
        if deck_sf > 0:
            _dk_notes = [
                f"Deck top surface — {deck_sides} exposed"
                f" side(s), {deck_w_in}\" wide",
                "Includes bullnose edge trim",
            ]
            _add(line_items, 4,
                 f"Bathtub deck tile ({deck_sides} sides)",
                 deck_sf, "SF",
                 round(14.00 * labor_mult, 2), "tile",
                 notes=" | ".join(_dk_notes))

    # Bathtub front panel tile (vertical face)
    if estimate.replace_tub and tub_spec.get("front_panel_tile"):
        panel_sf = tub_spec.get("front_panel_sf", 0) or 0
        deck_h_in = tub_spec.get("deck_height_in", 0) or 0
        if panel_sf > 0:
            _add(line_items, 4,
                 "Bathtub front panel tile",
                 panel_sf, "SF",
                 round(16.00 * labor_mult, 2), "tile",
                 notes=f"Vertical face of deck/platform"
                       f" — {deck_h_in}\" height")

    if floor_spec.get("heated_floor") and tile_floor_sf > 0:
        _add(line_items, 4, "Heated floor mat + installation", tile_floor_sf, "SF",
             ELECTRICAL_RATES["heated_floor_per_sf"] * labor_mult, "electrical")
        _add(line_items, 4, "Heated floor thermostat", 1, "EA",
             ELECTRICAL_RATES["heated_floor_thermostat"], "electrical")
        _add(line_items, 4, "Dedicated 20A circuit for heated floor", 1, "EA",
             ELECTRICAL_RATES["heated_floor_circuit"] * labor_mult, "electrical")

    # ────────────────────────────────────────
    # Phase 5: Fixtures Install
    # ────────────────────────────────────────

    # Bathtub (consolidated into single line item)
    tub_spec = estimate.bathtub_spec or {}
    if estimate.replace_tub and tub_spec.get("type") and tub_spec["type"] != "none":
        tub_type = tub_spec["type"]
        tub_mat = picks.tub_material(tub_spec.get("material", "acrylic"))
        tub_prices = BATHTUB_PRICES.get(tub_type, BATHTUB_PRICES["alcove"])
        _pick = picks.each("bathtub")
        tub_price = apply_material_handling(
            tub_prices.get(tub_mat, tub_prices["acrylic"]) if _pick is None else _pick)
        tub_type_label = tub_type.replace("_", " ").title()
        tub_mat_label = tub_mat.replace("_", " ").title()

        tub_install = round(
            BATHTUB_INSTALL.get(tub_type, BATHTUB_INSTALL["alcove"]) * labor_mult, 2)
        tub_jetted = 0
        if tub_spec.get("jetted"):
            tub_jetted = BATHTUB_EXTRAS["whirlpool_upgrade"]

        # The tub's faucet is its own line (Tub faucet - R&R, below)

        # Drain/overflow assembly — new tub needs new drain kit
        tub_drain = round(BATHTUB_EXTRAS["drain_overflow_kit"] * labor_mult, 2)

        # Mortar bed — required for acrylic/fiberglass tubs to prevent flex/cracking
        # Cast iron tubs are self-supporting (heavy enough), skip mortar bed
        tub_mortar = 0
        if tub_mat not in ("cast_iron",):
            tub_mortar = round(BATHTUB_EXTRAS["mortar_bed"] * labor_mult, 2)

        tub_combined = (tub_price + tub_install
                        + tub_jetted + tub_drain + tub_mortar)

        tub_parts = [
            f"Unit: {tub_mat_label} ${tub_price:,.2f} allowance" if _pick is None
            else f"Unit: {picks.name('bathtub')} ${tub_price:,.2f}",
            f"Install: ${tub_install:,.2f}",
        ]
        tub_parts.append(f"Drain/overflow kit: ${tub_drain:,.2f}")
        if tub_mortar:
            tub_parts.append(f"Mortar bed: ${tub_mortar:,.2f}")
        if tub_jetted:
            tub_parts.append(f"Whirlpool upgrade: ${tub_jetted:,.2f}")

        _add(line_items, 5,
             f"Bathtub complete - {tub_type_label} ({tub_mat_label})" if _pick is None
             else f"Bathtub complete - {picks.name('bathtub')}",
             1, "EA", tub_combined, "fixture",
             notes=" | ".join(tub_parts))

    # ── Tub spout/diverter valve (surround tile → wall open) ──
    # Triggered whenever the tub has surround tile being opened up, regardless
    # of whether a separate shower is also being replaced (estimate.replace_shower).
    # Controllable via hidden_costs.auto_tub_valve (default: True)
    _tub_action = estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False)
    if _tub_action:
        _tub_type_v = tub_spec.get("type", "alcove")
        _has_tub_surround = tub_spec.get("surround_tile", False)
        if not _has_tub_surround and sk_tub:
            _has_tub_surround = sk_tub.get("properties", {}).get("hasSurround", False)

        # Some tubs have no faucet/valve on the surround wall at all (spout
        # elsewhere, deck-mount, etc.) — opening that tile shouldn't trigger
        # a valve replacement recommendation. Defaults true (existing behavior).
        _has_faucet_on_wall = tub_spec.get("has_faucet", True)
        if "has_faucet" not in tub_spec and sk_tub:
            _has_faucet_on_wall = sk_tub.get("properties", {}).get("hasFaucet", True)

        _valve_eligible = (_has_tub_surround
                           and _has_faucet_on_wall
                           and _tub_type_v not in ("freestanding", "none", None))
        _valve_enabled = hc.get("auto_tub_valve", True)
        # This is always the bathtub's OWN surround-wall valve (the tub's
        # wall typically carries its own valve + showerhead, whether or not
        # a separate walk-in shower elsewhere is also being replaced).
        # Labeled "Bathtub surround" — not "tub/shower combo" — since that
        # older wording read as "one physical combo unit" and got confused
        # with the shower's own trim-kit line when tub + shower are two
        # separate fixtures in the same job.
        _is_combo = bool(estimate.replace_shower)
        _valve_item_label = (
            "Bathtub surround valve + trim kit replacement"
            if _is_combo else
            "Tub spout/diverter valve replacement (surround tile — wall open)"
        )
        _valve_body_only_label = (
            "Bathtub surround valve replacement"
            if _is_combo else
            "Tub spout/diverter valve replacement (surround tile — wall open)"
        )
        _valve_excluded_warning = (
            "Bathtub surround valve excluded by user — "
            if _is_combo else
            "Tub spout/diverter valve excluded by user — "
        )

        # The shower head and hand shower are lines of their own (below), as
        # the person chose them; the valve line no longer carries the head
        _valve_trim_billed = False  # the valve's trim kit brings the spout + handle
        if _valve_eligible and plumber_fixed_tub:
            warnings.append(
                (f"{_valve_item_label}: plumber already replaced "
                 f"(water damage repair) — excluded from estimate")
            )
        elif _valve_eligible and _valve_enabled:
            _excl_trim = hc.get("exclude_trim_kit", False)
            if _excl_trim:
                # Valve body only — trim kit excluded (insurance denial)
                _body_only = (BATHTUB_EXTRAS["shower_valve_body_trim"]
                              - BATHTUB_EXTRAS["shower_valve_trim_only"])
                valve_cost = round(_body_only * labor_mult, 2)
                _add(line_items, 5,
                     _valve_body_only_label,
                     1, "EA", valve_cost, "plumbing",
                     notes=f"Valve body only ${valve_cost:,.2f} (trim kit excluded) | "
                           f"Replace while wall is open to prevent future leak")
            else:
                valve_cost = round(BATHTUB_EXTRAS["shower_valve_body_trim"] * labor_mult, 2)
                _valve_trim_billed = True
                _add(line_items, 5,
                     _valve_item_label,
                     1, "EA", valve_cost, "plumbing",
                     notes=f"Pressure-balance valve body + trim ${valve_cost:,.2f} | "
                           f"Replace while wall is open to prevent future leak")
        elif _valve_eligible and not _valve_enabled:
            warnings.append(
                _valve_excluded_warning +
                "trim only (valve body retained). "
                "⚠ Strongly recommend replacing valve body while wall is open; "
                "future leak would require removing new tile."
            )

    # ── Tub faucet, shower head, hand shower ──
    # The faucet is always removed and replaced; the shower head and the hand
    # shower on its hose, when the tub has them, are detached and reset or
    # replaced as the person chose (tub_spec showerhead_action /
    # handheld_action: none, detach_reset, replace).
    if _tub_action and (tub_spec.get("type") or "alcove") != "none":
        _tub_type_f = tub_spec.get("type") or "alcove"
        _faucet_kind = ("freestanding" if _tub_type_f == "freestanding"
                        else "wall" if _has_faucet_on_wall else "deck")
        _faucet_label = {
            "wall": "Tub faucet (spout + handle trim) - R&R",
            "deck": "Tub faucet (deck-mount) - R&R",
            "freestanding": "Tub filler faucet (freestanding) - R&R",
        }[_faucet_kind]
        if plumber_fixed_tub:
            warnings.append(f"{_faucet_label}: plumber already replaced "
                            "(water damage repair) — excluded from estimate")
        else:
            _faucet_labor = round(PLUMBING_RATES["tub_faucet_install"] * labor_mult, 2)
            if _valve_trim_billed and _faucet_kind == "wall":
                # The new spout and handle come in the valve's trim kit
                _add(line_items, 5, _faucet_label, 1, "EA", _faucet_labor, "plumbing",
                     notes=f"Remove old spout + handle, install new ${_faucet_labor:,.2f} | "
                           "New spout + handle trim come with the valve's trim kit")
            else:
                _faucet_mat = apply_material_handling(TUB_FAUCET_PRICES[_faucet_kind])
                _add(line_items, 5, _faucet_label, 1, "EA",
                     round(_faucet_mat + _faucet_labor, 2), "plumbing",
                     notes=f"Faucet ${_faucet_mat:,.2f} allowance | "
                           f"Remove old, install new, connect, test ${_faucet_labor:,.2f}")

        _head_labor = round(BATHTUB_EXTRAS["showerhead_install"] * labor_mult, 2)
        for _key, _name, _price_key in (
                ("showerhead_action", "Shower head", "standard"),
                ("handheld_action", "Hand shower & hose", "handheld")):
            _act = tub_spec.get(_key, "none")
            if _act == "detach_reset":
                _add(line_items, 5, f"{_name} - Detach & Reset", 1, "EA",
                     _head_labor, "plumbing",
                     notes="Labor only: remove, store, reinstall (existing)")
            elif _act == "replace":
                _head_mat = apply_material_handling(SHOWERHEAD_PRICES[_price_key])
                _add(line_items, 5, f"{_name} - R&R", 1, "EA",
                     round(_head_mat + _head_labor, 2), "plumbing",
                     notes=f"{_name} ${_head_mat:,.2f} allowance | "
                           f"Remove old, install new ${_head_labor:,.2f}")

    # Shower (consolidated: body → 1 item, door → 1 item, max 2 items)
    if estimate.replace_shower:
        stype = shower_spec.get("type", "one_piece")
        shower_total = 0
        shower_parts = []

        # --- Unit (insert) or custom tile extras ---
        if stype in ("one_piece", "multi_piece_kit"):
            insert_price = apply_material_handling(
                SHOWER_INSERT_PRICES.get(
                    stype, SHOWER_INSERT_PRICES["one_piece"]))
            insert_install = round(
                FLAT_PRICES["SHOWER_INSERT_INSTALL"] * labor_mult, 2)
            shower_total += insert_price + insert_install
            shower_parts.append(
                f"Unit: {stype.replace('_', ' ')} "
                f"${insert_price:,.2f}")
            shower_parts.append(
                f"Install: ${insert_install:,.2f}")

        elif stype == "neo_angle_kit":
            # Complete neo-angle kit (base+walls+door)
            s_w = shower_spec.get("width_in", 36) or 36
            kit_grade = shower_spec.get(
                "neo_angle_kit_grade", "basic_fiberglass")
            kit_prices = NEO_ANGLE_KIT_PRICES.get(
                kit_grade, {})
            sizes = sorted(kit_prices.keys()) if kit_prices else [36]
            sz = min(sizes, key=lambda x: abs(x - s_w))
            kit_price = apply_material_handling(kit_prices.get(sz, 900))
            kit_install = round(
                FLAT_PRICES["NEO_ANGLE_KIT_INSTALL"] * labor_mult, 2)
            shower_total += kit_price + kit_install
            grade_label = kit_grade.replace("_", " ")
            shower_parts.append(
                f"Neo-angle kit ({grade_label}, {sz}\"): "
                f"${kit_price:,.2f}")
            shower_parts.append(
                f"Kit install: ${kit_install:,.2f}")

        elif stype == "neo_angle_custom":
            # Neo-angle custom: separate base + wall + door
            s_w = shower_spec.get("width_in", 36) or 36
            wall_mat = shower_spec.get(
                "wall_material", "tile")

            # Base pan
            base_sizes = sorted(NEO_ANGLE_BASE_PRICES.keys())
            bsz = min(base_sizes, key=lambda x: abs(x - s_w))
            base_price = apply_material_handling(
                NEO_ANGLE_BASE_PRICES.get(bsz, 220))
            base_install = round(
                FLAT_PRICES["NEO_ANGLE_BASE_INSTALL"] * labor_mult, 2)
            shower_total += base_price + base_install
            shower_parts.append(
                f"Neo-angle base ({bsz}\"): "
                f"${base_price:,.2f}")
            shower_parts.append(
                f"Base install: ${base_install:,.2f}")

            # Wall surround (if not tile)
            if wall_mat != "tile":
                ws_prices = NEO_ANGLE_WALL_SURROUND_PRICES.get(
                    wall_mat, {})
                ws_sizes = sorted(ws_prices.keys()) if ws_prices else [36]
                wsz = min(ws_sizes, key=lambda x: abs(x - s_w))
                ws_price = apply_material_handling(
                    ws_prices.get(wsz, 325))
                ws_install = round(
                    FLAT_PRICES["NEO_ANGLE_WALL_SURROUND_INSTALL"]
                    * labor_mult, 2)
                shower_total += ws_price + ws_install
                ws_label = wall_mat.replace("_", " ")
                shower_parts.append(
                    f"Wall surround ({ws_label}): "
                    f"${ws_price:,.2f}")
                shower_parts.append(
                    f"Surround install: ${ws_install:,.2f}")

            # Custom tile extras (niches, bench, curb)
            niches = shower_spec.get("niches", 0)
            if niches > 0:
                niche_cost = round(
                    niches
                    * SHOWER_CUSTOM_EXTRAS["niche_each"]
                    * labor_mult, 2)
                shower_total += niche_cost
                shower_parts.append(
                    f"Niche x{niches}: ${niche_cost:,.2f}")
            if shower_spec.get("bench"):
                bench_len = shower_spec.get("bench_length", 36)
                bench_pos = shower_spec.get("bench_position", "left")
                bench_cost = round(
                    SHOWER_CUSTOM_EXTRAS["bench"]
                    * (bench_len / 36)
                    * labor_mult, 2)
                shower_total += bench_cost
                shower_parts.append(
                    f"Bench {bench_len}″ ({bench_pos}): "
                    f"${bench_cost:,.2f}")
            curb_cost = round(
                SHOWER_CUSTOM_EXTRAS["curb"]
                * labor_mult, 2)
            shower_total += curb_cost
            shower_parts.append(
                f"Curb: ${curb_cost:,.2f}")

        if stype in CUSTOM_TILE_SHOWER_TYPES:
            niches = shower_spec.get("niches", 0)
            if niches > 0:
                niche_cost = round(
                    niches
                    * SHOWER_CUSTOM_EXTRAS["niche_each"]
                    * labor_mult, 2)
                shower_total += niche_cost
                shower_parts.append(
                    f"Niche x{niches}: ${niche_cost:,.2f}")
            if shower_spec.get("bench"):
                bench_len = shower_spec.get("bench_length", 36)
                bench_pos = shower_spec.get("bench_position", "left")
                bench_cost = round(
                    SHOWER_CUSTOM_EXTRAS["bench"]
                    * (bench_len / 36)
                    * labor_mult, 2)
                shower_total += bench_cost
                shower_parts.append(
                    f"Bench {bench_len}″ ({bench_pos}): "
                    f"${bench_cost:,.2f}")
            if is_curbless(stype):
                # §9-1: floor system and linear drain are SEPARATE costs.
                # Charging one blended figure either understated the subfloor
                # work (old 715) or double-counted the drain.
                floor_cost = round(
                    get_curbless_floor_cost(stype) * labor_mult, 2)
                shower_total += floor_cost
                _sub = ("slab core-cut + re-pour"
                        if stype == "curbless_slab"
                        else "subfloor recess + extended waterproofing")
                shower_parts.append(
                    f"Curbless floor system ({_sub}): ${floor_cost:,.2f}")

                _drain_grade = shower_spec.get("linear_drain_grade",
                                               "standard")
                _drain_key = ("linear_drain_premium"
                              if _drain_grade == "premium"
                              else "linear_drain_standard")
                # Drain assembly is SKU material — handling applies, but not
                # the regional labor multiplier (§0-3: material is national).
                drain_cost = apply_material_handling(
                    SHOWER_CUSTOM_EXTRAS[_drain_key])
                shower_total += drain_cost
                shower_parts.append(
                    f"Linear drain ({_drain_grade}): ${drain_cost:,.2f}")
            else:
                curb_cost = round(
                    SHOWER_CUSTOM_EXTRAS["curb"]
                    * labor_mult, 2)
                shower_total += curb_cost
                shower_parts.append(
                    f"Curb: ${curb_cost:,.2f}")

        # --- Showerhead ---
        # Action choice: 'replace' (buy new, default — matches prior behavior)
        # or 'detach_reset' (reuse the existing showerhead, labor only).
        _sh_action = shower_spec.get("showerhead_action", "replace")
        if _sh_action == "detach_reset":
            sh_dr_cost = round(BATHTUB_EXTRAS["showerhead_install"] * labor_mult, 2)
            shower_total += sh_dr_cost
            shower_parts.append(
                f"Showerhead: detach & reset (existing) — labor only "
                f"${sh_dr_cost:,.2f}")
        elif _sh_action != "none":
            sh_type = shower_spec.get("showerhead_type", "standard")
            sh_price = apply_material_handling(
                SHOWERHEAD_PRICES.get(sh_type, SHOWERHEAD_PRICES["standard"]))
            grade_mult = TRIM_GRADE_MULTIPLIER.get(shower_spec.get("trim_grade", "mid"), 1.0)
            sh_cost = round(sh_price * grade_mult, 2)
            shower_total += sh_cost
            shower_parts.append(f"Showerhead: {sh_type} ${sh_cost:,.2f}")

        # --- Valve (skip if plumber already repaired shower plumbing) ---
        _sh_valve_enabled = hc.get("auto_shower_valve", True)
        _excl_trim_sh = hc.get("exclude_trim_kit", False)
        if plumber_fixed_shower:
            shower_parts.append("Valve/trim: plumber already replaced (excluded)")
        elif not _sh_valve_enabled:
            # User disabled shower valve — trim only (skip if trim excluded)
            if stype in CUSTOM_TILE_SHOWER_TYPES and not _excl_trim_sh:
                trim_cost = round(
                    PLUMBING_RATES["shower_valve_trim"] * labor_mult, 2
                )
                shower_total += trim_cost
                shower_parts.append(
                    f"Trim only (valve body retained): ${trim_cost:,.2f}"
                )
            warnings.append(
                "Shower valve excluded by user — "
                "trim only (valve body retained). "
                "⚠ Strongly recommend replacing valve body while wall is open; "
                "future leak would require removing new tile."
            )
        elif shower_spec.get("valve_replace"):
            valve_type = (
                "thermostatic"
                if shower_spec.get("trim_grade") == "premium"
                else "pressure_balance"
            )
            # Material only — no regional labor multiplier (§0-3):
            # material prices are national, only labor varies by zip.
            valve_cost = apply_material_handling(
                SHOWER_VALVE_PRICES.get(
                    valve_type, SHOWER_VALVE_PRICES["pressure_balance"])
            )
            shower_total += valve_cost
            vt_label = valve_type.replace('_', ' ')
            if _excl_trim_sh:
                shower_parts.append(
                    f"Valve body: {vt_label} ${valve_cost:,.2f} (trim kit excluded)"
                )
            else:
                shower_parts.append(
                    f"Valve body + trim: {vt_label} ${valve_cost:,.2f}"
                )
        elif stype in CUSTOM_TILE_SHOWER_TYPES and not _excl_trim_sh:
            # Trim-only (retain existing valve body)
            trim_cost = round(
                PLUMBING_RATES["shower_valve_trim"] * labor_mult, 2
            )
            shower_total += trim_cost
            shower_parts.append(
                f"Trim only (valve body retained): "
                f"${trim_cost:,.2f}"
            )

        # --- Trim install (when valve replaced, skip if trim excluded) ---
        if shower_spec.get("valve_replace") and not _excl_trim_sh:
            trim_cost = round(
                PLUMBING_RATES["shower_valve_trim"] * labor_mult, 2
            )
            shower_total += trim_cost
            shower_parts.append(
                f"Trim install labor: ${trim_cost:,.2f}"
            )

        stype_label = stype.replace("_", " ")
        _add(line_items, 5,
             f"Shower complete - {stype_label}",
             1, "EA", shower_total, "fixture",
             notes=" | ".join(shower_parts))

        # --- Shower door (separate line item) ---
        door_type = shower_spec.get("door_type")
        door_width = shower_spec.get("door_width_in", 0) or 0
        s_w_door = shower_spec.get("width_in", 36) or 36

        # Legacy `enclosure` field → canonical door_type (§7-3).
        # The old SHOWER_ENCLOSURE_PRICES table priced the same selections
        # differently from SHOWER_DOOR_PRICES (e.g. frameless $1,928 vs $985
        # material), so an estimate written with the old field priced higher
        # than an identical one using door_type. Map it onto the single
        # canonical path instead of keeping a second price list.
        if not door_type:
            _legacy_enc = shower_spec.get("enclosure")
            if _legacy_enc:
                door_type = _LEGACY_ENCLOSURE_MAP.get(_legacy_enc)
                if door_type and not door_width:
                    door_width = s_w_door

        # Fixed glass panel — computed here (before the door is priced) so
        # its cost can fold into the door line below: a fixed side panel is
        # installed as part of the same glass-shop job as the door, not
        # billed as its own separate line.
        panel_cfg = shower_spec.get("fixed_panel_config", "none")
        panel_layout = shower_spec.get("layout", "alcove")
        panel_s_w = shower_spec.get("width_in", 36) or 36
        panel_s_d = shower_spec.get("depth_in", 36) or 36
        panel_width_in = 0
        panel_count = 0
        if panel_layout in ("corner", "corner_right"):
            # Corner: one full side is glass (no additional front panels)
            panel_width_in += panel_s_d
            panel_count += 1
        elif shower_spec.get("door_position") in ("left", "right") and door_width:
            # Alcove, door against one side: one panel across the rest
            if panel_cfg != "none" and panel_s_w > door_width:
                panel_width_in += panel_s_w - door_width
                panel_count += 1
        else:
            # Alcove: front fixed panels from config
            if panel_cfg in ("left", "both"):
                panel_width_in += panel_s_w * 0.25
                panel_count += 1
            if panel_cfg in ("right", "both"):
                panel_width_in += panel_s_w * 0.25
                panel_count += 1
        # The glass is as tall as the sketch sets it, apart from the wall tile
        panel_h_in = shower_spec.get("door_height_in", 0) or 72
        panel_sf = round(panel_width_in * panel_h_in / 144, 1) if panel_count > 0 and panel_width_in > 0 else 0
        panel_cost = round(25.00 * panel_sf * labor_mult, 2) if panel_sf > 0 else 0
        panel_merged = False

        # Map sketch door types → pricing keys
        # Sketch uses simplified names; pricing has grade-specific keys
        _DOOR_TYPE_MAP = {
            "sliding": "framed_sliding",
            "swing": "framed_pivot",
            "frameless_swing": "frameless_pivot",
            "bi_fold": "framed_pivot",         # closest equivalent
            "neo_angle_pivot": "framed_neo_angle",
        }
        if door_type and door_type not in SHOWER_DOOR_PRICES and door_type not in NEO_ANGLE_DOOR_PRICES:
            door_type = _DOOR_TYPE_MAP.get(door_type, door_type)

        # Neo-angle door types
        if (door_type
                and door_type in NEO_ANGLE_DOOR_PRICES):
            na_prices = NEO_ANGLE_DOOR_PRICES[door_type]
            na_sizes = sorted(na_prices.keys())
            na_sz = min(
                na_sizes,
                key=lambda x: abs(x - s_w_door))
            _pick = picks.each("shower_door")
            mat_price = apply_material_handling(na_prices[na_sz] if _pick is None else _pick)
            door_install = round(
                NEO_ANGLE_DOOR_INSTALL.get(
                    door_type, 375) * labor_mult, 2)
            door_combined = mat_price + door_install
            door_label = door_type.replace(
                "_", " ").title()
            door_note = (
                f"Door: {picks.name('shower_door') + ' ' if _pick is not None else ''}${mat_price:,.2f} | "
                f"Install: ${door_install:,.2f} | "
                f"{na_sz}\" neo-angle")
            if panel_cost > 0:
                door_combined += panel_cost
                door_note += f" | Fixed panel ({panel_count}): {panel_sf} SF ${panel_cost:,.2f}"
                panel_merged = True
            _add(
                line_items, 5,
                f"Neo-angle door - {door_label}",
                1, "EA", door_combined, "fixture",
                notes=door_note)

        # Standard door types
        elif door_type and door_type in SHOWER_DOOR_PRICES:
            prices = SHOWER_DOOR_PRICES[door_type]
            if "any" in prices:
                mat_price = prices["any"]
            else:
                widths = sorted(prices.keys())
                w = (min(widths,
                         key=lambda x: abs(x - door_width))
                     if door_width
                     else widths[len(widths) // 2])
                mat_price = prices[w]
            # SKU-priced glass — add procurement handling (§0-1).
            # "curtain" is a rod, priced as an installed bundle elsewhere.
            _pick = picks.each("shower_door") if door_type != "curtain" else None
            if door_type != "curtain":
                mat_price = apply_material_handling(mat_price if _pick is None else _pick)
            door_label = door_type.replace(
                "_", " ").title()

            if door_type == "curtain":
                # A fixed glass panel doesn't pair with a curtain — leave
                # panel_merged False so it falls through to the standalone
                # fallback line below instead of being silently dropped.
                _add(
                    line_items, 5,
                    "Shower curtain rod + curtain",
                    1, "EA", mat_price, "fixture")
            else:
                door_install = round(
                    SHOWER_DOOR_INSTALL.get(
                        door_type, 250
                    ) * labor_mult, 2)
                door_combined = mat_price + door_install
                door_note = (
                    f"Door: {picks.name('shower_door') + ' ' if _pick is not None else ''}${mat_price:,.2f} | "
                    f"Install: ${door_install:,.2f}")
                if door_width:
                    door_note += (
                        f" | {door_width}\" opening")
                if panel_cost > 0:
                    door_combined += panel_cost
                    door_note += f" | Fixed panel ({panel_count}): {panel_sf} SF ${panel_cost:,.2f}"
                    panel_merged = True
                _add(
                    line_items, 5,
                    f"Shower door - {door_label}",
                    1, "EA", door_combined, "fixture",
                    notes=door_note)
        # Fallback: a fixed panel exists but no door/enclosure line above
        # could absorb it (e.g. curtain, or no door configured at all) —
        # keep it as its own line rather than silently dropping the cost.
        if panel_cost > 0 and not panel_merged:
            _add(line_items, 5, f"Fixed glass panel ({panel_count})",
                 panel_count, "EA", panel_cost, "fixture",
                 notes=f"{panel_sf} SF tempered glass, installed")

    # --- Shower curb tile ---
    if estimate.replace_shower and shower_spec.get("type") in CUSTOM_TILE_SHOWER_TYPES:
        curb_h = shower_spec.get("curb_height", 4) or 0
        if curb_h > 0:
            s_w = shower_spec.get("width_in", 36) or 36
            curb_depth = 4  # standard curb depth
            curb_sf = round((s_w * curb_depth + 2 * s_w * curb_h) / 144, 1)
            if curb_sf > 0:
                _add(line_items, 4, "Shower curb tile",
                     curb_sf, "SF", round(12.00 * labor_mult, 2), "tile",
                     notes=f"Top + front/back faces, {curb_h}\" curb height")

    # Tile edge trim (Schluter/metal) for custom tile showers
    if (estimate.replace_shower
            and shower_spec.get("type") in CUSTOM_TILE_SHOWER_TYPES):
        # Estimate trim LF: perimeter of shower opening + niche edges
        s_w = shower_spec.get("width_in", 36) or 36
        s_d = shower_spec.get("depth_in", 36) or 36
        trim_lf = (s_w + 2 * s_d) / 12  # interior perimeter
        niches = shower_spec.get("niches", 0)
        trim_lf += niches * 3  # ~3 LF per niche
        if trim_lf > 0:
            _add(line_items, 4,
                 "Tile edge trim (Schluter Jolly/Rondec)",
                 round(trim_lf, 1), "LF",
                 round(8.50 * labor_mult, 2), "tile",
                 notes="Metal edge trim at exposed tile edges")

    # Vanity (supports multiple vanities via items array)
    # Each vanity is consolidated into a single line item
    van_raw = estimate.vanity_spec or {}
    if estimate.replace_vanity and van_raw:
        # Backward compat: old format has no 'items' key
        vanity_items = van_raw.get("items") or [van_raw]

        for vi, van in enumerate(vanity_items):
            if not van or not isinstance(van, dict):
                continue
            label = f" #{vi + 1}" if len(vanity_items) > 1 else ""
            sink_type = van.get("sink_type", "cabinet")

            # ── Pedestal / Wall-Mount Sink path ──
            if sink_type in ("pedestal_sink", "wall_mount_sink"):
                sink_label = "Pedestal sink" if sink_type == "pedestal_sink" else "Wall-mount sink"
                _v_pick = picks.each("vanity")
                fixture_price = apply_material_handling(
                    SINK_PRICES.get(sink_type, SINK_PRICES["pedestal_sink"]) if _v_pick is None else _v_pick)
                install_price = round(
                    SINK_INSTALL.get(sink_type, SINK_INSTALL["pedestal_sink"]) * labor_mult, 2)

                # §11-1: same canonical faucet path as a cabinet vanity —
                # FAUCET_PRICES (material) + vanity_faucet_install (labor).
                faucet = van.get("faucet_type", "centerset")
                _f_pick = picks.each("bath_faucet")
                faucet_price = apply_material_handling(
                    FAUCET_PRICES.get(faucet, FAUCET_PRICES["centerset"]) if _f_pick is None else _f_pick)
                faucet_label = faucet.replace('_', ' ') if _f_pick is None else picks.name("bath_faucet")
                faucet_connect = 0
                if not plumber_fixed_vanity:
                    faucet_connect = round(
                        PLUMBING_RATES["vanity_faucet_install"] * labor_mult, 2)
                    if faucet == "wall_mount":
                        faucet_connect += round(
                            FLAT_PRICES["FAUCET_WALL_MOUNT_ROUGH"] * labor_mult, 2)
                faucet_total = round(faucet_price + faucet_connect, 2)

                mirror_total = 0
                mirror_price = 0
                mirror_label = ""
                if getattr(estimate, 'replace_mirror', False):
                    mirror = van.get("mirror_type", "framed")
                    _m_pick = picks.each("mirror")
                    mirror_price = apply_material_handling(
                        MIRROR_PRICES.get(mirror, MIRROR_PRICES["framed"]) if _m_pick is None else _m_pick)
                    mirror_label = mirror.replace('_', ' ') if _m_pick is None else picks.name("mirror")
                    mirror_total = round(mirror_price + FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)

                combined = fixture_price + install_price + faucet_total + mirror_total

                parts = [
                    f"{sink_label}: ${fixture_price:,.2f} allowance" if _v_pick is None
                    else f"{sink_label}: {picks.name('vanity')} ${fixture_price:,.2f}",
                    f"Install: ${install_price:,.2f}",
                ]
                if faucet_connect:
                    parts.append(f"Faucet: {faucet_label} ${faucet_price:,.2f} + plumbing connect ${faucet_connect:,.2f}")
                else:
                    parts.append(f"Faucet: {faucet_label} ${faucet_price:,.2f} (plumbing: plumber completed)")
                if getattr(estimate, 'replace_mirror', False):
                    mirror_install_cost = round(FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)
                    parts.append(f"Mirror: {mirror_label} ${mirror_price:,.2f} + install ${mirror_install_cost:,.2f}")
                elif getattr(estimate, 'detach_reset_mirror', False):
                    parts.append("Mirror: D&R (separate line)")
                else:
                    parts.append("Mirror: not included")

                _add(line_items, 5,
                     f"{sink_label}{label} complete",
                     1, "EA", combined, "fixture",
                     notes=" | ".join(parts))
                continue

            # ── Cabinet Vanity path (existing logic) ──
            v_width = van.get("width", 36)
            v_source = van.get("source", "stock_rta")
            v_prices = VANITY_PRICES.get(
                v_source, VANITY_PRICES["stock_rta"])
            _v_pick = picks.each("vanity")
            v_price = apply_material_handling(
                v_prices.get(v_width, v_prices.get(36, 500)) if _v_pick is None else _v_pick)
            src_label = v_source.replace('_', ' ') if _v_pick is None else picks.name("vanity")

            # --- Countertop: by the inch, a picked top, or none when the picked vanity comes with its top ---
            v_top = van.get("top_material", "quartz")
            top_rate = VANITY_TOP_PRICES.get(v_top, VANITY_TOP_PRICES["quartz"])
            top_label = v_top.replace('_', ' ')
            top_total = round(v_width * top_rate, 2)
            top_note = f"Top: {top_label} ${top_rate}/in ${top_total:,.2f}"
            if _v_pick is not None and picks.get("vanity").get("includes_top"):
                top_total = 0
                top_note = "Top: comes with the vanity"
            else:
                _top_pick = picks.each("vanity_top", width_in=v_width)
                if _top_pick is not None:
                    top_total = apply_material_handling(_top_pick)
                    top_note = f"Top: {picks.name('vanity_top')} ${top_total:,.2f}"

            # --- Installation ---
            install_price = round(FLAT_PRICES["VANITY_INSTALL"] * labor_mult, 2)

            # --- Wall mount blocking ---
            wall_mount_price = 0
            if van.get("mounting") == "wall_mount":
                wall_mount_price = round(
                    VANITY_EXTRAS["wall_mount_blocking"] * labor_mult, 2)

            # --- Faucet material (allowance) + plumbing connection ---
            # §10-4: FAUCET_PRICES is MATERIAL ONLY (no regional multiplier —
            # material is national). Install labor is added once, below.
            faucet = van.get("faucet_type", "single_hole")
            _f_pick = picks.each("bath_faucet")
            faucet_price = apply_material_handling(
                FAUCET_PRICES.get(faucet, FAUCET_PRICES["single_hole"]) if _f_pick is None else _f_pick)
            faucet_label = faucet.replace('_', ' ') if _f_pick is None else picks.name("bath_faucet")
            sink_count = van.get("sinks", 1)
            faucet_total = round(faucet_price * sink_count, 2)

            # Plumbing connection labor (unless plumber already fixed vanity)
            faucet_connect = 0
            if not plumber_fixed_vanity:
                faucet_connect = round(
                    PLUMBING_RATES["vanity_faucet_install"]
                    * sink_count * labor_mult, 2)
                if faucet == "wall_mount":
                    # Wall-mount needs a rough valve + access panel
                    faucet_connect += round(
                        FLAT_PRICES["FAUCET_WALL_MOUNT_ROUGH"] * sink_count * labor_mult, 2)
            faucet_total += faucet_connect

            # --- Mirror (only if replace_mirror is set) ---
            mirror_total = 0
            mirror_label = ""
            mirror_price = 0
            if getattr(estimate, 'replace_mirror', False):
                mirror = van.get("mirror_type", "framed")
                _m_pick = picks.each("mirror")
                mirror_price = apply_material_handling(
                        MIRROR_PRICES.get(mirror, MIRROR_PRICES["framed"]) if _m_pick is None else _m_pick)
                mirror_label = mirror.replace('_', ' ') if _m_pick is None else picks.name("mirror")
                mirror_total = round(
                    mirror_price + FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)

            # --- Toe kick (freestanding cabinet vanity) ---
            toe_kick_price = 0
            _v_mounting = van.get("mounting", "freestanding")
            if _v_mounting == "freestanding":
                toe_kick_lf = round(v_width / 12, 1)  # width in inches → LF
                toe_kick_price = round(
                    toe_kick_lf * VANITY_EXTRAS["toe_kick_per_lf"] * labor_mult, 2)

            # --- Combined total ---
            combined = (
                v_price + top_total + install_price
                + wall_mount_price + faucet_total + mirror_total
                + toe_kick_price
            )

            # Build breakdown note with allowance info
            parts = []
            if sink_count > 1:
                parts.append(f"Sinks: {sink_count} (double-sink vanity)")
            parts += [
                f"Cabinet: {src_label} ({v_width}\") "
                f"${v_price:,.2f}{' allowance' if _v_pick is None else ''}",
                top_note,
                f"Install: ${install_price:,.2f}",
            ]
            if toe_kick_price:
                parts.append(
                    f"Toe kick: {toe_kick_lf}LF "
                    f"${toe_kick_price:,.2f}"
                )
            if wall_mount_price:
                parts.append(
                    f"Wall-mount blocking: "
                    f"${wall_mount_price:,.2f}"
                )
            # Faucet note: show per-unit price × count when double-sink
            _fa_each = faucet_price  # allowance per faucet
            _fa_total = round(_fa_each * sink_count, 2)
            if sink_count > 1:
                _fa_str = (
                    f"${_fa_each:,.2f} ×{sink_count}"
                    f" = ${_fa_total:,.2f}{' allowance' if _f_pick is None else ''}"
                )
            else:
                _fa_str = f"${_fa_total:,.2f}{' allowance' if _f_pick is None else ''}"
            if faucet_connect:
                parts.append(
                    f"Faucet: {faucet_label} "
                    f"{_fa_str} + "
                    f"plumbing connect ${faucet_connect:,.2f}"
                )
            else:
                parts.append(
                    f"Faucet: {faucet_label} "
                    f"{_fa_str} "
                    f"(plumbing: plumber completed)"
                )
            if getattr(estimate, 'replace_mirror', False):
                mirror_install_cost = round(
                    FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)
                parts.append(
                    f"Mirror: {mirror_label} "
                    f"${mirror_price:,.2f}{' allowance' if _m_pick is None else ''} + "
                    f"install ${mirror_install_cost:,.2f}"
                )
            elif getattr(estimate, 'detach_reset_mirror', False):
                parts.append("Mirror: D&R (separate line)")
            else:
                parts.append("Mirror: not included")

            _van_title_sinks = f" ({sink_count} sinks)" if sink_count > 1 else ""
            _add(line_items, 5,
                 f"Vanity{label} complete"
                 f" - {src_label} ({v_width}\"){_van_title_sinks}",
                 1, "EA", combined, "fixture",
                 notes=" | ".join(parts))

    # Toilet (consolidated: toilet + install + supplies → 1 item, bidet → separate)
    tlt = estimate.toilet_spec or {}
    if estimate.replace_toilet and tlt:
        t_type = tlt.get("type", "two_piece_standard")
        _pick = picks.each("toilet")
        t_price = apply_material_handling(
            TOILET_PRICES.get(t_type, TOILET_PRICES["two_piece_standard"]) if _pick is None else _pick)
        t_install = round(PLUMBING_RATES["toilet_set"] * labor_mult, 2)

        # Plumbing supplies — skip supply line if plumber already fixed toilet
        if plumber_fixed_toilet:
            t_supplies = round(TOILET_EXTRAS["wax_ring"], 2)
        else:
            t_supplies = round(
                TOILET_EXTRAS["wax_ring"] + PLUMBING_RATES["supply_line_each"], 2)

        t_flange = 0
        if tlt.get("flange_repair"):
            t_flange = round(TOILET_EXTRAS["flange_repair"] * labor_mult, 2)

        t_combined = t_price + t_install + t_supplies + t_flange
        t_type_label = t_type.replace('_', ' ') if _pick is None else picks.name("toilet")

        t_parts = [
            f"Unit: {t_type_label} ${t_price:,.2f}{' allowance' if _pick is None else ''}",
            f"Install: ${t_install:,.2f}",
        ]
        if plumber_fixed_toilet:
            t_parts.append(f"Wax ring: ${t_supplies:,.2f} (supply line: plumber completed)")
        else:
            t_parts.append(f"Wax ring + supply: ${t_supplies:,.2f}")
        if t_flange:
            t_parts.append(f"Flange repair: ${t_flange:,.2f}")

        _add(line_items, 5,
             f"Toilet complete - {t_type_label}",
             1, "EA", t_combined, "fixture",
             notes=" | ".join(t_parts))

        if tlt.get("bidet_seat"):
            _add(line_items, 5, "Bidet seat installation", 1, "EA",
                 apply_material_handling(TOILET_PRICES["bidet_seat"]),
                 "fixture")
            warnings.append("Bidet seat requires GFCI outlet nearby")

    # ────────────────────────────────────────
    # Detach & Reset (labor only, no material)
    # ────────────────────────────────────────
    if getattr(estimate, 'detach_reset_tub', False):
        _dr_tub_spec = estimate.bathtub_spec or {}
        tub_mat = _dr_tub_spec.get("material", "acrylic")
        tub_type = _dr_tub_spec.get("type", "alcove")
        dr_key = "bathtub_cast_iron" if tub_mat == "cast_iron" else "bathtub_standard"
        tub_type_label = tub_type.replace("_", " ").title()
        tub_mat_label = tub_mat.replace("_", " ").title()
        _add(line_items, 5,
             f"Detach & Reset - Bathtub ({tub_type_label}, {tub_mat_label})",
             1, "EA", round(DETACH_RESET_COSTS[dr_key] * labor_mult, 2), "fixture",
             notes=f"Labor only: remove, store, reinstall | Existing {tub_type_label} {tub_mat_label} tub")

        # Tub deck/rim tile — D&R still requires demoing the deck to free the
        # tub for removal, then re-tiling it after reset (unlike the tub
        # itself, the deck tile is destroyed on removal and can't be reused).
        # _dr_deck_demo_sf computed earlier alongside has_tile_demo/debris;
        # its removal cost is folded into the "Demo & removal" line's notes
        # there too — only the re-tile/install line item is added here.
        if _dr_deck_demo_sf > 0:
            _dr_deck_sides = _dr_tub_spec.get("deck_tile_sides", 2)
            _add(line_items, 4,
                 f"Tub deck tile replacement ({_dr_deck_sides} sides)",
                 _dr_deck_demo_sf, "SF",
                 round(14.00 * labor_mult, 2), "tile",
                 notes="Includes bullnose edge trim | New tile — original destroyed on removal")

    if getattr(estimate, 'detach_reset_shower', False):
        shower_spec_dr = estimate.shower_spec or {}
        stype_dr = shower_spec_dr.get("type", "one_piece")
        if stype_dr in ("one_piece", "multi_piece_kit"):
            _add(line_items, 5, "Detach & Reset - Shower surround",
                 1, "EA", DETACH_RESET_COSTS["shower_surround"] * labor_mult,
                 "fixture", notes="Labor only: remove panels, store, reinstall")
        else:
            _add(line_items, 5, "Detach & Reset - Shower door/enclosure",
                 1, "EA", DETACH_RESET_COSTS["shower_door"] * labor_mult,
                 "fixture", notes="Labor only: remove, store, reinstall")

    if getattr(estimate, 'detach_reset_vanity', False):
        _dr_van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        _dr_van_costs = DETACH_RESET_COSTS["vanity"]  # dict keyed by width
        for _dv in _dr_van_items:
            if not _dv or not isinstance(_dv, dict):
                continue
            _dr_sink_t = _dv.get("sink_type", "cabinet")
            _dr_v_width = _dv.get("width", 36)
            # Find the smallest defined tier >= width (round up to next size)
            _dr_v_cost = _dr_van_costs.get(_dr_v_width)
            if _dr_v_cost is None:
                _sorted_keys = sorted(_dr_van_costs.keys())
                _dr_v_cost = None
                for _k in _sorted_keys:
                    if _k >= _dr_v_width:
                        _dr_v_cost = _dr_van_costs[_k]
                        break
                if _dr_v_cost is None:
                    # Wider than the largest defined tier — extrapolate from
                    # the rate between the two largest tiers instead of
                    # silently capping at the largest tier's price.
                    _top_k, _prev_k = _sorted_keys[-1], _sorted_keys[-2]
                    _per_inch = (_dr_van_costs[_top_k] - _dr_van_costs[_prev_k]) / (_top_k - _prev_k)
                    _dr_v_cost = round(_dr_van_costs[_top_k] + (_dr_v_width - _top_k) * _per_inch)
            _dr_label = {
                "pedestal_sink": "Detach & Reset - Pedestal sink",
                "wall_mount_sink": "Detach & Reset - Wall-mount sink",
            }.get(_dr_sink_t, f"Detach & Reset - Vanity & sink ({_dr_v_width}\")")
            # Toe kick for freestanding cabinet vanity D&R
            _dr_mounting = _dv.get("mounting", "freestanding")
            _dr_toe_kick = 0
            _dr_notes = "Labor only: disconnect, remove, reinstall"
            if (_dr_sink_t == "cabinet"
                    and _dr_mounting == "freestanding"):
                _dr_tk_lf = round(_dr_v_width / 12, 1)
                _dr_toe_kick = round(
                    _dr_tk_lf * VANITY_EXTRAS["toe_kick_per_lf"] * labor_mult, 2)
                _dr_notes += f" | Toe kick: {_dr_tk_lf}LF ${_dr_toe_kick:,.2f}"
            _add(line_items, 5, _dr_label,
                 1, "EA",
                 round(_dr_v_cost * labor_mult + _dr_toe_kick, 2),
                 "fixture",
                 notes=_dr_notes)

    if getattr(estimate, 'detach_reset_toilet', False):
        _add(line_items, 5, "Detach & Reset - Toilet",
             1, "EA", DETACH_RESET_COSTS["toilet"] * labor_mult, "fixture",
             notes="Labor only: remove, store, reinstall w/ new wax ring")

    if getattr(estimate, 'detach_reset_mirror', False):
        # Each mirror by its width, one line per width: a double vanity's one
        # wide mirror and its two small ones price differently
        for _mg in mirror_groups(estimate):
            _mw = _mg["width"]
            _m_rate = price_by_width(DETACH_RESET_COSTS["mirror"], _mw, unknown_width=36)
            _m_notes = "Labor only: careful removal, store, reinstall"
            if _mw:
                _m_notes += f' | {_mw:.0f}" wide' + (", two people to lift and hang" if _mw > 48 else "")
            _add(line_items, 5,
                 f'Detach & Reset - Mirror ({_mw:.0f}" wide)' if _mw else "Detach & Reset - Mirror",
                 _mg["count"], "EA",
                 round(_m_rate * labor_mult, 2), "fixture",
                 notes=_m_notes)

    # Mirror standalone install (when replacing mirror WITHOUT replacing vanity)
    if (getattr(estimate, 'replace_mirror', False)
            and not estimate.replace_vanity):
        van_raw_m = estimate.vanity_spec or {}
        vanity_items_m = van_raw_m.get("items") or [van_raw_m]
        for vi, van in enumerate(vanity_items_m):
            if not van or not isinstance(van, dict):
                continue
            label = f" #{vi + 1}" if len(vanity_items_m) > 1 else ""
            mirror_type = van.get("mirror_type", "framed")
            _m_pick = picks.each("mirror")
            mirror_price = apply_material_handling(
                MIRROR_PRICES.get(mirror_type, MIRROR_PRICES["framed"]) if _m_pick is None else _m_pick)
            mirror_label = mirror_type.replace('_', ' ') if _m_pick is None else picks.name("mirror")
            mirror_install = round(FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)
            mirror_combined = mirror_price + mirror_install
            _add(line_items, 5,
                 f"Mirror{label} - {mirror_label} (supply + install)",
                 1, "EA", mirror_combined, "fixture",
                 notes=f"Mirror: ${mirror_price:,.2f}{' allowance' if _m_pick is None else ''} | "
                       f"Install: ${mirror_install:,.2f}")

    # Cabinets on the wall (medicine cabinet, wall cabinet over the toilet): one line per kind
    for _cg in cabinet_groups(estimate):
        _ct, _cn = _cg["type"], _cg["count"]
        _clbl = CABINET_TYPES[_ct]["label"]
        if _cg["action"] == "detach_reset":
            _add(line_items, 5, f"Detach & Reset - {_clbl}", _cn, "EA",
                 DETACH_RESET_COSTS[_ct] * labor_mult, "fixture",
                 notes="Labor only: empty, remove, store, rehang level")
            continue
        if _ct == "wall_cabinet":
            _c_price = apply_material_handling(FLAT_PRICES["WALL_CABINET_PRICE"])
            _c_install = round(FLAT_PRICES["WALL_CABINET_INSTALL"] * labor_mult, 2)
        else:
            _c_price = apply_material_handling(MIRROR_PRICES[_ct])
            _c_install = round(FLAT_PRICES["MIRROR_INSTALL"] * labor_mult, 2)
        _add(line_items, 5, f"{_clbl} (supply + install)", _cn, "EA",
             _c_price + _c_install, "fixture",
             notes=f"Cabinet: ${_c_price:,.2f} allowance | Install: ${_c_install:,.2f}")

    # ────────────────────────────────────────
    # Phase 3 (Electrical - grouped with trades)
    # ────────────────────────────────────────
    elec = estimate.electrical_spec or {}

    # GFCI: only include if auto_gfci is enabled (or if explicitly set with count)
    gfci_count = elec.get("gfci_count") or 0
    if gfci_count > 0 and hc.get("auto_gfci", False):
        _add(line_items, 2, "GFCI outlet installation", gfci_count, "EA",
             ELECTRICAL_RATES["gfci_outlet_each"] * labor_mult, "electrical")

    # Lights: one line per kind (a 3-light vanity bar, recessed cans, sconces…)
    for _lg in light_groups(estimate):
        _lt, _ln = _lg["type"], _lg["count"]
        _lbl = LIGHT_TYPES[_lt]["label"]
        _bulbs = f" ({_lg['bulbs']}-light)" if _lg.get("bulbs") else ""
        if _lg["action"] == "detach_reset":
            _add(line_items, 2, f"Detach & Reset - {_lbl}{_bulbs}", _ln, "EA",
                 DETACH_RESET_COSTS["vanity_light"] * labor_mult, "electrical",
                 notes="Labor only: careful removal, store, reinstall")
        elif _lt == "recessed":
            if _ln > 1:
                _add(line_items, 2, f"Recessed light installation ({_ln} cans)", _ln, "EA",
                     ELECTRICAL_RATES["recessed_light_multi"] * labor_mult, "electrical",
                     notes="Cut ceiling, install housing + trim + wire per can")
            else:
                _add(line_items, 2, "Recessed light installation (1 can)", 1, "EA",
                     ELECTRICAL_RATES["recessed_light_install"] * labor_mult, "electrical")
        else:
            _install = ELECTRICAL_RATES[LIGHT_TYPES[_lt]["rate"]] * labor_mult
            _vl_pick = picks.each("vanity_light") if _lt == "vanity_bar" else None
            if _vl_pick is None:
                _add(line_items, 2, f"{_lbl} installation{_bulbs}", _ln, "EA",
                     _install, "electrical")
            else:
                _vl_price = apply_material_handling(_vl_pick)
                _vl_install = round(_install, 2)
                _add(line_items, 2, f"Vanity light - {picks.name('vanity_light')} (supply + install)",
                     _ln, "EA", _vl_price + _vl_install, "fixture",
                     notes=f"Fixture: ${_vl_price:,.2f} | Install: ${_vl_install:,.2f}")

    # Exhaust fan: only include if auto_exhaust_fan is enabled
    fan_cfm = elec.get("exhaust_fan_cfm")
    if fan_cfm and hc.get("auto_exhaust_fan", False):
        fan_prices = ELECTRICAL_RATES["exhaust_fan"]
        fan_price = fan_prices.get(fan_cfm, fan_prices[80])
        _add(line_items, 2, f"Exhaust fan ({fan_cfm} CFM) + installation", 1, "EA",
             fan_price * labor_mult, "electrical")

        switch_type = elec.get("exhaust_fan_switch", "standard")
        switch_price = ELECTRICAL_RATES["exhaust_fan_switch"].get(
            switch_type, ELECTRICAL_RATES["exhaust_fan_switch"]["standard"])
        if switch_type != "standard":
            _add(line_items, 2, f"Exhaust fan switch - {switch_type}", 1, "EA",
                 switch_price, "electrical")

    if elec.get("inspection"):
        _add(line_items, 2, "Electrical inspection fee", 1, "EA",
             ELECTRICAL_RATES["electrical_inspection_fee"], "electrical")

    if elec.get("megohmmeter_check", False):
        _add(line_items, 2,
             "Megohmmeter check - electrical circuits",
             1, "EA",
             ELECTRICAL_RATES["megohmmeter_check"],
             "electrical",
             notes="Insulation resistance test on circuits "
                   "serving water-damaged area")

    # ────────────────────────────────────────
    # Phase 6: Finish (Paint, Trim, Caulk)
    # ────────────────────────────────────────
    walls = estimate.walls_spec or {}
    paint_grade = walls.get("paint_grade")  # None if not specified
    wall_finish = walls.get("wall_finish", "paint" if walls.get("paint_walls") else None)
    paint_ceiling = walls.get("paint_ceiling", False)
    pg_mult = PAINT_GRADE_MULTIPLIER.get(paint_grade, 1.0) if paint_grade else 1.0
    # Walls and ceilings in a bathroom are always moisture-resistant paint
    wc_paint_rate_mult = pg_mult * MOISTURE_RESISTANT_PAINT_MULT * labor_mult
    wc_paint_grade = f"moisture-resistant, {paint_grade} grade"
    do_paint = wall_finish in ("paint", "paint_and_tile")
    do_tile_walls = wall_finish in ("tile", "paint_and_tile")

    # Room label for paint line items (from sketch rooms or designation)
    _sketch_rooms_p6 = (estimate.sketch_data or {}).get("rooms", [])
    _room_names = [r.get("name", "Bathroom")
                   for r in _sketch_rooms_p6 if not r.get("parentRoomId")]
    _room_label = _room_names[0] if _room_names else (
        (estimate.designation or "").replace("_", " ").title() or "Bathroom"
    )
    _wall_paint_added = False  # track to prevent duplicate

    # A soffit (a lowered ceiling, as over a tub) hides the wall above its
    # underside and has faces of its own to paint; the sketch measures both
    _soffit_hidden = walls.get("soffit_hidden_wall_sf", 0) or 0
    _soffit_faces = walls.get("soffit_face_sf", 0) or 0

    def _with_soffits(sf):
        """Wall SF less the wall behind soffits plus their faces, and the note's words for it."""
        if not (_soffit_hidden or _soffit_faces):
            return sf, []
        parts = []
        if _soffit_hidden:
            parts.append(f"- Behind soffit {_soffit_hidden:.0f} SF")
        if _soffit_faces:
            parts.append(f"+ Soffit faces {_soffit_faces:.0f} SF")
        return round(max(sf - _soffit_hidden, 0) + _soffit_faces, 1), parts

    # Wall painting
    if do_paint and paint_grade and wall_sf > 0:
        # Subtract non-paintable wall areas (tile, surround, tub alcove)
        wall_deductions: List[tuple] = []  # (label, sf)

        # 1) Custom tile / curbless shower walls
        if estimate.replace_shower:
            s_spec = estimate.shower_spec or {}
            s_type = s_spec.get("type", "")
            if s_type in CUSTOM_TILE_SHOWER_TYPES:
                ts = (s_spec.get("tile_spec") or {}).get("sf", 0)
                if not ts:
                    sw = s_spec.get("width_in", 0) or 0
                    sd = s_spec.get("depth_in", 0) or 0
                    sh = s_spec.get("tile_height_in", 0) or 0
                    if sw and sd and sh:
                        ts = (sw + 2 * sd) * sh / 144
                if ts:
                    wall_deductions.append(("Shower tile walls", round(ts, 1)))
            elif s_type in ("one_piece", "multi_piece_kit"):
                sw = s_spec.get("width_in", 36) or 36
                sd = s_spec.get("depth_in", 36) or 36
                sh = s_spec.get("tile_height_in", 72) or 72
                ps = (sw + 2 * sd) * sh / 144
                wall_deductions.append(
                    ("Shower surround area", round(ps, 1)))

        # 2) Bathtub surround (tile or prefab)
        t_spec = estimate.bathtub_spec or {}
        tub_type = t_spec.get("type", "")
        if t_spec.get("surround_tile"):
            ts2 = t_spec.get("surround_tile_sf", 0)
            if not ts2:
                tl = t_spec.get("tub_length_in", 0) or 0
                tsh = t_spec.get("surround_height_in", 0) or 0
                td = t_spec.get("tub_depth_in", 30) or 30
                if tl and tsh:
                    ts2 = (tl + 2 * td) * tsh / 144
            if ts2:
                wall_deductions.append(
                    ("Tub surround tile", round(ts2, 1)))
        elif tub_type == "alcove" and (estimate.replace_tub
                                       or getattr(estimate, 'detach_reset_tub', False)):
            tl = t_spec.get("tub_length_in", 60) or 60
            td = t_spec.get("tub_depth_in", 30) or 30
            surround_h = 60
            alcove_sf = (tl + 2 * td) * surround_h / 144
            wall_deductions.append(
                ("Tub alcove surround", round(alcove_sf, 1)))

        total_deduct = sum(sf for _, sf in wall_deductions)
        paint_wall_sf = max(wall_sf - total_deduct, 0)

        # In paint_and_tile mode, use sketch-provided paint_wall_sf if available
        _from_sketch = False
        if wall_finish == "paint_and_tile":
            sketch_paint_sf = walls.get("paint_wall_sf")
            if sketch_paint_sf and sketch_paint_sf > 0:
                paint_wall_sf = sketch_paint_sf
                _from_sketch = True
        _before_soffits = paint_wall_sf
        paint_wall_sf, _soffit_parts = _with_soffits(paint_wall_sf)

        # Only add original wall paint if full_paint_wall_sf not set (drywall repair handles it below)
        _full_paint_wall_sf = walls.get("full_paint_wall_sf", 0) or 0
        if paint_wall_sf > 0 and not _full_paint_wall_sf:
            deduct_note = None
            if _soffit_parts and (_from_sketch or not wall_deductions):
                parts = [f"Walls {_before_soffits:.0f} SF", *_soffit_parts,
                         f"= Paintable {paint_wall_sf:.0f} SF"]
                deduct_note = " | ".join(parts)
            elif wall_deductions:
                parts = [f"Total wall {wall_sf:.0f} SF"]
                for label, sf in wall_deductions:
                    parts.append(f"- {label} {sf:.0f} SF")
                parts.extend(_soffit_parts)
                parts.append(f"= Paintable {paint_wall_sf:.0f} SF")
                deduct_note = " | ".join(parts)
            _add(line_items, 6,
                 f"Wall painting ({wc_paint_grade})",
                 paint_wall_sf, "SF",
                 PAINT_RATES["wall_per_sf"] * wc_paint_rate_mult,
                 "finish", notes=deduct_note)
            _wall_paint_added = True

    # Wall tile (when wall_finish is 'tile' or 'paint_and_tile')
    if do_tile_walls and wall_sf > 0:
        tile_wall_sf = walls.get("tile_wall_sf", 0) or 0
        if wall_finish == "tile" and not tile_wall_sf:
            # Full tile, no area given: use paint_wall_sf (available after deductions) or wall_sf
            tile_wall_sf = paint_wall_sf if 'paint_wall_sf' in dir() else wall_sf
        if tile_wall_sf > 0:
            tile_mat = walls.get("tile_material", "porcelain")
            tile_pat = walls.get("tile_pattern", "straight")
            tile_sz = walls.get("tile_size", "12x12")
            # Walls tiled over the tub surround or shower walls take those in
            _with_wall_sf = (
                ((estimate.shower_spec or {}).get("tiled_with_wall_sf", 0) or 0)
                + ((estimate.bathtub_spec or {}).get("tiled_with_wall_sf", 0) or 0))
            wt_area = (f"Bathroom wall tile, incl. {_with_wall_sf:.0f}SF over the tub/shower walls"
                       if _with_wall_sf else "Bathroom wall tile (non-shower/tub areas)")
            # Material + labor per SF
            _pick = picks.per_sf("wall_tile")
            lab_rate = TILE_LABOR_RATES["wall_per_sf"]
            if _pick is None:
                mat_rate = apply_material_handling(TILE_MATERIAL_RATES.get(
                    tile_mat, TILE_MATERIAL_RATES["porcelain"]))
                tile_cost = round((mat_rate + lab_rate) * labor_mult, 2)
                wt_name, wt_note = tile_mat, wt_area
            else:
                # Retail tile, bought with its waste; only the labor is regional
                tile_sz = picks.tile_size("wall_tile") or tile_sz
                wt_waste = get_tile_waste(tile_pat, tile_sz)
                mat_rate = apply_material_handling(_pick)
                tile_cost = round(mat_rate * (1 + wt_waste) + lab_rate * labor_mult, 2)
                wt_name = picks.name("wall_tile")
                wt_note = (f"{wt_area} | Material: {wt_name} "
                           f"${mat_rate:.2f}/SF (incl {int(wt_waste*100)}% waste)")
            _add(line_items, 4,
                 f"Wall tile - {wt_name} ({tile_sz}, {tile_pat})",
                 round(tile_wall_sf, 1), "SF", tile_cost, "tile",
                 notes=wt_note)

    # ── Seal & prime (repaired drywall areas only) ──
    seal_prime_wall_sf = walls.get("seal_prime_wall_sf", 0) or 0
    seal_prime_ceil_sf = walls.get("seal_prime_ceiling_sf", 0) or 0
    total_seal_sf = seal_prime_wall_sf + seal_prime_ceil_sf
    if total_seal_sf > 0:
        seal_parts = []
        if seal_prime_wall_sf > 0:
            seal_parts.append(f"Wall {seal_prime_wall_sf:.0f} SF")
        if seal_prime_ceil_sf > 0:
            seal_parts.append(f"Ceiling {seal_prime_ceil_sf:.0f} SF")
        _add(line_items, 6,
             "Seal & prime - repaired drywall",
             round(total_seal_sf, 1), "SF",
             PAINT_RATES["seal_prime_per_sf"] * labor_mult,
             "finish",
             notes=f"PVA primer on new drywall only ({' + '.join(seal_parts)})")

    # ── Full wall painting (entire paintable wall when any drywall repair) ──
    full_paint_wall_sf = walls.get("full_paint_wall_sf", 0) or 0
    if full_paint_wall_sf > 0 and paint_grade:
        _full_sf, _full_soffit = _with_soffits(round(full_paint_wall_sf, 1))
        _add(line_items, 6,
             f"Wall painting, 2 coats ({wc_paint_grade})",
             _full_sf, "SF",
             PAINT_RATES["wall_per_sf"] * wc_paint_rate_mult,
             "finish",
             notes="Full wall paint (excl. tub/shower areas)"
                   " — required when any wall drywall repair"
                   + (f" | Walls {full_paint_wall_sf:.0f} SF | " + " | ".join(_full_soffit)
                      if _full_soffit else ""))
        _wall_paint_added = True
    elif do_paint and paint_grade and wall_sf > 0 and not _wall_paint_added:
        # Fallback: no drywall repair, no deduction paint — use wall_sf directly
        _fb_sf, _fb_soffit = _with_soffits(wall_sf)
        _add(line_items, 6,
             f"Wall painting ({wc_paint_grade})",
             _fb_sf, "SF",
             PAINT_RATES["wall_per_sf"] * wc_paint_rate_mult,
             "finish",
             notes=(" | ".join([f"Walls {wall_sf:.0f} SF", *_fb_soffit, f"= Paintable {_fb_sf:.0f} SF"])
                    if _fb_soffit else None))

    # ── Ceiling painting ──
    full_paint_ceil_sf = walls.get("full_paint_ceiling_sf", 0) or 0
    if full_paint_ceil_sf > 0 and paint_grade:
        _add(line_items, 6,
             f"Ceiling painting, 2 coats ({wc_paint_grade})",
             round(full_paint_ceil_sf, 1), "SF",
             PAINT_RATES["ceiling_per_sf"] * wc_paint_rate_mult,
             "finish",
             notes="Full ceiling paint"
                   " — required when any ceiling drywall repair")
    elif paint_ceiling and paint_grade and floor_sf > 0:
        _add(line_items, 6,
             f"Ceiling painting ({wc_paint_grade})",
             floor_sf, "SF",
             PAINT_RATES["ceiling_per_sf"] * wc_paint_rate_mult,
             "finish")

    # ── Door/window trim paint ──
    _door_trim = walls.get("door_trim_count", 0) or 0
    _win_trim = walls.get("window_trim_count", 0) or 0
    if _door_trim > 0:
        _add(line_items, 6,
             f"Door trim paint ({_door_trim} pc)",
             _door_trim, "EA",
             round(30.00 * labor_mult, 2),
             "finish",
             notes="Prep, prime & paint door trim casing")
    if _win_trim > 0:
        _add(line_items, 6,
             f"Window trim paint ({_win_trim} pc)",
             _win_trim, "EA",
             round(30.00 * labor_mult, 2),
             "finish",
             notes="Prep, prime & paint window trim casing")

    # ── Paint prep: masking + floor protection ──
    _any_paint = _wall_paint_added or paint_ceiling or (full_paint_ceil_sf > 0)
    if _any_paint and floor_sf > 0:
        mask_cost = round(
            floor_sf * PAINT_PREP["masking_per_sf"] * labor_mult, 2)
        fp_cost = round(
            floor_sf * PAINT_PREP["floor_protection_per_sf"] * labor_mult, 2)
        prep_total = mask_cost + fp_cost
        _add(line_items, 6,
             "Paint prep - masking & floor protection (paint phase)",
             floor_sf, "SF", round(prep_total / floor_sf, 2), "finish",
             notes=f"Masking (tape, plastic) ${mask_cost:,.2f} | "
                   f"Floor protection (drop cloth, re-protects the new "
                   f"floor from paint drips — separate from the pre-demo "
                   f"protection under Demo & Disposal) ${fp_cost:,.2f}")

    # Baseboard — perimeter minus fixture wall-contact widths from sketch
    # Auto-default to PVC when replacing floor (baseboard must be removed/replaced)
    bb_mat = walls.get("baseboard_material")
    if not bb_mat and replace_floor:
        bb_mat = "pvc"
    add_quarter_round = walls.get("quarter_round", False)
    if bb_mat:
        # Compute perimeter from dimensions, or estimate from floor_sf
        if estimate.length_ft and estimate.width_ft:
            perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        elif floor_sf > 0:
            import math
            side = math.sqrt(floor_sf)
            perimeter = 4 * side
        else:
            perimeter = 0

        # Extract fixture wall-contact widths from sketch_data (actual drawn sizes)
        sketch = estimate.sketch_data or {}
        sketch_fixtures = sketch.get("fixtures", [])

        deductions = []
        # Door: from sketch or default 3'
        doors = [f for f in sketch_fixtures
                 if f.get("type") == "door"]
        if doors:
            for d in doors:
                d_w = round(
                    (d.get("dimensions", {}).get("width", 36))
                    / 12, 1)
                deductions.append(("door", d_w))
        else:
            deductions.append(("door", 3.0))

        # Bathtub: long side (wall contact)
        if (estimate.replace_tub
                or getattr(estimate, 'detach_reset_tub', False)):
            sk_tub = next(
                (f for f in sketch_fixtures
                 if f.get("type") == "bathtub"), None)
            if sk_tub:
                sk_d = sk_tub.get("dimensions", {})
                tub_w = round(max(
                    sk_d.get("width", 60),
                    sk_d.get("height", 32)) / 12, 1)
            else:
                tub_w = round(
                    ((estimate.bathtub_spec or {})
                     .get("tub_length_in") or 60) / 12, 1)
            deductions.append(("bathtub", tub_w))

        # Shower: sketch width or spec or default 36"
        if (estimate.replace_shower
                or getattr(estimate,
                           'detach_reset_shower', False)):
            sk_shower = next(
                (f for f in sketch_fixtures
                 if f.get("type") == "shower"), None)
            if sk_shower:
                sh_w = round(
                    sk_shower.get("dimensions", {})
                    .get("width", 36) / 12, 1)
            else:
                sh_w = round(
                    ((estimate.shower_spec or {})
                     .get("width_in") or 36) / 12, 1)
            deductions.append(("shower", sh_w))

        # Vanity: each from sketch or spec or default 36"
        if (estimate.replace_vanity
                or getattr(estimate,
                           'detach_reset_vanity', False)):
            sk_vanities = [f for f in sketch_fixtures
                           if f.get("type") == "vanity"]
            if sk_vanities:
                for sv in sk_vanities:
                    v_w = round(
                        sv.get("dimensions", {})
                        .get("width", 36) / 12, 1)
                    deductions.append(("vanity", v_w))
            else:
                van_items = ((estimate.vanity_spec or {})
                             .get("items", []))
                for vi in (van_items or [{}]):
                    v_w = round(
                        (vi.get("width") or 36) / 12, 1)
                    deductions.append(("vanity", v_w))

        total_deduct = sum(d[1] for d in deductions)
        bb_lf = round(max(perimeter - total_deduct, 0), 1)
        deduct_parts = ", ".join(
            f"{n} {v:.1f}'" for n, v in deductions)

        bb_notes = (f"Perimeter {perimeter:.1f}'"
                    f" - {deduct_parts} = {bb_lf}' net")

        if bb_lf > 0 and bb_mat == "tile":
            floor_tile_mat = (estimate.floor_spec or {}
                              ).get("material", "porcelain")
            tb_rate = TILE_BASEBOARD_PRICES.get(
                floor_tile_mat, 12.00)
            tile_label = floor_tile_mat.replace(
                "_", " ").title()
            _add(line_items, 6,
                 f"Tile base - {tile_label} (supply + install)",
                 bb_lf, "LF",
                 (tb_rate + 1.50) * labor_mult, "finish",
                 notes=f"{bb_notes} | Includes tile base supplies (thinset, grout)")
        elif bb_lf > 0:
            bb_rate = BASEBOARD_PRICES.get(bb_mat, BASEBOARD_PRICES["mdf"])
            bb_label = {"pvc": "PVC", "mdf": "MDF"}.get(
                bb_mat, bb_mat.replace('_', ' ').title())
            _add(line_items, 6,
                 f"Baseboard - {bb_label} (supply + install)",
                 bb_lf, "LF",
                 bb_rate * labor_mult, "finish",
                 notes=bb_notes)
            bb_pg_mult = (PAINT_GRADE_MULTIPLIER.get(
                paint_grade, 1.0) if paint_grade else 1.0)
            _add(line_items, 6, "Baseboard painting",
                 bb_lf, "LF",
                 PAINT_RATES["trim_per_lf"]
                 * bb_pg_mult * labor_mult, "finish")
            if add_quarter_round:
                qr_rate = QUARTER_ROUND_PRICES.get(
                    bb_mat, 3.75)
                _add(line_items, 6,
                     f"Quarter round - {bb_label}"
                     f" (supply + install)",
                     bb_lf, "LF",
                     qr_rate * labor_mult, "finish",
                     notes="Covers floor-to-baseboard gap;"
                           " moisture seal at floor transition")
                _add(line_items, 6,
                     "Quarter round painting",
                     bb_lf, "LF",
                     PAINT_RATES["trim_per_lf"]
                     * bb_pg_mult * labor_mult, "finish")

    # ────────────────────────────────────────
    # Phase 7: Accessories + Punch/Cleanup
    # ────────────────────────────────────────
    acc = estimate.accessories_spec or {}
    acc_finish = acc.get("finish", "chrome")
    acc_grade = acc.get("grade", "mid")
    af_mult = ACCESSORY_FINISH_MULTIPLIER.get(acc_finish, 1.0)
    ag_mult = ACCESSORY_GRADE_MULTIPLIER.get(acc_grade, 1.0)

    # Accessories (consolidated into single line item)
    acc_action = acc.get("action", "replace")  # replace | detach_reset | none
    acc_items = [
        ("towel_bars", "Towel bar", "towel_bar"),
        ("hand_towel_rings", "Hand towel ring", "hand_towel_ring"),
        ("tp_holders", "TP holder", "tp_holder"),
        ("robe_hooks", "Robe hook", "robe_hook"),
        ("corner_shelves", "Corner shelf", "corner_shelf"),
        ("grab_bars", "Grab bar", "grab_bar"),
        ("toilet_brush_holders", "Brush holder", "toilet_brush_holder"),
        ("soap_dispensers", "Soap dispenser", "soap_dispenser"),
    ]

    if acc_action == "detach_reset":
        # D&R: labor only per piece — remove, store, reinstall
        dr_acc_total = 0
        dr_acc_parts = []
        dr_per_piece = DETACH_RESET_COSTS["accessory_per_piece"]
        for key, label, _price_key in acc_items:
            qty = acc.get(key) or 0
            if qty > 0:
                item_cost = round(qty * dr_per_piece * labor_mult, 2)
                dr_acc_total += item_cost
                dr_acc_parts.append(f"{label} x{qty} ${item_cost:,.2f}")
        if dr_acc_total > 0:
            _add(line_items, 5,
                 "Detach & Reset - Bathroom accessories",
                 1, "LS", dr_acc_total, "fixture",
                 notes="Labor only: remove, store, reinstall | "
                       + " | ".join(dr_acc_parts))

    elif acc_action != "none":
        # Replace: new material + install
        acc_total = 0
        acc_parts = []
        # ACCESSORY_PRICES bundles material + install labor (60/40, §0-2).
        # Finish/grade multipliers are MATERIAL-only and the regional
        # multiplier is LABOR-only (§0-3), so the bundle must be split before
        # either is applied — otherwise switching Chrome->Brass would also
        # inflate the installation labor by 25%.
        _acc_mat_share = get_material_share("accessory")
        _acc_lab_share = 1 - _acc_mat_share

        def _accessory_cost(bundled_price: float, quantity: float = 1) -> float:
            material = bundled_price * _acc_mat_share * af_mult * ag_mult
            labor = bundled_price * _acc_lab_share * labor_mult
            return round(quantity * (material + labor), 2)

        for key, label, price_key in acc_items:
            qty = acc.get(key) or 0
            if qty > 0:
                base_price = ACCESSORY_PRICES.get(
                    price_key, ACCESSORY_PRICES["towel_bar"])
                item_cost = _accessory_cost(base_price, qty)
                acc_total += item_cost
                acc_parts.append(f"{label} x{qty} ${item_cost:,.2f}")

        # Curtain rod rolls into accessories line item
        if tub_spec.get("curtain_rod"):
            cr_cost = _accessory_cost(BATHTUB_EXTRAS["curtain_rod"])
            acc_total += cr_cost
            acc_parts.append(f"Curtain rod + rings ${cr_cost:,.2f}")

        if acc_total > 0:
            finish_label = acc_finish.replace('_', ' ')
            _add(line_items, 7,
                 f"Bathroom accessories - {finish_label} ({acc_grade})",
                 1, "LS", acc_total, "finish",
                 notes=" | ".join(acc_parts))

    if (acc.get("grab_bars") or 0) > 0:
        warnings.append("Grab bars require wood blocking in wall framing")

    # Hidden costs
    # ── Hidden costs — assigned to correct phases by trade ──

    # Phase 1: Demo-related
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron" and estimate.replace_tub:
        _add(line_items, 1, "Cast iron tub disposal surcharge", 1, "EA",
             HIDDEN_COSTS["cast_iron_disposal"], "demo")

    if needs_lead_rrp:
        _add(line_items, 1, "Lead paint RRP compliance (pre-1978)", 1, "LS",
             HIDDEN_COSTS["lead_rrp"], "demo")
        warnings.append(
            "Property built before 1978 - EPA RRP rule applies. "
            "Certified renovator required.")

    _add(line_items, 1, "Floor/surface protection (pre-demo)", 1, "LS",
         HIDDEN_COSTS["floor_protection"], "demo",
         notes="Ram board/plastic laid before demo begins — protects the "
               "existing floor from construction debris & foot traffic. "
               "Separate from the paint-phase floor protection under "
               "Finish (Paint & Trim), which re-protects the new floor "
               "later, specifically from paint drips/overspray.")

    if hc.get("mobilization", False):
        _add(line_items, 1, "Mobilization / setup", 1, "LS",
             HIDDEN_COSTS["mobilization"], "demo",
             notes="Equipment transport to job site"
                   " (tile saw, demo tools, scaffold,"
                   " mixing station)")

    # Phase 3: Substrate — drywall patch/replacement (hidden cost)
    #   Skip when repair_drywall_walls is set — Path A already covers it.
    drywall_patch_sf = hc.get("drywall_patch_sf") or 0
    _repair_walls_explicit = getattr(
        estimate, 'repair_drywall_walls', False)
    if (hc.get("drywall_patch") and drywall_patch_sf > 0
            and not _repair_walls_explicit):
        drywall_patch_full = hc.get("drywall_patch_full", False)
        if drywall_patch_full:
            use_moisture = estimate.water_damage or estimate.mold_suspected
            rate_key = ("drywall_replace_moisture_per_sf"
                        if use_moisture else "drywall_replace_per_sf")
            board_label = "moisture-resistant" if use_moisture else "standard"
            _add(line_items, 3,
                 f"Drywall replacement ({board_label}) "
                 f"- hang, tape, mud, prime",
                 drywall_patch_sf, "SF",
                 SUBSTRATE_RATES[rate_key] * labor_mult, "substrate",
                 notes="Full replacement: hang new drywall "
                       "+ tape + mud + sand + prime")
        else:
            _add(line_items, 3,
                 "Drywall patching (around tile edges)",
                 drywall_patch_sf, "SF",
                 HIDDEN_COSTS["drywall_patch_per_sf"] * labor_mult,
                 "substrate")

    # Phase 6: Finish — caulk, trim paint
    _add(line_items, 6, "Caulking - silicone & latex (all joints)",
         1, "LS", HIDDEN_COSTS["caulk_day"] * labor_mult, "finish")

    trim_paint_lf = hc.get("trim_paint_lf") or 0
    if hc.get("trim_paint") and trim_paint_lf > 0:
        _add(line_items, 6, "Trim paint (post-install touch-up)",
             trim_paint_lf, "LF",
             HIDDEN_COSTS["trim_paint_per_lf"] * labor_mult, "finish")

    # Phase 7: Accessories, cleanup, punch list, permit
    _add(line_items, 7, "Final cleaning (move-in ready)", 1, "LS",
         HIDDEN_COSTS["final_clean"], "misc")

    if hc.get("punch_list", False):
        # Modeled time-based allowance — there is no published per-visit rate
        # for punch list work (see PUNCH_LIST_BASIS).
        _pl_visits = PUNCH_LIST_BASIS["visits"]
        _pl_label = (
            f"Punch list reserve ({_pl_visits} follow-up "
            f"{'visit' if _pl_visits == 1 else 'visits'})"
        )
        _add(line_items, 7, _pl_label, 1, "LS",
             get_punch_list_cost(), "misc",
             notes=get_punch_list_note())

    # Mold warning
    if estimate.mold_suspected:
        warnings.append(
            "Mold suspected during initial assessment. A separate mold remediation "
            "estimate is required before remodel work can commence. Remediation must be "
            "completed and cleared by a certified inspector prior to substrate installation."
        )

    if estimate.water_damage:
        warnings.append(
            "Conditions identified during scope assessment require restoration. Demolition may reveal "
            "additional underlying conditions not visible during initial inspection. Any required "
            "additional work will be documented with photos and presented as a written change order "
            "for approval prior to proceeding."
        )

    # ────────────────────────────────────────
    # Auto-include: commonly missing items
    # ────────────────────────────────────────
    # These fire automatically based on scope to prevent change orders.
    # Can be disabled via hidden_costs flags (set to false).

    # 1) Drywall skim coat after wall tile removal
    # Use actual tiled-wall area, NOT full room wall SF.
    # demo_wall_sf is the whole-room perimeter×height fallback — far too large.
    if (demo_walls and hc.get("drywall_skim_coat") is True):
        # If estimator explicitly entered an override, honour it.
        if getattr(estimate, 'demo_wall_sf', None):
            skim_coat_sf = demo_wall_sf
            skim_note_area = f"{skim_coat_sf:.0f}SF (manual override)"
        else:
            # Build from actual tile removal areas only.
            skim_coat_sf = 0.0
            skim_parts = []

            # Shower surround: (width + 2×depth) × tile_height
            _sc_shower = estimate.shower_spec or {}
            if (estimate.replace_shower
                    and _sc_shower.get("type") in CUSTOM_TILE_SHOWER_TYPES):
                _sc_w = _sc_shower.get("width_in", 36) or 36
                _sc_d = _sc_shower.get("depth_in", 36) or 36
                _sc_h = _sc_shower.get("tile_height_in", 72) or 72
                _sc_sf = round((_sc_w + 2 * _sc_d) * _sc_h / 144, 1)
                skim_coat_sf += _sc_sf
                skim_parts.append(f"shower surround {_sc_sf:.0f}SF")

            # Tub surround: 3 walls of alcove (back + 2 ends) × surround height
            _sc_tub = estimate.bathtub_spec or {}
            if (_sc_tub.get("surround_tile", False)
                    and (estimate.replace_tub
                         or getattr(estimate, 'detach_reset_tub', False))):
                _st_l = _sc_tub.get("tub_length_in", 60) or 60
                _st_end = 32  # standard alcove end-wall depth
                _st_h = _sc_tub.get("surround_height_in", 60) or 60
                _st_sf = round((_st_l + 2 * _st_end) * _st_h / 144, 1)
                skim_coat_sf += _st_sf
                skim_parts.append(f"tub surround {_st_sf:.0f}SF")

            # Explicit demo_walls flag with no dimension source → cap at 25% of wall_sf
            if skim_coat_sf == 0 and demo_walls:
                skim_coat_sf = round(wall_sf * 0.25, 1)
                skim_parts.append(
                    f"est. 25% of room walls {skim_coat_sf:.0f}SF"
                    f" (no tile dims — verify on site)")

            skim_coat_sf = max(round(skim_coat_sf, 1), 0)
            skim_note_area = " + ".join(skim_parts) if skim_parts else ""

        if skim_coat_sf > 0:
            _add(line_items, 6, "Drywall prep/skim coat (post tile removal)",
                 skim_coat_sf, "SF",
                 HIDDEN_COSTS["drywall_skim_coat_per_sf"] * labor_mult, "finish",
                 notes=(
                     "Skim coat + primer on substrate exposed after tile demo"
                     + (f" | Area: {skim_note_area}" if skim_note_area else "")
                 ))

    # 2) Subfloor allowance when fixture replacement exposes subfloor.
    #    Skip when demo_floor=True — Phase 3 auto-30% already covers it.
    #    Skip when explicit repair_subfloor or substrate_spec.subfloor_repair is set.
    sub_spec = estimate.substrate_spec or {}
    _has_explicit_subfloor = (
        getattr(estimate, 'repair_subfloor', False)
        or sub_spec.get("subfloor_repair")
    )
    # Subfloor allowance auto-include removed — only explicit repair_subfloor triggers this

    # 3) Auto-include GFCI if not explicitly specified (code requirement)
    elec_spec = estimate.electrical_spec or {}
    if (gfci_count == 0 and hc.get("auto_gfci") is True
            and (estimate.replace_vanity or estimate.replace_toilet)):
        _add(line_items, 2, "GFCI outlet (code required)", 1, "EA",
             ELECTRICAL_RATES["gfci_outlet_each"] * labor_mult, "electrical",
             notes="NEC code requires GFCI within 6ft of water source")

    # 4) Auto-include exhaust fan if not specified (code requirement for windowless bath)
    if (not elec_spec.get("exhaust_fan_cfm") and hc.get("auto_exhaust_fan") is True
            and has_demo):
        _add(line_items, 2, "Exhaust fan inspection/replacement (80 CFM)",
             1, "EA",
             ELECTRICAL_RATES["exhaust_fan"][80] * labor_mult, "electrical",
             notes="IRC code requires ventilation; inspect existing, replace if needed")

    # 5) Vanity light auto-include is now handled by replace_vanity_light flag
    # in the electrical section above (no longer needs hidden_costs.auto_vanity_light)

    # 6) Permit fee — county-specific matrix logic
    plumb_spec = estimate.plumbing_spec or {}
    has_rough_change = (
        plumb_spec.get("drain_modification")
        or plumb_spec.get("pressure_balance_valve")
        or hc.get("fixture_relocation")
        or hc.get("new_plumbing_line")
        or hc.get("new_electrical_circuit")
        or hc.get("valve_body_replace")
        or _layout_rough
    )
    est_state = estimate.state or ""
    permit_info = get_permit_info(est_state, has_rough_change)

    if hc.get("permit", False):
        if permit_info["required"]:
            _add(line_items, 7,
                 "Building permit (required)",
                 1, "EA", HIDDEN_COSTS["permit_fee"], "misc",
                 notes=permit_info["note"])
        elif permit_info["group"] in ("B", "C"):
            # Stricter jurisdictions: include as allowance
            _add(line_items, 7,
                 "Permit allowance (verify required)",
                 1, "EA", HIDDEN_COSTS["permit_fee"], "misc",
                 notes=permit_info["note"])
        else:
            # Group A like-for-like exempt: no cost, just note
            warnings.append(permit_info["note"])

    # (Ceiling paint handled in Phase 6 via walls_spec.paint_ceiling)

    # 8) Moisture-resistant drywall for ceiling
    #    Skip if repair_drywall_ceiling is explicitly set (handled in repair section)
    if (estimate.water_damage and demo_ceiling
            and not getattr(estimate, 'repair_drywall_ceiling', False)
            and floor_sf > 0 and hc.get("mold_resistant_drywall") is True):
        _add(line_items, 3,
             "Moisture-resistant drywall - ceiling",
             floor_sf, "SF",
             SUBSTRATE_RATES["mold_resistant_drywall_per_sf"] * labor_mult,
             "substrate",
             notes="Moisture-resistant drywall per code for wet area")

    # ────────────────────────────────────────
    # Totals
    # ────────────────────────────────────────

    # O&P (optional per user request)
    # When enabled, O&P is absorbed into each line item's unit_price
    # so it does NOT appear as a separate line on the PDF.
    include_op = getattr(estimate, "include_overhead_profit", False) or False
    overhead_pct = estimate.overhead_pct if estimate.overhead_pct is not None else 0.10
    profit_pct = estimate.profit_pct if estimate.profit_pct is not None else 0.10

    # ── Material tax loading (internalized — never a customer-facing line) ──
    # On lump-sum improvement contracts in MD/VA/DC/FL the contractor is the
    # final consumer of the materials, so the tax is a cost input, not a
    # pass-through charge. Fold it into each line item's material portion
    # BEFORE the subtotal so it can never surface as a separate amount.
    state = estimate.state or "MD"
    tax_rate = get_material_tax_loading(state, zip_code)
    if tax_rate:
        for item in line_items:
            share = get_material_share(item.get("category", ""))
            if not share:
                continue
            loaded = item["unit_price"] * (1 + share * tax_rate)
            item["unit_price"] = round(loaded, 2)
            item["total"] = round(item["quantity"] * item["unit_price"], 2)

    if include_op:
        # Compound, not additive: overhead is applied to cost, then profit is
        # applied to the overhead-loaded amount (cost x 1.10 x 1.10 = x1.21).
        op_multiplier = (1 + overhead_pct) * (1 + profit_pct)
        for item in line_items:
            item["unit_price"] = round(item["unit_price"] * op_multiplier, 2)
            item["total"] = round(item["quantity"] * item["unit_price"], 2)
            if item.get("notes"):
                item["notes"] = _scale_dollar_amounts(
                    item["notes"], op_multiplier
                )

    subtotal = sum(li["total"] for li in line_items)

    # O&P is already absorbed into line items — display amounts are 0
    overhead_amount = 0
    profit_amount = 0

    # Material tax is already loaded into line item pricing above, so the
    # grand total is simply the subtotal. No separate tax amount is ever
    # reported to the client.
    tax_amount = 0
    # The total is the exact sum of the line items. It is never rounded to a
    # clean number here: that would push a few dollars into one line item
    # without saying so. A round figure comes only from target_total below.
    total = round(subtotal, 2)

    # ────────────────────────────────────────
    # Target total adjustment (reverse pricing)
    # ────────────────────────────────────────
    adjustment_factor = None
    target_total = getattr(estimate, "target_total", None)
    if target_total and target_total > 0 and subtotal > 0 and total > 0:
        adjustment_factor = target_total / total

        for item in line_items:
            item["unit_price"] = round(
                item["unit_price"] * adjustment_factor, 2,
            )
            item["total"] = round(item["quantity"] * item["unit_price"], 2)
            if item.get("notes"):
                item["notes"] = _scale_dollar_amounts(
                    item["notes"], adjustment_factor
                )

        # Recalculate totals with adjusted line items
        subtotal = sum(item["total"] for item in line_items)
        total = round(subtotal, 2)

        # Fix rounding drift: adjust largest line item to hit target exactly
        rounding_diff = round(target_total - total, 2)
        if rounding_diff != 0 and line_items:
            largest = max(line_items, key=lambda x: x["total"])
            _old_largest_total = largest["total"]
            largest["total"] = round(largest["total"] + rounding_diff, 2)
            if largest["quantity"]:
                largest["unit_price"] = round(
                    largest["total"] / largest["quantity"], 2
                )
            # Scale notes by the secondary correction factor
            if largest.get("notes") and _old_largest_total > 0:
                _sec_factor = largest["total"] / _old_largest_total
                largest["notes"] = _scale_dollar_amounts(
                    largest["notes"], _sec_factor
                )
            subtotal = sum(item["total"] for item in line_items)
            total = round(subtotal, 2)

    # Methodology notes
    # NOTE: material tax loading is an internal cost input and is deliberately
    # NOT described here — methodology_notes is shown to the client.
    method_parts = [
        f"DMV region pricing ({state}), labor multiplier: {labor_mult:.2f}",
    ]
    if include_op:
        method_parts.append(
            f"O&P: {overhead_pct*100:.0f}% + {profit_pct*100:.0f}% "
            f"(included in line item pricing)"
        )
    else:
        method_parts.append("O&P: Not included (contractor direct pricing)")
    if adjustment_factor:
        method_parts.append(f"Target total: ${target_total:,.2f} (adjusted)")
        # Factor stored in DB for internal reference, not exposed on PDF

    # Renumber phases to eliminate gaps (e.g. if phase 2 is empty, 3→2, 4→3, ...)
    used_phases = sorted(set(item["phase"] for item in line_items))
    phase_map = {old: new for new, old in enumerate(used_phases, start=1)}
    for item in line_items:
        item["phase"] = phase_map[item["phase"]]

    warnings.extend(picks.warnings + picks.unused_warnings())

    return {
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "overhead_amount": overhead_amount,
        "profit_amount": profit_amount,
        "tax_amount": tax_amount,
        "total": total,
        "adjustment_factor": round(adjustment_factor, 6) if adjustment_factor else None,
        "methodology_notes": " | ".join(method_parts),
        "warning_flags": warnings,
    }


def _add(
    items: List[Dict],
    phase: int,
    description: str,
    quantity: float,
    unit: str,
    unit_price: float,
    category: str,
    notes: Optional[str] = None,
):
    """Add a line item to the list."""
    total = round(quantity * unit_price, 2)
    items.append({
        "phase": phase,
        "description": description,
        "quantity": round(quantity, 2),
        "unit": unit,
        "unit_price": round(unit_price, 2),
        "total": total,
        "category": category,
        "notes": notes,
    })
