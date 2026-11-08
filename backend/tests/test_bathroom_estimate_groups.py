"""A bathroom job is a group of estimates: an insurance job's restoration
(the one the carrier sees) plus upgrade options, or a remodel's options.
Each is a full estimate; job facts are shared, the scope is not, and
nothing about an option ever reaches the carrier. On a throwaway SQLite
database."""

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import main  # noqa: E402,F401
from app.domains.tools.modules.bathroom_estimate.export_service import BathroomExportService  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import (  # noqa: E402
    BathroomEstimate,
)
from app.domains.tools.modules.bathroom_estimate.schemas import (  # noqa: E402
    BathroomEstimateCreate,
    BathroomEstimateUpdate,
)
from app.domains.tools.modules.bathroom_estimate.service import BathroomEstimateService  # noqa: E402
from tests.bathroom_db import COMPANY_ID, make_session  # noqa: E402


@pytest.fixture
def session(tmp_path):
    s = make_session(tmp_path)
    yield s
    s.close()


@pytest.fixture
def service(session):
    return BathroomEstimateService(session, COMPANY_ID)


def new_job(service, project_type="insurance", **fields):
    return service.create_estimate(BathroomEstimateCreate(
        project_type=project_type,
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        sketch_data={"fixtures": [{"id": "tub-1", "type": "bathtub"}]},
        **fields,
    ))


def add_line(service, estimate_id, description, total, phase=4):
    return service.add_line_item(estimate_id, {
        "phase": phase, "description": description,
        "quantity": 1, "unit": "LS", "unit_price": total,
    })


def text_of(pdf: io.BytesIO) -> str:
    from pypdf import PdfReader
    return "\n".join(page.extract_text() for page in PdfReader(pdf).pages)


def test_the_total_follows_line_items_added_and_deleted(service):
    estimate = new_job(service)
    after_add = add_line(service, estimate["id"], "Floor tile 12x12 porcelain", 900)
    assert [li["description"] for li in after_add["line_items"]] == ["Floor tile 12x12 porcelain"]
    assert after_add["total"] == 900

    vanity = add_line(service, estimate["id"], "Vanity 36in", 1200, phase=5)
    assert vanity["total"] == 2100

    tile = after_add["line_items"][0]
    after_delete = service.delete_line_item(estimate["id"], tile["id"])
    assert [li["description"] for li in after_delete["line_items"]] == ["Vanity 36in"]
    assert after_delete["total"] == 1200


def test_the_total_is_the_exact_sum_and_no_line_is_changed_to_round_it(service):
    # It used to round to $10 and push the difference into the biggest line,
    # so a price typed on that line came back a few dollars off
    estimate = new_job(service)
    add_line(service, estimate["id"], "Vanity 36in", 1234.56, phase=5)
    after = add_line(service, estimate["id"], "Floor tile 12x12 porcelain", 87.13)
    assert after["total"] == pytest.approx(1321.69)
    assert after["subtotal"] == pytest.approx(1321.69)
    vanity = next(li for li in after["line_items"] if li["description"] == "Vanity 36in")
    assert (vanity["unit_price"], vanity["total"]) == (1234.56, 1234.56)

    edited = service.update_line_item(estimate["id"], vanity["id"], {"unit_price": 1501.37})
    vanity = next(li for li in edited["line_items"] if li["description"] == "Vanity 36in")
    assert (vanity["unit_price"], vanity["total"]) == (1501.37, 1501.37)
    assert edited["total"] == pytest.approx(1588.50)


def test_a_calculated_total_is_the_sum_of_its_lines_with_each_line_qty_times_price(service):
    from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate
    result = calculate_estimate(BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code="20850",
        length_ft=8, width_ft=6, floor_sf=40, wall_sf=600, height_ft=8,
        walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
        replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic"},
    ))
    lines = result["line_items"]
    assert result["total"] == pytest.approx(sum(li["total"] for li in lines), abs=0.005)
    for li in lines:
        assert li["total"] == pytest.approx(round(li["quantity"] * li["unit_price"], 2), abs=0.005), li["description"]


def test_an_insurance_job_starts_with_its_restoration_and_a_remodel_with_option_a(service):
    claim = new_job(service)
    assert claim["kind"] == "restore"
    assert claim["option_label"] is None
    assert claim["group_id"] == claim["id"]
    assert [m["id"] for m in claim["group_members"]] == [claim["id"]]

    remodel = new_job(service, project_type="remodel")
    assert (remodel["kind"], remodel["option_label"]) == ("option", "Option A")
    assert remodel["group_id"] != claim["group_id"]


