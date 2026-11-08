"""Cement board demoed for water damage gets new board once.

When the tub surround or shower walls get new wet-area cement board, that
board is the replacement for the damaged section demoed there, so there's no
separate partial replacement line for it; only damaged board beyond what the
wet-area line covers (or all of it, when there's no wet-area line) is one."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402

WET_AREA = "Cement board (Durock) - wet area"
PARTIAL = "Cement board replacement - water damage repair (partial)"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(durock_sf=None, **fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code="20850", length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=300, height_ft=8,
                water_damage=True, demo_cement_board=True, demo_cement_board_sf=24,
                substrate_spec={"durock_sf": durock_sf} if durock_sf else {})
    base.update(fields)
    return BathroomEstimate(**base)


def calc(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def test_new_wet_area_board_is_the_replacement():
    lines = calc(estimate(durock_sf=60))
    assert lines[WET_AREA]["quantity"] == 60
    assert PARTIAL not in lines
    # The damaged board still comes out
    assert "Cement board 24SF" in next(li["notes"] for li in lines.values() if li["category"] == "demo"
                                       and "Cement board" in (li.get("notes") or ""))


def test_damaged_board_beyond_the_wet_area_is_replaced_on_its_own():
    lines = calc(estimate(durock_sf=20))
    assert lines[PARTIAL]["quantity"] == 4
    assert lines[PARTIAL]["notes"].startswith("Damaged board beyond the 20 SF of wet-area cement board")


def test_without_wet_area_board_the_damaged_section_is_replaced():
    lines = calc(estimate())
    assert WET_AREA not in lines
    assert lines[PARTIAL]["quantity"] == 24
