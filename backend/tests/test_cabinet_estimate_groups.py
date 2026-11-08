"""A kitchen job is a group of estimates, as a bathroom job is: an insurance
job's restoration (the one the carrier sees) plus upgrade options, or a
remodel's options. An option can be built from products in the library,
which price its material at the product's own price while our labor stays
on the rate tables. Nothing about an option ever reaches the carrier. On a
throwaway SQLite database."""

import io
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.product_library.models import Product  # noqa: E402
from app.domains.tools.modules.cabinet_estimate import selections as sel  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.export_service import CabinetExportService  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.models import (  # noqa: E402
    CabinetSketch,  # noqa: E402
)
from app.domains.tools.modules.cabinet_estimate.pricing import BASE_RATES  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.schemas import (  # noqa: E402
    CabinetBoxCreate,
    CabinetEstimateCreate,
    CabinetEstimateUpdate,
)
from app.domains.tools.modules.cabinet_estimate.service import CabinetEstimateService  # noqa: E402
from tests.cabinet_db import COMPANY_ID, make_session  # noqa: E402


@pytest.fixture
def session(tmp_path):
    s = make_session(tmp_path)
    yield s
    s.close()


@pytest.fixture
def service(session):
    return CabinetEstimateService(session, COMPANY_ID)


BOXES = [
    CabinetBoxCreate(code="B30", cab_type="base", width_inches=30, height_inches=34.5),
    CabinetBoxCreate(code="SB36", cab_type="base", width_inches=36, height_inches=34.5,
                     is_specialty=True, specialty_type="sink_base"),
    CabinetBoxCreate(code="W3030", cab_type="wall", width_inches=30, height_inches=30),
]


def new_job(service, project_type="insurance", **fields):
    data = dict(
        project_type=project_type, property_address="12 Elm St", zip_code="20850",
        tier="Stock", boxes=BOXES,
        include_countertop=True, countertop_material="Quartz", countertop_sqft=40,
        include_backsplash=True, backsplash_type="subway_tile", backsplash_sqft=30,
        include_plumbing=True,
    )
    data.update(fields)
    return service.create_estimate(CabinetEstimateCreate(**data))


def add_product(session, category, title, price, unit="each", **fields):
    fields.setdefault("look", {})
    product = Product(id=uuid.uuid4(), company_id=COMPANY_ID, category=category, title=title, price=Decimal(str(price)),
                      price_unit=unit, retailer="home_depot", image_file_ids=[], specs={},
                      **fields)
    session.add(product)
    session.flush()
    return product


def line(estimate, starts):
    found = [li for li in estimate["line_items"] if li["description"].startswith(starts)]
    assert found, f"no line starting {starts!r}: {[li['description'] for li in estimate['line_items']]}"
    return found[0]


def text_of(pdf: io.BytesIO) -> str:
    from pypdf import PdfReader
    return "\n".join(page.extract_text() for page in PdfReader(pdf).pages)


# ── The job ──

def test_an_insurance_job_starts_with_its_restoration_and_a_remodel_with_option_a(service):
    restore = new_job(service)
    assert (restore["kind"], restore["option_label"], restore["group_id"]) == ("restore", None, restore["id"])
    remodel = new_job(service, project_type="remodel")
    assert (remodel["kind"], remodel["option_label"]) == ("option", "Option A")


def test_an_option_is_a_copy_of_the_estimate_with_its_boxes_sketch_and_prices(service, session):
    restore = new_job(service, target_total=30000)
    restore = service.calculate(restore["id"])
    session.add(CabinetSketch(estimate_id=uuid.UUID(restore["id"]),
                              overlay_data={"walls": [{"id": "w1"}], "finish": {"cabinet_color": "#ffffff"}}))
    session.flush()

    option = service.add_option(restore["id"])
    assert (option["kind"], option["option_label"], option["group_id"]) == ("option", "Option A", restore["id"])
    assert [b["code"] for b in option["boxes"]] == ["B30", "SB36", "W3030"]
    assert len(option["line_items"]) == len(restore["line_items"])
    assert option["status"] == "calculated"
    # The restoration's target total would pin the option back to its figure
    assert option["target_total"] is None
    sketch = session.query(CabinetSketch).filter(CabinetSketch.estimate_id == uuid.UUID(option["id"])).one()
    assert sketch.overlay_data["walls"] == [{"id": "w1"}]

    second = service.add_option(option["id"])
    assert second["option_label"] == "Option B"
    assert [m["kind"] for m in second["group_members"]] == ["restore", "option", "option"]


def test_job_facts_are_shared_and_scope_is_not(service):
    restore = new_job(service)
    option = service.add_option(restore["id"])
    service.update_estimate(option["id"], CabinetEstimateUpdate(property_address="14 Elm St", countertop_sqft=55))
    restore = service.get_estimate(restore["id"])
    assert restore["property_address"] == "14 Elm St"
    assert restore["countertop_sqft"] == 40