def test_an_option_starts_as_a_copy_and_the_restoration_does_not_move(service):
    restoration = new_job(service)
    add_line(service, restoration["id"], "Floor tile 12x12 porcelain", 900)

    option = service.add_option(restoration["id"])
    assert (option["kind"], option["option_label"], option["option_order"]) == ("option", "Option A", 1)
    assert option["group_id"] == restoration["group_id"]
    assert option["sketch_data"] == restoration["sketch_data"]
    assert [li["description"] for li in option["line_items"]] == ["Floor tile 12x12 porcelain"]
    assert option["total"] == service.get_estimate(restoration["id"])["total"]
    assert option["status"] == "calculated"

    # A different tile in the option leaves the restoration as it was
    tile = option["line_items"][0]
    service.update_line_item(option["id"], tile["id"], {
        "description": "Floor tile 12x24 marble", "unit_price": 1500,
    })
    service.update_estimate(option["id"], BathroomEstimateUpdate(
        bath_function="three_quarter", sketch_data={"fixtures": []},
    ))
    again = service.get_estimate(restoration["id"])
    assert [li["description"] for li in again["line_items"]] == ["Floor tile 12x12 porcelain"]
    assert again["bath_function"] == "full"
    assert again["sketch_data"] == {"fixtures": [{"id": "tub-1", "type": "bathtub"}]}

    # Options letter on from the ones the job already has
    second = service.add_option(option["id"])
    assert (second["option_label"], second["option_order"]) == ("Option B", 2)
    assert [li["description"] for li in second["line_items"]] == ["Floor tile 12x24 marble"]
    assert [m["option_label"] for m in second["group_members"]] == [None, "Option A", "Option B"]


def test_an_option_is_priced_on_its_own_not_pinned_to_the_restorations_target(service):
    restoration = new_job(service)
    service.update_estimate(restoration["id"], BathroomEstimateUpdate(target_total=12000))

    option = service.add_option(restoration["id"])
    assert option["target_total"] is None
    assert service.get_estimate(restoration["id"])["target_total"] == 12000


def test_job_facts_are_shared_across_the_job(service):
    restoration = new_job(service)
    option = service.add_option(restoration["id"])

    service.update_estimate(option["id"], BathroomEstimateUpdate(
        property_address="14 Elm St", zip_code="20852", year_built=1975,
    ))
    again = service.get_estimate(restoration["id"])
    assert (again["property_address"], again["zip_code"], again["year_built"]) == ("14 Elm St", "20852", 1975)


def test_the_list_shows_one_row_per_job_and_the_supplement_picker_only_restorations(service):
    restoration = new_job(service)
    service.add_option(restoration["id"])
    service.add_option(restoration["id"])
    remodel = new_job(service, project_type="remodel")
    service.add_option(remodel["id"])

    rows, total = service.list_estimates(grouped=True)
    assert total == 2
    assert {r["id"] for r in rows} == {restoration["id"], remodel["id"]}
    members = {r["id"]: [m["option_label"] for m in r["group_members"]] for r in rows}
    assert members[restoration["id"]] == [None, "Option A", "Option B"]
    assert members[remodel["id"]] == ["Option A", "Option B"]

    restorations, total = service.list_estimates(kind="restore")
    assert total == 1
    assert restorations[0]["id"] == restoration["id"]


def test_a_restoration_with_options_cannot_be_deleted_on_its_own(service):
    restoration = new_job(service)
    a = service.add_option(restoration["id"])
    b = service.add_option(restoration["id"])

    with pytest.raises(ValueError):
        service.delete_estimate(restoration["id"])

    assert service.delete_estimate(a["id"])
    left = service.get_estimate(b["id"])
    assert [(m["option_label"], m["option_order"]) for m in left["group_members"]] == [(None, 0), ("Option B", 1)]

    assert service.delete_estimate(b["id"], whole_group=True)
    assert service.get_estimate(restoration["id"]) is None


def test_switching_a_job_between_insurance_and_remodel(service):
    restoration = new_job(service)
    option = service.add_option(restoration["id"])

    remodel = service.set_project_type(option["id"], "remodel")
    kinds = {m["id"]: (m["kind"], m["option_label"]) for m in remodel["group_members"]}
    assert kinds[restoration["id"]] == ("option", "Option B")
    assert kinds[option["id"]] == ("option", "Option A")
    assert service.get_estimate(restoration["id"])["project_type"] == "remodel"

    # Back to insurance: the estimate it's asked from becomes the restoration
    insurance = service.set_project_type(option["id"], "insurance")
    assert (insurance["kind"], insurance["option_label"]) == ("restore", None)
    assert [(m["id"], m["option_order"]) for m in insurance["group_members"]] == [
        (option["id"], 0), (restoration["id"], 1),
    ]


