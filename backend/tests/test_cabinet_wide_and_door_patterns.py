"""Wider boxes, the three-door corner, door patterns and arched doors in the estimate."""

import pytest

from app.domains.tools.modules.cabinet_estimate.calculator import (
    BoxInput,
    _door_count,
    calculate_estimate,
)
from app.domains.tools.modules.cabinet_estimate.pricing import (
    BASE_RATES,
    DOOR_PATTERN_LABELS,
    DOOR_PATTERN_PREMIUM,
    DOOR_STYLE_MULTIPLIER,
    DOOR_STYLES,
    GLASS_DOOR_PREMIUM,
    SPECIALTY_PREMIUM,
    STANDARD_WIDTHS,
    WIDE_BOX_EFFICIENCY,
    is_standard_width,
    width_efficiency,
)


def _box(code, cab_type, width, height, specialty=None, pattern=None, qty=1, glass=False):
    return BoxInput(
        code=code,
        cab_type=cab_type,
        location="perimeter",
        width_inches=width,
        height_inches=height,
        is_specialty=specialty is not None,
        specialty_type=specialty,
        has_glass_door=glass,
        qty=qty,
        door_pattern=pattern,
    )


def _estimate(boxes, tier="Stock", **kw):
    # No O&P, which is baked into each line's unit price, so the rates read as declared.
    return calculate_estimate(
        boxes=boxes, tier=tier, zip_code="", overhead_pct=0, profit_pct=0, **kw,
    )


def _line(result, needle):
    return next(li for li in result.line_items if needle in li.description)


def _lines(result, needle):
    return [li for li in result.line_items if needle in li.description]


# ── Wider than 36" ──

@pytest.mark.parametrize("width", [39, 42, 45, 48])
def test_wide_widths_are_on_the_standard_grid(width):
    assert width in STANDARD_WIDTHS and is_standard_width(width)


def test_width_efficiency_is_untouched_up_to_36():
    assert width_efficiency(12) == 1.45
    assert width_efficiency(24, "wall") == 1.04
    assert width_efficiency(33) == 1.0
    assert width_efficiency(36) == 1.0
    assert width_efficiency(36, "wall") == 1.0


def test_wide_box_per_lf_falls_with_width_and_more_on_a_base():
    for cab_type, table in WIDE_BOX_EFFICIENCY.items():
        factors = [table[w] for w in sorted(table)]
        assert factors == sorted(factors, reverse=True)
        assert all(0 < f < 1 for f in factors)
    # Measured: B42 $1,203 vs B36 $1,135; W4230 $888 vs W3630 $777.
    assert width_efficiency(42, "base") == 0.91
    assert width_efficiency(42, "wall") == 0.97


def test_off_size_wide_width_takes_the_nearest_step_and_the_end_of_the_table():
    assert width_efficiency(40, "base") == WIDE_BOX_EFFICIENCY["base"][39]
    assert width_efficiency(60, "wall") == WIDE_BOX_EFFICIENCY["wall"][48]


def test_b42_supply_follows_the_measured_ratio_to_b36():
    b36 = _estimate([_box("B36", "base", 36, 34.5)])
    b42 = _estimate([_box("B42", "base", 42, 34.5)])
    ratio = _line(b42, "Base Cabinets").total / _line(b36, "Base Cabinets").total
    # B42 $1,203 / B36 $1,135 = 1.06 in Capital, $707.43 / $667.45 = 1.06 in KCD.
    assert ratio == pytest.approx(1.06, abs=0.005)
    assert "Non-Standard" not in _line(b42, "Base Cabinets").description


def test_w4230_supply_follows_the_measured_ratio_to_w3630():
    w36 = _estimate([_box("W3630", "wall", 36, 30)])
    w42 = _estimate([_box("W4230", "wall", 42, 30)])
    ratio = _line(w42, "Wall Cabinets").total / _line(w36, "Wall Cabinets").total
    # W42 / W36 at 30, 36 and 42"H: $888 / $777, $1,000 / $891, $1,154 / $1,028.
    assert 1000 / 891 <= ratio <= 888 / 777 + 0.001


def test_wide_box_install_stays_on_the_full_lf():
    b48 = _estimate([_box("B48", "base", 48, 34.5)], include_install=True)
    install = _line(b48, "Base Cabinet Installation")
    assert install.quantity == 4


