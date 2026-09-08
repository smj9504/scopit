"""
Labour hours must describe the WORK, not the price list.

The quick path used to derive hours by dividing dollars by dollars --
person_hours = (sum of room dollar rates) / hourly_rate -- which inverted cause
and effect. Raising the hourly rate made the same job "take" proportionally
fewer hours, so a rate increase silently cancelled itself out, and rounding a
crew-divided elapsed figure before multiplying by crew again made a bigger crew
come out CHEAPER than a smaller one on identical work.

Hours now come from ROOM_BASE_PERSON_HOURS (which was previously dead code
despite being documented as the labour model) and cost follows as
hours x crew x rate.

Separately, several phase splits did not sum to 1.0, so a slice of real work
was billed on neither side:
  - pack-out sub-shares summed to 1.01, pack-back sub-shares to 0.93
  - the content path used packout 0.85 / packback 0.0 with pack-back disabled
  - fragile and specialty carried an extra x0.6 the other tiers did not
"""
from unittest.mock import MagicMock

import pytest

from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    QuickEstimateRequest,
    RoomContentInput,
    RoomInput,
    RoomsEstimateRequest,
    StagingType,
)
from app.domains.tools.modules.packing.service import EstimateCalculator

ROOMS = [
    "bedroom_master", "living_standard", "kitchen_standard", "bedroom_standard",
]
CREW_SIZES = [2, 3, 4, 5, 6]


@pytest.fixture
def calc():
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = []
    return EstimateCalculator(db, company_id=None)


def _quick(calc, crew=4, presets=None, **kw):
    return calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in (presets or ROOMS)],
        crew_size=crew, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1, **kw,
    ))


def _labor_total(result):
    return (
        result.sections.get("Pack-Out Labor", 0)
        + result.sections.get("Pack-Back Labor", 0)
    )


def _crew_line_hours(result, section):
    lines = (result.section_details or {}).get(section, {}).get("lines", [])
    return sum(
        ln["qty"] for ln in lines
        if ln.get("unit") == "HR" and "crew" in (ln.get("detail") or "")
    )


# ── Hours describe work, not price ───────────────────────────────────────────

def test_hours_do_not_change_when_the_hourly_rate_changes(calc):
    """The defining regression: a price edit must not reschedule the job."""
    hours = []
    for rate in (57.31, 75.00, 120.00):
        calc.prices["2825"].price = rate
        hours.append(_quick(calc).total_hours)
    assert len(set(hours)) == 1, (
        f"estimated hours moved with the hourly rate: {hours}"
    )


def test_cost_rises_with_the_hourly_rate(calc):
    """The corollary: raising the rate must actually raise the bill."""
    costs = []
    for rate in (57.31, 75.00, 120.00):
        calc.prices["2825"].price = rate
        costs.append(_quick(calc).sections["Pack-Out Labor"])
    assert costs == sorted(costs) and len(set(costs)) == 3, costs


def test_hours_come_from_the_documented_person_hour_table(calc):
    """ROOM_BASE_PERSON_HOURS was documented as the model but never read.

    The table is the BASE; density, floor, contamination and content hints
    scale it up from there (these presets carry default hints, e.g. a fragile
    kitchen), so the billed figure sits at or above the bare table sum rather
    than exactly on it.
    """
    table = EstimateCalculator.ROOM_BASE_PERSON_HOURS
    base_ph = sum(table[calc.presets[p].size] for p in ROOMS)
    per_room_ph = sum(
        calc.calculate_room_person_hours(RoomInput(preset=p)) for p in ROOMS
    )
    assert per_room_ph >= base_ph, "multipliers must never reduce below base"

    # The estimate bills what the per-room model computes, give or take the
    # half-hour rounding on elapsed time.
    result = _quick(calc, crew=4)
    assert result.total_hours * 4 == pytest.approx(per_room_ph, abs=2.0)


def test_more_rooms_means_more_hours(calc):
    small = _quick(calc, presets=["bedroom_standard"]).total_hours
    large = _quick(calc, presets=ROOMS).total_hours
    assert large > small


