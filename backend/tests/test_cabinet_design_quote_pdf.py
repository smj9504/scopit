"""The design quote, the other format of a kitchen estimate's PDF.

Runs the real calculator, so a section or a price that went missing shows up
here. The itemized quote keeps every unit price; this one must carry none, and
its section prices must still add up to the total the customer signs for.
"""

import base64
import io
from dataclasses import asdict

import pytest
from PIL import Image
from pypdf import PdfReader

from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate
from app.domains.tools.modules.cabinet_estimate.design_quote_pdf import (
    generate_design_quote_pdf,
    kitchen_summary,
    scope_sections,
)
from app.domains.tools.modules.cabinet_estimate.export_service import CabinetExportService, payment_phases


def _box(code, cab_type, width, height, specialty=None, location="perimeter"):
    return BoxInput(
        code=code, cab_type=cab_type, location=location,
        width_inches=width, height_inches=height,
        is_specialty=bool(specialty), specialty_type=specialty,
        has_glass_door=False, qty=1,
    )


BOXES = [
    _box("B36", "base", 36, 34.5),
    _box("SB36", "base", 36, 34.5, "sink_base"),
    _box("W3030", "wall", 30, 30),
    _box("U248424", "tall", 24, 84),
    _box("IB36", "base", 36, 34.5, location="island"),
]


def _estimate(**over):
    result = calculate_estimate(
        BOXES, "Stock", "22030",
        include_crown_molding=True, include_demo=True, include_permit=True,
    )
    return {
        "id": "abcd1234-5678",
        "kind": "restore",
        "company_info": {"name": "MJ Co & Sons", "phone": "555-0100"},
        "client_name": "Jane O'Neil",
        "claim_number": "CL-77",
        "property_address": "1 Old Rd, Fairfax, VA 22030",
        "zip_code": "22030",
        "tier": "Stock",
        "door_style": "Shaker",
        "overview_text": "Soft-close doors & drawers.",
        "total": result.total,
        "boxes": [asdict(b) for b in BOXES],
        "line_items": [asdict(li) for li in result.line_items],
        **over,
    }


def _picture(fmt="PNG", size=(1200, 700), shade=200):
    # Each its own shade: the PDF keeps one copy of a picture used twice.
    data = io.BytesIO()
    Image.new("RGB", size, (shade, 180, 150)).save(data, fmt)
    return base64.b64encode(data.getvalue()).decode()


DRAWINGS = {
    "plan": _picture(shade=10),
    "elevations": [
        {"label": "North wall", "image": _picture(shade=60)},
        {"label": "Island", "image": _picture(shade=110)},
    ],
    "views": [
        {"label": "At eye level", "image": _picture("JPEG", shade=160)},
        {"label": "Overview", "image": _picture("JPEG", shade=210)},
    ],
}


def _pages(pdf):
    return [page.extract_text() for page in PdfReader(pdf).pages]


def _images(pdf):
    return sum(len(page.images) for page in PdfReader(pdf).pages)


def test_the_section_prices_add_up_to_the_total():
    estimate = _estimate()
    assert round(sum(s["total"] for s in scope_sections(estimate)), 2) == round(estimate["total"], 2)


def test_it_shows_each_section_and_no_unit_price_or_line_note():
    estimate = _estimate()
    text = "\n".join(_pages(generate_design_quote_pdf(estimate)))

    for section in scope_sections(estimate):
        assert section["title"] in text
        assert f"${section['total']:,.2f}" in text
    assert f"${estimate['total']:,.2f}" in text

    # A section with one line shows its price; no other line's own price shows.
    priced = [li for li in estimate["line_items"] if li["unit_price"] and li["quantity"] != 1]
    assert priced
    for li in priced:
        assert f"${li['unit_price']:,.2f}" not in text
    assert "Unit Price" not in text
    assert "Supply & install" not in text


def test_it_folds_install_into_supply_like_the_itemized_quote():
    items = [i for s in scope_sections(_estimate()) for i in s["items"]]
    assert not [i for i in items if i.startswith("Base Cabinet Installation")]
    assert [i for i in items if i.startswith("Base Cabinets")]


def test_it_carries_the_same_terms_and_payment_schedule_as_the_itemized_quote():
    estimate = _estimate()
    text = "\n".join(_pages(generate_design_quote_pdf(estimate)))
    assert "Workmanship warranty" in text
    for phase in payment_phases(estimate["total"], "22030"):
        assert f"${phase['amount']:,.2f}" in text
    assert "33%" in text

    dc = "\n".join(_pages(generate_design_quote_pdf(_estimate(zip_code="20001"))))
    assert "34%" in dc


