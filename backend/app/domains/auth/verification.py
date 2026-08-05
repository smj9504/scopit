"""
ScopeIt - Email Verification Code Logic
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.auth.models import EmailVerificationCode
from app.domains.user.models import User

CODE_LENGTH = 6
CODE_EXPIRY_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60


def generate_verification_code() -> str:
    """Cryptographically-safe 6-digit numeric code, zero-padded."""
    return f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"


def hash_code(code: str) -> str:
    """Pepper with SECRET_KEY so a DB dump alone isn't enough to replay codes."""
    return hashlib.sha256(f"{code}{settings.SECRET_KEY}".encode()).hexdigest()


def issue_verification_code(db: Session, user: User) -> str:
    """Create a new code row (becomes the 'active' one) and return the plaintext code to email."""
    code = generate_verification_code()
    record = EmailVerificationCode(
        user_id=user.id,
        code_hash=hash_code(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES),
    )
    db.add(record)
    db.flush()
    return code


def get_latest_code(db: Session, user_id: UUID) -> Optional[EmailVerificationCode]:
    return (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.user_id == user_id)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
