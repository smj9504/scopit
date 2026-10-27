"""
Tests that the calculated moving-van quantity is driven by load capacity
alone, and that a multi-day job is reported without inflating that quantity.

The 26' van is rented per DAY, but whether a multi-day job keeps it on site
throughout is the estimator's judgement, so billing it per work day is an
explicit opt-in in the Estimate Editor rather than an automatic markup. The
calculation therefore reports work_days (so the editor can offer the opt-in)
while leaving truck_trips at the capacity figure.

Covers both calculation paths:
  - calculate_estimate()              -- Quick Estimate tab
  - calculate_estimate_from_content() -- Photo AI / Rooms tab
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
    WORKDAY_HOURS,
    EstimateCalculator,
    schedule_notes,
    site_visit_hours,
    truck_qty_note,
    visit_work_days,
    work_days_for,
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


def _van_lines(section_details):
    """Every moving-van line across all sections."""
    out = []
    for name, detail in (section_details or {}).items():
        for line in detail.get("lines", []):
            if "Van" in line.get("name", "") and line.get("unit") == "DY":
                out.append((name, line))
    return out


# ── work_days_for ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("hours,expected", [
    (0, 1),        # degenerate: never zero days
    (0.5, 1),
    (8.0, 1),      # exactly one workday
    (8.1, 2),
    (12.7, 2),     # the reported case
    (16.0, 2),
    (16.1, 3),
    (80.6, 11),
])
def test_work_days_for(hours, expected):
    assert work_days_for(hours) == expected


# ── truck_qty_note ───────────────────────────────────────────────────────────

def test_note_describes_capacity_only():
    """The calculated note never promises van-days for a multi-day schedule."""
    assert truck_qty_note(capacity_trips=1) == "1 trip (~500 SF capacity per trip)"
    assert truck_qty_note(capacity_trips=3) == "3 trips (~500 SF capacity per trip)"
    for trips in (1, 2, 5):
        assert "van-day" not in truck_qty_note(trips)


# ── Quick estimate path ──────────────────────────────────────────────────────

def test_quick_estimate_van_qty_ignores_work_days(calc):
    """A multi-day job still bills the capacity-driven van quantity.

    Per-work-day billing is an editor opt-in, so the calculation must not
    silently inflate the van line just because the job spans two days.
    """
    rooms = [
        RoomInput(preset=p) for p in (
            "bedroom_master", "living_standard", "kitchen_standard",
            "basement_standard", "bedroom_standard", "bedroom_kids",
            "office_standard", "dining_standard",
        )
    ]
    req = QuickEstimateRequest(
        rooms=rooms, crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    )
    result = calc.calculate_estimate(req)

    assert result.total_hours > WORKDAY_HOURS, "fixture must span >1 workday"
    # work_days is still reported, so the editor can offer the opt-in.
    assert result.work_days == visit_work_days(*site_visit_hours(result.section_details))
    assert result.work_days > 1
    # ...but the van quantity does not follow it.
    assert result.truck_trips < result.work_days

    vans = _van_lines(result.section_details)
    assert vans, "expected moving-van lines on an off-site job"
    for section, line in vans:
        assert line["qty"] == result.truck_trips, section
        assert "van-day" not in (line["detail"] or ""), section
        # Amount must track qty, or the section total silently under-bills.
        assert line["amount"] == pytest.approx(line["rate"] * line["qty"], abs=0.01)


def test_single_day_job_bills_one_van_day(calc):
    """A small job stays at the capacity-driven trip count."""
    req = QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_standard")], crew_size=4,
        include_packback=False, staging_type=StagingType.OFF_SITE,
        storage_months=1,
    )
    result = calc.calculate_estimate(req)

    assert result.total_hours <= WORKDAY_HOURS
    assert result.work_days == 1
    for _, line in _van_lines(result.section_details):
        assert line["qty"] == 1


def test_on_site_job_reports_no_truck(calc):
    """On-site staging never rents a van."""
    req = QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_master")], crew_size=4,
        include_packback=True, staging_type=StagingType.ON_SITE,
        storage_months=0,
    )
    result = calc.calculate_estimate(req)
    assert result.truck_trips == 0
    assert _van_lines(result.section_details) == []


# ── Content (Photo AI) path ──────────────────────────────────────────────────

def _content_room(name, preset, items):
    return RoomContentInput(
        room_name=name, preset_id=preset, use_preset=False,
        items=[
            DetectedContentItem(
                name=n, category=c, quantity=q, is_fragile=(c == "Fragile"),
            )
            for n, c, q in items
        ],
    )


def test_content_estimate_van_qty_ignores_work_days(calc):
    rooms = [
        _content_room(f"Room {i}", "bedroom_master", [
            ("Bed", "Furniture", 4), ("Dresser", "Furniture", 6),
            ("Clothing", "Clothing", 200), ("Dishes", "Kitchenware", 200),
            ("Glasses", "Fragile", 150), ("Books", "Books", 250),
            ("TV", "Electronics", 4), ("Fridge", "Appliances", 2),
        ])
        for i in range(10)
    ]
    req = RoomsEstimateRequest(
        rooms=rooms, crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    )
    result = calc.calculate_estimate_from_content(req)

    assert result.total_hours > WORKDAY_HOURS, "fixture must span >1 workday"
    assert result.work_days == visit_work_days(*site_visit_hours(result.section_details))
    assert result.work_days > 1
    assert result.truck_trips < result.work_days

    vans = _van_lines(result.section_details)
    assert vans, "expected moving-van lines on an off-site job"
    for section, line in vans:
        assert line["qty"] == result.truck_trips, section
        assert "van-day" not in (line["detail"] or ""), section
        assert line["amount"] == pytest.approx(line["rate"] * line["qty"], abs=0.01)


def test_section_total_matches_van_line_amount(calc):
    """Transport section totals reconcile with the multi-day van amount."""
    rooms = [
        _content_room(f"Room {i}", "bedroom_master", [
            ("Bed", "Furniture", 4), ("Clothing", "Clothing", 200),
            ("Books", "Books", 250), ("Glasses", "Fragile", 150),
        ])
        for i in range(10)
    ]
    req = RoomsEstimateRequest(
        rooms=rooms, crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    )
    result = calc.calculate_estimate_from_content(req)

    for section in ("Transport Out", "Transport Back"):
        lines = (result.section_details or {}).get(section, {}).get("lines", [])
        if not lines:
            continue
        expected = round(sum(ln["amount"] for ln in lines), 2)
        assert result.sections[section] == pytest.approx(expected, abs=0.01)


# ── schedule_notes ───────────────────────────────────────────────────────────

def test_schedule_note_states_the_schedule_without_promising_pricing():
    """States the schedule as a fact, but must not claim the van is billed for
    those days — that is an opt-in the estimator has not necessarily made."""
    [note] = schedule_notes(13.0, 4.0, 4)
    assert note.startswith("Pack-out scheduled over 2 days")
    assert "13.0 hrs" in note
    assert "4-person crew" in note
    assert "6.5 hrs/day" in note
    # The old phrasings both misstated the estimate: one framed a resolved
    # schedule as an open problem, the other promised pricing that is opt-in.
    assert "Recommend scheduling" not in note
    assert "pricing reflects" not in note


def test_schedule_note_per_day_divides_total():
    [note] = schedule_notes(80.6, 0, 4)
    assert "scheduled over 11 days" in note
    assert "80.6 hrs" in note
    assert f"{round(80.6 / 11, 1)} hrs/day" in note


def test_each_visit_is_scheduled_on_its_own_hours():
    """Pack-out and pack-back are separate visits. A 6-hr pack-out and a 4-hr
    pack-back are two one-day visits, not one 10-hr job running into a second
    day."""
    assert schedule_notes(6.0, 4.0, 4) == []
    assert visit_work_days(6.0, 4.0) == 1
    notes = schedule_notes(10.0, 9.0, 4)
    assert [n.split(" scheduled")[0] for n in notes] == ["Pack-out", "Pack-back"]
    assert visit_work_days(10.0, 4.0) == 2


def test_visit_hours_are_elapsed_crew_hours_not_person_hours(calc):
    """A 4-person crew on site for N hours is N hours of schedule, and the
    supervisor working alongside adds none."""
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset=p) for p in (
            "bedroom_master", "living_standard", "kitchen_standard",
        )],
        crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    ))
    po_hours, pb_hours = site_visit_hours(result.section_details)
    crew_lines = [
        ln for ln in result.section_details["Pack-Out Labor"]["lines"]
        if "-person crew" in ln["detail"]
    ]
    assert po_hours == pytest.approx(sum(ln["qty"] for ln in crew_lines))
    assert po_hours + pb_hours == pytest.approx(result.total_hours)
    assert result.work_days == 1


def test_calculated_note_uses_new_phrasing(calc):
    rooms = [
        RoomInput(preset=p) for p in (
            "bedroom_master", "living_standard", "kitchen_standard",
            "basement_standard", "bedroom_standard", "bedroom_kids",
            "office_standard", "dining_standard",
        )
    ]
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=rooms, crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    ))
    assert result.total_hours > WORKDAY_HOURS
    assert result.notes, "multi-day job must carry a scheduling note"
    joined = " ".join(result.notes)
    assert "Recommend scheduling" not in joined
    assert f"scheduled over {result.work_days} days" in joined


def test_single_day_job_has_no_schedule_note(calc):
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_standard")], crew_size=4,
        include_packback=False, staging_type=StagingType.OFF_SITE,
        storage_months=1,
    ))
    assert result.total_hours <= WORKDAY_HOURS
    assert not any("Scheduled over" in n for n in result.notes)


# ── truck_capacity_trips (the editor's restore anchor) ───────────────────────

def test_capacity_anchor_matches_calculated_qty(calc):
    """truck_capacity_trips records the calculated figure the editor restores
    to when the user switches per-work-day billing back off."""
    rooms = [
        RoomInput(preset=p) for p in (
            "bedroom_master", "living_standard", "kitchen_standard",
            "basement_standard", "bedroom_standard", "bedroom_kids",
            "office_standard", "dining_standard",
        )
    ]
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=rooms, crew_size=4, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    ))
    assert result.truck_capacity_trips == result.truck_trips
    assert result.truck_capacity_trips >= 1
    for _, line in _van_lines(result.section_details):
        assert line["qty"] == result.truck_capacity_trips


def test_capacity_anchor_on_content_path(calc):
    rooms = [
        _content_room(f"Room {i}", "bedroom_master", [
            ("Bed", "Furniture", 4), ("Clothing", "Clothing", 200),
            ("Books", "Books", 250),
        ])
        for i in range(10)
    ]
    # A 2-person crew, so the pack-out visit alone runs past one workday.
    result = calc.calculate_estimate_from_content(RoomsEstimateRequest(
        rooms=rooms, crew_size=2, include_packback=True,
        staging_type=StagingType.OFF_SITE, storage_months=1,
    ))
    assert result.truck_capacity_trips == result.truck_trips
    assert result.work_days > 1, "fixture must span >1 workday"
    # The anchor tracks capacity, never the day count.
    assert result.truck_capacity_trips < result.work_days


def test_on_site_job_has_no_capacity_anchor(calc):
    result = calc.calculate_estimate(QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_master")], crew_size=4,
        include_packback=True, staging_type=StagingType.ON_SITE,
        storage_months=0,
    ))
    assert result.truck_capacity_trips == 0
