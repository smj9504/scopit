# Scopit - Backend 개발 가이드

> FastAPI 백엔드 구현 상세 문서

---

## 📁 프로젝트 구조

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                      # FastAPI 앱 엔트리포인트
│   │
│   ├── core/                        # 핵심 설정
│   │   ├── config.py                # 환경 설정
│   │   ├── database.py              # DB 연결
│   │   ├── security.py              # JWT, 암호화
│   │   └── dependencies.py          # 공통 의존성
│   │
│   ├── common/                      # 공통 모듈
│   │   ├── base_repository.py
│   │   ├── base_service.py
│   │   ├── exceptions.py
│   │   └── utils.py
│   │
│   ├── domains/                     # 도메인별 모듈
│   │   ├── auth/
│   │   ├── user/
│   │   ├── company/
│   │   ├── customer/
│   │   ├── line_item/
│   │   ├── estimate/
│   │   ├── invoice/
│   │   └── subscription/
│   │
│   └── templates/                   # PDF 템플릿
│
├── alembic/                         # DB 마이그레이션
├── tests/
├── requirements.txt
└── Dockerfile
```

---

## ⚙️ Core 설정

### config.py

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Environment
    ENV: str = "local"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str
    
    # Security
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"
    
    # Beta
    BETA_MODE: bool = True
    
    class Config:
        env_file = ".env.local"

@lru_cache()
def get_settings() -> Settings:
    import os
    env = os.getenv("ENV", "local")
    return Settings(_env_file=f".env.{env}")

settings = get_settings()
```

### database.py

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### security.py

```python
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"])

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(user_id: str, company_id: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "company_id": company_id, "role": role, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
```

---

## 📦 Domain 구조

각 도메인은 다음 파일들로 구성:

| 파일 | 역할 |
|------|------|
| `models.py` | SQLAlchemy 모델 |
| `schemas.py` | Pydantic 스키마 |
| `repository.py` | DB CRUD |
| `service.py` | 비즈니스 로직 |
| `api.py` | FastAPI 라우터 |

### Line Item 예시

**models.py**
```python
from sqlalchemy import Column, String, DECIMAL, Boolean, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
import enum

class LineItemVisibility(str, enum.Enum):
    COMPANY = "company"
    PRIVATE = "private"

class LineItem(Base):
    __tablename__ = "line_items"
    
    id = Column(UUID(as_uuid=True), primary_key=True)
    code = Column(String(50))
    name = Column(String(255), nullable=False)
    unit = Column(String(50))
    unit_price = Column(DECIMAL(15, 2), default=0)
    is_taxable = Column(Boolean, default=True)
    visibility = Column(Enum(LineItemVisibility), default=LineItemVisibility.PRIVATE)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
```

**schemas.py**
```python
from pydantic import BaseModel
from uuid import UUID
from decimal import Decimal

class LineItemCreate(BaseModel):
    code: str | None = None
    name: str
    unit: str | None = None
    unit_price: Decimal = 0
    is_taxable: bool = True
    visibility: str = "private"

class LineItemResponse(LineItemCreate):
    id: UUID
    company_id: UUID
    created_by: UUID
    
    class Config:
        from_attributes = True
```

**service.py**
```python
from app.domains.subscription.feature_gate import feature_required

class LineItemService:
    def __init__(self, db):
        self.repo = LineItemRepository(db)
    
    @feature_required("can_save_line_items")
    async def create(self, data, current_user):
        return self.repo.create({
            **data.model_dump(),
            "company_id": current_user.company_id,
            "created_by": current_user.id
        })
```

---

## 🔒 Feature Gate

```python
# subscription/feature_gate.py

from functools import wraps
from app.core.config import settings

def feature_required(feature_name: str):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if settings.BETA_MODE:
                return await func(*args, **kwargs)
            
            user = kwargs.get('current_user')
            subscription = await get_subscription(user.company_id)
            
            if not getattr(subscription.plan, feature_name, False):
                raise HTTPException(403, "Upgrade to Pro")
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator
```

---

## 🚀 main.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

app = FastAPI(title="Scopit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from app.domains.auth.api import router as auth_router
app.include_router(auth_router, prefix="/api")
# ... other routers

@app.get("/health")
async def health():
    return {"status": "healthy", "env": settings.ENV}
```

---

*Last Updated: 2026-01-26*
