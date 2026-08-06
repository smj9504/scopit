"""
Scopit - Estimate Models
"""
from sqlalchemy import Column, String, Text, Boolean, ForeignKey, Integer, DECIMAL, Date, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB
import enum

from app.core.database import Base
from app.common.utils import generate_uuid


class EstimateStatus(str, enum.Enum):
    """Estimate status options (legacy enum - kept for backward compatibility)"""
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    APPROVED = "approved"
    DECLINED = "declined"
    EXPIRED = "expired"
    CONVERTED = "converted"


class Estimate(Base):
    __tablename__ = "estimates"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"))

    # Estimate Info
    estimate_number = Column(String(50), nullable=False)
    # Legacy status column (kept for backward compatibility during migration)
    status = Column(SQLEnum(EstimateStatus), nullable=True, default=EstimateStatus.DRAFT)
    # New status_id column (FK to EstimateStatusConfig)
    status_id = Column(UUID(as_uuid=True), ForeignKey("estimate_status_configs.id", ondelete="SET NULL"))
    
    # Dates
    estimate_date = Column(Date, nullable=False, server_default=func.current_date())
    valid_until = Column(Date)
    sent_at = Column(TIMESTAMP(timezone=True))
    viewed_at = Column(TIMESTAMP(timezone=True))
    approved_at = Column(TIMESTAMP(timezone=True))
    declined_at = Column(TIMESTAMP(timezone=True))
    
    # Amounts (Calculated)
    subtotal = Column(DECIMAL(15, 2), nullable=False, default=0)
    taxable_subtotal = Column(DECIMAL(15, 2), nullable=False, default=0)
    adjustments_total = Column(DECIMAL(15, 2), nullable=False, default=0)  # Net of premiums - discounts
    tax_rate = Column(DECIMAL(5, 3))
    tax_label = Column(String(50))
    tax_amount = Column(DECIMAL(15, 2), nullable=False, default=0)
    discount_amount = Column(DECIMAL(15, 2), nullable=False, default=0)  # Legacy field
    total = Column(DECIMAL(15, 2), nullable=False, default=0)
    amount_paid = Column(DECIMAL(15, 2), nullable=False, default=0)
    balance_due = Column(DECIMAL(15, 2), nullable=False, default=0)
    
    # Content
    title = Column(String(255))
    description = Column(Text)
    notes = Column(Text)
    terms = Column(Text)
    
    # Customer Info Snapshot
    customer_name = Column(String(255))
    customer_email = Column(String(255))
    customer_address = Column(Text)
    
    # Conversion
    converted_to_invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id"))
    converted_at = Column(TIMESTAMP(timezone=True))
    
    # Audit
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
    
    # Relationships
    company = relationship("Company", back_populates="estimates")
    customer = relationship("Customer", back_populates="estimates")
    status_config = relationship("EstimateStatusConfig", lazy="joined")
    sections = relationship(
        "EstimateSection",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimateSection.order_index",
        lazy="selectin"
    )
    items = relationship(
        "EstimateItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimateItem.order_index",
        lazy="selectin"
    )
    payments = relationship(
        "EstimatePayment",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimatePayment.created_at.desc()",
        lazy="selectin"
    )
    adjustments = relationship(
        "EstimateAdjustment",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimateAdjustment.order_index",
        lazy="selectin"
    )


class EstimateSection(Base):
    """Estimate sections for grouping items"""
    __tablename__ = "estimate_sections"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Parent relation
    estimate_id = Column(UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="CASCADE"), nullable=False)
    
    # Section Info
    name = Column(String(255), nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    is_collapsed = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    estimate = relationship("Estimate", back_populates="sections")
    items = relationship(
        "EstimateItem",
        back_populates="section",
        order_by="EstimateItem.order_index",
        lazy="selectin"
    )
    
    @property
    def subtotal(self) -> float:
        """Calculate section subtotal"""
        return sum(item.total for item in self.items)


class EstimateItem(Base):
    __tablename__ = "estimate_items"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    estimate_id = Column(UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="CASCADE"), nullable=False)
    section_id = Column(UUID(as_uuid=True), ForeignKey("estimate_sections.id", ondelete="SET NULL"))
    line_item_id = Column(UUID(as_uuid=True), ForeignKey("line_items.id", ondelete="SET NULL"))  # Reference (optional)

    # Item Info (Snapshot)
    code = Column(String(50))
    name = Column(String(255), nullable=False)
    description = Column(Text)
    unit = Column(String(50))

    # Amounts
    quantity = Column(DECIMAL(15, 4), nullable=False, default=1)
    unit_price = Column(DECIMAL(15, 2), nullable=False, default=0)
    total = Column(DECIMAL(15, 2), nullable=False, default=0)  # quantity * unit_price

    # Tax
    is_taxable = Column(Boolean, nullable=False, default=True)

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Notes (JSON array)
    notes = Column(JSONB, default=[])

    # Images (base64 encoded)
    # Format: [{"filename": "photo1.jpg", "data": "data:image/jpeg;base64,..."}]
    images = Column(JSONB, default=[])

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    estimate = relationship("Estimate", back_populates="items")
    section = relationship("EstimateSection", back_populates="items")


class AdjustmentType(str, enum.Enum):
    """Adjustment type options"""
    PREMIUM = "premium"   # Add percentage (e.g., Holiday Premium +10%)
    DISCOUNT = "discount" # Subtract percentage (e.g., Discount -5%)


class PaymentMethod(str, enum.Enum):
    """Payment method options"""
    CASH = "cash"
    CHECK = "check"
    CREDIT_CARD = "credit_card"
    BANK_TRANSFER = "bank_transfer"
    OTHER = "other"


class EstimatePayment(Base):
    """Payments recorded against an estimate"""
    __tablename__ = "estimate_payments"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    estimate_id = Column(UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="CASCADE"), nullable=False)

    # Payment Info
    amount = Column(DECIMAL(15, 2), nullable=False)
    payment_method = Column(SQLEnum(PaymentMethod), nullable=True, default=PaymentMethod.OTHER)
    payment_date = Column(Date, nullable=True)  # Optional date

    # Reference
    reference_number = Column(String(100))
    notes = Column(Text)

    # Audit
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    estimate = relationship("Estimate", back_populates="payments")


class EstimateAdjustment(Base):
    """Adjustments (premiums/discounts) for estimates"""
    __tablename__ = "estimate_adjustments"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    estimate_id = Column(UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="CASCADE"), nullable=False)

    # Adjustment Info
    type = Column(SQLEnum(AdjustmentType), nullable=False)  # premium or discount
    name = Column(String(255), nullable=False)  # e.g., "Holiday Premium", "Volume Discount"
    percentage = Column(DECIMAL(5, 2), nullable=False)  # e.g., 10.00 = 10%
    amount = Column(DECIMAL(15, 2), nullable=False, default=0)  # Calculated: subtotal * percentage / 100

    # Order
    order_index = Column(Integer, nullable=False, default=0)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    estimate = relationship("Estimate", back_populates="adjustments")
