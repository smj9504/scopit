"""The company price screen's API, and the estimate endpoints that read
prices: who may see and change a company's prices, what a save accepts, and
that an estimate's prices are only quoted or repriced for its own company.
The routers alone, on a throwaway SQLite database."""
import uuid

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.tools.modules.bathroom_estimate import api as bathroom_api
from app.domains.tools.modules.bathroom_estimate.models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from app.domains.tools.service import ToolAccessService
from app.domains.unit_prices.api import router
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride
from app.domains.user.models import User
from tests.cabinet_db import COMPANY_ID, OTHER_COMPANY_ID  # also registers the SQLite type rules


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(
        f"sqlite:///{tmp_path / 'api.db'}", connect_args={"check_same_thread": False},
    )
    for model in (
        Company, User, Customer, PriceBook, UnitPriceOverride, UnitPriceChange,
        BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory,
    ):
        model.__table__.create(engine)
    s = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    s.add_all([Company(id=COMPANY_ID, name="Ours"), Company(id=OTHER_COMPANY_ID, name="Theirs")])
    s.commit()
    yield s
    s.close()


def user(session, role="manager", company_id=COMPANY_ID, name="Pat Lee"):
    row = User(
        id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:8]}@example.com", full_name=name,
        company_id=company_id, role=role, is_active=True,
    )
    session.add(row)
    session.commit()
    return row


def client_as(session, who):
    app = FastAPI()
    app.include_router(router, prefix="/api/unit-prices")
    app.include_router(bathroom_api.router, prefix="/api/tools/bathroom-estimate")

    def _db():
        yield session

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: who
    return TestClient(app)


def item(listing, key):
    return next(i for i in listing["items"] if i["key"] == key)


def test_a_manager_prices_the_company_and_the_change_is_recorded(session):
    client = client_as(session, user(session, role="manager", name="Pat Lee"))

    listed = client.get("/api/unit-prices/bathroom")
    assert listed.status_code == 200
    body = listed.json()
    assert body["can_edit"] is True
    vanity = item(body, "VANITY_INSTALL")
    assert (vanity["kind"], vanity["default_labor"], vanity["labor"]) == ("labor", 589, None)

    saved = client.put("/api/unit-prices/bathroom", json={"prices": {"VANITY_INSTALL": {"labor": 700}}})
    assert saved.status_code == 200
    assert saved.json()["can_edit"] is True
    vanity = item(saved.json(), "VANITY_INSTALL")
    assert (vanity["labor"], vanity["updated_by"]) == (700, "Pat Lee")

    history = client.get("/api/unit-prices/bathroom/history").json()
    assert [(h["key"], h["new_labor"], h["changed_by"]) for h in history] == [("VANITY_INSTALL", 700, "Pat Lee")]


def test_staff_see_the_prices_but_cannot_change_them(session):
    client = client_as(session, user(session, role="staff"))
    listed = client.get("/api/unit-prices/cabinet")
    assert listed.status_code == 200
    assert listed.json()["can_edit"] is False
    refused = client.put("/api/unit-prices/cabinet", json={"prices": {"BASE_RATES.Stock.base_lf": {"material": 1}}})
    assert refused.status_code == 403
    assert session.query(UnitPriceOverride).count() == 0


def test_a_company_sees_only_its_own_prices(session):
    client_as(session, user(session, role="admin")).put(
        "/api/unit-prices/bathroom", json={"prices": {"VANITY_INSTALL": {"labor": 700}}},
    )
    theirs = client_as(session, user(session, role="admin", company_id=OTHER_COMPANY_ID))
    assert item(theirs.get("/api/unit-prices/bathroom").json(), "VANITY_INSTALL")["labor"] is None
    assert theirs.get("/api/unit-prices/bathroom/history").json() == []


