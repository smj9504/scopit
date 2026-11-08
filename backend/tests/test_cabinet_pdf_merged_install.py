"""The customer PDF shows supply and install as one line per item.

The calculator still quotes them separately - the estimate screen keeps the
split - so the PDF export folds each install line into the supply line(s)
it installs. These run the real calculator so a renamed line shows up here
rather than as a stray "Installation" row on a customer's quote.
"""

import io
from dataclasses import asdict

import pytest
from pypdf import PdfReader

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate
from app.domains.tools.modules.cabinet_estimate.export_service import (
    CabinetExportService,
    _merge_install_into_supply,
)


def _box(code, cab_type, width, height, specialty=None, location="perimeter"):
    return BoxInput(
        code=code, cab_type=cab_type, location=location,
        width_inches=width, height_inches=height,
        is_specialty=bool(specialty), specialty_type=specialty,
        has_glass_door=False, qty=1,
    )


PERIMETER = [
    _box("B36", "base", 36, 34.5),
    _box("B31", "base", 31, 34.5),             # off the 3" grid
    _box("SB36", "base", 36, 34.5, "sink_base"),
    _box("W3030", "wall", 30, 30),
    _box("W3330", "wall", 33, 30),
    _box("W3615", "wall", 36, 15),
    _box("U248424", "tall", 24, 84),
    _box("O338424", "tall", 33, 84, "oven_cabinet"),
]

ISLAND = [
    _box("IB36", "base", 36, 34.5, location="island"),
    _box("IB24", "base", 24, 34.5, location="island"),
]


def _line_items(boxes, **kw):
    result = calculate_estimate(
        boxes, "Stock", "22030",
        include_crown_molding=True, **kw,
    )
    return [asdict(li) for li in result.line_items]


def _total(items):
    return round(sum(li["total"] for li in items), 2)


@pytest.mark.parametrize("boxes,kw", [
    (PERIMETER, {}),
    (PERIMETER + ISLAND, {
        "island_end_panel_sqft": 12, "island_back_panel_sqft": 20,
    }),
    (PERIMETER, {"island_type": "prefab", "island_prefab_size": "medium"}),
    (PERIMETER, {"target_total": 31_337}),
])
def test_only_stand_alone_install_is_left(boxes, kw):
    items = _line_items(boxes, **kw)
    merged = _merge_install_into_supply(items)

    left = [li["description"] for li in merged if li["category"] == "install"]
    assert left and all("Toe Kick — " in d for d in left)
    assert not any(
        li["description"].endswith(("(Material)", "(Supply)")) for li in merged
    )
    assert _total(merged) == _total(items)


@pytest.mark.parametrize("finish,description", [
    (None, "Toe Kick — Install (Prefinished)"),
    ("Stained", "Toe Kick — Install (Prefinished)"),
    ("Laminate", "Toe Kick — Install (Prefinished)"),
    ("Painted", "Toe Kick — Install & Paint"),
    ("Glazed", "Toe Kick — Install & Paint"),
])
def test_toe_kick_is_painted_only_on_a_painted_finish(finish, description):
    items = _line_items(PERIMETER + ISLAND, finish=finish)
    toe_kicks = [li for li in items if "Toe Kick" in li["description"]]
    assert [li["description"] for li in toe_kicks] == [
        description, f"Island {description}",
    ]
    painted = description.endswith("Paint")
    assert all(("paint" in li["notes"]) == painted for li in toe_kicks)


def test_quarter_round_is_off_unless_asked_for():
    assert not any(
        "Quarter Round" in li["description"]
        for li in _line_items(PERIMETER + ISLAND)
    )


@pytest.mark.parametrize("finish,scope", [
    ("Stained", "Install (Prefinished)"),
    ("Painted", "Install & Paint"),
])
def test_quarter_round_runs_the_base_cabinets_in_their_finish(finish, scope):
    items = _line_items(
        PERIMETER + ISLAND, finish=finish, include_quarter_round=True,
    )
    by_desc = {li["description"]: li for li in items}
    toe_kick = by_desc[f"Toe Kick — {scope}"]
    quarter_round = by_desc[f"Quarter Round — {scope}"]
    assert quarter_round["quantity"] == toe_kick["quantity"]
    assert quarter_round["unit"] == "LF"
    assert quarter_round["notes"] == toe_kick["notes"]
    assert f"Island Quarter Round — {scope}" in by_desc

    # It stays its own line on the PDF, like the toe kick
    merged = _merge_install_into_supply(items)
    assert f"Quarter Round — {scope}" in [li["description"] for li in merged]
    assert _total(merged) == _total(items)


def test_pooled_install_splits_by_quantity_and_keeps_its_total():
    items = _line_items(PERIMETER)
    merged = _merge_install_into_supply(items)

    def base(lines):
        return [
            li for li in lines
            if li["description"].startswith("Base Cabinet")
        ]

    supply, [install] = (
        [li for li in base(items) if li["category"] == "supply"],
        [li for li in base(items) if li["category"] == "install"],
    )
    folded = base(merged)
    assert len(folded) == len(supply) == 3
    assert _total(folded) == _total(supply + [install])
    for before, after in zip(supply, folded):
        assert after["quantity"] == before["quantity"]
        assert after["unit_price"] == pytest.approx(
            before["unit_price"] + install["unit_price"], abs=0.01,
        )
        assert after["total"] == pytest.approx(
            before["total"] + install["unit_price"] * before["quantity"],
            abs=0.05,
        )
        assert after["notes"].endswith("Supply & install")


def test_tall_install_covers_generic_and_typed_tall():
    merged = _merge_install_into_supply(_line_items(PERIMETER))
    tall = [li for li in merged if '"W x 84"H' in li["description"]]
    assert {li["description"] for li in tall} == {
        'Tall Cabinets 24"W x 84"H - Stock',
        'Oven Cabinet 33"W x 84"H - Stock',
    }
    oven = next(li for li in tall if li["description"].startswith("Oven"))
    assert oven["notes"] == "O338424 — Oven Cabinet · Supply & install"


def test_supply_only_estimate_is_left_alone():
    items = _line_items(PERIMETER, include_install=False)
    merged = _merge_install_into_supply(items)
    # Hardware and crown molding always carry their own install
    assert "Cabinet Hardware (Knobs/Pulls)" in [li["description"] for li in merged]
    assert "Crown Molding - Stock" in [li["description"] for li in merged]
    assert any(li["description"] == "Base Cabinets - Stock" for li in merged)
    assert not any("Base Cabinet Installation" in li["description"] for li in merged)
    assert _total(merged) == _total(items)


def test_pdf_prints_no_separate_install_lines():
    items = _line_items(PERIMETER + ISLAND, island_end_panel_sqft=12)
    pdf = CabinetExportService().generate_pdf(
        {"id": "test1234", "line_items": items, "total": _total(items)},
    )
    text = "\n".join(
        page.extract_text() for page in PdfReader(io.BytesIO(pdf.read())).pages
    )
    assert "Installation" not in text
    assert "(Material)" not in text
    assert "Supply & install" in text
    assert "PERIMETER — CABINETS" in text
