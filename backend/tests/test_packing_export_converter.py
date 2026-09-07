"""
Tests for how the itemized ("Mode B") materials shape flows into the PDF/
Excel line-item splitter (export.py) and the real Scopit Estimate converter
(converter.py).

The two have deliberately different granularity: the printed estimate rolls
every material up into the 3-4 category lump sums (Packing Supplies /
Protective Wrapping / Specialty Packaging, plus any markup), while the real
Estimate keeps medium-granularity per-SKU-type lines.
"""
import pytest

from app.domains.tools.modules.packing.converter import (
    PackingEstimateConverter,
    _group_itemized_materials_for_estimate,
)
from app.domains.tools.modules.packing.export import _section_details_to_line_items
from app.domains.tools.modules.packing.service import MATERIAL_MARKUP_CODE


def _sample_itemized_material_details():
    return [
        {"code": "3026", "name": "Small Box (1.5 cu ft)", "quantity": 14,
         "unit": "EA", "unit_price": 4.82, "total": 67.48},
        {"code": "3025", "name": "Medium Box (3.0 cu ft)", "quantity": 6,
         "unit": "EA", "unit_price": 5.96, "total": 35.76},
        {"code": "2915", "name": "Moving Blanket", "quantity": 8,
         "unit": "EA", "unit_price": 14.29, "total": 114.32},
        {"code": "2916", "name": "Furniture Pad", "quantity": 4,
         "unit": "EA", "unit_price": 8.57, "total": 34.28},
        {"code": "3089", "name": "Packing Paper (50-lb bundle)", "quantity": 3,
         "unit": "EA", "unit_price": 32.14, "total": 96.42},
        {"code": "3035", "name": "Packing Tape Roll", "quantity": 5,
         "unit": "EA", "unit_price": 4.46, "total": 22.30},
    ]


def _sample_hybrid_material_details():
    return [
        {"code": "MAT-SUP", "name": "Packing Supplies", "quantity": 1,
         "unit": "LS", "unit_price": 120.0, "total": 120.0, "detail": "Boxes"},
        {"code": "MAT-PRO", "name": "Protective Wrapping", "quantity": 1,
         "unit": "LS", "unit_price": 80.0, "total": 80.0, "detail": "Blankets"},
    ]


# ── export.py: _section_details_to_line_items ───────────────────────────

def _materials_group(material_details, section_details=None, totals=None):
    result = _section_details_to_line_items(
        section_details or {}, totals or {"Materials": 0.0},
        material_details=material_details,
    )
    titles = [r["title"] for r in result]
    # One Materials group, never per-category or per-SKU sub-groups
    assert titles.count("Materials") == 1, titles
    assert not any(t.startswith("Materials - ") for t in titles), titles
    return next(r for r in result if r["title"] == "Materials")


def test_export_rolls_itemized_materials_up_into_category_lines():
    """A printed estimate shows a few material lump sums, not one row per
    box size -- even when the user picked the itemized breakdown on screen."""
    section_details = {"Pack-Out Labor": {"lines": [
        {"name": "Standard Pack-Out", "qty": 8, "unit": "HR", "rate": 200.0,
         "detail": "", "amount": 1600.0},
    ]}}
    details = _sample_itemized_material_details()
    group = _materials_group(
        details, section_details,
        {"Pack-Out Labor": 1600.0, "Materials": 370.56},
    )

    # Six SKUs collapse to two category lines (this fixture has no specialty)
    assert [i["name"] for i in group["items"]] == [
        "Packing Supplies", "Protective Wrapping",
    ]
    for item in group["items"]:
        assert item["qty"] == 1
        assert item["unit"] == "LS"

    # No money is lost or invented in the rollup
    assert sum(i["price"] for i in group["items"]) == pytest.approx(
        sum(d["total"] for d in details), abs=0.01)

    # Each category still names what went into it
    supplies = group["items"][0]
    assert "Small Box (1.5 cu ft) ×14" in supplies["detail"]
    assert "Packing Tape Roll ×5" in supplies["detail"]
    protective = group["items"][1]
    assert "Moving Blanket ×8" in protective["detail"]
    assert "Furniture Pad ×4" in protective["detail"]


def test_export_keeps_specialty_as_its_own_category():
    details = _sample_itemized_material_details() + [
        {"code": "3899", "name": "TV Box", "quantity": 2,
         "unit": "EA", "unit_price": 37.50, "total": 75.00},
    ]
    group = _materials_group(details)
    assert [i["name"] for i in group["items"]] == [
        "Packing Supplies", "Protective Wrapping", "Specialty Packaging",
    ]
    assert group["items"][2]["price"] == pytest.approx(75.00, abs=0.01)


def test_export_passes_already_rolled_up_materials_through_unchanged():
    """Category lines arrive pre-rolled from the summary mode and carry no
    catalog code, so they must survive the rollup untouched."""
    details = _sample_hybrid_material_details()
    group = _materials_group(details, totals={"Materials": 200.0})
    assert [i["name"] for i in group["items"]] == [
        "Packing Supplies", "Protective Wrapping",
    ]
    assert [i["price"] for i in group["items"]] == [120.0, 80.0]


