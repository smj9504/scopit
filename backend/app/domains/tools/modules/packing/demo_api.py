"""
ScopeIt - Public Packing Estimator Demo API

Fully unauthenticated endpoints backing the /demo/packing marketing page.
No AI vision calls are made, no database rows are written, and nothing is
persisted across requests — every response is derived from the fixture
data in demo/fixtures.py plus whatever edits the caller submits.
"""
import base64
import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.modules.packing.demo.fixtures import (
    DEMO_PHOTO_FILENAMES,
    DEMO_ROOMS,
    PHOTOS_DIR,
    DemoRoomFixture,
)
from app.domains.tools.modules.packing.service import EstimateCalculator
from app.domains.tools.modules.packing.schemas import (
    CompanyInfoOverride,
    EstimateResponse,
    ReportRoomData,
    ReportRoomPhoto,
    ReportSections,
    RoomAnalysisResponse,
    RoomsEstimateRequest,
)

try:
    from app.domains.tools.modules.packing.export import (
        build_company_info,
        generate_estimate_excel,
        generate_estimate_pdf,
        generate_report_pdf,
    )
except ImportError:
    build_company_info = None
    generate_estimate_excel = None
    generate_estimate_pdf = None
    generate_report_pdf = None

router = APIRouter()

# Bounds on a public, unauthenticated endpoint to keep compute/PDF-render cost small.
MAX_DEMO_ROOMS = 5
MAX_ITEMS_PER_ROOM = 60


# ── Schemas (demo-only; intentionally not coupled to the session-based real flow) ──

class DemoRoomSummary(BaseModel):
    room_key: str
    room_name: str
    photo_urls: List[str]


class DemoFixtureRoom(BaseModel):
    """Everything needed to seed one real PhotoRoom client-side in one call:
    the canned analysis result plus the sample photos already embedded as
    base64, in the same shape the real tool keeps in-memory after upload."""
    room_key: str
    room_name: str
    photos: List[ReportRoomPhoto]
    analysis: RoomAnalysisResponse


class DemoAnalyzeRequest(BaseModel):
    room_key: str


class DemoReportRequest(BaseModel):
    """Mirrors the real ReportExportRequest minus session_id — rooms carry
    their own photos (base64) from the caller, exactly like the real
    ReportExportModal sends, whether those photos came from our fixtures or
    a room the visitor added themselves with their own uploaded photos."""
    rooms: List[ReportRoomData]
    sections: ReportSections = Field(default_factory=ReportSections)
    company_override: Optional[CompanyInfoOverride] = None
    tax_rate: float = Field(default=0.0, ge=0, le=100)
    notes: Optional[str] = None
    include_signature_page: bool = False
    include_field_notes: bool = True
    image_quality: int = Field(default=60, ge=20, le=90)
    max_image_width: int = Field(default=800, ge=400, le=1200)
    photos_per_page: int = Field(default=2)


class DemoEstimatePdfRequest(BaseModel):
    result: EstimateResponse
    company_override: Optional[CompanyInfoOverride] = None
    tax_rate: float = Field(default=0.0, ge=0, le=100)


MAX_PHOTOS_PER_ROOM = 15


def _get_fixture(room_key: str) -> DemoRoomFixture:
    fixture = DEMO_ROOMS.get(room_key)
    if not fixture:
        raise HTTPException(status_code=404, detail=f"Unknown demo room '{room_key}'")
    return fixture


def _fixture_photos_as_base64(fixture: DemoRoomFixture) -> list[dict]:
    """Read a fixture room's sample photos off disk and embed them as base64,
    in the same shape generate_report_pdf expects for ReportRoomPhoto."""
    photos = []
    for idx, filename in enumerate(fixture.photo_filenames):
        path = PHOTOS_DIR / filename
        if not path.is_file():
            continue
        mime = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        photos.append({
            "image": f"data:{mime};base64,{encoded}",
            "caption": f"{fixture.room_name} - Photo {idx + 1}",
            "is_damage": False,
        })
    return photos


