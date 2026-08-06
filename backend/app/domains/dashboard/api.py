"""
Scopit - Dashboard API Routes
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.domains.user.models import User
from app.domains.customer.models import Customer
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice, InvoiceStatus


router = APIRouter()


# ===================
# Schemas
# ===================

class RecentEstimateResponse(BaseModel):
    id: str
    estimate_number: str
    customer_name: Optional[str]
    total: Decimal
    status: str

    class Config:
        from_attributes = True


class RecentInvoiceResponse(BaseModel):
    id: str
    invoice_number: str
    customer_name: Optional[str]
    total: Decimal
    status: str

    class Config:
        from_attributes = True


class DashboardResponse(BaseModel):
    estimates_this_month: int
    invoices_this_month: int
    total_customers: int
    pending_payments: Decimal
    recent_estimates: List[RecentEstimateResponse]
    recent_invoices: List[RecentInvoiceResponse]


# ===================
# Dashboard Endpoint
# ===================

@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get dashboard statistics for the current user's company"""
    company_id = current_user.company_id
    now = datetime.utcnow()
    current_month = now.month
    current_year = now.year

    # Count estimates this month
    estimates_this_month = db.query(func.count(Estimate.id)).filter(
        and_(
            Estimate.company_id == company_id,
            extract('month', Estimate.created_at) == current_month,
            extract('year', Estimate.created_at) == current_year,
        )
    ).scalar() or 0

    # Count invoices this month
    invoices_this_month = db.query(func.count(Invoice.id)).filter(
        and_(
            Invoice.company_id == company_id,
            extract('month', Invoice.created_at) == current_month,
            extract('year', Invoice.created_at) == current_year,
        )
    ).scalar() or 0

    # Count total active customers
    total_customers = db.query(func.count(Customer.id)).filter(
        and_(
            Customer.company_id == company_id,
            Customer.is_active == True,
        )
    ).scalar() or 0

    # Sum of unpaid invoice amounts (balance_due for non-paid/canceled invoices)
    pending_payments = db.query(func.coalesce(func.sum(Invoice.balance_due), 0)).filter(
        and_(
            Invoice.company_id == company_id,
            Invoice.status.notin_([InvoiceStatus.PAID, InvoiceStatus.CANCELED, InvoiceStatus.REFUNDED]),
        )
    ).scalar() or Decimal(0)

    # Recent estimates (last 5)
    recent_estimates_query = db.query(Estimate).filter(
        Estimate.company_id == company_id
    ).order_by(Estimate.created_at.desc()).limit(5).all()

    recent_estimates = [
        RecentEstimateResponse(
            id=str(est.id),
            estimate_number=est.estimate_number,
            customer_name=est.customer_name,
            total=est.total,
            status=est.status.value if est.status else "draft",
        )
        for est in recent_estimates_query
    ]

    # Recent invoices (last 5)
    recent_invoices_query = db.query(Invoice).filter(
        Invoice.company_id == company_id
    ).order_by(Invoice.created_at.desc()).limit(5).all()

    recent_invoices = [
        RecentInvoiceResponse(
            id=str(inv.id),
            invoice_number=inv.invoice_number,
            customer_name=inv.customer_name,
            total=inv.total,
            status=inv.status.value if inv.status else "draft",
        )
        for inv in recent_invoices_query
    ]

    return DashboardResponse(
        estimates_this_month=estimates_this_month,
        invoices_this_month=invoices_this_month,
        total_customers=total_customers,
        pending_payments=pending_payments,
        recent_estimates=recent_estimates,
        recent_invoices=recent_invoices,
    )
