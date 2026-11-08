"""An option that moves the bathroom around is priced for it: fixtures moved,
added or taken out, a tub turned into a shower, walls and doors moved —
against the bathroom as it is (an insurance job's restoration, a remodel's
current layout). On a throwaway SQLite database for the service parts."""

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate.layout_changes import (  # noqa: E402
    layout_change_line_items,
    layout_changes,
)
from app.domains.tools.modules.bathroom_estimate.pricing import LAYOUT_CHANGE_RATES  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.schemas import (  # noqa: E402
    BathroomEstimateCreate,
    BathroomEstimateUpdate,
)
from app.domains.tools.modules.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from tests.bathroom_db import COMPANY_ID, make_session  # noqa: E402


# 40 px to the foot: a 9 ft × 7 ft bath drawn from (0,0) to (360,280)
def px(inches):
    return inches / 12 * 40


def wall(wid, x0, y0, x1, y1):
    return {"id": wid, "start": {"x": x0, "y": y0}, "end": {"x": x1, "y": y1}, "thickness": 6, "heightInches": 96}


def fixture(fid, ftype, x_in, y_in, w, h, **props):
    return {"id": fid, "type": ftype, "position": {"x": px(x_in), "y": px(y_in)},
            "dimensions": {"width": w, "height": h}, "rotation": 0, "properties": props}


def room_walls(width_in=108, depth_in=84, prefix="w"):
    w, d = px(width_in), px(depth_in)
    return [wall(f"{prefix}-n", 0, 0, w, 0), wall(f"{prefix}-e", w, 0, w, d),
            wall(f"{prefix}-s", w, d, 0, d), wall(f"{prefix}-w", 0, d, 0, 0)]


def sketch(fixtures, walls=None):
    return {"version": "1.0.0", "walls": walls if walls is not None else room_walls(), "rooms": [],
            "fixtures": fixtures, "tileZones": [], "damageZones": [], "drywallRepairZones": [],
            "insulationZones": [], "settings": {"pixelsPerFoot": 40}}


BATH = sketch([
    fixture("toilet", "toilet", 20, 70, 15, 29),
    fixture("vanity", "vanity", 70, 74, 36, 21, sinkCount=1),
    fixture("tub", "bathtub", 30, 16, 60, 32, bathtubSubType="standard_alcove"),
    fixture("door", "door", 92, 68, 32, 32),
    fixture("light", "light", 54, 42, 8, 8),
])


def option_of(base, **changes):
    s = copy.deepcopy(base)
    by_id = {f["id"]: f for f in s["fixtures"]}
    for fid, change in changes.items():
        if change is None:
            s["fixtures"].remove(by_id[fid])
        else:
            by_id[fid].update(change)
    return s


def kinds(changes):
    return sorted((c.kind, c.item) for c in changes)


# ── Comparing layouts ──

def test_an_unchanged_copy_has_no_changes():
    assert layout_changes(BATH, copy.deepcopy(BATH)) == []


def test_a_toilet_moved_across_the_room_but_not_one_nudged():
    moved = option_of(BATH, toilet={"position": {"x": px(56), "y": px(70)}})
    [change] = layout_changes(BATH, moved)
    assert (change.kind, change.item, change.distance_in, change.key) == ("moved", "toilet", 36.0, "moved:toilet")
    assert change.label == "Toilet moved 36 in"

    nudged = option_of(BATH, toilet={"position": {"x": px(23), "y": px(70)}})
    assert layout_changes(BATH, nudged) == []


def test_a_fixture_drawn_again_is_paired_with_the_old_one():
    redrawn = option_of(BATH, toilet=None)
    redrawn["fixtures"].append(fixture("toilet-2", "toilet", 20, 40, 15, 29))
    [change] = layout_changes(BATH, redrawn)
    assert (change.kind, change.item, change.distance_in) == ("moved", "toilet", 30.0)


def test_a_second_sink_and_a_tub_turned_into_a_shower():
    remodel = option_of(BATH, vanity={"properties": {"sinkCount": 2}, "dimensions": {"width": 60, "height": 21}}, tub=None)
    remodel["fixtures"].append(fixture("shower", "shower", 24, 20, 48, 36))
    assert kinds(layout_changes(BATH, remodel)) == [("converted", "tub_to_shower"), ("sinks_added", "vanity")]


def test_a_shower_somewhere_else_is_a_new_one_and_the_tub_is_capped():
    remodel = option_of(BATH, tub=None)
    remodel["fixtures"].append(fixture("shower", "shower", 90, 20, 36, 36))
    assert kinds(layout_changes(BATH, remodel)) == [("added", "shower"), ("removed", "bathtub")]


def test_doors_and_lights_move_too_but_a_light_only_past_a_foot():
    moved = option_of(BATH, door={"position": {"x": px(60), "y": px(68)}}, light={"position": {"x": px(54), "y": px(50)}})
    assert kinds(layout_changes(BATH, moved)) == [("moved", "door")]
    farther = option_of(BATH, light={"position": {"x": px(30), "y": px(42)}})
    assert kinds(layout_changes(BATH, farther)) == [("moved", "light")]


