"""
Scopit - Auth API Routes
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

from app.common.responses import MessageResponse
from app.common.utils import generate_random_username
from app.core.client_ip import get_client_ip
from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.email import email_service
from app.core.rate_limit import enforce_rate_limit
from app.core.security import (
    PASSWORD_RESET_TTL_MINUTES,
    create_access_token,
    create_oauth_code,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    password_problem,
    password_reset_matches,
    password_reset_user_id,
    redeem_oauth_code,
    token_is_current,
    verify_password,
)
from app.domains.admin.login_tracker import track_login, track_signup_location
from app.domains.auth.verification import (
    CODE_EXPIRY_MINUTES,
    MAX_ATTEMPTS,
    RESEND_COOLDOWN_SECONDS,
    get_latest_code,
    hash_code,
    issue_verification_code,
)
from app.domains.company.models import Company

# Import all models to ensure SQLAlchemy relationships are resolved
from app.domains.customer.service import seed_sample_customers
from app.domains.settings.service import seed_default_settings
from app.domains.tools.modules.packing.seed import seed_moving_line_items
from app.domains.user.models import User

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
    password: str = Field(..., max_length=256)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=256)
    full_name: Optional[str] = Field(default=None, max_length=100)  # Optional, will generate random username if not provided
    company_name: str = Field(..., min_length=1, max_length=200)


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
    has_password: bool = False
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
                'has_password': bool(obj.hashed_password),
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
    refresh_token: str = Field(..., max_length=4096)


class RefreshResponse(BaseModel):
    access_token: str


class GoogleExchangeRequest(BaseModel):
    code: str = Field(..., max_length=4096)
    state: str = Field(..., min_length=16, max_length=256)


class PasswordChangedResponse(BaseModel):
    """Changing or setting a password signs out every other device, so the
    current one gets fresh tokens to stay signed in."""
    message: str
    access_token: str
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., max_length=4096)
    password: str = Field(..., max_length=256)


class RegisterResponse(BaseModel):
    email: str
    message: str = "Verification code sent to your email"


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., max_length=20)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=100)
    default_pdf_template: Optional[str] = Field(default=None, max_length=50)  # classic, modern, professional


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., max_length=256)


class SetPasswordRequest(BaseModel):
    new_password: str = Field(..., max_length=256)


def _notify_admin_of_signup(db: Session, user: User, signup_method: str) -> None:
    """Tell the internal team a new account finished signup.

    Fires once the account is real -- email verified, or a first Google
    sign-in -- so abandoned half-signups don't generate noise. Best-effort:
    a notification failure must never break the user's signup.
    """
    to_email = (settings.SIGNUP_NOTIFY_EMAIL or "").strip()
    if not to_email:
        return

    try:
        occupation = user.occupation
        if occupation == "other" and user.occupation_other:
            occupation = f"other ({user.occupation_other})"

        location = ", ".join(p for p in (user.signup_city, user.signup_state) if p)

        email_service.send_signup_notification_email(
            to_email=to_email,
            user_email=user.email,
            user_name=user.full_name or "-",
            company_name=user.company.name if user.company else None,
            occupation=occupation,
            location=location or None,
            signup_method=signup_method,
            signup_number=db.query(func.count(User.id)).scalar(),
        )
    except Exception:
        logger.exception("Failed to send signup notification for %s", user.email)


def _issue_tokens(user: User) -> tuple[str, str]:
    """Access + refresh token pair for the user's current token_version."""
    version = user.token_version or 0
    access_token = create_access_token(
        user_id=str(user.id),
        company_id=str(user.company_id) if user.company_id else None,
        role=user.role,
        token_version=version,
    )
    refresh_token = create_refresh_token(user_id=str(user.id), token_version=version)
    return access_token, refresh_token


async def _track_login(db: Session, user: User, request: Request, login_method: str) -> None:
    """Record the login. The IP geolocation lookup is a blocking HTTP call
    (up to 5s), so it runs in a worker thread instead of stalling every other
    request on the event loop."""
    await run_in_threadpool(
        track_login,
        db,
        user,
        get_client_ip(request),
        request.headers.get("User-Agent"),
        login_method,
    )


async def _track_signup_location(db: Session, user: User, request: Request) -> None:
    await run_in_threadpool(track_signup_location, db, user, get_client_ip(request))


def _limit_by_ip(request: Request, action: str, limit: int, window_seconds: int) -> None:
    enforce_rate_limit(
        f"{action}:ip:{get_client_ip(request)}",
        limit,
        window_seconds,
        "Too many attempts. Please wait a few minutes and try again.",
    )


