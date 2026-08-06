"""
Scopit - Customer API Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.customer.models import Customer
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice
from app.domains.tools.modules.pdf_editor.models import SignRequest


router = APIRouter()


# ===================
# Schemas
# ===================

class CustomerCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipcode: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None


class CustomerResponse(BaseModel):
    id: str
    company_id: str
    name: str
    contact_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address_line1: Optional[str]
    address_line2: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zipcode: Optional[str]
    notes: Optional[str]
    tags: Optional[List[str]]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def model_validate(cls, obj, **kwargs):
        if hasattr(obj, '__dict__'):
            data = {
                'id': str(obj.id),
                'company_id': str(obj.company_id),
                'name': obj.name,
                'contact_name': obj.contact_name,
                'email': obj.email,
                'phone': obj.phone,
                'address_line1': obj.address_line1,
                'address_line2': obj.address_line2,
                'city': obj.city,
                'state': obj.state,
                'zipcode': obj.zipcode,
                'notes': obj.notes,
                'tags': obj.tags,
                'is_active': obj.is_active,
                'created_at': obj.created_at,
            }
            return cls(**data)
        return super().model_validate(obj, **kwargs)


class CustomerListResponse(BaseModel):
    items: List[CustomerResponse]
    total: int
    page: int
    page_size: int


# ===================
# Customer CRUD
# ===================

@router.get("", response_model=CustomerListResponse)
async def list_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List customers"""
    query = db.query(Customer).filter(Customer.company_id == current_user.company_id)

    if is_active is not None:
        query = query.filter(Customer.is_active == is_active)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Customer.name.ilike(search_term),
                Customer.email.ilike(search_term),
                Customer.contact_name.ilike(search_term),
                Customer.phone.ilike(search_term),
            )
        )

    total = query.count()
    customers = query.order_by(Customer.name).offset(skip).limit(limit).all()

    return CustomerListResponse(
        items=[CustomerResponse.model_validate(c) for c in customers],
        total=total,
        page=skip // limit + 1,
        page_size=limit,
    )


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get single customer"""
    customer = db.query(Customer).filter(
        and_(
            Customer.id == customer_id,
            Customer.company_id == current_user.company_id,
        )
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    return CustomerResponse.model_validate(customer)


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    data: CustomerCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new customer"""
    customer = Customer(
        company_id=current_user.company_id,
        name=data.name,
        contact_name=data.contact_name,
        email=data.email,
        phone=data.phone,
        address_line1=data.address_line1,
        address_line2=data.address_line2,
        city=data.city,
        state=data.state,
        zipcode=data.zipcode,
        notes=data.notes,
        tags=data.tags,
        created_by=current_user.id,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)

    return CustomerResponse.model_validate(customer)


@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: str,
    data: CustomerUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update customer"""
    customer = db.query(Customer).filter(
        and_(
            Customer.id == customer_id,
            Customer.company_id == current_user.company_id,
        )
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        if hasattr(customer, field):
            setattr(customer, field, value)

    db.commit()
    db.refresh(customer)

    return CustomerResponse.model_validate(customer)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete customer"""
    customer = db.query(Customer).filter(
        and_(
            Customer.id == customer_id,
            Customer.company_id == current_user.company_id,
        )
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    db.delete(customer)
    db.commit()


@router.get("/{customer_id}/documents")
async def get_customer_documents(
    customer_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all estimates, invoices, and sign requests for a customer"""
    customer = db.query(Customer).filter(
        and_(
            Customer.id == customer_id,
            Customer.company_id == current_user.company_id,
        )
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    estimates = (
        db.query(Estimate)
        .filter(
            and_(
                Estimate.customer_id == customer_id,
                Estimate.company_id == current_user.company_id,
            )
        )
        .order_by(Estimate.created_at.desc())
        .limit(100)
        .all()
    )

    invoices = (
        db.query(Invoice)
        .filter(
            and_(
                Invoice.customer_id == customer_id,
                Invoice.company_id == current_user.company_id,
            )
        )
        .order_by(Invoice.created_at.desc())
        .limit(100)
        .all()
    )

    sign_requests = (
        db.query(SignRequest)
        .filter(
            and_(
                SignRequest.customer_id == customer_id,
                SignRequest.company_id == current_user.company_id,
            )
        )
        .order_by(SignRequest.created_at.desc())
        .limit(100)
        .all()
    )

    return {
        "estimates": [
            {
                "id": str(e.id),
                "estimate_number": e.estimate_number,
                "status": e.status.value if e.status else None,
                "customer_name": e.customer_name,
                "total": float(e.total) if e.total is not None else 0.0,
                "created_at": e.created_at,
                "updated_at": e.updated_at,
            }
            for e in estimates
        ],
        "invoices": [
            {
                "id": str(i.id),
                "invoice_number": i.invoice_number,
                "status": i.status.value if i.status else None,
                "customer_name": i.customer_name,
                "total": float(i.total) if i.total is not None else 0.0,
                "created_at": i.created_at,
                "updated_at": i.updated_at,
            }
            for i in invoices
        ],
        "sign_requests": [
            {
                "id": str(sr.id),
                "document_name": sr.document.name if sr.document else None,
                "recipients": [
                    {
                        "role": r.role,
                        "name": r.name,
                        "email": r.email,
                        "status": r.status,
                    }
                    for r in sr.recipients
                ],
                "status": sr.status,
                "created_at": sr.created_at,
                "sent_at": sr.sent_at,
                "signed_at": sr.signed_at,
            }
            for sr in sign_requests
        ],
    }
