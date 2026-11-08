"""Shut-off valves on a bathroom estimate.

Every fixture replaced or detached and reset gets new shut-off valves (two
per sink, tub and shower, one for the toilet), except a fixture the plumber
already repaired (water damage source): it keeps the valves the plumber
put in, and the estimate says so."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402

VALVES = "Shut-off valve replacement"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(**fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code="20850", length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=300, height_ft=8,
                replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic"},
                replace_toilet=True, toilet_spec={"type": "two_piece_standard"},
                replace_vanity=True, vanity_spec={"items": [{"width": 36, "sinks": 1}]})
    base.update(fields)
    return BathroomEstimate(**base)


def calc(est):
    result = calculate_estimate(est)
    return {li["description"]: li for li in result["line_items"]}, result.get("warning_flags", [])


def test_every_fixture_gets_its_shut_off_valves():
    lines, _ = calc(estimate())
    assert lines[VALVES]["quantity"] == 2 + 2 + 1  # vanity sink, tub, toilet


def test_a_fixture_the_plumber_repaired_adds_no_shut_off_valves():
    lines, warnings = calc(estimate(water_damage=True, water_damage_source="toilet"))
    assert lines[VALVES]["quantity"] == 2 + 2
    assert "toilet" not in lines[VALVES]["notes"].split("|")[1]
    assert "Not included (plumber already replaced): toilet" in lines[VALVES]["notes"]
    assert any(w.startswith("Shut-off valves: plumber already replaced (toilet)") for w in warnings)


def test_every_fixture_repaired_by_the_plumber_leaves_no_line():
    lines, warnings = calc(estimate(water_damage=True,
                                    water_damage_source="vanity,bathtub,toilet"))
    assert VALVES not in lines
    assert any(w.startswith("Shut-off valves: plumber already replaced") for w in warnings)


def test_supply_lines_still_go_in_for_every_fixture():
    lines, _ = calc(estimate(water_damage=True, water_damage_source="toilet"))
    assert lines["Supply line replacement (braided SS)"]["quantity"] == 5
