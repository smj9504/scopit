"""
Scopit - Packing Lead Schemas

Pydantic models for the anonymous "packing estimate" lead capture flow
(submit -> verify-email -> poll status -> claim). Field naming follows
packing/schemas.py's own convention: plain snake_case, no camelCase
aliasing (packing/schemas.py declares no alias_generator).
"""
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class LeadRoomInput(BaseModel):
    """One room's metadata within the multipart /submit payload.
    photo_count tells the server how many of the flat `photos` upload list
    belong to this room (consumed in order)."""
    room_name: str
    photo_count: int = Field(ge=0, le=10)


class LeadSubmitPayload(BaseModel):
    """The JSON-encoded `payload` form field of POST /packing-leads/submit."""
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    # The submitter's own contracting business -- distinct from contact_*
    # (the individual) and property_address (the job site being estimated).
    company_name: Optional[str] = None
    company_phone: Optional[str] = None
    company_address: Optional[str] = None
    property_address: Optional[str] = None
    idempotency_key: str
    rooms: List[LeadRoomInput]


class LeadSubmitResponse(BaseModel):
    token: str


class LeadVerifyRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=12)


class LeadVerifyResponse(BaseModel):
    status: str
    error_message: Optional[str] = None


class LeadRetryResponse(BaseModel):
    status: str
    error_message: Optional[str] = None


class LeadTeaser(BaseModel):
    room_count: int
    item_count: int
    size_category: str


class LeadProgress(BaseModel):
    """Live progress of the background analysis job, surfaced while a lead is
    `analyzing` so the visitor sees which room is being processed and how many
    of their photos are done. Analysis runs one vision call per room (all of a
    room's photos in one batch), so processed_photos advances a whole room at a
    time -- honest granularity, not a fake per-photo tick."""
    total_rooms: int
    completed_rooms: int
    total_photos: int
    processed_photos: int
    current_room: Optional[str] = None


class LeadStatusResponse(BaseModel):
    """Response shape for GET /packing-leads/{token}/status.

    Non-ready statuses populate can_retry/error_message; `ready` populates
    requires_auth/already_claimed/teaser instead. ai_result/pricing data is
    NEVER included here regardless of auth state -- that's the whole point
    of the gate; claim() is the only place full data is released.

    contact_email/company_name are echoed back only on `ready` so the signup
    form can pre-fill them (the email was already verified via the 6-digit
    code, so it's shown locked). Both are the visitor's own submitted values,
    gated behind the same secret token as the rest of the response.

    is_existing_user (ready only) tells the client the verified email already
    belongs to a registered account, so it can steer the visitor to log in and
    continue in the packing tool instead of offering a doomed sign-up."""
    status: str
    can_retry: Optional[bool] = None
    error_message: Optional[str] = None
    requires_auth: Optional[bool] = None
    already_claimed: Optional[bool] = None
    teaser: Optional[LeadTeaser] = None
    progress: Optional[LeadProgress] = None
    contact_email: Optional[str] = None
    company_name: Optional[str] = None
    is_existing_user: Optional[bool] = None


class LeadClaimResponse(BaseModel):
    tool_session_id: str
