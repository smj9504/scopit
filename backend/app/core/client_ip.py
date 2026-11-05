"""
Scopit - Client IP resolution

Behind a hosting proxy, request.client.host is the proxy, not the visitor,
and the leftmost X-Forwarded-For entry is whatever the visitor typed. Rate
limits keyed on either are wrong: the first puts every visitor in one bucket
(one person can lock everyone out), the second lets anyone pick a new bucket
per request.

Which value to trust depends on the deployment, so it is configured:

- CLIENT_IP_HEADER: a header the platform overwrites with the visitor's
  address (e.g. Cloudflare's True-Client-IP / CF-Connecting-IP).
- TRUSTED_PROXY_HOPS: how many proxies append to X-Forwarded-For in front
  of the app. Each appends the address it received the connection from, so
  with N trusted proxies the visitor is the Nth entry from the right.

With neither set (local development) the socket peer is used.
"""
import ipaddress
from typing import Optional

from starlette.requests import Request

from app.core.config import settings


def _valid_ip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    # "1.2.3.4:5678" and "[::1]:5678" forms
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1:candidate.index("]")]
    elif candidate.count(":") == 1:
        candidate = candidate.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def get_client_ip(request: Request) -> str:
    """Best-effort visitor address for rate limiting and login records."""
    header = (settings.CLIENT_IP_HEADER or "").strip()
    if header:
        ip = _valid_ip(request.headers.get(header))
        if ip:
            return ip

    hops = settings.TRUSTED_PROXY_HOPS
    if hops > 0:
        forwarded = request.headers.get("X-Forwarded-For", "")
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            # Fewer entries than proxies means a proxy was skipped; the
            # leftmost entry is then the best (still proxy-written) guess.
            ip = _valid_ip(parts[-hops] if len(parts) >= hops else parts[0])
            if ip:
                return ip

    if request.client and request.client.host:
        return request.client.host
    return "unknown"
