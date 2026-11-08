"""What the Bathroom Estimator does differently in Scopit than in MJ Estimate:
every estimate belongs to one company and nobody else reaches it, a job links
a Scopit customer and carries its claim number, a calculated estimate becomes
a Scopit estimate whose lines add up to the same total, and an option only
takes the company's own products. On a throwaway SQLite database."""
import uuid
from decimal import Decimal

import pytest

from app.domains.customer.models import Customer  # noqa: E402
from app.domains.product_library.models import Product  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.estimate_bridge import (  # noqa: E402
    line_total,
    title_for,
    to_estimate_payload,
)
from app.domains.tools.modules.bathroom_estimate.export_service import PHASE_LABELS  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.schemas import (  # noqa: E402
    BathroomEstimateCreate,
    BathroomEstimateUpdate,
)
from app.domains.tools.modules.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from tests.bathroom_db import COMPANY_ID, OTHER_COMPANY_ID, make_session  # noqa: E402


@pytest.fixture
def session(tmp_path):
    s = make_session(tmp_path)
    yield s
    s.close()


@pytest.fixture
def ours(session):
    return BathroomEstimateService(session, COMPANY_ID)


@pytest.fixture
def theirs(session):
    return BathroomEstimateService(session, OTHER_COMPANY_ID)


def customer(session, company_id, name):
    row = Customer(id=uuid.uuid4(), company_id=company_id, name=name, is_active=True)
    session.add(row)
    session.flush()
    return row


def new_job(service, project_type="insurance", **fields):
    """A hall bath gutted for water damage: new toilet, vanity, tub with a tiled surround, and floor."""
    data = dict(
        project_type=project_type,
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=5, floor_sf=40, height_ft=8,
        demo_floor=True, demo_walls=True, water_damage=True,
        replace_toilet=True, replace_vanity=True, replace_tub=True,
        toilet_spec={"type": "two_piece_standard"},
        vanity_spec={"items": [{"sink_type": "cabinet", "width": 36, "sinks": 1}]},
        bathtub_spec={"type": "alcove", "material": "acrylic", "surround_tile": True, "surround_tile_sf": 50},
        floor_spec={"material": "porcelain", "size": "12x12", "pattern": "straight"},
    )
    data.update(fields)
    return service.create_estimate(BathroomEstimateCreate(**data))


def add_line(service, estimate_id, description, total, phase=4, quantity=1):
    return service.add_line_item(estimate_id, {
        "phase": phase, "description": description,
        "quantity": quantity, "unit": "LS", "unit_price": total / quantity, "total": total,
    })


def payload_sum(payload):
    """What the Scopit estimate will total: each line as estimate/api.py works it out."""
    items = [it for s in payload["sections"] for it in s["items"]]
    return float(sum((line_total(it) for it in items), Decimal("0")))


# ── One company's estimates ──

def test_another_company_cannot_see_or_change_an_estimate(ours, theirs):
    estimate = new_job(ours)
    assert estimate["company_id"] == str(COMPANY_ID)
    assert theirs.get_estimate(estimate["id"]) is None
    assert theirs.update_estimate(estimate["id"], BathroomEstimateUpdate(notes="x")) is None
    assert theirs.calculate(estimate["id"]) is None
    assert theirs.add_option(estimate["id"]) is None
    assert theirs.add_current_layout(estimate["id"]) is None
    assert theirs.get_group(estimate["id"]) is None
    assert theirs.get_layout_changes(estimate["id"]) is None
    assert theirs.clone_estimate(estimate["id"]) is None
    assert theirs.generate_overview(estimate["id"]) is None
    assert theirs.add_line_item(estimate["id"], {"phase": 1, "description": "x"}) is None
    assert theirs.delete_phase(estimate["id"], 1) is None
    assert theirs.get_history(estimate["id"]) == []
    assert theirs.delete_estimate(estimate["id"]) is False
    assert theirs.list_estimates()[1] == 0
    assert ours.list_estimates()[1] == 1


def test_another_company_cannot_touch_a_line_item(ours, theirs):
    estimate = add_line(ours, new_job(ours)["id"], "Demo floor tile", 180, phase=1)
    item_id = estimate["line_items"][0]["id"]
    assert theirs.update_line_item(estimate["id"], item_id, {"total": 1}) is None
    assert theirs.delete_line_item(estimate["id"], item_id) is None
    # Nor can a line item be reached through another estimate's id
    other = new_job(ours)
    assert ours.update_line_item(other["id"], item_id, {"total": 1}) is None
    assert ours.get_estimate(estimate["id"])["total"] == 180


