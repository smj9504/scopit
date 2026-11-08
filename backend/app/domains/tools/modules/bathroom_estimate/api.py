"""
Scopit - Bathroom Estimator API

Bathroom estimates: the room and its scope, the calculation, the layout
sketch with its 3D view, options for the customer (with products from the
library), hand edits to the line items, and the PDFs. Every route is limited
to the signed-in user's company. Ported from MJ Estimate's bathroom_estimate
API.
"""
import logging
import re
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access
from app.domains.unit_prices.service import UnitPriceService
from app.domains.unit_prices.tables import resolved, use_prices
from app.domains.user.models import User

from .pricing import (
    ACCESSORY_FINISHES,
    ACCESSORY_GRADES,
    BASEBOARD_MATERIALS,
    BATHROOM_DESIGNATIONS,
    BATHROOM_FUNCTIONS,
    BATHTUB_MATERIALS,
    BATHTUB_TYPES,
    BUILDING_TYPES,
    ELECTRICAL_RATES,
    ENCLOSURE_TYPES,
    EXHAUST_FAN_CFMS,
    EXHAUST_FAN_SWITCH_TYPES,
    FAUCET_TYPES,
    MIRROR_TYPES,
    PAINT_GRADES,
    PLUMBING_RATES,
    SHOWER_DOOR_TYPES,
    SHOWER_TYPES,
    SHOWERHEAD_TYPES,
    TILE_MATERIALS,
    TILE_PATTERNS,
    TILE_SIZES,
    TOILET_TYPES,
    TRIM_GRADES,
    VANITY_MOUNTINGS,
    VANITY_SOURCES,
    VANITY_TOP_MATERIALS,
    VANITY_WIDTHS,
    WATERPROOF_TYPES,
)
from .schemas import (
    BathroomEstimateCreate,
    BathroomEstimateGroupResponse,
    BathroomEstimateListResponse,
    BathroomEstimateResponse,
    BathroomEstimateUpdate,
    HistoryResponse,
    LineItemCreate,
    LineItemUpdate,
    OptionLabelUpdate,
    PricingInfoResponse,
    ProjectTypeUpdate,
    SelectionPick,
)
from .selections import slots_meta
from .service import BathroomEstimateService

logger = logging.getLogger(__name__)

TOOL_ID = "bathroom_estimate"
router = APIRouter()
_gate = require_tool_access(TOOL_ID)

NOT_FOUND = "Estimate not found"


def _service(db: Session, user: User) -> BathroomEstimateService:
    return BathroomEstimateService(db, user.company_id)


def _or_404(result, detail: str = NOT_FOUND):
    if not result:
        raise HTTPException(status_code=404, detail=detail)
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
    with use_prices(UnitPriceService(db).prices_for("bathroom", estimate)):
        return resolved(_pricing_info())


def _pricing_info() -> Dict[str, Any]:
    return {
        "building_types": BUILDING_TYPES,
        "designations": BATHROOM_DESIGNATIONS,
        "bath_functions": BATHROOM_FUNCTIONS,
        "shower_types": SHOWER_TYPES,
        "enclosure_types": ENCLOSURE_TYPES,
        "shower_door_types": SHOWER_DOOR_TYPES,
        "showerhead_types": SHOWERHEAD_TYPES,
        "trim_grades": TRIM_GRADES,
        "bathtub_types": BATHTUB_TYPES,
        "bathtub_materials": BATHTUB_MATERIALS,
        "vanity_widths": VANITY_WIDTHS,
        "vanity_sources": VANITY_SOURCES,
        "vanity_top_materials": VANITY_TOP_MATERIALS,
        "vanity_mountings": VANITY_MOUNTINGS,
        "faucet_types": FAUCET_TYPES,
        "mirror_types": MIRROR_TYPES,
        "toilet_types": TOILET_TYPES,
        "tile_materials": TILE_MATERIALS,
        "tile_patterns": TILE_PATTERNS,
        "tile_sizes": TILE_SIZES,
        "waterproof_types": WATERPROOF_TYPES,
        "accessory_finishes": ACCESSORY_FINISHES,
        "accessory_grades": ACCESSORY_GRADES,
        "exhaust_fan_cfms": EXHAUST_FAN_CFMS,
        "exhaust_fan_switch_types": EXHAUST_FAN_SWITCH_TYPES,
        "paint_grades": PAINT_GRADES,
        "baseboard_materials": BASEBOARD_MATERIALS,
        "plumbing_rates": PLUMBING_RATES,
        "electrical_rates": ELECTRICAL_RATES,
    }


