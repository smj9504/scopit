"""Demo on a bathroom the mitigation team already demoed.

Mitigation tears out the wet drywall and ceiling; the floor tile and the
tub/shower wall tile still come out for the remodel. "Demo already completed
by mitigation" drops the ceiling demo only, and the tile demo stays priced."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(**fields):
    # New floor tile, the tub detached and reset with its tile surround
    # redone, a new mirror, 5 SF of wet cement board
    base = dict(property_address="12 Elm St", state="MD", zip_code="20850", length_ft=8, width_ft=5,
                floor_sf=40, wall_sf=300, height_ft=8,
                floor_spec={"material": "porcelain"},
                detach_reset_tub=True,
                bathtub_spec={"type": "alcove", "material": "acrylic", "surround_tile": True},
                replace_mirror=True,
                water_damage=True, demo_cement_board=True, demo_cement_board_sf=5,
                demo_ceiling=True)
    base.update(fields)
    return BathroomEstimate(**base)


def demo_line(est):
    items = calculate_estimate(est)["line_items"]
    return next(li for li in items if li["description"].startswith("Demo & removal"))


def test_mitigation_demo_still_prices_the_tile():
    line = demo_line(estimate(demo_already_done=True))
    assert "Floor tile" in line["notes"]
    assert "Tub surround tile removal" in line["notes"]
    assert "Ceiling demo already completed by mitigation" in line["notes"]
    # Floor tile 40 SF + tub surround 3 walls (60 + 2*32) x 60 / 144 = 51.7 SF
    # at the wall tile rate, with the mirror and the cement board
    assert line["total"] > 300


def test_floor_tile_comes_out_around_the_tub_not_under_it():
    line = demo_line(estimate(demo_already_done=True))
    # 40 SF room less the 60" x 32" tub = 26.7 SF of floor tile
    assert "Floor tile 27SF" in line["notes"]


def test_mitigation_demo_only_drops_the_ceiling():
    done = demo_line(estimate(demo_already_done=True))
    not_done = demo_line(estimate(demo_already_done=False))
    assert "Ceiling 40SF" in not_done["notes"]
    assert "Ceiling 40SF" not in done["notes"]
    ceiling = not_done["total"] - done["total"]
    assert ceiling == pytest.approx(40 * calculator.DEMO_RATES["ceiling_per_sf"]
                                    * calculator.get_labor_multiplier("20850"), abs=0.02)
