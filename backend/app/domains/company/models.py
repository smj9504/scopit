"""
Scopit - Company Models
"""
from sqlalchemy import DECIMAL, Boolean, Column, Integer, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class Company(Base):
    __tablename__ = "companies"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Basic Info
    name = Column(String(255), nullable=False)
    legal_name = Column(String(255))
    
    # Contact
    email = Column(String(255))
    phone = Column(String(50))
    website = Column(String(255))
    
    # Address
    address_line1 = Column(String(255))
    address_line2 = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))
    country = Column(String(50), default="US")
    
    # Branding
    logo_url = Column(Text)
    primary_color = Column(String(7), default="#111827")
    secondary_color = Column(String(7), nullable=True)  # Optional secondary theme color
    
    # Tax Settings
    default_tax_rate = Column(DECIMAL(5, 3), default=0)
    default_tax_label = Column(String(50), default="Sales Tax")
    
    # Numbering
    estimate_prefix = Column(String(10), default="EST")
    invoice_prefix = Column(String(10), default="INV")
    next_estimate_number = Column(Integer, default=1001)
    next_invoice_number = Column(Integer, default=1001)
    
    # Default Settings
    default_estimate_validity_days = Column(Integer, default=30)
    default_invoice_due_days = Column(Integer, default=30)
    default_notes = Column(Text)
    default_terms = Column(Text)
    
    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
    
    @property
    def full_address(self) -> str:
        """Get formatted full address"""
        parts = [self.address_line1 or ""]
        if self.address_line2:
            parts.append(self.address_line2)
        if self.city or self.state or self.zipcode:
            city_state_zip = []
            if self.city:
                city_state_zip.append(self.city)
            state_zip = " ".join(filter(None, [self.state, self.zipcode]))
            if state_zip:
                city_state_zip.append(state_zip)
            parts.append(", ".join(city_state_zip))
        return ", ".join(p for p in parts if p)

    # Relationships
    users = relationship("User", back_populates="company")
    customers = relationship("Customer", back_populates="company")
    line_items = relationship("LineItem", back_populates="company")
    estimates = relationship("Estimate", back_populates="company")
    invoices = relationship("Invoice", back_populates="company")
    estimate_status_configs = relationship("EstimateStatusConfig", back_populates="company")
    invoice_status_configs = relationship("InvoiceStatusConfig", back_populates="company")
    line_item_categories = relationship("LineItemCategory", back_populates="company")
    line_item_units = relationship("LineItemUnit", back_populates="company")
    # TODO: Uncomment when Subscription model is implemented (Phase 2)
    # subscription = relationship("Subscription", back_populates="company", uselist=False)
