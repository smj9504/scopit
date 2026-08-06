"""
Scopit - Line Item Models
"""
from sqlalchemy import Column, String, Text, Boolean, ForeignKey, Integer, DECIMAL, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
import enum

from app.core.database import Base
from app.common.utils import generate_uuid


class LineItemVisibility(str, enum.Enum):
    """Line item visibility options"""
    COMPANY = "company"   # Visible to all company users
    PRIVATE = "private"   # Only visible to creator


class LineItem(Base):
    __tablename__ = "line_items"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Basic Info
    code = Column(String(50))                               # Item code (optional)
    name = Column(String(255), nullable=False)              # Item name
    includes = Column(Text)                                 # Detailed description
    
    # Pricing
    unit = Column(String(50))                               # EA, SF, LF, HR, DAY
    unit_price = Column(DECIMAL(15, 2), nullable=False, default=0)
    
    # Categorization
    cat = Column(String(50))                                # Category: Water Damage, Fire, Mold
    
    # Tax
    is_taxable = Column(Boolean, nullable=False, default=True)
    tax_class = Column(String(50))                          # Phase 2
    
    # Ownership
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    visibility = Column(SQLEnum(LineItemVisibility), nullable=False, default=LineItemVisibility.PRIVATE)
    
    # Tool ownership (non-null = managed by a tool, hidden from general line items)
    tool_id = Column(String(50), nullable=True, index=True)  # e.g. "packing"

    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
    
    # Relationships
    company = relationship("Company", back_populates="line_items")
    notes = relationship(
        "LineItemNote",
        back_populates="line_item",
        cascade="all, delete-orphan",
        order_by="LineItemNote.order_index"
    )


class LineItemNote(Base):
    __tablename__ = "line_item_notes"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Parent relation
    line_item_id = Column(UUID(as_uuid=True), ForeignKey("line_items.id", ondelete="CASCADE"), nullable=False)
    
    # Content
    content = Column(Text, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    line_item = relationship("LineItem", back_populates="notes")
