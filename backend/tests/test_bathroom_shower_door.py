"""A shower door can sit against the left or right side of the front instead
of the middle; the fixed glass panel beside it then fills the rest of the
front, and is priced that wide. On a throwaway SQLite database."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate.schemas import BathroomEstimateCreate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from tests.bathroom_db import COMPANY_ID, make_session  # noqa: E402


@pytest.fixture
def service(tmp_path):
    s = make_session(tmp_path)
    yield BathroomEstimateService(s, COMPANY_ID)
    s.close()


def door_notes(service, **door):
    """The shower door line's notes for a 60" tiled shower with a 30" swing
    door and 72" glass, set as `door` says."""
    job = service.create_estimate(BathroomEstimateCreate(
        project_type="remodel",
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=8, floor_sf=40, wall_sf=256,
        replace_shower=True,
        shower_spec={"type": "custom_tile", "width_in": 60, "depth_in": 36, "tile_height_in": 96,
                     "door_type": "swing", "door_width_in": 30, "door_height_in": 72,
                     "layout": "alcove", **door},
    ))
    items = service.calculate(job["id"])["line_items"]
    [line] = [li for li in items if li["description"].startswith("Shower door")]
    return line["notes"]


def test_a_centred_door_has_a_quarter_of_the_front_for_each_panel(service):
    # 15" × 72" = 7.5 SF a panel
    assert "Fixed panel (1): 7.5 SF" in door_notes(service, fixed_panel_config="right")
    assert "Fixed panel (2): 15.0 SF" in door_notes(service, fixed_panel_config="both")
    # An estimate from before the door could move prices the same
    assert door_notes(service, fixed_panel_config="right") == door_notes(service, fixed_panel_config="right", door_position="center")


def test_a_door_against_one_side_leaves_the_panel_the_rest_of_the_front(service):
    # 60" less the 30" door = 30" × 72" = 15 SF
    assert "Fixed panel (1): 15.0 SF" in door_notes(service, door_position="left", fixed_panel_config="right")
    assert "Fixed panel (1): 15.0 SF" in door_notes(service, door_position="right", fixed_panel_config="left")


def test_a_door_against_one_side_with_no_panel_has_no_glass_beside_it(service):
    assert "Fixed panel" not in door_notes(service, door_position="left", fixed_panel_config="none")
