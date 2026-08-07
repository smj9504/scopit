"""
Scopit - User Models
"""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    
    # Primary Key
    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    
    # Authentication
    email = Column(String(255), nullable=False, unique=True, index=True)
    hashed_password = Column(String(255), nullable=True)  # Nullable for OAuth users

    # OAuth
    google_id = Column(String(255), nullable=True, unique=True, index=True)

    # Profile
    full_name = Column(String(255))
    phone = Column(String(50))
    avatar_url = Column(String(500))
    
    # Company relation
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"))
    
    # Role & Status
    role = Column(String(50), nullable=False, default="staff")  # admin, manager, staff
    is_active = Column(Boolean, nullable=False, default=True)
    is_superuser = Column(Boolean, nullable=False, default=False)
    is_verified = Column(Boolean, nullable=False, default=False)
    
    # Profile - Occupation
    occupation = Column(String(50))  # contractor, public_adjuster, attorney, other
    occupation_other = Column(String(100))  # when occupation is 'other'
    business_type = Column(String(50))  # roofing, interior, siding, general
    years_in_business = Column(Integer)

    # Marketing - UTM tracking
    utm_source = Column(String(100))
    utm_medium = Column(String(100))
    utm_campaign = Column(String(100))
    referral_code = Column(String(50))

    # Signup location (captured at registration)
    signup_ip = Column(String(45))
    signup_city = Column(String(100))
    signup_state = Column(String(50))
    signup_country = Column(String(50), default="US")

    # Activity statistics
    login_count = Column(Integer, default=0)

    # PDF Settings
    default_pdf_template = Column(String(50), default="classic")  # classic, modern, professional

    # Timestamps
    last_login_at = Column(TIMESTAMP(timezone=True))
    last_login_ip = Column(String(45))
    last_login_city = Column(String(100))
    last_login_state = Column(String(50))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="users")
    login_logs = relationship("LoginLog", back_populates="user", cascade="all, delete-orphan")
