"""
Tests that every displayed labor-hour line item ("qty" on an HR-unit line)
rounds to the nearest half hour (0.5 increments), never a 0.1-style
fraction like 0.1hr or 0.4hr.

Covers both calculation paths:
  - calculate_estimate() -- Quick Estimate tab (room presets, no AI content)
  - calculate_estimate_from_content() -- Photo AI / Rooms tab (per-item content)

Uses EstimateCalculator(db, company_id=None), which falls back entirely to
DEFAULT_PRICES and never touches the database -- pure calculation tests.
"""
import pytest

from app.core.database import SessionLocal
from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    QuickEstimateRequest,
    RoomContentInput,
    RoomInput,
    RoomsEstimateRequest,
)
from app.domains.tools.modules.packing.service import EstimateCalculator


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


def _assert_half_hour_increments(section_details):
    """Every HR-unit line's qty must be a multiple of 0.5."""
    violations = []
    for section_name, section in section_details.items():
        for line in section.get("lines", []):
            if line.get("unit") != "HR":
                continue
            qty = line["qty"]
            # qty * 2 must be (very close to) an integer
            doubled = qty * 2
            if abs(doubled - round(doubled)) > 1e-9:
                violations.append((section_name, line["name"], qty))
    assert not violations, f"Non-half-hour HR line quantities found: {violations}"


# ── Quick Estimate path (calculate_estimate) ──────────────────────────────

@pytest.mark.parametrize("crew_size", [2, 3, 4, 5, 6])
@pytest.mark.parametrize("num_rooms", [1, 2, 3, 5, 7])
def test_quick_estimate_labor_hours_are_half_hour_increments(calc, crew_size, num_rooms):
    request = QuickEstimateRequest(
        rooms=[
            RoomInput(preset="bedroom_standard", floor="1st")
            for _ in range(num_rooms)
        ],
        crew_size=crew_size,
    )
    response = calc.calculate_estimate(request)
    _assert_half_hour_increments(response.section_details)


def test_quick_estimate_no_packback_still_half_hour(calc):
    request = QuickEstimateRequest(
        rooms=[RoomInput(preset="bedroom_standard", floor="1st")],
        crew_size=4,
        include_packback=False,
    )
    response = calc.calculate_estimate(request)
    _assert_half_hour_increments(response.section_details)


# ── Photo AI / Rooms path (calculate_estimate_from_content) ──────────────

def _content_rooms(num_rooms, items_per_room=3):
    rooms = []
    for i in range(num_rooms):
        items = [
            DetectedContentItem(
                name=f"Item {i}-{j}",
                category="Furniture" if j % 2 == 0 else "Other",
                quantity=1 + j,
                base_labor_hours=0.1,
                per_unit_labor_hours=0.05,
                estimated_labor_hours=0.1 + 0.05 * (1 + j),
            )
            for j in range(items_per_room)
        ]
        rooms.append(RoomContentInput(
            room_name=f"Room {i}", density="normal", floor="1st", items=items,
        ))
    return rooms


@pytest.mark.parametrize("crew_size", [2, 3, 4, 5, 6])
@pytest.mark.parametrize("num_rooms", [1, 2, 4])
def test_content_estimate_labor_hours_are_half_hour_increments(calc, crew_size, num_rooms):
    request = RoomsEstimateRequest(
        rooms=_content_rooms(num_rooms),
        crew_size=crew_size,
    )
    response = calc.calculate_estimate_from_content(request)
    _assert_half_hour_increments(response.section_details)