def test_a_bad_save_is_refused_and_leaves_nothing_behind(session):
    client = client_as(session, user(session, role="admin"))
    wrong_side = client.put("/api/unit-prices/cabinet", json={"prices": {
        "SCOPE_ITEMS.demo_per_lf": {"labor": 30},       # fine on its own
        "BASE_RATES.Stock.base_lf": {"labor": 50},      # material only
    }})
    assert wrong_side.status_code == 400
    assert session.query(UnitPriceOverride).count() == 0
    assert session.query(UnitPriceChange).count() == 0

    unknown_field = client.put("/api/unit-prices/cabinet",
                               json={"prices": {"BASE_RATES.Stock.base_lf": {"price": 50}}})
    assert unknown_field.status_code == 422
    negative = client.put("/api/unit-prices/cabinet",
                          json={"prices": {"BASE_RATES.Stock.base_lf": {"material": -1}}})
    assert negative.status_code == 400
    assert client.get("/api/unit-prices/plumbing").status_code == 404


def test_a_price_list_needs_its_tool(session, monkeypatch):
    monkeypatch.setattr(ToolAccessService, "can_access_tool",
                        lambda self, tool_id, who: tool_id == "cabinet_estimate")
    client = client_as(session, user(session, role="admin"))
    assert [d["key"] for d in client.get("/api/unit-prices/domains").json()] == ["cabinet"]
    assert client.get("/api/unit-prices/bathroom").status_code == 403
    assert client.get("/api/unit-prices/cabinet").status_code == 200


def _priced_bathroom(client):
    created = client.post("/api/tools/bathroom-estimate", json={
        "project_type": "insurance", "property_address": "12 Elm St", "state": "MD", "zip_code": "20850",
        "length_ft": 8, "width_ft": 6, "floor_sf": 40, "wall_sf": 600, "height_ft": 8,
        "replace_tub": True, "bathtub_spec": {"type": "alcove", "material": "acrylic"},
    })
    assert created.status_code == 200, created.text
    estimate_id = created.json()["id"]
    assert client.post(f"/api/tools/bathroom-estimate/{estimate_id}/calculate").status_code == 200
    return estimate_id


def test_an_estimate_is_quoted_and_repriced_at_its_own_companys_prices(session):
    ours = client_as(session, user(session, role="admin"))
    estimate_id = _priced_bathroom(ours)
    before = ours.get(f"/api/tools/bathroom-estimate/{estimate_id}").json()
    assert before["price_book"]["is_current"] is True

    ours.put("/api/unit-prices/bathroom", json={"prices": {"PLUMBING_RATES.tub_faucet_install": {"labor": 900}}})
    stale = ours.get(f"/api/tools/bathroom-estimate/{estimate_id}").json()
    assert stale["price_book"]["is_current"] is False
    # The form still quotes the prices the estimate is priced with
    quoted = ours.get("/api/tools/bathroom-estimate/pricing-info", params={"estimate_id": estimate_id}).json()
    assert quoted["plumbing_rates"]["tub_faucet_install"] != 900

    moved = ours.post(f"/api/tools/bathroom-estimate/{estimate_id}/use-current-prices")
    assert moved.status_code == 200
    assert moved.json()["price_book"]["is_current"] is True
    quoted = ours.get("/api/tools/bathroom-estimate/pricing-info", params={"estimate_id": estimate_id}).json()
    assert quoted["plumbing_rates"]["tub_faucet_install"] == 900

    # Another company can neither read its prices nor reprice it
    theirs = client_as(session, user(session, role="admin", company_id=OTHER_COMPANY_ID))
    assert theirs.get("/api/tools/bathroom-estimate/pricing-info",
                      params={"estimate_id": estimate_id}).status_code == 404
    assert theirs.post(f"/api/tools/bathroom-estimate/{estimate_id}/use-current-prices").status_code == 404
    # Without an estimate the form shows the defaults
    defaults = theirs.get("/api/tools/bathroom-estimate/pricing-info").json()
    assert defaults["plumbing_rates"]["tub_faucet_install"] != 900