def test_wide_boxes_count_their_hardware():
    def openings(box):
        return _line(_estimate([box], include_hardware=True), "Cabinet Hardware").quantity

    assert openings(_box("B36", "base", 36, 34.5)) == 3  # unchanged
    assert openings(_box("B42", "base", 42, 34.5)) == 4  # 2 doors + 2 drawers
    assert openings(_box("CUSTOM", "base", 60, 34.5)) == 6  # 3 doors + 3 drawers
    assert openings(_box("W3630", "wall", 36, 30)) == 2  # unchanged
    assert openings(_box("W4830", "wall", 48, 30)) == 2
    assert openings(_box("CUSTOM", "wall", 60, 30)) == 3
    assert openings(_box("W1830", "wall", 18, 30)) == 1  # unchanged


# ── Three-door corner ──

@pytest.mark.parametrize("width", [30, 33, 36])
def test_three_door_corner_bills_lf_plus_its_flat_premium(width):
    code = f"WTD{width}30"
    result = _estimate([_box(code, "wall", width, 30, "three_door_corner_wall")])
    line = _line(result, "Specialty Premium")
    # The three-door angle end's $200: the same wrap, the same two extra doors.
    assert line.unit_price == 200 == SPECIALTY_PREMIUM["three_door_angle_end_wall"]
    assert line.description == f"Specialty Premium - {code} (Three Door Corner Wall)"
    supply = _line(result, "Wall Cabinets")
    assert supply.quantity == pytest.approx(width / 12, abs=0.01)
    assert supply.unit_price == pytest.approx(BASE_RATES["Stock"]["wall_lf"], rel=0.02)


def test_three_door_corner_premium_scales_with_tier():
    box = _box("WTD3642", "wall", 36, 42, "three_door_corner_wall")
    assert _line(_estimate([box], tier="Custom"), "Specialty Premium").unit_price == 200 * 2.4


def test_no_price_jump_from_the_widest_three_door_angle_end_to_the_narrowest_three_door_corner():
    ends = _estimate([_box("WEA3D2730", "wall", 27, 30, "three_door_angle_end_wall")]).total
    corner = _estimate([_box("WTD3030", "wall", 30, 30, "three_door_corner_wall")]).total
    assert ends < corner < ends * 1.15


def test_three_door_corner_takes_three_pulls():
    box = _box("WTD3642", "wall", 36, 42, "three_door_corner_wall", qty=2)
    assert _line(_estimate([box], include_hardware=True), "Cabinet Hardware").quantity == 6


def test_three_door_corner_says_its_premium_is_an_allowance():
    result = _estimate([_box("WTD3642", "wall", 36, 42, "three_door_corner_wall")])
    assert any("WTD3642" in w and "confirm" in w for w in result.warning_flags)
    plain = _estimate([_box("WDC2436", "wall", 24, 36, "diagonal_corner_wall")])
    assert not any("confirm" in w for w in plain.warning_flags)


def test_three_door_corner_is_listed():
    assert "three_door_corner_wall" in SPECIALTY_PREMIUM


# ── Three-door angle end ──

@pytest.mark.parametrize("width", [12, 15, 18, 21, 24, 27])
@pytest.mark.parametrize("height", [30, 36, 42])
def test_three_door_angle_end_bills_its_width_and_a_flat_premium(width, height):
    code = f"WEA3D{width}{height}"
    result = _estimate([_box(code, "wall", width, height, "three_door_angle_end_wall")])
    line = _line(result, "Specialty Premium")
    assert (line.description, line.unit_price) == (f"Specialty Premium - {code} (Three Door Angle End Wall)", 200)
    assert _line(result, "Wall Cabinets").quantity == pytest.approx(width / 12, abs=0.01)
    # Derived from a price list, not a catalog box: the estimate says to confirm it.
    assert any(code in w and "confirm" in w for w in result.warning_flags)
    # A flat premium, so no "nearest listed size" note.
    assert not any("nearest listed size" in w for w in result.warning_flags)


def test_a_wider_three_door_angle_end_never_costs_less():
    totals = [
        _estimate([_box(f"WEA3D{w}30", "wall", w, 30, "three_door_angle_end_wall")]).total
        for w in (12, 15, 18, 21, 24, 27)
    ]
    assert totals == sorted(totals)


