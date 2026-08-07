"""
Scopit - Settings Models
"""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class EstimateStatusConfig(Base):
    """Estimate status configuration"""
    __tablename__ = "estimate_status_configs"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)

    # Status Info
    name = Column(String(50), nullable=False)           # e.g., "draft", "sent", "approved"
    label = Column(String(100), nullable=False)         # e.g., "Draft", "Sent", "Approved"
    color = Column(String(20), nullable=False)          # e.g., "#6b7280"
    bg_color = Column(String(20), nullable=False)       # e.g., "#f3f4f6"

    # Flags
    is_default = Column(Boolean, nullable=False, default=False)
    is_system = Column(Boolean, nullable=False, default=False)  # Cannot be deleted
    is_active = Column(Boolean, nullable=False, default=True)

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="estimate_status_configs")


class InvoiceStatusConfig(Base):
    """Invoice status configuration"""
    __tablename__ = "invoice_status_configs"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)

    # Status Info
    name = Column(String(50), nullable=False)           # e.g., "draft", "sent", "paid"
    label = Column(String(100), nullable=False)         # e.g., "Draft", "Sent", "Paid"
    color = Column(String(20), nullable=False)          # e.g., "#6b7280"
    bg_color = Column(String(20), nullable=False)       # e.g., "#f3f4f6"

    # Flags
    is_default = Column(Boolean, nullable=False, default=False)
    is_system = Column(Boolean, nullable=False, default=False)  # Cannot be deleted
    is_active = Column(Boolean, nullable=False, default=True)

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="invoice_status_configs")


class LineItemCategory(Base):
    """Line item category"""
    __tablename__ = "line_item_categories"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)

    # Category Info
    name = Column(String(100), nullable=False)          # e.g., "Labor", "Materials"
    color = Column(String(20))                          # Optional hex color

    # Flags
    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="line_item_categories")


class LineItemUnit(Base):
    """Line item unit"""
    __tablename__ = "line_item_units"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)

    # Unit Info
    name = Column(String(50), nullable=False)          # e.g., "EA", "SF", "LF", "HR", "DAY"
    label = Column(String(100))                        # Optional display label e.g., "EA (Each)"

    # Flags
    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="line_item_units")