@router.get("/rooms", response_model=List[DemoRoomSummary])
async def list_demo_rooms():
    """List the sample rooms available to try in the demo."""
    return [
        DemoRoomSummary(
            room_key=fixture.room_key,
            room_name=fixture.room_name,
            photo_urls=[
                # Relative to this router's own mount point (see main.py),
                # so the frontend can prefix it with whatever API origin
                # it's configured with (VITE_API_URL) instead of assuming
                # same-origin deployment.
                f"/demo/packing/photos/{filename}"
                for filename in fixture.photo_filenames
            ],
        )
        for fixture in DEMO_ROOMS.values()
    ]


@router.get("/fixtures", response_model=List[DemoFixtureRoom])
async def get_demo_fixtures():
    """Full fixture payload for the demo frontend: every sample room with its
    photos already embedded as base64 and its canned analysis result — one
    call gives the frontend everything it needs to seed real PhotoRoom state
    (the same shape the production tool keeps in memory after a real upload
    + analyze), so the demo can render the actual PhotoAITab/EstimateEditorModal
    components pre-populated instead of re-fetching per room."""
    return [
        DemoFixtureRoom(
            room_key=fixture.room_key,
            room_name=fixture.room_name,
            photos=[ReportRoomPhoto(**p) for p in _fixture_photos_as_base64(fixture)],
            analysis=fixture.analysis,
        )
        for fixture in DEMO_ROOMS.values()
    ]


@router.get("/photos/{filename}")
async def serve_demo_photo(filename: str):
    """Serve a sample content photo. Allowlisted to known fixture filenames
    only, so this can never be used to read arbitrary files off disk."""
    if filename not in DEMO_PHOTO_FILENAMES:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = PHOTOS_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found")
    media_type = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
    return FileResponse(path, media_type=media_type)


@router.post("/analyze", response_model=None)
async def analyze_demo_room(request: DemoAnalyzeRequest):
    """Return the canned 'AI analysis' result for a sample room.

    No AI call is made — this always returns the same hand-authored result
    for a given room_key, per the demo's design (fixed sample photos, fixed
    analysis, editable from there).
    """
    fixture = _get_fixture(request.room_key)
    return fixture.analysis


@router.post("/estimate", response_model=EstimateResponse)
async def calculate_demo_estimate(
    request: RoomsEstimateRequest,
    db: Session = Depends(get_db),
):
    """Calculate a real estimate from the (possibly edited) demo room items.

    Reuses the same EstimateCalculator the authenticated tool uses.
    company_id=None skips every company-scoped DB lookup and falls back to
    DEFAULT_PRICES (see service.py:_load_prices) — nothing here reads or
    writes company data.
    """
    if len(request.rooms) > MAX_DEMO_ROOMS:
        raise HTTPException(
            status_code=400,
            detail=f"The demo is limited to {MAX_DEMO_ROOMS} rooms.",
        )
    for room in request.rooms:
        if len(room.items) > MAX_ITEMS_PER_ROOM:
            raise HTTPException(
                status_code=400,
                detail=f"The demo is limited to {MAX_ITEMS_PER_ROOM} items per room.",
            )

    calc = EstimateCalculator(db=db, company_id=None)
    return calc.calculate_estimate_from_content(request)


