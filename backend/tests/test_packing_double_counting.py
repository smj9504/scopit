"""
The same work, material or difficulty must be charged once.

Several parts of the packing estimate charged one thing twice:
  - Photo AI rounded roll-issued materials (stretch wrap, bubble wrap) up to a
    whole roll on every item line, so 16 furniture lines bought 16 rolls of
    stretch wrap for a job that uses 3.
  - Small appliances and small furniture took the two-blanket wrap meant for
    a refrigerator or a dresser; "TV stand" matched the TV rule and was boxed
    and bubble-wrapped like a screen.
  - Extra care for specialty content was charged in the hours AND again in
    the rate: Quick billed a flat 23% of every job at the specialty-handler
    rate, Photo AI billed fragile and electronics hours at the supervisor and
    specialty rates.
  - The pack-out supervisor was sized on hours that included pack-back, which
    has its own supervisor.
  - Photo AI applied the floor factor to packing as well as to the carry.
  - Photo AI dropped the regional rate on every line it priced.
"""
import math
from unittest.mock import MagicMock

import pytest

from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    QuickEstimateRequest,
    RoomContentInput,
    RoomInput,
    RoomsEstimateRequest,
)
from app.domains.tools.modules.packing.service import EstimateCalculator, rh

CREW_TIERS = {
    "Standard Pack-Out", "Fragile / High-Care Items",
    "Specialty / High-Value Items", "Furniture Disassembly", "Appliance Handling",
}


@pytest.fixture
def calc():
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = []
    return EstimateCalculator(db, company_id=None)


def _item(name, category, qty=1, **kw):
    return DetectedContentItem(name=name, category=category, quantity=qty, **kw)


def _enriched(calc, name, category):
    item = _item(name, category)
    calc.enrich_items_for_estimate([item])
    return item


def _room(items, floor="1st", preset_id="living_standard"):
    return RoomContentInput(
        room_name="Room", preset_id=preset_id, floor=floor, items=items,
    )


def _mixed_items():
    return [
        _item("Sofa", "Furniture"), _item("Dresser", "Furniture"),
        _item("Bookcase", "Furniture"), _item("Dining table", "Furniture"),
        _item("Plates", "Kitchenware", 24, is_fragile=True),
        _item("Glasses", "Kitchenware", 12, is_fragile=True),
        _item("Vase", "Fragile", 3, is_fragile=True),
        _item("65in TV", "Electronics", is_high_value=True),
        _item("Game console", "Electronics"),
        _item("Books", "Books", 60),
    ]


def _content(calc, items=None, **kw):
    kw.setdefault("crew_size", 4)
    return calc.calculate_estimate_from_content(RoomsEstimateRequest(
        rooms=[_room(items if items is not None else _mixed_items())], **kw,
    ))


# ── Materials (Photo AI) ─────────────────────────────────────────────


def test_stretch_wrap_is_pooled_across_item_lines(calc):
    """Ten dresser lines share rolls: ceil(10 / 8) = 2, not one roll each."""
    room = _room([_item("Dresser", "Furniture") for _ in range(10)])
    calc.enrich_items_for_estimate(room.items)
    assert calc.aggregate_item_materials([room])["shrink_wrap"] == 2


def test_one_tv_does_not_open_two_bubble_rolls(calc):
    """The TV rule lists bubble wrap twice; that is two wraps, not two rolls."""
    room = _room([_item("65in TV", "Electronics")])
    calc.enrich_items_for_estimate(room.items)
    assert calc.aggregate_item_materials([room])["bubble_12"] == 1


def test_tv_stand_is_packed_as_furniture(calc):
    stand = _enriched(calc, "TV stand", "Furniture")
    assert "tv_box" not in stand.required_materials
    assert "moving_blanket" in stand.required_materials
    assert "tv_box" in _enriched(calc, "65in TV", "Electronics").required_materials


def test_armchair_uses_its_own_rule_not_chair(calc):
    assert "moving_blanket" in _enriched(calc, "Armchair", "Furniture").required_materials
    assert "moving_blanket" not in _enriched(calc, "Dining chair", "Furniture").required_materials


