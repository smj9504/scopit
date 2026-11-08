"""What the Cabinet Estimator does differently in Scopit than in MJ Estimate:
every estimate belongs to one company and nobody else reaches it, a job links
a Scopit customer and carries its claim number, a calculated estimate becomes
a Scopit estimate whose lines add up to the same total, and a product picture
id can only ever name the company's own files. On a throwaway SQLite database."""
import uuid
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.domains.customer.models import Customer  # noqa: E402
from app.domains.product_library.models import Product  # noqa: E402
from app.domains.product_library.service import image_key  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.estimate_bridge import (  # noqa: E402
    title_for,
    to_estimate_payload,
)
from app.domains.tools.modules.cabinet_estimate.schemas import (  # noqa: E402
    CabinetBoxCreate,
    CabinetEstimateCreate,
    CabinetEstimateUpdate,
)
from app.domains.tools.modules.cabinet_estimate.service import CabinetEstimateService  # noqa: E402
from tests.cabinet_db import COMPANY_ID, OTHER_COMPANY_ID, make_session  # noqa: E402

BOXES = [
    CabinetBoxCreate(code="B30", cab_type="base", width_inches=30, height_inches=34.5),
    CabinetBoxCreate(code="SB36", cab_type="base", width_inches=36, height_inches=34.5,
                     is_specialty=True, specialty_type="sink_base"),
    CabinetBoxCreate(code="W3030", cab_type="wall", width_inches=30, height_inches=30, qty=3),
    CabinetBoxCreate(code="B36", cab_type="base", location="island", width_inches=36, height_inches=34.5, qty=2),
]


@pytest.fixture
def session(tmp_path):
    s = make_session(tmp_path)
    yield s
    s.close()


@pytest.fixture
def ours(session):
    return CabinetEstimateService(session, COMPANY_ID)


@pytest.fixture
def theirs(session):
    return CabinetEstimateService(session, OTHER_COMPANY_ID)


def customer(session, company_id, name):
    row = Customer(id=uuid.uuid4(), company_id=company_id, name=name, is_active=True)
    session.add(row)
    session.flush()
    return row


def new_job(service, **fields):
    data = dict(
        property_address="12 Elm St", zip_code="20850", tier="Stock", boxes=BOXES,
        include_countertop=True, countertop_material="Quartz", countertop_sqft=40,
        island_countertop_material="Quartz", island_countertop_sqft=24,
        include_plumbing=True, include_permit=True,
    )
    data.update(fields)
    return service.create_estimate(CabinetEstimateCreate(**data))


# ── One company's estimates ──

def test_another_company_cannot_see_or_change_an_estimate(ours, theirs):
    estimate = new_job(ours)
    assert estimate["company_id"] == str(COMPANY_ID)
    assert theirs.get_estimate(estimate["id"]) is None
    assert theirs.update_estimate(estimate["id"], CabinetEstimateUpdate(notes="x")) is None
    assert theirs.calculate(estimate["id"]) is None
    assert theirs.add_option(estimate["id"]) is None
    assert theirs.get_group(estimate["id"]) is None
    assert theirs.sketch(estimate["id"]) is None
    assert theirs.get_history(estimate["id"]) == []
    assert theirs.delete_estimate(estimate["id"]) is False
    assert theirs.list_estimates()[1] == 0
    assert ours.list_estimates()[1] == 1


def test_a_bad_id_is_simply_not_found(ours):
    assert ours.get_estimate("not-a-uuid") is None
    assert ours.list_estimates(customer_id="not-a-uuid") == ([], 0)


def test_the_pdf_header_is_the_companys_own(ours):
    info = new_job(ours)["company_info"]
    assert info["name"] == "MJ Co & Sons"
    assert (info["city"], info["state"]) == ("Fairfax", "VA")


# ── Customer and claim number ──

def test_a_job_links_one_of_the_companys_customers(ours, session):
    jane = customer(session, COMPANY_ID, "Jane O'Neil")
    estimate = new_job(ours, customer_id=str(jane.id))
    assert estimate["client_name"] == "Jane O'Neil"
    assert ours.list_estimates(search="O'Neil")[1] == 1
    assert ours.list_estimates(customer_id=str(jane.id))[1] == 1


def test_another_companys_customer_is_refused(ours, session):
    stranger = customer(session, OTHER_COMPANY_ID, "Not Yours")
    with pytest.raises(ValueError):
        new_job(ours, customer_id=str(stranger.id))
    estimate = new_job(ours)
    with pytest.raises(ValueError):
        ours.update_estimate(estimate["id"], CabinetEstimateUpdate(customer_id=str(stranger.id)))


def test_customer_and_claim_number_are_shared_by_the_whole_job(ours, session):
    jane = customer(session, COMPANY_ID, "Jane O'Neil")
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    ours.update_estimate(option["id"], CabinetEstimateUpdate(customer_id=str(jane.id), claim_number="CL-77"))
    restore = ours.get_estimate(restore["id"])
    assert (restore["client_name"], restore["claim_number"]) == ("Jane O'Neil", "CL-77")
    assert ours.list_estimates(search="CL-77", grouped=True)[1] == 1


# ── To a Scopit estimate ──

def estimate_shows(items) -> Decimal:
    """The total the Scopit estimate shows for these lines: each line's
    quantity × unit price rounded half up to the cent, as
    estimate/api.py recalculate_estimate does."""
    cent = Decimal("0.01")
    return sum(
        (
            (Decimal(str(it["quantity"])) * Decimal(str(it["unit_price"]))).quantize(cent, rounding=ROUND_HALF_UP)
            for it in items
        ),
        Decimal("0"),
    )


