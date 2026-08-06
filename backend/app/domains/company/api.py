"""
Scopit - Company API Routes
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
from decimal import Decimal

HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.company.models import Company


router = APIRouter()


# ===================
# Schemas
# ===================

class CompanyResponse(BaseModel):
    id: str
    name: str
    legal_name: Optional[str] = Field(default=None, alias="legalName")
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address_line1: Optional[str] = Field(default=None, alias="addressLine1")
    address_line2: Optional[str] = Field(default=None, alias="addressLine2")
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = None
    logo_url: Optional[str] = Field(default=None, alias="logoUrl")
    primary_color: Optional[str] = Field(default=None, alias="primaryColor")
    secondary_color: Optional[str] = Field(default=None, alias="secondaryColor")

    # Tax Settings
    default_tax_rate: Optional[Decimal] = Field(default=None, alias="defaultTaxRate")
    default_tax_label: Optional[str] = Field(default=None, alias="defaultTaxLabel")

    # Numbering
    estimate_prefix: str = Field(alias="estimatePrefix")
    invoice_prefix: str = Field(alias="invoicePrefix")
    next_estimate_number: int = Field(alias="nextEstimateNumber")
    next_invoice_number: int = Field(alias="nextInvoiceNumber")

    # Default Settings
    default_estimate_validity_days: Optional[int] = Field(default=None, alias="defaultEstimateValidityDays")
    default_invoice_due_days: Optional[int] = Field(default=None, alias="defaultInvoiceDueDays")
    default_notes: Optional[str] = Field(default=None, alias="defaultNotes")
    default_terms: Optional[str] = Field(default=None, alias="defaultTerms")

    is_active: bool = Field(alias="isActive")
    created_at: datetime = Field(alias="createdAt")

    model_config = {"populate_by_name": True, "from_attributes": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):
        if hasattr(obj, '__dict__'):
            data = {
                'id': str(obj.id),
                'name': obj.name,
                'legalName': obj.legal_name,
                'email': obj.email,
                'phone': obj.phone,
                'website': obj.website,
                'addressLine1': obj.address_line1,
                'addressLine2': obj.address_line2,
                'city': obj.city,
                'state': obj.state,
                'zipcode': obj.zipcode,
                'country': obj.country,
                'logoUrl': obj.logo_url,
                'primaryColor': obj.primary_color,
                'secondaryColor': obj.secondary_color,
                'defaultTaxRate': obj.default_tax_rate,
                'defaultTaxLabel': obj.default_tax_label,
                'estimatePrefix': obj.estimate_prefix or "EST",
                'invoicePrefix': obj.invoice_prefix or "INV",
                'nextEstimateNumber': obj.next_estimate_number or 1001,
                'nextInvoiceNumber': obj.next_invoice_number or 1001,
                'defaultEstimateValidityDays': obj.default_estimate_validity_days,
                'defaultInvoiceDueDays': obj.default_invoice_due_days,
                'defaultNotes': obj.default_notes,
                'defaultTerms': obj.default_terms,
                'isActive': obj.is_active,
                'createdAt': obj.created_at,
            }
            return cls(**data)
        return super().model_validate(obj, **kwargs)


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    legal_name: Optional[str] = Field(default=None, alias="legalName")
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address_line1: Optional[str] = Field(default=None, alias="addressLine1")
    address_line2: Optional[str] = Field(default=None, alias="addressLine2")
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = None
    logo_url: Optional[str] = Field(default=None, alias="logoUrl")
    primary_color: Optional[str] = Field(default=None, alias="primaryColor")
    secondary_color: Optional[str] = Field(default=None, alias="secondaryColor")

    # Tax Settings
    default_tax_rate: Optional[Decimal] = Field(default=None, alias="defaultTaxRate")
    default_tax_label: Optional[str] = Field(default=None, alias="defaultTaxLabel")

    # Numbering - validated to prevent empty values
    estimate_prefix: Optional[str] = Field(default=None, alias="estimatePrefix")
    invoice_prefix: Optional[str] = Field(default=None, alias="invoicePrefix")
    next_estimate_number: Optional[int] = Field(default=None, alias="nextEstimateNumber")
    next_invoice_number: Optional[int] = Field(default=None, alias="nextInvoiceNumber")

    # Default Settings
    default_estimate_validity_days: Optional[int] = Field(default=None, alias="defaultEstimateValidityDays")
    default_invoice_due_days: Optional[int] = Field(default=None, alias="defaultInvoiceDueDays")
    default_notes: Optional[str] = Field(default=None, alias="defaultNotes")
    default_terms: Optional[str] = Field(default=None, alias="defaultTerms")

    model_config = {"populate_by_name": True}

    @field_validator('estimate_prefix', 'invoice_prefix')
    @classmethod
    def validate_prefix_not_empty(cls, v):
        if v is not None and (not v or not v.strip()):
            raise ValueError('Prefix cannot be empty')
        return v.strip() if v else v

    @field_validator('next_estimate_number', 'next_invoice_number')
    @classmethod
    def validate_number_positive(cls, v):
        if v is not None and v < 1:
            raise ValueError('Number must be at least 1')
        return v

    @field_validator('primary_color', 'secondary_color')
    @classmethod
    def validate_hex_color(cls, v):
        if v is not None and not HEX_COLOR_RE.match(v):
            raise ValueError('Color must be a 6-digit hex value, e.g. #111827')
        return v


# ===================
# API Endpoints
# ===================

@router.get("", response_model=CompanyResponse)
async def get_company(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's company"""
    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    return CompanyResponse.model_validate(company)


@router.put("", response_model=CompanyResponse)
async def update_company(
    data: CompanyUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update company settings"""
    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Map camelCase to snake_case for database fields
    field_mapping = {
        'legal_name': 'legalName',
        'address_line1': 'addressLine1',
        'address_line2': 'addressLine2',
        'logo_url': 'logoUrl',
        'primary_color': 'primaryColor',
        'secondary_color': 'secondaryColor',
        'default_tax_rate': 'defaultTaxRate',
        'default_tax_label': 'defaultTaxLabel',
        'estimate_prefix': 'estimatePrefix',
        'invoice_prefix': 'invoicePrefix',
        'next_estimate_number': 'nextEstimateNumber',
        'next_invoice_number': 'nextInvoiceNumber',
        'default_estimate_validity_days': 'defaultEstimateValidityDays',
        'default_invoice_due_days': 'defaultInvoiceDueDays',
        'default_notes': 'defaultNotes',
        'default_terms': 'defaultTerms',
    }

    update_data = data.model_dump(exclude_unset=True, by_alias=False)

    for db_field, value in update_data.items():
        if hasattr(company, db_field):
            setattr(company, db_field, value)

    db.commit()
    db.refresh(company)

    return CompanyResponse.model_validate(company)
