"""A throwaway SQLite database for the Cabinet Estimator's service tests.

Holds the cabinet, product and price tables plus the company and customer
tables they read; the Postgres-only column types are stood in for by JSON.
"""
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

import main  # noqa: F401  (registers every model, so the mappers can configure)
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.product_library.models import Product
from app.domains.tools.modules.cabinet_estimate.models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
    CabinetSketch,
)
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride

COMPANY_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_COMPANY_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(type_, compiler, **kw):
    return "JSON"


# SQLite gives a column named "UUID" numeric affinity, which turns an
# all-digit hex id into a number; CHAR keeps it text.
@compiles(UUID, "sqlite")
def _uuid_on_sqlite(type_, compiler, **kw):
    return "CHAR(32)"


@compiles(ARRAY, "sqlite")
def _array_on_sqlite(type_, compiler, **kw):
    return "JSON"


def make_session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'kitchen.db'}")
    for model in (Company, Customer, Product, PriceBook, UnitPriceOverride, UnitPriceChange,
                  CabinetEstimate, CabinetBox, CabinetEstimateLineItem, CabinetEstimateHistory, CabinetSketch):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    session.add_all([
        Company(id=COMPANY_ID, name="MJ Co & Sons", city="Fairfax", state="VA"),
        Company(id=OTHER_COMPANY_ID, name="Another Co"),
    ])
    session.flush()
    return session
