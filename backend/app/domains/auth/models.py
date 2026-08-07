"""
Scopit - Auth Domain Models
"""
from sqlalchemy import Column, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class EmailVerificationCode(Base):
    """
    Hashed 6-digit email verification codes issued at signup.
    Only the most-recently-created row per user_id is "active" — lookups
    always take ORDER BY created_at DESC LIMIT 1, so issuing a new code
    (resend) implicitly invalidates the previous one.
    """
    __tablename__ = "email_verification_codes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    code_hash = Column(String(64), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    consumed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_email_verification_codes_user_created", "user_id", "created_at"),
    )
