"""
Scopit - Invoice API Routes
"""
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

# Currency precision constant
CURRENCY_PRECISION = Decimal('0.01')

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.pdf_generator import (
    DEFAULT_TEMPLATE,
    generate_invoice_html,
    generate_invoice_pdf,
    generate_receipt_html,
    generate_receipt_pdf,
    get_template_info,
)
from app.domains.company.models import Company
from app.domains.invoice.models import (
    AdjustmentType,
    Invoice,
    InvoiceAdjustment,
    InvoiceItem,
    InvoiceSection,
    InvoiceStatus,
    Payment,
    PaymentMethod,
)
from app.domains.settings.models import InvoiceStatusConfig
from app.domains.user.models import User

router = APIRouter()


# ===================
# Schemas
# ===================

class StatusUpdateRequest(BaseModel):
    status_id: str = Field(alias="statusId")

    model_config = {"populate_by_name": True}


class InvoiceItemCreate(BaseModel):
    line_item_id: Optional[str] = Field(default=None, alias="lineItemId")
    code: Optional[str] = None
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Decimal = 1
    unit_price: Decimal = Field(default=0, alias="unitPrice")
    is_taxable: bool = Field(default=True, alias="isTaxable")
    order_index: int = Field(default=0, alias="orderIndex")
    notes: Optional[List[str]] = None
    images: Optional[List[dict]] = None  # [{"filename": "...", "data": "base64..."}]

    model_config = {"populate_by_name": True}


class InvoiceSectionCreate(BaseModel):
    name: str
    order_index: int = Field(default=0, alias="orderIndex")
    items: List[InvoiceItemCreate] = []

    model_config = {"populate_by_name": True}


class InvoiceCreate(BaseModel):
    customer_id: Optional[str] = Field(default=None, alias="customerId")
    customer_name: Optional[str] = Field(default=None, alias="customerName")
    customer_email: Optional[str] = Field(default=None, alias="customerEmail")
    customer_address_line1: Optional[str] = Field(default=None, alias="customerAddressLine1")
    customer_address_line2: Optional[str] = Field(default=None, alias="customerAddressLine2")
    customer_city: Optional[str] = Field(default=None, alias="customerCity")
    customer_state: Optional[str] = Field(default=None, alias="customerState")
    customer_zipcode: Optional[str] = Field(default=None, alias="customerZipcode")
    estimate_id: Optional[str] = Field(default=None, alias="estimateId")
    invoice_date: Optional[date] = Field(default=None, alias="invoiceDate")
    due_date: Optional[date] = Field(default=None, alias="dueDate")
    title: Optional[str] = None
    description: Optional[str] = None
    tax_rate: Optional[Decimal] = Field(default=None, alias="taxRate")
    tax_label: Optional[str] = Field(default=None, alias="taxLabel")
    notes: Optional[str] = None
    terms: Optional[str] = None
    payment_schedule: Optional[List[dict]] = Field(default=None, alias="paymentSchedule")
    sections: List[InvoiceSectionCreate] = []

    model_config = {"populate_by_name": True}


class InvoiceItemResponse(BaseModel):
    id: str
    sectionId: Optional[str] = None
    lineItemId: Optional[str] = None
    code: Optional[str] = None
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Decimal
    unitPrice: Decimal
    total: Decimal
    isTaxable: bool
    orderIndex: int
    notes: Optional[List[str]] = []
    images: Optional[List[dict]] = []

    model_config = {"from_attributes": True, "populate_by_name": True}


class InvoiceSectionResponse(BaseModel):
    id: str
    name: str
    orderIndex: int
    isCollapsed: bool
    items: List[InvoiceItemResponse] = []
    subtotal: Decimal = 0

    model_config = {"from_attributes": True, "populate_by_name": True}


class PaymentResponse(BaseModel):
    id: str
    amount: Decimal
    paymentMethod: str
    paymentDate: Optional[date] = None
    referenceNumber: Optional[str] = None
    notes: Optional[str] = None
    createdAt: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class StatusConfigResponse(BaseModel):
    id: str
    name: str
    label: str
    color: str
    bgColor: str

    model_config = {"from_attributes": True, "populate_by_name": True}


