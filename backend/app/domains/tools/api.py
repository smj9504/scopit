"""
ScopeIt - Tools API

Registry, session management, and tool-to-estimate bridge endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.tools.service import ToolAccessService, ToolSessionService
from app.domains.tools.converter import get_converter
from app.domains.tools.registry import get_tool
from app.common.exceptions import NotFoundException, BadRequestException

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────

class ToolResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    category: str
    required_plan: str
    version: str
    tags: List[str]
    has_access: bool
    can_create_estimate: bool


class ToolSessionCreate(BaseModel):
    tool_id: str
    name: Optional[str] = None
    data: Optional[dict] = {}


class ToolSessionUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[dict] = None


class ToolSessionResponse(BaseModel):
    id: str
    tool_id: str
    name: Optional[str]
    data: dict
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True

    @field_validator("id", mode="before")
    @classmethod
    def coerce_uuid_to_str(cls, v):
        return str(v) if v is not None else v


class CreateEstimateFromToolRequest(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    title: Optional[str] = None


class CreateEstimateFromToolResponse(BaseModel):
    estimate_id: str
    estimate_number: str


class CreateInvoiceFromToolRequest(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    title: Optional[str] = None


class CreateInvoiceFromToolResponse(BaseModel):
    invoice_id: str
    invoice_number: str


# ── Tool Registry Endpoints ──────────────────────────────────────────

@router.get("", response_model=List[ToolResponse])
async def list_tools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all tools with access status for the current user."""
    service = ToolAccessService(db)
    return service.get_all_tools_with_access(current_user)


@router.get("/{tool_id}/access")
async def check_tool_access(
    tool_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if the current user can access a specific tool."""
    service = ToolAccessService(db)
    has_access = service.can_access_tool(tool_id, current_user)
    return {"tool_id": tool_id, "has_access": has_access}


# ── Session Endpoints ────────────────────────────────────────────────

@router.get("/sessions", response_model=List[ToolSessionResponse])
async def list_sessions(
    tool_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    summary: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List tool sessions for the current company.

    When summary=True (default), strips heavy binary data (base64 photos)
    from session data to keep the response lightweight.
    """
    service = ToolSessionService(db)
    sessions = service.get_sessions(
        company_id=current_user.company_id,
        tool_id=tool_id,
        skip=skip,
        limit=limit,
    )
    if summary:
        sessions = service.strip_heavy_data(sessions)
    return sessions


@router.post("/sessions", response_model=ToolSessionResponse, status_code=201)
async def create_session(
    data: ToolSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new tool session."""
    access_service = ToolAccessService(db)
    if not access_service.can_access_tool(data.tool_id, current_user):
        raise HTTPException(status_code=403, detail="You do not have access to this tool.")

    session_service = ToolSessionService(db)
    return session_service.create_session(
        company_id=current_user.company_id,
        user_id=current_user.id,
        tool_id=data.tool_id,
        name=data.name,
        data=data.data,
    )


@router.get("/sessions/{session_id}", response_model=ToolSessionResponse)
async def get_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ToolSessionService(db)
    return service.get_session(session_id, current_user.company_id)


@router.patch("/sessions/{session_id}", response_model=ToolSessionResponse)
async def update_session(
    session_id: UUID,
    data: ToolSessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ToolSessionService(db)
    return service.update_session_data(
        session_id, current_user.company_id,
        name=data.name, data=data.data,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ToolSessionService(db)
    service.delete_session(session_id, current_user.company_id)
    return {"message": "Session deleted"}


# ── Tool → Estimate Bridge ──────────────────────────────────────────

@router.post("/sessions/{session_id}/create-estimate", response_model=CreateEstimateFromToolResponse)
async def create_estimate_from_tool(
    session_id: UUID,
    req: CreateEstimateFromToolRequest = CreateEstimateFromToolRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Convert a tool session's result data into a new estimate.
    Uses the tool's registered converter to transform session data
    into EstimateCreate payload, then reuses the existing estimate creation logic.
    """
    from app.domains.estimate.api import EstimateCreate, EstimateSectionCreate, EstimateItemCreate
    from app.domains.estimate.models import Estimate, EstimateSection, EstimateItem, EstimateStatus
    from app.domains.company.models import Company
    from app.domains.customer.models import Customer
    from app.domains.settings.models import EstimateStatusConfig
    from decimal import Decimal
    from datetime import date

    # 1. Get tool session
    session_service = ToolSessionService(db)
    tool_session = session_service.get_session(session_id, current_user.company_id)

    # 2. Get converter for this tool
    converter = get_converter(tool_session.tool_id)
    if not converter:
        tool = get_tool(tool_session.tool_id)
        tool_name = tool.name if tool else tool_session.tool_id
        raise BadRequestException(f"{tool_name} does not support estimate creation yet.")

    # 3. Convert session data to estimate payload
    payload = converter.to_estimate_payload(
        tool_session.data,
        customer_id=req.customer_id,
        customer_name=req.customer_name,
        title=req.title,
    )

    # 4. Create estimate using existing logic (inline to avoid circular import)
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    estimate_number = f"{company.estimate_prefix}-{company.next_estimate_number}"
    company.next_estimate_number += 1

    customer_name = payload.get("customer_name") or req.customer_name
    customer_email = payload.get("customer_email")
    customer_address = payload.get("customer_address")

    if req.customer_id:
        customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address = customer.full_address

    default_status = (
        db.query(EstimateStatusConfig)
        .filter(
            EstimateStatusConfig.company_id == current_user.company_id,
            EstimateStatusConfig.is_default == True,
            EstimateStatusConfig.is_active == True,
        )
        .first()
    )

    estimate = Estimate(
        company_id=current_user.company_id,
        estimate_number=estimate_number,
        status=EstimateStatus.DRAFT,
        status_id=default_status.id if default_status else None,
        estimate_date=date.today(),
        customer_id=req.customer_id,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_address=customer_address,
        title=payload.get("title") or req.title,
        description=payload.get("description"),
        tax_rate=payload.get("tax_rate") or company.default_tax_rate,
        tax_label=company.default_tax_label,
        notes=company.default_notes,
        terms=company.default_terms,
        created_by=current_user.id,
    )
    db.add(estimate)
    db.flush()

    sections = payload.get("sections", [])
    for idx, section_data in enumerate(sections):
        section = EstimateSection(
            estimate_id=estimate.id,
            name=section_data.get("name", "General"),
            order_index=section_data.get("order_index", idx),
        )
        db.add(section)
        db.flush()

        for item_idx, item_data in enumerate(section_data.get("items", [])):
            quantity = Decimal(str(item_data.get("quantity", 1)))
            unit_price = Decimal(str(item_data.get("unit_price", 0)))
            item = EstimateItem(
                estimate_id=estimate.id,
                section_id=section.id,
                name=item_data.get("name", ""),
                description=item_data.get("description"),
                unit=item_data.get("unit"),
                quantity=quantity,
                unit_price=unit_price,
                total=quantity * unit_price,
                is_taxable=item_data.get("is_taxable", True),
                order_index=item_data.get("order_index", item_idx),
                notes=item_data.get("notes", []),
            )
            db.add(item)

    db.commit()
    db.refresh(estimate)

    # Recalculate totals
    from app.domains.estimate.api import recalculate_estimate
    recalculate_estimate(estimate, db)

    return CreateEstimateFromToolResponse(
        estimate_id=str(estimate.id),
        estimate_number=estimate.estimate_number,
    )


# ── Tool → Invoice Bridge ──────────────────────────────────────────

@router.post("/sessions/{session_id}/create-invoice", response_model=CreateInvoiceFromToolResponse)
async def create_invoice_from_tool(
    session_id: UUID,
    req: CreateInvoiceFromToolRequest = CreateInvoiceFromToolRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Convert a tool session's result data into a new invoice.
    Uses the tool's registered converter to transform session data
    into sections/items, then creates an invoice directly.
    """
    from app.domains.invoice.models import (
        Invoice, InvoiceSection, InvoiceItem, InvoiceStatus,
        InvoiceAdjustment, AdjustmentType,
    )
    from app.domains.invoice.api import recalculate_invoice, get_default_invoice_status
    from app.domains.company.models import Company
    from app.domains.customer.models import Customer
    from decimal import Decimal, ROUND_HALF_UP
    from datetime import date, timedelta

    # 1. Get tool session
    session_service = ToolSessionService(db)
    tool_session = session_service.get_session(session_id, current_user.company_id)

    # 2. Get converter for this tool
    converter = get_converter(tool_session.tool_id)
    if not converter:
        tool = get_tool(tool_session.tool_id)
        tool_name = tool.name if tool else tool_session.tool_id
        raise BadRequestException(f"{tool_name} does not support invoice creation yet.")

    # 3. Convert session data to payload (reuses the same converter as estimates)
    payload = converter.to_estimate_payload(
        tool_session.data,
        customer_id=req.customer_id,
        customer_name=req.customer_name,
        title=req.title,
    )

    # 4. Create invoice
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    invoice_number = f"{company.invoice_prefix}-{company.next_invoice_number}"
    company.next_invoice_number += 1

    customer_name = payload.get("customer_name") or req.customer_name
    customer_email = payload.get("customer_email")
    customer_address = payload.get("customer_address")

    if req.customer_id:
        customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address = customer.full_address

    default_status = get_default_invoice_status(db, current_user.company_id)
    invoice_date = date.today()

    # Store company override from tool session (e.g. moving estimate)
    co = payload.get("company_override")
    company_override_data = None
    if co and any(co.get(k) for k in ("name", "address", "phone", "email")):
        company_override_data = co

    invoice = Invoice(
        company_id=current_user.company_id,
        invoice_number=invoice_number,
        status=InvoiceStatus.DRAFT,
        status_id=default_status.id if default_status else None,
        invoice_date=invoice_date,
        due_date=invoice_date + timedelta(days=30),
        customer_id=req.customer_id,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_address=customer_address,
        title=payload.get("title") or req.title,
        description=payload.get("description"),
        tax_rate=payload.get("tax_rate") or company.default_tax_rate,
        tax_label=company.default_tax_label,
        notes=company.default_notes,
        terms=company.default_terms,
        company_override=company_override_data,
        created_by=current_user.id,
    )
    db.add(invoice)
    db.flush()

    sections = payload.get("sections", [])
    for idx, section_data in enumerate(sections):
        section = InvoiceSection(
            invoice_id=invoice.id,
            name=section_data.get("name", "General"),
            order_index=section_data.get("order_index", idx),
        )
        db.add(section)
        db.flush()

        for item_idx, item_data in enumerate(section_data.get("items", [])):
            quantity = Decimal(str(item_data.get("quantity", 1)))
            unit_price = Decimal(str(item_data.get("unit_price", 0)))
            # Use pre-computed amount from estimate when available.
            # Back-derive unit_price so qty × price = amount exactly,
            # preventing rounding drift when recalculate_invoice runs.
            if "amount" in item_data and quantity > 0:
                item_total = Decimal(str(item_data["amount"]))
                unit_price = (item_total / quantity).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
                # If back-derived price still doesn't reproduce exact total,
                # adjust total to match (keeps invoice internally consistent)
                item_total = (quantity * unit_price).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
            else:
                item_total = (quantity * unit_price).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
            item = InvoiceItem(
                invoice_id=invoice.id,
                section_id=section.id,
                name=item_data.get("name", ""),
                description=item_data.get("description"),
                unit=item_data.get("unit"),
                quantity=quantity,
                unit_price=unit_price,
                total=item_total,
                is_taxable=item_data.get("is_taxable", True),
                order_index=item_data.get("order_index", item_idx),
                notes=item_data.get("notes", []),
            )
            db.add(item)

    # Create adjustments (O&P, contingency, supplements)
    for adj_idx, adj in enumerate(payload.get("adjustments", [])):
        adj_value = Decimal(str(adj.get("value", 0)))
        adj_type = adj.get("type", "premium")
        # O&P uses percentage-based; supplements/contingency use fixed amount (percentage=0)
        is_op = adj_type == "premium" and "overhead" in adj.get("name", "").lower()
        if is_op:
            # Extract percentage from name like "Overhead & Profit (20%)"
            import re
            pct_match = re.search(r'\((\d+(?:\.\d+)?)%\)', adj.get("name", ""))
            pct = Decimal(pct_match.group(1)) if pct_match else Decimal(0)
        else:
            pct = Decimal(0)  # Fixed amount — recalculate_invoice will preserve it
        adjustment = InvoiceAdjustment(
            invoice_id=invoice.id,
            type=AdjustmentType.PREMIUM,
            name=adj.get("name", "Adjustment"),
            percentage=pct,
            amount=adj_value,
            order_index=adj_idx,
        )
        db.add(adjustment)

    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return CreateInvoiceFromToolResponse(
        invoice_id=str(invoice.id),
        invoice_number=invoice.invoice_number,
    )
