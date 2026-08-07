"""
Scopit - Login Tracking Service
Records login events with geolocation and device info
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.domains.admin.geolocation import (
    GeolocationService,
    UserAgentParser,
)
from app.domains.admin.models import LoginLog
from app.domains.user.models import User


def track_login(
    db: Session,
    user: User,
    ip_address: Optional[str],
    user_agent: Optional[str],
    login_method: str = "email",
) -> None:
    """
    Track user login event with location and device info.
    This function is non-blocking and won't fail the login if tracking fails.
    """
    try:
        # Get geolocation from IP
        geo = GeolocationService.get_location(ip_address or "")

        # Parse user agent
        device = UserAgentParser.parse(user_agent or "")

        # Create login log
        login_log = LoginLog(
            user_id=user.id,
            login_method=login_method,
            ip_address=ip_address,
            city=geo.city,
            state=geo.state,
            country=geo.country,
            user_agent=user_agent[:500] if user_agent else None,
            device_type=device.device_type,
            browser=device.browser,
            os=device.os,
        )
        db.add(login_log)

        # Update user's login stats
        user.last_login_at = datetime.utcnow()
        user.last_login_ip = ip_address
        user.last_login_city = geo.city
        user.last_login_state = geo.state
        user.login_count = (user.login_count or 0) + 1

        db.commit()

    except Exception as e:
        # Don't fail login if tracking fails
        print(f"Login tracking error: {e}")
        db.rollback()


def track_signup_location(
    db: Session,
    user: User,
    ip_address: Optional[str],
) -> None:
    """
    Track user signup location from IP address.
    Called during registration.
    """
    try:
        geo = GeolocationService.get_location(ip_address or "")

        user.signup_ip = ip_address
        user.signup_city = geo.city
        user.signup_state = geo.state
        user.signup_country = geo.country or "US"

        db.commit()

    except Exception as e:
        print(f"Signup location tracking error: {e}")
        db.rollback()