def test_export_keeps_the_markup_as_its_own_line():
    """The markup is derived from the materials, not one of them, so it must
    not be folded into a category."""
    details = _sample_itemized_material_details() + [
        {"code": MATERIAL_MARKUP_CODE, "name": "Material Handling & Markup",
         "quantity": 1, "unit": "LS", "unit_price": 55.58, "total": 55.58,
         "detail": "15% handling & markup on materials"},
    ]
    group = _materials_group(details)
    assert group["items"][-1]["name"] == "Material Handling & Markup"
    assert group["items"][-1]["price"] == pytest.approx(55.58, abs=0.01)
    assert sum(i["price"] for i in group["items"]) == pytest.approx(
        sum(d["total"] for d in details), abs=0.01)


# ── converter.py: itemized grouping for the real Estimate ──────────────

def test_group_itemized_materials_medium_granularity():
    items = _group_itemized_materials_for_estimate(_sample_itemized_material_details())

    names = [i["name"] for i in items]
    # One line per box size present -- not merged, not further split
    assert "Small Boxes" in names
    assert "Medium Boxes" in names
    # One line per protective-material type present -- not collapsed into
    # a single "Protective Materials" bucket
    assert "Moving Blankets" in names
    assert "Furniture Pads" in names
    # Consumables fold sensibly (paper -> boxes bucket, tape -> protective)
    assert "Packing Paper" in names
    assert "Packing Tape" in names

    # Medium granularity target: distinctly more than the 3-category
    # collapse, well short of full per-SKU itemization.
    assert 4 <= len(items) <= 12

    total = sum(i["amount"] for i in items)
    expected_total = sum(m["total"] for m in _sample_itemized_material_details())
    assert round(total, 2) == round(expected_total, 2)


def test_group_itemized_materials_merges_same_bucket_types():
    # Two distinct mattress bag sizes should merge into one "Mattress Bags"
    # line (both map to the same _ITEMIZED_PROTECTIVE_LABELS bucket).
    material_details = [
        {"code": "3876", "name": "Mattress Bag - Twin", "quantity": 1,
         "unit": "EA", "unit_price": 8.93, "total": 8.93},
        {"code": "3877", "name": "Mattress Bag - Queen", "quantity": 2,
         "unit": "EA", "unit_price": 12.50, "total": 25.00},
    ]
    items = _group_itemized_materials_for_estimate(material_details)
    assert len(items) == 1
    assert items[0]["name"] == "Mattress Bags"
    assert items[0]["quantity"] == 3
    assert round(items[0]["amount"], 2) == round(8.93 + 25.00, 2)


def test_converter_to_estimate_payload_itemized_mode_uses_medium_granularity():
    converter = PackingEstimateConverter()
    session_data = {
        "result": {
            "materials_mode": "itemized",
            "sections": {"Pack-Out Labor": 1600.0, "Materials": 370.56},
            "section_details": {
                "Pack-Out Labor": {"lines": [
                    {"name": "Standard Pack-Out", "qty": 8, "unit": "HR",
                     "rate": 200.0, "detail": "", "amount": 1600.0},
                ]},
            },
            "material_details": _sample_itemized_material_details(),
            "subtotal": 1970.56,
            "grand_total": 1970.56,
        },
        "client_info": {},
        "settings": {},
    }

    payload = converter.to_estimate_payload(session_data)
    materials_section = next(s for s in payload["sections"] if s["name"] == "Materials")

    # Medium granularity, not the 3-category hybrid collapse
    names = {i["name"] for i in materials_section["items"]}
    assert "Packing Supplies" not in names
    assert "Protective Wrapping" not in names
    assert "Small Boxes" in names
    assert "Moving Blankets" in names
    assert 4 <= len(materials_section["items"]) <= 12


def test_converter_to_estimate_payload_pct_of_labor_mode_unchanged():
    converter = PackingEstimateConverter()
    session_data = {
        "result": {
            "materials_mode": "pct_of_labor",
            "sections": {"Pack-Out Labor": 1600.0, "Materials": 200.0},
            "section_details": {
                "Pack-Out Labor": {"lines": [
                    {"name": "Standard Pack-Out", "qty": 8, "unit": "HR",
                     "rate": 200.0, "detail": "", "amount": 1600.0},
                ]},
            },
            "material_details": _sample_hybrid_material_details(),
            "subtotal": 1800.0,
            "grand_total": 1800.0,
        },
        "client_info": {},
        "settings": {},
    }

    payload = converter.to_estimate_payload(session_data)
    materials_section = next(s for s in payload["sections"] if s["name"] == "Materials")
    names = {i["name"] for i in materials_section["items"]}
    assert names == {"Packing Supplies", "Protective Wrapping"}
