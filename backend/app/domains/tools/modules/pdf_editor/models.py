"""
ScopeIt - PDF Editor Models
"""
import enum

from sqlalchemy import Column, String, Text, Boolean, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.common.utils import generate_uuid


class PdfDocument(Base):
    __tablename__ = "pdf_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False)
    page_count = Column(Integer, nullable=False, default=1)
    mime_type = Column(String(100), default="application/pdf")

    source_type = Column(String(50), nullable=False, default="upload")
    source_id = Column(UUID(as_uuid=True))

    annotations = Column(JSONB, default=[])

    # Reusable field-mapping template: list of field definitions (position, type,
    # data binding). Copied into SignRequest.sign_fields at instance-creation time
    # so template edits never retroactively alter already-sent envelopes.
    field_definitions = Column(JSONB, default=[])

    thumbnail_path = Column(String(500))
    is_active = Column(Boolean, default=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    company = relationship("Company")
    creator = relationship("User", foreign_keys=[created_by])
    sign_requests = relationship("SignRequest", back_populates="document", cascade="all, delete-orphan")


class SignRequestStatus(str, enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    PARTIALLY_SIGNED = "partially_signed"
    SIGNED = "signed"
    DECLINED = "declined"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class SignRequest(Base):
    __tablename__ = "sign_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("pdf_documents.id", ondelete="CASCADE"), nullable=False)

    sent_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    sender_email = Column(String(255), nullable=False)
    sender_name = Column(String(255), nullable=False)

    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"))

    # Legacy singular-recipient columns. Frozen (kept nullable-readable for old
    # rows) since the sign_recipients backfill migration; new code no longer
    # writes to these -- recipients now live on SignRecipient.
    recipient_email = Column(String(255), nullable=True)
    recipient_name = Column(String(255), nullable=True)

    # Per-instance frozen copy of PdfDocument.field_definitions, taken once at
    # creation time so later template edits don't alter already-sent envelopes.
    sign_fields = Column(JSONB, default=[])

    # Snapshot of resolved values for "prefilled" and "creator_input" fields,
    # keyed by field key. Computed once at creation (prefilled) / filled in
    # pre-send (creator_input); never recomputed from live Customer/Company data.
    prefill_data = Column(JSONB, default={})

    # "direct_link" | "email_request" -- plain string for future extensibility (e.g. sms)
    delivery_method = Column(String(20), nullable=False, default="email_request")

    email_subject = Column(String(500))
    email_message = Column(Text)
    cc_emails = Column(JSONB, nullable=False, default=[])
    bcc_emails = Column(JSONB, nullable=False, default=[])

    status = Column(String(20), nullable=False, default="draft", index=True)

    access_token = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)

    sent_at = Column(TIMESTAMP(timezone=True))
    viewed_at = Column(TIMESTAMP(timezone=True))
    # Envelope-level "fully completed at" -- set once ALL recipients have signed.
    signed_at = Column(TIMESTAMP(timezone=True))
    declined_at = Column(TIMESTAMP(timezone=True))

    # Envelope-level final combined PDF (all recipients' values/signatures
    # burned in), generated once when every recipient has signed.
    signed_file_path = Column(String(500))

    # Legacy singular-signature columns. Frozen (see recipient_email note above).
    signature_data = Column(Text)
    signature_type = Column(String(20))
    signature_font = Column(String(100))
    signer_ip = Column(String(45))
    signer_user_agent = Column(String(500))

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    company = relationship("Company")
    document = relationship("PdfDocument", back_populates="sign_requests")
    sender = relationship("User", foreign_keys=[sent_by])
    customer = relationship("Customer")
    audit_events = relationship("SignAuditEvent", back_populates="sign_request", cascade="all, delete-orphan")
    recipients = relationship(
        "SignRecipient",
        back_populates="sign_request",
        cascade="all, delete-orphan",
        order_by="SignRecipient.sequence",
    )


class SignRecipient(Base):
    __tablename__ = "sign_recipients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    sign_request_id = Column(UUID(as_uuid=True), ForeignKey("sign_requests.id", ondelete="CASCADE"), nullable=False, index=True)

    role = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(50))
    sequence = Column(Integer, nullable=False, default=0)

    status = Column(String(20), nullable=False, default="pending", index=True)
    access_token = Column(String(255), nullable=False, unique=True, index=True)

    viewed_at = Column(TIMESTAMP(timezone=True))
    signed_at = Column(TIMESTAMP(timezone=True))
    declined_at = Column(TIMESTAMP(timezone=True))

    signature_data = Column(Text)
    signature_type = Column(String(20))
    signature_font = Column(String(100))
    signer_ip = Column(String(45))
    signer_user_agent = Column(String(500))

    consent_agreed = Column(Boolean, nullable=False, default=False)
    document_hash = Column(String(64))
    # This recipient's own signer_input field values, keyed by field key
    # (excludes the signature image itself, which has its own columns above).
    signed_field_values = Column(JSONB, default={})

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    sign_request = relationship("SignRequest", back_populates="recipients")


class SignAuditEvent(Base):
    __tablename__ = "sign_audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    sign_request_id = Column(UUID(as_uuid=True), ForeignKey("sign_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("sign_recipients.id", ondelete="CASCADE"), nullable=True, index=True)

    event_type = Column(String(50), nullable=False)
    actor_email = Column(String(255))
    actor_ip = Column(String(45))
    actor_user_agent = Column(String(500))
    event_metadata = Column("metadata", JSONB, default={})

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    sign_request = relationship("SignRequest", back_populates="audit_events")
    recipient = relationship("SignRecipient")


class CompanyDocument(Base):
    __tablename__ = "company_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)

    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    name = Column(String(255), nullable=False)
    description = Column(Text)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False)
    mime_type = Column(String(100), nullable=False)
    page_count = Column(Integer, default=1)
    thumbnail_path = Column(String(500))

    category = Column(String(100))
    tags = Column(ARRAY(String(100)), default=[])

    use_count = Column(Integer, default=0)
    last_used_at = Column(TIMESTAMP(timezone=True))

    is_active = Column(Boolean, default=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    company = relationship("Company")
    uploader = relationship("User", foreign_keys=[uploaded_by])
