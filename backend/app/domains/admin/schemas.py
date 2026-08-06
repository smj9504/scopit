"""
Scopit - Admin Schemas
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from decimal import Decimal


# ===================
# Dashboard Schemas
# ===================

class OccupationStat(BaseModel):
    """Occupation distribution statistics"""
    occupation: str
    count: int
    percentage: float


class DailyCount(BaseModel):
    """Daily count for charts"""
    date: str
    count: int


class HourlyCount(BaseModel):
    """Hourly count for activity heatmap"""
    hour: int
    count: int


class UserSummary(BaseModel):
    """Brief user info for lists"""
    id: str
    email: str
    full_name: Optional[str]
    company_name: Optional[str]
    occupation: Optional[str]
    signup_state: Optional[str]
    created_at: datetime


class AdminDashboardResponse(BaseModel):
    """Main admin dashboard response"""
    # User stats
    total_users: int
    new_users_today: int
    new_users_this_week: int
    new_users_this_month: int
    active_users_today: int

    # Company stats
    total_companies: int

    # Document stats
    total_estimates: int
    total_invoices: int
    estimates_this_month: int
    invoices_this_month: int

    # Occupation distribution
    occupation_stats: List[OccupationStat]

    # Recent signups
    recent_users: List[UserSummary]

    # Chart data
    user_growth_data: List[DailyCount]


# ===================
# User Management Schemas
# ===================

class LoginLogResponse(BaseModel):
    """Login log entry"""
    id: str
    login_at: datetime
    login_method: Optional[str]
    ip_address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    country: Optional[str]
    device_type: Optional[str]
    browser: Optional[str]
    os: Optional[str]

    class Config:
        from_attributes = True


class AdminUserResponse(BaseModel):
    """User detail for admin view"""
    id: str
    email: str
    full_name: Optional[str]
    phone: Optional[str]
    avatar_url: Optional[str]

    # Company
    company_id: Optional[str]
    company_name: Optional[str]

    # Profile
    occupation: Optional[str]
    occupation_other: Optional[str]
    business_type: Optional[str]
    years_in_business: Optional[int]

    # Location
    signup_city: Optional[str]
    signup_state: Optional[str]
    signup_country: Optional[str]
    last_login_city: Optional[str]
    last_login_state: Optional[str]

    # Activity stats
    login_count: int
    last_login_at: Optional[datetime]

    # Status
    role: str
    is_active: bool
    is_verified: bool
    is_superuser: bool

    # Timestamps
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class AdminUserDetailResponse(AdminUserResponse):
    """Extended user detail with login history"""
    # Document counts
    estimate_count: int
    invoice_count: int
    customer_count: int

    # Recent logins
    recent_logins: List[LoginLogResponse]


class AdminUserListResponse(BaseModel):
    """Paginated user list"""
    items: List[AdminUserResponse]
    total: int
    page: int
    limit: int


# ===================
# Analytics Schemas
# ===================

class GeographyStat(BaseModel):
    """Geographic distribution"""
    state: str
    city: Optional[str]
    user_count: int
    company_count: int


class GeographyAnalyticsResponse(BaseModel):
    """Geographic analytics"""
    by_state: List[GeographyStat]
    total_states: int


class OccupationAnalyticsResponse(BaseModel):
    """Occupation analytics"""
    stats: List[OccupationStat]
    total_users: int


class ActivityStat(BaseModel):
    """Activity statistics"""
    action: str
    count: int
    percentage: float


class ActivityAnalyticsResponse(BaseModel):
    """User activity analytics"""
    daily_active_users: List[DailyCount]
    hourly_activity: List[HourlyCount]
    action_distribution: List[ActivityStat]
