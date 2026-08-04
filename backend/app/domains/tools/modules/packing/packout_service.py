"""
Packout Calculator — Estimation engine for content pack-out jobs.

Composes (not inherits) EstimateCalculator for price lookups and shared
infrastructure.  Produces a standard EstimateResponse so that the
EstimateEditorModal, converter, and export pipeline work unchanged.
"""

from __future__ import annotations

import math
from typing import Dict, List, Any

from sqlalchemy.orm import Session

from .schemas import (
    PackoutEstimateRequest,
    PackoutEstimateResponse,
    EstimateResponse,
    RoomItemSummary,
    StagingType,
    StorageMode,
    EstimateDetail,
)
from .service import (
    EstimateCalculator,
    DENSITY_MULTIPLIERS,
    FLOOR_MULTIPLIERS,
    REGION_MULTIPLIERS,
    CONTAMINATION_MULTIPLIERS,
    SPECIAL_ITEM_COSTS,
    snap_to_storage_unit,
    get_storage_setup_fee,
    build_storage_section_detail,
)


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


# ============================================
# PACKOUT-SPECIFIC COEFFICIENTS
# ============================================

# Base labor hours per non-boxable item (before weight multiplier)
NON_BOXABLE_LABOR: Dict[str, float] = {
    "furniture_large": 0.75,
    "furniture_medium": 0.40,
    "appliance_large": 0.60,
    "appliance_small": 0.25,
    "outdoor": 0.50,
    "garage": 0.35,
    "specialty": 1.20,
    "sports": 0.40,
    "instruments": 0.80,
    "rugs_art": 0.30,
    "custom": 0.50,
}

# Weight class → labor multiplier
WEIGHT_LABOR_MULT: Dict[str, float] = {
    "light": 1.0,
    "moderate": 1.0,
    "heavy": 1.4,        # 2-person lift
    "extra_heavy": 1.8,  # dolly / equipment
}

# Volume → storage square footage per item
VOLUME_SF: Dict[str, int] = {
    "small": 4,
    "medium": 8,
    "large": 16,
    "xlarge": 24,
}

DISASSEMBLY_ADDON = 0.35  # extra hours per item
CRATING_ADDON = 1.50      # extra hours per crated item

# Lump-sum: large-item hours by floor
LARGE_ITEM_HOURS: Dict[str, float] = {
    "basement": 0.45,
    "1st": 0.35,
    "2nd": 0.50,
    "3rd": 0.60,
    "4th+": 0.75,
}

# Box packing hours per box
BOX_HOURS: Dict[str, float] = {
    "small": 0.08,
    "medium": 0.12,
    "large": 0.15,
    "wardrobe": 0.20,
    "picture": 0.18,
    "dish_pack": 0.25,
    "specialty": 0.30,
}

# Box → storage SF
BOX_SF: Dict[str, float] = {
    "small": 1.5,
    "medium": 2.5,
    "large": 4.0,
    "wardrobe": 4.5,
    "picture": 3.0,
    "dish_pack": 2.5,
    "specialty": 3.0,
}

# Protection materials by non-boxable type (material_key → quantity per item)
PROTECTION_MAP: Dict[str, Dict[str, float]] = {
    "furniture_large": {"blanket": 2, "shrink_wrap_roll": 0.5, "furniture_pad": 1},
    "furniture_medium": {"blanket": 1, "shrink_wrap_roll": 0.3},
    "appliance_large": {"blanket": 1, "furniture_pad": 1, "shrink_wrap_roll": 0.5},
    "appliance_small": {"blanket": 1, "bubble_wrap": 1},
    "outdoor": {"blanket": 1, "shrink_wrap_roll": 0.5},
    "garage": {"blanket": 1},
    "specialty": {"blanket": 2, "furniture_pad": 2, "corner_protector": 4},
    "sports": {"blanket": 1, "shrink_wrap_roll": 0.3},
    "instruments": {"blanket": 2, "furniture_pad": 1, "corner_protector": 2},
    "rugs_art": {"blanket": 1, "corner_protector": 4},
    "custom": {"blanket": 1, "shrink_wrap_roll": 0.3},
}


