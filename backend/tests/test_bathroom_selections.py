"""A bathroom option can be built from real products in the company's
library: the estimate keeps a copy of each, prices the material at the
product's retail price (with the handling every retail-priced table gets)
and keeps the rate tables' labor. A restoration never is. On a throwaway
SQLite database."""

import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402,F401
from app.domains.product_library.models import Product  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.models import (  # noqa: E402
    BathroomEstimate,
)
from app.domains.tools.modules.bathroom_estimate.pricing import MATERIAL_HANDLING  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.schemas import BathroomEstimateCreate  # noqa: E402
from app.domains.tools.modules.bathroom_estimate.selections import Picks, sold_with_top, tile_size_key  # noqa: E402
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


def product(session, category, title, price, unit="each", **fields):
    fields.setdefault("retailer", "home_depot")
    fields.setdefault("image_file_ids", ["file-1"])
    p = Product(company_id=COMPANY_ID, category=category, title=title, price=Decimal(str(price)), price_unit=unit,
                look=fields.pop("look", {}), specs={}, **fields)
    session.add(p)
    session.flush()
    return p


def new_job(service, project_type="insurance"):
    """A hall bath: new toilet, a 36" vanity, an alcove tub with a tiled surround, and a porcelain floor."""
    return service.create_estimate(BathroomEstimateCreate(
        project_type=project_type,
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=5, floor_sf=40,
        replace_toilet=True, replace_vanity=True, replace_tub=True,
        toilet_spec={"type": "two_piece_standard"},
        vanity_spec={"items": [{"sink_type": "cabinet", "width": 36, "sinks": 1}]},
        bathtub_spec={"type": "alcove", "material": "acrylic", "surround_tile": True, "surround_tile_sf": 50},
        floor_spec={"material": "porcelain", "size": "12x12", "pattern": "straight"},
        sketch_data={"fixtures": [{"id": "tub-1", "type": "bathtub"}]},
    ))


def line(estimate, starts_with):
    found = [li for li in estimate["line_items"] if li["description"].startswith(starts_with)]
    assert len(found) == 1, [li["description"] for li in estimate["line_items"]]
    return found[0]


def handled(price):
    return round(price * MATERIAL_HANDLING, 2)


def test_an_options_picked_products_set_its_material_and_keep_our_labor(service, session):
    restoration = new_job(service)
    service.calculate(restoration["id"])
    option = service.add_option(restoration["id"])

    toilet = product(session, "toilet", "Kohler Highline Elongated Toilet", 389, brand="Kohler")
    tub = product(session, "bathtub", "American Standard Princeton 60 in. Cast Iron Tub", 912,
                  look={"material": "cast_iron"})
    tile = product(session, "floor_tile", "MSI Carrara 12 in. x 24 in. Marble Tile", 64.80, unit="box",
                   box_sf=12, tile_width_in=12, tile_length_in=24, look={"material": "marble"})
    for slot, p in (("toilet", toilet), ("bathtub", tub), ("floor_tile", tile)):
        service.set_selection(option["id"], slot, p.id)
    priced = service.calculate(option["id"])
    allowance = service.calculate(restoration["id"])

    # The toilet is Kohler's price, handled, plus the same setting labor
    t = line(priced, "Toilet complete - Kohler Highline")
    assert f"Unit: Kohler Highline Elongated Toilet ${handled(389):,.2f} |" in t["notes"]
    assert "allowance" not in t["notes"].split("|")[0]
    assert t["notes"].split("|")[1] == line(allowance, "Toilet complete")["notes"].split("|")[1]

    # The tub: its price, and as cast iron it needs no mortar bed
    b = line(priced, "Bathtub complete - American Standard Princeton")
    assert f"${handled(912):,.2f}" in b["notes"]
    assert "Mortar bed" not in b["notes"]
    assert "Mortar bed" in line(allowance, "Bathtub complete")["notes"]

    # The floor tile: a $64.80 box of 12 SF is $5.40/SF; marble is sealed; a 12x24 lays at that size
    f = line(priced, "Floor tile complete - MSI Carrara")
    assert f"${handled(5.40):.2f}/SF," in f["notes"]
    assert "(12x24, straight)" in f["description"]
    assert "Sealer" in f["notes"]

    # Nothing about the restoration moved
    assert service.get_estimate(restoration["id"])["selections"] is None
    assert allowance["total"] == service.calculate(restoration["id"])["total"]


