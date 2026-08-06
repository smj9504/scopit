"""
Scopit - Estimate API Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

# Currency precision constant
CURRENCY_PRECISION = Decimal('0.01')
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.pdf_generator import (
    generate_estimate_html,
    generate_estimate_pdf,
    get_template_info,
    get_available_templates,
    DEFAULT_TEMPLATE,
)
from app.domains.company.models import Company
from app.domains.user.models import User
from app.domains.estimate.models import (
    Estimate, EstimateSection, EstimateItem, EstimateStatus,
    EstimatePayment, EstimateAdjustment, PaymentMethod, AdjustmentType
)
from app.domains.settings.models import EstimateStatusConfig
from app.common.responses import MessageResponse, BulkOperationResponse


router = APIRouter()


# ===================
# Schemas
# ===================

class StatusUpdateRequest(BaseModel):
    status_id: str


class EstimateItemCreate(BaseModel):
    line_item_id: Optional[str] = None
    code: Optional[str] = None
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Decimal = 1
    unit_price: Decimal = 0
    is_taxable: bool = True
    order_index: int = 0
    notes: Optional[List[str]] = None  # Array of note content strings
    images: Optional[List[dict]] = None  # [{"filename": "...", "data": "base64..."}]


class EstimateSectionCreate(BaseModel):
    name: str
    order_index: int = 0
    items: List[EstimateItemCreate] = []


class EstimateCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    estimate_date: Optional[date] = None
    valid_until: Optional[date] = None
    title: Optional[str] = None
    description: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    tax_label: Optional[str] = None
    notes: Optional[str] = None
    terms: Optional[str] = None
    sections: List[EstimateSectionCreate] = []


class EstimateItemResponse(BaseModel):
    id: str
    section_id: Optional[str]
    line_item_id: Optional[str]
    code: Optional[str]
    name: str
    description: Optional[str]
    unit: Optional[str]
    quantity: Decimal
    unit_price: Decimal
    total: Decimal
    is_taxable: bool
    order_index: int
    notes: Optional[List[str]] = []  # Array of note content strings
    images: Optional[List[dict]] = []

    class Config:
        from_attributes = True


class EstimateSectionResponse(BaseModel):
    id: str
    name: str
    order_index: int
    is_collapsed: bool
    items: List[EstimateItemResponse] = []
    subtotal: Decimal = 0

    class Config:
        from_attributes = True


class StatusConfigResponse(BaseModel):
    """Status config for inline display"""
    id: str
    name: str
    label: str
    color: str
    bg_color: str

    class Config:
        from_attributes = True


# Payment Schemas (defined before EstimateResponse which references them)
class PaymentCreate(BaseModel):
    amount: Decimal
    payment_method: Optional[str] = Field(default=None, alias="paymentMethod")
    payment_date: Optional[date] = Field(default=None, alias="paymentDate")
    reference_number: Optional[str] = Field(default=None, alias="referenceNumber")
    notes: Optional[str] = None

    model_config = {"populate_by_name": True}


class PaymentResponse(BaseModel):
    id: str
    amount: Decimal
    payment_method: Optional[str] = Field(default=None, serialization_alias="paymentMethod")
    payment_date: Optional[date] = Field(default=None, serialization_alias="paymentDate")
    reference_number: Optional[str] = Field(default=None, serialization_alias="referenceNumber")
    notes: Optional[str] = None
    created_at: datetime = Field(serialization_alias="createdAt")

    model_config = {"from_attributes": True, "populate_by_name": True}


# Adjustment Schemas (defined before EstimateResponse which references them)
class AdjustmentCreate(BaseModel):
    type: str  # premium or discount
    name: str
    percentage: Decimal
    order_index: int = 0


class AdjustmentUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    percentage: Optional[Decimal] = None
    order_index: Optional[int] = None


class AdjustmentResponse(BaseModel):
    id: str
    type: str
    name: str
    percentage: Decimal
    amount: Decimal
    order_index: int
    created_at: datetime

    class Config:
        from_attributes = True


class EstimateResponse(BaseModel):
    id: str
    estimate_number: str
    status: Optional[str] = None  # Legacy enum (kept for compatibility)
    status_id: Optional[str] = None
    status_config: Optional[StatusConfigResponse] = None
    estimate_date: date
    valid_until: Optional[date]
    customer_id: Optional[str]
    customer_name: Optional[str]
    customer_email: Optional[str]
    customer_address: Optional[str]
    title: Optional[str]
    description: Optional[str]
    subtotal: Decimal
    taxable_subtotal: Decimal
    adjustments_total: Decimal = 0
    tax_rate: Optional[Decimal]
    tax_label: Optional[str]
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    amount_paid: Decimal = 0
    balance_due: Decimal = 0
    notes: Optional[str]
    terms: Optional[str]
    sections: List[EstimateSectionResponse] = []
    payments: List[PaymentResponse] = []
    adjustments: List[AdjustmentResponse] = []
    created_by: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class EstimateListResponse(BaseModel):
    items: List[EstimateResponse]
    total: int
    page: int
    page_size: int


class SectionCreate(BaseModel):
    name: str
    order_index: int = 0


class SectionUpdate(BaseModel):
    name: Optional[str] = None
    is_collapsed: Optional[bool] = None


class BulkActionRequest(BaseModel):
    action: str  # 'delete', 'move', 'copy'
    item_ids: List[str]
    target_section_id: Optional[str] = None
    target_index: Optional[int] = None


class ReorderRequest(BaseModel):
    section_ids: List[str]


class ItemReorderRequest(BaseModel):
    item_id: str
    target_section_id: str
    target_index: int


# ===================
# Helper Functions
# ===================

def serialize_estimate(estimate: Estimate) -> dict:
    """Serialize estimate with status_config, payments, and adjustments"""
    data = {
        "id": str(estimate.id),
        "estimate_number": estimate.estimate_number,
        "status": estimate.status.value if estimate.status else None,
        "status_id": str(estimate.status_id) if estimate.status_id else None,
        "status_config": None,
        "estimate_date": estimate.estimate_date,
        "valid_until": estimate.valid_until,
        "customer_id": str(estimate.customer_id) if estimate.customer_id else None,
        "customer_name": estimate.customer_name,
        "customer_email": estimate.customer_email,
        "customer_address": estimate.customer_address,
        "title": estimate.title,
        "description": estimate.description,
        "subtotal": estimate.subtotal,
        "taxable_subtotal": estimate.taxable_subtotal,
        "adjustments_total": estimate.adjustments_total or 0,
        "tax_rate": estimate.tax_rate,
        "tax_label": estimate.tax_label,
        "tax_amount": estimate.tax_amount,
        "discount_amount": estimate.discount_amount,
        "total": estimate.total,
        "amount_paid": estimate.amount_paid or 0,
        "balance_due": estimate.balance_due or 0,
        "notes": estimate.notes,
        "terms": estimate.terms,
        "created_by": str(estimate.created_by) if estimate.created_by else None,
        "created_at": estimate.created_at,
        "updated_at": estimate.updated_at,
        "sections": [],
        "payments": [],
        "adjustments": [],
    }

    # Add status_config if available
    if estimate.status_config:
        data["status_config"] = {
            "id": str(estimate.status_config.id),
            "name": estimate.status_config.name,
            "label": estimate.status_config.label,
            "color": estimate.status_config.color,
            "bg_color": estimate.status_config.bg_color,
        }

    # Add sections with items
    for section in estimate.sections:
        section_data = {
            "id": str(section.id),
            "name": section.name,
            "order_index": section.order_index,
            "is_collapsed": section.is_collapsed,
            "subtotal": section.subtotal,
            "items": [],
        }
        for item in section.items:
            section_data["items"].append({
                "id": str(item.id),
                "section_id": str(item.section_id) if item.section_id else None,
                "line_item_id": str(item.line_item_id) if item.line_item_id else None,
                "code": item.code,
                "name": item.name,
                "description": item.description,
                "unit": item.unit,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "total": item.total,
                "is_taxable": item.is_taxable,
                "order_index": item.order_index,
                "notes": item.notes or [],
                "images": item.images or [],
            })
        data["sections"].append(section_data)

    # Add payments
    for payment in estimate.payments:
        data["payments"].append({
            "id": str(payment.id),
            "amount": payment.amount,
            "payment_method": payment.payment_method.value if payment.payment_method else None,
            "payment_date": payment.payment_date,
            "reference_number": payment.reference_number,
            "notes": payment.notes,
            "created_at": payment.created_at,
        })

    # Add adjustments
    for adjustment in estimate.adjustments:
        data["adjustments"].append({
            "id": str(adjustment.id),
            "type": adjustment.type.value if adjustment.type else None,
            "name": adjustment.name,
            "percentage": adjustment.percentage,
            "amount": adjustment.amount,
            "order_index": adjustment.order_index,
            "created_at": adjustment.created_at,
        })

    return data


def get_default_estimate_status(db: Session, company_id) -> EstimateStatusConfig:
    """Get default estimate status config for company"""
    default_status = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == company_id,
        EstimateStatusConfig.is_default == True,
        EstimateStatusConfig.is_active == True,
    ).first()

    # If no default, get first active status
    if not default_status:
        default_status = db.query(EstimateStatusConfig).filter(
            EstimateStatusConfig.company_id == company_id,
            EstimateStatusConfig.is_active == True,
        ).order_by(EstimateStatusConfig.order_index).first()

    return default_status


def recalculate_estimate(estimate: Estimate, db: Session):
    """Recalculate estimate totals including adjustments and payments"""
    subtotal = Decimal(0)
    taxable_subtotal = Decimal(0)

    # Calculate subtotal from items
    for item in estimate.items:
        item_total = (item.quantity * item.unit_price).quantize(
            CURRENCY_PRECISION, rounding=ROUND_HALF_UP
        )
        item.total = item_total
        subtotal += item_total
        if item.is_taxable:
            taxable_subtotal += item_total

    estimate.subtotal = subtotal
    estimate.taxable_subtotal = taxable_subtotal

    # Calculate adjustments
    premium_total = Decimal(0)
    discount_total = Decimal(0)

    for adjustment in estimate.adjustments:
        adjustment_amount = (subtotal * (adjustment.percentage / 100)).quantize(
            CURRENCY_PRECISION, rounding=ROUND_HALF_UP
        )
        adjustment.amount = adjustment_amount

        if adjustment.type == AdjustmentType.PREMIUM:
            premium_total += adjustment_amount
        elif adjustment.type == AdjustmentType.DISCOUNT:
            discount_total += adjustment_amount

    estimate.adjustments_total = premium_total - discount_total

    # Adjusted subtotal for tax calculation
    adjusted_subtotal = subtotal + estimate.adjustments_total

    # Calculate tax on adjusted taxable amount
    if estimate.tax_rate:
        # Apply adjustments proportionally to taxable subtotal
        if subtotal > 0:
            taxable_ratio = taxable_subtotal / subtotal
            adjusted_taxable = adjusted_subtotal * taxable_ratio
        else:
            adjusted_taxable = Decimal(0)
        estimate.tax_amount = (adjusted_taxable * (estimate.tax_rate / 100)).quantize(
            CURRENCY_PRECISION, rounding=ROUND_HALF_UP
        )
    else:
        estimate.tax_amount = Decimal(0)

    # Calculate total
    estimate.total = (adjusted_subtotal + estimate.tax_amount).quantize(
        CURRENCY_PRECISION, rounding=ROUND_HALF_UP
    )

    # Calculate amount paid from payments
    amount_paid = sum(
        (payment.amount or Decimal(0)) for payment in estimate.payments
    )
    estimate.amount_paid = amount_paid
    estimate.balance_due = (estimate.total - amount_paid).quantize(
        CURRENCY_PRECISION, rounding=ROUND_HALF_UP
    )

    db.commit()


# ===================
# Estimate CRUD
# ===================

@router.get("", response_model=EstimateListResponse)
async def list_estimates(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List estimates"""
    query = db.query(Estimate).filter(Estimate.company_id == current_user.company_id)
    
    if status:
        query = query.filter(Estimate.status == status)
    
    if customer_id:
        query = query.filter(Estimate.customer_id == customer_id)
    
    if search:
        query = query.filter(
            Estimate.estimate_number.ilike(f"%{search}%") |
            Estimate.title.ilike(f"%{search}%") |
            Estimate.customer_name.ilike(f"%{search}%")
        )
    
    total = query.count()
    estimates = query.order_by(Estimate.created_at.desc()).offset(skip).limit(limit).all()
    
    return EstimateListResponse(
        items=[EstimateResponse(**serialize_estimate(e)) for e in estimates],
        total=total,
        page=skip // limit + 1,
        page_size=limit,
    )


@router.get("/templates")
async def get_pdf_templates():
    """Get available PDF templates"""
    return get_template_info()


@router.get("/templates/{template_name}/sample-preview")
async def get_template_sample_preview(
    template_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render a sample estimate through a given template, for template pickers."""
    if template_name not in get_available_templates():
        raise HTTPException(status_code=404, detail="Unknown template")

    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    company_data = {
        "name": (company.name if company and company.name else "Your Company Name"),
        "address_line1": company.address_line1 if company else "",
        "city": company.city if company else "",
        "state": company.state if company else "",
        "zipcode": company.zipcode if company else "",
        "phone": company.phone if company else "",
        "email": company.email if company else "",
        "logo_url": company.logo_url if company else "",
    }

    sample_data = {
        "estimate_number": "EST-1001",
        "estimate_date": date.today().isoformat(),
        "valid_until": (date.today() + timedelta(days=30)).isoformat(),
        "company": company_data,
        "customer": {
            "name": "Jane Sample",
            "address": "482 Willow Creek Dr",
            "city": "Springfield",
            "state": "IL",
            "zipcode": "62704",
            "phone": "(555) 019-2837",
            "email": "jane.sample@example.com",
        },
        "sections": [
            {
                "name": "Water Mitigation",
                "subtotal": 880.00,
                "items": [
                    {
                        "name": "Emergency Water Extraction",
                        "description": "Category 2 water removal, living room and hallway",
                        "quantity": 1,
                        "unit": "ea",
                        "unit_price": 450.00,
                        "total": 450.00,
                    },
                    {
                        "name": "Structural Drying Equipment",
                        "description": "Air movers and dehumidifiers, 3-day rental",
                        "quantity": 3,
                        "unit": "day",
                        "unit_price": 85.00,
                        "total": 255.00,
                    },
                    {
                        "name": "Antimicrobial Treatment",
                        "description": "Applied to affected drywall and subfloor",
                        "quantity": 1,
                        "unit": "ea",
                        "unit_price": 175.00,
                        "total": 175.00,
                    },
                ],
            },
            {
                "name": "Materials & Repairs",
                "subtotal": 212.00,
                "items": [
                    {
                        "name": "Drywall Replacement",
                        "description": "1/2\" moisture-resistant drywall, 32 sq ft",
                        "quantity": 32,
                        "unit": "sqft",
                        "unit_price": 3.25,
                        "total": 104.00,
                    },
                    {
                        "name": "Baseboard Trim",
                        "description": "Primed MDF baseboard, installed",
                        "quantity": 24,
                        "unit": "lf",
                        "unit_price": 4.50,
                        "total": 108.00,
                    },
                ],
            },
        ],
        "subtotal": 1092.00,
        "taxable_subtotal": 1092.00,
        "tax_rate": 8.0,
        "tax_label": "Sales Tax",
        "tax_amount": 87.36,
        "total": 1179.36,
        "notes": "Sample estimate shown for template preview purposes only.",
        "terms": "This estimate is valid for 30 days from the date issued.",
        "primary_color": company.primary_color if company and company.primary_color else "#111827",
        "secondary_color": company.secondary_color if company and company.secondary_color else "#6b7280",
    }

    html_content = generate_estimate_html(sample_data, template_name)
    return {"html": html_content, "template": template_name}


@router.get("/excel-template")
async def download_estimate_excel_template():
    """Download Excel template for estimate import"""
    from app.common.excel_service import generate_template

    buffer = generate_template("estimate")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=scopit_estimate_template.xlsx"
        },
    )


@router.post("/import-excel")
async def parse_estimate_excel(
    file: UploadFile = File(...),
):
    """Parse uploaded Excel file and return preview data for estimate import"""
    from app.common.excel_service import parse_excel_file

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Please upload an Excel file (.xlsx)")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB.")

    return parse_excel_file(contents)


@router.get("/{estimate_id}", response_model=EstimateResponse)
async def get_estimate(
    estimate_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get single estimate"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()
    
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    return EstimateResponse(**serialize_estimate(estimate))


@router.post("", response_model=EstimateResponse, status_code=status.HTTP_201_CREATED)
async def create_estimate(
    data: EstimateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new estimate"""
    from app.domains.company.models import Company
    from app.domains.customer.models import Customer

    # Get company for numbering
    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    # Generate estimate number
    estimate_number = f"{company.estimate_prefix}-{company.next_estimate_number}"
    company.next_estimate_number += 1

    # Get customer info - prefer database lookup if customer_id provided, else use provided values
    customer_name = data.customer_name
    customer_email = data.customer_email
    customer_address = data.customer_address

    if data.customer_id:
        customer = db.query(Customer).filter(Customer.id == data.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address = customer.full_address

    # Get default status
    default_status = get_default_estimate_status(db, current_user.company_id)

    # Create estimate
    estimate = Estimate(
        company_id=current_user.company_id,
        estimate_number=estimate_number,
        status=EstimateStatus.DRAFT,  # Legacy field
        status_id=default_status.id if default_status else None,
        estimate_date=data.estimate_date or date.today(),
        valid_until=data.valid_until,
        customer_id=data.customer_id,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_address=customer_address,
        title=data.title,
        description=data.description,
        tax_rate=data.tax_rate or company.default_tax_rate,
        tax_label=data.tax_label or company.default_tax_label,
        notes=data.notes or company.default_notes,
        terms=data.terms or company.default_terms,
        created_by=current_user.id,
    )
    db.add(estimate)
    db.flush()
    
    # Create sections and items
    for section_data in data.sections:
        section = EstimateSection(
            estimate_id=estimate.id,
            name=section_data.name,
            order_index=section_data.order_index,
        )
        db.add(section)
        db.flush()
        
        for item_data in section_data.items:
            item = EstimateItem(
                estimate_id=estimate.id,
                section_id=section.id,
                line_item_id=item_data.line_item_id,
                code=item_data.code,
                name=item_data.name,
                description=item_data.description,
                unit=item_data.unit,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                total=item_data.quantity * item_data.unit_price,
                is_taxable=item_data.is_taxable,
                order_index=item_data.order_index,
                notes=item_data.notes or [],  # Store notes as JSON array
                images=item_data.images or [],
            )
            db.add(item)

    db.commit()
    db.refresh(estimate)
    
    # Recalculate totals
    recalculate_estimate(estimate, db)

    return EstimateResponse(**serialize_estimate(estimate))


@router.put("/{estimate_id}", response_model=EstimateResponse)
async def update_estimate(
    estimate_id: str,
    data: EstimateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update estimate"""
    from app.domains.customer.models import Customer

    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Update customer info - prefer database lookup if customer_id provided
    customer_name = data.customer_name
    customer_email = data.customer_email
    customer_address = data.customer_address

    if data.customer_id:
        customer = db.query(Customer).filter(Customer.id == data.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address = customer.full_address

    # Update estimate fields (exclude customer snapshot fields - handled separately below)
    customer_fields = {'sections', 'customer_name', 'customer_email', 'customer_address'}
    for field, value in data.model_dump(exclude_unset=True, exclude=customer_fields).items():
        if hasattr(estimate, field):
            setattr(estimate, field, value)

    # Set customer snapshot fields explicitly
    estimate.customer_name = customer_name
    estimate.customer_email = customer_email
    estimate.customer_address = customer_address

    # Delete existing items and sections (items first to avoid FK constraint issues)
    db.query(EstimateItem).filter(EstimateItem.estimate_id == estimate_id).delete(synchronize_session=False)
    db.query(EstimateSection).filter(EstimateSection.estimate_id == estimate_id).delete(synchronize_session=False)

    # Create new sections and items
    for section_data in data.sections:
        section = EstimateSection(
            estimate_id=estimate.id,
            name=section_data.name,
            order_index=section_data.order_index,
        )
        db.add(section)
        db.flush()

        for item_data in section_data.items:
            item = EstimateItem(
                estimate_id=estimate.id,
                section_id=section.id,
                line_item_id=item_data.line_item_id,
                code=item_data.code,
                name=item_data.name,
                description=item_data.description,
                unit=item_data.unit,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                total=item_data.quantity * item_data.unit_price,
                is_taxable=item_data.is_taxable,
                order_index=item_data.order_index,
                notes=item_data.notes or [],  # Store notes as JSON array
                images=item_data.images or [],
            )
            db.add(item)

    db.commit()
    db.refresh(estimate)

    # Recalculate totals
    recalculate_estimate(estimate, db)

    return EstimateResponse(**serialize_estimate(estimate))


@router.delete("/{estimate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_estimate(
    estimate_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete estimate"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()
    
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    db.delete(estimate)
    db.commit()


# ===================
# Section Operations
# ===================

@router.post("/{estimate_id}/sections", response_model=EstimateSectionResponse)
async def create_section(
    estimate_id: str,
    data: SectionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new section"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()
    
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    
    section = EstimateSection(
        estimate_id=estimate.id,
        name=data.name,
        order_index=data.order_index,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    
    return EstimateSectionResponse.model_validate(section)


@router.put("/{estimate_id}/sections/{section_id}", response_model=EstimateSectionResponse)
async def update_section(
    estimate_id: str,
    section_id: str,
    data: SectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update section"""
    section = db.query(EstimateSection).filter(
        EstimateSection.id == section_id,
    ).first()
    
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if hasattr(section, field):
            setattr(section, field, value)
    
    db.commit()
    db.refresh(section)
    
    return EstimateSectionResponse.model_validate(section)


@router.delete("/{estimate_id}/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    estimate_id: str,
    section_id: str,
    move_items_to: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete section"""
    section = db.query(EstimateSection).filter(
        EstimateSection.id == section_id,
    ).first()
    
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    
    # Move items to another section if specified
    if move_items_to:
        db.query(EstimateItem).filter(
            EstimateItem.section_id == section_id
        ).update({"section_id": move_items_to})
    
    db.delete(section)
    db.commit()


@router.put("/{estimate_id}/sections/reorder")
async def reorder_sections(
    estimate_id: str,
    data: ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder sections"""
    for index, section_id in enumerate(data.section_ids):
        db.query(EstimateSection).filter(
            EstimateSection.id == section_id
        ).update({"order_index": index})
    
    db.commit()
    return MessageResponse(message="Sections reordered")


# ===================
# Bulk Item Operations
# ===================

@router.post("/{estimate_id}/items/bulk-action")
async def bulk_action(
    estimate_id: str,
    data: BulkActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk action on items (delete, move, copy)"""
    
    if data.action == "delete":
        db.query(EstimateItem).filter(
            EstimateItem.id.in_(data.item_ids)
        ).delete(synchronize_session=False)
        db.commit()
        return BulkOperationResponse(
            message=f"{len(data.item_ids)} items deleted",
            affected_count=len(data.item_ids)
        )

    elif data.action == "move":
        if not data.target_section_id:
            raise HTTPException(status_code=400, detail="target_section_id required for move")

        db.query(EstimateItem).filter(
            EstimateItem.id.in_(data.item_ids)
        ).update({"section_id": data.target_section_id}, synchronize_session=False)
        db.commit()
        return BulkOperationResponse(
            message=f"{len(data.item_ids)} items moved",
            affected_count=len(data.item_ids)
        )
    
    elif data.action == "copy":
        if not data.target_section_id:
            raise HTTPException(status_code=400, detail="target_section_id required for copy")
        
        # Get original items
        items = db.query(EstimateItem).filter(
            EstimateItem.id.in_(data.item_ids)
        ).all()
        
        # Create copies
        for item in items:
            new_item = EstimateItem(
                estimate_id=item.estimate_id,
                section_id=data.target_section_id,
                line_item_id=item.line_item_id,
                code=item.code,
                name=item.name,
                description=item.description,
                unit=item.unit,
                quantity=item.quantity,
                unit_price=item.unit_price,
                total=item.total,
                is_taxable=item.is_taxable,
                order_index=item.order_index,
                notes=item.notes or [],  # Copy notes
                images=item.images or [],
            )
            db.add(new_item)
        
        db.commit()
        return BulkOperationResponse(
            message=f"{len(data.item_ids)} items copied",
            affected_count=len(data.item_ids)
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {data.action}")


@router.put("/{estimate_id}/items/reorder")
async def reorder_item(
    estimate_id: str,
    data: ItemReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder single item (move between sections)"""
    item = db.query(EstimateItem).filter(
        EstimateItem.id == data.item_id
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.section_id = data.target_section_id
    item.order_index = data.target_index
    
    db.commit()
    return MessageResponse(message="Item reordered")


# ===================
# Actions
# ===================

@router.post("/{estimate_id}/send")
async def send_estimate(
    estimate_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send estimate via email"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()
    
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Get "sent" status config
    sent_status = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.name == "sent",
        EstimateStatusConfig.is_active == True,
    ).first()

    # Update status
    estimate.status = EstimateStatus.SENT
    if sent_status:
        estimate.status_id = sent_status.id
    estimate.sent_at = datetime.utcnow()
    db.commit()

    # TODO: Send email

    return MessageResponse(message="Estimate sent")


@router.patch("/{estimate_id}/status", response_model=EstimateResponse)
async def update_estimate_status(
    estimate_id: str,
    data: StatusUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update estimate status"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Verify status exists and belongs to company
    status_config = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.id == data.status_id,
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.is_active == True,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Update status
    estimate.status_id = status_config.id
    # Also update legacy status field if matching
    legacy_status_map = {
        "draft": EstimateStatus.DRAFT,
        "sent": EstimateStatus.SENT,
        "viewed": EstimateStatus.VIEWED,
        "approved": EstimateStatus.APPROVED,
        "declined": EstimateStatus.DECLINED,
        "expired": EstimateStatus.EXPIRED,
        "converted": EstimateStatus.CONVERTED,
    }
    if status_config.name in legacy_status_map:
        estimate.status = legacy_status_map[status_config.name]

    db.commit()
    db.refresh(estimate)

    return EstimateResponse(**serialize_estimate(estimate))


class EstimateDatesUpdate(BaseModel):
    estimate_date: Optional[date] = None
    valid_until: Optional[date] = None


@router.patch("/{estimate_id}/dates", response_model=EstimateResponse)
async def update_estimate_dates(
    estimate_id: str,
    data: EstimateDatesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update estimate date and/or valid_until date."""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    if data.estimate_date is not None:
        estimate.estimate_date = data.estimate_date
    if data.valid_until is not None:
        estimate.valid_until = data.valid_until

    db.commit()
    db.refresh(estimate)

    return EstimateResponse(**serialize_estimate(estimate))


@router.post("/{estimate_id}/convert")
async def convert_to_invoice(
    estimate_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Convert estimate to invoice"""
    from app.domains.company.models import Company
    from app.domains.invoice.models import Invoice, InvoiceSection, InvoiceItem, InvoiceStatus
    from datetime import timedelta

    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    if estimate.status == EstimateStatus.CONVERTED:
        raise HTTPException(status_code=400, detail="Estimate already converted")

    # Get "converted" status config (system status)
    converted_status = db.query(EstimateStatusConfig).filter(
        EstimateStatusConfig.company_id == current_user.company_id,
        EstimateStatusConfig.name == "converted",
        EstimateStatusConfig.is_active == True,
    ).first()

    # Get company for invoice numbering
    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    # Generate invoice number
    invoice_number = f"{company.invoice_prefix}-{company.next_invoice_number}"
    company.next_invoice_number += 1

    from app.domains.invoice.models import InvoiceAdjustment

    # Create invoice from estimate
    invoice = Invoice(
        company_id=current_user.company_id,
        invoice_number=invoice_number,
        status=InvoiceStatus.DRAFT,
        invoice_date=date.today(),
        due_date=date.today() + timedelta(days=30),
        customer_id=estimate.customer_id,
        customer_name=estimate.customer_name,
        customer_email=estimate.customer_email,
        customer_address=estimate.customer_address,
        estimate_id=estimate.id,
        title=estimate.title,
        description=estimate.description,
        subtotal=estimate.subtotal,
        taxable_subtotal=estimate.taxable_subtotal,
        adjustments_total=estimate.adjustments_total or 0,
        tax_rate=estimate.tax_rate,
        tax_label=estimate.tax_label,
        tax_amount=estimate.tax_amount,
        discount_amount=estimate.discount_amount,
        total=estimate.total,
        amount_paid=0,
        balance_due=estimate.total,
        notes=estimate.notes,
        terms=estimate.terms,
        created_by=current_user.id,
    )
    db.add(invoice)
    db.flush()

    # Copy sections and items
    section_map = {}  # old_section_id -> new_section_id

    for est_section in estimate.sections:
        inv_section = InvoiceSection(
            invoice_id=invoice.id,
            name=est_section.name,
            order_index=est_section.order_index,
            is_collapsed=est_section.is_collapsed,
        )
        db.add(inv_section)
        db.flush()
        section_map[str(est_section.id)] = inv_section.id

    for est_item in estimate.items:
        inv_item = InvoiceItem(
            invoice_id=invoice.id,
            section_id=section_map.get(str(est_item.section_id)) if est_item.section_id else None,
            line_item_id=est_item.line_item_id,
            code=est_item.code,
            name=est_item.name,
            description=est_item.description,
            unit=est_item.unit,
            quantity=est_item.quantity,
            unit_price=est_item.unit_price,
            total=est_item.total,
            is_taxable=est_item.is_taxable,
            order_index=est_item.order_index,
            notes=est_item.notes or [],
            images=est_item.images or [],
        )
        db.add(inv_item)

    # Copy adjustments
    for est_adj in estimate.adjustments:
        from app.domains.invoice.models import AdjustmentType as InvAdjustmentType
        inv_adj = InvoiceAdjustment(
            invoice_id=invoice.id,
            type=InvAdjustmentType(est_adj.type.value) if est_adj.type else None,
            name=est_adj.name,
            percentage=est_adj.percentage,
            amount=est_adj.amount,
            order_index=est_adj.order_index,
        )
        db.add(inv_adj)

    # Update estimate status
    estimate.status = EstimateStatus.CONVERTED
    if converted_status:
        estimate.status_id = converted_status.id
    estimate.converted_at = datetime.utcnow()

    db.commit()
    db.refresh(invoice)

    return {
        "message": "Estimate converted to invoice",
        "invoice_id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
    }


def _prepare_estimate_pdf_data(estimate: Estimate, company: Company, db: Session) -> dict:
    """Prepare estimate data for PDF generation"""
    # Get customer info
    customer = estimate.customer

    # Build company info dict
    company_info = {
        "name": company.name or "",
        "legal_name": company.legal_name or "",
        "address_line1": company.address_line1 or "",
        "address_line2": company.address_line2 or "",
        "city": company.city or "",
        "state": company.state or "",
        "zipcode": company.zipcode or "",
        "phone": company.phone or "",
        "email": company.email or "",
        "logo_url": company.logo_url or "",
    }

    # Build customer info dict - use snapshot fields as fallback when customer relationship is None
    customer_info = {
        "name": (customer.name if customer else (estimate.customer_name or "")) or "",
        "address": (customer.address_line1 if customer else (estimate.customer_address or "")) or "",
        "address_line2": (customer.address_line2 if customer else "") or "",
        "city": (customer.city if customer else "") or "",
        "state": (customer.state if customer else "") or "",
        "zipcode": (customer.zipcode if customer else "") or "",
        "phone": (customer.phone if customer else "") or "",
        "email": (customer.email if customer else (estimate.customer_email or "")) or "",
    }

    # Build sections with items
    sections_data = []
    for section in sorted(estimate.sections, key=lambda s: s.order_index):
        section_items = []
        for item in sorted(section.items, key=lambda i: i.order_index):
            section_items.append({
                "name": item.name or "",
                "description": item.description or "",
                "unit": item.unit or "ea",
                "quantity": float(item.quantity) if item.quantity else 0,
                "unit_price": float(item.unit_price) if item.unit_price else 0,
                "total": float(item.total) if item.total else 0,
                "is_taxable": item.is_taxable,
                "notes": item.notes or [],
                "images": item.images or [],
            })
        sections_data.append({
            "name": section.name or "",
            "items": section_items,
            "subtotal": sum(i["total"] for i in section_items),
        })

    # Build adjustments
    adjustments_data = []
    for adj in sorted(estimate.adjustments, key=lambda a: a.order_index):
        adjustments_data.append({
            "name": adj.name or "",
            "type": adj.type.value if adj.type else "premium",
            "percentage": float(adj.percentage) if adj.percentage else 0,
            "amount": float(adj.amount) if adj.amount else 0,
        })

    return {
        "estimate_number": estimate.estimate_number or "",
        "estimate_date": estimate.estimate_date,
        "valid_until": estimate.valid_until,
        "company": company_info,
        "customer": customer_info,
        "sections": sections_data,
        "adjustments": adjustments_data,
        "subtotal": float(estimate.subtotal) if estimate.subtotal else 0,
        "taxable_subtotal": float(estimate.taxable_subtotal) if estimate.taxable_subtotal else 0,
        "adjustments_total": float(estimate.adjustments_total) if estimate.adjustments_total else 0,
        "tax_rate": float(estimate.tax_rate) if estimate.tax_rate else 0,
        "tax_label": estimate.tax_label or "Tax",
        "tax_amount": float(estimate.tax_amount) if estimate.tax_amount else 0,
        "total": float(estimate.total) if estimate.total else 0,
        "notes": estimate.notes or "",
        "terms": estimate.terms or "",
        "primary_color": company.primary_color or "#111827",
        "secondary_color": company.secondary_color or "#6b7280",
    }


@router.get("/{estimate_id}/preview")
async def get_estimate_preview(
    estimate_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get estimate as HTML preview"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    pdf_data = _prepare_estimate_pdf_data(estimate, company, db)

    # Generate HTML
    html_content = generate_estimate_html(pdf_data, template_name)

    return {
        "html": html_content,
        "template": template_name,
    }


@router.get("/{estimate_id}/pdf")
async def get_pdf(
    estimate_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get estimate as PDF"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    pdf_data = _prepare_estimate_pdf_data(estimate, company, db)

    # Generate PDF
    pdf_bytes = generate_estimate_pdf(pdf_data, template_name)

    # Build filename with address
    customer_name = estimate.customer.name if estimate.customer else (estimate.customer_name or "Customer")
    customer_addr = ""
    if estimate.customer:
        addr_parts = [estimate.customer.address_line1, estimate.customer.city, estimate.customer.state]
        customer_addr = " ".join(p for p in addr_parts if p)
    elif estimate.customer_address:
        customer_addr = estimate.customer_address
    filename = f"{customer_name} - {customer_addr} - Estimate {estimate.estimate_number}.pdf" if customer_addr else f"{customer_name} - Estimate {estimate.estimate_number}.pdf"
    # Clean filename
    filename = "".join(c for c in filename if c.isalnum() or c in (' ', '-', '_', '.', ',')).strip()

    return Response(
        content=pdf_bytes.read(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


# ===================
# Payment Operations
# ===================

@router.post("/{estimate_id}/payments", response_model=PaymentResponse)
async def record_payment(
    estimate_id: str,
    data: PaymentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a payment for an estimate"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Create payment
    payment = EstimatePayment(
        estimate_id=estimate.id,
        amount=data.amount,
        payment_method=PaymentMethod(data.payment_method) if data.payment_method else None,
        payment_date=data.payment_date,
        reference_number=data.reference_number,
        notes=data.notes,
        recorded_by=current_user.id,
    )
    db.add(payment)
    db.flush()

    # Recalculate totals
    recalculate_estimate(estimate, db)

    return PaymentResponse(
        id=str(payment.id),
        amount=payment.amount,
        payment_method=payment.payment_method.value if payment.payment_method else None,
        payment_date=payment.payment_date,
        reference_number=payment.reference_number,
        notes=payment.notes,
        created_at=payment.created_at,
    )


@router.delete("/{estimate_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment(
    estimate_id: str,
    payment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a payment"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    payment = db.query(EstimatePayment).filter(
        EstimatePayment.id == payment_id,
        EstimatePayment.estimate_id == estimate_id,
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    db.delete(payment)
    db.commit()

    # Recalculate totals
    recalculate_estimate(estimate, db)


# ===================
# Adjustment Operations
# ===================

@router.post("/{estimate_id}/adjustments", response_model=AdjustmentResponse)
async def create_adjustment(
    estimate_id: str,
    data: AdjustmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create an adjustment (premium or discount) for an estimate"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # Validate type
    if data.type not in ['premium', 'discount']:
        raise HTTPException(status_code=400, detail="Type must be 'premium' or 'discount'")

    # Calculate amount based on subtotal
    amount = estimate.subtotal * (data.percentage / 100)

    # Create adjustment
    adjustment = EstimateAdjustment(
        estimate_id=estimate.id,
        type=AdjustmentType(data.type),
        name=data.name,
        percentage=data.percentage,
        amount=amount,
        order_index=data.order_index,
    )
    db.add(adjustment)
    db.flush()

    # Recalculate totals
    recalculate_estimate(estimate, db)

    return AdjustmentResponse(
        id=str(adjustment.id),
        type=adjustment.type.value,
        name=adjustment.name,
        percentage=adjustment.percentage,
        amount=adjustment.amount,
        order_index=adjustment.order_index,
        created_at=adjustment.created_at,
    )


@router.put("/{estimate_id}/adjustments/{adjustment_id}", response_model=AdjustmentResponse)
async def update_adjustment(
    estimate_id: str,
    adjustment_id: str,
    data: AdjustmentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an adjustment"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    adjustment = db.query(EstimateAdjustment).filter(
        EstimateAdjustment.id == adjustment_id,
        EstimateAdjustment.estimate_id == estimate_id,
    ).first()

    if not adjustment:
        raise HTTPException(status_code=404, detail="Adjustment not found")

    # Update fields
    if data.type is not None:
        if data.type not in ['premium', 'discount']:
            raise HTTPException(status_code=400, detail="Type must be 'premium' or 'discount'")
        adjustment.type = AdjustmentType(data.type)

    if data.name is not None:
        adjustment.name = data.name

    if data.percentage is not None:
        adjustment.percentage = data.percentage

    if data.order_index is not None:
        adjustment.order_index = data.order_index

    db.commit()

    # Recalculate totals
    recalculate_estimate(estimate, db)

    db.refresh(adjustment)

    return AdjustmentResponse(
        id=str(adjustment.id),
        type=adjustment.type.value,
        name=adjustment.name,
        percentage=adjustment.percentage,
        amount=adjustment.amount,
        order_index=adjustment.order_index,
        created_at=adjustment.created_at,
    )


@router.delete("/{estimate_id}/adjustments/{adjustment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_adjustment(
    estimate_id: str,
    adjustment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an adjustment"""
    estimate = db.query(Estimate).filter(
        and_(
            Estimate.id == estimate_id,
            Estimate.company_id == current_user.company_id,
        )
    ).first()

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    adjustment = db.query(EstimateAdjustment).filter(
        EstimateAdjustment.id == adjustment_id,
        EstimateAdjustment.estimate_id == estimate_id,
    ).first()

    if not adjustment:
        raise HTTPException(status_code=404, detail="Adjustment not found")

    db.delete(adjustment)
    db.commit()

    # Recalculate totals
    recalculate_estimate(estimate, db)
