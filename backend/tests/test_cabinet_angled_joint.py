"""Angled (non-90°) joints and the angle cabinets are billed."""

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate


def _base(code, width, specialty=None):
    return BoxInput(
        code=code, cab_type="base", location="island", width_inches=width,
        height_inches=34.5, is_specialty=bool(specialty),
        specialty_type=specialty, has_glass_door=False, qty=1,
    )


def _lines(result, text):
    return [li for li in result.line_items if text in li.description]


def _estimate(tier="Stock", **kw):
    return calculate_estimate(
        [_base("B30", 30)], tier, "22030",
        include_demo=False, include_delivery=False, **kw,
    )


def test_each_angled_joint_bills_filler_and_fitting():
    r = _estimate(angled_joint_count=2)
    [joint] = _lines(r, "Angled Cabinet Joint")
    assert joint.quantity == 2
    assert joint.total == round(2 * joint.unit_price, 2)
    assert 0 < joint.material_share < 0.5  # mostly fitting labor


def test_no_angled_joints_no_line():
    assert not _lines(_estimate(), "Angled")


def test_angled_cut_only_with_a_countertop_and_priced_by_material():
    assert not _lines(_estimate(angled_joint_count=1), "Countertop Angled Cut")

    quartz = _estimate(
        angled_joint_count=1, include_countertop=True,
        island_countertop_sqft=30, island_countertop_material="Quartz",
    )
    laminate = _estimate(
        angled_joint_count=1, include_countertop=True,
        countertop_sqft=40, countertop_material="Laminate",
    )
    [q] = _lines(quartz, "Countertop Angled Cut")
    [lam] = _lines(laminate, "Countertop Angled Cut")
    assert q.location == "island" and lam.location == "perimeter"
    assert q.unit_price > lam.unit_price


def test_angled_filler_costs_more_in_a_better_tier():
    stock = _lines(_estimate("Stock", angled_joint_count=1), "Angled Cabinet Joint")[0]
    custom = _lines(_estimate("Custom", angled_joint_count=1), "Angled Cabinet Joint")[0]
    assert custom.unit_price > stock.unit_price


def test_diagonal_corner_base_carries_a_premium_and_angle_end_does_not():
    r = calculate_estimate(
        [_base("DCB36", 36, "diagonal_corner_base"), _base("BEC24", 24, "angle_end_base")],
        "Stock", "22030", include_demo=False, include_delivery=False,
    )
    assert _lines(r, "Specialty Premium - DCB36")
    assert not _lines(r, "Specialty Premium - BEC24")
