"""
Scopit - Customer Models
"""
from sqlalchemy import Boolean, Column, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class Customer(Base):
    __tablename__ = "customers"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Company relation
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    
    # Basic Info
    name = Column(String(255), nullable=False)
    contact_name = Column(String(255))
    email = Column(String(255))
    phone = Column(String(50))
    
    # Address
    address_line1 = Column(String(255))
    address_line2 = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))
    country = Column(String(50), default="US")
    
    # Additional
    notes = Column(Text)
    tags = Column(ARRAY(String(255)))
    
    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Audit
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
    
    # Relationships
    company = relationship("Company", back_populates="customers")
    estimates = relationship("Estimate", back_populates="customer")
    invoices = relationship("Invoice", back_populates="customer")
    
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