def test_the_signature_block_is_optional():
    assert "ACCEPTED BY" in "\n".join(_pages(generate_design_quote_pdf(_estimate())))
    assert "ACCEPTED BY" not in "\n".join(_pages(generate_design_quote_pdf(_estimate(), show_signature=False)))


def test_without_drawings_there_is_no_drawing_page():
    pages = _pages(generate_design_quote_pdf(_estimate()))
    text = "\n".join(pages)
    assert "Floor Plan" not in text
    assert "Front Elevations" not in text
    assert "3D Views" not in text
    assert "Drawings show" not in text
    assert _images(generate_design_quote_pdf(_estimate())) == 0


def test_with_drawings_each_comes_under_its_own_name():
    pdf = generate_design_quote_pdf(_estimate(), drawings=DRAWINGS)
    text = "\n".join(_pages(pdf))
    for name in ("Floor Plan", "Front Elevations", "North wall", "Island", "3D Views", "Overview"):
        assert name in text
    assert "Drawings show" in text
    pdf.seek(0)
    assert _images(pdf) == 5


@pytest.mark.parametrize("part,name,others", [
    ("plan", "Floor Plan", ("Front Elevations", "3D Views")),
    ("elevations", "Front Elevations", ("Floor Plan", "3D Views")),
])
def test_each_kind_of_drawing_can_come_alone(part, name, others):
    text = "\n".join(_pages(generate_design_quote_pdf(_estimate(), drawings={part: DRAWINGS[part]})))
    assert name in text
    for other in others:
        assert other not in text


def test_a_single_3d_view_goes_on_the_first_page_with_no_empty_page_after_it():
    plain = _pages(generate_design_quote_pdf(_estimate()))
    views = {"views": DRAWINGS["views"][:1]}
    pdf = generate_design_quote_pdf(_estimate(), drawings=views)
    assert len(PdfReader(pdf).pages[0].images) == 1
    pdf.seek(0)
    pages = _pages(pdf)
    assert len(pages) <= len(plain) + 1
    assert "3D Views" not in "\n".join(pages)
    assert all(page.strip() for page in pages)


@pytest.mark.parametrize("drawings", [
    {"plan": "not a picture"},
    {"elevations": [{"label": "North wall", "image": "@@@"}, "junk"]},
    {"views": [{"label": "Overview"}]},
    {"elevations": "junk", "views": 7},
    "junk",
    None,
])
def test_a_drawing_that_cannot_be_read_is_left_out(drawings):
    # A bad picture must not cost the customer their PDF.
    pdf = generate_design_quote_pdf(_estimate(), drawings=drawings)
    text = "\n".join(_pages(pdf))
    assert "Floor Plan" not in text
    assert "Front Elevations" not in text


def test_a_restoration_shows_its_drawings_but_never_products():
    products = {"countertop": {"title": "Quartz Upgrade", "price": 80, "price_unit": "sf"}}
    pdf = generate_design_quote_pdf(_estimate(selections=products), drawings=DRAWINGS)
    text = "\n".join(_pages(pdf))
    assert "Floor Plan" in text
    assert "Quartz Upgrade" not in text
    assert "Selected Products" not in text


def test_an_option_names_itself_and_lists_its_products():
    products = {"countertop": {"title": "Quartz Upgrade", "price": 80, "price_unit": "sf"}}
    text = "\n".join(_pages(generate_design_quote_pdf(
        _estimate(kind="option", option_label="Quartz Option", selections=products),
    )))
    assert "Quartz Option" in text
    assert "Quartz Upgrade" in text
    assert "Selected Products" in text


def test_the_summary_says_only_what_the_estimate_has():
    summary = dict(kitchen_summary(_estimate(layout_type=None, finish="Painted")))
    assert summary["Cabinets"] == "2 base · 1 wall · 1 tall · 1 island"
    assert summary["Finish"] == "Painted"
    assert "Layout" not in summary
    assert "Countertop" not in summary


def test_a_chosen_product_takes_over_from_the_field_it_replaces():
    products = {"countertop": {"title": "Quartz Upgrade"}, "cabinets": {"title": "Slab Euro"}}
    fields = {"include_countertop": True, "countertop_material": "Laminate", "countertop_sqft": 40}

    restoration = dict(kitchen_summary(_estimate(selections=products, **fields)))
    assert restoration["Countertop"] == "Laminate, 40 sq ft"
    assert restoration["Door style"] == "Shaker"

    option = dict(kitchen_summary(_estimate(kind="option", selections=products, **fields)))
    assert "Countertop" not in option
    assert "Door style" not in option
    assert "Cabinet tier" not in option