class AdjustmentResponse(BaseModel):
    id: str
    type: str
    name: str
    percentage: Decimal
    amount: Decimal
    orderIndex: int
    createdAt: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class InvoiceResponse(BaseModel):
    id: str
    invoiceNumber: str
    status: Optional[str] = None
    statusId: Optional[str] = None
    statusConfig: Optional[StatusConfigResponse] = None
    invoiceDate: date
    dueDate: Optional[date] = None
    customerId: Optional[str] = None
    customerName: Optional[str] = None
    customerEmail: Optional[str] = None
    customerAddressLine1: Optional[str] = None
    customerAddressLine2: Optional[str] = None
    customerCity: Optional[str] = None
    customerState: Optional[str] = None
    customerZipcode: Optional[str] = None
    estimateId: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    subtotal: Decimal
    taxableSubtotal: Decimal
    adjustmentsTotal: Decimal = 0
    taxRate: Optional[Decimal] = None
    taxLabel: Optional[str] = None
    taxAmount: Decimal
    discountAmount: Decimal
    total: Decimal
    amountPaid: Decimal
    balanceDue: Decimal
    notes: Optional[str] = None
    terms: Optional[str] = None
    paymentSchedule: Optional[List[dict]] = None
    sections: List[InvoiceSectionResponse] = []
    payments: List[PaymentResponse] = []
    adjustments: List[AdjustmentResponse] = []
    createdBy: Optional[str] = None
    createdAt: datetime
    updatedAt: Optional[datetime] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class InvoiceListResponse(BaseModel):
    items: List[InvoiceResponse]
    total: int
    page: int
    pageSize: int


class RecordPaymentRequest(BaseModel):
    amount: Decimal
    payment_method: PaymentMethod = Field(default=PaymentMethod.OTHER, alias="paymentMethod")
    payment_date: Optional[date] = Field(default=None, alias="paymentDate")
    reference_number: Optional[str] = Field(default=None, alias="referenceNumber")
    notes: Optional[str] = None

    model_config = {"populate_by_name": True}


# Adjustment Schemas
class AdjustmentCreate(BaseModel):
    type: str  # premium or discount
    name: str
    percentage: Decimal
    order_index: int = Field(default=0, alias="orderIndex")

    model_config = {"populate_by_name": True}


class AdjustmentUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    percentage: Optional[Decimal] = None
    order_index: Optional[int] = Field(default=None, alias="orderIndex")

    model_config = {"populate_by_name": True}


# ===================
# Helper Functions
# ===================

def serialize_invoice(invoice: Invoice) -> dict:
    """Serialize invoice with status_config, payments, and adjustments (camelCase keys for frontend)"""
    data = {
        "id": str(invoice.id),
        "invoiceNumber": invoice.invoice_number,
        "status": invoice.status.value if invoice.status else None,
        "statusId": str(invoice.status_id) if invoice.status_id else None,
        "statusConfig": None,
        "invoiceDate": invoice.invoice_date,
        "dueDate": invoice.due_date,
        "customerId": str(invoice.customer_id) if invoice.customer_id else None,
        "customerName": invoice.customer_name,
        "customerEmail": invoice.customer_email,
        "customerAddressLine1": invoice.customer_address_line1,
        "customerAddressLine2": invoice.customer_address_line2,
        "customerCity": invoice.customer_city,
        "customerState": invoice.customer_state,
        "customerZipcode": invoice.customer_zipcode,
        "estimateId": str(invoice.estimate_id) if invoice.estimate_id else None,
        "title": invoice.title,
        "description": invoice.description,
        "subtotal": invoice.subtotal,
        "taxableSubtotal": invoice.taxable_subtotal,
        "adjustmentsTotal": invoice.adjustments_total or 0,
        "taxRate": invoice.tax_rate,
        "taxLabel": invoice.tax_label,
        "taxAmount": invoice.tax_amount,
        "discountAmount": invoice.discount_amount,
        "total": invoice.total,
        "amountPaid": invoice.amount_paid,
        "balanceDue": invoice.balance_due,
        "notes": invoice.notes,
        "terms": invoice.terms,
        "paymentSchedule": invoice.payment_schedule,
        "companyOverride": invoice.company_override,
        "createdBy": str(invoice.created_by) if invoice.created_by else None,
        "createdAt": invoice.created_at,
        "updatedAt": invoice.updated_at,
        "sections": [],
        "payments": [],
        "adjustments": [],
    }

    # Add status_config if available
    if invoice.status_config:
        data["statusConfig"] = {
            "id": str(invoice.status_config.id),
            "name": invoice.status_config.name,
            "label": invoice.status_config.label,
            "color": invoice.status_config.color,
            "bgColor": invoice.status_config.bg_color,
        }

    # Add sections with items
    for section in invoice.sections:
        section_data = {
            "id": str(section.id),
            "name": section.name,
            "orderIndex": section.order_index,
            "isCollapsed": section.is_collapsed,
            "subtotal": Decimal(0),
            "items": [],
        }
        section_subtotal = Decimal(0)
        for item in section.items:
            section_data["items"].append({
                "id": str(item.id),
                "sectionId": str(item.section_id) if item.section_id else None,
                "lineItemId": str(item.line_item_id) if item.line_item_id else None,
                "code": item.code,
                "name": item.name,
                "description": item.description,
                "unit": item.unit,
                "quantity": item.quantity,
                "unitPrice": item.unit_price,
                "total": item.total,
                "isTaxable": item.is_taxable,
                "orderIndex": item.order_index,
                "notes": item.notes or [],
                "images": item.images or [],
            })
            section_subtotal += item.total
        section_data["subtotal"] = section_subtotal
        data["sections"].append(section_data)

    # Add payments
    for payment in invoice.payments:
        data["payments"].append({
            "id": str(payment.id),
            "amount": payment.amount,
            "paymentMethod": payment.payment_method.value if payment.payment_method else None,
            "paymentDate": payment.payment_date,
            "referenceNumber": payment.reference_number,
            "notes": payment.notes,
            "createdAt": payment.created_at,
        })

    # Add adjustments
    for adjustment in invoice.adjustments:
        data["adjustments"].append({
            "id": str(adjustment.id),
            "type": adjustment.type.value if adjustment.type else None,
            "name": adjustment.name,
            "percentage": adjustment.percentage,
            "amount": adjustment.amount,
            "orderIndex": adjustment.order_index,
            "createdAt": adjustment.created_at,
        })

    return data


