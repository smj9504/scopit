"""
Scopit - Application Configuration
"""
import os
from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # ===================
    # Environment
    # ===================
    ENV: str = "local"  # local, stage, production
    DEBUG: bool = True
    APP_NAME: str = "Scopit"
    APP_VERSION: str = "1.0.0"
    
    # ===================
    # Server
    # ===================
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    
    # ===================
    # Database
    # ===================
    DATABASE_URL: str = "postgresql://scopit:scopit123@localhost:5432/scopit_local"
    DATABASE_POOL_SIZE: int = 5
    DATABASE_MAX_OVERFLOW: int = 10
    
    # ===================
    # Security
    # ===================
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BCRYPT_ROUNDS: int = 12
    
    # ===================
    # CORS
    # ===================
    CORS_ORIGINS: str = "http://localhost:3001"
    
    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    # ===================
    # Client IP / Rate limiting
    # ===================
    # Header the hosting platform overwrites with the visitor's address
    # (e.g. "True-Client-IP" behind Cloudflare). Empty = don't use one.
    CLIENT_IP_HEADER: str = ""
    # Number of proxies in front of the app that append to X-Forwarded-For.
    # 0 = trust only the socket peer (local development).
    TRUSTED_PROXY_HOPS: int = 0
    # Master switch for the in-process limits in app/core/rate_limit.py
    # (tests turn it off).
    RATE_LIMIT_ENABLED: bool = True

    # ===================
    # Outgoing email limits (estimate/invoice/e-sign sends)
    # ===================
    # Recipients per message (To + Cc + Bcc).
    EMAIL_MAX_RECIPIENTS: int = 10
    # Customer-facing emails a company can send per hour.
    EMAIL_SENDS_PER_COMPANY_PER_HOUR: int = 60
    SMTP_TIMEOUT_SECONDS: int = 20

    # Hard ceiling on any request body (endpoints apply tighter limits).
    # Above the 150 MB anonymous packing-lead form, the largest legitimate upload.
    MAX_REQUEST_BODY_MB: int = 160
    
    # ===================
    # Frontend URL
    # ===================
    FRONTEND_URL: str = "http://localhost:3001"
    
    # ===================
    # Beta Mode
    # ===================
    BETA_MODE: bool = True
    BETA_END_DATE: str = "2026-06-30"
    
    # ===================
    # Google OAuth
    # ===================
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8001/api/auth/google/callback"

    # ===================
    # Stripe (Phase 2)
    # ===================
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRICE_ID_PRO_MONTHLY: Optional[str] = None
    STRIPE_PRICE_ID_PRO_YEARLY: Optional[str] = None
    
    # ===================
    # Email (Phase 2)
    # ===================
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAIL_FROM: str = "no-reply@scopit.work"
    EMAIL_FROM_NAME: str = "Scopit"
    
    # ===================
    # Item Recommender (semantic search)
    # ===================
    # Loads a sentence-transformers/torch model (~500MB-1GB RAM) and needs the
    # parsed_json dataset. Disabled by default on memory-constrained hosts
    # (e.g. Render free plan) to avoid OOM crashes.
    ITEM_RECOMMENDER_ENABLED: bool = True

    # ===================
    # AI / Vision (Packing Tool)
    # ===================
    ANTHROPIC_API_KEY: Optional[str] = None
    VISION_BATCH_INTER_ROOM_DELAY: float = 0.5
    VISION_BATCH_MAX_ROOMS: int = 15
    VISION_RATE_LIMIT_RETRIES: int = 3
    VISION_RATE_LIMIT_BASE_DELAY: float = 2.0
    # Rooms a company may send to the vision model per rolling 24 hours
    # (signed-in packing tool; anonymous leads use PACKING_LEAD_DAILY_CAP).
    # Superusers are exempt.
    AI_VISION_ROOMS_PER_COMPANY_PER_DAY: int = 150

    # ===================
    # Cabinet Estimator
    # ===================
    # The 3D view's "AI photo": a Gemini image model redraws the realistic
    # render as a photo of the finished kitchen. On hold: its button is hidden
    # (AI_PHOTO_ENABLED in CabinetSketchEditor.tsx), and the endpoint answers
    # 503 until a key is set.
    GEMINI_API_KEY: Optional[str] = None
    CABINET_AI_PHOTO_MODEL: str = "gemini-nano-banana-2.1"
    # Product library: the Claude model (ANTHROPIC_API_KEY) that reads a
    # product's details off a retailer page or a screenshot of one.
    PRODUCT_EXTRACT_MODEL: str = "claude-haiku-5-5"
    # low | medium | high | xhigh | max; empty for models without effort.
    PRODUCT_EXTRACT_EFFORT: str = "low"

    # ===================
    # File Storage
    # ===================
    STORAGE_PROVIDER: str = "local"  # local, r2
    STORAGE_BASE_DIR: str = "uploads"

    # Cloudflare R2 (S3-compatible)
    R2_ENDPOINT_URL: Optional[str] = None      # https://<account_id>.r2.cloudflarestorage.com
    R2_ACCESS_KEY_ID: Optional[str] = None
    R2_SECRET_ACCESS_KEY: Optional[str] = None
    R2_BUCKET_NAME: str = "scopit-uploads"
    R2_TOKEN_VALUE: Optional[str] = None

    # ===================
    # Geoapify (Address Autocomplete)
    # ===================
    GEOAPIFY_API_KEY: Optional[str] = None

    # ===================
    # PDF Editor
    # ===================
    PDF_MAX_UPLOAD_SIZE_MB: int = 50
    PDF_THUMBNAIL_SIZE: int = 300
    PDF_SIGN_TOKEN_EXPIRY_DAYS: int = 14

    # ===================
    # Packing Leads (anonymous estimate capture -> signup gate)
    # ===================
    # Placeholder default -- NOT tuned from real per-analysis cost data yet.
    # Revisit before production launch (per the approved plan).
    PACKING_LEAD_DAILY_CAP: int = 25
    PACKING_LEAD_RATE_LIMIT: str = "5/hour"
    # Internal address notified whenever a new anonymous lead is submitted on
    # the public /packing-estimate form. Empty string disables the notification.
    PACKING_LEAD_NOTIFY_EMAIL: str = "mjbuildworks@gmail.com"

    # ===================
    # Signup notifications
    # ===================
    # Internal address notified whenever a new account finishes signup (email
    # verified, or a first Google sign-in). Empty string disables the notice.
    SIGNUP_NOTIFY_EMAIL: str = "mjbuildworks@gmail.com"

    # ===================
    # Support inquiries (in-app Help form)
    # ===================
    # Internal address that receives each message a user sends from the app.
    # The email's Reply-To is the user, so replying answers them directly.
    # Empty string disables the email; messages are still saved and listed
    # in the admin console (/admin/inquiries).
    SUPPORT_NOTIFY_EMAIL: str = "mjbuildworks@gmail.com"
    SUPPORT_INQUIRIES_PER_USER_PER_HOUR: int = 10

    class Config:
        env_file = ".env.local"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings based on environment"""
    env = os.getenv("ENV", "local")
    if env == "production":
        # In production (Render), env vars are set directly — no .env file needed
        env_file = ".env.production" if os.path.exists(".env.production") else None
    else:
        env_file = f".env.{env}" if os.path.exists(f".env.{env}") else ".env.local"
    return Settings(_env_file=env_file) if env_file else Settings()


_DEFAULT_SECRET_KEYS = {
    "your-super-secret-key-change-in-production",
    "dev-secret-key-change-in-production",
}


def check_production_settings(s: Settings) -> None:
    """Refuse to start in production with settings that would make tokens forgeable."""
    if s.ENV != "production":
        return
    if not s.SECRET_KEY or s.SECRET_KEY in _DEFAULT_SECRET_KEYS:
        raise RuntimeError("SECRET_KEY must be set to a random value in production.")
    if len(s.SECRET_KEY) < 32:
        import logging
        logging.getLogger(__name__).warning(
            "SECRET_KEY is shorter than 32 characters; use a longer random value."
        )


settings = get_settings()
check_production_settings(settings)