@pytest.mark.parametrize("height", [30, 36, 42])
def test_two_door_angle_end_bills_a_12_inch_upper_and_its_second_door(height):
    code = f"WEA2D12{height}"
    box = _box(code, "wall", 12, height, "two_door_angle_end_wall", qty=2)
    result = _estimate([box], include_hardware=True)
    line = _line(result, "Specialty Premium")
    assert (line.description, line.unit_price) == (f"Specialty Premium - {code} (Two Door Angle End Wall)", 90)
    assert _line(result, "Wall Cabinets").quantity == pytest.approx(2, abs=0.01)
    assert _line(result, "Cabinet Hardware").quantity == 4
    assert _door_count(box) == 2
    # A catalog box (Wolf WEC1230D), so nothing to confirm.
    assert not any("confirm" in w for w in result.warning_flags)


def test_angle_end_doors_one_two_three_cost_more_each_step():
    totals = [
        _estimate([_box(code, "wall", 12, 30, sp)]).total
        for code, sp in (
            ("WEA1230", "angle_end_wall"),
            ("WEA2D1230", "two_door_angle_end_wall"),
            ("WEA3D1230", "three_door_angle_end_wall"),
        )
    ]
    assert totals[0] < totals[1] < totals[2]


def test_three_door_angle_end_premium_scales_with_tier():
    box = _box("WEA3D2436", "wall", 24, 36, "three_door_angle_end_wall")
    assert _line(_estimate([box], tier="Custom"), "Specialty Premium").unit_price == 200 * 2.4


def test_three_door_angle_end_has_three_doors_where_the_angle_end_has_one():
    three = _box("WEA3D1236", "wall", 12, 36, "three_door_angle_end_wall", qty=2)
    assert _door_count(three) == 3
    assert _door_count(_box("WEA1236", "wall", 12, 36, "angle_end_wall")) == 1
    assert _line(_estimate([three], include_hardware=True), "Cabinet Hardware").quantity == 6
    # A door pattern is billed on all three doors.
    lattice = _box("WEA3D1236", "wall", 12, 36, "three_door_angle_end_wall", pattern="lattice")
    assert _line(_estimate([lattice]), "Diamond Lattice Door").quantity == 3


# ── Door patterns ──

def test_door_counts_follow_the_drawing():
    assert _door_count(_box("W1830", "wall", 18, 30)) == 1
    assert _door_count(_box("W3030", "wall", 30, 30)) == 2
    assert _door_count(_box("W4830", "wall", 48, 30)) == 2
    assert _door_count(_box("CUSTOM", "wall", 60, 30)) == 3
    assert _door_count(_box("B36", "base", 36, 34.5)) == 2
    assert _door_count(_box("SB36", "base", 36, 34.5, "sink_base")) == 2
    assert _door_count(_box("WTD3642", "wall", 36, 42, "three_door_corner_wall")) == 3
    assert _door_count(_box("WDC2436", "wall", 24, 36, "diagonal_corner_wall")) == 1
    assert _door_count(_box("WER2436", "wall", 24, 36, "easy_reach_corner_wall")) == 2
    assert _door_count(_box("WBC2736", "wall", 27, 36, "blind_corner_wall")) == 1
    assert _door_count(_box("BBC42", "base", 42, 34.5, "blind_corner")) == 1
    assert _door_count(_box("DB24", "base", 24, 34.5, "drawer_base")) == 0
    assert _door_count(_box("RB30S", "base", 30, 34.5, "range_base_slide_in")) == 0
    # A tall pantry: a tall row of doors and a short one; an oven or fridge cabinet one row.
    assert _door_count(_box("T1884", "tall", 18, 84)) == 2
    assert _door_count(_box("T2484", "tall", 24, 84)) == 4
    assert _door_count(_box("PRO3084", "tall", 30, 84, "pantry_rollout")) == 4
    assert _door_count(_box("OC3084", "tall", 30, 84, "oven_cabinet")) == 2
    assert _door_count(_box("DOC3090", "tall", 30, 90, "double_oven_cabinet")) == 2
    assert _door_count(_box("RC3684", "tall", 36, 84, "refrigerator_cabinet")) == 2


def test_lattice_is_billed_per_door_and_by_tier():
    box = _box("W3030", "wall", 30, 30, pattern="lattice", qty=2)
    line = _line(_estimate([box]), "Diamond Lattice Door")
    assert line.description == "Diamond Lattice Door - W3030"
    assert (line.quantity, line.unit, line.unit_price, line.total) == (4, "EA", 135, 540)
    assert line.category == "premium"
    custom = _line(_estimate([box], tier="Custom"), "Diamond Lattice Door")
    assert custom.unit_price == DOOR_PATTERN_PREMIUM["lattice"]["Custom"]