def test_the_restoration_cannot_go_while_it_has_options_but_the_whole_job_can(service):
    restore = new_job(service)
    option = service.add_option(restore["id"])
    with pytest.raises(ValueError):
        service.delete_estimate(restore["id"])
    assert service.delete_estimate(option["id"])
    assert service.get_estimate(restore["id"])["group_members"][0]["option_order"] == 0
    service.add_option(restore["id"])
    assert service.delete_estimate(restore["id"], whole_group=True)
    assert service.list_estimates()[1] == 0


def test_the_list_shows_one_row_per_job(service):
    restore = new_job(service)
    service.add_option(restore["id"])
    new_job(service, project_type="remodel", property_address="9 Oak Ave")
    items, total = service.list_estimates(grouped=True)
    assert total == 2
    by_address = {i["property_address"]: i for i in items}
    assert [m["kind"] for m in by_address["12 Elm St"]["group_members"]] == ["restore", "option"]
    assert service.list_estimates(kind="restore")[1] == 1


def test_switching_the_job_type(service, session):
    restore = new_job(service)
    option = service.add_option(restore["id"])
    remodel = service.set_project_type(restore["id"], "remodel")
    assert remodel["kind"] == "option" and remodel["option_label"] == "Option B"

    # Back to insurance: the estimate asked from becomes the restoration and
    # lets go of its products
    faucet = add_product(session, "kitchen_faucet", "Arbor Pull-Down Faucet", 229)
    service.set_selection(option["id"], "kitchen_faucet", str(faucet.id))
    back = service.set_project_type(option["id"], "insurance")
    assert back["kind"] == "restore" and back["option_label"] is None
    assert not back["selections"]


# ── Products ──

def test_a_restoration_takes_no_products(service, session):
    restore = new_job(service)
    top = add_product(session, "countertop", "Calacatta Quartz", 58, unit="sf")
    with pytest.raises(ValueError):
        service.set_selection(restore["id"], "countertop", str(top.id))


def test_a_product_must_fit_its_slot(service, session):
    option = service.add_option(new_job(service)["id"])
    faucet = add_product(session, "kitchen_faucet", "Arbor Pull-Down Faucet", 229)
    with pytest.raises(ValueError):
        service.set_selection(option["id"], "countertop", str(faucet.id))
    with pytest.raises(LookupError):
        service.set_selection(option["id"], "countertop", str(uuid.uuid4()))


def test_a_chosen_product_prices_its_material_and_our_labor_stays(service, session):
    restore = service.calculate(new_job(service)["id"])
    option = service.add_option(restore["id"])
    top = add_product(session, "countertop", "Calacatta Quartz", 58, unit="sf", brand="MSI")
    tile = add_product(session, "backsplash", "Ivory Subway Tile", 18.99, unit="box", box_sf=12.5,
                       look={"pattern": "subway"})
    pull = add_product(session, "cabinet_hardware", "Bar Pull 5-1/16 in.", 6.48, brand="Amerock",
                       finish="Golden Champagne")
    sink = add_product(session, "kitchen_sink", "33 in. Farmhouse Sink", 499, width_in=33)
    faucet = add_product(session, "kitchen_faucet", "Arbor Pull-Down Faucet", 229, brand="MOEN")

    for slot, product in (("countertop", top), ("backsplash", tile), ("cabinet_hardware", pull),
                          ("kitchen_sink", sink), ("kitchen_faucet", faucet)):
        option = service.set_selection(option["id"], slot, str(product.id))
    assert option["selections"]["countertop"]["title"] == "Calacatta Quartz"

    # Line prices carry overhead and profit, none on a new job; the
    # restoration's quartz line ($90/sf on the table) shows by how much
    o_and_p = line(restore, "Countertop - Quartz")["unit_price"] / 90
    assert o_and_p == pytest.approx(1.00, abs=0.01)

    # Countertop: $58/sf × 1.15 handling × 1.10 overage, plus the labor share
    # of the quartz rate ($90 × 0.45)
    ct = line(option, "Countertop - MSI Calacatta Quartz")
    assert ct["unit_price"] == pytest.approx((round(58 * 1.15, 2) * 1.10 + 90 * 0.45) * o_and_p, abs=0.05)
    # Backsplash: $18.99 / 12.5 sf box, handling, overage, misc; our subway install
    bs = line(option, "Backsplash - Ivory Subway Tile")
    expected_bs = round(round(18.99 / 12.5 * 1.15, 2) * 1.10 + 1.60, 2) + 15
    assert bs["unit_price"] == pytest.approx(expected_bs * o_and_p, abs=0.05)
    hw = line(option, "Cabinet Hardware - Amerock Bar Pull")
    assert hw["unit_price"] == pytest.approx(round(6.48 * 1.15, 2) * o_and_p, abs=0.02)
    assert "Golden Champagne" in hw["description"]
    assert line(option, "33 in. Farmhouse Sink")["unit_price"] == pytest.approx(round(499 * 1.15, 2) * o_and_p, abs=0.05)
    assert line(option, "MOEN Arbor Pull-Down Faucet")["unit_price"] == pytest.approx(round(229 * 1.15, 2) * o_and_p, abs=0.05)
    # Our install labor is the restoration's
    assert line(option, "Hardware Installation")["total"] == line(restore, "Hardware Installation")["total"]
    assert "Products (retail price + 15% handling" in option["methodology_notes"]

    # The restoration is untouched
    restore_again = service.get_estimate(restore["id"])
    assert restore_again["total"] == restore["total"]
    assert not any("Calacatta" in li["description"] for li in restore_again["line_items"])

    # Emptying a slot goes back to the table price
    option = service.set_selection(option["id"], "countertop", None)
    assert line(option, "Countertop - Quartz")["unit_price"] == line(restore, "Countertop - Quartz")["unit_price"]


