"""
Scopit - Admin Models (LoginLog, UserActivity)
"""
from sqlalchemy import Column, String, ForeignKey, Text, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB

from app.core.database import Base
from app.common.utils import generate_uuid


class LoginLog(Base):
    """Track user login history with location and device info"""
    __tablename__ = "login_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Login info
    login_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    login_method = Column(String(20))  # email, google

    # Location info (from IP geolocation)
    ip_address = Column(String(45))
    city = Column(String(100))
    state = Column(String(50))
    country = Column(String(50))

    # Device info (parsed from user agent)
    user_agent = Column(String(500))
    device_type = Column(String(20))  # desktop, mobile, tablet
    browser = Column(String(50))
    os = Column(String(50))

    # Relationships
    user = relationship("User", back_populates="login_logs")


class UserActivity(Base):
    """Track user activities for analytics"""
    __tablename__ = "user_activities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True
    )

    # Activity info
    action = Column(String(50), nullable=False, index=True)
    resource_type = Column(String(50))  # estimate, invoice, customer
    resource_id = Column(UUID(as_uuid=True))
    extra_data = Column(JSONB)  # Additional context data

    # Timestamp
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )
