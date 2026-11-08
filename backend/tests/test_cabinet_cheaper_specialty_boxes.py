"""Sink bases, blind corners and angle ends bill as the cheaper boxes they are.

They used to bill at the full standard LF rate with a $0 premium, on the
theory that a harder install offset the cheaper carcass. Nothing billed
that install, so it was a ~25% overcharge on the box.
"""

import pytest

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate
from app.domains.tools.modules.cabinet_estimate.pricing import SPECIALTY_SUPPLY_MULTIPLIER


def _box(code, cab_type, width, height, specialty=None, qty=1):
    return BoxInput(
        code=code, cab_type=cab_type, location="perimeter",
        width_inches=width, height_inches=height,
        is_specialty=bool(specialty), specialty_type=specialty,
        has_glass_door=False, qty=qty,
    )


def _supply(result):
    """The cabinet box supply lines (not hardware, toe kick and the like)."""
    return {
        li.description: li for li in result.line_items
        if li.category == "supply" and li.unit == "LF" and "Cabinets" in li.description
    }


def _estimate(boxes, tier="Stock"):
    return calculate_estimate(
        boxes, tier, "22030", include_demo=False, include_delivery=False,
    )


@pytest.mark.parametrize("code,width,specialty,label", [
    ("SB36", 36, "sink_base", "Sink Base"),
    ("BBC42", 42, "blind_corner", "Blind Corner"),
    ("BEC24", 24, "angle_end_base", "Angle End Base"),
])
def test_cheaper_base_gets_its_own_line_at_the_measured_ratio(code, width, specialty, label):
    plain = _supply(_estimate([_box("B", "base", width, 34.5)]))
    special = _supply(_estimate([_box(code, "base", width, 34.5, specialty)]))
    [plain_line] = plain.values()
    line = special[f"Base Cabinets - {label} - Stock"]
    assert line.quantity == plain_line.quantity
    assert line.unit_price == pytest.approx(
        plain_line.unit_price * SPECIALTY_SUPPLY_MULTIPLIER[specialty], abs=0.02,
    )


def test_blind_corner_wall_is_cheaper_than_the_two_door_wall():
    plain = _supply(_estimate([_box("W2736", "wall", 27, 36)]))
    blind = _supply(_estimate([_box("WBC2736", "wall", 27, 36, "blind_corner_wall")]))
    [plain_line] = plain.values()
    [blind_line] = blind.values()
    assert "Blind Corner Wall" in blind_line.description
    assert blind_line.unit_price < plain_line.unit_price


def test_no_premium_or_negative_line_for_the_cheaper_boxes():
    r = _estimate([
        _box("SB36", "base", 36, 34.5, "sink_base"),
        _box("BBC42", "base", 42, 34.5, "blind_corner"),
        _box("WBC27", "wall", 27, 30, "blind_corner_wall"),
    ])
    assert not [li for li in r.line_items if "Specialty Premium" in li.description]
    assert all(li.total >= 0 for li in r.line_items)


def test_plain_boxes_stay_on_the_plain_line_beside_a_sink_base():
    r = _supply(_estimate([
        _box("B30", "base", 30, 34.5, qty=2),
        _box("SB36", "base", 36, 34.5, "sink_base"),
    ]))
    assert r["Base Cabinets - Stock"].quantity == 5.0  # 2 x 30"
    assert r["Base Cabinets - Sink Base - Stock"].quantity == 3.0


@pytest.mark.parametrize("height", [30, 36, 42])
def test_angle_end_upper_bills_as_a_plain_12_inch_upper(height):
    # About 6% under W1230 in the one line read (Kunal Westport), too little
    # for a cheaper line of its own: same supply, one door, one pull, no premium.
    plain = _estimate([_box("W12", "wall", 12, height)])
    angle = _estimate([_box(f"WEA12{height}", "wall", 12, height, "angle_end_wall")])
    assert [(li.description, li.quantity, li.unit_price) for li in angle.line_items] == [
        (li.description, li.quantity, li.unit_price) for li in plain.line_items
    ]
    assert angle.total == plain.total