def test_a_cabinet_line_sets_the_cabinet_supply_level(service, session):
    option = service.add_option(service.calculate(new_job(service)["id"])["id"])
    before = sum(li["total"] for li in option["line_items"] if li["category"] == "supply"
                 and "Cabinet" in li["description"] and "Hardware" not in li["description"])
    # $460 for a 30" base: $184/LF retail, ×1.15 = $211.60 against the Stock base rate
    base = add_product(session, "cabinet", "Shaker 30 in. Base Cabinet in White", 460,
                       width_in=30, depth_in=24, height_in=34.5)
    option = service.set_selection(option["id"], "cabinets", str(base.id))
    after = sum(li["total"] for li in option["line_items"] if li["category"] == "supply"
                and "Cabinet" in li["description"] and "Hardware" not in li["description"])
    assert f"supply multiplier {211.60 / BASE_RATES['Stock']['base_lf']:.2f}" in option["methodology_notes"]
    assert after != before


def test_a_product_that_cannot_be_priced_says_so(service, session):
    option = service.add_option(service.calculate(new_job(service)["id"])["id"])
    tile = add_product(session, "backsplash", "Mosaic Sheet", 12.99)  # each, no size
    option = service.set_selection(option["id"], "backsplash", str(tile.id))
    assert any("Mosaic Sheet" in w for w in option["warning_flags"])
    assert line(option, "Backsplash - Subway Tile")


def test_products_for_scope_that_is_off_are_flagged(service, session):
    option = service.add_option(service.calculate(new_job(service, include_plumbing=False)["id"])["id"])
    faucet = add_product(session, "kitchen_faucet", "Arbor Pull-Down Faucet", 229)
    option = service.set_selection(option["id"], "kitchen_faucet", str(faucet.id))
    assert any("Arbor Pull-Down Faucet is chosen" in w for w in option["warning_flags"])


def test_price_units_convert():
    assert sel.sf_price({"price": 19.99, "price_unit": "sf"}) == 19.99
    assert sel.sf_price({"price": 25, "price_unit": "box", "box_sf": 10}) == 2.5
    assert sel.sf_price({"price": 2, "price_unit": "each", "tile_width_in": 3, "tile_length_in": 6}) == 16
    assert sel.sf_price({"price": 255, "price_unit": "lf"}, 25.5) == pytest.approx(120)
    assert sel.sf_price({"price": 200, "price_unit": "each", "width_in": 96}, 25.5) == pytest.approx(200 / (96 * 25.5 / 144))
    assert sel.sf_price({"price": 10, "price_unit": "each"}) is None
    assert sel.lf_price({"price": 300, "price_unit": "each", "width_in": 36}) == 100
    assert sel.cabinet_kind({"depth_in": 12, "height_in": 30}) == "wall"
    assert sel.cabinet_kind({"depth_in": 24, "height_in": 84}) == "tall"


# ── PDFs ──

def test_an_options_pdf_names_it_and_shows_its_products_and_the_restorations_never(service, session):
    restore = service.calculate(new_job(service)["id"])
    option = service.add_option(restore["id"])
    faucet = add_product(session, "kitchen_faucet", "Arbor Pull-Down Faucet", 229, brand="MOEN",
                         source_url="https://www.homedepot.com/p/1")
    option = service.set_selection(option["id"], "kitchen_faucet", str(faucet.id))

    option_pdf = text_of(CabinetExportService().generate_pdf(option, image_loader=lambda _id: None))
    assert "Option A" in option_pdf
    assert "Selected Products" in option_pdf
    assert "MOEN Arbor Pull-Down Faucet" in option_pdf

    restore_pdf = text_of(CabinetExportService().generate_pdf(service.get_estimate(restore["id"])))
    assert "Option" not in restore_pdf
    assert "Selected Products" not in restore_pdf


def test_the_proposal_lays_out_the_job(service, session):
    restore = service.calculate(new_job(service)["id"])
    option = service.add_option(restore["id"])
    top = add_product(session, "countertop", "Calacatta Quartz", 58, unit="sf")
    service.set_selection(option["id"], "countertop", str(top.id))
    group = service.get_group(restore["id"])
    text = text_of(CabinetExportService().generate_proposal_pdf(group))
    assert "KITCHEN OPTIONS" in text
    assert "Over restoration" in text
    assert "Option A" in text
    assert "Calacatta Quartz" in text