def test_a_scopit_estimate_adds_up_to_the_cabinet_total(ours):
    estimate = ours.calculate(new_job(ours)["id"])
    payload = to_estimate_payload(estimate)
    items = [it for s in payload["sections"] for it in s["items"]]
    assert estimate_shows(items) == Decimal(str(estimate["total"])).quantize(Decimal("0.01"))
    assert all(len(it["name"]) <= 255 for it in items)


def test_half_cent_lines_still_add_up_to_the_cabinet_total():
    # Seen in the browser: 2.5 LF × $405.73 and 2.5 LF × $307.57 each end in
    # half a cent, which the estimate rounds up; the calculator's total didn't.
    lines = [
        {"description": "Base Cabinets - Stock", "category": "supply", "unit": "LF",
         "quantity": 2.5, "unit_price": 405.73, "total": 1014.33},
        {"description": "Wall Cabinets Standard - Stock", "category": "supply", "unit": "LF",
         "quantity": 2.5, "unit_price": 307.57, "total": 768.93},
        {"description": "Trash Disposal with 10 Yard Dumpster", "category": "demo", "unit": "EA",
         "quantity": 1, "unit_price": 496.61, "total": 496.61},
    ]
    payload = to_estimate_payload({"line_items": lines, "total": 2279.86})
    items = [it for s in payload["sections"] for it in s["items"]]
    assert estimate_shows(items) == Decimal("2279.86")
    assert [it["unit_price"] for it in items if it["quantity"] == 1] == [496.60]


def test_a_scopit_estimate_is_sectioned_like_the_customer_pdf(ours):
    estimate = ours.calculate(new_job(ours)["id"])
    names = [s["name"] for s in to_estimate_payload(estimate)["sections"]]
    assert "Island" in names
    assert any(n.startswith("Perimeter — Cabinets") for n in names)
    items = [it["name"] for s in to_estimate_payload(estimate)["sections"] for it in s["items"]]
    # Install is folded into the supply line it installs
    assert "Base Cabinets - Stock" in items
    assert not any(n.endswith("Cabinet Installation") for n in items)


def test_a_scopit_estimate_hits_a_target_total_to_the_cent(ours):
    estimate = new_job(ours, target_total=23456.78)
    estimate = ours.calculate(estimate["id"])
    items = [it for s in to_estimate_payload(estimate)["sections"] for it in s["items"]]
    assert estimate_shows(items) == Decimal("23456.78")


def test_the_title_names_the_option_and_the_address(ours):
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    assert title_for(restore) == "Kitchen Cabinets — 12 Elm St"
    assert title_for(option) == "Kitchen Cabinets — Option A — 12 Elm St"


def test_the_proposal_names_the_zip_once(ours):
    # A customer's address, as the job form fills it in, already ends with the zip
    restore = ours.calculate(new_job(ours, property_address="12 Elm St, Rockville, MD 20850")["id"])
    ours.add_option(restore["id"])
    from pypdf import PdfReader

    from app.domains.tools.modules.cabinet_estimate.export_service import CabinetExportService

    pdf = CabinetExportService().generate_proposal_pdf(ours.get_group(restore["id"]))
    text = " ".join(" ".join((page.extract_text() or "").split()) for page in PdfReader(pdf).pages)
    assert "Property: 12 Elm St, Rockville, MD 20850 " in text
    assert "20850, 20850" not in text


def test_the_claim_number_goes_in_the_description(ours):
    estimate = ours.calculate(new_job(ours, claim_number="CL-9")["id"])
    assert to_estimate_payload(estimate)["description"] == "Claim #: CL-9"


# ── Products ──

def test_an_option_cannot_take_another_companys_product(ours, session):
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    foreign = Product(id=uuid.uuid4(), company_id=OTHER_COMPANY_ID, category="kitchen_faucet",
                      title="Their Faucet", price=Decimal("199"), price_unit="each",
                      retailer="other", image_file_ids=[], look={}, specs={})
    session.add(foreign)
    session.flush()
    with pytest.raises(LookupError):
        ours.set_selection(option["id"], "kitchen_faucet", str(foreign.id))


@pytest.mark.parametrize("file_id", [
    "../11111111-1111-1111-1111-111111111111/abc.jpg",
    "22222222-2222-2222-2222-222222222222/products/x.jpg",
    "/etc/passwd",
    "11111111-1111-1111-1111-111111111111/" + "a" * 32 + ".svg",
    "11111111-1111-1111-1111-111111111111\\" + "a" * 32 + ".jpg",
    "",
    None,
])
def test_a_picture_id_cannot_leave_the_companys_folder(file_id):
    assert image_key(COMPANY_ID, file_id) is None


def test_a_picture_id_maps_into_the_companys_products_folder():
    file_id = "33333333-3333-3333-3333-333333333333/" + "b" * 32 + ".png"
    assert image_key(COMPANY_ID, file_id) == f"{COMPANY_ID}/products/{file_id}"


# ── AI photo ──

def test_ai_photo_without_a_key_says_so_and_counts_nothing(monkeypatch):
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.config import settings
    from app.domains.tools import usage
    from app.domains.tools.modules.cabinet_estimate import api

    counted = []
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(usage, "reserve_ai_units", lambda *args, **kwargs: counted.append(args))
    monkeypatch.setattr(api, "_service", lambda db, user: SimpleNamespace(find=lambda _id: object()))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/tools/cabinet-estimate")
    app.dependency_overrides[api.get_db] = lambda: None
    app.dependency_overrides[api._gate] = lambda: SimpleNamespace(id="u1", company_id=COMPANY_ID)

    response = TestClient(app).post(
        "/api/tools/cabinet-estimate/abc/sketch/ai-photo", json={"image": "data:image/png;base64,AAAA"},
    )
    assert response.status_code == 503
    assert "isn't set up" in response.json()["detail"]
    assert counted == []
