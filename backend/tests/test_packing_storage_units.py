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
    STORAGE_RATE_MULT_BY_SIZE,
    STORAGE_SETUP_BY_SIZE,
    EstimateCalculator,
    allocate_storage_units,
    build_storage_section_detail,
    get_storage_setup_fee,
    snap_to_storage_unit,
    storage_monthly_rent,
)

ANCHOR = 1.35  # price code 2840, expressed at the 10x10 anchor

LARGEST = STANDARD_UNIT_SIZES[-1]

# Captured from the calculator after storage was reconciled to market rates.
# Every one of these fits a single unit. The figures moved deliberately: room
# sizing was rebased onto operator-published capacity and rent onto the
# size-tiered market curve, so these pin the corrected numbers.
GOLDEN_SINGLE_UNIT = {
    "2BR": {
        "presets": [
            "bedroom_standard", "bedroom_standard",
            "living_standard", "kitchen_standard",
        ],
        "storage_sf": 100,
        "total": 490.0,
        "lines": [
            ("Climate-Controlled Storage — 10×10 unit (100 SF)", 3, "MO", 135.0, 405.0),
            ("Storage Setup & Inventory Placement", 1, "EA", 85.0, 85.0),
        ],
    },
    "3BR": {
        "presets": [
            "bedroom_master", "bedroom_standard", "bedroom_standard",
            "living_standard", "kitchen_standard", "dining_standard",
        ],
        "storage_sf": 150,
        "total": 601.09,
        "lines": [
            ("Climate-Controlled Storage — 10×15 unit (150 SF)", 3, "MO", 164.03, 492.09),
            ("Storage Setup & Inventory Placement", 1, "EA", 109.0, 109.0),
        ],
    },
    "4BR": {
        "presets": [
            "bedroom_master", "bedroom_standard", "bedroom_standard",
            "bedroom_guest", "living_standard", "kitchen_standard",
            "dining_standard", "office_standard",
        ],
        "storage_sf": 200,
        "total": 803.30,
        "lines": [
            ("Climate-Controlled Storage — 10×20 unit (200 SF)", 3, "MO", 224.10, 672.30),
            ("Storage Setup & Inventory Placement", 1, "EA", 131.0, 131.0),
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
def test_single_unit_jobs_bill_the_expected_amount(calc, home):
    spec = GOLDEN_SINGLE_UNIT[home]
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in spec["presets"]],
        crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=3,
    ))
    assert result.storage_sf == spec["storage_sf"]
    assert result.sections["Storage"] == pytest.approx(spec["total"], abs=0.01)
    assert _storage(result) == spec["lines"]


@pytest.mark.parametrize("raw", [1, 25, 26, 50, 99, 100, 250, 299, 300, 400])
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
    """The regression itself: SF past the largest unit used to be dropped."""
    assert snap_to_storage_unit(LARGEST + 1) > LARGEST


@pytest.mark.parametrize("raw", [401, 452, 600, 900])
def test_allocation_always_holds_the_contents(raw):
    units = allocate_storage_units(raw)
    assert sum(units) >= raw, "billed SF must cover the contents"
    assert len(units) >= 2
    assert all(u in STANDARD_UNIT_SIZES for u in units)


def test_realistic_large_home_allocation():
    """4BR + basement at heavy density lands near 424 raw SF.

    A 10x40 is stocked by the major operators, so this rents one against a
    small overflow unit rather than a 10x30 beside a 10x15 -- 425 billed SF
    where the old size list charged 450.
    """
    assert allocate_storage_units(424) == [400, 25]
    assert snap_to_storage_unit(424) == 425
    assert snap_to_storage_unit(424) < 450, "must beat the pre-10x40 allocation"


@pytest.mark.parametrize("raw", [401, 424, 900, 2250])
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
    fee = get_storage_setup_fee(snap_to_storage_unit(700))  # 400 + 300
    assert fee == pytest.approx(
        STORAGE_SETUP_BY_SIZE[400] + STORAGE_SETUP_BY_SIZE[300], abs=0.01
    )
    assert fee > STORAGE_SETUP_BY_SIZE[LARGEST], "must exceed a single unit's fee"


def test_setup_fee_rises_with_more_units():
    fees = [get_storage_setup_fee(snap_to_storage_unit(r)) for r in (400, 800, 1200)]
    assert fees == sorted(fees) and len(set(fees)) == 3


# ── Display ──────────────────────────────────────────────────────────────────

def test_single_unit_line_names_the_unit():
    detail = build_storage_section_detail(100, 1.35, 3, 85.0, 490.0)
    name = detail["lines"][0]["name"]
    assert "10×10 unit (100 SF)" in name
    assert "units" not in name, "one unit must not read as plural"


def test_multi_unit_line_lists_every_unit():
    total = snap_to_storage_unit(700)
    detail = build_storage_section_detail(
        total, 1.35, 3, get_storage_setup_fee(total), 0.0
    )
    name = detail["lines"][0]["name"]
    assert "2 units" in name
    assert "10×40 + 10×30" in name, "the adjuster must see what is rented"
    assert f"{total} SF" in name
    # The setup line explains what it is charging for.
    assert "2 units" in detail["lines"][1]["detail"]


