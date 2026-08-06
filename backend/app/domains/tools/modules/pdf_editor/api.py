from __future__ import annotations

"""
Scopit - PDF Editor Tool API

Document management, page operations, annotations, flattening, and import
endpoints for the PDF Editor tool.
"""
import io
import tempfile
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
from app.core.storage import get_storage
from app.domains.tools.dependencies import require_tool_access
from app.domains.user.models import User
from app.domains.tools.modules.pdf_editor.field_registry import get_available_fields
from app.domains.tools.modules.pdf_editor.service import PdfEditorService
from app.domains.tools.modules.pdf_editor.schemas import (
    AnnotationSaveRequest,
    FieldDefinitionsUpdateRequest,
    ImportCompanyDocRequest,
    ImportEstimateRequest,
    ImportInvoiceRequest,
    MergeDocumentsRequest,
    PageDeleteRequest,
    PageReorderRequest,
    PageRotateRequest,
    PdfDocumentUpdate,
)

router = APIRouter()
_gate = require_tool_access("pdf_editor")


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _annotation_to_camel(ann: dict) -> dict:
    """Annotation top-level fields (id/type/page/x/y/width/height/rotation/
    content) are already case-identical between storage and the frontend --
    only `style`'s multi-word keys (font_size, background_color, ...) need
    converting at this response boundary, same reasoning as
    _field_def_to_camel below."""
    style = ann.get("style") or {}
    return {
        **ann,
        "style": {
            "fontFamily": style.get("font_family"),
            "fontSize": style.get("font_size"),
            "fontWeight": style.get("font_weight"),
            "fontStyle": style.get("font_style"),
            "textDecoration": style.get("text_decoration"),
            "color": style.get("color"),
            "backgroundColor": style.get("background_color"),
            "borderColor": style.get("border_color"),
            "borderWidth": style.get("border_width"),
            "opacity": style.get("opacity"),
        },
    }


def _field_def_to_camel(field: dict) -> dict:
    """Field definitions are stored (and processed by sign_service) with
    snake_case keys matching the FieldDefinition/DataBinding Pydantic model
    attribute names. Convert to camelCase only at this JSON response
    boundary, matching every other field in this response."""
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


def _to_response(doc) -> dict:
    """Convert a PdfDocument ORM instance to a response-compatible dict."""
    return {
        "id": str(doc.id),
        "name": doc.name,
        "fileSize": doc.file_size,
        "pageCount": doc.page_count,
        "mimeType": doc.mime_type,
        "sourceType": doc.source_type,
        "sourceId": str(doc.source_id) if doc.source_id else None,
        "annotations": [_annotation_to_camel(a) for a in (doc.annotations or [])],
        "fieldDefinitions": [_field_def_to_camel(f) for f in (doc.field_definitions or [])],
        "thumbnailUrl": (
            f"/api/tools/pdf-editor/documents/{doc.id}/thumbnail"
            if doc.thumbnail_path
            else None
        ),
        "isActive": doc.is_active,
        "createdAt": doc.created_at,
        "updatedAt": doc.updated_at,
    }


# ---------------------------------------------------------------------------
# Available Field Registry
# ---------------------------------------------------------------------------

@router.get("/fields/available")
async def list_available_fields(
    current_user: User = Depends(_gate),
):
    """List source entity/field pairs that a template's 'prefilled' fields
    can auto-map from (Customer, Company, ...)."""
    return [
        {
            "sourceEntity": f["source_entity"],
            "sourceField": f["source_field"],
            "label": f["label"],
            "type": f["type"],
        }
        for f in get_available_fields()
    ]


# ---------------------------------------------------------------------------
# Document upload / creation
# ---------------------------------------------------------------------------

