"""
Scopit - Packing Lead Models

Anonymous "packing estimate" lead capture, gated behind signup.
A PackingLead is NOT a ToolSession -- it's a pre-account funnel record that
gets materialized into a real ToolSession only once the visitor registers
and calls claim(). See lead_api.py for the full flow.
"""
import enum

from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base


class PackingLeadStatus(str, enum.Enum):
    """Reference enum for the `status` column. Stored as a plain string
    (mirroring SignRequest.status in pdf_editor/models.py) rather than a
    native Postgres enum type, so future status values don't require an
    ALTER TYPE migration."""
    PENDING_VERIFICATION = "pending_verification"
    ANALYZING = "analyzing"
    READY = "ready"
    FAILED = "failed"
    CLAIMED = "claimed"


class PackingLead(Base):
    __tablename__ = "packing_leads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    # Public-facing opaque identifier used in all lead endpoints. Never the
    # row's primary key, to avoid leaking sequential/guessable references.
    token = Column(String(64), nullable=False, unique=True, index=True)

    # Set by the client (e.g. a hash of contact info + a session nonce) to
    # make double-submits idempotent -- resubmitting the same form (double
    # click, retry after a flaky network) returns the existing lead instead
    # of creating a duplicate.
    idempotency_key = Column(String(255), nullable=True, unique=True)

    # No personal name is collected -- registration collects its own fullName
    # independently and never reads this lead, so a submitter name field
    # would go unused except for cosmetic display (which company_name now
    # covers better anyway).
    contact_email = Column(String(255), nullable=False, index=True)
    contact_phone = Column(String(50), nullable=True)

    # The submitter's own contracting business -- distinct from contact_*
    # (the individual submitting) and property_address (the job site).
    # Mapped into CompanyInfoOverride on the claimed ToolSession so exports
    # are branded correctly from the moment the lead is claimed.
    company_name = Column(String(255), nullable=True)
    company_phone = Column(String(50), nullable=True)
    company_address = Column(Text, nullable=True)

    property_address = Column(Text, nullable=True)

    # [{"room_name": str, "photo_keys": [str, ...]}, ...]
    rooms_input = Column(JSONB, nullable=False, server_default="[]")

    # Populated by the background analysis job once complete. Shape mirrors
    # what an authenticated ToolSession's `data.photo_rooms` looks like after
    # a normal analyze-batch run (see lead_api._run_analysis for the exact
    # per-room structure) so claim() can drop it in with minimal transform.
    ai_result = Column(JSONB, nullable=True)

    status = Column(
        String(30),
        nullable=False,
        default=PackingLeadStatus.PENDING_VERIFICATION.value,
        server_default=PackingLeadStatus.PENDING_VERIFICATION.value,
        index=True,
    )
    # Internal-only failure detail (may be more specific than what's shown
    # to the end user via the public status endpoint).
    error_message = Column(Text, nullable=True)

    # Hashed via app.domains.auth.verification.hash_code -- the plaintext
    # code is only ever emailed, never stored.
    verification_code_hash = Column(String(64), nullable=True)
    verification_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    verification_expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    verified_at = Column(TIMESTAMP(timezone=True), nullable=True)

    analysis_started_at = Column(TIMESTAMP(timezone=True), nullable=True)
    retry_count = Column(Integer, nullable=False, default=0, server_default="0")

    claimed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    claimed_tool_session_id = Column(UUID(as_uuid=True), ForeignKey("tool_sessions.id"), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    # Submission expiry (24h) initially; extended to verified_at + 14 days
    # on successful email verification. Past-expiry rows are 404 and are
    # opportunistically garbage-collected (see lead_cleanup.py).
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