def _limit_by_email(email: str, action: str, limit: int, window_seconds: int) -> None:
    enforce_rate_limit(
        f"{action}:email:{email.strip().lower()}",
        limit,
        window_seconds,
        "Too many attempts for this account. Please wait a few minutes and try again.",
    )


def _require_good_password(password: str) -> None:
    problem = password_problem(password)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)


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
    _limit_by_ip(request, "register", 10, 3600)
    _require_good_password(data.password)

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

    # Seed the packing tool's moving prices so the Moving Prices tab is
    # populated and estimates price off the company's own line items
    # rather than the service.DEFAULT_PRICES fallback.
    seed_moving_line_items(db, company.id, user.id, commit=False)

    db.commit()
    db.refresh(user)

    # Track signup location from IP
    await _track_signup_location(db, user, request)

    # Issue and email a verification code (must be entered before the user can log in)
    code = issue_verification_code(db, user)
    db.commit()

    await run_in_threadpool(email_service.send_verification_code_email,
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
    _limit_by_ip(request, "verify-email", 30, 900)
    _limit_by_email(data.email, "verify-email", 15, 900)

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

    await run_in_threadpool(email_service.send_welcome_email,
        to_email=user.email,
        user_name=user.full_name or "there",
    )
    await run_in_threadpool(_notify_admin_of_signup, db, user, signup_method="email")

    await _track_login(db, user, request, login_method="email")

    access_token, refresh_token = _issue_tokens(user)

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/resend-verification-code", response_model=MessageResponse)
async def resend_verification_code(
    data: ResendVerificationRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Issue a new verification code, invalidating the previous one"""
    _limit_by_ip(request, "resend-code", 10, 3600)
    _limit_by_email(data.email, "resend-code", 5, 3600)

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

    await run_in_threadpool(email_service.send_verification_code_email,
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
    _limit_by_ip(request, "login", 50, 900)
    _limit_by_email(data.email, "login", 10, 900)

    # Find user
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not user.hashed_password or not verify_password(data.password, user.hashed_password):
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
    await _track_login(db, user, request, login_method="email")

    # Generate tokens
    access_token, refresh_token = _issue_tokens(user)

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

    if not token_is_current(payload, user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    # Generate new access token
    access_token, _ = _issue_tokens(user)

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
    except Exception:
        # Rollback on error
        db.rollback()
        logger.exception("Failed to update profile for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile. Please try again."
        )


@router.post("/me/change-password", response_model=PasswordChangedResponse)
async def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change password. Signs out every other device; this one gets new tokens."""
    _limit_by_email(current_user.email, "change-password", 10, 900)
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

    _require_good_password(data.new_password)

    # Update password and invalidate every token issued before now
    current_user.hashed_password = get_password_hash(data.new_password)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)

    access_token, refresh_token = _issue_tokens(current_user)
    return PasswordChangedResponse(
        message="Password changed successfully",
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/me/set-password", response_model=PasswordChangedResponse)
async def set_password(
    data: SetPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set a password for an OAuth account that has none yet, enabling email/password login"""
    if current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password already set. Use change password instead."
        )

    _require_good_password(data.new_password)

    current_user.hashed_password = get_password_hash(data.new_password)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    db.refresh(current_user)

    access_token, refresh_token = _issue_tokens(current_user)
    return PasswordChangedResponse(
        message="Password set successfully",
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Logout (client should discard tokens)"""
    return MessageResponse(message="Logged out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Email a password reset link.

    The response is the same whether or not the account exists, and the email
    goes out after the response, so neither the answer nor its timing tells
    a caller which addresses have accounts.
    """
    _limit_by_ip(request, "forgot-password", 10, 3600)
    _limit_by_email(data.email, "forgot-password", 3, 3600)

    user = db.query(User).filter(User.email == data.email).first()
    if user and user.is_active:
        token = create_password_reset_token(user)
        # In the fragment: browsers never send it to servers or in Referer.
        reset_url = f"{settings.FRONTEND_URL}/reset-password#token={token}"
        background_tasks.add_task(
            email_service.send_password_reset_email,
            to_email=user.email,
            user_name=user.full_name or "there",
            reset_url=reset_url,
            expires_in_minutes=PASSWORD_RESET_TTL_MINUTES,
        )

    return MessageResponse(
        message="If an account exists for that email, we've sent a link to reset the password."
    )


_INVALID_RESET_LINK = "This reset link is invalid or has expired. Please request a new one."


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    data: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Set a new password from a reset link. Signs the account out everywhere."""
    _limit_by_ip(request, "reset-password", 20, 3600)

    parsed = password_reset_user_id(data.token)
    if not parsed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_RESET_LINK)
    user_id, fingerprint = parsed
    user = db.query(User).filter(User.id == user_id).first()
    # The fingerprint changes once the password does, so each link works once.
    if not user or not user.is_active or not password_reset_matches(user, fingerprint):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_RESET_LINK)

    _require_good_password(data.password)

    user.hashed_password = get_password_hash(data.password)
    user.token_version = (user.token_version or 0) + 1
    # Opening the emailed link proves the address belongs to them.
    user.is_verified = True
    db.commit()

    return MessageResponse(message="Your password has been reset. You can now sign in.")


# ===================
# Google OAuth Endpoints
# ===================

_CLIENT_STATE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def _valid_client_state(value: Optional[str]) -> bool:
    return bool(value) and 16 <= len(value) <= 256 and set(value) <= _CLIENT_STATE_CHARS


def _oauth_error_redirect(code: str = "oauth_failed") -> RedirectResponse:
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error={code}")


@router.get("/google")
async def google_login(request: Request, state: Optional[str] = None, reauth: bool = False):
    """Redirect to Google OAuth.

    `state` is a random value the frontend generated and kept in its own
    sessionStorage. It comes back with the one-time code after Google, and
    the frontend only accepts a code that carries its own state -- so a
    link with someone else's code can't sign this browser into their
    account (login CSRF).
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured"
        )
    if not _valid_client_state(state):
        # An outdated frontend (cached before this change) doesn't send one.
        return _oauth_error_redirect()

    request.session["client_state"] = state
    redirect_uri = settings.GOOGLE_REDIRECT_URI
    if reauth:
        # A device handed back after in-person signing: make Google ask for
        # the password instead of reusing a session open in the browser.
        return await oauth.google.authorize_redirect(request, redirect_uri, prompt="login")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    """Handle Google OAuth callback"""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured"
        )

    client_state = request.session.pop("client_state", None)
    if not _valid_client_state(client_state):
        return _oauth_error_redirect()

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
        if user_info.get('email_verified') is not True:
            # Only a Google-verified address proves the person owns it;
            # otherwise this could sign someone into another person's account.
            logger.warning("Google sign-in refused: email not verified by Google")
            return _oauth_error_redirect("email_not_verified")

        # Check if user exists
        user = db.query(User).filter(User.email == email).first()

        if not user:
            # Create new user and company
            # Use name from Google, fallback to email prefix if empty
            display_name = (name if name else email.split('@')[0])[:100]
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

            # Seed the packing tool's moving prices (see register())
            seed_moving_line_items(db, company.id, user.id, commit=False)

            db.commit()
            db.refresh(user)

            # Track signup location
            await _track_signup_location(db, user, request)

            # Send welcome email for new OAuth users
            await run_in_threadpool(email_service.send_welcome_email,
                to_email=user.email,
                user_name=user.full_name or "there",
            )
            await run_in_threadpool(_notify_admin_of_signup, db, user, signup_method="google")
        else:
            if not user.is_active:
                return _oauth_error_redirect("account_inactive")
            if not user.is_verified:
                # The account was registered with a password but its email was
                # never confirmed -- possibly by someone else who typed this
                # address. Google has now proven who owns the address, so mark
                # it verified and drop the unconfirmed password (and any tokens)
                # so whoever set it can't sign in. The owner can set a new
                # password from their profile.
                user.is_verified = True
                user.hashed_password = None
                user.token_version = (user.token_version or 0) + 1
                db.commit()
                db.refresh(user)

        # Track login (for both new and existing users)
        await _track_login(db, user, request, login_method="google")

        # Hand the browser a short-lived one-time code (in the URL fragment,
        # which browsers never send to servers), not the tokens themselves.
        code = create_oauth_code(str(user.id), client_state)
        fragment = urlencode({"code": code, "state": client_state})
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/auth/callback#{fragment}")

    except Exception as e:
        logger.exception("Google OAuth callback failed: %s", str(e))
        db.rollback()
        return _oauth_error_redirect()


@router.post("/google/exchange", response_model=LoginResponse)
async def google_exchange(
    data: GoogleExchangeRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Trade the one-time code from the Google callback for tokens."""
    _limit_by_ip(request, "google-exchange", 30, 900)

    user_id = redeem_oauth_code(data.code, data.state)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign-in link expired or invalid. Please sign in again.",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found or inactive",
        )

    access_token, refresh_token = _issue_tokens(user)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
    )
