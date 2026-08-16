"""
Tests for how the itemized ("Mode B") materials shape flows into the PDF/
Excel line-item splitter (export.py) and the real Scopit Estimate converter
(converter.py) -- covering the two-subgroup PDF layout and the
medium-granularity Estimate grouping confirmed in the implementation plan.
"""
from app.domains.tools.modules.packing.converter import (
    PackingEstimateConverter,
    _group_itemized_materials_for_estimate,
)
from app.domains.tools.modules.packing.export import _section_details_to_line_items


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

def test_export_itemized_mode_produces_two_materials_subgroups():
    section_details = {"Pack-Out Labor": {"lines": [
        {"name": "Standard Pack-Out", "qty": 8, "unit": "HR", "rate": 200.0,
         "detail": "", "amount": 1600.0},
    ]}}
    sections_totals = {"Pack-Out Labor": 1600.0, "Materials": 370.56}

    result = _section_details_to_line_items(
        section_details, sections_totals,
        material_details=_sample_itemized_material_details(),
        materials_mode="itemized",
    )

    titles = [r["title"] for r in result]
    assert "Materials - Packing Boxes" in titles
    assert "Materials - Protective & Packing Supplies" in titles
    assert "Materials" not in titles  # single flat group must not also appear

    box_group = next(r for r in result if r["title"] == "Materials - Packing Boxes")
    other_group = next(
        r for r in result if r["title"] == "Materials - Protective & Packing Supplies"
    )
    box_names = {i["name"] for i in box_group["items"]}
    other_names = {i["name"] for i in other_group["items"]}

    assert "Small Box (1.5 cu ft)" in box_names
    assert "Medium Box (3.0 cu ft)" in box_names
    assert "Moving Blanket" in other_names
    assert "Furniture Pad" in other_names
    # Every material_details entry lands in exactly one subgroup
    assert len(box_group["items"]) + len(other_group["items"]) == len(
        _sample_itemized_material_details()
    )


def test_export_legacy_mode_produces_single_materials_group():
    section_details = {}
    sections_totals = {"Materials": 200.0}

    result = _section_details_to_line_items(
        section_details, sections_totals,
        material_details=_sample_hybrid_material_details(),
        materials_mode=None,  # legacy / Mode A -- no opinion on itemized layout
    )

    titles = [r["title"] for r in result]
    assert titles == ["Materials"]
    assert len(result[0]["items"]) == 2


def test_export_pct_of_labor_mode_also_single_group():
    section_details = {}
    sections_totals = {"Materials": 200.0}

    result = _section_details_to_line_items(
        section_details, sections_totals,
        material_details=_sample_hybrid_material_details(),
        materials_mode="pct_of_labor",
    )
    titles = [r["title"] for r in result]
    assert titles == ["Materials"]


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
