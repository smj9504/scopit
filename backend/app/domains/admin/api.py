"""
ScopeIt - Admin API Routes

SECURITY: All endpoints require superuser access (is_superuser=True)
Regular users will receive 403 Forbidden
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.dependencies import get_superuser
from app.domains.user.models import User
from app.domains.admin.service import AdminService
from app.domains.admin.schemas import (
    AdminDashboardResponse,
    AdminUserListResponse,
    AdminUserDetailResponse,
    GeographyAnalyticsResponse,
    OccupationAnalyticsResponse,
)


router = APIRouter()


# ===================
# Dashboard
# ===================

@router.get("/dashboard", response_model=AdminDashboardResponse)
async def get_dashboard(
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Get admin dashboard with KPIs and statistics.

    **Security**: Requires superuser access
    """
    service = AdminService(db)
    return service.get_dashboard()


# ===================
# User Management
# ===================

@router.get("/users", response_model=AdminUserListResponse)
async def get_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=100),
    occupation: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Get paginated list of users with filtering options.

    **Security**: Requires superuser access

    - **search**: Search by email or name
    - **occupation**: Filter by occupation type
    - **state**: Filter by signup state
    - **sort_by**: Sort field (created_at, email, last_login_at)
    - **sort_order**: asc or desc
    """
    service = AdminService(db)
    return service.get_users(
        page=page,
        limit=limit,
        search=search,
        occupation=occupation,
        state=state,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetailResponse)
async def get_user_detail(
    user_id: str,
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Get detailed user information including login history.

    **Security**: Requires superuser access
    """
    service = AdminService(db)
    user = service.get_user_detail(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return user


@router.patch("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: str,
    is_active: bool,
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Enable or disable a user account.

    **Security**: Requires superuser access
    """
    # Prevent self-deactivation
    if str(current_user.id) == user_id and not is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account"
        )

    service = AdminService(db)
    success = service.toggle_user_active(user_id, is_active)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {"message": f"User {'activated' if is_active else 'deactivated'}"}


# ===================
# Analytics
# ===================

@router.get("/analytics/geography", response_model=GeographyAnalyticsResponse)
async def get_geography_analytics(
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Get geographic distribution of users by state.

    **Security**: Requires superuser access
    """
    service = AdminService(db)
    return service.get_geography_analytics()


@router.get("/analytics/occupation", response_model=OccupationAnalyticsResponse)
async def get_occupation_analytics(
    current_user: User = Depends(get_superuser),
    db: Session = Depends(get_db),
):
    """
    Get occupation distribution statistics.

    **Security**: Requires superuser access
    """
    service = AdminService(db)
    stats = service._get_occupation_stats()
    total = sum(s.count for s in stats)

    return OccupationAnalyticsResponse(
        stats=stats,
        total_users=total,
    )