@router.post("/report")
async def export_demo_report(
    request: DemoReportRequest,
    db: Session = Depends(get_db),
):
    """Generate a packing report PDF from the caller's rooms — items and
    photos both come from the request body, exactly like the real
    /export/report endpoint, minus the session/company DB lookups. Photos
    may be our fixture images (round-tripped from GET /fixtures) or a room
    the visitor added themselves with their own uploaded photos — either
    way nothing is written to disk or a database; this is a pure render."""
    if generate_report_pdf is None:
        raise HTTPException(status_code=503, detail="Report export unavailable.")
    if len(request.rooms) > MAX_DEMO_ROOMS:
        raise HTTPException(
            status_code=400,
            detail=f"The demo is limited to {MAX_DEMO_ROOMS} rooms.",
        )
    for room in request.rooms:
        if room.items and len(room.items) > MAX_ITEMS_PER_ROOM:
            raise HTTPException(
                status_code=400,
                detail=f"The demo is limited to {MAX_ITEMS_PER_ROOM} items per room.",
            )
        if len(room.photos) > MAX_PHOTOS_PER_ROOM:
            raise HTTPException(
                status_code=400,
                detail=f"The demo is limited to {MAX_PHOTOS_PER_ROOM} photos per room.",
            )

    calc = EstimateCalculator(db=db, company_id=None)
    crew_size = 4

    rooms_data = []
    for room in request.rooms:
        items = room.items or []
        item_dicts = [i.model_dump() for i in items]
        labor = calc.compute_room_labor_and_notes(
            item_dicts, crew_size=crew_size, include_field_notes=request.include_field_notes,
        )
        rooms_data.append({
            "room_name": room.room_name,
            "items": item_dicts,
            "photos": [p.model_dump() for p in room.photos],
            "field_notes": labor["field_notes"] if request.include_field_notes else room.field_notes,
            "labor_hours": room.labor_hours if room.labor_hours is not None else labor["labor_hours"],
            "labor_notes": room.labor_notes or labor["labor_notes"],
        })

    override_dict = request.company_override.model_dump() if request.company_override else None
    company_info = build_company_info(None, override_dict)
    sections_cfg = request.sections.model_dump()

    import asyncio
    pdf_bytes = await asyncio.to_thread(
        generate_report_pdf,
        session_data={},
        rooms_data=rooms_data,
        sections_config=sections_cfg,
        client_name=None,
        client_phone=None,
        client_email=None,
        property_address=None,
        company_info=company_info,
        tax_rate=request.tax_rate,
        notes=request.notes,
        include_signature_page=request.include_signature_page,
        include_field_notes=request.include_field_notes,
        image_quality=request.image_quality,
        max_image_width=request.max_image_width,
        photos_per_page=request.photos_per_page,
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="ScopeIt Demo Packing Report.pdf"'
        },
    )


@router.post("/estimate/pdf")
async def export_demo_estimate_pdf(request: DemoEstimatePdfRequest):
    """Generate a plain estimate PDF from a previously-calculated demo estimate."""
    if generate_estimate_pdf is None:
        raise HTTPException(status_code=503, detail="PDF export unavailable.")

    override_dict = request.company_override.model_dump() if request.company_override else None
    company_info = build_company_info(None, override_dict)

    import asyncio
    pdf_bytes = await asyncio.to_thread(
        generate_estimate_pdf,
        estimate_data=request.result.model_dump(),
        client_name=None,
        client_phone=None,
        client_email=None,
        property_address=None,
        company_info=company_info,
        tax_rate=request.tax_rate,
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="ScopeIt Demo Estimate.pdf"'
        },
    )


@router.post("/estimate/excel")
async def export_demo_estimate_excel(request: DemoEstimatePdfRequest):
    """Generate a plain estimate Excel workbook from a previously-calculated
    demo estimate (mirrors the real /export/excel endpoint)."""
    if generate_estimate_excel is None:
        raise HTTPException(status_code=503, detail="Excel export unavailable.")

    override_dict = request.company_override.model_dump() if request.company_override else None
    company_info = build_company_info(None, override_dict)

    import asyncio
    xlsx_bytes = await asyncio.to_thread(
        generate_estimate_excel,
        estimate_data=request.result.model_dump(),
        client_name=None,
        client_phone=None,
        client_email=None,
        property_address=None,
        company_info=company_info,
        tax_rate=request.tax_rate,
    )

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="ScopeIt Demo Estimate.xlsx"'
        },
    )
