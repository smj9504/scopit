"""
Scopit - Auth API Routes
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone
from authlib.integrations.starlette_client import OAuth

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.dependencies import get_current_user
from app.core.email import email_service
from app.common.utils import generate_random_username
from app.domains.user.models import User
from app.domains.company.models import Company
from app.domains.settings.service import seed_default_settings
from app.domains.customer.service import seed_sample_customers
from app.domains.admin.login_tracker import track_login, track_signup_location
# Import all models to ensure SQLAlchemy relationships are resolved
from app.domains.customer.models import Customer
from app.domains.line_item.models import LineItem
from app.domains.estimate.models import Estimate
from app.domains.invoice.models import Invoice
from app.domains.settings.models import EstimateStatusConfig, InvoiceStatusConfig, LineItemCategory
from app.domains.auth.models import EmailVerificationCode
from app.domains.auth.verification import (
    issue_verification_code,
    get_latest_code,
    hash_code,
    MAX_ATTEMPTS,
    RESEND_COOLDOWN_SECONDS,
    CODE_EXPIRY_MINUTES,
)
from app.common.responses import MessageResponse


router = APIRouter()

# ===================
# OAuth Setup
# ===================
import httpx

oauth = OAuth()

# Custom httpx client with longer timeout for slow networks
httpx_client = httpx.AsyncClient(timeout=30.0)

if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
    oauth.register(
        name='google',
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={
            'scope': 'openid email profile',
            'timeout': 30.0,
        },
    )


# ===================
# Schemas
# ===================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None  # Optional, will generate random username if not provided
    company_name: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    company_id: Optional[str] = None
    role: str
    is_active: bool
    is_superuser: bool = False
    default_pdf_template: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def model_validate(cls, obj, **kwargs):
        """Convert UUID fields to strings before validation"""
        if hasattr(obj, '__dict__'):
            data = {
                'id': str(obj.id) if obj.id else None,
                'email': obj.email,
                'full_name': obj.full_name,
                'phone': obj.phone,
                'avatar_url': obj.avatar_url,
                'company_id': str(obj.company_id) if obj.company_id else None,
                'role': obj.role,
                'is_active': obj.is_active,
                'is_superuser': obj.is_superuser,
                'default_pdf_template': obj.default_pdf_template or 'classic',
                'created_at': obj.created_at,
            }
            return cls(**data)
        return super().model_validate(obj, **kwargs)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class RegisterResponse(BaseModel):
    email: str
    message: str = "Verification code sent to your email"


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    default_pdf_template: Optional[str] = None  # classic, modern, professional


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ===================
# Endpoints
# ===================

@router.post("/register", response_model=RegisterResponse)
async def register(
    data: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Register new user and company, then email a verification code"""

    # Check if email already exists
    existing_user = db.query(User).filter(User.email == data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )

    # Create company
    company = Company(
        name=data.company_name,
    )
    db.add(company)
    db.flush()

    # Seed default settings for company
    seed_default_settings(db, company.id)

    # Generate display name: use provided name or generate Reddit-style random username
    display_name = data.full_name if data.full_name else generate_random_username()

    # Create user
    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        full_name=display_name,
        company_id=company.id,
        role="admin",
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.flush()

    # Seed sample customers for the new company
    seed_sample_customers(db, company.id, user.id)

    db.commit()
    db.refresh(user)

    # Track signup location from IP
    client_ip = request.headers.get("X-Forwarded-For", request.client.host)
    track_signup_location(db, user, client_ip)

    # Issue and email a verification code (must be entered before the user can log in)
    code = issue_verification_code(db, user)
    db.commit()

    email_service.send_verification_code_email(
        to_email=user.email,
        user_name=user.full_name or "there",
        code=code,
        expires_in_minutes=CODE_EXPIRY_MINUTES,
    )

    return RegisterResponse(email=user.email)