@router.post("/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    rotation: int = Form(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Upload a PDF or convertible file (image, DOCX) as a new document.
    rotation: degrees clockwise (0, 90, 180, 270) for image files.
    """
    service = PdfEditorService(db)
    doc = service.upload_document(
        company_id=current_user.company_id,
        user_id=current_user.id,
        file=file,
        name=name,
        rotation=rotation,
    )
    return _to_response(doc)


@router.post("/documents/images-to-pdf", status_code=201)
async def images_to_pdf(
    files: list[UploadFile] = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Convert multiple uploaded images into a single multi-page PDF."""
    service = PdfEditorService(db)
    doc = service.images_to_pdf(
        company_id=current_user.company_id,
        user_id=current_user.id,
        files=files,
        name=name,
    )
    return _to_response(doc)


# ---------------------------------------------------------------------------
# Document CRUD
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_documents(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """List PDF documents for the current company."""
    service = PdfEditorService(db)
    items, total = service.list_documents(
        company_id=current_user.company_id,
        skip=skip,
        limit=limit,
        search=search,
    )
    return {
        "items": [_to_response(doc) for doc in items],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/documents/{document_id}")
async def get_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Get a single PDF document by ID."""
    service = PdfEditorService(db)
    doc = service.get_document_or_404(
        company_id=current_user.company_id,
        document_id=document_id,
    )
    return _to_response(doc)


@router.patch("/documents/{document_id}")
async def update_document(
    document_id: UUID,
    body: PdfDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Rename a document."""
    if body.name is None:
        raise HTTPException(
            status_code=400,
            detail="At least one field must be provided.",
        )
    service = PdfEditorService(db)
    doc = service.rename_document(
        company_id=current_user.company_id,
        document_id=document_id,
        new_name=body.name,
    )
    return _to_response(doc)


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Soft-delete a document."""
    service = PdfEditorService(db)
    service.delete_document(
        company_id=current_user.company_id,
        document_id=document_id,
    )
    return {"ok": True}


@router.post("/documents/{document_id}/duplicate", status_code=201)
async def duplicate_document(
    document_id: UUID,
    body: PdfDocumentUpdate = PdfDocumentUpdate(),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Create a copy of an existing document."""
    service = PdfEditorService(db)
    doc = service.duplicate_document(
        company_id=current_user.company_id,
        document_id=document_id,
        user_id=current_user.id,
        new_name=body.name,
    )
    return _to_response(doc)


# ---------------------------------------------------------------------------
# Download / thumbnail / page image
# ---------------------------------------------------------------------------

@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: UUID,
    flatten: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Download the PDF file. Pass flatten=true to burn annotations."""
    service = PdfEditorService(db)
    doc = service.get_document_or_404(
        company_id=current_user.company_id,
        document_id=document_id,
    )

    storage = get_storage()

    if flatten:
        content = service.flatten_annotations(
            company_id=current_user.company_id,
            document_id=document_id,
        )
    else:
        if not storage.exists(doc.file_path):
            raise HTTPException(
                status_code=404, detail="File not found"
            )
        content = storage.read(doc.file_path)

    safe_name = (
        doc.name
        if doc.name.lower().endswith(".pdf")
        else f"{doc.name}.pdf"
    )

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
        },
    )


@router.get("/documents/{document_id}/thumbnail")
async def get_thumbnail(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Return the first-page thumbnail PNG for a document."""
    service = PdfEditorService(db)
    doc = service.get_document_or_404(
        company_id=current_user.company_id,
        document_id=document_id,
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


@router.get("/documents/{document_id}/page/{page_num}")
async def get_page_image(
    document_id: UUID,
    page_num: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Render a specific page (1-indexed) of the PDF as a PNG image."""
    service = PdfEditorService(db)
    doc = service.get_document_or_404(
        company_id=current_user.company_id,
        document_id=document_id,
    )

    if page_num < 1 or page_num > doc.page_count:
        raise HTTPException(
            status_code=400,
            detail=f"page_num must be between 1 and {doc.page_count}",
        )

    storage = get_storage()
    pdf_data = storage.read(doc.file_path)

    try:
        from pdf2image import convert_from_bytes

        images = convert_from_bytes(
            pdf_data,
            first_page=page_num,
            last_page=page_num,
            size=(1200, None),
        )
    except ImportError:
        # pdf2image not available - fall back to convert_from_path
        import os
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
            status_code=404, detail="Page could not be rendered"
        )

    buf = io.BytesIO()
    images[0].save(buf, format="PNG")
    buf.seek(0)

    return StreamingResponse(buf, media_type="image/png")


# ---------------------------------------------------------------------------
# Page operations
# ---------------------------------------------------------------------------

@router.post("/documents/merge", status_code=201)
async def merge_documents(
    body: MergeDocumentsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Merge two or more documents into a new document."""
    service = PdfEditorService(db)
    doc = service.merge_documents(
        company_id=current_user.company_id,
        user_id=current_user.id,
        document_ids=body.document_ids,
        name=body.name,
    )
    return _to_response(doc)


@router.post("/documents/{document_id}/pages/reorder")
async def reorder_pages(
    document_id: UUID,
    body: PageReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Reorder pages in a document using a 0-indexed page order list."""
    service = PdfEditorService(db)
    doc = service.reorder_pages(
        company_id=current_user.company_id,
        document_id=document_id,
        page_order=body.page_order,
    )
    return _to_response(doc)


@router.post("/documents/{document_id}/pages/delete")
async def delete_pages(
    document_id: UUID,
    body: PageDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Delete specific pages (1-indexed) from a document."""
    service = PdfEditorService(db)
    doc = service.delete_pages(
        company_id=current_user.company_id,
        document_id=document_id,
        page_numbers=body.page_numbers,
    )
    return _to_response(doc)


@router.post("/documents/{document_id}/pages/rotate")
async def rotate_pages(
    document_id: UUID,
    body: PageRotateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Rotate specific pages. Body: {rotations: {"1": 90, "3": 180}}."""
    service = PdfEditorService(db)
    doc = service.rotate_pages(
        company_id=current_user.company_id,
        document_id=document_id,
        rotations=body.rotations,
    )
    return _to_response(doc)


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

@router.put("/documents/{document_id}/annotations")
async def save_annotations(
    document_id: UUID,
    body: AnnotationSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Persist the full annotation list for a document."""
    service = PdfEditorService(db)
    serialized = [ann.model_dump() for ann in body.annotations]
    doc = service.save_annotations(
        company_id=current_user.company_id,
        document_id=document_id,
        annotations=serialized,
    )
    return _to_response(doc)


@router.put("/documents/{document_id}/fields")
async def save_field_definitions(
    document_id: UUID,
    body: FieldDefinitionsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Save the reusable field-mapping template for a document."""
    service = PdfEditorService(db)
    serialized = [f.model_dump() for f in body.fields]
    doc = service.save_field_definitions(
        company_id=current_user.company_id,
        document_id=document_id,
        fields=serialized,
    )
    return _to_response(doc)


@router.post("/documents/{document_id}/flatten")
async def flatten_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Burn annotations into the PDF and return the flattened file."""
    service = PdfEditorService(db)
    doc = service.get_document_or_404(
        company_id=current_user.company_id,
        document_id=document_id,
    )

    content = service.flatten_annotations(
        company_id=current_user.company_id,
        document_id=document_id,
    )

    safe_name = (
        doc.name
        if doc.name.lower().endswith(".pdf")
        else f"{doc.name}.pdf"
    )
    flat_name = f"flattened-{safe_name}"

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{flat_name}"',
        },
    )


# ---------------------------------------------------------------------------
# Import from Scopit entities
# ---------------------------------------------------------------------------

@router.post("/documents/import-estimate", status_code=201)
async def import_estimate(
    body: ImportEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Generate an estimate PDF and import it as an editable document."""
    service = PdfEditorService(db)
    doc = service.import_estimate_as_document(
        company_id=current_user.company_id,
        user_id=current_user.id,
        estimate_id=body.estimate_id,
        template=body.template,
    )
    return _to_response(doc)


@router.post("/documents/import-invoice", status_code=201)
async def import_invoice(
    body: ImportInvoiceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Generate an invoice PDF and import it as an editable document."""
    service = PdfEditorService(db)
    doc = service.import_invoice_as_document(
        company_id=current_user.company_id,
        user_id=current_user.id,
        invoice_id=body.invoice_id,
        template=body.template,
    )
    return _to_response(doc)


@router.post("/documents/import-company-doc", status_code=201)
async def import_company_doc(
    body: ImportCompanyDocRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Copy a company library document into the user's working documents."""
    service = PdfEditorService(db)
    doc = service.import_company_document(
        company_id=current_user.company_id,
        user_id=current_user.id,
        company_document_id=body.company_document_id,
    )
    return _to_response(doc)
