"""
Tests for the Photo AI "materials_mode" toggle: pct_of_labor (existing hybrid
% model) vs itemized (real per-box/per-material pricing, one line per SKU).

Uses EstimateCalculator(db, company_id=None), which falls back entirely to
DEFAULT_PRICES and never touches the database -- these are pure calculation
tests, no live DB writes needed.
"""
import pytest

from app.core.database import SessionLocal
from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    RoomContentInput,
    RoomsEstimateRequest,
)
from app.domains.tools.modules.packing.service import (
    MATERIAL_CODES,
    EstimateCalculator,
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def calc(db):
    return EstimateCalculator(db, company_id=None)


def _sample_rooms():
    """A couple of AI-detected rooms with real required_materials, enough
    to exercise both boxable and protective-material paths."""
    living_room = RoomContentInput(
        room_name="Living Room",
        density="normal",
        floor="1st",
        items=[
            DetectedContentItem(
                name="Sofa",
                category="Furniture",
                quantity=1,
                required_materials=["sofa_cover", "blanket", "blanket", "shrink_wrap"],
            ),
            DetectedContentItem(
                name="Books",
                category="Books",
                quantity=30,
                required_materials=["box_small"] * 30,
            ),
        ],
    )
    kitchen = RoomContentInput(
        room_name="Kitchen",
        density="normal",
        floor="1st",
        items=[
            DetectedContentItem(
                name="Dishes",
                category="Kitchenware",
                quantity=20,
                required_materials=["box_dish"] * 20,
            ),
        ],
    )
    return [living_room, kitchen]


def _base_request(materials_mode: str) -> RoomsEstimateRequest:
    return RoomsEstimateRequest(
        rooms=_sample_rooms(),
        crew_size=4,
        materials_mode=materials_mode,
    )


# ── build_itemized_materials() ──────────────────────────────────────────

def test_build_itemized_materials_basic(calc):
    materials = {"box_small": 5, "blanket": 3}
    total, lines, details = calc.build_itemized_materials(materials)

    assert total > 0
    # One line per material key present, in priced-line format
    assert len(lines) == 2
    assert len(details) == 2

    small_box_price = calc.get_price(MATERIAL_CODES["box_small"])
    blanket_price = calc.get_price(MATERIAL_CODES["blanket"])

    small_box_line = next(d for d in details if d["code"] == MATERIAL_CODES["box_small"])
    assert small_box_line["quantity"] == 5
    assert small_box_line["unit"] == "EA"
    assert small_box_line["unit_price"] == small_box_price
    assert small_box_line["total"] == round(5 * small_box_price, 2)

    blanket_line = next(d for d in details if d["code"] == MATERIAL_CODES["blanket"])
    assert blanket_line["quantity"] == 3
    assert blanket_line["total"] == round(3 * blanket_price, 2)

    assert total == round(small_box_line["total"] + blanket_line["total"], 2)


def test_build_itemized_materials_zero_qty_skipped(calc):
    materials = {"box_small": 0, "blanket": 2}
    total, lines, details = calc.build_itemized_materials(materials)
    assert len(lines) == 1
    assert len(details) == 1
    assert details[0]["code"] == MATERIAL_CODES["blanket"]


def test_build_itemized_materials_unknown_key_skipped_not_crashed(calc):
    materials = {"box_small": 2, "totally_unknown_material_xyz": 99}
    total, lines, details = calc.build_itemized_materials(materials)
    # Unknown key produces no line and does not raise
    assert len(lines) == 1
    assert details[0]["code"] == MATERIAL_CODES["box_small"]


def test_build_itemized_materials_sum_matches_total(calc):
    materials = {"box_small": 10, "box_medium": 4, "blanket": 6, "packing_tape": 3}
    total, lines, details = calc.build_itemized_materials(materials)
    assert total == round(sum(d["total"] for d in details), 2)
    assert total == round(sum(ln["amount"] for ln in lines), 2)


# ── calculate_estimate_from_content(): materials_mode branch ───────────

def test_calculate_estimate_from_content_itemized_mode(calc):
    request = _base_request("itemized")
    result = calc.calculate_estimate_from_content(request)

    assert result.materials_mode == "itemized"
    assert result.material_details, "itemized mode must produce material lines"

    # Itemized lines have real quantities/units, not the LS/qty=1 hybrid shape
    for m in result.material_details:
        assert m.quantity >= 1
        assert m.unit != "LS"

    # Materials section total must equal the literal sum of line totals,
    # not a % of pack-out labor.
    line_sum = round(sum(m.total for m in result.material_details), 2)
    assert result.sections["Materials"] == line_sum


def test_calculate_estimate_from_content_pct_of_labor_default_unchanged(calc):
    request = _base_request("pct_of_labor")
    result = calc.calculate_estimate_from_content(request)

    assert result.materials_mode == "pct_of_labor"
    assert result.material_details

    # Existing hybrid shape: 2-3 lump-sum category lines
    assert len(result.material_details) <= 3
    for m in result.material_details:
        assert m.unit == "LS"
        assert m.quantity == 1

    # Materials total is anchored to pack-out labor cost x rate% -- allow a
    # small tolerance since `sections["Pack-Out Labor"]` is itself reconciled
    # from rounded line-item sums, not the raw float used internally.
    pack_out_labor = result.sections.get("Pack-Out Labor", 0)
    material_rate_pct = request.material_rate
    expected = round(pack_out_labor * material_rate_pct / 100.0, 2)
    assert abs(result.sections["Materials"] - expected) < 0.05


def test_materials_mode_omitted_defaults_to_pct_of_labor(calc):
    # Field has a Pydantic default, so omitting it entirely must behave
    # identically to explicitly passing "pct_of_labor".
    request = RoomsEstimateRequest(rooms=_sample_rooms(), crew_size=4)
    result = calc.calculate_estimate_from_content(request)
    assert result.materials_mode == "pct_of_labor"


def test_itemized_vs_pct_of_labor_produce_different_bases(calc):
    itemized = calc.calculate_estimate_from_content(_base_request("itemized"))
    pct = calc.calculate_estimate_from_content(_base_request("pct_of_labor"))

    assert itemized.sections["Materials"] > 0
    assert pct.sections["Materials"] > 0
    assert itemized.grand_total > 0
    assert pct.grand_total > 0
    # Not required to match -- different calculation bases entirely.


def test_quick_estimate_always_sets_materials_mode_pct_of_labor(calc):
    from app.domains.tools.modules.packing.schemas import QuickEstimateRequest, RoomInput

    request = QuickEstimateRequest(
        rooms=[RoomInput(preset="living_standard", floor="1st", density="normal")],
        crew_size=4,
    )
    result = calc.calculate_estimate(request)
    assert result.materials_mode == "pct_of_labor"