@router.post("/verify-email", response_model=LoginResponse)
async def verify_email(
    data: VerifyEmailRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Verify the emailed 6-digit code, activate the account, and log the user in"""

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if user.is_verified:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already verified. Please log in.")

    record = get_latest_code(db, user.id)
    if not record or record.consumed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active verification code. Please request a new one.",
        )

    now = datetime.now(timezone.utc)
    if record.expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Verification code expired. Please request a new one.",
        )

    if record.attempts >= MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Please request a new code.",
        )

    if hash_code(data.code.strip()) != record.code_hash:
        record.attempts += 1
        db.commit()
        remaining = MAX_ATTEMPTS - record.attempts
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incorrect code. {remaining} attempt(s) remaining.",
        )

    # Success
    record.consumed_at = now
    user.is_verified = True
    db.commit()
    db.refresh(user)

    email_service.send_welcome_email(
        to_email=user.email,
        user_name=user.full_name or "there",
    )

    client_ip = request.headers.get("X-Forwarded-For", request.client.host)
    user_agent = request.headers.get("User-Agent")
    track_login(db, user, client_ip, user_agent, login_method="email")

    access_token = create_access_token(
        user_id=str(user.id),
        company_id=str(user.company_id) if user.company_id else None,
        role=user.role,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/resend-verification-code", response_model=MessageResponse)
async def resend_verification_code(
    data: ResendVerificationRequest,
    db: Session = Depends(get_db),
):
    """Issue a new verification code, invalidating the previous one"""

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if user.is_verified:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already verified. Please log in.")

    latest = get_latest_code(db, user.id)
    if latest:
        elapsed = (datetime.now(timezone.utc) - latest.created_at).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            wait = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait}s before requesting a new code.",
            )

    code = issue_verification_code(db, user)
    db.commit()

    email_service.send_verification_code_email(
        to_email=user.email,
        user_name=user.full_name or "there",
        code=code,
        expires_in_minutes=CODE_EXPIRY_MINUTES,
    )

    return MessageResponse(message="A new verification code has been sent to your email.")


@router.post("/login", response_model=LoginResponse)
async def login(
    data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Login with email and password"""

    # Find user
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive"
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "EMAIL_NOT_VERIFIED", "message": "Please verify your email before logging in."},
        )

    # Track login with geolocation and device info
    client_ip = request.headers.get("X-Forwarded-For", request.client.host)
    user_agent = request.headers.get("User-Agent")
    track_login(db, user, client_ip, user_agent, login_method="email")

    # Generate tokens
    access_token = create_access_token(
        user_id=str(user.id),
        company_id=str(user.company_id) if user.company_id else None,
        role=user.role,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))
    
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(data: RefreshRequest, db: Session = Depends(get_db)):
    """Refresh access token"""
    
    payload = decode_token(data.refresh_token)
    
    if not payload or payload.type != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    
    # Get user
    user = db.query(User).filter(User.id == payload.sub).first()
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive"
        )
    
    # Generate new access token
    access_token = create_access_token(
        user_id=str(user.id),
        company_id=str(user.company_id) if user.company_id else None,
        role=user.role,
    )
    
    return RefreshResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update current user profile"""
    try:
        # Re-fetch user from current session to ensure it's attached
        user = db.query(User).filter(User.id == current_user.id).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Update fields
        if data.full_name is not None:
            user.full_name = data.full_name
        if data.default_pdf_template is not None:
            # Validate template name
            valid_templates = ['classic', 'modern', 'professional']
            if data.default_pdf_template.lower() in valid_templates:
                user.default_pdf_template = data.default_pdf_template.lower()

        # Commit the changes
        db.commit()
        
        # Refresh to get the latest data from database
        db.refresh(user)
        
        return UserResponse.model_validate(user)
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Rollback on error
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update profile: {str(e)}"
        )


@router.post("/me/change-password")
async def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change password"""
    # Verify current password
    if not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change password for OAuth accounts"
        )

    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )

    # Update password
    current_user.hashed_password = get_password_hash(data.new_password)
    db.commit()

    return MessageResponse(message="Password changed successfully")


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Logout (client should discard tokens)"""
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Request password reset email"""
    
    user = db.query(User).filter(User.email == data.email).first()
    
    # Always return success to prevent email enumeration
    if user:
        # TODO: Send password reset email
        pass
    
    return MessageResponse(message="If the email exists, a reset link has been sent")


@router.post("/reset-password")
async def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password with token"""

    # TODO: Verify token and reset password

    return MessageResponse(message="Password reset successfully")


# ===================
# Google OAuth Endpoints
# ===================

@router.get("/google")
async def google_login(request: Request):
    """Redirect to Google OAuth"""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured"
        )

    redirect_uri = settings.GOOGLE_REDIRECT_URI
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    """Handle Google OAuth callback"""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured"
        )

    try:
        token = await oauth.google.authorize_access_token(request)
        user_info = token.get('userinfo')

        if not user_info:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not get user info from Google"
            )

        email = user_info.get('email')
        name = user_info.get('name', '')
        picture = user_info.get('picture')
        google_id = user_info.get('sub')

        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not get email from Google"
            )

        # Check if user exists
        user = db.query(User).filter(User.email == email).first()

        if not user:
            # Create new user and company
            # Use name from Google, fallback to email prefix if empty
            display_name = name if name else email.split('@')[0]
            company = Company(name=f"{display_name}'s Company")
            db.add(company)
            db.flush()

            # Seed default settings for company
            seed_default_settings(db, company.id)

            user = User(
                email=email,
                full_name=display_name,
                avatar_url=picture,
                google_id=google_id,
                company_id=company.id,
                role="admin",
                is_active=True,
                is_verified=True,
            )
            db.add(user)
            db.flush()

            # Seed sample customers for the new company
            seed_sample_customers(db, company.id, user.id)

            db.commit()
            db.refresh(user)

            # Track signup location
            client_ip = request.headers.get(
                "X-Forwarded-For", request.client.host
            )
            track_signup_location(db, user, client_ip)

            # Send welcome email for new OAuth users
            email_service.send_welcome_email(
                to_email=user.email,
                user_name=user.full_name or "there",
            )

        # Track login (for both new and existing users)
        client_ip = request.headers.get("X-Forwarded-For", request.client.host)
        user_agent = request.headers.get("User-Agent")
        track_login(db, user, client_ip, user_agent, login_method="google")

        # Generate tokens
        access_token = create_access_token(
            user_id=str(user.id),
            company_id=str(user.company_id) if user.company_id else None,
            role=user.role,
        )
        refresh_token = create_refresh_token(user_id=str(user.id))

        # Redirect to frontend with tokens
        frontend_url = settings.FRONTEND_URL
        redirect_url = f"{frontend_url}/auth/callback?access_token={access_token}&refresh_token={refresh_token}"

        return RedirectResponse(url=redirect_url)

    except Exception as e:
        logger.exception("Google OAuth callback failed: %s", str(e))

        # Redirect to frontend with error
        frontend_url = settings.FRONTEND_URL
        error_url = f"{frontend_url}/login?error=oauth_failed"
        return RedirectResponse(url=error_url)
