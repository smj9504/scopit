"""
Scopit - Common Dependencies
"""
from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.domains.user.models import User

security = HTTPBearer()
_optional_security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token"""
    
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if payload.type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user from database
    user = db.query(User).filter(User.id == payload.sub).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive"
        )
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive"
        )
    return current_user


def require_role(allowed_roles: List[str]):
    """Role-based access control dependency factory"""
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    return role_checker


# Role-based dependencies
require_admin = require_role(["admin"])
require_manager = require_role(["admin", "manager"])
require_staff = require_role(["admin", "manager", "staff"])


async def get_superuser(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Require superuser access for admin endpoints.
    This is a critical security check - only is_superuser=True can access.
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser access required"
        )
    return current_user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_optional_security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Sibling to get_current_user that returns None instead of raising when
    there's no/invalid Authorization header. Used by public endpoints that
    behave differently for authenticated vs anonymous callers (e.g. the
    packing-lead status endpoint) without requiring auth outright."""
    if not credentials:
        return None

    payload = decode_token(credentials.credentials)
    if not payload or payload.type != "access":
        return None

    user = db.query(User).filter(User.id == payload.sub).first()
    if not user or not user.is_active:
        return None

    return user
