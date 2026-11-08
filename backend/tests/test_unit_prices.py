"""Company prices for the Bathroom and Cabinet Estimators, and price books.

The defaults stay in pricing.py. A company can set its own material and
labor for any price; an estimate is pinned to the prices it was first
priced with, so neither a company edit nor a default update moves it until
someone asks for today's prices. Ported from MJ Estimate's tests (its
"moving a job to another company" case has no Scopit counterpart: a Scopit
estimate never changes company). On a throwaway SQLite database."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.product_library.models import Product
from app.domains.tools.modules.bathroom_estimate import pricing as bath_pricing
from app.domains.tools.modules.bathroom_estimate.calculator import calculate_estimate as bath_calculate
from app.domains.tools.modules.bathroom_estimate.models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from app.domains.tools.modules.bathroom_estimate.schemas import BathroomEstimateCreate
from app.domains.tools.modules.bathroom_estimate.service import BathroomEstimateService
from app.domains.tools.modules.cabinet_estimate import pricing as cab_pricing
from app.domains.tools.modules.cabinet_estimate.models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
    CabinetSketch,
)
from app.domains.tools.modules.cabinet_estimate.schemas import CabinetBoxCreate, CabinetEstimateCreate
from app.domains.tools.modules.cabinet_estimate.service import CabinetEstimateService
from app.domains.unit_prices import catalog
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride
from app.domains.unit_prices.service import UnitPriceError, UnitPriceService, values_hash
from app.domains.unit_prices.tables import PriceDict, material_share, use_prices
from tests.cabinet_db import COMPANY_ID, OTHER_COMPANY_ID  # also registers the SQLite type rules

COMPANY = COMPANY_ID
OTHER_COMPANY = OTHER_COMPANY_ID


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'prices.db'}")
    for model in (
        Company, Customer, Product, PriceBook, UnitPriceOverride, UnitPriceChange,
        BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory,
        CabinetEstimate, CabinetBox, CabinetEstimateLineItem, CabinetEstimateHistory, CabinetSketch,
    ):
        model.__table__.create(engine)
    s = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    s.add_all([Company(id=COMPANY, name="Our Co"), Company(id=OTHER_COMPANY, name="Other Co")])
    s.flush()
    yield s
    s.close()


@pytest.fixture
def prices(session):
    return UnitPriceService(session)


@pytest.fixture
def bath(session):
    return BathroomEstimateService(session, COMPANY)


@pytest.fixture
def kitchen(session):
    return CabinetEstimateService(session, COMPANY)


def bath_job(service, project_type="insurance"):
    return service.create_estimate(BathroomEstimateCreate(
        project_type=project_type,
        property_address="12 Elm St", city="Rockville", state="MD", zip_code="20850",
        designation="hall", bath_function="full",
        length_ft=8, width_ft=6, floor_sf=40, wall_sf=600, height_ft=8,
        walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
        replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic"},
    ))


BOXES = [
    CabinetBoxCreate(code="B30", cab_type="base", width_inches=30, height_inches=34.5),
    CabinetBoxCreate(code="SB36", cab_type="base", width_inches=36, height_inches=34.5,
                     is_specialty=True, specialty_type="sink_base"),
    CabinetBoxCreate(code="W3030", cab_type="wall", width_inches=30, height_inches=30),
]


def kitchen_job(service, **fields):
    data = dict(
        project_type="insurance",
        property_address="12 Elm St", zip_code="20850", tier="Stock", boxes=BOXES,
        include_countertop=True, countertop_material="Quartz", countertop_sqft=40,
        include_plumbing=True, include_toe_kick=True,
    )
    data.update(fields)
    return service.create_estimate(CabinetEstimateCreate(**data))


def line(estimate, starts):
    found = [li for li in estimate["line_items"] if li["description"].startswith(starts)]
    assert found, f"no line starting {starts!r}"
    return found[0]


# ── What is a price ──

def _code_figure(domain, key):
    d = catalog.get_domain(domain)
    if "." not in key:
        return dict.__getitem__(d.flat, key)
    first, *rest = key.split(".")
    node = d.tables[first]
    for part in rest:
        node = dict.__getitem__(node, part if dict.__contains__(node, part) else int(part))
    return node


@pytest.mark.parametrize("domain", ["bathroom", "cabinet"])
def test_every_default_split_adds_back_up_to_the_code_figure(domain):
    items = catalog.get_domain(domain).items()
    assert items, domain
    for item in items:
        assert item.total == pytest.approx(_code_figure(domain, item.key)), item.key
        assert item.kind in catalog.KINDS
        if item.kind == catalog.MATERIAL:
            assert item.labor == 0, item.key
        if item.kind == catalog.LABOR:
            assert item.material == 0, item.key


@pytest.mark.parametrize("domain", ["bathroom", "cabinet"])
def test_multipliers_waste_tax_and_shares_are_not_prices(domain):
    for spec in catalog.get_domain(domain).specs:
        assert not any(word in spec.name for word in ("MULTIPLIER", "SHARE", "WASTE", "TAX", "SCALE", "ZIP")), spec.name
    keys = {item.key for item in catalog.get_domain(domain).items()}
    assert not any("waste_factor" in key or key.endswith(".visits") for key in keys)


def test_a_price_table_reads_its_defaults_until_a_book_is_active():
    table = bath_pricing.DEMO_RATES
    assert isinstance(table, PriceDict) and isinstance(table, dict)
    assert table["floor_tile_per_sf"] == 3.25
    with use_prices({"DEMO_RATES.floor_tile_per_sf": [1.0, 4.0]}):
        assert table["floor_tile_per_sf"] == 5.0
        assert table.get("floor_tile_per_sf") == 5.0
        assert dict(table.items())["floor_tile_per_sf"] == 5.0
        assert material_share("DEMO_RATES.floor_tile_per_sf", 0.0) == 0.2
        # Nested tables and the flat constants answer too
        assert bath_pricing.VANITY_PRICES["stock_rta"][36] == 551
        assert bath_pricing.FLAT_PRICES["VANITY_INSTALL"] == 589
    assert table["floor_tile_per_sf"] == 3.25
    with use_prices({"VANITY_PRICES.stock_rta.36": [600, 0], "VANITY_INSTALL": [0, 650]}):
        assert bath_pricing.VANITY_PRICES["stock_rta"][36] == 600
        assert bath_pricing.FLAT_PRICES["VANITY_INSTALL"] == 650


def test_the_migration_stores_books_the_app_reuses():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "add_unit_prices.py"
    spec = importlib.util.spec_from_file_location("price_book_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    for domain in ("bathroom", "cabinet"):
        defaults = catalog.get_domain(domain).default_values()
        assert migration._values_hash(migration._default_values(domain)) == values_hash(defaults)


# ── Defaults price as before ──

def test_a_default_book_prices_a_bathroom_exactly_as_the_code_does():
    estimate = BathroomEstimate(
        property_address="12 Elm St", state="MD", zip_code="20850",
        length_ft=8, width_ft=6, floor_sf=40, wall_sf=600, height_ft=8,
        walls_spec={"wall_finish": "paint", "paint_grade": "mid"},
        replace_tub=True, bathtub_spec={"type": "alcove", "material": "acrylic"},
    )
    plain = bath_calculate(estimate)
    with use_prices(catalog.get_domain("bathroom").default_values()):
        booked = bath_calculate(estimate)
    assert booked == plain


def test_a_default_book_prices_a_kitchen_exactly_as_the_code_does():
    from app.domains.tools.modules.cabinet_estimate.calculator import BoxInput, calculate_estimate

    boxes = [
        BoxInput(code=b.code, cab_type=b.cab_type, location="perimeter", width_inches=b.width_inches,
                 height_inches=b.height_inches, is_specialty=b.is_specialty,
                 specialty_type=b.specialty_type, has_glass_door=False, qty=1)
        for b in BOXES
    ]
    options = dict(
        tier="Semi-Custom", zip_code="20815", include_plumbing=True, include_painting=True,
        painting_sqft=80, include_countertop=True, countertop_material="Granite", countertop_sqft=40,
        include_backsplash=True, backsplash_type="glass_tile", backsplash_sqft=30,
        include_appliance_rr=True, appliance_list=[{"type": "dishwasher", "qty": 1}],
        include_drywall_repair=True, drywall_repair_sqft=20, include_electrical=True,
        outlet_relocation_count=2, filler_count=2, dishwasher_return_panel_count=1,
    )
    plain = calculate_estimate(boxes, **options)
    with use_prices(catalog.get_domain("cabinet").default_values()):
        booked = calculate_estimate(boxes, **options)
    assert booked == plain


# ── A company's prices ──

def test_a_company_price_prices_new_estimates_and_leaves_pinned_ones(session, bath, prices):
    first = bath_job(bath)
    before = bath.calculate(first["id"])
    assert before["price_book"]["is_current"] is True

    prices.save("bathroom", COMPANY, {"BATHTUB_INSTALL.alcove": {"labor": 1500}})

    # Already priced: still its own prices, even when recalculated
    again = bath.calculate(first["id"])
    assert again["total"] == before["total"]
    assert again["price_book"]["is_current"] is False

    # A new job of the company's takes the company's price
    second = bath.calculate(bath_job(bath)["id"])
    assert second["total"] > before["total"]
    # Another company's job doesn't
    theirs = BathroomEstimateService(session, OTHER_COMPANY)
    other = theirs.calculate(bath_job(theirs)["id"])
    assert other["total"] == before["total"]

    # Asked for, the first job moves to today's prices
    moved = bath.use_current_prices(first["id"])
    assert moved["total"] == second["total"]
    assert moved["price_book"]["is_current"] is True


def test_an_option_is_priced_with_its_jobs_prices(bath, prices):
    restore = bath_job(bath)
    priced = bath.calculate(restore["id"])
    prices.save("bathroom", COMPANY, {"PAINT_RATES.wall_per_sf": {"material": 3, "labor": 9}})
    option = bath.add_option(restore["id"])
    option_priced = bath.calculate(option["id"])
    # Same scope, same book: the option didn't pick up the newer price
    assert option_priced["total"] == priced["total"]


def test_using_current_prices_reprices_the_whole_job(bath, prices):
    restore = bath_job(bath)
    bath.calculate(restore["id"])
    option = bath.add_option(restore["id"])
    bath.calculate(option["id"])
    prices.save("bathroom", COMPANY, {"BATHTUB_INSTALL.alcove": {"labor": 1500}})

    bath.use_current_prices(restore["id"])
    for member in (restore, option):
        repriced = bath.get_estimate(member["id"])
        assert repriced["price_book"]["is_current"] is True


def test_a_clone_starts_a_new_job_on_todays_prices(bath, prices):
    job = bath_job(bath)
    priced = bath.calculate(job["id"])
    prices.save("bathroom", COMPANY, {"BATHTUB_INSTALL.alcove": {"labor": 1500}})
    clone = bath.clone_estimate(job["id"])
    assert clone["price_book"] is None
    assert bath.calculate(clone["id"])["total"] > priced["total"]


def test_a_kitchen_is_pinned_and_repriced_the_same_way(kitchen, prices):
    job = kitchen_job(kitchen)
    before = kitchen.calculate(job["id"])
    prices.save("cabinet", COMPANY, {"BASE_RATES.Stock.base_lf": {"material": 400}})
    again = kitchen.calculate(job["id"])
    assert again["total"] == before["total"]
    assert again["price_book"]["is_current"] is False
    moved = kitchen.use_current_prices(job["id"])
    assert moved["total"] > before["total"]
    assert moved["price_book"]["is_current"] is True


def test_a_company_split_carries_into_the_kitchen_lines(kitchen, prices):
    prices.save("cabinet", COMPANY, {"SCOPE_ITEMS.toe_kick_per_lf": {"material": 2, "labor": 8}})
    priced = kitchen.calculate(kitchen_job(kitchen)["id"])
    toe = line(priced, "Toe Kick")
    assert toe["material_total"] == pytest.approx(toe["total"] * 0.2, abs=0.02)
    # 10/LF with no O&P on a new job, the default being 10 as well: only the split moved
    assert toe["unit_price"] == pytest.approx(10, abs=0.01)


def test_a_company_appliance_and_sink_price_reach_the_kitchen(kitchen, prices):
    job = kitchen_job(kitchen, include_appliance_rr=True, appliance_list=[{"type": "dishwasher", "qty": 1}])
    base = kitchen.calculate(job["id"])
    prices.save("cabinet", COMPANY, {
        "APPLIANCE_RESET_PRICES.INSURANCE_DR.dishwasher": {"labor": 500},
        "SINK_PRICES.36.single": {"material": 999},
    })
    fresh = kitchen.calculate(kitchen_job(
        kitchen, include_appliance_rr=True, appliance_list=[{"type": "dishwasher", "qty": 1}])["id"])
    assert line(fresh, "Detach & Reset Appliances")["unit_price"] == pytest.approx(500, abs=0.01)
    assert line(fresh, "Undermount SS Single Bowl Sink")["unit_price"] == pytest.approx(999, abs=0.01)
    assert line(base, "Detach & Reset Appliances")["unit_price"] != line(fresh, "Detach & Reset Appliances")["unit_price"]


def test_saving_checks_the_side_and_records_who_changed_what(prices, session):
    with pytest.raises(UnitPriceError):
        prices.save("bathroom", COMPANY, {"VANITY_PRICES.stock_rta.36": {"labor": 50}})  # material only
    with pytest.raises(UnitPriceError):
        prices.save("bathroom", COMPANY, {"VANITY_INSTALL": {"material": 50}})  # labor only
    with pytest.raises(UnitPriceError):
        prices.save("bathroom", COMPANY, {"VANITY_INSTALL": {"labor": -5}})
    with pytest.raises(UnitPriceError):
        prices.save("bathroom", COMPANY, {"NOT_A_TABLE.x": {"labor": 5}})

    listed = prices.save("bathroom", COMPANY, {"PLUMBING_RATES.shutoff_valve_each": {"material": 80}})
    row = next(i for i in listed["items"] if i["key"] == "PLUMBING_RATES.shutoff_valve_each")
    assert row["material"] == 80 and row["labor"] is None
    # The labor side still follows the default
    values = prices.effective_values("bathroom", COMPANY)
    assert values["PLUMBING_RATES.shutoff_valve_each"] == (80, row["default_labor"])

    prices.save("bathroom", COMPANY, {"PLUMBING_RATES.shutoff_valve_each": {"material": None}})
    assert session.query(UnitPriceOverride).count() == 0
    history = prices.history("bathroom", COMPANY)
    assert [(h["old_material"], h["new_material"]) for h in history] == [(80, None), (None, 80)]


def test_one_companys_prices_are_its_own(prices):
    prices.save("bathroom", COMPANY, {"VANITY_INSTALL": {"labor": 700}})
    ours = {i["key"]: i for i in prices.price_list("bathroom", COMPANY)["items"]}
    theirs = {i["key"]: i for i in prices.price_list("bathroom", OTHER_COMPANY)["items"]}
    assert ours["VANITY_INSTALL"]["labor"] == 700
    assert theirs["VANITY_INSTALL"]["labor"] is None
    assert prices.history("bathroom", OTHER_COMPANY) == []


def test_the_same_prices_are_stored_once(prices):
    a = prices.current_book("cabinet", COMPANY)
    b = prices.current_book("cabinet", OTHER_COMPANY)
    assert a.id == b.id  # neither company has prices of its own
    prices.save("cabinet", COMPANY, {"BASE_RATES.Stock.base_lf": {"material": 250}})
    c = prices.current_book("cabinet", COMPANY)
    assert c.id != a.id
    assert c.prices["BASE_RATES.Stock.base_lf"] == [250, 0]
    assert cab_pricing.BASE_RATES["Stock"]["base_lf"] == 200  # the default is untouched


def test_the_form_quotes_the_estimates_own_prices(kitchen, prices):
    from app.domains.tools.modules.cabinet_estimate.api import _pricing_info
    from app.domains.unit_prices.tables import resolved

    job = kitchen_job(kitchen)
    prices.save("cabinet", COMPANY, {
        "APPLIANCE_RESET_PRICES.INSURANCE_DR.dishwasher": {"labor": 500},
        "ISLAND_PANEL_PRICING.install_per_sf": {"labor": 20},
    })
    estimate = kitchen.find(job["id"])
    with use_prices(prices.prices_for("cabinet", estimate)):
        info = resolved(_pricing_info())
    assert info["appliance_rr_pricing"]["dishwasher"]["cost"] == 500
    assert info["island_panel_pricing"]["install_per_sf"] == 20
    # Not yet priced, so nothing was pinned by looking
    assert estimate.price_book_id is None
    # Without an estimate: the defaults
    assert resolved(_pricing_info())["island_panel_pricing"]["install_per_sf"] == 13