def test_walls_are_compared_as_lines():
    # The same room drawn again, its north wall in two pieces: nothing changed
    redrawn = sketch(BATH["fixtures"], room_walls(prefix="x")[1:] + [
        wall("x-n1", 0, 0, px(40), 0), wall("x-n2", px(40), 0, px(108), 0),
    ])
    assert layout_changes(BATH, redrawn) == []

    # The room pushed 24" east: a new 7 ft east wall and longer north/south walls; the old east wall gone
    bigger = sketch(BATH["fixtures"], room_walls(width_in=132, prefix="y"))
    changes = {c.key: c for c in layout_changes(BATH, bigger)}
    assert changes["wall_removed:w-e"].length_ft == 7.0
    assert changes["wall_added:y-e"].length_ft == 7.0
    assert changes["wall_added:y-n"].length_ft == 2.0
    assert changes["wall_added:y-s"].length_ft == 2.0
    assert len(changes) == 4


# ── Pricing ──

def test_each_change_is_priced_with_the_zip_labor_multiplier_and_can_be_left_out():
    remodel = option_of(BATH, toilet={"position": {"x": px(56), "y": px(70)}}, tub=None)
    remodel["fixtures"].append(fixture("shower", "shower", 24, 20, 48, 36))
    changes = layout_changes(BATH, remodel)

    items, rough, warnings = layout_change_line_items(changes, labor_mult=1.1)
    by_name = {i["description"]: i for i in items}
    assert by_name["Relocate toilet drain & flange"]["total"] == round(LAYOUT_CHANGE_RATES["toilet_relocation"] * 1.1, 2)
    assert by_name["Tub-to-shower conversion: drain & valve rework"]["phase"] == 2
    assert rough is True
    assert any("slab" in w for w in warnings)

    items, _, _ = layout_change_line_items(changes, skips={"moved:toilet"})
    assert [i["description"] for i in items] == ["Tub-to-shower conversion: drain & valve rework"]


def test_walls_are_priced_by_the_foot():
    bigger = sketch(BATH["fixtures"], room_walls(width_in=132, prefix="y"))
    items, rough, warnings = layout_change_line_items(layout_changes(BATH, bigger))
    framing = [i for i in items if i["unit"] == "LF" and i["phase"] == 3]
    demo = [i for i in items if i["phase"] == 1]
    assert sum(i["quantity"] for i in framing) == 11.0
    assert [i["quantity"] for i in demo] == [7.0]
    assert rough is False
    assert any("load-bearing" in w for w in warnings)


# ── In the estimate ──

@pytest.fixture
def service(tmp_path):
    s = make_session(tmp_path)
    yield BathroomEstimateService(s, COMPANY_ID)
    s.close()


def descriptions(estimate):
    return [li["description"] for li in estimate["line_items"]]


def test_an_option_is_priced_for_moving_the_toilet_and_the_restoration_is_not(service):
    restoration = service.create_estimate(BathroomEstimateCreate(
        property_address="12 Elm St", zip_code="20850", state="MD", sketch_data=BATH, replace_toilet=True,
    ))
    option = service.add_option(restoration["id"])
    service.update_estimate(option["id"], BathroomEstimateUpdate(
        sketch_data=option_of(BATH, toilet={"position": {"x": px(56), "y": px(70)}}),
    ))

    priced = service.calculate(option["id"])
    assert "Relocate toilet drain & flange" in descriptions(priced)
    assert "Relocate toilet drain & flange" not in descriptions(service.calculate(restoration["id"]))

    report = service.get_layout_changes(option["id"])
    assert report["baseline"] == {"id": restoration["id"], "kind": "restore", "name": "Restoration"}
    assert [c["key"] for c in report["changes"]] == ["moved:toilet"]

    # Left out: gone on the next calculation
    service.update_estimate(option["id"], BathroomEstimateUpdate(plumbing_spec={"layout_change_skips": ["moved:toilet"]}))
    assert "Relocate toilet drain & flange" not in descriptions(service.calculate(option["id"]))
    assert service.get_layout_changes(option["id"])["skips"] == ["moved:toilet"]


def test_a_remodel_prices_its_options_against_its_current_layout(service):
    option_a = service.create_estimate(BathroomEstimateCreate(project_type="remodel", sketch_data=BATH))
    assert service.get_layout_changes(option_a["id"])["baseline"] is None

    current = service.add_current_layout(option_a["id"])
    assert (current["kind"], current["option_label"], current["total"], current["line_items"]) == ("existing", "Current layout", 0, [])
    with pytest.raises(ValueError):
        service.add_current_layout(option_a["id"])
    with pytest.raises(ValueError):
        service.calculate(current["id"])

    # The job's row in the list is still its first option
    rows, _ = service.list_estimates(grouped=True)
    assert [r["id"] for r in rows] == [option_a["id"]]

    service.update_estimate(option_a["id"], BathroomEstimateUpdate(sketch_data=option_of(BATH, vanity={"properties": {"sinkCount": 2}})))
    assert "Rough-in for added sink (supply & drain)" in descriptions(service.calculate(option_a["id"]))
    assert service.get_layout_changes(option_a["id"])["baseline"]["name"] == "Current layout"


def test_a_remodel_made_an_insurance_job_restores_its_current_layout(service):
    option_a = service.create_estimate(BathroomEstimateCreate(project_type="remodel", sketch_data=BATH))
    current = service.add_current_layout(option_a["id"])
    switched = service.set_project_type(option_a["id"], "insurance")
    kinds_by_id = {m["id"]: m["kind"] for m in switched["group_members"]}
    assert kinds_by_id == {current["id"]: "restore", option_a["id"]: "option"}
