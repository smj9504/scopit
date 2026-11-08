"""A tub's or shower's faucet and drain can be put where they are on the
sketch; an option that moves them where the fixture stays (a tub's drain end
swapped, a shower valve on another wall) is priced for it. Unset, they're
where the sketch always drew them, so old sketches price as before."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.tools.modules.bathroom_estimate.layout_changes import (  # noqa: E402
    layout_change_line_items,
    layout_changes,
)
from app.domains.tools.modules.bathroom_estimate.plumbing_points import (  # noqa: E402
    default_drain,
    drain_of,
    faucet_of,
    in_room,
    snap_faucet,
)
from app.domains.tools.modules.bathroom_estimate.pricing import LAYOUT_CHANGE_RATES  # noqa: E402


def px(inches):
    return inches / 12 * 40


def fixture(fid, ftype, x_in, y_in, w, h, rotation=0, **props):
    return {"id": fid, "type": ftype, "position": {"x": px(x_in), "y": px(y_in)},
            "dimensions": {"width": w, "height": h}, "rotation": rotation, "properties": props}


def sketch(fixtures):
    return {"walls": [], "rooms": [], "fixtures": fixtures, "settings": {"pixelsPerFoot": 40}}


def tub(**props):
    return fixture("tub", "bathtub", 30, 16, 60, 32, bathtubSubType="standard_alcove", **props)


def shower(**props):
    return fixture("shower", "shower", 84, 18, 36, 36, **{"showerLayout": "alcove", **props})


# ── Where they are ──

def test_unset_they_are_where_the_sketch_always_drew_them():
    assert faucet_of(tub()) == (0.5, 0.0)
    # 6" in from the faucet on the back wall of a 32"-deep tub
    assert drain_of(tub()) == pytest.approx((0.5, 6 / 32))
    assert faucet_of(shower()) == (0.5, 0.0)
    assert drain_of(shower()) == (0.5, 0.5)
    assert faucet_of(fixture("f", "bathtub", 0, 0, 60, 30, bathtubSubType="freestanding")) == (0.5, 1.0)


def test_a_tubs_drain_follows_its_faucet_until_moved_on_its_own():
    left = tub(faucetPos={"x": 0, "y": 0.5})
    assert drain_of(left) == pytest.approx((0.1, 0.5))
    assert drain_of(tub(faucetPos={"x": 0, "y": 0.5}, drainPos={"x": 0.5, "y": 0.5})) == (0.5, 0.5)
    # Out of the tub it's pulled back in
    assert drain_of(tub(drainPos={"x": 1.4, "y": -1})) == (0.92, 0.08)


def test_a_wall_faucet_goes_onto_a_wall_it_can_have():
    # Dropped near the open front of an alcove tub: onto the nearest end wall instead
    assert snap_faucet(tub(), (0.97, 0.9)) == (1.0, 0.9)
    # Halfway between the two ends: the left one, as the sketch does
    assert snap_faucet(tub(), (0.5, 0.9)) == (0.0, 0.9)
    # A corner shower glassed on the left has its valve on the back or the right wall only
    corner = shower(showerLayout="corner_right")
    assert snap_faucet(corner, (0.02, 0.5)) == (0.1, 0.0)
    assert snap_faucet(corner, (0.95, 0.6)) == (1.0, 0.6)
    # A drop-in's faucet is on its deck, anywhere
    deck = fixture("t", "bathtub", 0, 0, 60, 32, bathtubSubType="drop_in")
    assert snap_faucet(deck, (0.3, 0.6)) == (0.3, 0.6)


def test_points_turn_with_the_fixture():
    # A 60" tub turned 90°: its left end (west) is at the top of the room
    turned = fixture("t", "bathtub", 50, 50, 60, 32, rotation=90, bathtubSubType="standard_alcove")
    x, y = in_room(turned, (0, 0.5), 40)
    assert (round(x, 6), round(y, 6)) == (50, 20)


# ── On an option ──

BASE = sketch([tub(faucetPos={"x": 0, "y": 0.5}), shower()])


def test_a_tubs_drain_end_swapped_is_priced_as_a_drain_and_a_faucet_moved():
    option = sketch([tub(faucetPos={"x": 1, "y": 0.5}), shower()])
    changes = layout_changes(BASE, option)
    assert sorted((c.kind, c.item) for c in changes) == [("drain_moved", "bathtub"), ("valve_moved", "bathtub")]
    assert {c.label for c in changes} == {"Tub drain moved 48 in", "Tub faucet moved 60 in"}

    items, rough, warnings = layout_change_line_items(changes, labor_mult=1.1)
    by_name = {i["description"]: i for i in items}
    assert by_name["Relocate tub drain"]["total"] == round(LAYOUT_CHANGE_RATES["drain_relocation"] * 1.1, 2)
    assert by_name["Relocate tub faucet & supply"]["total"] == round(LAYOUT_CHANGE_RATES["valve_relocation"] * 1.1, 2)
    assert rough is True
    assert any("slab" in w for w in warnings)


def test_a_shower_valve_on_another_wall_is_priced_and_its_drain_left_alone():
    option = sketch([tub(faucetPos={"x": 0, "y": 0.5}), shower(faucetPos={"x": 0, "y": 0.5})])
    [change] = layout_changes(BASE, option)
    assert (change.kind, change.item, change.label) == ("valve_moved", "shower", "Shower valve moved 25 in")
    items, _, _ = layout_change_line_items([change])
    assert [i["description"] for i in items] == ["Relocate shower valve & supply"]


def test_a_fixture_moved_is_one_relocation_not_three():
    option = sketch([fixture("tub", "bathtub", 30, 50, 60, 32, bathtubSubType="standard_alcove",
                             faucetPos={"x": 1, "y": 0.5}), shower()])
    assert [(c.kind, c.item) for c in layout_changes(BASE, option)] == [("moved", "bathtub")]


def test_nothing_moved_nothing_priced():
    assert layout_changes(BASE, sketch([tub(faucetPos={"x": 0, "y": 0.5}, drainPos=None), shower()])) == []
    # A drain nudged a few inches isn't a move
    nudged = sketch([tub(faucetPos={"x": 0, "y": 0.5}, drainPos={"x": 0.15, "y": 0.5}), shower()])
    assert default_drain(tub(faucetPos={"x": 0, "y": 0.5})) == pytest.approx((0.1, 0.5))
    assert layout_changes(BASE, nudged) == []
