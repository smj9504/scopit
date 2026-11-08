"""A bathroom wall tiled floor to ceiling is one tile, over the tub surround
and the shower walls on it: the sketch says how much of each surround its
tile runs over, and that part is priced with the wall tile, not with the
fixture's own tile. The wet-area backer board behind it stays. On a
throwaway SQLite database."""

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


def priced(service, shower_in_wall=0, tub_in_wall=0):
    """A bath with a 36" tiled shower to 96" (72 SF of walls), a tub with a 50 SF
    tiled surround, and tiled walls; so much of each surround under the wall tile."""
    job = service.create_estimate(BathroomEstimateCreate(
        project_type="remodel",
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=8, floor_sf=40, wall_sf=256,
        replace_shower=True, replace_tub=True,
        shower_spec={"type": "custom_tile", "width_in": 36, "depth_in": 36, "tile_height_in": 96,
                     "tiled_with_wall_sf": shower_in_wall},
        bathtub_spec={"type": "alcove", "material": "acrylic", "surround_tile": True, "surround_tile_sf": 50,
                      "tiled_with_wall_sf": tub_in_wall},
        walls_spec={"wall_finish": "tile", "tile_wall_sf": 60 + shower_in_wall + tub_in_wall},
    ))
    return service.calculate(job["id"])["line_items"]


def find(items, starts_with):
    return [li for li in items if li["description"].startswith(starts_with)]


def test_the_wall_tile_takes_in_the_surround_it_runs_over(service):
    before = priced(service)
    after = priced(service, shower_in_wall=24, tub_in_wall=25)

    shower = find(after, "Shower wall tile complete")[0]
    assert shower["quantity"] == 48  # 72 SF less the 24 under the wall tile
    assert "Less 24.0SF tiled with the wall tile" in shower["notes"]
    tub = find(after, "Bathtub surround tile complete")[0]
    assert tub["quantity"] == 25
    assert "less 25.0SF tiled with the wall tile = 25.0SF" in tub["notes"]

    wall = find(after, "Wall tile")[0]
    assert wall["quantity"] == 109
    assert "incl. 49SF over the tub/shower walls" in wall["notes"]
    assert "non-shower/tub" in find(before, "Wall tile")[0]["notes"]

    # The backer board is for the whole wet area either way
    board = "Cement board (Durock) - wet area"
    assert find(after, board)[0]["quantity"] == find(before, board)[0]["quantity"]


def test_a_surround_all_under_the_wall_tile_has_no_tile_of_its_own(service):
    items = priced(service, shower_in_wall=72, tub_in_wall=50)
    assert not find(items, "Shower wall tile complete")
    assert not find(items, "Bathtub surround tile complete")
    # The shower's floor is still its own
    assert find(items, "Shower floor tile complete")