def test_a_clone_is_a_new_job_with_the_whole_scope(service):
    source = new_job(service, demo_floor=True, water_damage_source="shower")
    service.update_estimate(source["id"], BathroomEstimateUpdate(target_total=12000))
    add_line(service, source["id"], "Demo floor tile", 180, phase=1)

    clone = service.clone_estimate(source["id"])
    assert clone["group_id"] == clone["id"] != source["group_id"]
    assert clone["kind"] == "restore"
    assert (clone["demo_floor"], clone["water_damage_source"], clone["target_total"]) == (True, "shower", 12000)
    assert clone["sketch_data"] == source["sketch_data"]
    assert [li["description"] for li in clone["line_items"]] == ["Demo floor tile"]
    assert clone["notes"] == "Cloned from estimate"


def test_the_carriers_pdf_never_mentions_the_options(service):
    restoration = new_job(service)
    add_line(service, restoration["id"], "Floor tile 12x12 porcelain", 900)
    option = service.add_option(restoration["id"])
    service.rename_option(option["id"], "Marble upgrade")
    service.update_line_item(option["id"], option["line_items"][0]["id"], {
        "description": "Floor tile 12x24 marble", "unit_price": 1500,
    })

    exporter = BathroomExportService()
    carrier = text_of(exporter.generate_pdf(service.get_estimate(restoration["id"])))
    assert "Marble" not in carrier and "Option" not in carrier

    customer_option = text_of(exporter.generate_pdf(service.get_estimate(option["id"])))
    assert "Marble upgrade" in customer_option

    proposal = text_of(exporter.generate_proposal_pdf(service.get_group(option["id"])))
    assert "Restoration (pre-loss condition)" in proposal
    assert "Marble upgrade: what changes from the restoration" in proposal
    assert "Floor tile 12x24 marble" in proposal
    assert "+$600.00" in proposal


def _jpeg_base64(color=(200, 190, 170)) -> str:
    import base64

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (120, 80), color).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _image_count(pdf: io.BytesIO) -> int:
    from pypdf import PdfReader
    return sum(len(page.images) for page in PdfReader(pdf).pages)


def test_the_3d_view_goes_on_options_and_the_proposal_never_on_the_carriers_pdf(service):
    restoration = new_job(service)
    add_line(service, restoration["id"], "Floor tile 12x12 porcelain", 900)
    option = service.add_option(restoration["id"])
    render = _jpeg_base64()
    exporter = BathroomExportService()

    carrier = exporter.generate_pdf(service.get_estimate(restoration["id"]), render_image_base64=render)
    assert _image_count(carrier) == 0
    assert "How It Will Look" not in text_of(exporter.generate_pdf(service.get_estimate(restoration["id"]), render_image_base64=render))

    with_view = exporter.generate_pdf(service.get_estimate(option["id"]), render_image_base64=render)
    assert _image_count(with_view) == 1
    assert "How It Will Look" in text_of(exporter.generate_pdf(service.get_estimate(option["id"]), render_image_base64=render))

    group = service.get_group(option["id"])
    # Two different pictures (the PDF keeps one copy of identical ones)
    proposal = exporter.generate_proposal_pdf(group, renders={restoration["id"]: render, option["id"]: _jpeg_base64((90, 120, 150))})
    assert _image_count(proposal) == 2
    assert "How Each Looks" in text_of(exporter.generate_proposal_pdf(group, renders={option["id"]: render}))
    assert "How Each Looks" not in text_of(exporter.generate_proposal_pdf(group))


def test_a_remodel_proposal_lists_the_options_without_a_restoration(service):
    a = new_job(service, project_type="remodel")
    add_line(service, a["id"], "Vanity 36in", 1200, phase=5)
    b = service.add_option(a["id"])
    service.update_line_item(b["id"], b["line_items"][0]["id"], {"unit_price": 1800})

    proposal = text_of(BathroomExportService().generate_proposal_pdf(service.get_group(a["id"])))
    assert "Option A" in proposal and "Option B" in proposal
    assert "Restoration" not in proposal
    assert "Over restoration" not in proposal
