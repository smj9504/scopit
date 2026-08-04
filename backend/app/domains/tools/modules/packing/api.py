"""
ScopeIt - Packing & Moving Estimator Tool API
"""
import base64
import logging
import re
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import io

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.tools.dependencies import require_tool_access
from app.domains.tools.modules.packing.service import EstimateCalculator
from app.domains.tools.modules.packing.schemas import (
    QuickEstimateRequest, EstimateResponse,
    RoomPhotoAnalysisRequest, RoomAnalysisResponse,
    RoomsEstimateRequest,
    SubmitCorrectionsRequest, SubmitCorrectionsResponse,
    MasterContentRequest, MasterContentResponse,
    ExportRequest,
    ReportExportRequest,
    BatchRoomAnalysisRequest,
    BatchRoomEvent, BatchCompleteEvent,
    RoomAnalysisStatus,
    PackoutEstimateRequest, PackoutEstimateResponse,
    DetectedContentItem,
)
from app.domains.tools.modules.packing.presets import get_all_presets, get_presets_by_category

try:
    from app.domains.tools.modules.packing.export import (
        generate_estimate_pdf, generate_estimate_excel,
        generate_report_pdf, build_company_info,
    )
except ImportError:
    generate_estimate_pdf = None
    generate_estimate_excel = None
    generate_report_pdf = None
    build_company_info = None

router = APIRouter()
_gate = require_tool_access("packing")


def _sanitize_filename(text: str) -> str:
    """Remove characters unsafe for filenames, collapse whitespace."""
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def _build_address_slug(property_address: str | None) -> str:
    """Extract 'Street, City' from a property address for use in filenames.

    Expects formats like '123 Main St, Dallas, TX 75201' or multi-line.
    Returns e.g. '123 Main St, Dallas' or empty string.
    """
    if not property_address:
        return ''
    # Normalise newlines to commas
    addr = property_address.replace('\n', ', ').replace('\r', '')
    parts = [p.strip() for p in addr.split(',') if p.strip()]
    if len(parts) >= 2:
        # street + city (skip state/zip)
        return _sanitize_filename(f"{parts[0]}, {parts[1]}")
    if parts:
        return _sanitize_filename(parts[0])
    return ''


