"""What a market check of a Semi-Custom kitchen estimate found to read
wrong: two boxes of one code each adding the same premium line, so the
estimate looked like it billed one charge twice, and an island end panel
area no two ends could reach. The calculator on its own."""

import pytest

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate


def _box(code, width, height, specialty=None, glass=False, pattern=None, location="perimeter", qty=1):
    return BoxInput(
        code=code, cab_type="wall", location=location, width_inches=width, height_inches=height,
        is_specialty=specialty is not None, specialty_type=specialty, has_glass_door=glass,
        qty=qty, door_pattern=pattern,
    )


def _estimate(boxes, **kw):
    return calculate_estimate(
        boxes=boxes, tier="Semi-Custom", zip_code="", overhead_pct=0, profit_pct=0, **kw,
    )


def _lines(result, needle):
    return [li for li in result.line_items if needle in li.description]


# ── The same box drawn twice ──

def test_two_boxes_of_one_code_share_their_premium_lines():
    # As drawn in a plan: each cabinet is its own box
    drawn = [
        _box("WEA3D1236", 12, 36, "three_door_angle_end_wall"),
        _box("WEA3D1236", 12, 36, "three_door_angle_end_wall"),
        _box("W2436", 24, 36, glass=True, pattern="mullion"),
        _box("W2436", 24, 36, glass=True, pattern="mullion"),
    ]
    result = _estimate(drawn)
    for needle, qty in (
        ("Specialty Premium - WEA3D1236", 2),
        ("Glass Mullion Door - W2436", 4),
        ("Glass Inserts - W2436", 4),
    ):
        lines = _lines(result, needle)
        assert len(lines) == 1, needle
        assert lines[0].quantity == qty
        assert lines[0].total == pytest.approx(qty * lines[0].unit_price)
    # Its note is said once, too
    notes = [w for w in result.warning_flags if "premium applied: WEA3D1236" in w]
    assert len(notes) == 1


def test_merging_keeps_the_total():
    drawn = [_box("W2436", 24, 36, glass=True, pattern="mullion") for _ in range(2)]
    as_one = [_box("W2436", 24, 36, glass=True, pattern="mullion", qty=2)]
    assert _estimate(drawn).total == _estimate(as_one).total


def test_the_island_and_the_perimeter_keep_their_own_lines():
    result = _estimate([
        _box("W2436", 24, 36, glass=True),
        _box("W2436", 24, 36, glass=True, location="island"),
    ])
    assert sorted(li.location for li in _lines(result, "Glass Door - W2436")) == ["island", "perimeter"]


# ── Island end panels ──

def _island(**kw):
    box = BoxInput(
        code="B36", cab_type="base", location="island", width_inches=36, height_inches=34.5,
        is_specialty=False, specialty_type=None, has_glass_door=False, qty=3,
    )
    return calculate_estimate(
        [box], "Semi-Custom", "", include_demo=False, include_delivery=False, **kw,
    )


def _end_panel_note(result):
    return [w for w in result.warning_flags if w.startswith("Island end panels")]


def test_an_end_panel_area_past_two_ends_is_flagged():
    # 9 LF at 34.5" = 25.9 SF: the island's length in the LF box, not its two 24" ends
    note = _end_panel_note(_island(island_end_panel_sqft=25.9))
    assert note == ['Island end panels: 25.9 SF is more than two 24"-deep ends reach even at 42" high '
                    '(14 SF). Measure the panels.']


@pytest.mark.parametrize("sf, kw", [
    (11.5, {}),                                      # two 24" ends at 34.5"
    (14, {}),                                        # ... at 42" bar height
    (18.7, {"island_seating_overhang_in": 15}),      # ends run out under a 15" overhang
    (23, {"island_two_sided": True}),                # back to back: two 48" ends
])
def test_end_panels_two_ends_can_reach_are_not_flagged(sf, kw):
    assert _end_panel_note(_island(island_end_panel_sqft=sf, **kw)) == []