def test_a_bad_id_is_simply_not_found(ours):
    assert ours.get_estimate("not-a-uuid") is None
    assert ours.list_estimates(customer_id="not-a-uuid") == ([], 0)
    estimate = new_job(ours)
    assert ours.update_line_item(estimate["id"], "not-a-uuid", {"total": 1}) is None


def test_the_pdf_header_is_the_companys_own(ours):
    info = new_job(ours)["company_info"]
    assert info["name"] == "MJ Co & Sons"
    assert (info["city"], info["state"]) == ("Rockville", "MD")


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
        ours.update_estimate(estimate["id"], BathroomEstimateUpdate(customer_id=str(stranger.id)))


def test_customer_and_claim_number_are_shared_by_the_whole_job(ours, session):
    jane = customer(session, COMPANY_ID, "Jane O'Neil")
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    ours.update_estimate(option["id"], BathroomEstimateUpdate(customer_id=str(jane.id), claim_number="CL-77"))
    restore = ours.get_estimate(restore["id"])
    assert (restore["client_name"], restore["claim_number"]) == ("Jane O'Neil", "CL-77")
    assert ours.list_estimates(search="CL-77", grouped=True)[1] == 1


def test_a_copy_is_not_linked_to_the_scopit_estimate_its_source_was_sent_to(ours, session):
    restore = new_job(ours)
    row = ours.find(restore["id"])
    row.scopit_estimate_id = uuid.uuid4()
    session.flush()
    assert ours.add_option(restore["id"])["scopit_estimate_id"] is None
    assert ours.clone_estimate(restore["id"])["scopit_estimate_id"] is None


# ── To a Scopit estimate ──

def test_a_scopit_estimate_adds_up_to_the_bathroom_total(ours):
    estimate = ours.calculate(new_job(ours)["id"])
    assert estimate["line_items"]
    payload = to_estimate_payload(estimate)
    assert payload_sum(payload) == round(estimate["total"], 2)
    assert all(len(it["name"]) <= 255 for s in payload["sections"] for it in s["items"])


def test_a_scopit_estimate_is_sectioned_by_phase(ours):
    estimate = ours.calculate(new_job(ours)["id"])
    names = [s["name"] for s in to_estimate_payload(estimate)["sections"]]
    assert names[0] == PHASE_LABELS[1]
    assert names == [label for _, label in sorted(PHASE_LABELS.items()) if label in names]


def test_a_scopit_estimate_hits_a_target_total_to_the_cent(ours):
    estimate = ours.calculate(new_job(ours, target_total=23456.78)["id"])
    assert payload_sum(to_estimate_payload(estimate)) == 23456.78


def test_a_line_total_set_by_hand_still_adds_up(ours):
    estimate = new_job(ours)
    estimate = add_line(ours, estimate["id"], "Haul away old vanity", 100, phase=1)
    item = estimate["line_items"][0]
    # Three of something whose total doesn't divide by three
    estimate = ours.update_line_item(estimate["id"], item["id"], {"quantity": 3, "unit_price": 33.33, "total": 100})
    assert estimate["total"] == 100
    assert payload_sum(to_estimate_payload(estimate)) == 100


def test_a_half_cent_line_rounds_up_as_the_scopit_estimate_does():
    # 2.5 × 405.73 is 1014.325: the Scopit estimate rounds it half up to
    # 1014.33, where float round() gives 1014.32
    estimate = {"total": 1014.33, "line_items": [
        {"phase": 3, "description": "Cement board", "quantity": 2.5, "unit": "SH",
         "unit_price": 405.73, "total": 1014.33},
    ]}
    payload = to_estimate_payload(estimate)
    item = payload["sections"][0]["items"][0]
    assert (item["quantity"], item["unit_price"]) == (2.5, 405.73)
    assert payload_sum(payload) == 1014.33