def test_the_restoration_is_never_built_from_products(service, session):
    restoration = new_job(service)
    toilet = product(session, "toilet", "Kohler Highline", 389)
    with pytest.raises(ValueError, match="restoration"):
        service.set_selection(restoration["id"], "toilet", toilet.id)

    # Even a restoration that somehow carries one prices from the rate tables
    est = BathroomEstimate(kind="restore", selections={"toilet": {"title": "X", "price": "9999", "price_unit": "each"}})
    assert Picks(est).each("toilet") is None
    est.kind = "option"
    assert Picks(est).each("toilet") == 9999


def test_an_insurance_job_switched_back_makes_a_restoration_without_products(service, session):
    remodel = new_job(service, project_type="remodel")
    toilet = product(session, "toilet", "Kohler Highline", 389)
    service.set_selection(remodel["id"], "toilet", toilet.id)

    copy = service.add_option(remodel["id"])
    assert copy["selections"]["toilet"]["title"] == "Kohler Highline"

    current = service.add_current_layout(remodel["id"])
    assert current["selections"] is None

    service.set_project_type(remodel["id"], "insurance")
    members = {m["kind"]: m for m in service.get_group(remodel["id"])["members"]}
    assert members["restore"]["selections"] is None


def test_a_product_is_copied_so_a_library_change_doesnt_move_the_option(service, session):
    option = new_job(service, project_type="remodel")
    toilet = product(session, "toilet", "Kohler Highline", 389)
    service.set_selection(option["id"], "toilet", toilet.id)
    before = service.calculate(option["id"])["total"]

    toilet.price = Decimal("999")
    toilet.title = "Renamed"
    session.flush()
    after = service.calculate(option["id"])
    assert after["total"] == before
    assert after["selections"]["toilet"]["title"] == "Kohler Highline"


def test_a_product_only_fills_a_slot_of_its_kind(service, session):
    option = new_job(service, project_type="remodel")
    tile = product(session, "wall_tile", "Subway 3x12", 1.99, unit="sf")
    with pytest.raises(ValueError, match="toilet"):
        service.set_selection(option["id"], "toilet", tile.id)
    with pytest.raises(ValueError, match="Unknown"):
        service.set_selection(option["id"], "sofa", tile.id)


def test_a_vanity_sold_with_its_top_prices_no_second_top(service, session):
    option = new_job(service, project_type="remodel")
    with_top = product(session, "vanity",
                       "Glacier Bay 36 in. Single Sink Bath Vanity in White with White Cultured Marble Top", 549)
    picked = service.set_selection(option["id"], "vanity", with_top.id)
    assert picked["selections"]["vanity"]["includes_top"] is True
    v = line(service.calculate(option["id"]), "Vanity complete - Glacier Bay")
    assert "Top: comes with the vanity" in v["notes"]

    cabinet = product(session, "vanity", "Home Decorators Sonoma 36 in. Vanity Cabinet Only", 799)
    top = product(session, "vanity_top", "Quartz Vanity Top 37 in.", 329)
    service.set_selection(option["id"], "vanity", cabinet.id)
    service.set_selection(option["id"], "vanity_top", top.id)
    v = line(service.calculate(option["id"]), "Vanity complete - Home Decorators Sonoma")
    assert f"Top: Quartz Vanity Top 37 in. ${handled(329):,.2f}" in v["notes"]

    # Taking the top off goes back to the rate table's top
    after = service.clear_selection(option["id"], "vanity_top")
    assert set(after["selections"]) == {"vanity"}
    v = line(service.calculate(option["id"]), "Vanity complete - Home Decorators Sonoma")
    assert "/in" in v["notes"]


def test_what_cant_be_priced_from_its_product_says_so(service, session):
    option = new_job(service, project_type="remodel")
    no_coverage = product(session, "floor_tile", "Mystery Tile", 48, unit="box")
    wall = product(session, "wall_tile", "Subway 3x12", 1.99, unit="sf")
    service.set_selection(option["id"], "floor_tile", no_coverage.id)
    # The job has no tiled walls outside the tub
    service.set_selection(option["id"], "wall_tile", wall.id)
    result = service.calculate(option["id"])
    warnings = result["warning_flags"]
    assert any(w.startswith("Floor tile: Mystery Tile has no price per square foot") for w in warnings)
    assert any(w.startswith("Wall tile: Subway 3x12 is picked, but the estimate doesn't replace that") for w in warnings)
    assert "porcelain" in line(result, "Floor tile complete")["description"]


