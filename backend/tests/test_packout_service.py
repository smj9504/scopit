"""
Tests for packout_service — PackoutCalculator estimation engine.

Verifies:
1. Detailed mode: labor scales with item type, weight, volume
2. Lump sum mode: labor scales with large item count and floor
3. Box hours computed correctly
4. Floor coverage multiplier applied
5. Floor/density/contamination multipliers applied
6. Region multiplier applied to labor
7. Storage SF computed from volume (detailed) or flat rate (lump)
8. On-property % reduces storage
9. Pack-back included/excluded correctly
10. Special items added as fixed cost
11. O&P / contingency applied to subtotal
12. Materials section generated with correct box + protection items
13. Lump vs detailed: similar totals for equivalent items
"""

import pytest

from app.domains.tools.modules.packing.schemas import (
    PackoutEstimateRequest,
    PackoutRoomInput,
    NonBoxableItem,
    CustomSpecialItem,
)
from app.domains.tools.modules.packing.packout_service import (
    PackoutCalculator,
    NON_BOXABLE_LABOR,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def calc():
    """Create PackoutCalculator with no DB (uses DEFAULT_PRICES)."""
    return PackoutCalculator(db=None, company_id=None)


def _nb(
    nb_type="furniture_large",
    name="Test Item",
    qty=1,
    volume="large",
    weight="moderate",
    disassembly=False,
    crating=False,
):
    return NonBoxableItem(
        type=nb_type,
        name=name,
        quantity=qty,
        volume=volume,
        weight=weight,
        needs_disassembly=disassembly,
        needs_crating=crating,
    )


def _room(
    name="Living Room",
    floor="1st",
    density="normal",
    contamination="clean",
    non_boxable=None,
    box_counts=None,
    lump_count=None,
    floor_coverage=50.0,
):
    return PackoutRoomInput(
        room_name=name,
        floor=floor,
        density=density,
        contamination=contamination,
        non_boxable_items=non_boxable or [],
        box_counts=box_counts or {
            "small": 0, "medium": 0, "large": 0,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        },
        lump_large_item_count=lump_count,
        floor_coverage_pct=floor_coverage,
    )


def _request(
    rooms=None,
    detail="detailed",
    crew=4,
    storage_mode="off_site",
    repair_months=3.0,
    on_property_pct=0.0,
    include_packback=True,
    include_op=True,
    op_rate=20,
    region="mid_atlantic",
    special_items=None,
    custom_special=None,
):
    return PackoutEstimateRequest(
        rooms=rooms or [],
        detail_level=detail,
        crew_size=crew,
        storage_mode=storage_mode,
        repair_duration_months=repair_months,
        on_property_pct=on_property_pct,
        include_packback=include_packback,
        include_op=include_op,
        op_rate=op_rate,
        region=region,
        special_items=special_items or [],
        custom_special_items=custom_special or [],
    )


# ── Detailed Mode: Labor ─────────────────────────────────────────────────────

class TestDetailedLabor:
    def test_single_furniture_large(self, calc):
        room = _room(non_boxable=[_nb("furniture_large")])
        req = _request(rooms=[room])
        resp = calc.calculate_packout(req)
        est = resp.estimate

        assert est.total_items == 1
        assert est.total_hours > 0
        assert est.sections.get("Pack-Out Labor", 0) > 0

    def test_heavy_item_more_labor_than_moderate(self, calc):
        room_mod = _room(non_boxable=[_nb("furniture_large", weight="moderate")])
        room_heavy = _room(non_boxable=[_nb("furniture_large", weight="heavy")])

        resp_mod = calc.calculate_packout(_request(rooms=[room_mod]))
        resp_heavy = calc.calculate_packout(_request(rooms=[room_heavy]))

        # Heavy (1.4x) should cost more than moderate (1.0x)
        assert resp_heavy.estimate.sections["Pack-Out Labor"] > resp_mod.estimate.sections["Pack-Out Labor"]

    def test_extra_heavy_more_than_heavy(self, calc):
        # Use qty=5 to ensure the weight difference survives rounding
        room_heavy = _room(non_boxable=[_nb("furniture_large", qty=5, weight="heavy")])
        room_xheavy = _room(non_boxable=[_nb("furniture_large", qty=5, weight="extra_heavy")])

        resp_h = calc.calculate_packout(_request(rooms=[room_heavy]))
        resp_xh = calc.calculate_packout(_request(rooms=[room_xheavy]))

        assert resp_xh.estimate.sections["Pack-Out Labor"] > resp_h.estimate.sections["Pack-Out Labor"]

    def test_disassembly_adds_labor(self, calc):
        room_plain = _room(non_boxable=[_nb("furniture_large")])
        room_disasm = _room(non_boxable=[_nb("furniture_large", disassembly=True)])

        resp_plain = calc.calculate_packout(_request(rooms=[room_plain]))
        resp_disasm = calc.calculate_packout(_request(rooms=[room_disasm]))

        assert resp_disasm.estimate.total_hours > resp_plain.estimate.total_hours

    def test_crating_adds_labor(self, calc):
        room_plain = _room(non_boxable=[_nb("specialty")])
        room_crate = _room(non_boxable=[_nb("specialty", crating=True)])

        resp_plain = calc.calculate_packout(_request(rooms=[room_plain]))
        resp_crate = calc.calculate_packout(_request(rooms=[room_crate]))

        assert resp_crate.estimate.total_hours > resp_plain.estimate.total_hours

    def test_quantity_multiplies_labor(self, calc):
        room_1 = _room(non_boxable=[_nb("furniture_medium", qty=1)])
        room_3 = _room(non_boxable=[_nb("furniture_medium", qty=3)])

        resp_1 = calc.calculate_packout(_request(rooms=[room_1]))
        resp_3 = calc.calculate_packout(_request(rooms=[room_3]))

        # 3x items should produce meaningfully more labor
        assert resp_3.estimate.total_hours > resp_1.estimate.total_hours * 2

    def test_all_non_boxable_types_produce_labor(self, calc):
        for nb_type in NON_BOXABLE_LABOR:
            room = _room(non_boxable=[_nb(nb_type)])
            resp = calc.calculate_packout(_request(rooms=[room]))
            assert resp.estimate.total_hours > 0, f"Type {nb_type} produced zero hours"


# ── Lump Sum Mode ────────────────────────────────────────────────────────────

class TestLumpSumLabor:
    def test_lump_count_produces_labor(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum"))
        assert resp.estimate.total_hours > 0

    def test_more_items_more_labor(self, calc):
        room_2 = _room(lump_count=2)
        room_10 = _room(lump_count=10)

        resp_2 = calc.calculate_packout(_request(rooms=[room_2], detail="lump_sum"))
        resp_10 = calc.calculate_packout(_request(rooms=[room_10], detail="lump_sum"))

        assert resp_10.estimate.total_hours > resp_2.estimate.total_hours

    def test_higher_floor_more_labor(self, calc):
        room_1st = _room(lump_count=5, floor="1st")
        room_4th = _room(lump_count=5, floor="4th+")

        resp_1 = calc.calculate_packout(_request(rooms=[room_1st], detail="lump_sum"))
        resp_4 = calc.calculate_packout(_request(rooms=[room_4th], detail="lump_sum"))

        assert resp_4.estimate.total_hours > resp_1.estimate.total_hours


# ── Box Hours ────────────────────────────────────────────────────────────────

class TestBoxHours:
    def test_boxes_add_labor(self, calc):
        room_no_boxes = _room()
        room_boxes = _room(box_counts={
            "small": 10, "medium": 5, "large": 3,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        })

        resp_no = calc.calculate_packout(_request(rooms=[room_no_boxes]))
        resp_yes = calc.calculate_packout(_request(rooms=[room_boxes]))

        assert resp_yes.estimate.total_hours > resp_no.estimate.total_hours

    def test_specialty_boxes_cost_more_time_than_small(self, calc):
        room_small = _room(box_counts={
            "small": 10, "medium": 0, "large": 0,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        })
        room_spec = _room(box_counts={
            "small": 0, "medium": 0, "large": 0,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 10,
        })

        resp_s = calc.calculate_packout(_request(rooms=[room_small]))
        resp_sp = calc.calculate_packout(_request(rooms=[room_spec]))

        # 10 specialty boxes (0.30 hr each) > 10 small boxes (0.08 hr each)
        assert resp_sp.estimate.total_hours > resp_s.estimate.total_hours


# ── Multipliers ──────────────────────────────────────────────────────────────

class TestMultipliers:
    def test_floor_multiplier(self, calc):
        room_1 = _room(lump_count=5, floor="1st")
        room_3 = _room(lump_count=5, floor="3rd")

        resp_1 = calc.calculate_packout(_request(rooms=[room_1], detail="lump_sum"))
        resp_3 = calc.calculate_packout(_request(rooms=[room_3], detail="lump_sum"))

        assert resp_3.estimate.grand_total > resp_1.estimate.grand_total

    def test_density_multiplier(self, calc):
        room_light = _room(lump_count=5, density="light")
        room_heavy = _room(lump_count=5, density="heavy")

        resp_l = calc.calculate_packout(_request(rooms=[room_light], detail="lump_sum"))
        resp_h = calc.calculate_packout(_request(rooms=[room_heavy], detail="lump_sum"))

        assert resp_h.estimate.grand_total > resp_l.estimate.grand_total

    def test_contamination_multiplier(self, calc):
        room_clean = _room(lump_count=5, contamination="clean")
        room_black = _room(lump_count=5, contamination="black_water")

        resp_c = calc.calculate_packout(_request(rooms=[room_clean], detail="lump_sum"))
        resp_b = calc.calculate_packout(_request(rooms=[room_black], detail="lump_sum"))

        assert resp_b.estimate.grand_total > resp_c.estimate.grand_total

    def test_region_multiplier(self, calc):
        # Use larger qty to ensure region difference survives rounding
        room = _room(lump_count=20)

        resp_se = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", region="southeast"))
        resp_ne = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", region="northeast"))

        # Northeast (+15%) > Southeast (-20%)
        assert resp_ne.estimate.sections["Pack-Out Labor"] > resp_se.estimate.sections["Pack-Out Labor"]

    def test_floor_coverage_multiplier(self, calc):
        room_low = _room(lump_count=5, floor_coverage=20.0)
        room_high = _room(lump_count=5, floor_coverage=90.0)

        resp_low = calc.calculate_packout(_request(rooms=[room_low], detail="lump_sum"))
        resp_high = calc.calculate_packout(_request(rooms=[room_high], detail="lump_sum"))

        assert resp_high.estimate.total_hours > resp_low.estimate.total_hours


# ── Storage ──────────────────────────────────────────────────────────────────

class TestStorage:
    def test_detailed_volume_based_storage(self, calc):
        # 1 xlarge item (24 SF) + snapped to nearest unit
        room = _room(non_boxable=[_nb("furniture_large", volume="xlarge")])
        resp = calc.calculate_packout(_request(rooms=[room], repair_months=3))

        assert resp.estimate.storage_sf >= 24
        assert "Storage" in resp.estimate.sections

    def test_lump_sum_flat_rate_storage(self, calc):
        # 5 large items × 12 SF each = 60 SF → snapped to 75 SF
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", repair_months=3))

        assert resp.estimate.storage_sf >= 50

    def test_on_property_reduces_storage(self, calc):
        room = _room(lump_count=10)

        resp_full = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", on_property_pct=0))
        resp_half = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", on_property_pct=50))

        assert resp_half.estimate.storage_sf < resp_full.estimate.storage_sf

    def test_on_site_no_storage_section(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(
            rooms=[room], detail="lump_sum",
            storage_mode="on_site",
        ))

        assert "Storage" not in resp.estimate.sections
        assert "On-Site Relocation" in resp.estimate.sections

    def test_zero_repair_months_no_storage(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(
            rooms=[room], detail="lump_sum", repair_months=0,
        ))

        assert resp.estimate.sections.get("Storage", 0) == 0

    def test_box_sf_adds_to_storage(self, calc):
        room_no = _room()
        room_boxes = _room(box_counts={
            "small": 0, "medium": 0, "large": 20,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        })

        resp_no = calc.calculate_packout(_request(rooms=[room_no], repair_months=3))
        resp_boxes = calc.calculate_packout(_request(rooms=[room_boxes], repair_months=3))

        assert resp_boxes.estimate.storage_sf > resp_no.estimate.storage_sf


# ── Pack-back ────────────────────────────────────────────────────────────────

class TestPackBack:
    def test_packback_included(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", include_packback=True))

        assert "Pack-Back Labor" in resp.estimate.sections
        assert resp.estimate.sections["Pack-Back Labor"] > 0

    def test_packback_excluded(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", include_packback=False))

        assert "Pack-Back Labor" not in resp.estimate.sections


# ── O&P / Contingency ────────────────────────────────────────────────────────

class TestFinancials:
    def test_op_applied(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", include_op=True, op_rate=20))

        assert resp.estimate.op_amount > 0
        expected_op = round(resp.estimate.subtotal * 0.20, 2)
        assert resp.estimate.op_amount == expected_op

    def test_op_excluded(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", include_op=False))

        assert resp.estimate.op_amount == 0

    def test_grand_total_includes_op(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum", include_op=True, op_rate=20))

        expected = round(resp.estimate.subtotal + resp.estimate.op_amount, 2)
        assert resp.estimate.grand_total == expected


# ── Special Items ────────────────────────────────────────────────────────────

class TestSpecialItems:
    def test_piano_special_item(self, calc):
        room = _room(lump_count=1)
        resp = calc.calculate_packout(_request(
            rooms=[room], detail="lump_sum",
            special_items=["piano"],
        ))

        assert "Special Items" in resp.estimate.sections
        assert resp.estimate.sections["Special Items"] == 450.00

    def test_custom_special_item(self, calc):
        room = _room(lump_count=1)
        resp = calc.calculate_packout(_request(
            rooms=[room], detail="lump_sum",
            custom_special=[CustomSpecialItem(name="Wine Cellar Crating", price=850.00)],
        ))

        assert "Special Items" in resp.estimate.sections
        assert resp.estimate.sections["Special Items"] == 850.00


# ── Materials Section ────────────────────────────────────────────────────────

class TestMaterials:
    def test_boxes_in_material_lines(self, calc):
        room = _room(box_counts={
            "small": 5, "medium": 3, "large": 0,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        })
        resp = calc.calculate_packout(_request(rooms=[room]))
        details = resp.estimate.section_details.get("Materials", {})
        lines = details.get("lines", [])

        box_names = [ln["name"] for ln in lines]
        assert any("Small Box" in n for n in box_names)
        assert any("Medium Box" in n for n in box_names)

    def test_detailed_protection_materials(self, calc):
        room = _room(non_boxable=[_nb("furniture_large")])
        resp = calc.calculate_packout(_request(rooms=[room]))
        details = resp.estimate.section_details.get("Materials", {})
        lines = details.get("lines", [])

        mat_names = [ln["name"] for ln in lines]
        # furniture_large should have blankets and furniture pads
        assert any("Blanket" in n for n in mat_names)

    def test_lump_sum_blankets(self, calc):
        room = _room(lump_count=5)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum"))
        details = resp.estimate.section_details.get("Materials", {})
        lines = details.get("lines", [])

        mat_names = [ln["name"] for ln in lines]
        assert any("Blanket" in n for n in mat_names)


# ── Response Shape ───────────────────────────────────────────────────────────

class TestResponseShape:
    def test_estimate_response_fields(self, calc):
        room = _room(lump_count=3, box_counts={
            "small": 5, "medium": 3, "large": 0,
            "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
        })
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum"))

        est = resp.estimate
        assert est.total_rooms == 1
        assert est.total_items > 0
        assert est.crew_size == 4
        assert est.subtotal > 0
        assert est.grand_total >= est.subtotal

        # Packout-specific summary
        assert resp.total_non_boxable_items == 3
        assert resp.total_boxes["small"] == 5
        assert resp.total_boxes["medium"] == 3
        assert resp.effective_storage_months == 3
        assert resp.detail_level.value == "lump_sum"

    def test_section_details_have_lines(self, calc):
        room = _room(lump_count=3)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum"))
        est = resp.estimate

        assert "Pack-Out Labor" in est.section_details
        assert "lines" in est.section_details["Pack-Out Labor"]
        assert len(est.section_details["Pack-Out Labor"]["lines"]) >= 2  # crew + supervisor

    def test_notes_generated(self, calc):
        # Large job should produce workday notes
        room = _room(lump_count=30)
        resp = calc.calculate_packout(_request(rooms=[room], detail="lump_sum"))

        # Should have storage info note at least
        assert len(resp.estimate.notes) >= 1


# ── Multi-room ───────────────────────────────────────────────────────────────

class TestMultiRoom:
    def test_two_rooms_sum_correctly(self, calc):
        room1 = _room(name="Room 1", lump_count=3)
        room2 = _room(name="Room 2", lump_count=5)

        resp_1 = calc.calculate_packout(_request(rooms=[room1], detail="lump_sum"))
        resp_2 = calc.calculate_packout(_request(rooms=[room2], detail="lump_sum"))
        resp_both = calc.calculate_packout(_request(rooms=[room1, room2], detail="lump_sum"))

        assert resp_both.estimate.total_rooms == 2
        assert resp_both.total_non_boxable_items == 8
        # Combined labor should be close to sum of individual
        # (not exact due to shared supervisor hours)
        combined_hours = resp_1.estimate.total_hours + resp_2.estimate.total_hours
        assert abs(resp_both.estimate.total_hours - combined_hours) < combined_hours * 0.1

    def test_room_summaries_per_room(self, calc):
        room1 = _room(name="Kitchen", lump_count=2)
        room2 = _room(name="Bedroom", lump_count=3)

        resp = calc.calculate_packout(_request(rooms=[room1, room2], detail="lump_sum"))
        summaries = resp.estimate.room_summaries

        assert len(summaries) == 2
        assert summaries[0].room_name == "Kitchen"
        assert summaries[1].room_name == "Bedroom"


# ── Lump vs Detailed Consistency ─────────────────────────────────────────────

class TestLumpVsDetailed:
    def test_similar_totals(self, calc):
        """Same logical content — lump sum vs detailed should be in the same ballpark."""
        # Detailed: 3 furniture_large items
        room_detailed = _room(non_boxable=[
            _nb("furniture_large", qty=3, volume="large", weight="moderate"),
        ])
        # Lump: 3 large items
        room_lump = _room(lump_count=3)

        resp_d = calc.calculate_packout(_request(rooms=[room_detailed], detail="detailed"))
        resp_l = calc.calculate_packout(_request(rooms=[room_lump], detail="lump_sum"))

        # Both should produce non-zero results
        assert resp_d.estimate.grand_total > 0
        assert resp_l.estimate.grand_total > 0

        # They won't match exactly but should be within 50% of each other
        ratio = resp_d.estimate.grand_total / resp_l.estimate.grand_total
        assert 0.5 < ratio < 2.0, (
            f"Detailed={resp_d.estimate.grand_total:.2f} vs "
            f"Lump={resp_l.estimate.grand_total:.2f} (ratio={ratio:.2f})"
        )
