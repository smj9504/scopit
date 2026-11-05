"""
Scopit - In-process rate limiting

A small sliding-window limiter for abuse-prone endpoints (login, signup,
outgoing email). Counters live in process memory: the API runs as a single
uvicorn process, and losing counts on a restart is acceptable for these
limits. Durable quotas that guard money (AI usage) are stored in the
database instead -- see app/domains/tools/usage.py.
"""
import math
import threading
import time
from collections import deque
from typing import Deque, Dict

from fastapi import HTTPException, status

from app.core.config import settings

# Drop idle keys once the table grows past this, so a flood of distinct keys
# (e.g. one per spoofed email) can't grow memory without bound.
_MAX_KEYS = 50_000


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        # Called with the lock held. Removes keys with no recent hits; the
        # widest window any caller uses is a day.
        cutoff = now - 86_400
        for key in [k for k, q in self._hits.items() if not q or q[-1] < cutoff]:
            del self._hits[key]

    def hit(self, key: str, limit: int, window_seconds: int) -> float:
        """Record a hit. Returns 0 if allowed, else seconds until a slot frees.

        A refused hit is not recorded, so a client that keeps retrying is
        let back in as soon as the window allows.
        """
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                if len(self._hits) >= _MAX_KEYS:
                    self._prune(now)
                q = self._hits[key] = deque()
            cutoff = now - window_seconds
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= limit:
                return max(q[0] + window_seconds - now, 0.001)
            q.append(now)
            return 0.0

    def count(self, key: str, window_seconds: int) -> int:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0
            return sum(1 for t in q if t > now - window_seconds)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def enforce_rate_limit(
    key: str,
    limit: int,
    window_seconds: int,
    detail: str = "Too many requests. Please try again later.",
) -> None:
    """Raise 429 (with Retry-After) once `key` has used `limit` hits in the window."""
    if not settings.RATE_LIMIT_ENABLED:
        return
    wait = limiter.hit(key, limit, window_seconds)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(math.ceil(wait))},
        )
