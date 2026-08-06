"""
Scopit - Invoice Models
"""
from sqlalchemy import Column, String, Text, Boolean, ForeignKey, Integer, DECIMAL, Date, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB
import enum

from app.core.database import Base
from app.common.utils import generate_uuid


class InvoiceStatus(str, enum.Enum):
    """Invoice status options (legacy enum - kept for backward compatibility)"""
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELED = "canceled"
    REFUNDED = "refunded"


class PaymentMethod(str, enum.Enum):
    """Payment method options"""
    CASH = "cash"
    CHECK = "check"
    CREDIT_CARD = "credit_card"
    BANK_TRANSFER = "bank_transfer"
    OTHER = "other"


class Invoice(Base):
    __tablename__ = "invoices"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Relations
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"))
    estimate_id = Column(UUID(as_uuid=True), ForeignKey("estimates.id", ondelete="SET NULL"))  # If converted
    
    # Invoice Info
    invoice_number = Column(String(50), nullable=False)
    # Legacy status column (kept for backward compatibility during migration)
    status = Column(SQLEnum(InvoiceStatus), nullable=True, default=InvoiceStatus.DRAFT)
    # New status_id column (FK to InvoiceStatusConfig)
    status_id = Column(
        UUID(as_uuid=True),
        ForeignKey("invoice_status_configs.id", ondelete="SET NULL")
    )
    
    # Dates
    invoice_date = Column(Date, nullable=False, server_default=func.current_date())
    due_date = Column(Date)
    sent_at = Column(TIMESTAMP(timezone=True))
    viewed_at = Column(TIMESTAMP(timezone=True))
    paid_at = Column(TIMESTAMP(timezone=True))
    
    # Amounts
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

    # Payment Schedule (milestone-based installments)
    # Format: [{"label": "Deposit", "percentage": 50, "amount": 2500.00, "due_description": "Due upon signing"}, ...]
    payment_schedule = Column(JSONB, default=None)

    # Company Info Override (for tool-generated invoices)
    # Format: {"name": "...", "address": "...", "phone": "...", "email": "...", "license": "..."}
    company_override = Column(JSONB, default=None)

    # Customer Info Snapshot
    customer_name = Column(String(255))
    customer_email = Column(String(255))
    customer_address = Column(Text)
    
    # Audit
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
    
    # Relationships
    company = relationship("Company", back_populates="invoices")
    customer = relationship("Customer", back_populates="invoices")
    status_config = relationship("InvoiceStatusConfig", lazy="joined")
    sections = relationship(
        "InvoiceSection",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceSection.order_index",
        lazy="selectin"
    )
    items = relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceItem.order_index",
        lazy="selectin"
    )
    payments = relationship(
        "Payment",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="Payment.payment_date.desc()",
        lazy="selectin"
    )
    adjustments = relationship(
        "InvoiceAdjustment",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceAdjustment.order_index",
        lazy="selectin"
    )


class InvoiceSection(Base):
    """Invoice sections for grouping items"""
    __tablename__ = "invoice_sections"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Parent relation
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    
    # Section Info
    name = Column(String(255), nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    is_collapsed = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    invoice = relationship("Invoice", back_populates="sections")
    items = relationship(
        "InvoiceItem",
        back_populates="section",
        order_by="InvoiceItem.order_index",
        lazy="selectin"
    )


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Relations
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    section_id = Column(UUID(as_uuid=True), ForeignKey("invoice_sections.id", ondelete="SET NULL"))
    line_item_id = Column(UUID(as_uuid=True), ForeignKey("line_items.id", ondelete="SET NULL"))
    
    # Item Info (Snapshot)
    code = Column(String(50))
    name = Column(String(255), nullable=False)
    description = Column(Text)
    unit = Column(String(50))
    
    # Amounts
    quantity = Column(DECIMAL(15, 4), nullable=False, default=1)
    unit_price = Column(DECIMAL(15, 2), nullable=False, default=0)
    total = Column(DECIMAL(15, 2), nullable=False, default=0)
    
    # Tax
    is_taxable = Column(Boolean, nullable=False, default=True)
    
    # Order
    order_index = Column(Integer, nullable=False, default=0)
    
    # Notes
    notes = Column(JSONB, default=[])

    # Images (base64 encoded)
    # Format: [{"filename": "photo1.jpg", "data": "data:image/jpeg;base64,..."}]
    images = Column(JSONB, default=[])

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    invoice = relationship("Invoice", back_populates="items")
    section = relationship("InvoiceSection", back_populates="items")


class Payment(Base):
    __tablename__ = "payments"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)

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
    invoice = relationship("Invoice", back_populates="payments")


class AdjustmentType(str, enum.Enum):
    """Adjustment type options"""
    PREMIUM = "premium"   # Add percentage (e.g., Holiday Premium +10%)
    DISCOUNT = "discount" # Subtract percentage (e.g., Discount -5%)


class InvoiceAdjustment(Base):
    """Adjustments (premiums/discounts) for invoices"""
    __tablename__ = "invoice_adjustments"

    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Relations
    invoice_id = Column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)

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
    invoice = relationship("Invoice", back_populates="adjustments")
