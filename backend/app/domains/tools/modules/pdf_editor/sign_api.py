from __future__ import annotations

"""
Scopit - E-Sign API

Two routers:
  router        - authenticated endpoints under /api/tools/pdf-editor/sign/
  public_router - public (token-based) endpoints under /api/sign/
"""
import io
import os
import tempfile
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.storage import get_storage
from app.domains.tools.dependencies import require_tool_access
from app.domains.tools.modules.pdf_editor.models import SignRecipient, SignRequest
from app.domains.tools.modules.pdf_editor.schemas import (
    CreatorFieldValuesRequest,
    SignDeclineRequest,
    SignRequestCreate,
    SignSubmitRequest,
)
from app.domains.tools.modules.pdf_editor.service import flatten_annotations_bytes
from app.domains.tools.modules.pdf_editor.sign_service import (
    BLOCKED_STATUSES,
    SignService,
)
from app.domains.user.models import User

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

router = APIRouter()
public_router = APIRouter()

_gate = require_tool_access("pdf_editor")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _field_def_to_camel(field: dict) -> dict:
    """sign_fields is a snake_case-keyed copy of the template's
    field_definitions (see api.py::_field_def_to_camel for why)."""
    binding = field.get("data_binding") or {}
    return {
        "key": field.get("key"),
        "label": field.get("label"),
        "type": field.get("type"),
        "page": field.get("page"),
        "x": field.get("x"),
        "y": field.get("y"),
        "width": field.get("width"),
        "height": field.get("height"),
        "dataBinding": {
            "mode": binding.get("mode"),
            "sourceEntity": binding.get("source_entity"),
            "sourceField": binding.get("source_field"),
        },
        "signerRole": field.get("signer_role"),
        "required": field.get("required", False),
        "fontSize": field.get("font_size"),
    }


def _to_recipient_dict(r: SignRecipient) -> dict:
    return {
        "id": str(r.id),
        "role": r.role,
        "name": r.name,
        "email": r.email,
        "phone": r.phone,
        "sequence": r.sequence,
        "status": r.status,
        "viewedAt": r.viewed_at,
        "signedAt": r.signed_at,
        "declinedAt": r.declined_at,
        "consentAgreed": r.consent_agreed,
    }


def _to_sign_response(req: SignRequest) -> dict:
    resp = {
        "id": str(req.id),
        "documentId": str(req.document_id),
        "documentName": (
            req.document.name if req.document else None
        ),
        "recipients": [
            _to_recipient_dict(r)
            for r in sorted(req.recipients, key=lambda r: r.sequence)
        ],
        "senderEmail": req.sender_email,
        "senderName": req.sender_name,
        "customerId": (
            str(req.customer_id) if req.customer_id else None
        ),
        "status": req.status,
        "deliveryMethod": req.delivery_method,
        "signFields": [_field_def_to_camel(f) for f in (req.sign_fields or [])],
        "prefillData": req.prefill_data or {},
        "emailSubject": req.email_subject,
        "emailMessage": req.email_message,
        "ccEmails": req.cc_emails or [],
        "bccEmails": req.bcc_emails or [],
        "expiresAt": req.expires_at,
        "sentAt": req.sent_at,
        "signedAt": req.signed_at,
        "declinedAt": req.declined_at,
        "createdAt": req.created_at,
        "updatedAt": req.updated_at,
    }
    # Always included: the sender is already authorized to view/manage this
    # request, so seeing each recipient's link is equivalent information to
    # what's already been (or would be) emailed to them.
    resp["signUrls"] = {
        str(r.id): f"{settings.FRONTEND_URL}/sign/{r.access_token}"
        for r in req.recipients
    }
    return resp


# ===========================================================================
# Authenticated endpoints  (prefix: /api/tools/pdf-editor/sign)
# ===========================================================================