def test_lattice_band_costs_more_and_counts_the_doors_it_covers():
    box = _box("W3618", "wall", 36, 18, pattern="lattice_band")
    line = _line(_estimate([box]), "Lattice + Oval Band Door")
    assert (line.quantity, line.unit_price) == (2, 185)
    assert all(
        DOOR_PATTERN_PREMIUM["lattice_band"][t] > DOOR_PATTERN_PREMIUM["lattice"][t]
        for t in DOOR_PATTERN_PREMIUM["lattice"]
    )
    assert set(DOOR_PATTERN_PREMIUM) == set(DOOR_PATTERN_LABELS)


def test_a_mullion_glass_door_is_one_glass_door_per_door():
    # A glass door with bars over the glass: the glass door premium is that door,
    # frame and glass, so the frame isn't billed again as a pattern.
    box = _box("W2436", "wall", 24, 36, pattern="mullion", glass=True)
    result = _estimate([box], tier="Semi-Custom")
    line = _line(result, "Glass Mullion Door")
    assert line.description == "Glass Mullion Door - W2436"
    assert (line.quantity, line.unit_price, line.total) == (2, 225, 450)
    assert line.notes == "2 per cabinet, Semi-Custom tier; frame and glass"
    assert not _lines(result, "Glass Door - W2436")
    assert GLASS_DOOR_PREMIUM["Semi-Custom"] == 225
    assert DOOR_PATTERN_LABELS["mullion"] == "Glass Mullion"


def test_a_lattice_with_glass_is_a_glass_door_and_its_band_still_costs_extra():
    lattice = _line(_estimate([_box("W3030", "wall", 30, 30, pattern="lattice", glass=True)]), "Door -")
    assert lattice.description == "Diamond Lattice Glass Door - W3030"
    assert (lattice.quantity, lattice.unit_price) == (2, GLASS_DOOR_PREMIUM["Stock"])
    band = _line(_estimate([_box("W3630", "wall", 36, 30, pattern="lattice_band", glass=True)]), "Door -")
    assert band.description == "Lattice + Oval Band Glass Door - W3630"
    extra = DOOR_PATTERN_PREMIUM["lattice_band"]["Stock"] - DOOR_PATTERN_PREMIUM["mullion"]["Stock"]
    assert band.unit_price == GLASS_DOOR_PREMIUM["Stock"] + extra
    # Without glass the lattice is the frame alone, and says so.
    plain = _line(_estimate([_box("W3030", "wall", 30, 30, pattern="lattice")]), "Door -")
    assert plain.notes.endswith("glass not included")


def test_glass_without_a_pattern_is_billed_per_door():
    # Two W3030s, two doors each: four glass doors.
    result = _estimate([_box("W3030", "wall", 30, 30, glass=True, qty=2)])
    line = _line(result, "Glass Door - W3030")
    assert (line.quantity, line.unit_price) == (4, GLASS_DOOR_PREMIUM["Stock"])
    assert line.total == 4 * GLASS_DOOR_PREMIUM["Stock"]
    assert line.notes == "2 per cabinet, Stock tier; frame and glass"
    assert "Glass door upgrade applied to 4 door(s)" in result.warning_flags
    one_door = _line(_estimate([_box("W1830", "wall", 18, 30, glass=True)]), "Glass Door")
    assert one_door.quantity == 1


def test_a_mullion_glass_door_costs_what_a_plain_glass_door_does():
    # Same door, frame and glass; the mullion grid comes with the finished door.
    plain = _line(_estimate([_box("W2436", "wall", 24, 36, glass=True)], tier="Semi-Custom"), "Door - W2436")
    mullion = _line(
        _estimate([_box("W2436", "wall", 24, 36, pattern="mullion", glass=True)], tier="Semi-Custom"),
        "Door - W2436",
    )
    assert plain.description == "Glass Door - W2436"
    assert (plain.quantity, plain.total) == (mullion.quantity, mullion.total) == (2, 450)


def test_a_glass_tick_on_a_box_without_counted_doors_still_bills_one():
    box = _box("X24", "specialty", 24, 34.5, glass=True)
    assert _line(_estimate([box]), "Glass Door - X24").quantity == 1


def test_two_rows_of_the_same_cabinet_make_one_line():
    # One glass mullion upper each side of the hood, a three-door angle end at
    # each end of the run, each its own row in the sketch.
    rows = [
        _box("W2436", "wall", 24, 36, pattern="mullion", glass=True),
        _box("WEA3D1236", "wall", 12, 36, "three_door_angle_end_wall"),
        _box("W2436", "wall", 24, 36, pattern="mullion", glass=True),
        _box("WEA3D1236", "wall", 12, 36, "three_door_angle_end_wall"),
    ]
    result = _estimate(rows, tier="Semi-Custom")
    doors = _lines(result, "Glass Mullion Door - W2436")
    assert [(li.quantity, li.total) for li in doors] == [(4, 900)]
    premium = _lines(result, "Specialty Premium - WEA3D1236")
    assert len(premium) == 1
    assert premium[0].quantity == 2
    assert premium[0].total == round(premium[0].unit_price * 2, 2)
    assert len(result.warning_flags) == len(set(result.warning_flags))
    # The same as one row of qty 2.
    one_row = _estimate([
        _box("W2436", "wall", 24, 36, pattern="mullion", glass=True, qty=2),
        _box("WEA3D1236", "wall", 12, 36, "three_door_angle_end_wall", qty=2),
    ], tier="Semi-Custom")
    assert result.total == one_row.total


def test_rows_that_differ_keep_their_own_lines():
    result = _estimate([
        _box("W3030", "wall", 30, 30, pattern="lattice"),
        _box("W3030", "wall", 30, 30, pattern="lattice", glass=True),
    ])
    assert [li.description for li in _lines(result, "Door - W3030")] == [
        "Diamond Lattice Door - W3030", "Diamond Lattice Glass Door - W3030",
    ]


def test_a_three_door_corner_with_lattice_pays_for_all_three_doors():
    box = _box("WTD3642", "wall", 36, 42, "three_door_corner_wall", pattern="lattice")
    assert _line(_estimate([box]), "Diamond Lattice Door").quantity == 3


def test_a_tall_cabinet_takes_a_pattern_on_every_door():
    pantry = _box("T2484", "tall", 24, 84, pattern="lattice", qty=2)
    line = _line(_estimate([pantry]), "Diamond Lattice Door")
    assert line.description == "Diamond Lattice Door - T2484"
    assert (line.quantity, line.unit_price) == (8, 135)
    fridge = _box("RC3684", "tall", 36, 84, "refrigerator_cabinet", pattern="lattice_band")
    assert _line(_estimate([fridge]), "Lattice + Oval Band Door").quantity == 2
    plain = _estimate([_box("T2484", "tall", 24, 84)])
    assert not _lines(plain, "Door -")


def test_no_pattern_line_without_a_door_or_a_pattern():
    assert not _lines(_estimate([_box("W3030", "wall", 30, 30)]), "Door -")
    assert not _lines(_estimate([_box("DB24", "base", 24, 34.5, "drawer_base", pattern="lattice")]), "Lattice")
    assert not _lines(_estimate([_box("W3030", "wall", 30, 30, pattern="nonsense")]), "Door -")


def test_a_pattern_never_changes_the_box_supply():
    plain = _estimate([_box("W3030", "wall", 30, 30)])
    fancy = _estimate([_box("W3030", "wall", 30, 30, pattern="lattice")])
    assert _line(plain, "Wall Cabinets").total == _line(fancy, "Wall Cabinets").total


# ── Arched raised panel ──

def test_arched_raised_panel_is_offered_above_raised_panel():
    assert "Arched Raised Panel" in DOOR_STYLES
    assert DOOR_STYLE_MULTIPLIER["Arched Raised Panel"] > DOOR_STYLE_MULTIPLIER["Raised Panel"]


def test_arched_doors_raise_the_supply_and_warn():
    box = _box("W3030", "wall", 30, 30)
    arched = _estimate([box], door_style="Arched Raised Panel")
    raised = _estimate([box], door_style="Raised Panel")
    ratio = _line(arched, "Wall Cabinets").unit_price / _line(raised, "Wall Cabinets").unit_price
    assert ratio == pytest.approx(1.20 / 1.15, abs=0.001)
    assert any("Arched Raised Panel" in w and "confirm" in w for w in arched.warning_flags)
    assert not any("confirm" in w for w in raised.warning_flags)
