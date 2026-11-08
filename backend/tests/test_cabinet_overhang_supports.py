"""Island seating overhang supports are billed, and missing ones are flagged."""

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate
from app.domains.tools.modules.cabinet_estimate.pricing import COUNTERTOP_SUPPORT_RULE


def _estimate(**kw):
    box = BoxInput(
        code="B36", cab_type="base", location="island", width_inches=36,
        height_inches=34.5, is_specialty=False, specialty_type=None,
        has_glass_door=False, qty=2,
    )
    return calculate_estimate(
        [box], "Stock", "22030", include_demo=False, include_delivery=False,
        include_countertop=True, island_countertop_sqft=30,
        island_countertop_material="Granite", **kw,
    )


def _supports(result):
    return [li for li in result.line_items if "Overhang Support" in li.description]


def test_supports_are_billed_per_bracket():
    [line] = _supports(_estimate(countertop_support_count=4, island_seating_overhang_in=12))
    assert line.quantity == 4
    assert line.location == "island"
    assert line.total == round(4 * line.unit_price, 2)
    assert 0.5 < line.material_share < 0.7  # steel bracket vs fitting it


def test_overhang_past_the_limit_with_no_supports_warns():
    r = _estimate(island_seating_overhang_in=12)  # granite carries 10"
    assert not _supports(r)
    assert any("no overhang supports are billed" in w for w in r.warning_flags)


def test_overhang_inside_the_limit_does_not_warn():
    r = _estimate(island_seating_overhang_in=10)
    assert not any("overhang supports" in w for w in r.warning_flags)


def test_quartz_carries_more_than_granite():
    rule = COUNTERTOP_SUPPORT_RULE["max_unsupported_in"]
    assert rule["Quartz"] > rule["Granite"] > rule["Solid Surface"]


def test_no_countertop_no_supports_line():
    box = BoxInput(
        code="B36", cab_type="base", location="island", width_inches=36,
        height_inches=34.5, is_specialty=False, specialty_type=None,
        has_glass_door=False, qty=1,
    )
    r = calculate_estimate(
        [box], "Stock", "22030", include_demo=False, include_delivery=False,
        countertop_support_count=3,
    )
    assert not _supports(r)