@pytest.mark.parametrize("name", ["Toaster", "Blender", "Coffee maker", "Microwave"])
def test_small_appliance_is_boxed_not_blanket_wrapped(calc, name):
    mats = _enriched(calc, name, "Appliances").required_materials
    assert "moving_blanket" not in mats
    assert "stretch_wrap" not in mats
    assert any(m.endswith("_box") for m in mats)


def test_large_appliance_keeps_blanket_wrap(calc):
    assert _enriched(calc, "Refrigerator", "Appliances").required_materials.count("moving_blanket") == 2


def test_small_furniture_takes_one_blanket(calc):
    assert _enriched(calc, "Nightstand", "Furniture").required_materials.count("moving_blanket") == 1
    assert _enriched(calc, "Dresser", "Furniture").required_materials.count("moving_blanket") == 2


# ── Labor rates: premium in hours, not also in the rate ──────────────


def test_photo_ai_crew_tiers_share_one_rate(calc):
    result = _content(calc, _mixed_items() * 3, crew_size=2)
    lines = result.section_details["Pack-Out Labor"]["lines"]
    tier_rates = {ln["rate"] for ln in lines if ln["name"] in CREW_TIERS}
    names = {ln["name"] for ln in lines}
    assert {"Fragile / High-Care Items", "Specialty / High-Value Items"} <= names
    assert tier_rates == {round(calc.get_price("2825") * 2, 2)}


def test_quick_without_specialty_content_has_no_specialized_line(calc):
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[
            RoomInput(preset="bedroom_standard", hints=["clothing_folded", "furniture"])
            for _ in range(6)
        ],
        crew_size=4,
    ))
    names = {ln["name"] for ln in result.section_details["Pack-Out Labor"]["lines"]}
    assert "Specialized Handling" not in names


def test_quick_specialized_handling_bills_at_crew_rate(calc):
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in (
            "bedroom_master", "living_standard", "dining_standard", "kitchen_china",
            "office_library", "bedroom_standard",
        )],
        crew_size=4,
    ))
    lines = {ln["name"]: ln for ln in result.section_details["Pack-Out Labor"]["lines"]}
    assert "Specialized Handling" in lines
    assert lines["Specialized Handling"]["rate"] == lines["Pack-Out Crew Labor"]["rate"]
    # Only the time the content added, never the old flat 23%.
    po_hours = lines["Specialized Handling"]["qty"] + lines["Pack-Out Crew Labor"]["qty"]
    assert lines["Specialized Handling"]["qty"] < po_hours * 0.15


# ── Supervisor sized on pack-out only ────────────────────────────────


def test_quick_pack_out_supervisor_ignores_pack_back_hours(calc):
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in (
            "bedroom_master", "bedroom_standard", "bedroom_kids", "living_standard",
            "kitchen_standard", "dining_standard", "office_standard", "basement_finished",
        )],
        crew_size=4, include_packback=True,
    ))
    lines = {ln["name"]: ln for ln in result.section_details["Pack-Out Labor"]["lines"]}
    po_hours = sum(
        lines[n]["qty"] for n in ("Pack-Out Crew Labor", "Specialized Handling") if n in lines
    )
    assert lines["Supervisor/Foreman"]["qty"] == max(1.0, rh(po_hours * 0.1))


def test_photo_ai_pack_out_supervisor_shrinks_with_pack_back(calc):
    items = _mixed_items() * 4
    with_pb = _content(calc, items, crew_size=2, include_packback=True)
    without_pb = _content(calc, items, crew_size=2, include_packback=False)

    def sv(result):
        return next(
            ln["qty"] for ln in result.section_details["Pack-Out Labor"]["lines"]
            if ln["name"] == "Supervision"
        )
    assert sv(with_pb) < sv(without_pb)


# ── Floor weighs the carry, not the packing ──────────────────────────


def test_photo_ai_floor_moves_carry_not_packing(calc):
    items = [_item("Dresser", "Furniture") for _ in range(12)]
    rooms = {}
    for floor in ("1st", "3rd"):
        room = _room([i.model_copy() for i in items], floor=floor)
        calc.enrich_items_for_estimate(room.items)
        rooms[floor] = room
    packing = {f: sum(calc.classify_labor_hours([r]).values()) for f, r in rooms.items()}
    carry = {f: calc._calculate_relocation_hours([r])[0] for f, r in rooms.items()}
    assert packing["3rd"] == packing["1st"]
    assert carry["3rd"] > carry["1st"]


