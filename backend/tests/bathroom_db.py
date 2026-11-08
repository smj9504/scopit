"""A throwaway SQLite database for the Bathroom Estimator's service tests.

Holds the bathroom, product and price tables plus the company and customer
tables they read; the Postgres-only column types are stood in for by JSON (the
compile rules live in cabinet_db, imported here).
"""
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

import main  # noqa: F401  (registers every model, so the mappers can configure)
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.product_library.models import Product
from app.domains.tools.modules.bathroom_estimate.models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)
from app.domains.unit_prices.models import PriceBook, UnitPriceChange, UnitPriceOverride
from tests.cabinet_db import COMPANY_ID, OTHER_COMPANY_ID  # noqa: F401  (also registers the SQLite type rules)


def make_session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'bath.db'}")
    for model in (Company, Customer, Product, PriceBook, UnitPriceOverride, UnitPriceChange,
                  BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    session.add_all([
        Company(id=COMPANY_ID, name="MJ Co & Sons", city="Rockville", state="MD"),
        Company(id=OTHER_COMPANY_ID, name="Another Co"),
    ])
    session.flush()
    return session
