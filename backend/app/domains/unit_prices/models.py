"""
Scopit - Company prices and the price books estimates are pinned to

For the Bathroom and Cabinet Estimators. Ported from MJ Estimate's
unit_prices; the editor is a Scopit user instead of an MJ staff member.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


def _now() -> datetime:
    # Set here rather than by the database, whose now() is the same for a
    # whole transaction: two changes saved together still read in order
    return datetime.now(timezone.utc)


class UnitPriceOverride(Base):
    """A company's own figure for one price, material and labor apart.

    A side left NULL follows the default, so when the default is updated
    that side moves with it. A price with no row is the default.
    """
    __tablename__ = "unit_price_overrides"
    __table_args__ = (
        UniqueConstraint("company_id", "domain", "price_key", name="uq_unit_price_overrides_key"),
        Index("ix_unit_price_overrides_company_domain", "company_id", "domain"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False,
    )
    # bathroom / cabinet (unit_prices.catalog)
    domain = Column(String(20), nullable=False)
    # Path of the price in its pricing module, e.g. "DEMO_RATES.floor_tile_per_sf"
    price_key = Column(String(200), nullable=False)
    material = Column(Float, nullable=True)
    labor = Column(Float, nullable=True)
    updated_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(TIMESTAMP(timezone=True), default=_now, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), default=_now, server_default=func.now(), onupdate=_now)


class UnitPriceChange(Base):
    """One change to a company price: what it was, what it became, who did it.
    NULL is "the default" on either side."""
    __tablename__ = "unit_price_changes"
    __table_args__ = (
        Index("ix_unit_price_changes_company_domain", "company_id", "domain", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False,
    )
    domain = Column(String(20), nullable=False)
    price_key = Column(String(200), nullable=False)
    old_material = Column(Float, nullable=True)
    old_labor = Column(Float, nullable=True)
    new_material = Column(Float, nullable=True)
    new_labor = Column(Float, nullable=True)
    changed_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(TIMESTAMP(timezone=True), default=_now, server_default=func.now(), nullable=False)


class PriceBook(Base):
    """Every price as an estimate was priced with it, frozen.

    prices is {price_key: [material, labor]} for the whole catalog: the
    defaults with the company's figures over them. An estimate keeps its
    book, so a later default update or company edit doesn't move it. Books
    are shared: the same set of prices is stored once (values_hash), across
    companies, and say nothing about whose they are.
    """
    __tablename__ = "price_books"
    __table_args__ = (
        Index("ix_price_books_domain_hash", "domain", "values_hash"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    domain = Column(String(20), nullable=False)
    prices = Column(JSON, nullable=False)
    values_hash = Column(String(64), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=_now, server_default=func.now(), nullable=False)