# ── Regional rate reaches the lines ──────────────────────────────────


def test_photo_ai_pack_out_labor_follows_region(calc):
    labor = {
        region: _content(calc, region=region).sections["Pack-Out Labor"]
        for region in ("southeast", "mid_atlantic", "northeast")
    }
    assert labor["southeast"] < labor["mid_atlantic"] < labor["northeast"]
    assert math.isclose(labor["southeast"] / labor["mid_atlantic"], 0.80, rel_tol=0.01)


# ── Storage: contents by volume, the same basis as the room presets ──────────


def _three_rooms(use_presets):
    living = [
        _item("Sofa", "Furniture"), _item("Loveseat", "Furniture"),
        _item("Coffee table", "Furniture"), _item("End table", "Furniture", 2),
        _item("Bookcase", "Furniture"), _item("65in TV", "Electronics"),
        _item("Books", "Books", 40), _item("Decor items", "Other", 6),
    ]
    kitchen = [
        _item("Plates", "Kitchenware", 12), _item("Bowls", "Kitchenware", 8),
        _item("Glasses", "Kitchenware", 12), _item("Dining table", "Furniture"),
        _item("Dining chair", "Furniture", 4), _item("Toaster", "Appliances"),
    ]
    bedroom = [
        _item("Queen bed frame", "Furniture"), _item("Queen mattress", "Furniture"),
        _item("Dresser", "Furniture"), _item("Nightstand", "Furniture", 2),
        _item("Hanging clothes", "Clothing", 40), _item("Folded clothes", "Clothing", 30),
    ]
    rooms = [
        RoomContentInput(room_name=name, preset_id=preset if use_presets else None, items=items)
        for name, preset, items in (
            ("Living Room", "living_standard", living),
            ("Kitchen", "kitchen_standard", kitchen),
            ("Master Bedroom", "bedroom_master", bedroom),
        )
    ]
    return rooms


def test_custom_named_rooms_size_storage_like_preset_rooms(calc):
    """The same three rooms needed a 10x40 when entered by name and a 5x15
    when picked from presets, because every book and garment took 1 SF."""
    custom = _three_rooms(use_presets=False)
    for room in custom:
        calc.enrich_items_for_estimate(room.items)
    preset_sf = calc.estimate_storage_sf_from_items(_three_rooms(use_presets=True))
    custom_sf = calc.estimate_storage_sf_from_items(custom)
    assert custom_sf <= preset_sf * 1.5


def test_boxed_contents_take_the_boxes_volume(calc):
    books = _enriched(calc, "Books", "Books")
    books.quantity = 40
    # 40 books at 20 per book box = 2 boxes of 1.5 cu ft
    assert calc._item_storage_cuft(books) == pytest.approx(3.0)


def test_dining_chair_is_not_sized_like_a_sofa(calc):
    assert _enriched(calc, "Dining chair", "Furniture").size == "M"
    assert _enriched(calc, "Armchair", "Furniture").size == "L"


# ── Materials: general boxes pooled per room ─────────────────────────


def test_dish_packs_are_pooled_within_a_room(calc):
    """Plates, bowls, glasses and mugs share dish packs: 38 pieces at 12 per
    pack is 4 packs, not one per line plus rounding."""
    room = _room([
        _item("Plates", "Kitchenware", 12), _item("Bowls", "Kitchenware", 8),
        _item("Glasses", "Kitchenware", 12), _item("Mugs", "Kitchenware", 6),
        _item("Serving dish", "Kitchenware", 1), _item("Teapot", "Kitchenware", 1),
    ], preset_id="kitchen_standard")
    calc.enrich_items_for_estimate(room.items)
    assert calc.aggregate_item_materials([room])["box_dish"] == math.ceil(40 / 12)


def test_bagged_mattress_takes_no_blanket(calc):
    assert "moving_blanket" not in _enriched(calc, "Queen mattress", "Furniture").required_materials
