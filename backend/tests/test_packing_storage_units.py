"""
Storage must be billed across as many units as the contents actually need.

snap_to_storage_unit() used to cap at the largest standard unit (10x30 =
300 SF), so a job needing more space than one unit was billed for one unit and
the overflow was simply not charged. A large, heavily-loaded home reaches
~424 raw SF, which billed as 300 SF -- roughly $800 unbilled over three
months. Self-storage rents whole units, so the fix is to allocate several.

Nothing guarded this behaviour before, so these tests also pin the unchanged
single-unit path: the overwhelming majority of jobs fit one unit and must bill
exactly as they always have.
"""
from unittest.mock import MagicMock

import pytest

from app.domains.tools.modules.packing.schemas import (
    QuickEstimateRequest,
    RoomInput,
    StagingType,
)
from app.domains.tools.modules.packing.service import (
    STANDARD_UNIT_SIZES,
    STORAGE_SETUP_BY_SIZE,
    EstimateCalculator,
    allocate_storage_units,
    build_storage_section_detail,
    get_storage_setup_fee,
    snap_to_storage_unit,
)

LARGEST = STANDARD_UNIT_SIZES[-1]

# Captured from the calculator before the multi-unit change. Every one of
# these fits a single unit, so all three must stay bit-identical.
GOLDEN_SINGLE_UNIT = {
    "2BR": {
        "presets": [
            "bedroom_standard", "bedroom_standard",
            "living_standard", "kitchen_standard",
        ],
        "storage_sf": 100,
        "total": 739.0,
        "lines": [
            ("Climate-Controlled Storage — 10×10 unit (100 SF)", 3, "MO", 218.0, 654.0),
            ("Storage Setup & Inventory Placement", 1, "EA", 85.0, 85.0),
        ],
    },
    "3BR": {
        "presets": [
            "bedroom_master", "bedroom_standard", "bedroom_standard",
            "living_standard", "kitchen_standard", "dining_standard",
        ],
        "storage_sf": 200,
        "total": 1439.0,
        "lines": [
            ("Climate-Controlled Storage — 10×20 unit (200 SF)", 3, "MO", 436.0, 1308.0),
            ("Storage Setup & Inventory Placement", 1, "EA", 131.0, 131.0),
        ],
    },
    "4BR": {
        "presets": [
            "bedroom_master", "bedroom_standard", "bedroom_standard",
            "bedroom_guest", "living_standard", "kitchen_standard",
            "dining_standard", "office_standard",
        ],
        "storage_sf": 250,
        "total": 1787.0,
        "lines": [
            ("Climate-Controlled Storage — 10×25 unit (250 SF)", 3, "MO", 545.0, 1635.0),
            ("Storage Setup & Inventory Placement", 1, "EA", 152.0, 152.0),
        ],
    },
}


@pytest.fixture
def calc():
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = []
    return EstimateCalculator(db, company_id=None)


def _storage(result):
    lines = (result.section_details or {}).get("Storage", {}).get("lines", [])
    return [
        (ln["name"], ln["qty"], ln["unit"], ln["rate"], ln["amount"]) for ln in lines
    ]


# ── The single-unit path must not move ───────────────────────────────────────

@pytest.mark.parametrize("home", sorted(GOLDEN_SINGLE_UNIT))
def test_single_unit_jobs_bill_exactly_as_before(calc, home):
    spec = GOLDEN_SINGLE_UNIT[home]
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in spec["presets"]],
        crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=3,
    ))
    assert result.storage_sf == spec["storage_sf"]
    assert result.sections["Storage"] == pytest.approx(spec["total"], abs=0.01)
    assert _storage(result) == spec["lines"]


@pytest.mark.parametrize("raw", [1, 25, 26, 50, 99, 100, 250, 299, 300])
def test_within_one_unit_allocates_exactly_one(raw):
    units = allocate_storage_units(raw)
    assert len(units) == 1
    assert units[0] >= raw, "a unit must hold the contents"
    assert units[0] in STANDARD_UNIT_SIZES
    # Same value the old capped implementation produced for these inputs.
    assert snap_to_storage_unit(raw) == units[0]


