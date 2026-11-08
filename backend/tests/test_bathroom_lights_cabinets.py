"""A bathroom's lights, wall cabinets and soffits on the estimate.

Lights come in kinds (a 3-light vanity bar, recessed cans, sconces, a
ceiling fixture, a pendant), each its own line, new or detached and reset;
estimates saved before kept one vanity light and one ceiling light, and
still price the same. Medicine cabinets and wall cabinets are lines of their
own the same way. A soffit hides the wall above its underside and adds its
faces to the wall paint."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate import calculator  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.layout_changes import (  # noqa: E402
    layout_change_line_items,
    layout_changes,
)
from app.domains.tools.modules.bathroom_estimate.lights import light_groups  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import BathroomEstimate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.pricing import (  # noqa: E402
    DETACH_RESET_COSTS,
    ELECTRICAL_RATES,
    MIRROR_INSTALL,
    MIRROR_PRICES,
    MOISTURE_RESISTANT_PAINT_MULT,
    PAINT_RATES,
    WALL_CABINET_INSTALL,
    WALL_CABINET_PRICE,
    apply_material_handling,
    get_labor_multiplier,
)

ZIP = "20850"
MULT = get_labor_multiplier(ZIP)


@pytest.fixture(autouse=True)
def no_material_tax(monkeypatch):
    # Rates as the tables give them: no tax folded into the material share
    monkeypatch.setattr(calculator, "get_material_tax_loading", lambda *a, **k: 0)


# Walls painted all round. The total is the exact sum of the lines, never rounded
# to $10 into one of them, so each line is priced as the tables give it
PAINTED = {"wall_finish": "paint", "paint_grade": "standard"}


def estimate(**fields):
    base = dict(property_address="12 Elm St", state="MD", zip_code=ZIP, length_ft=8, width_ft=6,
                floor_sf=40, wall_sf=600, height_ft=8, walls_spec=PAINTED)
    base.update(fields)
    return BathroomEstimate(**base)


def lines(est):
    return {li["description"]: li for li in calculate_estimate(est)["line_items"]}


def electrical(est):
    return {d: li for d, li in lines(est).items() if li["category"] in ("electrical", "fixture")
            and ("light" in d.lower() or "sconce" in d.lower())}


# ── Lights ──

def test_an_old_estimate_prices_its_one_vanity_light_and_ceiling_light_as_before():
    old = estimate(replace_vanity_light=True,
                   electrical_spec={"ceiling_fixture": "recessed_multi", "recessed_can_count": 4})
    got = electrical(old)
    assert set(got) == {"Vanity light fixture installation", "Recessed light installation (4 cans)"}
    assert got["Vanity light fixture installation"]["quantity"] == 1
    assert got["Recessed light installation (4 cans)"]["unit_price"] == round(ELECTRICAL_RATES["recessed_light_multi"] * MULT, 2)

    dr = estimate(detach_reset_vanity_light=True, electrical_spec={"ceiling_fixture": "standard"})
    assert set(electrical(dr)) == {"Detach & Reset - Vanity light fixture", "Ceiling light fixture installation"}


def test_each_kind_of_light_is_its_own_line():
    est = estimate(electrical_spec={"lights": [
        {"type": "vanity_bar", "count": 2, "bulbs": 3, "action": "replace"},
        {"type": "recessed", "count": 4},
        {"type": "sconce", "count": 2},
        {"type": "ceiling", "count": 1, "action": "detach_reset"},
        {"type": "pendant", "count": 1},
    ]})
    got = electrical(est)
    assert list(got) == [
        "Vanity light fixture installation (3-light)",
        "Recessed light installation (4 cans)",
        "Wall sconce installation",
        "Detach & Reset - Ceiling light fixture",
        "Pendant light installation",
    ]
    assert got["Vanity light fixture installation (3-light)"]["quantity"] == 2
    assert got["Wall sconce installation"]["unit_price"] == round(ELECTRICAL_RATES["vanity_light_install"] * MULT, 2)
    assert got["Pendant light installation"]["unit_price"] == round(ELECTRICAL_RATES["ceiling_fixture_install"] * MULT, 2)
    assert got["Detach & Reset - Ceiling light fixture"]["unit_price"] == round(DETACH_RESET_COSTS["vanity_light"] * MULT, 2)


def test_one_recessed_can_is_priced_alone_and_rows_of_a_kind_add_up():
    one = estimate(electrical_spec={"lights": [{"type": "recessed", "count": 1}]})
    assert electrical(one)["Recessed light installation (1 can)"]["unit_price"] == round(
        ELECTRICAL_RATES["recessed_light_install"] * MULT, 2)

    est = estimate(electrical_spec={"lights": [
        {"type": "vanity_bar", "count": 1, "bulbs": 3}, {"type": "vanity_bar", "count": 1, "bulbs": 3},
        {"type": "vanity_bar", "count": 1, "bulbs": 2}, {"type": "sconce", "count": 0},
        {"type": "standard", "count": 1}, {"type": "nonsense", "count": 3},
    ]})
    assert light_groups(est) == [
        {"type": "vanity_bar", "count": 2, "bulbs": 3, "action": "replace"},
        {"type": "vanity_bar", "count": 1, "bulbs": 2, "action": "replace"},
        {"type": "ceiling", "count": 1, "bulbs": None, "action": "replace"},
    ]


def test_a_list_of_lights_replaces_the_old_fields_even_empty():
    est = estimate(replace_vanity_light=True, electrical_spec={"lights": [], "ceiling_fixture": "standard"})
    assert electrical(est) == {}


def test_a_picked_vanity_light_prices_the_vanity_bars_only():
    est = estimate(kind="option", selections={"vanity_light": {"title": "Kichler 3-Light Bath Bar", "price": 120,
                                                               "price_unit": "each"}},
                   electrical_spec={"lights": [{"type": "vanity_bar", "count": 1, "bulbs": 3},
                                               {"type": "sconce", "count": 2}]})
    got = electrical(est)
    bar = got["Vanity light - Kichler 3-Light Bath Bar (supply + install)"]
    assert bar["unit_price"] == round(apply_material_handling(120) + round(ELECTRICAL_RATES["vanity_light_install"] * MULT, 2), 2)
    assert "Wall sconce installation" in got


# ── Cabinets ──

def test_medicine_and_wall_cabinets_new_or_detached_and_reset():
    est = estimate(accessories_spec={"cabinets": [
        {"type": "medicine_cabinet", "count": 1, "action": "detach_reset"},
        {"type": "medicine_cabinet_recessed", "count": 1, "action": "replace"},
        {"type": "wall_cabinet", "count": 1, "action": "detach_reset"},
        {"type": "wall_cabinet", "count": 1, "action": "replace"},
    ]})
    got = lines(est)
    assert got["Detach & Reset - Medicine cabinet, mirrored (surface mount)"]["unit_price"] == round(
        DETACH_RESET_COSTS["medicine_cabinet"] * MULT, 2)
    assert got["Detach & Reset - Wall cabinet"]["unit_price"] == round(DETACH_RESET_COSTS["wall_cabinet"] * MULT, 2)
    assert got["Medicine cabinet, mirrored (recessed) (supply + install)"]["unit_price"] == round(
        apply_material_handling(MIRROR_PRICES["medicine_cabinet_recessed"]) + round(MIRROR_INSTALL * MULT, 2), 2)
    assert got["Wall cabinet (supply + install)"]["unit_price"] == round(
        apply_material_handling(WALL_CABINET_PRICE) + round(WALL_CABINET_INSTALL * MULT, 2), 2)
    # The accessories line doesn't take the cabinets in
    assert not any(d.startswith("Bathroom accessories") for d in got)


# ── Soffits ──

def test_a_soffit_takes_the_wall_behind_it_off_the_paint_and_adds_its_faces():
    plain = lines(estimate())["Wall painting (moisture-resistant, standard grade)"]
    with_soffit = lines(estimate(walls_spec={**PAINTED, "soffit_hidden_wall_sf": 10, "soffit_face_sf": 5}))
    line = with_soffit["Wall painting (moisture-resistant, standard grade)"]
    assert plain["quantity"] == 600
    assert line["quantity"] == 600 - 10 + 5
    assert line["notes"] == "Walls 600 SF | - Behind soffit 10 SF | + Soffit faces 5 SF | = Paintable 595 SF"
    assert abs(line["unit_price"]
               - PAINT_RATES["wall_per_sf"] * MOISTURE_RESISTANT_PAINT_MULT * MULT) < 0.05


# ── Layout changes ──

def px(inches):
    return inches / 12 * 40


def fixture(fid, x_in, y_in, **props):
    return {"id": fid, "type": "light", "position": {"x": px(x_in), "y": px(y_in)},
            "dimensions": {"width": 8, "height": 8}, "rotation": 0, "properties": props}


def sketch(fixtures):
    return {"walls": [], "rooms": [], "fixtures": fixtures, "settings": {"pixelsPerFoot": 40}}


def test_a_new_vanity_bar_is_a_wall_box_and_isnt_taken_for_the_ceiling_light():
    base = sketch([fixture("ceiling", 54, 42)])
    option = sketch([fixture("ceiling-2", 54, 44), fixture("bar", 70, 2, lightType="vanity_bar", lightBulbs=3)])
    changes = layout_changes(base, option)
    assert [(c.kind, c.item) for c in changes] == [("added", "wall_light")]
    items, _, _ = layout_change_line_items(changes)
    assert [i["description"] for i in items] == ["New wall light box & wiring"]