@router.post("/requests", status_code=201)
async def create_sign_request(
    data: SignRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Create a new sign request (status: draft)."""
    service = SignService(db)
    sender_name = data.sender_name or (current_user.full_name or current_user.email)
    sign_req = service.create_sign_request(
        company_id=current_user.company_id,
        user_id=current_user.id,
        document_id=UUID(data.document_id),
        recipients=[r.model_dump() for r in data.recipients],
        sender_email=data.sender_email or current_user.email,
        sender_name=sender_name,
        customer_id=(
            UUID(data.customer_id) if data.customer_id else None
        ),
        delivery_method=data.delivery_method,
        email_subject=data.email_subject,
        email_message=data.email_message,
        cc_emails=data.cc_emails,
        bcc_emails=data.bcc_emails,
        expires_in_days=data.expires_in_days,
    )
    return _to_sign_response(sign_req)


@router.get("/requests")
async def list_sign_requests(
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """List sign requests for the current company."""
    service = SignService(db)
    items, total = service.list_sign_requests(
        company_id=current_user.company_id,
        status=status,
        skip=skip,
        limit=limit,
    )
    return {
        "items": [_to_sign_response(r) for r in items],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/requests/{request_id}")
async def get_sign_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Get a single sign request detail."""
    service = SignService(db)
    sign_req = service.get_sign_request(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    if not sign_req:
        raise HTTPException(
            status_code=404, detail="Sign request not found"
        )
    return _to_sign_response(sign_req)


@router.patch("/requests/{request_id}/creator-fields")
async def set_creator_field_values(
    request_id: UUID,
    data: CreatorFieldValuesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Fill in the sender's own ('creator_input') field values before send."""
    service = SignService(db)
    sign_req = service.set_creator_field_values(
        company_id=current_user.company_id,
        request_id=request_id,
        values=data.values,
    )
    return _to_sign_response(sign_req)


@router.get("/requests/{request_id}/preview")
async def preview_sign_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Preview resolved field values before sending (FR-3.4)."""
    service = SignService(db)
    preview = service.get_preview(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    return {
        "fields": [_field_def_to_camel(f) for f in preview["fields"]],
        "values": preview["values"],
        "pageCount": preview["page_count"],
        "documentName": preview["document_name"],
    }


@router.post("/requests/{request_id}/send")
async def send_sign_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Send the signing invitation (email, or make direct links available)."""
    service = SignService(db)
    sign_req = service.send_sign_request(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    return _to_sign_response(sign_req)


@router.post("/requests/{request_id}/reminder")
async def send_reminder(
    request_id: UUID,
    recipient_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Send a reminder email. Omit recipient_id to remind everyone
    outstanding, or pass it to remind a single recipient."""
    service = SignService(db)
    sign_req = service.send_reminder(
        company_id=current_user.company_id,
        request_id=request_id,
        recipient_id=recipient_id,
    )
    return _to_sign_response(sign_req)


@router.post("/requests/{request_id}/resend-signed-copy")
async def resend_signed_copy(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Re-send the fully-signed PDF (email, with attachment) to the sender
    and every recipient. Only available once the envelope is fully signed."""
    service = SignService(db)
    sign_req = service.resend_signed_copies(
        company_id=current_user.company_id,
        request_id=request_id,
        actor_email=current_user.email,
    )
    return _to_sign_response(sign_req)


@router.post("/requests/{request_id}/cancel")
async def cancel_sign_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Void a pending sign request."""
    service = SignService(db)
    sign_req = service.cancel_sign_request(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    return _to_sign_response(sign_req)


@router.get("/requests/{request_id}/audit")
async def get_audit_trail(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Retrieve the full audit trail for a sign request."""
    service = SignService(db)
    events = service.get_audit_trail(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    return [
        {
            "id": str(e.id),
            "eventType": e.event_type,
            "recipientId": str(e.recipient_id) if e.recipient_id else None,
            "actorEmail": e.actor_email,
            "actorIp": e.actor_ip,
            "eventMetadata": e.event_metadata or {},
            "createdAt": e.created_at,
        }
        for e in events
    ]


@router.get("/requests/{request_id}/signed-document")
async def download_signed_document(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Download the signed PDF."""
    service = SignService(db)
    sign_req = service.get_sign_request(
        company_id=current_user.company_id,
        request_id=request_id,
    )
    if not sign_req:
        raise HTTPException(
            status_code=404, detail="Sign request not found"
        )
    if sign_req.status != "signed":
        raise HTTPException(
            status_code=400,
            detail="Document has not been fully signed yet",
        )

    storage = get_storage()
    signed_key = sign_req.signed_file_path
    if not signed_key or not storage.exists(signed_key):
        raise HTTPException(
            status_code=404,
            detail="Signed document file not found",
        )

    content = storage.read(signed_key)
    doc_name = (
        sign_req.document.name if sign_req.document else "signed"
    )
    base_name = os.path.splitext(doc_name)[0]
    filename = f"{base_name}_signed.pdf"

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
            ),
        },
    )


# ===========================================================================
# Public endpoints  (prefix: /api/sign)
# ===========================================================================


@public_router.get("/view/{token}")
async def view_document(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """View document metadata before signing (public, token-based).
    Fields belonging to a different recipient's role are omitted entirely,
    not just hidden (FR-5.3)."""
    ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")

    service = SignService(db)
    sign_req, recipient = service.view_document(
        token=token, ip=ip, user_agent=user_agent
    )

    doc = sign_req.document
    company = sign_req.company

    visible_fields = []
    for field in sign_req.sign_fields or []:
        role = field.get("signer_role")
        if role and role != recipient.role:
            continue  # another recipient's field -- omit, not just hide
        item = _field_def_to_camel(field)
        if role == recipient.role:
            item["editable"] = True
        else:
            item["editable"] = False
            item["value"] = (sign_req.prefill_data or {}).get(field.get("key"))
        visible_fields.append(item)

    return {
        "documentName": doc.name if doc else "Document",
        "senderName": sign_req.sender_name,
        "senderEmail": sign_req.sender_email,
        "recipientName": recipient.name,
        "recipientRole": recipient.role,
        "recipientStatus": recipient.status,
        "companyName": company.name if company else None,
        "companyLogoUrl": None,
        "pageCount": doc.page_count if doc else 0,
        "signFields": visible_fields,
        "status": sign_req.status,
        "expiresAt": sign_req.expires_at,
        "consentRequired": True,
    }


@public_router.get("/view/{token}/page/{page_num}")
async def get_page_image(
    token: str,
    page_num: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Render a page of the document as PNG (public, token-based)."""
    service = SignService(db)
    sign_req = service.get_by_token(token)
    if not sign_req:
        raise HTTPException(
            status_code=404, detail="Sign request not found"
        )
    if sign_req.status in BLOCKED_STATUSES:
        raise HTTPException(
            status_code=410,
            detail="This signing request is no longer available",
        )

    doc = sign_req.document
    storage = get_storage()

    if not doc or not doc.file_path or not storage.exists(
        doc.file_path
    ):
        raise HTTPException(
            status_code=404, detail="Document file not found"
        )

    if page_num < 1 or page_num > doc.page_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"page_num must be between 1 and {doc.page_count}"
            ),
        )

    mime = (doc.mime_type or "").lower()
    # Match _burn_document: annotation edits (PDF editor, inline or
    # standalone) must render here as what the signer sees, since that's
    # also what ends up burned into the final signed document.
    pdf_data = (
        flatten_annotations_bytes(doc, storage)
        if not mime.startswith("image/") and doc.annotations
        else storage.read(doc.file_path)
    )

    # Image files: serve directly
    if mime.startswith("image/"):
        media_type = (
            mime
            if mime in ("image/png", "image/jpeg", "image/webp")
            else "image/jpeg"
        )
        return StreamingResponse(
            io.BytesIO(pdf_data), media_type=media_type
        )

    # PDF: rasterise the requested page
    try:
        from pdf2image import convert_from_bytes

        images = convert_from_bytes(
            pdf_data,
            first_page=page_num,
            last_page=page_num,
            size=(1200, None),
        )
    except ImportError:
        # Fallback to convert_from_path via temp file
        with tempfile.NamedTemporaryFile(
            suffix=".pdf", delete=False
        ) as tmp:
            tmp.write(pdf_data)
            tmp_path = tmp.name
        try:
            from pdf2image import convert_from_path

            images = convert_from_path(
                tmp_path,
                first_page=page_num,
                last_page=page_num,
                size=(1200, None),
            )
        finally:
            os.unlink(tmp_path)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Page rendering is unavailable: {exc}",
        ) from exc

    if not images:
        raise HTTPException(
            status_code=404,
            detail="Page could not be rendered",
        )

    buf = io.BytesIO()
    images[0].save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@public_router.post("/submit/{token}")
async def submit_signature(
    token: str,
    data: SignSubmitRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Submit this recipient's completed signature + field values."""
    ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")

    service = SignService(db)
    recipient = service.submit_signature(
        token=token,
        signature_data=data.signature_data,
        signature_type=data.signature_type,
        signature_font=data.signature_font or "",
        field_values=data.field_values,
        consent_agreed=data.consent_agreed,
        ip=ip,
        user_agent=user_agent,
    )
    return {
        "status": recipient.status,
        "envelopeStatus": recipient.sign_request.status,
        "signedAt": recipient.signed_at,
    }


@public_router.post("/decline/{token}")
async def decline_signature(
    token: str,
    data: SignDeclineRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Decline to sign the document."""
    ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")

    service = SignService(db)
    recipient = service.decline_signature(
        token=token,
        reason=data.reason or "",
        ip=ip,
        user_agent=user_agent,
    )
    return {
        "status": recipient.status,
        "declinedAt": recipient.declined_at,
    }
