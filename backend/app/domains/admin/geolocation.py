"""
Scopit - Geolocation Service (Free IP-API)
Uses ip-api.com - Free for non-commercial use, 45 requests/minute
"""
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import httpx


@dataclass
class GeoLocation:
    """Geolocation data from IP address"""
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    timezone: Optional[str] = None


@dataclass
class DeviceInfo:
    """Parsed device information from User-Agent"""
    device_type: str = "desktop"  # desktop, mobile, tablet
    browser: Optional[str] = None
    os: Optional[str] = None


class GeolocationService:
    """
    Free IP Geolocation using ip-api.com
    - No API key required
    - 45 requests per minute limit
    - For production with higher volume, consider MaxMind GeoLite2
    """

    API_URL = "http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,timezone"

    # Cache results for 1 hour (3600 seconds) - reduces API calls
    @staticmethod
    @lru_cache(maxsize=1000)
    def _cached_lookup(ip: str) -> Optional[dict]:
        """Cached IP lookup to reduce API calls"""
        try:
            # Skip private/local IPs
            if GeolocationService._is_private_ip(ip):
                return None

            with httpx.Client(timeout=5.0) as client:
                response = client.get(
                    GeolocationService.API_URL.format(ip=ip)
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "success":
                        return data
        except Exception:
            pass
        return None

    @staticmethod
    def _is_private_ip(ip: str) -> bool:
        """Check if IP is private/local"""
        private_patterns = [
            r'^127\.',
            r'^10\.',
            r'^172\.(1[6-9]|2[0-9]|3[0-1])\.',
            r'^192\.168\.',
            r'^::1$',
            r'^localhost$',
        ]
        for pattern in private_patterns:
            if re.match(pattern, ip):
                return True
        return False

    @classmethod
    def get_location(cls, ip: str) -> GeoLocation:
        """Get geolocation from IP address"""
        if not ip:
            return GeoLocation()

        # Handle forwarded IPs (take first one)
        if "," in ip:
            ip = ip.split(",")[0].strip()

        data = cls._cached_lookup(ip)
        if not data:
            return GeoLocation()

        return GeoLocation(
            city=data.get("city"),
            state=data.get("regionName"),
            country=data.get("country"),
            country_code=data.get("countryCode"),
            timezone=data.get("timezone"),
        )


class UserAgentParser:
    """
    Simple User-Agent parser without external dependencies
    For production, consider using 'user-agents' package
    """

    # Common browser patterns
    BROWSERS = [
        (r'Firefox/(\d+)', 'Firefox'),
        (r'Edg/(\d+)', 'Edge'),
        (r'Chrome/(\d+)', 'Chrome'),
        (r'Safari/(\d+)', 'Safari'),
        (r'Opera/(\d+)', 'Opera'),
        (r'MSIE (\d+)', 'IE'),
        (r'Trident/.*rv:(\d+)', 'IE'),
    ]

    # OS patterns
    OS_PATTERNS = [
        (r'Windows NT 10', 'Windows 10'),
        (r'Windows NT 6\.3', 'Windows 8.1'),
        (r'Windows NT 6\.2', 'Windows 8'),
        (r'Windows NT 6\.1', 'Windows 7'),
        (r'Mac OS X (\d+[._]\d+)', 'macOS'),
        (r'Linux', 'Linux'),
        (r'Android (\d+)', 'Android'),
        (r'iPhone OS (\d+)', 'iOS'),
        (r'iPad.*OS (\d+)', 'iPadOS'),
    ]

    # Mobile indicators
    MOBILE_PATTERNS = [
        r'Mobile',
        r'Android',
        r'iPhone',
        r'iPod',
        r'BlackBerry',
        r'Windows Phone',
    ]

    # Tablet indicators
    TABLET_PATTERNS = [
        r'iPad',
        r'Android.*Tablet',
        r'Tablet',
    ]

    @classmethod
    def parse(cls, user_agent: str) -> DeviceInfo:
        """Parse User-Agent string"""
        if not user_agent:
            return DeviceInfo()

        # Detect device type
        device_type = "desktop"
        for pattern in cls.TABLET_PATTERNS:
            if re.search(pattern, user_agent, re.IGNORECASE):
                device_type = "tablet"
                break
        else:
            for pattern in cls.MOBILE_PATTERNS:
                if re.search(pattern, user_agent, re.IGNORECASE):
                    device_type = "mobile"
                    break

        # Detect browser
        browser = None
        for pattern, name in cls.BROWSERS:
            if re.search(pattern, user_agent):
                browser = name
                break

        # Detect OS
        os_name = None
        for pattern, name in cls.OS_PATTERNS:
            if re.search(pattern, user_agent):
                os_name = name
                break

        return DeviceInfo(
            device_type=device_type,
            browser=browser,
            os=os_name,
        )


# Singleton instances
geolocation_service = GeolocationService()
user_agent_parser = UserAgentParser()