def test_text_with_markup_characters_comes_through():
    text = "\n".join(_pages(generate_design_quote_pdf(_estimate(
        client_name="A & B <Co>", property_address="1 <Main> & 2nd", overview_text="Doors & <drawers>",
    ))))
    assert "A & B <Co>" in text
    assert "1 <Main> & 2nd" in text
    assert "Doors & <drawers>" in text


def test_the_export_service_makes_it_too():
    pdf = CabinetExportService().generate_design_quote_pdf(_estimate(), show_signature=False)
    assert "Kitchen Cabinet Quote" in _pages(pdf)[0]


def test_a_logo_that_cannot_be_read_does_not_stop_it():
    estimate = _estimate(company_info={"name": "MJ Co", "logo": "not-an-image"})
    assert "MJ Co" in _pages(generate_design_quote_pdf(estimate))[0]


def test_a_real_logo_is_placed():
    estimate = _estimate(company_info={"name": "MJ Co", "logo": f"data:image/png;base64,{_picture(size=(300, 100))}"})
    assert len(PdfReader(generate_design_quote_pdf(estimate)).pages[0].images) == 1


class _FakeService:
    """The estimate service, as one company sees it: only that company's estimate is there."""
    estimate = None
    owner = "company-1"

    def __init__(self, company_id):
        self.company_id = company_id

    def get_estimate(self, estimate_id):
        return self.estimate if self.company_id == self.owner else None


class _User:
    def __init__(self, company_id="company-1"):
        self.id = "u1"
        self.company_id = company_id


@pytest.fixture
def api_client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.domains.tools.modules.cabinet_estimate import api

    app = FastAPI()
    app.include_router(api.router, prefix="/api/tools/cabinet-estimate")
    app.dependency_overrides[api.get_db] = lambda: None
    app.dependency_overrides[api._gate] = lambda: _User()
    monkeypatch.setattr(api, "_image_loader", lambda db, user: None)
    monkeypatch.setattr(api, "_service", lambda db, user: _FakeService(user.company_id))
    monkeypatch.setattr(_FakeService, "estimate", _estimate(kind="option", option_label="Quartz & Oak"))
    return TestClient(app), app, api


URL = "/api/tools/cabinet-estimate/abcd1234-5678/export/design-quote-pdf"


def test_the_endpoint_sends_a_download_named_for_the_address_and_option(api_client):
    client, _, _ = api_client
    response = client.post(URL, json={"drawings": DRAWINGS})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'filename="kitchen_cabinet_quote_1_Old_Rd_Fairfax_VA_22030_Quartz_Oak.pdf"' in response.headers["content-disposition"]
    text = "\n".join(_pages(io.BytesIO(response.content)))
    assert "Floor Plan" in text
    assert "ACCEPTED BY" in text


def test_the_endpoint_works_with_no_body_and_can_leave_the_signature_off(api_client):
    client, _, _ = api_client
    assert "ACCEPTED BY" in "\n".join(_pages(io.BytesIO(client.post(URL).content)))
    no_signature = client.post(URL, json={"show_signature": False})
    assert "ACCEPTED BY" not in "\n".join(_pages(io.BytesIO(no_signature.content)))


def test_another_company_never_gets_the_estimate(api_client):
    client, app, api = api_client
    # The estimate is there: only whose it is can turn this person away.
    app.dependency_overrides[api._gate] = lambda: _User(company_id="company-2")
    assert client.post(URL).status_code == 404


def test_the_endpoint_says_when_the_estimate_is_gone(api_client, monkeypatch):
    client, _, _ = api_client
    monkeypatch.setattr(_FakeService, "estimate", None)
    assert client.post(URL).status_code == 404


def test_the_first_page_says_what_it_is_who_for_and_how_much():
    estimate = _estimate(kind="option", option_label="Quartz Option")
    first = _pages(generate_design_quote_pdf(estimate))[0]
    for text in ("MJ Co & Sons", "Kitchen Cabinet Quote", "Quartz Option", "Jane O'Neil", "CL-77",
                 "1 Old Rd, Fairfax, VA 22030", f"${estimate['total']:,.2f}", "Quote # ABCD1234", "Valid until"):
        assert text in first


def test_the_elevations_can_be_left_out_of_the_drawings():
    without = {part: DRAWINGS[part] for part in ("plan", "views")}
    text = "\n".join(_pages(generate_design_quote_pdf(_estimate(), drawings=without)))
    assert "Floor Plan" in text
    assert "3D Views" in text
    assert "Front Elevations" not in text