def test_tile_prices_and_sizes_convert_to_the_rate_tables_units():
    def picks(**p):
        return Picks(BathroomEstimate(kind="option", selections={"floor_tile": {"title": "T", **p}}))

    assert picks(price="5", price_unit="sf").per_sf("floor_tile") == 5
    assert picks(price="60", price_unit="box", box_sf=15).per_sf("floor_tile") == 4
    # One 12 x 24 tile is 2 SF
    assert picks(price="7", price_unit="each", tile_width_in=12, tile_length_in=24).per_sf("floor_tile") == 3.5
    assert picks(price="7", price_unit="each").per_sf("floor_tile") is None

    assert tile_size_key(3, 12) == "4x12_subway"
    assert tile_size_key(24, 12) == "12x24"
    assert tile_size_key(1, 1) == "1x1_mosaic"
    assert tile_size_key(None, 12) is None

    top = Picks(BathroomEstimate(kind="option", selections={"vanity_top": {"title": "Top", "price": "120", "price_unit": "lf"}}))
    assert top.each("vanity_top", width_in=36) == 360


@pytest.mark.parametrize("title, with_top", [
    ("36 in. W x 22 in. D Bath Vanity in White with Carrara Marble Top and Ceramic Sink", True),
    ("Vanity Set with Mirror and Top", True),
    ("Sonoma 36 in. Vanity Cabinet Only in Almond", False),
    ("48 in. Vanity in Grey (Top not included)", False),
])
def test_a_vanity_listing_says_whether_its_top_comes_with_it(title, with_top):
    assert sold_with_top(title) is with_top


def test_an_option_with_nothing_picked_prices_from_the_rate_tables(service):
    option = new_job(service, project_type="remodel")
    assert option["selections"] is None
    result = service.calculate(option["id"])
    assert "allowance" in line(result, "Toilet complete")["notes"]
    assert not [w for w in result["warning_flags"] if "picked" in w]


def _png(color):
    import io as _io

    from PIL import Image
    buf = _io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, format="PNG")
    return buf.getvalue()


def _pdf_text_and_images(pdf):
    from pypdf import PdfReader
    reader = PdfReader(pdf)
    return "\n".join(p.extract_text() for p in reader.pages), sum(len(p.images) for p in reader.pages)


def test_the_options_pdfs_show_its_products_and_the_carriers_never_does(service, session):
    from app.domains.tools.modules.bathroom_estimate.export_service import BathroomExportService

    restoration = new_job(service)
    service.calculate(restoration["id"])
    option = service.add_option(restoration["id"])
    toilet = product(session, "toilet", "Kohler Highline Elongated Toilet", 389, brand="Kohler",
                     source_url="https://www.lowes.com/pd/highline", retailer="lowes", image_file_ids=["pic-1"])
    tile = product(session, "floor_tile", "MSI Carrara Marble Tile", 64.80, unit="box", box_sf=12, image_file_ids=["pic-2"])
    service.set_selection(option["id"], "toilet", toilet.id)
    service.set_selection(option["id"], "floor_tile", tile.id)
    service.calculate(option["id"])
    pictures = {"pic-1": _png("white"), "pic-2": _png("grey")}
    export = BathroomExportService()

    text, images = _pdf_text_and_images(export.generate_pdf(service.get_estimate(option["id"]), product_pictures=pictures))
    assert "Selected Products" in text
    assert "Kohler Highline Elongated Toilet" in text and "$389.00 each" in text
    assert "$64.80 per box" in text and "12 sq ft a box" in text
    assert images == 2

    # The restoration's PDF, even if asked with pictures, has none of it
    text, images = _pdf_text_and_images(export.generate_pdf(service.get_estimate(restoration["id"]), product_pictures=pictures))
    assert "Selected Products" not in text and "Kohler" not in text and images == 0

    group = service.get_group(option["id"])
    text, images = _pdf_text_and_images(export.generate_proposal_pdf(group, product_pictures=service.product_pictures(group["members"]) or pictures))
    assert "Products in Each Option" in text and "MSI Carrara Marble Tile" in text
    assert images == 2


def test_product_pictures_come_from_the_options_only(service, session):
    restoration = new_job(service)
    option = service.add_option(restoration["id"])
    toilet = product(session, "toilet", "Kohler Highline", 389, image_file_ids=["missing-file"])
    service.set_selection(option["id"], "toilet", toilet.id)
    # No such stored file: the PDF goes without the picture rather than failing
    assert service.product_pictures([service.get_estimate(option["id"])]) == {}
