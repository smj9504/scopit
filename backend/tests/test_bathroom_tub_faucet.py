"""A bathtub's faucet, shower head and hand shower on the estimate.

The faucet is always removed and replaced, on a new tub or one detached and
reset; it is its own line, and the "Bathtub complete" line no longer holds
its labor. A shower head and a hand shower on a hose, when the tub has them,
are each detached and reset or replaced as the person chose."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.pricing import (  # noqa: E402
    BATHTUB_EXTRAS,
    PLUMBING_RATES,
    SHOWERHEAD_PRICES,
    TUB_FAUCET_PRICES,
    apply_material_handling,
    get_labor_multiplier,
)

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)
FAUCET_LABOR = PLUMBING_RATES["tub_faucet_install"] * MULT
HEAD_LABOR = BATHTUB_EXTRAS["showerhead_install"] * MULT
WALL_FAUCET = "Tub faucet (spout + handle trim) - R&R"


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(tub=None, **fields):
    # Walls painted all round. The total is the exact sum of the lines, never rounded
    # to $10 into one of them, so each line is priced as the tables give it
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=600, height_ft=8,
                walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
                replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic", **(tub or {})})
    base.update(fields)
    return BathroomEstimate(**base)


def calc(est):
    result = calculate_estimate(est)
    return {li["description"]: li for li in result["line_items"]}, result.get("warning_flags", [])


def near(a, b):
    return abs(a - b) < 0.05


def test_a_new_tub_gets_its_faucet_replaced_on_a_line_of_its_own():
    lines, _ = calc(estimate())
    faucet = lines[WALL_FAUCET]
    assert near(faucet["unit_price"], apply_material_handling(TUB_FAUCET_PRICES["wall"]) + FAUCET_LABOR)
    tub = next(li for d, li in lines.items() if d.startswith("Bathtub complete"))
    assert "faucet" not in (tub["notes"] or "").lower()


def test_a_tub_detached_and_reset_still_gets_a_new_faucet():
    lines, _ = calc(estimate(replace_tub=False, detach_reset_tub=True))
    assert WALL_FAUCET in lines
    assert any(d.startswith("Detach & Reset - Bathtub") for d in lines)


def test_no_shower_head_or_hand_shower_unless_chosen():
    lines, _ = calc(estimate())
    assert not any(d.startswith(("Shower head", "Hand shower")) for d in lines)


def test_shower_head_and_hand_shower_detach_and_reset_or_replace():
    lines, _ = calc(estimate({"showerhead_action": "detach_reset", "handheld_action": "replace"}))
    assert near(lines["Shower head - Detach & Reset"]["unit_price"], HEAD_LABOR)
    assert near(lines["Hand shower & hose - R&R"]["unit_price"],
                apply_material_handling(SHOWERHEAD_PRICES["handheld"]) + HEAD_LABOR)

    lines, _ = calc(estimate({"showerhead_action": "replace", "handheld_action": "detach_reset"}))
    assert near(lines["Shower head - R&R"]["unit_price"],
                apply_material_handling(SHOWERHEAD_PRICES["standard"]) + HEAD_LABOR)
    assert near(lines["Hand shower & hose - Detach & Reset"]["unit_price"], HEAD_LABOR)


def test_with_the_wall_open_the_valve_trim_kit_brings_the_spout_and_handle():
    lines, _ = calc(estimate({"surround_tile": True, "surround_tile_sf": 60}))
    valve = lines["Tub spout/diverter valve replacement (surround tile — wall open)"]
    assert near(valve["unit_price"], BATHTUB_EXTRAS["shower_valve_body_trim"] * MULT)
    assert "Shower head" not in valve["notes"]
    assert near(lines[WALL_FAUCET]["unit_price"], FAUCET_LABOR)


def test_trim_kit_excluded_the_faucet_brings_its_own_trim():
    lines, _ = calc(estimate({"surround_tile": True, "surround_tile_sf": 60},
                             hidden_costs={"exclude_trim_kit": True}))
    assert near(lines[WALL_FAUCET]["unit_price"],
                apply_material_handling(TUB_FAUCET_PRICES["wall"]) + FAUCET_LABOR)


def test_a_freestanding_tub_gets_a_tub_filler_and_a_deck_faucet_off_the_wall():
    lines, _ = calc(estimate({"type": "freestanding"}))
    assert near(lines["Tub filler faucet (freestanding) - R&R"]["unit_price"],
                apply_material_handling(TUB_FAUCET_PRICES["freestanding"]) + FAUCET_LABOR)
    lines, _ = calc(estimate({"type": "drop_in", "has_faucet": False}))
    assert "Tub faucet (deck-mount) - R&R" in lines


def test_plumber_already_replaced_the_faucet():
    lines, warnings = calc(estimate(water_damage=True, water_damage_source="bathtub"))
    assert WALL_FAUCET not in lines
    assert any(w.startswith(WALL_FAUCET) for w in warnings)