def test_a_line_the_calculator_rounded_down_keeps_its_quantity():
    # Two lines of a real MJ master bath, as the calculator prices them: its
    # float round() takes 138.1 × 2.55 = 352.155 down to 352.15 and
    # 43.75 × 20.46 = 895.125 down to 895.12, where the Scopit estimate
    # rounds both half up
    estimate = {"total": 2465.14, "line_items": [
        {"phase": 3, "display_order": 0, "description": "Waterproofing - Paint-on membrane",
         "quantity": 138.1, "unit": "SF", "unit_price": 2.55, "total": 352.15},
        {"phase": 4, "display_order": 1, "description": "Bathtub surround tile complete",
         "quantity": 43.75, "unit": "SF", "unit_price": 20.46, "total": 895.12},
        {"phase": 5, "display_order": 2, "description": "Shower door - Framed Sliding",
         "quantity": 1, "unit": "EA", "unit_price": 1217.87, "total": 1217.87},
    ]}
    payload = to_estimate_payload(estimate)
    items = {it["name"]: it for s in payload["sections"] for it in s["items"]}
    membrane = items["Waterproofing - Paint-on membrane"]
    surround = items["Bathtub surround tile complete"]
    assert (membrane["quantity"], membrane["unit"], membrane["unit_price"]) == (138.1, "SF", 2.55)
    assert (surround["quantity"], surround["unit"], surround["unit_price"]) == (43.75, "SF", 20.46)
    # The one-unit line gives back the two cents the others round up
    assert items["Shower door - Framed Sliding"]["unit_price"] == 1217.85
    assert payload_sum(payload) == 2465.14
    assert all("_total" not in it for it in items.values())


def test_with_no_one_unit_line_a_half_cent_line_goes_over_as_its_total():
    estimate = {"total": 352.15, "line_items": [
        {"phase": 3, "description": "Waterproofing - Paint-on membrane",
         "quantity": 138.1, "unit": "SF", "unit_price": 2.55, "total": 352.15},
    ]}
    payload = to_estimate_payload(estimate)
    item = payload["sections"][0]["items"][0]
    assert (item["quantity"], item["unit"], item["unit_price"]) == (1.0, "LS", 352.15)
    assert item["description"].startswith("138.1 SF at $2.55")
    assert payload_sum(payload) == 352.15


def test_no_line_goes_over_taxable(ours):
    estimate = ours.calculate(new_job(ours)["id"])
    items = [it for s in to_estimate_payload(estimate)["sections"] for it in s["items"]]
    assert items and not any(it["is_taxable"] for it in items)


def test_a_company_with_a_sales_tax_still_gets_the_bathroom_total(ours, session):
    """The calculator already puts material tax in its prices; the company's
    default tax rate must not charge it again on the Scopit estimate."""
    from types import SimpleNamespace

    from app.domains.company.models import Company
    from app.domains.estimate.models import (
        Estimate,
        EstimateAdjustment,
        EstimateItem,
        EstimatePayment,
        EstimateSection,
    )
    from app.domains.settings.models import EstimateStatusConfig
    from app.domains.tools.estimate_writer import write_estimate

    for model in (EstimateStatusConfig, Estimate, EstimateSection, EstimateItem,
                  EstimateAdjustment, EstimatePayment):
        model.__table__.create(session.connection())
    session.get(Company, COMPANY_ID).default_tax_rate = Decimal("6.000")
    estimate = ours.calculate(new_job(ours)["id"])

    written, _ = write_estimate(
        session, SimpleNamespace(company_id=COMPANY_ID, id=None), to_estimate_payload(estimate),
    )
    assert written.tax_amount == 0
    assert written.total == Decimal(str(round(estimate["total"], 2)))


def test_the_title_names_the_room_the_option_and_the_address(ours):
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    assert title_for(restore) == "Hall Bathroom — 12 Elm St"
    assert title_for(option) == "Hall Bathroom — Option A — 12 Elm St"


def test_the_claim_number_and_overview_go_in_the_description(ours):
    estimate = new_job(ours, claim_number="CL-9", overview_text="This estimate covers the hall bath.")
    estimate = ours.calculate(estimate["id"])
    assert to_estimate_payload(estimate)["description"] == "Claim #: CL-9\n\nThis estimate covers the hall bath."


# ── Overview note ──

def test_the_overview_note_falls_back_to_the_template_without_a_key(ours, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    estimate = new_job(ours)
    note = ours.generate_overview(estimate["id"])
    assert note and "bath" in note.lower()
    assert ours.get_estimate(estimate["id"])["overview_text"] == note


# ── Products ──

def test_an_option_cannot_take_another_companys_product(ours, session):
    restore = new_job(ours)
    option = ours.add_option(restore["id"])
    foreign = Product(id=uuid.uuid4(), company_id=OTHER_COMPANY_ID, category="toilet",
                      title="Their Toilet", price=Decimal("299"), price_unit="each",
                      retailer="other", image_file_ids=[], look={}, specs={})
    session.add(foreign)
    session.flush()
    with pytest.raises(LookupError):
        ours.set_selection(option["id"], "toilet", str(foreign.id))
    with pytest.raises(LookupError):
        ours.set_selection(option["id"], "toilet", "not-a-uuid")
