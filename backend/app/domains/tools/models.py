"""
Scopit - Tool Models
"""
from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class ToolSession(Base):
    __tablename__ = "tool_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    tool_id = Column(String(50), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    data = Column(JSONB, nullable=False, server_default="{}")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company")
    creator = relationship("User")
    files = relationship("ToolFile", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        # Composite index for common query: sessions per company + tool
        # Defined via Index import if needed, but (company_id, tool_id) individual indexes suffice
    )


class AIUsageEvent(Base):
    """One billable AI call (or batch), counted against a company's daily quota.

    Rows are written before the model is called, so a crash mid-analysis
    still counts. See app/domains/tools/usage.py.
    """
    __tablename__ = "ai_usage_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    tool_id = Column(String(50), nullable=False)
    units = Column(Integer, nullable=False)  # rooms sent to the vision model
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_ai_usage_events_company_created", "company_id", "created_at"),
    )


class ToolFile(Base):
    __tablename__ = "tool_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    session_id = Column(UUID(as_uuid=True), ForeignKey("tool_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)

    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_type = Column(String(50), nullable=False)  # "xml", "json", "pdf", "image"
    file_size = Column(Integer, nullable=False)
    mime_type = Column(String(100), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ToolSession", back_populates="files")