@router.get("/selection-slots")
def get_selection_slots(current_user: User = Depends(_gate)):
    """The products an option can be built from: each slot, and the library categories that fill it."""
    return slots_meta()


# ── CRUD ──

@router.post("", response_model=BathroomEstimateResponse)
def create_estimate(
    data: BathroomEstimateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    try:
        result = _service(db, current_user).create_estimate(data, created_by_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return result


@router.get("", response_model=BathroomEstimateListResponse)
def list_estimates(
    customer_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
    kind: Optional[Literal["restore", "option"]] = Query(None),
    grouped: bool = Query(False, description="One row per bathroom job"),
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


@router.get("/{estimate_id}", response_model=BathroomEstimateResponse)
def get_estimate(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    return _or_404(_service(db, current_user).get_estimate(estimate_id))


@router.put("/{estimate_id}", response_model=BathroomEstimateResponse)
def update_estimate(
    estimate_id: str,
    data: BathroomEstimateUpdate,
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

@router.get("/{estimate_id}/group", response_model=BathroomEstimateGroupResponse)
def get_estimate_group(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Every estimate of this one's job, with line items, for comparing them."""
    return _or_404(_service(db, current_user).get_group(estimate_id))


@router.post("/{estimate_id}/options", response_model=BathroomEstimateResponse)
def add_option(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Add an option to the job, starting as a copy of this estimate."""
    result = _or_404(_service(db, current_user).add_option(estimate_id, created_by_id=current_user.id))
    db.commit()
    return result


@router.post("/{estimate_id}/current-layout", response_model=BathroomEstimateResponse)
def add_current_layout(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Add a remodel's bathroom as it is today (unpriced), starting as a copy of this estimate."""
    try:
        result = _service(db, current_user).add_current_layout(estimate_id, created_by_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _or_404(result)
    db.commit()
    return result


@router.get("/{estimate_id}/layout-changes")
def get_layout_changes(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """How this option's saved sketch differs from the bathroom as it is, and which changes are left out."""
    result = _service(db, current_user).get_layout_changes(estimate_id)
    if result is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return result


@router.put("/{estimate_id}/option-label", response_model=BathroomEstimateResponse)
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


@router.put("/{estimate_id}/project-type", response_model=BathroomEstimateResponse)
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

@router.put("/{estimate_id}/selections/{slot}", response_model=BathroomEstimateResponse)
def set_selection(
    estimate_id: str,
    slot: str,
    data: SelectionPick,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Build an option's slot (vanity, floor tile…) from a library product; its price becomes the material cost."""
    try:
        result = _service(db, current_user).set_selection(
            estimate_id, slot, data.product_id, data.includes_top,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _or_404(result)
    db.commit()
    return result


@router.delete("/{estimate_id}/selections/{slot}", response_model=BathroomEstimateResponse)
def clear_selection(
    estimate_id: str,
    slot: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Take a slot's product off an option; it goes back to the rate table's allowance."""
    result = _or_404(_service(db, current_user).clear_selection(estimate_id, slot))
    db.commit()
    return result


# ── Calculation ──

@router.post("/{estimate_id}/calculate", response_model=BathroomEstimateResponse)
def calculate_estimate(
    estimate_id: str,
    data: Optional[BathroomEstimateUpdate] = None,
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


@router.post("/{estimate_id}/use-current-prices", response_model=BathroomEstimateResponse)
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


@router.post("/{estimate_id}/clone", response_model=BathroomEstimateResponse)
def clone_estimate(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Clone an existing estimate into a new draft job."""
    result = _or_404(_service(db, current_user).clone_estimate(estimate_id, created_by_id=current_user.id))
    db.commit()
    return result


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


# ── Overview note ──

@router.post("/{estimate_id}/generate-overview")
def generate_overview(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Write the PDF's overview note from the estimate's scope.

    Claude writes it when the server has a key (one unit of the company's
    daily AI allowance); a template otherwise, or when the call fails.
    """
    from app.domains.tools.usage import reserve_ai_units

    from .note_generator import ai_available

    service = _service(db, current_user)
    _or_404(service.find(estimate_id))
    if ai_available():
        # Commits the usage row; done before the estimate is changed
        reserve_ai_units(db, current_user, TOOL_ID, 1)
    overview = service.generate_overview(estimate_id)
    if overview is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    db.commit()
    return {"overview_text": overview}


# ── Line items, edited by hand ──

@router.post("/{estimate_id}/line-items", response_model=BathroomEstimateResponse)
def add_line_item(
    estimate_id: str,
    data: LineItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    result = _or_404(_service(db, current_user).add_line_item(estimate_id, data.model_dump()))
    db.commit()
    return result


@router.put("/{estimate_id}/line-items/{item_id}", response_model=BathroomEstimateResponse)
def update_line_item(
    estimate_id: str,
    item_id: str,
    data: LineItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    result = _or_404(
        _service(db, current_user).update_line_item(estimate_id, item_id, data.model_dump(exclude_unset=True)),
        "Line item not found",
    )
    db.commit()
    return result


@router.delete("/{estimate_id}/line-items/{item_id}", response_model=BathroomEstimateResponse)
def delete_line_item(
    estimate_id: str,
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    result = _or_404(
        _service(db, current_user).delete_line_item(estimate_id, item_id), "Line item not found",
    )
    db.commit()
    return result


@router.delete("/{estimate_id}/phases/{phase}", response_model=BathroomEstimateResponse)
def delete_phase(
    estimate_id: str,
    phase: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Delete all items in a phase and renumber the phases after it."""
    result = _or_404(_service(db, current_user).delete_phase(estimate_id, phase))
    db.commit()
    return result


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
    """Write this calculated bathroom estimate's line items into a Scopit estimate."""
    from app.domains.tools.estimate_writer import write_estimate

    from .estimate_bridge import to_estimate_payload

    service = _service(db, current_user)
    bathroom = _or_404(service.get_estimate(estimate_id))
    if bathroom.get("kind") == "existing":
        raise HTTPException(status_code=400, detail="The current layout isn't priced; send one of its options instead.")
    if not bathroom.get("line_items"):
        raise HTTPException(status_code=400, detail="Calculate the estimate before sending it.")

    existing = bathroom.get("scopit_estimate_id") if req.update_existing else None
    estimate, updated = write_estimate(
        db,
        current_user,
        to_estimate_payload(bathroom),
        customer_id=bathroom.get("customer_id"),
        customer_name=bathroom.get("client_name"),
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


# ── Export validation ──

def _validate_allowances(estimate: Dict[str, Any]) -> list:
    """Items that should name a brand/model or an allowance before export."""
    warnings = []

    floor_spec = estimate.get("floor_spec") or {}
    if estimate.get("demo_floor") and not floor_spec.get("material"):
        warnings.append(
            "Floor demo is checked but no floor material specified. "
            "Add floor material in Floor Spec if replacing, or ignore if demo only."
        )

    vanity_spec = estimate.get("vanity_spec") or {}
    if estimate.get("replace_vanity"):
        items = vanity_spec.get("items") or [vanity_spec]
        for i, v in enumerate(items):
            if not v:
                continue
            label = f" #{i+1}" if len(items) > 1 else ""
            if not v.get("brand") and not v.get("model"):
                warnings.append(f"Vanity{label}: no brand/model specified. Specify brand or confirm allowance.")
            if not v.get("faucet_brand") and not v.get("faucet_model"):
                warnings.append(f"Faucet{label}: no brand/model specified.")

    toilet_spec = estimate.get("toilet_spec") or {}
    if estimate.get("replace_toilet") and not toilet_spec.get("brand") and not toilet_spec.get("model"):
        warnings.append("Toilet: no brand/model specified. Specify model or confirm allowance.")

    shower_spec = estimate.get("shower_spec") or {}
    if (estimate.get("replace_shower")
            and not shower_spec.get("fixture_brand")
            and not shower_spec.get("fixture_model")):
        warnings.append("Shower fixture: no brand/model specified.")

    return warnings


@router.get("/{estimate_id}/export/validate")
def validate_for_export(
    estimate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """Warnings for missing allowance/brand/model specs before a PDF goes out."""
    estimate = _or_404(_service(db, current_user).get_estimate(estimate_id))
    warnings = _validate_allowances(estimate)
    return {"valid": len(warnings) == 0, "warnings": warnings}


# ── Export (PDF) ──

def _pdf_filename(prefix: str, estimate: Dict[str, Any], estimate_id: str, suffix: str = "") -> str:
    addr = estimate.get("property_address") or ""
    addr_slug = re.sub(r"[^a-zA-Z0-9]+", "_", addr).strip("_")[:60]
    option = ""
    if estimate.get("kind") == "option":
        option = "_" + re.sub(r"[^a-zA-Z0-9]+", "_", estimate.get("option_label") or "option").strip("_")
    return f"{prefix}_{addr_slug or estimate_id[:8]}{option}{suffix}.pdf"


def _pdf_response(pdf_bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _estimate_pdf(
    estimate_id: str,
    db: Session,
    user: User,
    show_signature: bool = True,
    show_breakdown_prices: bool = True,
    sketch_image: Optional[str] = None,
    render_image: Optional[str] = None,
) -> Response:
    from .export_service import BathroomExportService

    service = _service(db, user)
    estimate = _or_404(service.get_estimate(estimate_id))
    pdf_bytes = BathroomExportService().generate_pdf(
        estimate,
        show_signature=show_signature,
        sketch_image_base64=sketch_image,
        show_breakdown_prices=show_breakdown_prices,
        # The 3D view and the picked products; an option's PDF only shows them
        render_image_base64=render_image,
        product_pictures=service.product_pictures([estimate]),
    )
    suffix = "_detail" if show_breakdown_prices else "_clean"
    return _pdf_response(pdf_bytes, _pdf_filename("bathroom_estimate", estimate, estimate_id, suffix))


@router.get("/{estimate_id}/export/pdf")
def export_pdf(
    estimate_id: str,
    show_signature: bool = Query(True),
    show_breakdown_prices: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The estimate as a PDF (no sketch picture)."""
    return _estimate_pdf(
        estimate_id, db, current_user,
        show_signature=show_signature, show_breakdown_prices=show_breakdown_prices,
    )


@router.post("/{estimate_id}/export/pdf")
def export_pdf_with_sketch(
    estimate_id: str,
    body: Dict[str, Any] = Body(default={}),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The estimate as a PDF with the sketch and 3D view pictures
    ({sketch_image, render_image: base64, show_signature, show_breakdown_prices})."""
    return _estimate_pdf(
        estimate_id, db, current_user,
        show_signature=body.get("show_signature", True),
        show_breakdown_prices=body.get("show_breakdown_prices", True),
        sketch_image=body.get("sketch_image"),
        render_image=body.get("render_image"),
    )


def _proposal_pdf(estimate_id: str, show_signature: bool, renders: Optional[Dict[str, str]], db, user):
    from .export_service import BathroomExportService

    service = _service(db, user)
    group = _or_404(service.get_group(estimate_id))
    try:
        pdf_bytes = BathroomExportService().generate_proposal_pdf(
            group, show_signature=show_signature, renders=renders,
            product_pictures=service.product_pictures(group["members"]),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _pdf_response(pdf_bytes, f"bathroom_options_{estimate_id[:8]}.pdf")


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
    body: Dict[str, Any] = Body(default={}),
    db: Session = Depends(get_db),
    current_user: User = Depends(_gate),
):
    """The customer's comparison, with each estimate's 3D view ({renders: {id: base64}})."""
    return _proposal_pdf(estimate_id, body.get("show_signature", True), body.get("renders"), db, current_user)
