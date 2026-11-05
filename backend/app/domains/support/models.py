"""
Scopit - Support inquiry model

A message a signed-in user sends to the Scopit team from the in-app Help
form. It is stored, not only emailed, so a message survives a failed or
unconfigured email send and the team can see what is still open in the
admin console.
"""
from sqlalchemy import Column, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.common.utils import generate_uuid
from app.core.database import Base

INQUIRY_CATEGORIES = ("question", "problem", "idea", "other")
INQUIRY_STATUSES = ("open", "resolved")


class SupportInquiry(Base):
    __tablename__ = "support_inquiries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    # SET NULL keeps the message if the account or company is deleted later.
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="SET NULL"),
    )

    # Who wrote it, as of sending: the address to reply to stays put even if
    # the profile changes or the account goes away.
    email = Column(String(255), nullable=False)
    name = Column(String(255))

    category = Column(String(20), nullable=False, default="question")
    message = Column(Text, nullable=False)
    # In-app path the user was on (e.g. "/app/estimates/123/edit").
    page_url = Column(String(500))
    user_agent = Column(String(500))

    status = Column(
        String(20), nullable=False, default="open", server_default="open", index=True
    )
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    resolved_at = Column(TIMESTAMP(timezone=True))