def test_no_storage_needed():
    assert allocate_storage_units(0) == []
    assert snap_to_storage_unit(0) == 0
    assert get_storage_setup_fee(0) == 0.0


@pytest.mark.parametrize("raw", [-1, -100])
def test_negative_sf_is_not_storage(raw):
    assert allocate_storage_units(raw) == []
    assert snap_to_storage_unit(raw) == 0


# ── Beyond one unit: the bug ─────────────────────────────────────────────────

def test_overflow_is_no_longer_dropped():
    """The regression itself: 301 SF used to bill as 300."""
    assert snap_to_storage_unit(LARGEST + 1) > LARGEST


@pytest.mark.parametrize("raw", [301, 352, 424, 600, 900])
def test_allocation_always_holds_the_contents(raw):
    units = allocate_storage_units(raw)
    assert sum(units) >= raw, "billed SF must cover the contents"
    assert len(units) >= 2
    assert all(u in STANDARD_UNIT_SIZES for u in units)


def test_realistic_large_home_allocation():
    """4BR + basement at heavy density lands near 424 raw SF."""
    assert allocate_storage_units(424) == [300, 150]
    assert snap_to_storage_unit(424) == 450


@pytest.mark.parametrize("raw", [301, 424, 900, 2250])
def test_waste_never_exceeds_one_unit(raw):
    """Rounding up is expected; billing a whole extra unit of slack is not."""
    total = snap_to_storage_unit(raw)
    assert total - raw < LARGEST


def test_absurd_input_terminates_and_stays_sane():
    units = allocate_storage_units(100_000)
    assert units, "must still allocate something"
    assert len(units) <= 41, "guard must bound the unit count"


# ── Setup fee ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("size", STANDARD_UNIT_SIZES)
def test_setup_fee_unchanged_for_each_standard_unit(size):
    assert get_storage_setup_fee(size) == STORAGE_SETUP_BY_SIZE[size]


def test_setup_fee_is_charged_per_unit():
    """A multi-unit job pays setup on each physical unit."""
    fee = get_storage_setup_fee(snap_to_storage_unit(424))  # 300 + 150
    assert fee == pytest.approx(
        STORAGE_SETUP_BY_SIZE[300] + STORAGE_SETUP_BY_SIZE[150], abs=0.01
    )
    assert fee > STORAGE_SETUP_BY_SIZE[LARGEST], "must exceed a single unit's fee"


def test_setup_fee_rises_with_more_units():
    fees = [get_storage_setup_fee(snap_to_storage_unit(r)) for r in (300, 600, 900)]
    assert fees == sorted(fees) and len(set(fees)) == 3


# ── Display ──────────────────────────────────────────────────────────────────

def test_single_unit_line_names_the_unit():
    detail = build_storage_section_detail(100, 2.18, 3, 85.0, 739.0)
    name = detail["lines"][0]["name"]
    assert "10×10 unit (100 SF)" in name
    assert "units" not in name, "one unit must not read as plural"


def test_multi_unit_line_lists_every_unit():
    total = snap_to_storage_unit(424)
    detail = build_storage_section_detail(
        total, 2.18, 3, get_storage_setup_fee(total), 0.0
    )
    name = detail["lines"][0]["name"]
    assert "2 units" in name
    assert "10×30 + 10×15" in name, "the adjuster must see what is rented"
    assert f"{total} SF" in name
    # The setup line explains what it is charging for.
    assert "2 units" in detail["lines"][1]["detail"]


def test_month_amount_tracks_the_full_allocated_sf():
    total = snap_to_storage_unit(424)
    detail = build_storage_section_detail(total, 2.18, 3, 0.0, 0.0)
    monthly = detail["lines"][0]
    assert monthly["amount"] == pytest.approx(total * 2.18 * 3, abs=0.01)
