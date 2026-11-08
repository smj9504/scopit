"""Mirrors over the vanity, counted and sized on their own.

A double vanity can have one wide mirror or a small one over each sink.
Detaching and resetting is priced per mirror by its width, one line per
width; an estimate saved before mirrors were listed prices as it did, one
mirror per vanity."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.mirrors import mirror_groups, price_by_width  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.pricing import DEMO_RATES, DETACH_RESET_COSTS, get_labor_multiplier  # noqa: E402

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)
RATES = DETACH_RESET_COSTS["mirror"]


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


def estimate(mirrors=None, vanities=1, **fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=600, height_ft=8,
                walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
                detach_reset_vanity=True, detach_reset_mirror=True,
                vanity_spec={"items": [{"width": 60, "sinks": 2}] * vanities},
                accessories_spec={"mirrors": mirrors} if mirrors is not None else None)
    base.update(fields)
    return BathroomEstimate(**base)


def mirror_lines(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]
            if "Mirror" in li["description"]}


def test_one_wide_mirror_over_a_double_vanity():
    lines = mirror_lines(estimate([{"width": 60, "count": 1}]))
    assert list(lines) == ['Detach & Reset - Mirror (60" wide)']
    line = lines['Detach & Reset - Mirror (60" wide)']
    assert (line["quantity"], line["unit_price"]) == (1, round(RATES[60] * MULT, 2))
    assert "two people" in line["notes"]


def test_two_small_mirrors_over_a_double_vanity():
    lines = mirror_lines(estimate([{"width": 24, "count": 1}, {"width": 24, "count": 1}]))
    line = lines['Detach & Reset - Mirror (24" wide)']
    assert (line["quantity"], line["unit_price"]) == (2, round(RATES[24] * MULT, 2))
    assert "two people" not in line["notes"]


def test_mirrors_of_two_widths_are_two_lines():
    lines = mirror_lines(estimate([{"width": 30, "count": 1}, {"width": 48, "count": 1}]))
    assert lines['Detach & Reset - Mirror (30" wide)']["unit_price"] == round(RATES[36] * MULT, 2)
    assert lines['Detach & Reset - Mirror (48" wide)']["unit_price"] == round(RATES[48] * MULT, 2)


def test_a_width_between_sizes_takes_the_next_size_up_and_past_72_goes_per_inch():
    assert price_by_width(RATES, 40, 36) == RATES[48]
    assert price_by_width(RATES, 72, 36) == RATES[72]
    per_inch = (RATES[72] - RATES[60]) / 12
    assert price_by_width(RATES, 84, 36) == pytest.approx(RATES[72] + 12 * per_inch)
    assert price_by_width(RATES, None, 36) == RATES[36]


def test_an_estimate_saved_before_mirrors_were_listed_prices_as_before():
    # One mirror per vanity, width not known: $116 each, as it always was
    lines = mirror_lines(estimate(vanities=2))
    line = lines["Detach & Reset - Mirror"]
    assert (line["quantity"], line["unit_price"]) == (2, round(RATES[36] * MULT, 2))
    assert RATES[36] == 116


def test_a_sketch_mirror_width_on_an_old_vanity_is_used():
    est = estimate(vanity_spec={"items": [{"width": 60, "sinks": 2, "has_mirror": True, "mirror_width": 60}]})
    assert mirror_groups(est) == [{"width": 60, "count": 1}]
    assert 'Detach & Reset - Mirror (60" wide)' in mirror_lines(est)


def test_no_mirror_line_without_d_and_r_and_a_new_mirror_is_torn_out_once_per_mirror():
    est = estimate([{"width": 24, "count": 2}], detach_reset_mirror=False, replace_mirror=True)
    assert not [d for d in mirror_lines(est) if d.startswith("Detach & Reset - Mirror")]
    demo = next(li for li in calculate_estimate(est)["line_items"] if li["phase"] == 1 and "Mirror x" in (li["notes"] or ""))
    assert f"Mirror x2 ${2 * DEMO_RATES['mirror'] * MULT:,.2f}" in demo["notes"]
