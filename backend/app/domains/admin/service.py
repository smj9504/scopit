"""
Scopit - Admin Service
"""
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract, desc, case
from datetime import datetime, timedelta
from typing import Optional, List, Tuple

from app.domains.user.models import User
from app.domains.company.models import Company
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice
from app.domains.customer.models import Customer
from app.domains.admin.models import LoginLog, UserActivity
from app.domains.admin.schemas import (
    AdminDashboardResponse,
    OccupationStat,
    DailyCount,
    UserSummary,
    AdminUserResponse,
    AdminUserDetailResponse,
    AdminUserListResponse,
    LoginLogResponse,
    GeographyStat,
    GeographyAnalyticsResponse,
)


class AdminService:
    """Admin business logic service"""

    def __init__(self, db: Session):
        self.db = db

    def get_dashboard(self) -> AdminDashboardResponse:
        """Get admin dashboard statistics"""
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_ago = today_start - timedelta(days=7)
        month_ago = today_start - timedelta(days=30)

        # User counts
        total_users = self.db.query(func.count(User.id)).scalar() or 0

        new_users_today = self.db.query(func.count(User.id)).filter(
            User.created_at >= today_start
        ).scalar() or 0

        new_users_this_week = self.db.query(func.count(User.id)).filter(
            User.created_at >= week_ago
        ).scalar() or 0

        new_users_this_month = self.db.query(func.count(User.id)).filter(
            User.created_at >= month_ago
        ).scalar() or 0

        # Active users today (logged in today)
        active_users_today = self.db.query(func.count(User.id)).filter(
            User.last_login_at >= today_start
        ).scalar() or 0

        # Company count
        total_companies = self.db.query(func.count(Company.id)).scalar() or 0

        # Document counts
        total_estimates = self.db.query(func.count(Estimate.id)).scalar() or 0
        total_invoices = self.db.query(func.count(Invoice.id)).scalar() or 0

        estimates_this_month = self.db.query(func.count(Estimate.id)).filter(
            Estimate.created_at >= month_ago
        ).scalar() or 0

        invoices_this_month = self.db.query(func.count(Invoice.id)).filter(
            Invoice.created_at >= month_ago
        ).scalar() or 0

        # Occupation stats
        occupation_stats = self._get_occupation_stats()

        # Recent users
        recent_users = self._get_recent_users(limit=10)

        # User growth data (last 30 days)
        user_growth_data = self._get_user_growth_data(days=30)

        return AdminDashboardResponse(
            total_users=total_users,
            new_users_today=new_users_today,
            new_users_this_week=new_users_this_week,
            new_users_this_month=new_users_this_month,
            active_users_today=active_users_today,
            total_companies=total_companies,
            total_estimates=total_estimates,
            total_invoices=total_invoices,
            estimates_this_month=estimates_this_month,
            invoices_this_month=invoices_this_month,
            occupation_stats=occupation_stats,
            recent_users=recent_users,
            user_growth_data=user_growth_data,
        )

    def _get_occupation_stats(self) -> List[OccupationStat]:
        """Get occupation distribution"""
        total = self.db.query(func.count(User.id)).scalar() or 1

        results = self.db.query(
            func.coalesce(User.occupation, 'unknown').label('occupation'),
            func.count(User.id).label('count')
        ).group_by(
            func.coalesce(User.occupation, 'unknown')
        ).all()

        return [
            OccupationStat(
                occupation=r.occupation,
                count=r.count,
                percentage=round((r.count / total) * 100, 1)
            )
            for r in results
        ]

    def _get_recent_users(self, limit: int = 10) -> List[UserSummary]:
        """Get recently registered users"""
        users = self.db.query(User).options(
        ).order_by(desc(User.created_at)).limit(limit).all()

        result = []
        for user in users:
            company_name = None
            if user.company_id:
                company = self.db.query(Company.name).filter(
                    Company.id == user.company_id
                ).first()
                company_name = company.name if company else None

            result.append(UserSummary(
                id=str(user.id),
                email=user.email,
                full_name=user.full_name,
                company_name=company_name,
                occupation=user.occupation,
                signup_state=user.signup_state,
                created_at=user.created_at,
            ))

        return result

    def _get_user_growth_data(self, days: int = 30) -> List[DailyCount]:
        """Get daily user registration counts"""
        start_date = datetime.utcnow() - timedelta(days=days)

        results = self.db.query(
            func.date(User.created_at).label('date'),
            func.count(User.id).label('count')
        ).filter(
            User.created_at >= start_date
        ).group_by(
            func.date(User.created_at)
        ).order_by(
            func.date(User.created_at)
        ).all()

        return [
            DailyCount(date=str(r.date), count=r.count)
            for r in results
        ]

    def get_users(
        self,
        page: int = 1,
        limit: int = 20,
        search: Optional[str] = None,
        occupation: Optional[str] = None,
        state: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> AdminUserListResponse:
        """Get paginated user list with filters"""
        query = self.db.query(User)

        # Apply filters
        if search:
            search_filter = f"%{search}%"
            query = query.filter(
                (User.email.ilike(search_filter)) |
                (User.full_name.ilike(search_filter))
            )

        if occupation:
            query = query.filter(User.occupation == occupation)

        if state:
            query = query.filter(User.signup_state == state)

        # Get total count
        total = query.count()

        # Apply sorting
        sort_column = getattr(User, sort_by, User.created_at)
        if sort_order == "desc":
            query = query.order_by(desc(sort_column))
        else:
            query = query.order_by(sort_column)

        # Apply pagination
        offset = (page - 1) * limit
        users = query.offset(offset).limit(limit).all()

        # Build response
        items = []
        for user in users:
            company_name = None
            if user.company_id:
                company = self.db.query(Company.name).filter(
                    Company.id == user.company_id
                ).first()
                company_name = company.name if company else None

            items.append(AdminUserResponse(
                id=str(user.id),
                email=user.email,
                full_name=user.full_name,
                phone=user.phone,
                avatar_url=user.avatar_url,
                company_id=str(user.company_id) if user.company_id else None,
                company_name=company_name,
                occupation=user.occupation,
                occupation_other=user.occupation_other,
                business_type=user.business_type,
                years_in_business=user.years_in_business,
                signup_city=user.signup_city,
                signup_state=user.signup_state,
                signup_country=user.signup_country,
                last_login_city=user.last_login_city,
                last_login_state=user.last_login_state,
                login_count=user.login_count or 0,
                last_login_at=user.last_login_at,
                role=user.role,
                is_active=user.is_active,
                is_verified=user.is_verified,
                is_superuser=user.is_superuser,
                created_at=user.created_at,
                updated_at=user.updated_at,
            ))

        return AdminUserListResponse(
            items=items,
            total=total,
            page=page,
            limit=limit,
        )

    def get_user_detail(self, user_id: str) -> Optional[AdminUserDetailResponse]:
        """Get detailed user information"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return None

        # Get company name
        company_name = None
        if user.company_id:
            company = self.db.query(Company.name).filter(
                Company.id == user.company_id
            ).first()
            company_name = company.name if company else None

        # Get document counts
        estimate_count = self.db.query(func.count(Estimate.id)).filter(
            Estimate.company_id == user.company_id
        ).scalar() or 0

        invoice_count = self.db.query(func.count(Invoice.id)).filter(
            Invoice.company_id == user.company_id
        ).scalar() or 0

        customer_count = self.db.query(func.count(Customer.id)).filter(
            Customer.company_id == user.company_id
        ).scalar() or 0

        # Get recent logins
        recent_logins = self.db.query(LoginLog).filter(
            LoginLog.user_id == user_id
        ).order_by(desc(LoginLog.login_at)).limit(20).all()

        login_responses = [
            LoginLogResponse(
                id=str(log.id),
                login_at=log.login_at,
                login_method=log.login_method,
                ip_address=log.ip_address,
                city=log.city,
                state=log.state,
                country=log.country,
                device_type=log.device_type,
                browser=log.browser,
                os=log.os,
            )
            for log in recent_logins
        ]

        return AdminUserDetailResponse(
            id=str(user.id),
            email=user.email,
            full_name=user.full_name,
            phone=user.phone,
            avatar_url=user.avatar_url,
            company_id=str(user.company_id) if user.company_id else None,
            company_name=company_name,
            occupation=user.occupation,
            occupation_other=user.occupation_other,
            business_type=user.business_type,
            years_in_business=user.years_in_business,
            signup_city=user.signup_city,
            signup_state=user.signup_state,
            signup_country=user.signup_country,
            last_login_city=user.last_login_city,
            last_login_state=user.last_login_state,
            login_count=user.login_count or 0,
            last_login_at=user.last_login_at,
            role=user.role,
            is_active=user.is_active,
            is_verified=user.is_verified,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
            estimate_count=estimate_count,
            invoice_count=invoice_count,
            customer_count=customer_count,
            recent_logins=login_responses,
        )

    def get_geography_analytics(self) -> GeographyAnalyticsResponse:
        """Get geographic distribution of users"""
        results = self.db.query(
            User.signup_state,
            func.count(User.id).label('user_count'),
            func.count(func.distinct(User.company_id)).label('company_count')
        ).filter(
            User.signup_state.isnot(None)
        ).group_by(
            User.signup_state
        ).order_by(
            desc('user_count')
        ).all()

        by_state = [
            GeographyStat(
                state=r.signup_state,
                city=None,
                user_count=r.user_count,
                company_count=r.company_count,
            )
            for r in results
        ]

        return GeographyAnalyticsResponse(
            by_state=by_state,
            total_states=len(by_state),
        )

    def toggle_user_active(self, user_id: str, is_active: bool) -> bool:
        """Enable/disable user account"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return False

        user.is_active = is_active
        self.db.commit()
        return True
