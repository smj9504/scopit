"""
Scopit - Cabinet Estimator API

Kitchen cabinet estimates: the boxes, the scope around them, the
calculation, the layout sketch with its 3D view, options for the customer,
the PDFs and the supplier's purchase order. Every route is limited to the
signed-in user's company. Ported from MJ Estimate's cabinet_estimate API.
"""
import logging
import re
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access
from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import resolved, use_prices
from app.domains.user.models import User

from .pricing import (
    APPLIANCE_RESET_PRICES,
    APPLIANCE_RR_PRICING,
    BACKSPLASH_TYPES,
    COUNTERTOP_BACKSPLASH_PER_LF,
    COUNTERTOP_MATERIALS,
    COUNTERTOP_SUPPORT_RULE,
    CROWN_MOLDING_PRICING,
    DOOR_STYLES,
    END_PANEL_TYPES,
    GLASS_DOOR_PREMIUM,
    ISLAND_PANEL_PRICING,
    LAYOUT_TYPES,
    OVERLAY_STYLES,
    PREFAB_ISLAND_INSTALL,
    PREFAB_ISLAND_PRICING,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    TALL_CABINET_TYPES,
)
from .rate_meta import Basis
from .schemas import (
    BoxMaterial,
    CabinetEstimateCreate,
    CabinetEstimateGroupResponse,
    CabinetEstimateListResponse,
    CabinetEstimateResponse,
    CabinetEstimateUpdate,
    CabinetTier,
    CabType,
    FinishType,
    HistoryResponse,
    OptionLabelUpdate,
    PricingInfoResponse,
    ProjectTypeUpdate,
    PurchaseOrderResponse,
    SelectionUpdate,
)
from .selections import SLOTS
from .service import CabinetEstimateService
from .sketch_schemas import (
    CabinetSketchAiPhotoRequest,
    CabinetSketchAiPhotoResponse,
    CabinetSketchOverlayData,
    CabinetSketchResponse,
    CabinetSketchUpdate,
)

logger = logging.getLogger(__name__)

TOOL_ID = "cabinet_estimate"
router = APIRouter()
_gate = require_tool_access(TOOL_ID)

NOT_FOUND = "Estimate not found"


def _service(db: Session, user: User) -> CabinetEstimateService:
    return CabinetEstimateService(db, user.company_id)


def _or_404(result):
    if not result:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return result


# ── Pricing info (for the form's dropdowns) ──

