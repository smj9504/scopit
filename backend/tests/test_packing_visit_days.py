"""
Splitting a site visit over several days.

A pack-out that fits one long day may still have to run over several -- the
hours exceed a workday, or access, occupants or the client's schedule demand
it. The estimator sets the day count after seeing the calculation
(pack_out_days / pack_back_days); left unset it is sized by 8-hr workdays.
Either way every day after the first adds crew time for setup and end-of-day
securing, billed as its own line on the visit's labor section.

Also covers the review fixes that ship with it: the quick path's supplement
triggers, the van line's name, crew-neutral quick loading, and the half-hour
allocation of labour tiers.
"""
import pytest

from app.core.database import SessionLocal
from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    QuickEstimateRequest,
    RoomContentInput,
    RoomInput,
    RoomsEstimateRequest,
    StagingType,
)
from app.domains.tools.modules.packing.service import (
    DAY_RESTART_HOURS,
    MULTI_DAY_LINE_NAME,
    WORKDAY_HOURS,
    EstimateCalculator,
    allocate_half_hours,
    apply_visit_schedule,
    schedule_notes,
    site_visit_hours,
)

SMALL_JOB = ["bedroom_standard", "living_standard"]
HOUSE = [
    "bedroom_master", "living_standard", "kitchen_standard", "basement_standard",
    "bedroom_standard", "bedroom_kids", "office_standard", "dining_standard",
]


@pytest.fixture
def calc():
    db = SessionLocal()
    try:
        yield EstimateCalculator(db, company_id=None)
    finally:
        db.close()


def _quick(calc, presets, **kw):
    kw.setdefault("crew_size", 4)
    kw.setdefault("include_packback", True)
    return calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in presets],
        staging_type=StagingType.OFF_SITE, storage_months=1, **kw,
    ))


def _content(calc, **kw):
    rooms = [
        RoomContentInput(
            room_name=f"Room {i}", preset_id="bedroom_master", use_preset=False,
            items=[
                DetectedContentItem(name="Bed", category="Furniture", quantity=2),
                DetectedContentItem(name="Dishes", category="Kitchenware", quantity=60),
                DetectedContentItem(name="Books", category="Books", quantity=80),
            ],
        )
        for i in range(3)
    ]
    kw.setdefault("crew_size", 4)
    kw.setdefault("include_packback", True)
    return calc.calculate_estimate_from_content(RoomsEstimateRequest(
        rooms=rooms, staging_type=StagingType.OFF_SITE, storage_months=1, **kw,
    ))


def _multi_day_lines(result, section):
    return [
        ln for ln in result.section_details.get(section, {}).get("lines", [])
        if ln["name"] == MULTI_DAY_LINE_NAME
    ]


def _without_multi_day(result, section):
    return [
        ln for ln in result.section_details[section]["lines"]
        if ln["name"] != MULTI_DAY_LINE_NAME
    ]


# ── Default: sized by workdays ───────────────────────────────────────────────

def test_one_day_job_has_no_multi_day_line(calc):
    result = _quick(calc, SMALL_JOB)
    po_hours, _ = site_visit_hours(result.section_details)
    assert po_hours <= WORKDAY_HOURS, "fixture must fit one day"
    assert result.work_days == 1
    assert result.pack_out_days is None
    assert _multi_day_lines(result, "Pack-Out Labor") == []