def test_month_amount_tracks_the_full_allocated_sf():
    """Every allocated unit is billed -- none of the SF falls off the line."""
    total = snap_to_storage_unit(424)
    detail = build_storage_section_detail(total, ANCHOR, 3, 0.0, 0.0)
    monthly = detail["lines"][0]
    assert monthly["amount"] == pytest.approx(
        storage_monthly_rent(total, ANCHOR) * 3, abs=0.01
    )


# ── Rent must be applied exactly once ────────────────────────────────────────
#
# Rent is size-tiered and the Storage lines are rebuilt for display after the
# total is computed. Both read the same helper, so the risk is that one path
# scales by the size multiplier and the other scales again, or not at all.
# These lock the two together.

@pytest.mark.parametrize("raw", [40, 100, 200, 300, 424, 700, 1000])
@pytest.mark.parametrize("months", [1, 3, 12])
def test_detail_line_equals_the_rent_charged(raw, months):
    """The displayed Storage line must equal the rent folded into the total."""
    sf = snap_to_storage_unit(raw)
    rent = storage_monthly_rent(sf, ANCHOR)
    detail = build_storage_section_detail(
        sf, ANCHOR, months, get_storage_setup_fee(sf), 0.0
    )
    rent_line = detail["lines"][0]
    assert rent_line["rate"] == pytest.approx(rent, abs=0.01)
    assert rent_line["amount"] == pytest.approx(rent * months, abs=0.01)


@pytest.mark.parametrize("size", STANDARD_UNIT_SIZES)
def test_rent_applies_the_size_multiplier_once(size):
    """Exactly one multiplier, not one squared and not none at all."""
    expected = size * ANCHOR * STORAGE_RATE_MULT_BY_SIZE[size]
    assert storage_monthly_rent(size, ANCHOR) == pytest.approx(expected, abs=0.01)


def test_multi_unit_rent_prices_each_unit_at_its_own_size():
    """A split job is priced per unit, not at one blended rate."""
    total = snap_to_storage_unit(700)  # 400 + 300
    assert allocate_storage_units(total) == [400, 300]
    expected = (
        400 * ANCHOR * STORAGE_RATE_MULT_BY_SIZE[400]
        + 300 * ANCHOR * STORAGE_RATE_MULT_BY_SIZE[300]
    )
    assert storage_monthly_rent(total, ANCHOR) == pytest.approx(expected, abs=0.01)


def test_rent_scales_linearly_with_the_company_rate():
    """A company's own 2840 price still drives the price, undistorted."""
    assert storage_monthly_rent(200, 2.70) == pytest.approx(
        storage_monthly_rent(200, 1.35) * 2, abs=0.01
    )


def test_no_rent_without_storage_or_rate():
    assert storage_monthly_rent(0, ANCHOR) == 0.0
    assert storage_monthly_rent(200, 0) == 0.0


@pytest.mark.parametrize("home", sorted(GOLDEN_SINGLE_UNIT))
def test_storage_section_total_matches_its_lines(calc, home):
    """No drift between the section total and the lines that justify it."""
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in GOLDEN_SINGLE_UNIT[home]["presets"]],
        crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=3,
    ))
    lines = result.section_details["Storage"]["lines"]
    assert result.sections["Storage"] == pytest.approx(
        sum(ln["amount"] for ln in lines), abs=0.01
    )


# ── Sizing must match published operator capacity ────────────────────────────

def test_per_sf_rate_falls_as_units_grow():
    """Large units cost less per SF; a flat rate is what overcharged them."""
    rates = [
        storage_monthly_rent(sf, ANCHOR) / sf for sf in (25, 50, 100, 300)
    ]
    assert rates == sorted(rates, reverse=True)
    # Past 10x10 the market flattens rather than continuing to fall, so the
    # large sizes are checked as a plateau well under the small-unit rate.
    large = [storage_monthly_rent(sf, ANCHOR) / sf for sf in (150, 200, 250, 300, 400)]
    assert max(large) - min(large) < 0.05
    assert max(large) < storage_monthly_rent(100, ANCHOR) / 100


def test_large_unit_is_not_priced_like_a_small_one():
    """A 10x30 must not cost 12x a 5x5: that was the flat-rate error."""
    small = storage_monthly_rent(25, ANCHOR)
    large = storage_monthly_rent(300, ANCHOR)
    assert large < small * 12 * 0.7


def test_three_bedroom_house_fits_the_unit_operators_publish():
    """Operators size a 3-bed house at 10x20; it used to bill a 10x30."""
    from app.domains.tools.modules.packing.service import SF_PER_ROOM_SIZE
    rooms = (
        ["large"] * 6      # 3 bed, living, kitchen, dining
        + ["small"] * 3    # 2 bath, closet
        + ["xlarge"] * 2   # garage, basement
    )
    raw = sum(SF_PER_ROOM_SIZE[r] for r in rooms)
    assert snap_to_storage_unit(raw) <= 250, "a routine 3BR must not need a 10x30"
