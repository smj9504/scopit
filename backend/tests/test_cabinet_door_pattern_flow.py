"""A box's door pattern and the three-door corner, from saving the estimate through
its calculation, an option's copy, the purchase order and the PDF. On a throwaway
SQLite database."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.tools.modules.cabinet_estimate.export_service import CabinetExportService  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.schemas import (  # noqa: E402
    CabinetBoxCreate,
    CabinetEstimateCreate,
    CabinetEstimateUpdate,
)
from app.domains.tools.modules.cabinet_estimate.service import CabinetEstimateService  # noqa: E402
from app.domains.tools.modules.cabinet_estimate.sketch_schemas import CabinetSketchCabinet  # noqa: E402
from tests.cabinet_db import COMPANY_ID, make_session  # noqa: E402


@pytest.fixture
def service(tmp_path):
    s = make_session(tmp_path)
    yield CabinetEstimateService(s, COMPANY_ID)
    s.close()


BOXES = [
    CabinetBoxCreate(code="WTD3642", cab_type="wall", width_inches=36, height_inches=42,
                     is_specialty=True, specialty_type="three_door_corner_wall", door_pattern="lattice"),
    CabinetBoxCreate(code="W3618", cab_type="wall", width_inches=36, height_inches=18,
                     door_pattern="lattice_band"),
    CabinetBoxCreate(code="W3030", cab_type="wall", width_inches=30, height_inches=30, door_pattern="lattice"),
    CabinetBoxCreate(code="W3030", cab_type="wall", width_inches=30, height_inches=30),
    CabinetBoxCreate(code="B48", cab_type="base", width_inches=48, height_inches=34.5),
]


def new_job(service, **fields):
    data = dict(
        project_type="insurance", property_address="12 Elm St", zip_code="20850",
        tier="Stock", boxes=BOXES, door_style="Arched Raised Panel",
    )
    data.update(fields)
    return service.create_estimate(CabinetEstimateCreate(**data))


def patterns(estimate):
    return sorted((b["code"], b["door_pattern"] or "") for b in estimate["boxes"])


SAVED = [
    ("B48", ""),
    ("W3030", ""),
    ("W3030", "lattice"),
    ("W3618", "lattice_band"),
    ("WTD3642", "lattice"),
]


def test_a_saved_box_keeps_its_pattern_and_a_plain_one_has_none(service):
    assert patterns(new_job(service)) == SAVED


def test_saving_the_box_list_again_keeps_the_patterns(service):
    job = new_job(service)
    updated = service.update_estimate(job["id"], CabinetEstimateUpdate(boxes=BOXES))
    assert patterns(updated) == SAVED


def test_an_upgrade_option_copies_the_patterns(service):
    restore = service.calculate(new_job(service)["id"])
    option = service.add_option(restore["id"])
    assert patterns(option) == SAVED
    assert any("Diamond Lattice" in li["description"] for li in service.calculate(option["id"])["line_items"])


def test_the_calculation_bills_each_pattern_and_the_corner(service):
    lines = service.calculate(new_job(service)["id"])["line_items"]
    names = {li["description"]: li for li in lines}
    assert names["Diamond Lattice Door - WTD3642"]["quantity"] == 3
    assert names["Lattice + Oval Band Door - W3618"]["quantity"] == 2
    assert names["Diamond Lattice Door - W3030"]["quantity"] == 2
    assert "Specialty Premium - WTD3642 (Three Door Corner Wall)" in names


def test_the_purchase_order_spells_out_the_two_and_three_door_angle_ends(service):
    boxes = [
        CabinetBoxCreate(code="WEA3D1236", cab_type="wall", width_inches=12, height_inches=36,
                         is_specialty=True, specialty_type="three_door_angle_end_wall"),
        CabinetBoxCreate(code="WEA2D1236", cab_type="wall", width_inches=12, height_inches=36,
                         is_specialty=True, specialty_type="two_door_angle_end_wall"),
    ]
    order = service.get_purchase_order(new_job(service, boxes=boxes)["id"])
    described = {(i["code"], i["description"]) for i in order["items"]}
    assert (
        "WEA3D1236",
        'Wall Cabinet WEA3D1236 (12"W x 36.0"H) - Three-Door Angle End (12" deep, a door on the front,'
        ' the 45° cut and the end)',
    ) in described
    assert (
        "WEA2D1236",
        'Wall Cabinet WEA2D1236 (12"W x 36.0"H) - Two-Door Angle End (12" x 12", the front bent once,'
        ' a door on each face; as Wolf WEC1230D)',
    ) in described


def test_the_purchase_order_says_what_to_order(service):
    order = service.get_purchase_order(new_job(service)["id"])
    described = {(i["code"], i["description"], i["qty"]) for i in order["items"]}
    assert ("W3030", 'Wall Cabinet W3030 (30"W x 30.0"H) - Diamond Lattice Doors', 1) in described
    assert ("W3030", 'Wall Cabinet W3030 (30"W x 30.0"H)', 1) in described
    assert ("W3618", 'Wall Cabinet W3618 (36"W x 18.0"H) - Lattice + Oval Band Doors', 1) in described
    assert (
        "WTD3642",
        'Wall Cabinet WTD3642 (36"W x 42.0"H) - Three-Door End Corner (12" deep, doors wrap the run end)'
        ' - Diamond Lattice Doors',
        1,
    ) in described
    assert ("B48", 'Base Cabinet B48 (48"W x 34.5"H)', 1) in described
    assert order["total_boxes"] == 5


def test_the_pdf_prints_the_new_lines(service):
    pypdf = pytest.importorskip("pypdf")
    estimate = service.calculate(new_job(service)["id"])
    text = "\n".join(
        page.extract_text() or ""
        for page in pypdf.PdfReader(CabinetExportService().generate_pdf(estimate)).pages
    )
    assert "Diamond Lattice Door - WTD3642" in text
    assert "Lattice + Oval Band Door - W3618" in text
    assert "Three Door Corner Wall" in text


def test_a_sketch_shape_keeps_its_pattern():
    shape = CabinetSketchCabinet(
        id="a", preset_code="W3030", cab_type="wall", x=0, y=0, width=50, height=20, door_pattern="lattice",
    )
    assert shape.model_dump()["door_pattern"] == "lattice"