def test_auto_multi_day_job_bills_the_added_days(calc):
    """A visit that runs past a workday restarts on each added day."""
    result = _quick(calc, HOUSE, crew_size=2)
    po_hours, _ = site_visit_hours(result.section_details)
    days = -(-po_hours // WORKDAY_HOURS)  # ceil
    assert days > 1, "fixture must span more than one day"
    assert result.work_days >= days

    [line] = _multi_day_lines(result, "Pack-Out Labor")
    assert line["qty"] == (days - 1) * DAY_RESTART_HOURS
    assert "-person crew" in line["detail"], "re-priced with the crew like any crew line"
    assert line["amount"] == pytest.approx(line["qty"] * line["rate"], abs=0.01)
    labor_lines = result.section_details["Pack-Out Labor"]["lines"]
    assert result.sections["Pack-Out Labor"] == pytest.approx(
        sum(ln["amount"] for ln in labor_lines), abs=0.01,
    )


# ── Estimator-set day counts ─────────────────────────────────────────────────

def test_estimator_can_spread_a_one_day_job_over_several_days(calc):
    auto = _quick(calc, SMALL_JOB)
    split = _quick(calc, SMALL_JOB, pack_out_days=3)

    assert split.pack_out_days == 3
    assert split.work_days == 3
    [line] = _multi_day_lines(split, "Pack-Out Labor")
    assert line["qty"] == 2 * DAY_RESTART_HOURS

    # The work itself is unchanged; the restarts are the only addition.
    assert _without_multi_day(split, "Pack-Out Labor") == _without_multi_day(auto, "Pack-Out Labor")
    assert split.sections["Pack-Out Labor"] == pytest.approx(
        auto.sections["Pack-Out Labor"] + line["amount"], abs=0.01,
    )
    assert split.total_hours == pytest.approx(auto.total_hours + line["qty"])

    note = next(n for n in split.notes if n.startswith("Pack-out"))
    assert "scheduled over 3 days (set by estimator)" in note


def test_squeezing_a_long_job_into_one_day_warns_and_sizes_the_crew(calc):
    result = _quick(calc, HOUSE, pack_out_days=1)
    po_hours, _ = site_visit_hours(result.section_details)
    assert po_hours > WORKDAY_HOURS, "fixture must exceed one workday"

    assert _multi_day_lines(result, "Pack-Out Labor") == []
    note = next(n for n in result.notes if n.startswith("Pack-out"))
    assert "scheduled in 1 day (set by estimator)" in note
    assert "Exceeds a standard 8-hr workday" in note
    assert "-person crew would fit it in 1 day" in note


def test_pack_back_days_are_set_separately(calc):
    result = _quick(calc, SMALL_JOB, pack_out_days=1, pack_back_days=2)
    assert _multi_day_lines(result, "Pack-Out Labor") == []
    [line] = _multi_day_lines(result, "Pack-Back Labor")
    assert line["qty"] == DAY_RESTART_HOURS
    assert result.pack_back_days == 2


def test_pack_back_days_are_ignored_without_a_pack_back(calc):
    result = _quick(calc, SMALL_JOB, include_packback=False, pack_back_days=3)
    assert result.pack_back_days is None
    assert result.work_days == 1
    assert "Pack-Back Labor" not in result.section_details


def test_van_quantity_stays_capacity_driven(calc):
    """Billing the van per work day stays the estimator's opt-in in the editor."""
    auto = _quick(calc, SMALL_JOB)
    split = _quick(calc, SMALL_JOB, pack_out_days=3)
    assert split.truck_trips == auto.truck_trips == auto.truck_capacity_trips


def test_content_path_honours_the_day_count(calc):
    auto = _content(calc)
    split = _content(calc, pack_out_days=4)
    [line] = _multi_day_lines(split, "Pack-Out Labor")
    assert line["qty"] == 3 * DAY_RESTART_HOURS
    assert split.work_days == 4
    assert split.sections["Pack-Out Labor"] == pytest.approx(
        auto.sections["Pack-Out Labor"] + line["amount"], abs=0.01,
    )


def test_rescheduling_replaces_the_line_rather_than_stacking_it(calc):
    result = _quick(calc, SMALL_JOB, pack_out_days=3)
    details = result.section_details
    apply_visit_schedule(details, 4, 75.0, pack_out_days=2)
    [line] = [ln for ln in details["Pack-Out Labor"]["lines"] if ln["name"] == MULTI_DAY_LINE_NAME]
    assert line["qty"] == DAY_RESTART_HOURS
    apply_visit_schedule(details, 4, 75.0, pack_out_days=1)
    assert not any(ln["name"] == MULTI_DAY_LINE_NAME for ln in details["Pack-Out Labor"]["lines"])


def test_multi_day_line_does_not_feed_the_day_count(calc):
    """The restart line follows from the days; counting it as work could tip
    the visit into yet another day."""
    result = _quick(calc, HOUSE, crew_size=2)
    before = site_visit_hours(result.section_details)
    apply_visit_schedule(result.section_details, 2, 75.0)
    assert site_visit_hours(result.section_details) == before


def test_estimator_note_for_a_comfortable_split_has_no_warning():
    """Exact wording, mirrored by generateSchedulingNotes() in the editor.
    (6.0 + 0.5) / 2 = 3.25 rounds half UP, as JS does, not to even."""
    [note] = schedule_notes(6.0, 0, 4, pack_out_days=2)
    assert note == (
        "Pack-out scheduled over 2 days (set by estimator) — 6.0 hrs + 0.5 hr "
        "setup & securing on site (4-person crew), approx. 3.3 hrs/day."
    )


# ── Review fixes ─────────────────────────────────────────────────────────────

def test_quick_supplements_trigger_on_upper_floors_and_heavy_density(calc):
    """str() of the str-Enum fields is "Floor.THIRD", so these never fired."""
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_standard", floor="3rd", density="heavy")],
        crew_size=4,
    ))
    keys = {s.key for s in result.supplements}
    assert {"difficult_access", "heavy_contents"} <= keys
    clean = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_standard")], crew_size=4,
    ))
    assert clean.supplements == []


def test_van_line_is_named_for_the_van_it_bills(calc):
    result = _quick(calc, ["bedroom_standard"])
    assert result.storage_sf <= 50, "fixture must select the small van"
    vans = [
        ln for ln in result.section_details["Transport Out"]["lines"] if ln["unit"] == "DY"
    ]
    assert [ln["name"] for ln in vans] == ["Moving Van 14'-15'"]
    assert vans[0]["rate"] == calc.get_price("2932")


@pytest.mark.parametrize("crew", [2, 3, 5, 6])
def test_quick_loading_costs_the_same_whatever_the_crew(calc, crew):
    """Loading was fixed elapsed hours billed x crew: twice the movers, twice
    the bill for the same house."""
    def loading(c):
        lines = _quick(calc, HOUSE, crew_size=c).section_details["Transport Out"]["lines"]
        return next(ln for ln in lines if ln["name"] == "Loading Labor")

    baseline = loading(4)
    got = loading(crew)
    assert got["qty"] * crew == pytest.approx(baseline["qty"] * 4, abs=crew * 0.5)


def test_allocate_half_hours_keeps_the_total():
    parts = {"a": 1.3, "b": 0.3, "c": 0.3, "d": 0.3, "e": 0.2}
    got = allocate_half_hours(parts)
    assert sum(got.values()) == 2.5  # rh(2.4)
    assert all(v * 2 == int(v * 2) for v in got.values()), "half-hour grid"
    assert all(abs(got[k] - parts[k]) < 0.5 for k in parts)


def test_allocate_half_hours_never_rounds_real_work_away():
    assert sum(allocate_half_hours({"a": 0.1, "b": 0.05}).values()) == 0.5
