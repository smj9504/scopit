"""
Scopit - Product library API

The company's products from retailers, and reading new ones off a retailer
link or a screenshot of the listing. Shared by the Cabinet and Bathroom
Estimators, so access to either opens it. Reading a listing asks Claude, which counts
against the company's daily AI allowance.
"""
import asyncio
import os
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_any_tool_access
from app.domains.tools.usage import reserve_ai_units
from app.domains.user.models import User

from . import catalog
from .schemas import (
    ExtractHtmlRequest,
    ExtractUrlRequest,
    ProductCreate,
    ProductDraft,
    ProductListResponse,
    ProductResponse,
    ProductUpdate,
)
from .service import ProductError, ProductService, image_key, media_type_for

router = APIRouter()
_gate = require_any_tool_access("cabinet_estimate", "bathroom_estimate")
AI_TOOL_ID = "product_library"

# A screenshot or picture uploaded by hand.
MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def _fail(e: ProductError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


def _service(db: Session, user: User) -> ProductService:
    return ProductService(db, user.company_id)


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The picture is larger than 12 MB")
    return data


@router.get("/meta")
def product_meta(current_user: User = Depends(_gate)):
    """The categories, price units and retailers the library knows."""
    return catalog.meta()


@router.get("", response_model=ProductListResponse)
def list_products(
    q: Optional[str] = Query(None, max_length=200),
    category: Optional[str] = Query(None),
    trade: Optional[str] = Query(None, pattern="^(kitchen|bathroom)$"),
    include_archived: bool = Query(False),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    items, total = _service(db, current_user).list(q, category, trade, include_archived, limit, offset)
    return ProductListResponse(items=[ProductResponse.model_validate(p) for p in items], total=total)


@router.post("/extract/url", response_model=ProductDraft)
def extract_from_url(
    payload: ExtractUrlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Read a product off its retailer page, to check and save. Nothing is stored."""
    reserve_ai_units(db, current_user, AI_TOOL_ID, 1)
    return _service(db, current_user).draft_from_url(payload.url.strip())


@router.post("/extract/html", response_model=ProductDraft)
def extract_from_html(
    payload: ExtractHtmlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Read a product off a page the person's browser sent (the bookmarklet). Nothing is stored."""
    reserve_ai_units(db, current_user, AI_TOOL_ID, 1)
    return _service(db, current_user).draft_from_html(payload.html, payload.url.strip())


@router.post("/extract/screenshot", response_model=ProductDraft)
async def extract_from_screenshot(
    file: UploadFile = File(...),
    url: Optional[str] = Form(None, max_length=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Read a product off a screenshot of its listing (for a site that turns the server away)."""
    data = await _read_upload(file)
    reserve_ai_units(db, current_user, AI_TOOL_ID, 1)
    try:
        return await asyncio.to_thread(
            _service(db, current_user).draft_from_screenshot, data, (file.content_type or "").lower(), url
        )
    except ProductError as e:
        raise _fail(e)


@router.get("/images/{file_id:path}")
def serve_product_image(
    file_id: str,
    current_user: User = Depends(_gate),
):
    """One of the company's stored product pictures."""
    from app.core.storage import LocalStorage, get_storage

    key = image_key(current_user.company_id, file_id)
    if not key:
        raise HTTPException(status_code=404, detail="Picture not found")
    headers = {"Cache-Control": "private, max-age=86400"}
    storage = get_storage()
    if isinstance(storage, LocalStorage):
        path = os.path.join(storage.base_dir, key)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Picture not found")
        return FileResponse(path, media_type=media_type_for(file_id), headers=headers)
    try:
        data = storage.read(key)
    except Exception:
        raise HTTPException(status_code=404, detail="Picture not found")
    return Response(content=data, media_type=media_type_for(file_id), headers=headers)


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(_gate)):
    try:
        return _service(db, current_user).get(product_id)
    except ProductError as e:
        raise _fail(e)


@router.post("", response_model=ProductResponse)
async def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Save a product; the pictures it names by link are fetched and kept."""
    product = await _service(db, current_user).create(payload, current_user.id)
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        product = await _service(db, current_user).update(product_id, payload)
    except ProductError as e:
        raise _fail(e)
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


@router.post("/{product_id}/images", response_model=ProductResponse)
async def upload_product_image(
    product_id: UUID,
    file: UploadFile = File(...),
    swatch: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Add a picture by hand, or set the flat surface picture the 3D view uses as a texture (`swatch`)."""
    data = await _read_upload(file)
    try:
        product = await _service(db, current_user).keep_upload(product_id, data, file.filename or "image", swatch)
    except ProductError as e:
        raise _fail(e)
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


@router.delete("/{product_id}")
def archive_product(product_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(_gate)):
    """Take a product out of the library. It stays in the estimates that copied it."""
    try:
        _service(db, current_user).archive(product_id)
    except ProductError as e:
        raise _fail(e)
    db.commit()
    return {"archived": True}
