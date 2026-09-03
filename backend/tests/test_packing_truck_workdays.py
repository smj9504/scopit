"""
Tests that the moving-van quantity reflects the number of workdays a job
spans, not just the number of trips the load requires.

The 26' van is rented per DAY. A job whose elapsed on-site time exceeds a
standard 8-hr workday keeps the van for that many days even when a single
trip would hold the entire load, so the van DY quantity is
max(capacity_trips, work_days).

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
    EstimateCalculator,
    WORKDAY_HOURS,
    truck_qty_note,
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

def test_note_explains_multi_day_driver():
    note = truck_qty_note(capacity_trips=1, work_days=2)
    assert "2 van-days" in note
    assert "2-day job" in note
    assert f"{WORKDAY_HOURS}-hr workday" in note


def test_note_stays_trip_based_when_capacity_dominates():
    note = truck_qty_note(capacity_trips=3, work_days=2)
    assert "van-days" not in note
    assert "3 trips" in note


# ── Quick estimate path ──────────────────────────────────────────────────────

def test_quick_estimate_van_qty_follows_work_days(calc):
    """A multi-room job exceeding one workday bills multiple van-days."""
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
    assert result.work_days == work_days_for(result.total_hours)
    assert result.truck_trips >= result.work_days

    vans = _van_lines(result.section_details)
    assert vans, "expected moving-van lines on an off-site job"
    for section, line in vans:
        assert line["qty"] == result.truck_trips, section
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


def test_content_estimate_van_qty_follows_work_days(calc):
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
    assert result.work_days == work_days_for(result.total_hours)
    assert result.truck_trips >= result.work_days

    vans = _van_lines(result.section_details)
    assert vans, "expected moving-van lines on an off-site job"
    for section, line in vans:
        assert line["qty"] == result.truck_trips, section
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