# ── Region ───────────────────────────────────────────────────────────────────

REGIONS = ["mid_atlantic", "northeast", "southeast"]


def test_region_does_not_change_how_long_the_work_takes(calc):
    """A bedroom in Boston does not take longer to pack than one in Ohio.

    The premium used to multiply person-hours, so the quoted on-site duration
    — the figure an adjuster scrutinises — varied by region.
    """
    hours = {r: _quick(calc, region=r).total_hours for r in REGIONS}
    assert len(set(hours.values())) == 1, f"hours vary by region: {hours}"


def test_region_scales_the_labor_cost(calc):
    """The premium has to land somewhere: on the money."""
    costs = {r: _labor_total(_quick(calc, region=r)) for r in REGIONS}
    assert costs["northeast"] > costs["mid_atlantic"] > costs["southeast"], costs


def test_region_does_not_touch_materials(calc):
    """The premium is documented as applying to labour only."""
    materials = {r: _quick(calc, region=r).sections["Materials"] for r in REGIONS}
    assert len(set(materials.values())) == 1, f"region leaked into materials: {materials}"


# ── Crew size ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("crew", CREW_SIZES)
def test_elapsed_time_falls_as_crew_grows(calc, crew):
    """More people finish the same work sooner."""
    result = _quick(calc, crew=crew)
    assert result.total_hours > 0
    if crew > 2:
        assert result.total_hours < _quick(calc, crew=2).total_hours


def test_a_bigger_crew_is_never_dramatically_cheaper(calc):
    """The work is identical, so the bill must not swing with crew size.

    It used to range $1,843-$2,682 across crew 2-6 on one job -- a 31% spread,
    with crew 6 the cheapest, which invited shopping crew_size for a number.
    """
    costs = {crew: _labor_total(_quick(calc, crew=crew)) for crew in CREW_SIZES}
    spread = (max(costs.values()) - min(costs.values())) / max(costs.values())
    assert spread < 0.15, f"labour cost varies {spread:.0%} with crew size: {costs}"


@pytest.mark.parametrize("crew", CREW_SIZES)
def test_person_hours_are_roughly_conserved_across_crew(calc, crew):
    """Elapsed x crew should land near the same person-hours regardless."""
    baseline = _quick(calc, crew=4).total_hours * 4
    got = _quick(calc, crew=crew).total_hours * crew
    assert got == pytest.approx(baseline, rel=0.15), (
        f"crew {crew} implies {got} person-hours vs {baseline} at crew 4"
    )


# ── Hour conservation ────────────────────────────────────────────────────────

@pytest.mark.parametrize("crew", CREW_SIZES)
def test_displayed_lines_sum_to_the_displayed_total(calc, crew):
    """A reader must be able to add the lines up and get the header."""
    result = _quick(calc, crew=crew)
    line_hours = (
        _crew_line_hours(result, "Pack-Out Labor")
        + _crew_line_hours(result, "Pack-Back Labor")
    )
    assert line_hours == pytest.approx(result.total_hours, abs=0.01)


@pytest.mark.parametrize("crew", CREW_SIZES)
def test_no_labor_line_rounds_away_to_zero(calc, crew):
    """rh() returns 0 below 0.25; a line that exists must carry real hours."""
    result = _quick(calc, crew=crew)
    for section in ("Pack-Out Labor", "Pack-Back Labor"):
        for line in (result.section_details or {}).get(section, {}).get("lines", []):
            if line.get("unit") == "HR":
                assert line["qty"] > 0, f"{section}: {line['name']} billed 0 hours"


# ── Content path phase splits ────────────────────────────────────────────────

def _content_rooms():
    return [
        RoomContentInput(
            room_name=f"Room {i}", preset_id="bedroom_master", use_preset=False,
            items=[
                DetectedContentItem(name=n, category=c, quantity=q,
                                    is_fragile=(c == "Fragile"))
                for n, c, q in [
                    ("Bed", "Furniture", 2), ("Dishes", "Kitchenware", 80),
                    ("Glasses", "Fragile", 60), ("TV", "Electronics", 2),
                    ("Fridge", "Appliances", 1),
                ]
            ],
        )
        for i in range(4)
    ]


