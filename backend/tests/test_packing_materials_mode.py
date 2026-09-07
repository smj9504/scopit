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


def test_calculate_estimate_from_content_pct_of_labor_shape(calc):
    request = _base_request("pct_of_labor")
    result = calc.calculate_estimate_from_content(request)

    assert result.materials_mode == "pct_of_labor"
    assert result.material_details

    # Rolled-up shape: 2-3 lump-sum category lines
    assert len(result.material_details) <= 3
    for m in result.material_details:
        assert m.unit == "LS"
        assert m.quantity == 1

    # The category lines sum to the section total
    line_sum = round(sum(m.total for m in result.material_details), 2)
    assert abs(result.sections["Materials"] - line_sum) < 0.05


def test_materials_mode_omitted_defaults_to_pct_of_labor(calc):
    # Field has a Pydantic default, so omitting it entirely must behave
    # identically to explicitly passing "pct_of_labor".
    request = RoomsEstimateRequest(rooms=_sample_rooms(), crew_size=4)
    result = calc.calculate_estimate_from_content(request)
    assert result.materials_mode == "pct_of_labor"


@pytest.mark.parametrize("markup", [0, 10, 25, 40])
def test_the_two_modes_price_identically(calc, markup):
    """The mode is a presentation choice, not a pricing one.

    Both builders price the same materials from the same catalog and apply
    the same markup, so the Materials total -- and therefore the grand total
    -- must not move when the user flips the toggle. This is the regression
    the modes used to have: pct_of_labor anchored to pack-out labor x 25%
    while itemized summed the catalog, and the two disagreed by up to 10x
    depending on item mix.
    """
    def _run(mode):
        req = RoomsEstimateRequest(
            rooms=_sample_rooms(), crew_size=4,
            materials_mode=mode, material_rate=markup,
        )
        return calc.calculate_estimate_from_content(req)

    itemized = _run("itemized")
    pct = _run("pct_of_labor")

    assert itemized.sections["Materials"] > 0
    assert pct.sections["Materials"] == pytest.approx(
        itemized.sections["Materials"], abs=0.02)
    assert pct.grand_total == pytest.approx(itemized.grand_total, abs=0.05)


def test_markup_scales_both_modes_off_the_same_catalog_cost(calc):
    """A markup lifts both modes off the same base, by the same proportion."""
    def _mat(mode, markup):
        req = RoomsEstimateRequest(
            rooms=_sample_rooms(), crew_size=4,
            materials_mode=mode, material_rate=markup,
        )
        return calc.calculate_estimate_from_content(req).sections["Materials"]

    for mode in ("itemized", "pct_of_labor"):
        base = _mat(mode, 0)
        assert _mat(mode, 20) == pytest.approx(base * 1.20, abs=0.02), mode


def test_pct_of_labor_falls_back_to_labor_when_nothing_is_priced(calc):
    """With no priced materials there is no cost to mark up, so the rolled-up
    mode keeps the legacy labor-anchored figure rather than reporting $0."""
    total, lines, details = calc.build_hybrid_materials(
        pack_out_labor_cost=1000.0, markup_pct=0, materials={},
    )
    assert total == pytest.approx(250.0, abs=0.02)
    assert lines and details


def test_quick_estimate_always_sets_materials_mode_pct_of_labor(calc):
    from app.domains.tools.modules.packing.schemas import QuickEstimateRequest, RoomInput

    request = QuickEstimateRequest(
        rooms=[RoomInput(preset="living_standard", floor="1st", density="normal")],
        crew_size=4,
    )
    result = calc.calculate_estimate(request)
    assert result.materials_mode == "pct_of_labor"
