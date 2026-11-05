"""
Scopit - Security utilities
"""
import hashlib
import secrets
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict

from app.core.config import settings

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

MIN_PASSWORD_LENGTH = 8
# bcrypt only looks at the first 72 bytes; refuse longer input rather than
# silently ignoring the rest (and bound hashing cost).
MAX_PASSWORD_LENGTH = 128


class TokenPayload(BaseModel):
    """JWT token payload structure"""
    model_config = ConfigDict(extra="ignore")

    sub: str                    # user_id
    company_id: Optional[str] = None
    role: Optional[str] = None
    type: str                   # access, refresh, oauth_code
    exp: datetime
    # User.token_version when the token was issued. Bumping the user's
    # version (password change, "sign out everywhere") invalidates every
    # older token. Tokens issued before this claim existed carry none and
    # count as version 0.
    ver: int = 0
    jti: Optional[str] = None
    # oauth_code only: hash of the browser's one-time state value.
    cs: Optional[str] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


def password_problem(password: str) -> Optional[str]:
    """Why a new password is unacceptable, or None if it's fine."""
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > 72 or len(password) > MAX_PASSWORD_LENGTH:
        return "Password must be at most 72 characters"
    return None


def create_access_token(
    user_id: str,
    company_id: Optional[str] = None,
    role: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
    token_version: int = 0,
) -> str:
    """Create JWT access token"""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "sub": str(user_id),
        "company_id": str(company_id) if company_id else None,
        "role": role,
        "type": "access",
        "exp": expire,
        "ver": int(token_version or 0),
    }

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str, token_version: int = 0) -> str:
    """Create JWT refresh token"""
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expire,
        "ver": int(token_version or 0),
    }

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[TokenPayload]:
    """Decode and validate JWT token"""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return TokenPayload(**payload)
    except (JWTError, ValueError):
        return None


def token_is_current(payload: TokenPayload, user) -> bool:
    """False once the user's token_version has moved past the token's."""
    return int(payload.ver or 0) == int(getattr(user, "token_version", 0) or 0)


# ===================
# Google sign-in hand-off
# ===================
# After Google redirects back, the API sends the browser to the frontend with
# a short-lived, single-use code (in the URL fragment, so it never reaches a
# server log) instead of the tokens themselves. The frontend exchanges it,
# together with the random state it generated before leaving for Google,
# for tokens. A link carrying someone else's code fails both checks.

OAUTH_CODE_TTL_SECONDS = 120


def hash_client_state(client_state: str) -> str:
    return hashlib.sha256(f"{client_state}{settings.SECRET_KEY}".encode()).hexdigest()


def create_oauth_code(user_id: str, client_state: str) -> str:
    to_encode = {
        "sub": str(user_id),
        "type": "oauth_code",
        "exp": datetime.utcnow() + timedelta(seconds=OAUTH_CODE_TTL_SECONDS),
        "jti": secrets.token_urlsafe(16),
        "cs": hash_client_state(client_state),
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


class _UsedCodes:
    """Single-use enforcement for oauth codes (in-process; codes live 2 min)."""

    def __init__(self) -> None:
        self._used: dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, jti: str) -> bool:
        now = time.monotonic()
        with self._lock:
            for key in [k for k, t in self._used.items() if t < now]:
                del self._used[key]
            if jti in self._used:
                return False
            self._used[jti] = now + OAUTH_CODE_TTL_SECONDS + 60
            return True


_used_oauth_codes = _UsedCodes()


def redeem_oauth_code(code: str, client_state: str) -> Optional[str]:
    """User id for a valid, unused code issued to this browser; else None."""
    payload = decode_token(code)
    if not payload or payload.type != "oauth_code" or not payload.jti or not payload.cs:
        return None
    if not client_state or not secrets.compare_digest(
        payload.cs, hash_client_state(client_state)
    ):
        return None
    if not _used_oauth_codes.claim(payload.jti):
        return None
    return payload.sub
