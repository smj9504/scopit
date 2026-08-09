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
    EMAIL_FROM: str = "noreply@scopit.work"
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


settings = get_settings()
