"""
Scopit - Support inquiry API

router        (/api/support)          any signed-in user sends a message
admin_router  (/api/admin/inquiries)  superusers read and resolve them
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, get_superuser
from app.core.rate_limit import enforce_rate_limit
from app.domains.company.models import Company
from app.domains.support.models import SupportInquiry
from app.domains.support.notify import send_inquiry_notification
from app.domains.support.schemas import (
    AdminInquiry,
    AdminInquiryList,
    InquiryCreate,
    InquiryCreated,
    InquiryStatus,
    InquiryStatusUpdate,
)
from app.domains.user.models import User

router = APIRouter()
admin_router = APIRouter()

_USER_AGENT_MAX_LENGTH = 500


@router.post("/inquiries", response_model=InquiryCreated, status_code=status.HTTP_201_CREATED)
async def create_inquiry(
    data: InquiryCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a message to the Scopit team. Replies go to the user's account email."""
    enforce_rate_limit(
        f"support-inquiry:{current_user.id}",
        settings.SUPPORT_INQUIRIES_PER_USER_PER_HOUR,
        3600,
        detail="You've sent several messages in the last hour. Please try again a little later.",
    )

    user_agent = (request.headers.get("user-agent") or "").strip()[:_USER_AGENT_MAX_LENGTH]
    inquiry = SupportInquiry(
        user_id=current_user.id,
        company_id=current_user.company_id,
        email=current_user.email,
        name=current_user.full_name,
        category=data.category,
        message=data.message,
        page_url=data.page_url,
        user_agent=user_agent or None,
    )
    db.add(inquiry)
    db.commit()
    db.refresh(inquiry)

    background_tasks.add_task(
        send_inquiry_notification,
        email=inquiry.email,
        name=inquiry.name,
        company_name=current_user.company.name if current_user.company else None,
        category=inquiry.category,
        message=inquiry.message,
        page_url=inquiry.page_url,
        user_agent=inquiry.user_agent,
    )

    return InquiryCreated(
        id=str(inquiry.id),
        reply_to=inquiry.email,
        created_at=inquiry.created_at,
    )


# ===================
# Admin (superuser only)
# ===================

def _to_admin(inquiry: SupportInquiry, company_name: Optional[str]) -> AdminInquiry:
    return AdminInquiry(
        id=str(inquiry.id),
        user_id=str(inquiry.user_id) if inquiry.user_id else None,
        email=inquiry.email,
        name=inquiry.name,
        company_name=company_name,
        category=inquiry.category,
        message=inquiry.message,
        page_url=inquiry.page_url,
        user_agent=inquiry.user_agent,
        status=inquiry.status,
        created_at=inquiry.created_at,
        resolved_at=inquiry.resolved_at,
    )


@admin_router.get("", response_model=AdminInquiryList)
async def list_inquiries(
    status_filter: Optional[InquiryStatus] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """Inquiries, newest first, optionally only open or only resolved ones."""
    query = db.query(SupportInquiry, Company.name).outerjoin(
        Company, Company.id == SupportInquiry.company_id
    )
    if status_filter:
        query = query.filter(SupportInquiry.status == status_filter)

    total = query.count()
    rows = (
        query.order_by(SupportInquiry.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    open_count = (
        db.query(func.count(SupportInquiry.id))
        .filter(SupportInquiry.status == "open")
        .scalar()
    )

    return AdminInquiryList(
        items=[_to_admin(inquiry, company_name) for inquiry, company_name in rows],
        total=total,
        open_count=open_count or 0,
        page=page,
        limit=limit,
    )


@admin_router.patch("/{inquiry_id}", response_model=AdminInquiry)
async def update_inquiry_status(
    inquiry_id: UUID,
    data: InquiryStatusUpdate,
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """Mark an inquiry resolved, or reopen it."""
    inquiry = db.get(SupportInquiry, inquiry_id)
    if not inquiry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inquiry not found")

    if inquiry.status != data.status:
        inquiry.status = data.status
        inquiry.resolved_at = (
            datetime.now(timezone.utc) if data.status == "resolved" else None
        )
        db.commit()
        db.refresh(inquiry)

    company_name = None
    if inquiry.company_id:
        company_name = (
            db.query(Company.name).filter(Company.id == inquiry.company_id).scalar()
        )
    return _to_admin(inquiry, company_name)