class PackoutCalculator:
    """Packout estimation engine.

    Composes EstimateCalculator for price lookups, truck selection,
    and supplement evaluation.
    """

    def __init__(self, db: Session, company_id=None):
        self.db = db
        self.company_id = company_id
        self._ec = EstimateCalculator(db, company_id)

    # ── Public entry point ───────────────────────────────────────────────

    def calculate_packout(self, request: PackoutEstimateRequest) -> PackoutEstimateResponse:
        is_detailed = request.detail_level == EstimateDetail.DETAILED
        is_off_site = request.storage_mode == StorageMode.OFF_SITE

        region_str = request.region.value if hasattr(request.region, "value") else str(request.region)
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)

        crew = request.crew_size
        labor_rate = self._ec.get_price("2825")
        supervisor_rate = self._ec.get_price("2911")
        # specialty_rate available if needed for specialized handling tiers

        # ── Per-room calculation ──────────────────────────────────────
        total_person_hours = 0.0
        total_non_boxable = 0
        agg_box_counts: Dict[str, int] = {}
        agg_protection: Dict[str, int] = {}
        total_blankets = 0
        storage_sf_raw = 0.0
        room_summaries: List[RoomItemSummary] = []
        room_labor_details: List[Dict[str, Any]] = []

        for room in request.rooms:
            floor_str = room.floor.value if hasattr(room.floor, "value") else str(room.floor)
            density_str = room.density.value if hasattr(room.density, "value") else str(room.density)
            contam_str = room.contamination.value if hasattr(room.contamination, "value") else str(room.contamination)

            floor_mult = FLOOR_MULTIPLIERS.get(floor_str, 1.0)
            density_overhead = 1.0 + (DENSITY_MULTIPLIERS.get(density_str, 1.0) - 1.0) * 0.4
            contam_mult = CONTAMINATION_MULTIPLIERS.get(contam_str, 1.0)
            coverage_mult = 1.0 + (room.floor_coverage_pct - 50) * 0.01

            # Non-boxable labor
            nb_hours = 0.0
            nb_count = 0
            room_protection: Dict[str, float] = {}
            room_blankets = 0

            if is_detailed and room.non_boxable_items:
                for item in room.non_boxable_items:
                    nb_count += item.quantity
                    item_base = item.labor_hours if item.labor_hours is not None else NON_BOXABLE_LABOR.get(
                        item.type.value if hasattr(item.type, "value") else str(item.type),
                        0.50,
                    )
                    weight_str = item.weight.value if hasattr(item.weight, "value") else str(item.weight)
                    weight_mult = WEIGHT_LABOR_MULT.get(weight_str, 1.0)
                    hours = item_base * weight_mult * item.quantity
                    if item.needs_disassembly:
                        hours += DISASSEMBLY_ADDON * item.quantity
                    if item.needs_crating:
                        hours += CRATING_ADDON * item.quantity
                    nb_hours += hours

                    # Protection materials
                    type_key = item.type.value if hasattr(item.type, "value") else str(item.type)
                    pmap = PROTECTION_MAP.get(type_key, PROTECTION_MAP["custom"])
                    for mat, per_item_qty in pmap.items():
                        room_protection[mat] = room_protection.get(mat, 0) + per_item_qty * item.quantity
                    room_blankets += math.ceil(pmap.get("blanket", 1) * item.quantity)

                    # Storage SF
                    vol_str = item.volume.value if hasattr(item.volume, "value") else str(item.volume)
                    storage_sf_raw += VOLUME_SF.get(vol_str, 8) * item.quantity
            else:
                # Lump sum mode
                lump_count = room.lump_large_item_count or 0
                nb_count = lump_count
                item_hours_per = LARGE_ITEM_HOURS.get(floor_str, 0.35)
                nb_hours = lump_count * item_hours_per
                room_blankets = lump_count
                storage_sf_raw += lump_count * 12

            total_non_boxable += nb_count

            # Box labor
            box_hours = 0.0
            for bt, count in (room.box_counts or {}).items():
                if count <= 0:
                    continue
                box_hours += BOX_HOURS.get(bt, 0.12) * count
                agg_box_counts[bt] = agg_box_counts.get(bt, 0) + count
                storage_sf_raw += BOX_SF.get(bt, 2.5) * count

            # Room total person-hours
            room_ph = (nb_hours + box_hours) * coverage_mult * floor_mult * density_overhead * contam_mult
            room_ph *= region_mult
            total_person_hours += room_ph

            # Blankets (override or auto)
            if room.blanket_override is not None:
                room_blankets = room.blanket_override
            total_blankets += room_blankets

            # Aggregate protection materials
            for mat, qty in room_protection.items():
                agg_protection[mat] = agg_protection.get(mat, 0) + math.ceil(qty)

            # Room summary
            notable = []
            if nb_count > 0:
                notable.append(f"{nb_count} non-boxable item{'s' if nb_count != 1 else ''}")
            total_boxes_room = sum((room.box_counts or {}).values())
            if total_boxes_room > 0:
                notable.append(f"{total_boxes_room} boxes")
            room_summaries.append(RoomItemSummary(
                room_name=room.room_name,
                notable_items=notable,
                categories_present=[],
                high_value_items=[],
                packing_notes=[],
                item_count=nb_count + total_boxes_room,
            ))

            room_labor_details.append({
                "room_name": room.room_name,
                "nb_hours": round(nb_hours, 2),
                "box_hours": round(box_hours, 2),
                "multipliers": f"floor={floor_mult} density={density_overhead:.2f} contam={contam_mult} coverage={coverage_mult:.2f} region={region_mult}",
                "total_ph": round(room_ph, 2),
            })

        # ── Elapsed hours & crew split ────────────────────────────────
        elapsed_hours = total_person_hours / crew if crew > 0 else total_person_hours
        pack_out_hours = round(elapsed_hours * 0.62, 1)
        pack_back_hours = round(elapsed_hours * 0.38, 1) if request.include_packback else 0

        supervisor_hours = max(1, round(elapsed_hours * 0.10))

        # ── Sections ─────────────────────────────────────────────────
        sections: Dict[str, float] = {}
        section_details: Dict[str, Any] = {}

        # --- Pack-Out Labor ---
        po_crew_ph = round(pack_out_hours * crew)
        po_crew_amt = round(po_crew_ph * labor_rate, 2)
        sv_amt = round(supervisor_hours * supervisor_rate, 2)
        po_lines = [
            {"name": "Pack-Out Crew Labor", "qty": po_crew_ph, "unit": "HR",
             "rate": round(labor_rate, 2),
             "detail": f"{crew}-person crew · {pack_out_hours} elapsed hr × {crew} = {po_crew_ph} person-hrs × {_fmt(labor_rate)}/hr",
             "amount": po_crew_amt},
            {"name": "Supervisor/Foreman", "qty": supervisor_hours, "unit": "HR",
             "rate": round(supervisor_rate, 2),
             "detail": f"On-site supervision · {supervisor_hours} hr × {_fmt(supervisor_rate)}/hr",
             "amount": sv_amt},
        ]
        sections["Pack-Out Labor"] = sum(ln["amount"] for ln in po_lines)
        section_details["Pack-Out Labor"] = {"lines": po_lines}

        # --- Materials ---
        mat_lines = self._build_material_lines(
            agg_box_counts, agg_protection, total_blankets, is_detailed,
        )
        sections["Materials"] = round(sum(ln["amount"] for ln in mat_lines), 2)
        section_details["Materials"] = {"lines": mat_lines}

        # --- Transport & Storage ---
        is_on_site = not is_off_site
        storage_sf = 0
        storage_months = math.ceil(request.repair_duration_months) if request.repair_duration_months > 0 else 0
        on_prop_factor = 1.0 - (request.on_property_pct / 100)

        if not is_on_site:
            adjusted_sf = storage_sf_raw * on_prop_factor
            storage_sf = snap_to_storage_unit(adjusted_sf)

        # Loading hours scale with storage SF
        num_rooms = len(request.rooms)
        loading_hours = max(2.0, num_rooms * 0.5)
        # loading labor is computed inline in transport detail lines

        if is_on_site:
            on_site_hours = max(1.5, num_rooms * 0.35)
            on_site_fee = round(crew * on_site_hours * labor_rate, 2)
            sections["On-Site Relocation"] = on_site_fee
            section_details["On-Site Relocation"] = {"lines": [
                {"name": "On-Site Content Move", "qty": round(on_site_hours * crew, 1), "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{crew}-person crew moving contents within property",
                 "amount": on_site_fee},
            ]}
        else:
            _, truck_rate = self._ec.select_truck(storage_sf)
            truck_trips = max(1, math.ceil(storage_sf / 500)) if storage_sf > 0 else 1
            load_ph = round(loading_hours * crew * 2) / 2

            t_out_lines = [
                {"name": "26' Moving Van", "qty": truck_trips, "unit": "DY",
                 "rate": round(truck_rate, 2),
                 "detail": f"{truck_trips} trip{'s' if truck_trips > 1 else ''}",
                 "amount": round(truck_rate * truck_trips, 2)},
                {"name": "Loading Labor", "qty": load_ph, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{loading_hours:.1f} elapsed hr · {crew}-person crew",
                 "amount": round(load_ph * labor_rate, 2)},
            ]
            sections["Transport Out"] = sum(ln["amount"] for ln in t_out_lines)
            section_details["Transport Out"] = {"lines": t_out_lines}

            if storage_sf > 0 and storage_months > 0:
                sf_rate = self._ec.get_price("2840") or 2.18
                setup_fee = get_storage_setup_fee(storage_sf)
                storage_cost = round(storage_sf * sf_rate * storage_months + setup_fee, 2)
                sections["Storage"] = storage_cost
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, sf_rate, storage_months, setup_fee, storage_cost,
                )

            if request.include_packback:
                t_back_lines = [
                    {"name": "26' Moving Van", "qty": truck_trips, "unit": "DY",
                     "rate": round(truck_rate, 2),
                     "detail": f"{truck_trips} trip{'s' if truck_trips > 1 else ''}",
                     "amount": round(truck_rate * truck_trips, 2)},
                    {"name": "Unloading Labor", "qty": load_ph, "unit": "HR",
                     "rate": round(labor_rate, 2),
                     "detail": f"{loading_hours:.1f} elapsed hr · {crew}-person crew",
                     "amount": round(load_ph * labor_rate, 2)},
                ]
                sections["Transport Back"] = sum(ln["amount"] for ln in t_back_lines)
                section_details["Transport Back"] = {"lines": t_back_lines}

        # --- Pack-Back Labor ---
        if request.include_packback:
            pb_crew_ph = round(pack_back_hours * crew)
            pb_supervisor = max(1, round(pack_back_hours * 0.12))
            pb_crew_amt = round(pb_crew_ph * labor_rate, 2)
            pb_sv_amt = round(pb_supervisor * supervisor_rate, 2)
            pb_lines = [
                {"name": "Pack-Back Crew Labor", "qty": pb_crew_ph, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{crew}-person crew · {pack_back_hours} elapsed hr × {crew} = {pb_crew_ph} person-hrs",
                 "amount": pb_crew_amt},
                {"name": "Supervisor/Foreman", "qty": pb_supervisor, "unit": "HR",
                 "rate": round(supervisor_rate, 2),
                 "detail": f"Pack-back oversight · {pb_supervisor} hr × {_fmt(supervisor_rate)}/hr",
                 "amount": pb_sv_amt},
            ]
            sections["Pack-Back Labor"] = sum(ln["amount"] for ln in pb_lines)
            section_details["Pack-Back Labor"] = {"lines": pb_lines}

        # --- Special Items ---
        all_special = set(getattr(request, "special_items", []))
        all_custom = list(getattr(request, "custom_special_items", []))
        for room in request.rooms:
            all_special.update(getattr(room, "special_items", []))
            all_custom.extend(getattr(room, "custom_special_items", []))

        special_lines = []
        for key in all_special:
            spec = SPECIAL_ITEM_COSTS.get(key)
            if spec:
                special_lines.append({"name": spec["name"], "qty": 1, "unit": spec["unit"],
                                      "rate": spec["price"], "detail": "Fixed-cost specialty item",
                                      "amount": spec["price"]})
        for c in all_custom:
            special_lines.append({"name": c.name, "qty": 1, "unit": "EA",
                                  "rate": c.price, "detail": "Custom specialty item",
                                  "amount": c.price})
        if special_lines:
            sections["Special Items"] = round(sum(ln["amount"] for ln in special_lines), 2)
            section_details["Special Items"] = {"lines": special_lines}

        # ── Totals ────────────────────────────────────────────────────
        subtotal = round(sum(sections.values()), 2)
        op_amount = round(subtotal * (request.op_rate / 100), 2) if request.include_op else 0
        contingency_amount = round(subtotal * (request.contingency_rate / 100), 2) if request.include_contingency else 0
        grand_total = round(subtotal + op_amount + contingency_amount, 2)

        # Workday notes
        notes: List[str] = []
        if elapsed_hours > 8:
            days = math.ceil(elapsed_hours / 8)
            notes.append(
                f"Estimated on-site time is {round(elapsed_hours, 1)} hrs "
                f"({crew}-person crew). Recommend scheduling {days} days."
            )

        # Storage info note
        if storage_sf > 0 and storage_months > 0:
            notes.append(
                f"Storage: {storage_sf} SF for {storage_months} month{'s' if storage_months != 1 else ''} "
                f"({request.on_property_pct}% on-property reduction applied)."
            )

        total_items = total_non_boxable + sum(agg_box_counts.values())

        estimate = EstimateResponse(
            total_rooms=len(request.rooms),
            total_items=total_items,
            total_hours=round(elapsed_hours, 1),
            crew_size=crew,
            sections=sections,
            section_details=section_details,
            materials={},
            material_details=None,
            storage_sf=storage_sf,
            staging_type=StagingType.OFF_SITE if is_off_site else StagingType.ON_SITE,
            room_summaries=room_summaries,
            subtotal=subtotal,
            include_op=request.include_op,
            op_rate=request.op_rate,
            op_amount=op_amount,
            include_contingency=request.include_contingency,
            contingency_rate=request.contingency_rate,
            contingency_amount=contingency_amount,
            supplements=[],
            supplements_total=0,
            grand_total=grand_total,
            notes=notes,
        )

        return PackoutEstimateResponse(
            estimate=estimate,
            total_non_boxable_items=total_non_boxable,
            total_boxes=agg_box_counts,
            total_blankets=total_blankets,
            total_protection_materials=agg_protection,
            storage_mode=request.storage_mode,
            repair_duration_months=request.repair_duration_months,
            effective_storage_months=storage_months,
            detail_level=request.detail_level,
        )

    # ── Material line builder ────────────────────────────────────────

    def _build_material_lines(
        self,
        box_counts: Dict[str, int],
        protection: Dict[str, int],
        blankets: int,
        is_detailed: bool,
    ) -> List[Dict[str, Any]]:
        """Build material section detail lines."""
        lines: List[Dict[str, Any]] = []

        # Boxes
        box_names = {
            "small": "Small Box (1.5 cu ft)",
            "medium": "Medium Box (3.0 cu ft)",
            "large": "Large Box (4.5 cu ft)",
            "wardrobe": "Wardrobe Box",
            "picture": "Picture/Mirror Box",
            "dish_pack": "Dish Pack Box",
            "specialty": "Specialty Box",
        }
        box_prices = {
            "small": 3.50, "medium": 4.75, "large": 6.25,
            "wardrobe": 14.50, "picture": 12.00, "dish_pack": 8.50, "specialty": 11.00,
        }
        for bt, count in box_counts.items():
            if count <= 0:
                continue
            price = box_prices.get(bt, 5.00)
            lines.append({
                "name": box_names.get(bt, bt.title()),
                "qty": count,
                "unit": "EA",
                "rate": price,
                "detail": "Packing Supplies",
                "amount": round(count * price, 2),
            })

        # Protection materials (detailed mode only — itemized)
        mat_names = {
            "blanket": "Moving Blanket",
            "shrink_wrap_roll": "Shrink Wrap Roll",
            "furniture_pad": "Furniture Pad",
            "corner_protector": "Corner Protector",
            "bubble_wrap": "Bubble Wrap Roll",
        }
        mat_prices = {
            "blanket": 12.00,
            "shrink_wrap_roll": 8.50,
            "furniture_pad": 15.00,
            "corner_protector": 2.50,
            "bubble_wrap": 9.00,
        }

        if is_detailed:
            for mat, qty in protection.items():
                if qty <= 0:
                    continue
                price = mat_prices.get(mat, 5.00)
                lines.append({
                    "name": mat_names.get(mat, mat.replace("_", " ").title()),
                    "qty": qty,
                    "unit": "EA",
                    "rate": price,
                    "detail": "Protective Wrapping",
                    "amount": round(qty * price, 2),
                })
        else:
            # Lump sum mode: just blankets + generic wrap
            if blankets > 0:
                bp = mat_prices["blanket"]
                lines.append({
                    "name": "Moving Blankets",
                    "qty": blankets,
                    "unit": "EA",
                    "rate": bp,
                    "detail": "Protective Wrapping — 1 per large item",
                    "amount": round(blankets * bp, 2),
                })
            # Add generic stretch wrap estimate
            wrap_rolls = max(1, math.ceil(blankets / 3))
            if wrap_rolls > 0:
                wp = mat_prices["shrink_wrap_roll"]
                lines.append({
                    "name": "Shrink Wrap",
                    "qty": wrap_rolls,
                    "unit": "RL",
                    "rate": wp,
                    "detail": "Protective Wrapping",
                    "amount": round(wrap_rolls * wp, 2),
                })

        # Packing paper (both modes)
        total_boxes = sum(box_counts.values())
        paper_bundles = max(1, math.ceil(total_boxes / 5)) if total_boxes > 0 else 0
        if paper_bundles > 0:
            pp = 6.50
            lines.append({
                "name": "Packing Paper Bundle",
                "qty": paper_bundles,
                "unit": "EA",
                "rate": pp,
                "detail": "Packing Supplies",
                "amount": round(paper_bundles * pp, 2),
            })

        # Tape
        tape_rolls = max(1, math.ceil(total_boxes / 10)) if total_boxes > 0 else 0
        if tape_rolls > 0:
            tp = 4.25
            lines.append({
                "name": "Packing Tape",
                "qty": tape_rolls,
                "unit": "RL",
                "rate": tp,
                "detail": "Packing Supplies",
                "amount": round(tape_rolls * tp, 2),
            })

        return lines
