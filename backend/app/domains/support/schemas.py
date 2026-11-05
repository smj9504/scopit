"""
Scopit - Support inquiry schemas
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

InquiryCategory = Literal["question", "problem", "idea", "other"]
InquiryStatus = Literal["open", "resolved"]

MESSAGE_MAX_LENGTH = 5000
PAGE_URL_MAX_LENGTH = 500


class InquiryCreate(BaseModel):
    category: InquiryCategory = "question"
    message: str = Field(..., max_length=MESSAGE_MAX_LENGTH)
    page_url: Optional[str] = None

    @field_validator("message")
    @classmethod
    def _message_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Please write a message.")
        return value

    @field_validator("page_url", mode="before")
    @classmethod
    def _in_app_path_only(cls, value):
        """Keep an in-app path; drop anything else.

        This is context, not content, so a bad value is dropped rather than
        failing the user's message. Only paths are kept because the admin
        console renders it as a link: an absolute or "javascript:" URL
        there would be a link someone else chose.
        """
        if not isinstance(value, str):
            return None
        value = value.strip()
        if not value.startswith("/") or value.startswith("//") or "\\" in value:
            return None
        return value[:PAGE_URL_MAX_LENGTH]


class InquiryCreated(BaseModel):
    id: str
    # The address the team's reply will go to, shown back to the user.
    reply_to: str
    created_at: datetime


# ===================
# Admin
# ===================

class AdminInquiry(BaseModel):
    id: str
    user_id: Optional[str]
    email: str
    name: Optional[str]
    company_name: Optional[str]
    category: str
    message: str
    page_url: Optional[str]
    user_agent: Optional[str]
    status: str
    created_at: datetime
    resolved_at: Optional[datetime]


class AdminInquiryList(BaseModel):
    items: List[AdminInquiry]
    total: int
    # Open inquiries overall, whatever the filter, for the page's filter label.
    open_count: int
    page: int
    limit: int


class InquiryStatusUpdate(BaseModel):
    status: InquiryStatus