def get_default_invoice_status(db: Session, company_id) -> InvoiceStatusConfig:
    """Get default invoice status config for company"""
    default_status = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.company_id == company_id,
        InvoiceStatusConfig.is_default == True,
        InvoiceStatusConfig.is_active == True,
    ).first()

    # If no default, get first active status
    if not default_status:
        default_status = db.query(InvoiceStatusConfig).filter(
            InvoiceStatusConfig.company_id == company_id,
            InvoiceStatusConfig.is_active == True,
        ).order_by(InvoiceStatusConfig.order_index).first()

    return default_status


def get_invoice_status_by_name(db: Session, company_id, name: str) -> InvoiceStatusConfig:
    """Get invoice status config by name"""
    return db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.company_id == company_id,
        InvoiceStatusConfig.name == name,
        InvoiceStatusConfig.is_active == True,
    ).first()


def recalculate_invoice(invoice: Invoice, db: Session):
    """Recalculate invoice totals including adjustments and payments"""
    subtotal = Decimal(0)
    taxable_subtotal = Decimal(0)

    # Calculate item totals
    for item in invoice.items:
        item_total = (item.quantity * item.unit_price).quantize(
            CURRENCY_PRECISION, rounding=ROUND_HALF_UP
        )
        item.total = item_total
        subtotal += item_total
        if item.is_taxable:
            taxable_subtotal += item_total

    invoice.subtotal = subtotal
    invoice.taxable_subtotal = taxable_subtotal

    # Calculate adjustments (premiums add, discounts subtract)
    # percentage > 0  → recalculate amount from subtotal
    # percentage == 0 → fixed amount, keep existing value as-is
    premium_total = Decimal(0)
    discount_total = Decimal(0)
    for adjustment in invoice.adjustments:
        if adjustment.percentage and adjustment.percentage > 0:
            adjustment_amount = (subtotal * (adjustment.percentage / 100)).quantize(
                CURRENCY_PRECISION, rounding=ROUND_HALF_UP
            )
            adjustment.amount = adjustment_amount
        else:
            adjustment_amount = adjustment.amount or Decimal(0)
        if adjustment.type == AdjustmentType.PREMIUM:
            premium_total += adjustment_amount
        elif adjustment.type == AdjustmentType.DISCOUNT:
            discount_total += adjustment_amount

    invoice.adjustments_total = premium_total - discount_total
    adjusted_subtotal = subtotal + invoice.adjustments_total

    # Calculate tax on adjusted subtotal (proportional to taxable items)
    if invoice.tax_rate:
        if subtotal > 0:
            taxable_ratio = taxable_subtotal / subtotal
            adjusted_taxable = adjusted_subtotal * taxable_ratio
        else:
            adjusted_taxable = Decimal(0)
        invoice.tax_amount = (adjusted_taxable * (invoice.tax_rate / 100)).quantize(
            CURRENCY_PRECISION, rounding=ROUND_HALF_UP
        )
    else:
        invoice.tax_amount = Decimal(0)

    invoice.total = (adjusted_subtotal + invoice.tax_amount).quantize(
        CURRENCY_PRECISION, rounding=ROUND_HALF_UP
    )

    # Calculate amount paid from all payments
    amount_paid = sum(
        (payment.amount or Decimal(0)) for payment in invoice.payments
    )
    invoice.amount_paid = amount_paid
    invoice.balance_due = (invoice.total - amount_paid).quantize(
        CURRENCY_PRECISION, rounding=ROUND_HALF_UP
    )

    # Update status based on payment
    if amount_paid >= invoice.total and invoice.total > 0:
        invoice.status = InvoiceStatus.PAID
        paid_status = get_invoice_status_by_name(db, invoice.company_id, "paid")
        if paid_status:
            invoice.status_id = paid_status.id
        invoice.paid_at = datetime.utcnow()
    elif amount_paid > 0:
        invoice.status = InvoiceStatus.PARTIAL
        partial_status = get_invoice_status_by_name(db, invoice.company_id, "partial")
        if partial_status:
            invoice.status_id = partial_status.id
        invoice.paid_at = None
    elif invoice.status in (InvoiceStatus.PAID, InvoiceStatus.PARTIAL):
        # Reset to draft if all payments removed or total changed
        default_status = get_default_invoice_status(db, invoice.company_id)
        if default_status:
            invoice.status = InvoiceStatus.DRAFT
            invoice.status_id = default_status.id
        invoice.paid_at = None

    db.commit()