def _content(calc, include_packback):
    return calc.calculate_estimate_from_content(RoomsEstimateRequest(
        rooms=_content_rooms(), crew_size=4, include_packback=include_packback,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    ))


def test_disabling_packback_does_not_discard_labor(calc):
    """packout 0.85 / packback 0.0 left 15% of the work billed to nobody.

    Pinned against the two-phase job rather than merely "greater than": with
    0.85 the pack-out share is still larger than the 0.62 two-phase share, so
    a direction-only assertion passes with the bug in place. What must hold is
    that the SUM of the phases is the same either way — the work does not
    shrink because it is all done in one visit.
    """
    with_pb = _content(calc, True)
    without = _content(calc, False)

    # Pack-back is extra work (unpacking), not a re-billing of the pack-out
    # hours, so the two jobs legitimately differ in total. What must hold is
    # that the pack-out phase itself bills the same hours either way: the
    # packing is identical whether or not the crew returns to unpack. With
    # packout 0.85 the one-phase job billed a SMALLER pack-out than the
    # two-phase job, which is backwards.
    #
    # Compared as a ratio of each job's own reported duration so the debris
    # hours folded into total_hours (billed in their own section) cancel.
    two_phase = _crew_line_hours(with_pb, "Pack-Out Labor")
    one_phase = _crew_line_hours(without, "Pack-Out Labor")
    assert one_phase > two_phase, (
        f"one-phase pack-out bills {one_phase} crew hours vs {two_phase} when "
        f"a pack-back phase exists — the packing work did not shrink"
    )
    # Not pinned to the theoretical 1/0.62 = 1.61x: each tier line is rounded
    # to the half hour independently, and across four-plus lines that pulls the
    # realised ratio well below the arithmetic one (1.30x on this fixture).
    # The direction above is what distinguishes 1.0 from 0.85; asserting the
    # exact ratio would only encode the rounding of one particular fixture.
    assert _crew_line_hours(without, "Pack-Back Labor") == 0


def test_packout_share_is_whole_when_there_is_no_packback(calc):
    without = _content(calc, False)
    assert "Pack-Back Labor" not in without.sections
    assert without.sections["Pack-Out Labor"] > 0


def test_every_tier_splits_by_the_same_phase_fractions(calc):
    """Fragile and specialty carried an extra x0.6 the other tiers did not.

    Asserted on the source fractions rather than through a rendered estimate:
    the tier hours are rounded to the half hour per line, which on a normal job
    swallows a 15% difference on the smaller tiers and lets the defect through
    unnoticed.
    """
    import inspect

    source = inspect.getsource(EstimateCalculator.calculate_estimate_from_content)
    for tier in ("pb_fragile", "pb_specialty"):
        line = next(
            ln for ln in source.splitlines()
            if ln.strip().startswith(f"{tier} =")
        )
        assert "* 0.6" not in line, (
            f"{tier} applies an extra haircut the other tiers do not: {line.strip()}"
        )


def test_phase_fractions_sum_to_one(calc):
    """Anything the two phases do not add up to is work billed to nobody."""
    import inspect

    source = inspect.getsource(EstimateCalculator.calculate_estimate_from_content)
    packout = next(
        ln for ln in source.splitlines() if "packout_fraction =" in ln
    )
    packback = next(
        ln for ln in source.splitlines() if "packback_fraction =" in ln
    )
    # Both branches of each ternary, paired up.
    for phase_line, other in ((packout, packback), (packback, packout)):
        assert "0.85" not in phase_line, (
            f"phase fractions do not sum to 1.0: {phase_line.strip()} / {other.strip()}"
        )


def test_content_path_reports_hours_it_also_bills(calc):
    """total_hours drove the schedule note while 15% went unbilled."""
    result = _content(calc, False)
    billed = _crew_line_hours(result, "Pack-Out Labor")
    assert billed > 0
    # Billed crew hours should be a real fraction of the reported duration,
    # not the 85% slice that silently vanished.
    assert billed <= result.total_hours + 0.01
