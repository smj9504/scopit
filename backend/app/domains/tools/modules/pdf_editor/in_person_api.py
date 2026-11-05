"""
Scopit - In-person signing API  (prefix: /api/tools/pdf-editor/sign/in-person)

For signing on the company's own phone or tablet with the signer there. See
in_person.py for what a visit asks for and in_person_service.py for what
signing saves.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access
from app.domains.tools.modules.pdf_editor.in_person import clean_email, role_label, signer_roles
from app.domains.tools.modules.pdf_editor.in_person_service import (
    MAX_DOCUMENTS,
    InPersonSignService,
)
from app.domains.user.models import User

router = APIRouter()

_gate = require_tool_access("pdf_editor")


# ── Requests ─────────────────────────────────────────────────────────────────


class NewCustomer(BaseModel):
    name: str = Field(..., max_length=255)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=50)
    address_line1: Optional[str] = Field(default=None, max_length=255)
    address_line2: Optional[str] = Field(default=None, max_length=255)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    zipcode: Optional[str] = Field(default=None, max_length=20)


class Subject(BaseModel):
    """Who the documents are for: a saved customer, or a new one that is
    only saved when the documents are signed"""
    customer_id: Optional[UUID] = None
    new_customer: Optional[NewCustomer] = None


class FormRequest(Subject):
    document_ids: list[UUID] = Field(..., min_length=1, max_length=MAX_DOCUMENTS)


class PreviewRequest(Subject):
    document_id: UUID
    answers: dict[str, Optional[str]] = {}
    # The device's date (MM/DD/YYYY), so an evening signing isn't dated tomorrow
    today: Optional[str] = None


class Mark(BaseModel):
    signature: Optional[str] = None  # PNG, base64 or data URL
    initials: Optional[str] = None
    signature_type: str = "draw"  # "draw" | "type"
    signature_font: Optional[str] = None


class Signer(BaseModel):
    role: str
    name: str = Field(..., max_length=255)
    email: Optional[str] = None


class SignRequestBody(Subject):
    document_ids: list[UUID] = Field(..., min_length=1, max_length=MAX_DOCUMENTS)
    answers: dict[str, Optional[str]] = {}
    today: Optional[str] = None
    signers: list[Signer] = []
    # Signer role -> that signer's marks
    marks: dict[str, Mark] = {}
    consent_agreed: bool = False
    consent_text: Optional[str] = None


class EmailRequest(BaseModel):
    request_ids: list[UUID] = Field(..., min_length=1, max_length=MAX_DOCUMENTS)
    emails: list[str] = Field(..., min_length=1, max_length=5)


def _new_customer(data: Subject) -> Optional[dict]:
    return data.new_customer.model_dump() if data.new_customer and not data.customer_id else None


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/documents")
async def list_signable_documents(
    customer_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Documents with something to sign: the company's own, and this
    customer's copies first when a customer is given"""
    docs = InPersonSignService(db).signable_documents(current_user.company_id, customer_id)
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "pageCount": d.page_count or 1,
            "customerCopy": bool(d.customer_id),
            "signers": [role_label(r["role"]) for r in signer_roles([d.field_definitions or []])],
            "createdAt": d.created_at,
        }
        for d in docs
    ]


@router.post("/form")
async def get_form(
    data: FormRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """What to ask before signing, once for all of the documents, and each
    document's lines to sign"""
    return InPersonSignService(db).form(
        current_user.company_id,
        data.document_ids,
        customer_id=data.customer_id,
        new_customer=_new_customer(data),
    )


@router.post("/preview")
async def preview_document(
    data: PreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """One document filled in with the answers so far, as a PDF. Nothing is saved."""
    pdf = InPersonSignService(db).preview(
        current_user.company_id,
        data.document_id,
        data.answers,
        data.today,
        customer_id=data.customer_id,
        new_customer=_new_customer(data),
    )
    return Response(content=pdf, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@router.post("/sign", status_code=201)
async def sign_in_person(
    data: SignRequestBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The signer signs: saves a new customer if needed, then one fully
    signed request and signed PDF per document"""
    return InPersonSignService(db).sign(
        company_id=current_user.company_id,
        user=current_user,
        document_ids=data.document_ids,
        answers=data.answers,
        today=data.today,
        signers=[s.model_dump() for s in data.signers],
        marks={role: mark.model_dump() for role, mark in data.marks.items()},
        consent_agreed=data.consent_agreed,
        consent_text=data.consent_text,
        ip=request.client.host if request.client else "",
        user_agent=request.headers.get("user-agent", ""),
        customer_id=data.customer_id,
        new_customer=_new_customer(data),
    )


@router.post("/email")
async def email_signed_copies(
    data: EmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Email a visit's signed PDFs together, one message per address"""
    emails = list(dict.fromkeys(e for e in (clean_email(x) for x in data.emails) if e))
    if not emails:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    sent = InPersonSignService(db).esign.email_signed_copies(
        current_user.company_id,
        list(dict.fromkeys(data.request_ids)),
        emails,
        actor_email=current_user.email,
    )
    return {"emails": sent}