# ===================
# Invoice CRUD
# ===================

@router.get("", response_model=InvoiceListResponse)
async def list_invoices(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List invoices"""
    query = db.query(Invoice).filter(Invoice.company_id == current_user.company_id)

    if status:
        query = query.filter(Invoice.status == status)

    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)

    if search:
        query = query.filter(
            Invoice.invoice_number.ilike(f"%{search}%") |
            Invoice.title.ilike(f"%{search}%") |
            Invoice.customer_name.ilike(f"%{search}%")
        )

    total = query.count()
    invoices = query.order_by(Invoice.created_at.desc()).offset(skip).limit(limit).all()

    return InvoiceListResponse(
        items=[InvoiceResponse(**serialize_invoice(inv)) for inv in invoices],
        total=total,
        page=skip // limit + 1,
        pageSize=limit,
    )


@router.get("/templates")
async def get_pdf_templates():
    """Get available PDF templates"""
    return get_template_info()


@router.get("/excel-template")
async def download_invoice_excel_template():
    """Download Excel template for invoice import"""
    from app.common.excel_service import generate_template

    buffer = generate_template("invoice")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=scopit_invoice_template.xlsx"
        },
    )


@router.post("/import-excel")
async def parse_invoice_excel(
    file: UploadFile = File(...),
):
    """Parse uploaded Excel file and return preview data for invoice import"""
    from app.common.excel_service import parse_excel_file

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Please upload an Excel file (.xlsx)")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB.")

    return parse_excel_file(contents)


@router.get("/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get single invoice"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return InvoiceResponse(**serialize_invoice(invoice))


@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    data: InvoiceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new invoice"""
    from app.domains.company.models import Company
    from app.domains.customer.models import Customer

    # Get company for numbering
    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    # Generate invoice number
    invoice_number = f"{company.invoice_prefix}-{company.next_invoice_number}"
    company.next_invoice_number += 1

    # Get customer info - prefer database lookup if customer_id provided, else use provided values
    customer_name = data.customer_name
    customer_email = data.customer_email
    customer_address_line1 = data.customer_address_line1
    customer_address_line2 = data.customer_address_line2
    customer_city = data.customer_city
    customer_state = data.customer_state
    customer_zipcode = data.customer_zipcode

    if data.customer_id:
        customer = db.query(Customer).filter(Customer.id == data.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address_line1 = customer.address_line1
            customer_address_line2 = customer.address_line2
            customer_city = customer.city
            customer_state = customer.state
            customer_zipcode = customer.zipcode

    # Default due date is 30 days from invoice date
    invoice_date = data.invoice_date or date.today()
    due_date = data.due_date or (invoice_date + timedelta(days=30))

    # Get default status
    default_status = get_default_invoice_status(db, current_user.company_id)

    # Create invoice
    invoice = Invoice(
        company_id=current_user.company_id,
        invoice_number=invoice_number,
        status=InvoiceStatus.DRAFT,  # Legacy field
        status_id=default_status.id if default_status else None,
        invoice_date=invoice_date,
        due_date=due_date,
        customer_id=data.customer_id,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_address_line1=customer_address_line1,
        customer_address_line2=customer_address_line2,
        customer_city=customer_city,
        customer_state=customer_state,
        customer_zipcode=customer_zipcode,
        estimate_id=data.estimate_id,
        title=data.title,
        description=data.description,
        tax_rate=data.tax_rate or company.default_tax_rate,
        tax_label=data.tax_label or company.default_tax_label,
        notes=data.notes or company.default_notes,
        terms=data.terms or company.default_terms,
        payment_schedule=data.payment_schedule,
        created_by=current_user.id,
    )
    db.add(invoice)
    db.flush()

    # Create sections and items
    for section_data in data.sections:
        section = InvoiceSection(
            invoice_id=invoice.id,
            name=section_data.name,
            order_index=section_data.order_index,
        )
        db.add(section)
        db.flush()

        for item_data in section_data.items:
            item = InvoiceItem(
                invoice_id=invoice.id,
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
                notes=item_data.notes or [],
                images=item_data.images or [],
            )
            db.add(item)

    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.put("/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(
    invoice_id: str,
    data: InvoiceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update invoice"""
    from app.domains.customer.models import Customer

    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Update customer info - prefer database lookup if customer_id provided
    customer_name = data.customer_name
    customer_email = data.customer_email
    customer_address_line1 = data.customer_address_line1
    customer_address_line2 = data.customer_address_line2
    customer_city = data.customer_city
    customer_state = data.customer_state
    customer_zipcode = data.customer_zipcode

    if data.customer_id:
        customer = db.query(Customer).filter(Customer.id == data.customer_id).first()
        if customer:
            customer_name = customer.name
            customer_email = customer.email
            customer_address_line1 = customer.address_line1
            customer_address_line2 = customer.address_line2
            customer_city = customer.city
            customer_state = customer.state
            customer_zipcode = customer.zipcode

    # Update invoice fields (exclude customer snapshot fields - handled separately below)
    customer_fields = {
        'sections', 'customer_name', 'customer_email',
        'customer_address_line1', 'customer_address_line2',
        'customer_city', 'customer_state', 'customer_zipcode',
    }
    for field, value in data.model_dump(exclude_unset=True, exclude=customer_fields).items():
        if hasattr(invoice, field):
            setattr(invoice, field, value)

    # Set customer snapshot fields explicitly
    invoice.customer_name = customer_name
    invoice.customer_email = customer_email
    invoice.customer_address_line1 = customer_address_line1
    invoice.customer_address_line2 = customer_address_line2
    invoice.customer_city = customer_city
    invoice.customer_state = customer_state
    invoice.customer_zipcode = customer_zipcode

    # Delete existing sections and items
    db.query(InvoiceSection).filter(InvoiceSection.invoice_id == invoice_id).delete()
    db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice_id).delete()

    # Create new sections and items
    for section_data in data.sections:
        section = InvoiceSection(
            invoice_id=invoice.id,
            name=section_data.name,
            order_index=section_data.order_index,
        )
        db.add(section)
        db.flush()

        for item_data in section_data.items:
            item = InvoiceItem(
                invoice_id=invoice.id,
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
                notes=item_data.notes or [],
                images=item_data.images or [],
            )
            db.add(item)

    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.patch("/{invoice_id}/status", response_model=InvoiceResponse)
async def update_invoice_status(
    invoice_id: str,
    data: StatusUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update invoice status"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Verify status exists and belongs to company
    status_config = db.query(InvoiceStatusConfig).filter(
        InvoiceStatusConfig.id == data.status_id,
        InvoiceStatusConfig.company_id == current_user.company_id,
        InvoiceStatusConfig.is_active == True,
    ).first()

    if not status_config:
        raise HTTPException(status_code=404, detail="Status not found")

    # Update status
    invoice.status_id = status_config.id
    # Also update legacy status field if matching
    legacy_status_map = {
        "draft": InvoiceStatus.DRAFT,
        "sent": InvoiceStatus.SENT,
        "viewed": InvoiceStatus.VIEWED,
        "paid": InvoiceStatus.PAID,
        "partial": InvoiceStatus.PARTIAL,
        "overdue": InvoiceStatus.OVERDUE,
        "canceled": InvoiceStatus.CANCELED,
    }
    if status_config.name in legacy_status_map:
        invoice.status = legacy_status_map[status_config.name]

    db.commit()
    db.refresh(invoice)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete invoice"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    db.delete(invoice)
    db.commit()


# ===================
# Payment Operations
# ===================

@router.post("/{invoice_id}/payments", response_model=InvoiceResponse)
async def record_payment(
    invoice_id: str,
    data: RecordPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a payment for an invoice"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    payment = Payment(
        invoice_id=invoice.id,
        amount=data.amount,
        payment_method=data.payment_method,
        payment_date=data.payment_date,
        reference_number=data.reference_number,
        notes=data.notes,
        recorded_by=current_user.id,
    )
    db.add(payment)

    # Update amount paid
    invoice.amount_paid += data.amount

    db.commit()
    db.refresh(invoice)

    # Recalculate (this will update status based on payment)
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.patch("/{invoice_id}/payments/{payment_id}", response_model=InvoiceResponse)
async def update_payment(
    invoice_id: str,
    payment_id: str,
    data: RecordPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing payment"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    payment = db.query(Payment).filter(
        and_(
            Payment.id == payment_id,
            Payment.invoice_id == invoice_id,
        )
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Update payment fields
    payment.amount = data.amount
    payment.payment_method = data.payment_method
    payment.payment_date = data.payment_date
    payment.reference_number = data.reference_number
    payment.notes = data.notes

    db.commit()
    db.refresh(invoice)

    # Recalculate (this will update amount_paid and status)
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.delete("/{invoice_id}/payments/{payment_id}", response_model=InvoiceResponse)
async def delete_payment(
    invoice_id: str,
    payment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a payment"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    payment = db.query(Payment).filter(
        and_(
            Payment.id == payment_id,
            Payment.invoice_id == invoice_id,
        )
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Update amount paid
    invoice.amount_paid -= payment.amount

    db.delete(payment)
    db.commit()
    db.refresh(invoice)

    # Recalculate
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


# ===================
# Actions
# ===================

@router.post("/{invoice_id}/mark-sent", response_model=InvoiceResponse)
async def mark_as_sent(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark invoice as sent"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Get "sent" status config
    sent_status = get_invoice_status_by_name(db, current_user.company_id, "sent")

    invoice.status = InvoiceStatus.SENT
    if sent_status:
        invoice.status_id = sent_status.id
    invoice.sent_at = datetime.utcnow()
    db.commit()
    db.refresh(invoice)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.post("/{invoice_id}/cancel", response_model=InvoiceResponse)
async def cancel_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel invoice"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Get "canceled" status config
    canceled_status = get_invoice_status_by_name(db, current_user.company_id, "canceled")

    invoice.status = InvoiceStatus.CANCELED
    if canceled_status:
        invoice.status_id = canceled_status.id
    db.commit()
    db.refresh(invoice)

    return InvoiceResponse(**serialize_invoice(invoice))


# ===================
# Adjustment Operations
# ===================

@router.post("/{invoice_id}/adjustments", response_model=InvoiceResponse)
async def add_adjustment(
    invoice_id: str,
    data: AdjustmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add an adjustment (premium/discount) to an invoice"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Validate adjustment type
    try:
        adj_type = AdjustmentType(data.type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid adjustment type. Must be 'premium' or 'discount'"
        )

    adjustment = InvoiceAdjustment(
        invoice_id=invoice.id,
        type=adj_type,
        name=data.name,
        percentage=data.percentage,
        order_index=data.order_index,
    )
    db.add(adjustment)
    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.put(
    "/{invoice_id}/adjustments/{adjustment_id}",
    response_model=InvoiceResponse
)
async def update_adjustment(
    invoice_id: str,
    adjustment_id: str,
    data: AdjustmentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an adjustment"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    adjustment = db.query(InvoiceAdjustment).filter(
        and_(
            InvoiceAdjustment.id == adjustment_id,
            InvoiceAdjustment.invoice_id == invoice_id,
        )
    ).first()

    if not adjustment:
        raise HTTPException(status_code=404, detail="Adjustment not found")

    # Update fields
    if data.type is not None:
        try:
            adjustment.type = AdjustmentType(data.type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid adjustment type. Must be 'premium' or 'discount'"
            )
    if data.name is not None:
        adjustment.name = data.name
    if data.percentage is not None:
        adjustment.percentage = data.percentage
    if data.order_index is not None:
        adjustment.order_index = data.order_index

    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


@router.delete(
    "/{invoice_id}/adjustments/{adjustment_id}",
    response_model=InvoiceResponse
)
async def delete_adjustment(
    invoice_id: str,
    adjustment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an adjustment"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    adjustment = db.query(InvoiceAdjustment).filter(
        and_(
            InvoiceAdjustment.id == adjustment_id,
            InvoiceAdjustment.invoice_id == invoice_id,
        )
    ).first()

    if not adjustment:
        raise HTTPException(status_code=404, detail="Adjustment not found")

    db.delete(adjustment)
    db.commit()
    db.refresh(invoice)

    # Recalculate totals
    recalculate_invoice(invoice, db)

    return InvoiceResponse(**serialize_invoice(invoice))


def _prepare_invoice_pdf_data(invoice: Invoice, company: Company, db: Session) -> dict:
    """Prepare invoice data for PDF generation"""
    # Get customer info - prefer relationship, fall back to snapshot fields
    customer = invoice.customer

    # Build company info dict — apply company_override if present
    co = getattr(invoice, 'company_override', None) or {}
    company_info = {
        "name": co.get("name") or company.name or "",
        "legal_name": company.legal_name or "",
        "address_line1": (
            co.get("address") or company.address_line1 or ""
        ),
        "address_line2": (
            "" if co.get("address") else (company.address_line2 or "")
        ),
        "city": "" if co.get("address") else (company.city or ""),
        "state": "" if co.get("address") else (company.state or ""),
        "zipcode": (
            "" if co.get("address") else (company.zipcode or "")
        ),
        "phone": co.get("phone") or company.phone or "",
        "email": co.get("email") or company.email or "",
        "logo_url": company.logo_url or "",
    }

    # Build customer info dict - use snapshot fields as fallback when customer relationship is None
    customer_info = {
        "name": (customer.name if customer else (invoice.customer_name or "")) or "",
        "address": (customer.address_line1 if customer else (invoice.customer_address_line1 or "")) or "",
        "address_line2": (customer.address_line2 if customer else (invoice.customer_address_line2 or "")) or "",
        "city": (customer.city if customer else (invoice.customer_city or "")) or "",
        "state": (customer.state if customer else (invoice.customer_state or "")) or "",
        "zipcode": (customer.zipcode if customer else (invoice.customer_zipcode or "")) or "",
        "phone": (customer.phone if customer else "") or "",
        "email": (customer.email if customer else (invoice.customer_email or "")) or "",
    }

    # Build sections with items
    sections_data = []
    for section in sorted(invoice.sections, key=lambda s: s.order_index):
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
    for adj in sorted(invoice.adjustments, key=lambda a: a.order_index):
        adjustments_data.append({
            "name": adj.name or "",
            "type": adj.type.value if adj.type else "premium",
            "percentage": float(adj.percentage) if adj.percentage else 0,
            "amount": float(adj.amount) if adj.amount else 0,
        })

    # Build payments
    payments_data = []
    for payment in invoice.payments:
        payments_data.append({
            "amount": float(payment.amount) if payment.amount else 0,
            "payment_method": payment.payment_method.value if payment.payment_method else "",
            "payment_date": payment.payment_date,
            "reference_number": payment.reference_number or "",
            "notes": payment.notes or "",
        })

    return {
        "invoice_number": invoice.invoice_number or "",
        "invoice_date": invoice.invoice_date,
        "due_date": invoice.due_date,
        "company": company_info,
        "customer": customer_info,
        "sections": sections_data,
        "adjustments": adjustments_data,
        "payments": payments_data,
        "subtotal": float(invoice.subtotal) if invoice.subtotal else 0,
        "taxable_subtotal": float(invoice.taxable_subtotal) if invoice.taxable_subtotal else 0,
        "adjustments_total": float(invoice.adjustments_total) if invoice.adjustments_total else 0,
        "tax_rate": float(invoice.tax_rate) if invoice.tax_rate else 0,
        "tax_label": invoice.tax_label or "Tax",
        "tax_amount": float(invoice.tax_amount) if invoice.tax_amount else 0,
        "total": float(invoice.total) if invoice.total else 0,
        "amount_paid": float(invoice.amount_paid) if invoice.amount_paid else 0,
        "balance_due": float(invoice.balance_due) if invoice.balance_due else 0,
        "notes": invoice.notes or "",
        "terms": invoice.terms or "",
        "payment_schedule": invoice.payment_schedule or [],
        "primary_color": company.primary_color or "#111827",
        "secondary_color": company.secondary_color or "#6b7280",
    }


@router.get("/{invoice_id}/preview")
async def get_invoice_preview(
    invoice_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get invoice as HTML preview"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    pdf_data = _prepare_invoice_pdf_data(invoice, company, db)

    # Generate HTML
    html_content = generate_invoice_html(pdf_data, template_name)

    return {
        "html": html_content,
        "template": template_name,
    }


@router.get("/{invoice_id}/pdf")
async def get_invoice_pdf(
    invoice_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get invoice as PDF"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    pdf_data = _prepare_invoice_pdf_data(invoice, company, db)

    # Generate PDF
    pdf_bytes = generate_invoice_pdf(pdf_data, template_name)

    # Build filename with address
    customer_name = invoice.customer.name if invoice.customer else (invoice.customer_name or "Customer")
    customer_addr = ""
    if invoice.customer:
        addr_parts = [invoice.customer.address_line1, invoice.customer.city, invoice.customer.state]
        customer_addr = " ".join(p for p in addr_parts if p)
    elif invoice.customer_address_line1:
        addr_parts = [invoice.customer_address_line1, invoice.customer_city, invoice.customer_state]
        customer_addr = " ".join(p for p in addr_parts if p)
    filename = f"{customer_name} - {customer_addr} - Invoice {invoice.invoice_number}" if customer_addr else f"{customer_name} - Invoice {invoice.invoice_number}"
    if invoice.balance_due and float(invoice.balance_due) <= 0.01:
        filename += " PAID"
    filename += ".pdf"
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
# Payment Receipt Operations
# ===================

def _prepare_receipt_pdf_data(
    invoice: Invoice,
    payment: Payment,
    company: Company,
    previously_paid: float,
    db: Session
) -> dict:
    """Prepare payment receipt data for PDF generation"""
    # Get customer info
    customer = invoice.customer

    # Build company info dict — apply company_override if present
    co = getattr(invoice, 'company_override', None) or {}
    company_info = {
        "name": co.get("name") or company.name or "",
        "legal_name": company.legal_name or "",
        "address_line1": (
            co.get("address") or company.address_line1 or ""
        ),
        "address_line2": (
            "" if co.get("address") else (company.address_line2 or "")
        ),
        "city": "" if co.get("address") else (company.city or ""),
        "state": "" if co.get("address") else (company.state or ""),
        "zipcode": (
            "" if co.get("address") else (company.zipcode or "")
        ),
        "phone": co.get("phone") or company.phone or "",
        "email": co.get("email") or company.email or "",
        "logo_url": company.logo_url or "",
    }

    # Build customer info dict
    customer_info = {
        "name": (customer.name if customer else (invoice.customer_name or "")) or "",
        "address": (customer.address_line1 if customer else (invoice.customer_address_line1 or "")) or "",
        "address_line2": (customer.address_line2 if customer else (invoice.customer_address_line2 or "")) or "",
        "city": (customer.city if customer else (invoice.customer_city or "")) or "",
        "state": (customer.state if customer else (invoice.customer_state or "")) or "",
        "zipcode": (customer.zipcode if customer else (invoice.customer_zipcode or "")) or "",
        "phone": (customer.phone if customer else "") or "",
        "email": (customer.email if customer else (invoice.customer_email or "")) or "",
    }

    # Calculate financial details
    original_total = float(invoice.total) if invoice.total else 0
    this_payment = float(payment.amount) if payment.amount else 0
    balance_before = original_total - previously_paid
    total_paid = previously_paid + this_payment
    remaining_balance = original_total - total_paid

    # Generate receipt number (Payment ID short form + Invoice number)
    payment_id_short = str(payment.id)[:8].upper()
    receipt_number = f"RCP-{payment_id_short}"

    return {
        "receipt_number": receipt_number,
        "invoice_number": invoice.invoice_number or "",
        "payment_date": payment.payment_date,
        "payment_method": payment.payment_method.value if payment.payment_method else "other",
        "reference_number": payment.reference_number or "",
        "payment_notes": payment.notes or "",
        "company": company_info,
        "customer": customer_info,
        # Financial details
        "original_total": original_total,
        "previously_paid": previously_paid,
        "balance_before": balance_before,
        "this_payment": this_payment,
        "total_paid": total_paid,
        "remaining_balance": remaining_balance,
        # Styling
        "primary_color": company.primary_color or "#111827",
        "secondary_color": company.secondary_color or "#6b7280",
    }


@router.get("/{invoice_id}/payments/{payment_id}/receipt/preview")
async def get_payment_receipt_preview(
    invoice_id: str,
    payment_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get payment receipt as HTML preview"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Find the payment
    payment = db.query(Payment).filter(
        and_(
            Payment.id == payment_id,
            Payment.invoice_id == invoice_id,
        )
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Calculate previously paid amount (sum of payments before this one)
    all_payments = sorted(invoice.payments, key=lambda p: (p.payment_date or date.today(), p.created_at))
    previously_paid = 0.0
    for p in all_payments:
        if str(p.id) == payment_id:
            break
        previously_paid += float(p.amount) if p.amount else 0

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    receipt_data = _prepare_receipt_pdf_data(invoice, payment, company, previously_paid, db)

    # Generate HTML
    html_content = generate_receipt_html(receipt_data, template_name)

    return {
        "html": html_content,
        "template": template_name,
    }


@router.get("/{invoice_id}/payments/{payment_id}/receipt/pdf")
async def get_payment_receipt_pdf(
    invoice_id: str,
    payment_id: str,
    template: str = Query(default=None, description="Template name (classic, modern, professional)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get payment receipt as PDF"""
    invoice = db.query(Invoice).filter(
        and_(
            Invoice.id == invoice_id,
            Invoice.company_id == current_user.company_id,
        )
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Find the payment
    payment = db.query(Payment).filter(
        and_(
            Payment.id == payment_id,
            Payment.invoice_id == invoice_id,
        )
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Get company
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Calculate previously paid amount (sum of payments before this one)
    all_payments = sorted(invoice.payments, key=lambda p: (p.payment_date or date.today(), p.created_at))
    previously_paid = 0.0
    for p in all_payments:
        if str(p.id) == payment_id:
            break
        previously_paid += float(p.amount) if p.amount else 0

    # Get template (use user's default or specified)
    template_name = template or current_user.default_pdf_template or DEFAULT_TEMPLATE

    # Prepare data
    receipt_data = _prepare_receipt_pdf_data(invoice, payment, company, previously_paid, db)

    # Generate PDF
    pdf_bytes = generate_receipt_pdf(receipt_data, template_name)

    # Build filename
    customer_name = invoice.customer.name if invoice.customer else (invoice.customer_name or "Customer")
    payment_date_str = payment.payment_date.strftime("%Y%m%d") if payment.payment_date else "NoDate"
    filename = f"{customer_name} - Receipt {receipt_data['receipt_number']} - {payment_date_str}.pdf"
    # Clean filename
    filename = "".join(c for c in filename if c.isalnum() or c in (' ', '-', '_', '.')).strip()

    return Response(
        content=pdf_bytes.read(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )
