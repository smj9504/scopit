from __future__ import annotations

"""
Scopit - Company Documents API

CRUD endpoints for the company-wide reusable document library.
These endpoints are NOT tool-gated: any authenticated user may access them.

Router prefix ``/api/company-documents`` is registered in main.py.
"""

import io
from typing import Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.storage import get_storage
from app.domains.tools.dependencies import require_tool_access
from app.domains.user.models import User
from app.domains.tools.modules.pdf_editor.api import _to_response as _to_pdf_document_response
from app.domains.tools.modules.pdf_editor.schemas import (
    CompanyDocumentListResponse,
    CompanyDocumentResponse,
    CompanyDocumentUpdate,
)
from app.domains.tools.modules.pdf_editor.service import (
    CompanyDocumentService,
    PdfEditorService,
)

router = APIRouter()
_gate = require_tool_access("pdf_editor")


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _to_response(doc) -> dict:
    return {
        "id": str(doc.id),
        "name": doc.name,
        "description": doc.description,
        "category": doc.category,
        "file_size": doc.file_size,
        "mime_type": doc.mime_type,
        "page_count": doc.page_count,
        "thumbnail_url": (
            f"/api/company-documents/{doc.id}/thumbnail"
            if doc.thumbnail_path
            else None
        ),
        "tags": doc.tags or [],
        "use_count": doc.use_count,
        "last_used_at": doc.last_used_at,
        "is_active": doc.is_active,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=CompanyDocumentListResponse)
def list_company_documents(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyDocumentListResponse:
    service = CompanyDocumentService(db)
    items, total = service.list(
        company_id=current_user.company_id,
        skip=skip,
        limit=limit,
        search=search,
        category=category,
    )
    return CompanyDocumentListResponse(
        items=[
            CompanyDocumentResponse(**_to_response(doc))
            for doc in items
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/upload",
    response_model=CompanyDocumentResponse,
    status_code=201,
)
def upload_company_document(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyDocumentResponse:
    """Upload a PDF to the company document library.

    ``tags`` is an optional comma-separated string that will be split
    into a list before storage, e.g. ``"contract,warranty,roofing"``.
    """
    parsed_tags: list[str] = (
        [t.strip() for t in tags.split(",") if t.strip()]
        if tags
        else []
    )

    service = CompanyDocumentService(db)
    doc = service.upload(
        company_id=current_user.company_id,
        user_id=current_user.id,
        file=file,
        name=name,
        description=description,
        category=category,
        tags=parsed_tags,
    )
    return CompanyDocumentResponse(**_to_response(doc))


@router.get("/{document_id}", response_model=CompanyDocumentResponse)
def get_company_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyDocumentResponse:
    service = CompanyDocumentService(db)
    doc = service.get_or_404(
        company_id=current_user.company_id,
        doc_id=document_id,
    )
    return CompanyDocumentResponse(**_to_response(doc))


@router.post("/{document_id}/linked-document")
def get_linked_pdf_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Get (or create, on first use) the persistent e-signature-capable
    PdfDocument copy of this company document. Field definitions and sign
    requests are created against this copy and reused on every call, so
    field mapping only needs to be done once per company document."""
    service = PdfEditorService(db)
    doc = service.get_or_create_linked_document(
        company_id=current_user.company_id,
        user_id=current_user.id,
        company_document_id=str(document_id),
    )
    return _to_pdf_document_response(doc)


@router.get("/{document_id}/download")
def download_company_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream the underlying PDF file as a download."""
    service = CompanyDocumentService(db)
    doc = service.get_or_404(
        company_id=current_user.company_id,
        doc_id=document_id,
    )

    storage = get_storage()
    if not storage.exists(doc.file_path):
        raise HTTPException(
            status_code=404, detail="File not found"
        )

    content = storage.read(doc.file_path)
    safe_filename = (
        doc.name if doc.name.endswith(".pdf") else f"{doc.name}.pdf"
    )

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{safe_filename}"'
            ),
        },
    )


@router.get("/{document_id}/thumbnail")
def get_company_document_thumbnail(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the PNG thumbnail for the first page."""
    service = CompanyDocumentService(db)
    doc = service.get_or_404(
        company_id=current_user.company_id,
        doc_id=document_id,
    )

    storage = get_storage()
    if not doc.thumbnail_path or not storage.exists(doc.thumbnail_path):
        raise HTTPException(
            status_code=404, detail="Thumbnail not available"
        )

    content = storage.read(doc.thumbnail_path)
    return StreamingResponse(
        io.BytesIO(content), media_type="image/png"
    )


@router.patch("/{document_id}", response_model=CompanyDocumentResponse)
def update_company_document(
    document_id: UUID,
    body: CompanyDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CompanyDocumentResponse:
    """Update mutable metadata (name, description, category, tags)."""
    service = CompanyDocumentService(db)
    doc = service.update(
        company_id=current_user.company_id,
        doc_id=document_id,
        name=body.name,
        description=body.description,
        category=body.category,
        tags=body.tags,
    )
    return CompanyDocumentResponse(**_to_response(doc))


@router.delete("/{document_id}")
def delete_company_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Soft-delete a company document."""
    service = CompanyDocumentService(db)
    deleted = service.delete(
        company_id=current_user.company_id,
        doc_id=document_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=404, detail="Company document not found"
        )
    return {"ok": True}