@router.get("/pricing-info", response_model=PricingInfoResponse)
def get_pricing_info(
    estimate_id: Optional[str] = Query(
        None, description="Quote this estimate's prices (its price book, or its company's today)",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Options and pricing constants for the estimate form.

    With an estimate, the rates are the ones it is priced with; without,
    the defaults."""
    if not estimate_id:
        return resolved(_pricing_info())
    estimate = _or_404(_service(db, current_user).find(estimate_id))
    with use_prices(UnitPriceService(db).prices_for("cabinet", estimate)):
        return resolved(_pricing_info())


def _pricing_info() -> Dict[str, Any]:
    return {
        "tiers": CabinetTier.choices(),
        "materials": BoxMaterial.choices(),
        "finishes": FinishType.choices(),
        "door_styles": DOOR_STYLES,
        "overlay_styles": OVERLAY_STYLES,
        "pricing_bases": [
            {
                "key": Basis.INSURANCE_DR.value,
                "label": "Insurance claim",
                "description": "Detach & reset at crew time only — no per-appliance trip charge.",
            },
            {
                "key": Basis.RETAIL_INSTALL.value,
                "label": "Retail remodel",
                "description": "Installer pricing. Carries a trip minimum on each appliance.",
            },
        ],
        "layout_types": LAYOUT_TYPES,
        "cab_types": CabType.choices(),
        "specialty_types": list(SPECIALTY_PREMIUM.keys()),
        "end_panel_types": END_PANEL_TYPES,
        "scope_items": SCOPE_ITEMS,
        "backsplash_types": [
            {
                "key": k,
                "label": v["label"],
                "material_per_sf": v["material_per_sf"],
                "install_per_sf": v["install_per_sf"],
            }
            for k, v in BACKSPLASH_TYPES.items()
        ],
        "glass_door_premiums": GLASS_DOOR_PREMIUM,
        "crown_molding_pricing": CROWN_MOLDING_PRICING,
        "island_panel_pricing": ISLAND_PANEL_PRICING,
        "prefab_island_pricing": PREFAB_ISLAND_PRICING,
        "prefab_island_install": PREFAB_ISLAND_INSTALL,
        "tall_cabinet_types": TALL_CABINET_TYPES,
        # Insurance basis, priced from the company's table when it has one
        "appliance_rr_pricing": {
            key: {**info, "cost": APPLIANCE_RESET_PRICES[Basis.INSURANCE_DR.value].get(key, info["cost"])}
            for key, info in APPLIANCE_RR_PRICING.items()
        },
        "countertop_materials": COUNTERTOP_MATERIALS,
        "countertop_backsplash_per_lf": COUNTERTOP_BACKSPLASH_PER_LF,
        "countertop_support_rule": COUNTERTOP_SUPPORT_RULE,
        "selection_slots": SLOTS,
    }


# ── CRUD ──

@router.post("", response_model=CabinetEstimateResponse)
def create_estimate(
    data: CabinetEstimateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        result = _service(db, current_user).create_estimate(data, created_by_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.get("", response_model=CabinetEstimateListResponse)
def list_estimates(
    customer_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    kind: Optional[Literal["restore", "option"]] = Query(None),
    grouped: bool = Query(False, description="One row per kitchen job"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    items, total = _service(db, current_user).list_estimates(
        customer_id=customer_id,
        status=status,
        search=search,
        kind=kind,
        grouped=grouped,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{estimate_id}", response_model=CabinetEstimateResponse)
def get_estimate(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    return _or_404(_service(db, current_user).get_estimate(estimate_id))


@router.put("/{estimate_id}", response_model=CabinetEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: CabinetEstimateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        result = _or_404(_service(db, current_user).update_estimate(estimate_id, data))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.delete("/{estimate_id}")
def delete_estimate(
    estimate_id: str,
    whole_group: bool = Query(False, description="Delete every estimate of the job"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        deleted = _service(db, current_user).delete_estimate(estimate_id, whole_group=whole_group)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    _or_404(deleted)
    db.commit()
    return {"message": "Estimate deleted"}


# ── Estimate group (restoration + options) ──

@router.get("/{estimate_id}/group", response_model=CabinetEstimateGroupResponse)
def get_estimate_group(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Every estimate of this one's job, with line items, for comparing them."""
    return _or_404(_service(db, current_user).get_group(estimate_id))


@router.post("/{estimate_id}/options", response_model=CabinetEstimateResponse)
def add_option(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Add an option to the job, starting as a copy of this estimate."""
    result = _or_404(_service(db, current_user).add_option(estimate_id, created_by_id=current_user.id))
    db.commit()
    return result


@router.put("/{estimate_id}/option-label", response_model=CabinetEstimateResponse)
def rename_option(
    estimate_id: str,
    data: OptionLabelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        result = _or_404(_service(db, current_user).rename_option(estimate_id, data.option_label))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.put("/{estimate_id}/project-type", response_model=CabinetEstimateResponse)
def set_project_type(
    estimate_id: str,
    data: ProjectTypeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Switch the whole job between an insurance claim and a remodel."""
    result = _or_404(_service(db, current_user).set_project_type(estimate_id, data.project_type))
    db.commit()
    return result


# ── Products (an option's selections from the product library) ──

def _set_selection(db, user, estimate_id, slot, product_id):
    try:
        result = _service(db, user).set_selection(
            estimate_id, slot, product_id, changed_by_id=user.id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _or_404(result)
    db.commit()
    return result


@router.put("/{estimate_id}/selections/{slot}", response_model=CabinetEstimateResponse)
def set_selection(
    estimate_id: str,
    slot: str,
    data: SelectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Put a library product in an option's slot (a copy of it as it is now)."""
    return _set_selection(db, current_user, estimate_id, slot, str(data.product_id))


@router.delete("/{estimate_id}/selections/{slot}", response_model=CabinetEstimateResponse)
def clear_selection(
    estimate_id: str,
    slot: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Empty an option's slot: that part goes back to the rate-table price."""
    return _set_selection(db, current_user, estimate_id, slot, None)


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=CabinetEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[CabinetEstimateUpdate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Save (if a body is sent) then calculate, in one round-trip."""
    service = _service(db, current_user)
    try:
        if data is not None:
            _or_404(service.update_estimate(estimate_id, data, skip_full_read=True))
        result = _or_404(service.calculate(estimate_id, changed_by_id=current_user.id))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.post("/{estimate_id}/use-current-prices", response_model=CabinetEstimateResponse)
def use_current_prices(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Reprice the estimate's whole job at today's prices (the defaults with
    the company's own figures). Until this is asked for, an estimate keeps
    the prices it was first priced with."""
    try:
        result = _or_404(_service(db, current_user).use_current_prices(
            estimate_id, changed_by_id=current_user.id,
        ))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.post("/{estimate_id}/clone", response_model=CabinetEstimateResponse)
def clone_estimate(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Clone an existing estimate into a new draft job."""
    result = _or_404(_service(db, current_user).clone_estimate(estimate_id, created_by_id=current_user.id))
    db.commit()
    return result


# ── Sketch ──

@router.get("/{estimate_id}/sketch", response_model=CabinetSketchResponse)
def get_sketch(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The estimate's layout sketch, made empty the first time."""
    sketch = _or_404(_service(db, current_user).sketch(estimate_id))
    db.commit()
    return sketch


@router.put("/{estimate_id}/sketch", response_model=CabinetSketchResponse)
def update_sketch_meta(
    estimate_id: str,
    data: CabinetSketchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Canvas size and scale only."""
    sketch = _or_404(_service(db, current_user).sketch(estimate_id))
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(sketch, key, value)
    db.commit()
    return sketch


@router.put("/{estimate_id}/sketch/overlay", response_model=CabinetSketchResponse)
def save_sketch_overlay(
    estimate_id: str,
    payload: CabinetSketchOverlayData,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Replace the sketch's walls, cabinets and appliances wholesale."""
    sketch = _or_404(_service(db, current_user).sketch(estimate_id))
    sketch.overlay_data = payload.model_dump()
    flag_modified(sketch, "overlay_data")
    db.commit()
    return sketch


@router.post("/{estimate_id}/sketch/ai-photo", response_model=CabinetSketchAiPhotoResponse)
def make_sketch_ai_photo(
    estimate_id: str,
    payload: CabinetSketchAiPhotoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Redraw the 3D view's realistic render as a photo of the finished kitchen.

    A concept picture from a Gemini image model (sketch_ai_photo.py): it is
    not stored, and may differ from the sketch in small ways. Counts against
    the company's daily AI allowance.
    """
    from app.core.config import settings
    from app.domains.tools.usage import reserve_ai_units

    from .sketch_ai_photo import AiPhotoError, make_photo

    _or_404(_service(db, current_user).find(estimate_id))
    # Said before anything is counted against the allowance
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI photo isn't set up on this server yet.")
    reserve_ai_units(db, current_user, TOOL_ID, 1)
    try:
        image, model = make_photo(payload.image, payload.finish, payload.notes)
    except AiPhotoError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    logger.info("Cabinet AI photo for estimate %s by %s (%s)", estimate_id, current_user.id, model)
    return CabinetSketchAiPhotoResponse(image=image, model=model)


# ── History ──

@router.get("/{estimate_id}/history", response_model=list[HistoryResponse])
def get_history(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    service = _service(db, current_user)
    _or_404(service.find(estimate_id))
    return service.get_history(estimate_id)


# ── Purchase Order ──

@router.get("/{estimate_id}/purchase-order", response_model=PurchaseOrderResponse)
def get_purchase_order(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Grouped purchase order data for the supplier."""
    return _or_404(_service(db, current_user).get_purchase_order(estimate_id))


# ── Send to a Scopit estimate ──

class SendToEstimateRequest(BaseModel):
    # Refill the Scopit estimate this one was sent to before, instead of making a new one
    update_existing: bool = False


class SendToEstimateResponse(BaseModel):
    estimate_id: str
    estimate_number: str
    updated: bool


@router.post("/{estimate_id}/send-to-estimate", response_model=SendToEstimateResponse)
def send_to_estimate(
    estimate_id: str,
    req: SendToEstimateRequest = Body(default_factory=SendToEstimateRequest),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Write this calculated cabinet estimate's line items into a Scopit estimate."""
    from app.domains.tools.estimate_writer import write_estimate

    from .estimate_bridge import to_estimate_payload

    service = _service(db, current_user)
    cabinet = _or_404(service.get_estimate(estimate_id))
    if not cabinet.get("line_items"):
        raise HTTPException(status_code=400, detail="Calculate the estimate before sending it.")

    existing = cabinet.get("scopit_estimate_id") if req.update_existing else None
    estimate, updated = write_estimate(
        db,
        current_user,
        to_estimate_payload(cabinet),
        customer_id=cabinet.get("customer_id"),
        customer_name=cabinet.get("client_name"),
        existing_estimate_id=existing,
    )

    row = service.find(estimate_id)
    row.scopit_estimate_id = estimate.id
    db.commit()
    return SendToEstimateResponse(
        estimate_id=str(estimate.id),
        estimate_number=estimate.estimate_number,
        updated=updated,
    )


# ── Export (PDF / Excel) ──

def _image_loader(db: Session, user: User):
    """Product pictures for a PDF, read from file storage."""
    from app.domains.product_library.service import image_bytes

    return lambda file_id: image_bytes(db, user.company_id, file_id)


def _pdf_filename(prefix: str, estimate: Dict[str, Any], estimate_id: str) -> str:
    addr = estimate.get("property_address") or ""
    addr_slug = re.sub(r"[^a-zA-Z0-9]+", "_", addr).strip("_")[:60]
    option = ""
    if estimate.get("kind") == "option":
        option = "_" + re.sub(r"[^a-zA-Z0-9]+", "_", estimate.get("option_label") or "option").strip("_")
    return f"{prefix}_{addr_slug or estimate_id[:8]}{option}.pdf"


def _pdf_response(pdf_bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _estimate_pdf(estimate_id: str, show_signature: bool, render: Optional[str], db: Session, user: User):
    from .export_service import CabinetExportService

    estimate = _or_404(_service(db, user).get_estimate(estimate_id))
    pdf_bytes = CabinetExportService().generate_pdf(
        estimate, show_signature=show_signature,
        image_loader=_image_loader(db, user), render=render,
    )
    return _pdf_response(pdf_bytes, _pdf_filename("cabinet_estimate", estimate, estimate_id))


@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The estimate as a PDF for the carrier or the customer."""
    return _estimate_pdf(estimate_id, show_signature, None, db, current_user)


@router.post("/{estimate_id}/export/pdf")
def export_pdf_with_render(
    estimate_id: str,
    body: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """An option's PDF with its 3D view ({render: base64, show_signature}).

    The restoration's PDF ignores a render: it goes to the carrier as it is.
    """
    return _estimate_pdf(estimate_id, body.get("show_signature", True), body.get("render"), db, current_user)


@router.post("/{estimate_id}/export/design-quote-pdf")
def export_design_quote_pdf(
    estimate_id: str,
    body: Dict[str, Any] = Body(default={}),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The design quote, the other format of the estimate's PDF.

    Body: {show_signature, drawings: {plan, elevations: [{label, image}],
    views: [{label, image}]}}, pictures in base64, each part optional.
    """
    from .export_service import CabinetExportService

    estimate = _or_404(_service(db, current_user).get_estimate(estimate_id))
    pdf_bytes = CabinetExportService().generate_design_quote_pdf(
        estimate, show_signature=body.get("show_signature", True),
        image_loader=_image_loader(db, current_user), drawings=body.get("drawings"),
    )
    return _pdf_response(pdf_bytes, _pdf_filename("kitchen_cabinet_quote", estimate, estimate_id))


def _proposal_pdf(estimate_id: str, show_signature: bool, renders: Optional[Dict[str, str]], db, user):
    from .export_service import CabinetExportService

    group = _or_404(_service(db, user).get_group(estimate_id))
    try:
        pdf_bytes = CabinetExportService().generate_proposal_pdf(
            group, show_signature=show_signature, renders=renders,
            image_loader=_image_loader(db, user),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _pdf_response(pdf_bytes, f"kitchen_options_{estimate_id[:8]}.pdf")


@router.get("/{estimate_id}/export/proposal-pdf")
def export_proposal_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The customer's comparison of every estimate of this one's job.

    For the customer only: the carrier gets the restoration's own PDF.
    """
    return _proposal_pdf(estimate_id, show_signature, None, db, current_user)


@router.post("/{estimate_id}/export/proposal-pdf")
def export_proposal_pdf_with_renders(
    estimate_id: str,
    body: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The customer's comparison, with each estimate's 3D view ({renders: {id: base64}})."""
    return _proposal_pdf(estimate_id, body.get("show_signature", True), body.get("renders"), db, current_user)


@router.get("/{estimate_id}/export/excel")
def export_excel(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The purchase order as Excel for the supplier."""
    from .export_service import CabinetExportService

    service = _service(db, current_user)
    order = _or_404(service.get_purchase_order(estimate_id))
    estimate = service.get_estimate(estimate_id)
    excel_bytes = CabinetExportService().generate_excel(estimate, order)
    return Response(
        content=excel_bytes.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="cabinet_purchase_order_{estimate_id[:8]}.xlsx"'
        },
    )