@router.post("/quick-estimate", response_model=EstimateResponse)
async def quick_estimate(
    request: QuickEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Generate a quick estimate from room presets and configuration."""
    calculator = EstimateCalculator(db, current_user.company_id)
    result = calculator.calculate_estimate(request)
    # Validate output for issues (duplicate lines, count mismatches)
    if result.section_details:
        from app.domains.tools.modules.packing.service import validate_estimate_output
        warnings = validate_estimate_output(result.section_details)
        if warnings:
            result.notes = (result.notes or []) + [f"⚠ {w}" for w in warnings]
    return result


@router.post("/content-estimate", response_model=EstimateResponse)
async def content_estimate(
    request: RoomsEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Generate an estimate from a detailed per-room item inventory."""
    calculator = EstimateCalculator(db, current_user.company_id)
    result = calculator.calculate_estimate_from_content(request)
    # Validate output for issues (duplicate lines, count mismatches)
    if result.section_details:
        from app.domains.tools.modules.packing.service import validate_estimate_output
        warnings = validate_estimate_output(result.section_details)
        if warnings:
            result.notes = (result.notes or []) + [f"⚠ {w}" for w in warnings]
    return result


@router.post("/packout-estimate", response_model=PackoutEstimateResponse)
async def packout_estimate(
    request: PackoutEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Generate a packout estimate from room-level box/item counts."""
    from app.domains.tools.modules.packing.packout_service import PackoutCalculator
    calculator = PackoutCalculator(db, current_user.company_id)
    return calculator.calculate_packout(request)


@router.post("/classify-for-packout")
async def classify_for_packout(
    request: dict,
    current_user: User = Depends(_gate),
):
    """Classify AI-detected items into packout categories (non-boxable + box counts)."""
    from app.domains.tools.modules.packing.packout_classifier import classify_items_for_packout
    items = [DetectedContentItem(**i) for i in request.get("items", [])]
    detail_level = request.get("detail_level", "detailed")
    room_size = request.get("room_size", "large")
    return classify_items_for_packout(items, detail_level, room_size)


@router.post("/analyze-room", response_model=RoomAnalysisResponse)
async def analyze_room(
    request: RoomPhotoAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Analyze room photos using Claude Vision to produce an itemized content list."""
    from app.domains.tools.modules.packing import vision

    try:
        logger.info("analyze-room: room=%s, images=%d", request.room_name, len(request.images))
        result = await vision.analyze_room_photos(
            room_name=request.room_name,
            images=request.images,
            existing_items=request.existing_items,
        )
        logger.info("analyze-room: success, items=%d", len(result.items))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("analyze-room failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Room photo analysis is currently unavailable: {exc}",
        ) from exc


@router.post("/analyze-batch")
async def analyze_batch(
    request: BatchRoomAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Stream batch room analysis results as SSE.

    Each room emits one 'room_result' event. A final
    'batch_complete' event is always emitted.
    """
    import asyncio
    from app.domains.tools.modules.packing import vision
    from app.core.config import settings as app_settings

    delay = app_settings.VISION_BATCH_INTER_ROOM_DELAY
    total = len(request.rooms)
    batch_id = request.batch_id

    async def event_stream():
        succeeded = 0
        failed = 0
        failed_rooms: list[str] = []

        for idx, room_req in enumerate(request.rooms):
            result, err_code, err_msg = (
                await vision.analyze_room_with_retry(
                    room_name=room_req.room_name,
                    images=room_req.images,
                    existing_items=room_req.existing_items,
                    max_retries=(
                        app_settings.VISION_RATE_LIMIT_RETRIES
                    ),
                    base_delay=(
                        app_settings.VISION_RATE_LIMIT_BASE_DELAY
                    ),
                )
            )

            if result is not None:
                succeeded += 1
                event = BatchRoomEvent(
                    batch_id=batch_id,
                    room_index=idx,
                    total_rooms=total,
                    status=RoomAnalysisStatus.SUCCESS,
                    room_name=room_req.room_name,
                    result=result,
                )
            else:
                failed += 1
                failed_rooms.append(room_req.room_name)
                event = BatchRoomEvent(
                    batch_id=batch_id,
                    room_index=idx,
                    total_rooms=total,
                    status=RoomAnalysisStatus.ERROR,
                    room_name=room_req.room_name,
                    error_code=err_code,
                    error_message=err_msg,
                )

            payload = event.model_dump_json(
                exclude_none=True,
            )
            yield (
                f"event: room_result\n"
                f"data: {payload}\n\n"
            )

            if idx < total - 1:
                await asyncio.sleep(delay)

        complete = BatchCompleteEvent(
            batch_id=batch_id,
            total_rooms=total,
            succeeded=succeeded,
            failed=failed,
            failed_rooms=failed_rooms,
        )
        yield (
            f"event: batch_complete\n"
            f"data: {complete.model_dump_json()}\n\n"
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/master-content", response_model=MasterContentResponse)
async def master_content(
    request: MasterContentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Aggregate per-room item lists into a single master content inventory."""
    from app.domains.tools.modules.packing import vision

    try:
        return vision.build_master_content_list(request.rooms)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Master content aggregation failed: {exc}",
        ) from exc


@router.post("/corrections", response_model=SubmitCorrectionsResponse)
async def submit_corrections(
    request: SubmitCorrectionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Store analyst corrections for detected room items.

    Corrections are associated with the session when a session_id is provided.
    Returns the count of corrections saved.
    """
    if request.session_id:
        from app.domains.tools.service import ToolSessionService
        from uuid import UUID

        session_service = ToolSessionService(db)
        try:
            session_id = UUID(request.session_id)
            tool_session = session_service.get_session(session_id, current_user.company_id)

            existing_data: dict = tool_session.data or {}
            corrections_store: list = existing_data.get("corrections", [])
            corrections_store.append({
                "room_name": request.room_name,
                "corrections": [c.model_dump() for c in request.corrections],
            })
            existing_data["corrections"] = corrections_store
            session_service.update_session_data(
                session_id=session_id,
                company_id=current_user.company_id,
                data=existing_data,
            )
        except Exception:
            # Non-fatal: session storage failure should not block the workflow
            pass

    return SubmitCorrectionsResponse(saved=len(request.corrections))


@router.post("/export/pdf")
async def export_pdf(
    request: ExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Export a saved estimate session as a PDF attachment."""
    if generate_estimate_pdf is None:
        raise HTTPException(
            status_code=503,
            detail="PDF export is unavailable. The 'reportlab' package is not installed.",
        )

    from app.domains.tools.service import ToolSessionService
    from app.domains.company.models import Company
    from uuid import UUID
    import asyncio

    session_service = ToolSessionService(db)
    tool_session = session_service.get_session(
        UUID(request.session_id), current_user.company_id
    )

    company = (
        db.query(Company)
        .filter(Company.id == current_user.company_id)
        .first()
    )

    override_dict = request.company_override.model_dump() if request.company_override else None
    company_info = build_company_info(company, override_dict)
    session_data = tool_session.data or {}
    client_info = session_data.get("client_info", {})
    settings = session_data.get("settings", {})

    # Merge result with settings so export has access to storage_months,
    # include_packback, staging_type, crew_size, etc.
    estimate_data = {**settings, **(session_data.get("result") or session_data)}

    property_address = client_info.get("property_address")

    # Build notes string from result-level notes (e.g. workday scheduling)
    result_notes = (session_data.get("result") or {}).get("notes", [])
    notes_str = "\n".join(result_notes) if result_notes else None

    # Run CPU-bound PDF generation in thread pool to avoid blocking event loop
    pdf_bytes = await asyncio.to_thread(
        generate_estimate_pdf,
        estimate_data=estimate_data,
        client_name=client_info.get("name"),
        client_phone=client_info.get("phone"),
        client_email=client_info.get("email"),
        property_address=property_address,
        company_info=company_info,
        tax_rate=request.tax_rate,
        notes=notes_str,
        show_breakdown=request.show_breakdown,
    )

    # Filename: Pack Out Estimate - 123 Main St, Dallas - EST-2025-AB1234.pdf
    addr_slug = _build_address_slug(property_address)
    est_num = request.session_id[:8]
    fname_parts = ["Pack Out Estimate"]
    if addr_slug:
        fname_parts.append(addr_slug)
    fname_parts.append(est_num)
    filename = _sanitize_filename(" - ".join(fname_parts)) + ".pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.post("/export/excel")
async def export_excel(
    request: ExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Export a saved estimate session as an Excel attachment."""
    if generate_estimate_excel is None:
        raise HTTPException(
            status_code=503,
            detail="Excel export is unavailable. The required export package is not installed.",
        )

    from app.domains.tools.service import ToolSessionService
    from app.domains.company.models import Company
    from uuid import UUID

    session_service = ToolSessionService(db)
    tool_session = session_service.get_session(
        UUID(request.session_id), current_user.company_id
    )

    company = (
        db.query(Company)
        .filter(Company.id == current_user.company_id)
        .first()
    )

    override_dict = request.company_override.model_dump() if request.company_override else None
    company_info = build_company_info(company, override_dict)
    session_data = tool_session.data or {}
    client_info = session_data.get("client_info", {})
    settings = session_data.get("settings", {})

    # Merge result with settings so export has access to storage_months,
    # include_packback, staging_type, crew_size, etc.
    estimate_data = {**settings, **(session_data.get("result") or session_data)}

    import asyncio
    property_address = client_info.get("property_address")

    # Build notes string from result-level notes (e.g. workday scheduling)
    result_notes = (session_data.get("result") or {}).get("notes", [])
    notes_str = "\n".join(result_notes) if result_notes else None

    excel_bytes = await asyncio.to_thread(
        generate_estimate_excel,
        estimate_data=estimate_data,
        client_name=client_info.get("name"),
        client_phone=client_info.get("phone"),
        client_email=client_info.get("email"),
        property_address=property_address,
        company_info=company_info,
        tax_rate=request.tax_rate,
        notes=notes_str,
        show_breakdown=request.show_breakdown,
    )

    addr_slug = _build_address_slug(property_address)
    est_num = request.session_id[:8]
    fname_parts = ["Pack Out Estimate"]
    if addr_slug:
        fname_parts.append(addr_slug)
    fname_parts.append(est_num)
    filename = _sanitize_filename(" - ".join(fname_parts)) + ".xlsx"

    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.post("/export/report")
async def export_report(
    request: ReportExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Export a packing report PDF with selectable sections."""
    if generate_report_pdf is None:
        raise HTTPException(
            status_code=503,
            detail="Report export unavailable. "
                   "Required packages not installed.",
        )

    from app.domains.tools.service import ToolSessionService
    from app.domains.company.models import Company
    from uuid import UUID

    session_service = ToolSessionService(db)
    tool_session = session_service.get_session(
        UUID(request.session_id), current_user.company_id,
    )

    company = (
        db.query(Company)
        .filter(Company.id == current_user.company_id)
        .first()
    )

    override_dict = (
        request.company_override.model_dump()
        if request.company_override else None
    )
    company_info = build_company_info(company, override_dict)
    session_data = tool_session.data or {}
    client_info = session_data.get("client_info", {})

    # Helper: load photos from storage keys for report embedding
    def _load_photos_from_keys(photo_keys: list, room_name: str) -> list:
        """Read photo_keys from storage and return base64 report photo dicts."""
        from app.core.storage import get_storage
        import base64 as b64mod
        if not photo_keys:
            return []
        storage = get_storage()
        photos = []
        for idx, key in enumerate(photo_keys):
            try:
                data = storage.read(key)
                ext = key.rsplit(".", 1)[-1].lower() if "." in key else "jpg"
                mime = {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
                encoded = b64mod.b64encode(data).decode("ascii")
                photos.append({
                    "image": f"data:{mime};base64,{encoded}",
                    "caption": f"{room_name} - Photo {idx + 1}",
                    "is_damage": False,
                })
            except Exception:
                continue
        return photos

    # Build rooms data from request or fall back to session
    rooms_data = []
    session_photo_rooms = session_data.get("photo_rooms", [])

    # Field notes & per-room labor: regenerate from current items
    calc = EstimateCalculator(db=db, company_id=current_user.company_id)
    crew_size = (session_data.get("result") or session_data).get("crew_size", 4)

    def _compute_room_labor(items: list, room_name: str) -> tuple:
        """Compute per-room labor hours and build labor notes from items.

        Returns (labor_hours, labor_notes_str).
        """
        result = calc.compute_room_labor_and_notes(
            items, crew_size=crew_size, include_field_notes=False,
        )
        return result["labor_hours"], result["labor_notes"]

    if request.rooms:
        rooms_data = [r.model_dump() for r in request.rooms]
        # Inject storage-backed photos and compute per-room labor
        for i, rd in enumerate(rooms_data):
            existing_photos = rd.get("photos") or []
            has_real_photos = any(
                isinstance(p, dict) and isinstance(p.get("image"), str) and len(p["image"]) > 200
                for p in existing_photos
            )
            if not has_real_photos:
                room_name = rd.get("room_name", "")
                # Try exact match first, then normalized match (ignore case/whitespace)
                matching = next(
                    (pr for pr in session_photo_rooms if pr.get("room_name") == room_name),
                    None,
                )
                if not matching:
                    norm = room_name.strip().lower()
                    matching = next(
                        (pr for pr in session_photo_rooms
                         if (pr.get("room_name") or "").strip().lower() == norm),
                        None,
                    )
                # Also try positional fallback if name matching fails
                if not matching and i < len(session_photo_rooms):
                    matching = session_photo_rooms[i]
                if matching:
                    keys = matching.get("photo_keys", [])
                    if keys:
                        rd["photos"] = _load_photos_from_keys(keys, room_name)
                    elif matching.get("photos"):
                        # Fallback: inline base64 photos from session
                        raw = matching["photos"]
                        rd["photos"] = [
                            {"image": p if p.startswith("data:") else f"data:image/jpeg;base64,{p}",
                             "caption": f"{room_name} - Photo {idx + 1}",
                             "is_damage": False}
                            for idx, p in enumerate(raw)
                            if isinstance(p, str) and len(p) > 100
                        ]
            # Compute per-room labor if not already provided
            if rd.get("labor_hours") is None:
                room_labor, room_labor_notes = _compute_room_labor(
                    rd.get("items", []), rd.get("room_name", ""),
                )
                rd["labor_hours"] = room_labor
                rd["labor_notes"] = room_labor_notes
    else:
        # Auto-build from session photo_rooms or room_summaries
        photo_rooms = session_photo_rooms
        result = session_data.get("result", {})
        room_summaries = result.get("room_summaries", [])

        if photo_rooms:
            for pr in photo_rooms:
                room_name = pr.get("room_name", "")
                # Try photo_keys first, then fall back to inline base64
                photo_keys = pr.get("photo_keys", [])
                if photo_keys:
                    report_photos = _load_photos_from_keys(photo_keys, room_name)
                else:
                    raw_photos = pr.get("photos", [])
                    report_photos = [
                        {"image": p, "caption": "", "is_damage": False}
                        for p in raw_photos
                        if isinstance(p, str) and len(p) > 100
                    ]
                room_items = pr.get("items", [])
                room_labor, room_labor_notes = _compute_room_labor(room_items, room_name)
                rooms_data.append({
                    "room_name": room_name,
                    "items": room_items,
                    "photos": report_photos,
                    "field_notes": pr.get("field_notes", []),
                    "labor_hours": room_labor,
                    "labor_notes": room_labor_notes,
                })
        elif room_summaries:
            for rs in room_summaries:
                rs_items = rs.get("items", [])
                rs_labor, rs_labor_notes = _compute_room_labor(rs_items, rs.get("room_name", ""))
                rooms_data.append({
                    "room_name": rs.get("room_name", ""),
                    "items": rs_items,
                    "photos": [],
                    "field_notes": rs.get(
                        "packing_notes", [],
                    ),
                    "labor_hours": rs_labor,
                    "labor_notes": rs_labor_notes,
                })

    # Regenerate field_notes from current items (reflects user edits)
    if request.include_field_notes:
        for rd in rooms_data:
            items = rd.get("items") or []
            if items:
                # Build lightweight item objects for generate_field_notes
                class _Item:
                    pass
                item_objs = []
                for it in items:
                    obj = _Item()
                    if isinstance(it, dict):
                        for k, v in it.items():
                            setattr(obj, k, v)
                    else:
                        obj = it
                    item_objs.append(obj)
                rd["field_notes"] = calc.generate_field_notes(item_objs)
            else:
                rd["field_notes"] = []
    else:
        # User opted out of field notes
        for rd in rooms_data:
            rd["field_notes"] = []

    sections_cfg = (
        request.sections.model_dump()
        if request.sections else {}
    )

    import asyncio
    property_address = client_info.get("property_address")
    pdf_bytes = await asyncio.to_thread(
        generate_report_pdf,
        session_data=session_data,
        rooms_data=rooms_data,
        sections_config=sections_cfg,
        client_name=client_info.get("name"),
        client_phone=client_info.get("phone"),
        client_email=client_info.get("email"),
        property_address=property_address,
        company_info=company_info,
        tax_rate=request.tax_rate,
        notes=request.notes,
        include_signature_page=request.include_signature_page,
        include_field_notes=request.include_field_notes,
        image_quality=request.image_quality,
        max_image_width=request.max_image_width,
        photos_per_page=request.photos_per_page,
    )

    addr_slug = _build_address_slug(property_address)
    sid = request.session_id[:8]
    include_pb = (session_data.get("result") or session_data).get("include_packback", False)
    report_label = "Content Pack-Out Pack-Back Report" if include_pb else "Content Pack-Out Report"
    fname_parts = [report_label]
    if addr_slug:
        fname_parts.append(addr_slug)
    fname_parts.append(sid)
    filename = _sanitize_filename(" - ".join(fname_parts)) + ".pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.get("/presets")
async def get_presets(
    current_user: User = Depends(_gate),
):
    """Return all room presets grouped by category."""
    return get_presets_by_category()


@router.get("/prices")
async def get_prices(
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Return the company's Moving line items from the line item library."""
    from app.domains.line_item.models import LineItem

    items = (
        db.query(LineItem)
        .filter(
            LineItem.company_id == current_user.company_id,
            LineItem.is_active == True,
            LineItem.tool_id == "packing",
        )
        .order_by(LineItem.cat, LineItem.name)
        .all()
    )

    return [
        {
            "id": str(item.id),
            "code": item.code,
            "name": item.name,
            "unit": item.unit,
            "unit_price": float(item.unit_price),
            "cat": item.cat,
            "is_taxable": item.is_taxable,
        }
        for item in items
    ]


# ── Company Profiles ───────────────────────────────────────────────────────

PROFILES_TOOL_ID = "packing_company_profiles"


class CompanyProfileData(BaseModel):
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    license: str | None = None


class CompanyProfile(BaseModel):
    id: str
    label: str
    data: CompanyProfileData


class SaveProfileRequest(BaseModel):
    label: str
    data: CompanyProfileData


def _get_profiles_session(db: Session, company_id):
    """Get or create the single ToolSession that stores company profiles."""
    from app.domains.tools.models import ToolSession
    session = (
        db.query(ToolSession)
        .filter(
            ToolSession.company_id == company_id,
            ToolSession.tool_id == PROFILES_TOOL_ID,
            ToolSession.is_active == True,
        )
        .first()
    )
    return session


@router.get("/company-profiles")
async def list_company_profiles(
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Return all saved company profiles for this company."""
    session = _get_profiles_session(db, current_user.company_id)
    if not session:
        return []
    return session.data.get("profiles", [])


@router.post("/company-profiles", status_code=201)
async def save_company_profile(
    request: SaveProfileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Save or update a company profile. If a profile with the same label exists, update it."""
    from app.domains.tools.models import ToolSession
    from app.common.utils import generate_uuid

    session = _get_profiles_session(db, current_user.company_id)

    if not session:
        session = ToolSession(
            company_id=current_user.company_id,
            created_by=current_user.id,
            tool_id=PROFILES_TOOL_ID,
            name="Company Profiles",
            data={"profiles": []},
        )
        db.add(session)

    profiles: list = session.data.get("profiles", [])

    # Check for existing profile with same label
    existing = next((p for p in profiles if p.get("label") == request.label), None)
    if existing:
        existing["data"] = request.data.model_dump()
        profile = existing
    else:
        profile = {
            "id": str(generate_uuid()),
            "label": request.label,
            "data": request.data.model_dump(),
        }
        profiles.append(profile)

    # Force JSONB update detection
    session.data = {**session.data, "profiles": profiles}
    db.commit()
    return profile


@router.delete("/company-profiles/{profile_id}")
async def delete_company_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Delete a saved company profile."""
    session = _get_profiles_session(db, current_user.company_id)
    if not session:
        raise HTTPException(status_code=404, detail="Profile not found")

    profiles: list = session.data.get("profiles", [])
    new_profiles = [p for p in profiles if p.get("id") != profile_id]
    if len(new_profiles) == len(profiles):
        raise HTTPException(status_code=404, detail="Profile not found")

    session.data = {**session.data, "profiles": new_profiles}
    db.commit()
    return {"deleted": True}


# ── Address Autocomplete ──────────────────────────────────────────────────

@router.get("/address-autocomplete")
async def address_autocomplete(
    q: str,
    current_user: User = Depends(_gate),
):
    """Proxy address autocomplete via Geoapify (free tier: 3000 req/day).

    Returns a list of address suggestions for the given query string.
    Filters to US addresses only.
    """
    import httpx

    api_key = settings.GEOAPIFY_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="Address autocomplete not configured. Set GEOAPIFY_API_KEY.")

    if len(q.strip()) < 3:
        return []

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            "https://api.geoapify.com/v1/geocode/autocomplete",
            params={
                "text": q,
                "type": "street",
                "filter": "countrycode:us",
                "format": "json",
                "limit": 5,
                "apiKey": api_key,
            },
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        results = data.get("results", [])

        return [
            {
                "address": r.get("formatted", ""),
                "street": r.get("address_line1", ""),
                "city": r.get("city", ""),
                "state": r.get("state", ""),
                "zip": r.get("postcode", ""),
            }
            for r in results
            if r.get("formatted")
        ]


# ── Photo Storage ──────────────────────────────────────────────────────────

class PhotoUploadRequest(BaseModel):
    images: List[str]  # base64 encoded (raw or data URI)

class PhotoUploadResponse(BaseModel):
    photo_keys: List[str]  # storage keys for uploaded photos


@router.post("/photos/upload", response_model=PhotoUploadResponse)
async def upload_photos(
    request: PhotoUploadRequest,
    current_user: User = Depends(_gate),
):
    """Upload base64 photos to storage. Returns storage keys for later retrieval."""
    from app.core.storage import get_storage

    storage = get_storage()
    photo_keys: list[str] = []

    for img_b64 in request.images:
        raw = img_b64
        media_type = "image/jpeg"
        if raw.startswith("data:"):
            parts = raw.split(",", 1)
            if len(parts) > 1:
                media_type = parts[0].split(":")[1].split(";")[0]
                raw = parts[1]

        try:
            img_bytes = base64.b64decode(raw)
        except Exception:
            continue

        ext = {"image/png": ".png", "image/webp": ".webp"}.get(media_type, ".jpg")
        file_id = str(uuid.uuid4())
        key = f"{current_user.company_id}/packing/photos/{file_id}{ext}"
        storage.write(key, img_bytes, content_type=media_type)
        photo_keys.append(key)

    return PhotoUploadResponse(photo_keys=photo_keys)


@router.get("/photos/{file_id:path}")
async def serve_photo(
    file_id: str,
    token: str | None = None,
    current_user: User = Depends(_gate),
):
    """Serve a stored photo by its storage key."""
    from app.core.storage import get_storage, LocalStorage
    from fastapi.responses import FileResponse
    import os

    company_prefix = str(current_user.company_id)
    if not file_id.startswith(company_prefix):
        raise HTTPException(status_code=403, detail="Access denied")

    ext = file_id.rsplit(".", 1)[-1].lower() if "." in file_id else "jpg"
    media_type = {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

    storage = get_storage()

    # Fast path: local storage → serve file directly (zero-copy, sendfile)
    if isinstance(storage, LocalStorage):
        file_path = os.path.join(storage.base_dir, file_id)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Photo not found")
        return FileResponse(
            file_path,
            media_type=media_type,
            headers={"Cache-Control": "private, max-age=86400"},
        )

    # R2/remote: read into memory
    try:
        data = storage.read(file_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Photo not found")

    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )
