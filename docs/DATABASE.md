# 02. 데이터베이스 설계

> Scopit 데이터베이스 스키마, ERD, 마이그레이션 가이드

---

## 📐 ERD (Entity Relationship Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    CORE                                          │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
  │    users     │─────────▶│  companies   │◀─────────│subscriptions │
  │              │    N:1   │              │    1:1   │              │
  │  - email     │          │  - name      │          │  - status    │
  │  - password  │          │  - tax_rate  │          │  - plan_id   │
  │  - role      │          │  - settings  │          │  - beta      │
  └──────────────┘          └──────────────┘          └──────┬───────┘
         │                         │                         │
         │                         │                         ▼
         │                         │                  ┌──────────────┐
         │                         │                  │    plans     │
         │                         │                  │              │
         │                         │                  │  - features  │
         │                         │                  │  - limits    │
         │                         │                  └──────────────┘
         │                         │
         ▼                         ▼
  ┌──────────────┐          ┌──────────────┐
  │  line_items  │          │  customers   │
  │              │          │              │
  │  - name      │          │  - name      │
  │  - price     │          │  - email     │
  │  - taxable   │          │  - address   │
  │  - visibility│          └──────┬───────┘
  └──────┬───────┘                 │
         │                         │
         │                         │
         ▼                         │
  ┌──────────────┐                 │
  │line_item_notes│                │
  └──────────────┘                 │
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
                     ▼                           ▼
              ┌──────────────┐           ┌──────────────┐
              │  estimates   │──────────▶│   invoices   │
              │              │    1:1    │              │
              │  - number    │  convert  │  - number    │
              │  - status    │           │  - status    │
              │  - total     │           │  - total     │
              └──────┬───────┘           └──────┬───────┘
                     │                          │
                     ▼                          ▼
              ┌──────────────┐           ┌──────────────┐
              │estimate_items│           │invoice_items │
              └──────────────┘           └──────────────┘
```

---

## 🌍 환경별 DB 설정

| 환경 | Host | Database | Port | 용도 |
|------|------|----------|------|------|
| **Local** | localhost | scopit_local | 5432 | 개발 |
| **Stage** | stage-db.neon.tech | scopit_stage | 5432 | 테스트 |
| **Production** | prod-db.neon.tech | scopit_prod | 5432 | 운영 |

### 연결 문자열
```bash
# Local
DATABASE_URL=postgresql://scopit:scopit123@localhost:5432/scopit_local

# Stage
DATABASE_URL=postgresql://scopit:${PASSWORD}@ep-xxx.us-east-1.aws.neon.tech/scopit_stage?sslmode=require

# Production
DATABASE_URL=postgresql://scopit:${PASSWORD}@ep-xxx.us-east-1.aws.neon.tech/scopit_prod?sslmode=require
```

---

## 📋 테이블 정의

### 1. users

```sql
CREATE TABLE users (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Authentication
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    
    -- Profile
    full_name VARCHAR(255),
    phone VARCHAR(50),
    avatar_url TEXT,
    
    -- Company
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    
    -- Role & Status
    role VARCHAR(50) NOT NULL DEFAULT 'staff',
    -- 'admin': 회사 관리자, 모든 권한
    -- 'manager': 관리자, 제한된 설정 권한
    -- 'staff': 일반 사용자
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

---

### 2. companies

```sql
CREATE TABLE companies (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    
    -- Contact
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zipcode VARCHAR(20),
    country VARCHAR(50) DEFAULT 'US',
    
    -- Branding
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#111827',
    
    -- ⭐ Tax Settings (Phase 1: 수동 설정)
    default_tax_rate DECIMAL(5,3) DEFAULT 0,       -- 예: 8.250
    default_tax_label VARCHAR(50) DEFAULT 'Sales Tax',
    
    -- Numbering
    estimate_prefix VARCHAR(10) DEFAULT 'EST',
    invoice_prefix VARCHAR(10) DEFAULT 'INV',
    next_estimate_number INTEGER DEFAULT 1001,
    next_invoice_number INTEGER DEFAULT 1001,
    
    -- Default Content
    default_estimate_validity_days INTEGER DEFAULT 30,
    default_invoice_due_days INTEGER DEFAULT 30,
    default_notes TEXT,
    default_terms TEXT,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_companies_active ON companies(is_active);
```

---

### 3. customers ⭐ NEW

```sql
CREATE TABLE customers (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Company (Owner)
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),        -- 담당자명
    email VARCHAR(255),
    phone VARCHAR(50),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zipcode VARCHAR(20),
    country VARCHAR(50) DEFAULT 'US',
    
    -- Additional
    notes TEXT,
    tags VARCHAR(255)[],              -- 태그 배열
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_customers_company ON customers(company_id, is_active);
CREATE INDEX idx_customers_name ON customers(company_id, name);
CREATE INDEX idx_customers_email ON customers(email);
```

---

### 4. line_items ⭐ 구조 변경

```sql
-- Visibility Enum
CREATE TYPE line_item_visibility AS ENUM ('company', 'private');
-- 'company': 같은 회사 모든 사용자가 사용 가능
-- 'private': 생성자만 사용 가능

CREATE TABLE line_items (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Info (⭐ 필드명 변경)
    code VARCHAR(50),                               -- item → code (아이템 코드)
    name VARCHAR(255) NOT NULL,                     -- description → name (아이템 이름)
    includes TEXT,                                  -- 포함 작업 설명
    
    -- Pricing (⭐ 단순화 - Xactimate 필드 제거)
    unit VARCHAR(50),                               -- EA, SF, LF, HR 등
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,   -- 단가
    
    -- Categorization
    cat VARCHAR(50),                                -- 카테고리
    
    -- ⭐ Tax (Phase 1)
    is_taxable BOOLEAN NOT NULL DEFAULT TRUE,       -- 과세 여부
    tax_class VARCHAR(50),                          -- Phase 2용 (Labor, Materials 등)
    
    -- ⭐ Ownership (Dual ownership)
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    visibility line_item_visibility NOT NULL DEFAULT 'private',
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_line_items_company ON line_items(company_id, is_active);
CREATE INDEX idx_line_items_user ON line_items(created_by);
CREATE INDEX idx_line_items_visibility ON line_items(company_id, visibility, is_active);
CREATE INDEX idx_line_items_cat ON line_items(company_id, cat);
```

**접근 권한 로직:**
```sql
-- 사용자가 볼 수 있는 line items
SELECT * FROM line_items
WHERE company_id = :company_id
  AND is_active = TRUE
  AND (
    visibility = 'company'           -- 회사 공유 아이템
    OR created_by = :user_id         -- 본인 생성 아이템
  );
```

**이전 구조 대비 변경점:**
| 이전 (mj-estimate) | 이후 (scopit) | 설명 |
|-------------------|----------------|------|
| `type` ENUM | 제거 | XACTIMATE/CUSTOM 구분 불필요 |
| `description` | `name` | 명확한 필드명 |
| `item` | `code` | 아이템 코드 |
| `lab, mat, equ, labor_burden, market_condition` | 제거 | Xactimate 전용 필드 불필요 |
| - | `is_taxable` | 과세 여부 추가 |
| - | `visibility` | company/private 구분 추가 |
| - | `created_by` | 생성자 추가 |
| many-to-many notes | one-to-many notes | 노트 구조 단순화 |

---

### 5. line_item_notes ⭐ 구조 변경 (1:N)

```sql
CREATE TABLE line_item_notes (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Parent
    line_item_id UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
    
    -- Content
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_line_item_notes_item ON line_item_notes(line_item_id, order_index);
```

---

### 6. plans ⭐ NEW

```sql
CREATE TABLE plans (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Info
    name VARCHAR(50) NOT NULL UNIQUE,          -- 'free', 'pro'
    display_name VARCHAR(100) NOT NULL,        -- 'Free', 'Pro'
    description TEXT,
    
    -- Pricing
    price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
    price_yearly DECIMAL(10,2) NOT NULL DEFAULT 0,
    
    -- ⭐ Usage Limits (NULL = 무제한)
    max_estimates_per_month INTEGER,
    max_invoices_per_month INTEGER,
    max_customers INTEGER,
    max_line_items INTEGER,
    
    -- ⭐ Feature Flags
    can_save_line_items BOOLEAN NOT NULL DEFAULT FALSE,
    can_save_customers BOOLEAN NOT NULL DEFAULT FALSE,
    can_convert_estimate BOOLEAN NOT NULL DEFAULT FALSE,
    can_send_email BOOLEAN NOT NULL DEFAULT FALSE,
    can_export_pdf BOOLEAN NOT NULL DEFAULT TRUE,
    can_custom_branding BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- ⭐ Seed Data (초기 플랜)
INSERT INTO plans (name, display_name, price_monthly, price_yearly,
                   max_estimates_per_month, max_invoices_per_month,
                   can_save_line_items, can_save_customers, 
                   can_convert_estimate, can_send_email)
VALUES 
    ('free', 'Free', 0, 0, 
     3, 3,                                    -- 월 3개 제한
     FALSE, FALSE, FALSE, FALSE),
    
    ('pro', 'Pro', 29, 290,
     NULL, NULL,                              -- 무제한
     TRUE, TRUE, TRUE, TRUE);
```

---

### 7. subscriptions ⭐ NEW

```sql
CREATE TABLE subscriptions (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active', 'trialing', 'past_due', 'canceled', 'unpaid'
    
    -- Stripe Integration (Phase 2)
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    
    -- Billing Period
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMP WITH TIME ZONE,
    
    -- ⭐ Beta
    is_beta_user BOOLEAN NOT NULL DEFAULT FALSE,
    beta_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

---

### 8. usage_tracking ⭐ NEW

```sql
CREATE TABLE usage_tracking (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Period (월별 집계)
    period_start DATE NOT NULL,              -- 매월 1일
    period_end DATE NOT NULL,                -- 매월 말일
    
    -- Counts
    estimates_created INTEGER NOT NULL DEFAULT 0,
    invoices_created INTEGER NOT NULL DEFAULT 0,
    emails_sent INTEGER NOT NULL DEFAULT 0,
    pdfs_generated INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    
    -- Unique constraint (회사당 월별 1개)
    CONSTRAINT usage_tracking_company_period UNIQUE (company_id, period_start)
);

CREATE INDEX idx_usage_tracking_company ON usage_tracking(company_id, period_start);
```

---

### 9. estimates

```sql
CREATE TYPE estimate_status AS ENUM (
    'draft',      -- 작성 중
    'sent',       -- 발송됨
    'viewed',     -- 고객이 확인함
    'approved',   -- 승인됨
    'declined',   -- 거절됨
    'expired',    -- 만료됨
    'converted'   -- Invoice로 변환됨
);

CREATE TABLE estimates (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    
    -- Estimate Info
    estimate_number VARCHAR(50) NOT NULL,
    status estimate_status NOT NULL DEFAULT 'draft',
    
    -- Dates
    estimate_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    sent_at TIMESTAMP WITH TIME ZONE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    declined_at TIMESTAMP WITH TIME ZONE,
    
    -- ⭐ Amounts
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    taxable_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,     -- 과세 대상 금액
    tax_rate DECIMAL(5,3),                                  -- NULL이면 company 기본값 사용
    tax_label VARCHAR(50),
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    -- Content
    title VARCHAR(255),
    description TEXT,
    notes TEXT,
    terms TEXT,
    
    -- Customer Info Snapshot (고객 정보 변경 대비)
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_address TEXT,
    
    -- ⭐ Conversion (Invoice 변환)
    converted_to_invoice_id UUID REFERENCES invoices(id),
    converted_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_estimates_company ON estimates(company_id);
CREATE INDEX idx_estimates_customer ON estimates(customer_id);
CREATE INDEX idx_estimates_status ON estimates(company_id, status);
CREATE INDEX idx_estimates_number ON estimates(company_id, estimate_number);
CREATE INDEX idx_estimates_date ON estimates(company_id, estimate_date DESC);
```

---

### 10. estimate_items

```sql
CREATE TABLE estimate_items (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    line_item_id UUID REFERENCES line_items(id) ON DELETE SET NULL,  -- 원본 참조 (선택)
    
    -- Item Info (Snapshot - 원본 변경되어도 유지)
    code VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    unit VARCHAR(50),
    
    -- Amounts
    quantity DECIMAL(15,4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,        -- quantity * unit_price
    
    -- Tax
    is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Order & Grouping
    order_index INTEGER NOT NULL DEFAULT 0,
    section VARCHAR(100),                          -- 섹션명 (선택)
    
    -- Notes
    notes JSONB DEFAULT '[]',                      -- [{content, order}]
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_estimate_items_estimate ON estimate_items(estimate_id, order_index);
```

---

### 11. invoices

```sql
CREATE TYPE invoice_status AS ENUM (
    'draft',      -- 작성 중
    'sent',       -- 발송됨
    'viewed',     -- 고객이 확인함
    'partial',    -- 부분 결제
    'paid',       -- 완납
    'overdue',    -- 연체
    'canceled',   -- 취소
    'refunded'    -- 환불
);

CREATE TABLE invoices (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,   -- ⭐ 변환된 경우
    
    -- Invoice Info
    invoice_number VARCHAR(50) NOT NULL,
    status invoice_status NOT NULL DEFAULT 'draft',
    
    -- Dates
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    sent_at TIMESTAMP WITH TIME ZONE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    
    -- Amounts
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    taxable_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,3),
    tax_label VARCHAR(50),
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
    balance_due DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    -- Content
    title VARCHAR(255),
    description TEXT,
    notes TEXT,
    terms TEXT,
    
    -- Customer Info Snapshot
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_address TEXT,
    
    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_estimate ON invoices(estimate_id);
CREATE INDEX idx_invoices_status ON invoices(company_id, status);
CREATE INDEX idx_invoices_number ON invoices(company_id, invoice_number);
CREATE INDEX idx_invoices_date ON invoices(company_id, invoice_date DESC);
CREATE INDEX idx_invoices_overdue ON invoices(status, due_date) 
    WHERE status IN ('sent', 'viewed', 'partial');
```

---

### 12. invoice_items

```sql
CREATE TABLE invoice_items (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_item_id UUID REFERENCES line_items(id) ON DELETE SET NULL,
    
    -- Item Info (Snapshot)
    code VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    unit VARCHAR(50),
    
    -- Amounts
    quantity DECIMAL(15,4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    total DECIMAL(15,2) NOT NULL DEFAULT 0,
    
    -- Tax
    is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Order
    order_index INTEGER NOT NULL DEFAULT 0,
    section VARCHAR(100),
    
    -- Notes
    notes JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id, order_index);
```

---

### 13. payments

```sql
CREATE TYPE payment_method AS ENUM (
    'cash',
    'check',
    'credit_card',
    'bank_transfer',
    'other'
);

CREATE TABLE payments (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    
    -- Payment Info
    amount DECIMAL(15,2) NOT NULL,
    payment_method payment_method NOT NULL DEFAULT 'other',
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Reference
    reference_number VARCHAR(100),
    notes TEXT,
    
    -- Audit
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
```

---

## 💰 Tax 계산 로직

### Phase 1: 단순 Tax 계산

```python
def calculate_tax(estimate: Estimate, company: Company) -> dict:
    """
    Tax 계산 로직
    
    1. 각 item의 is_taxable 확인
    2. taxable_subtotal 계산
    3. tax_rate 적용 (estimate > company default)
    """
    
    # 과세 대상 금액 계산
    taxable_subtotal = sum(
        item.total for item in estimate.items 
        if item.is_taxable
    )
    
    # 비과세 금액
    non_taxable_subtotal = sum(
        item.total for item in estimate.items 
        if not item.is_taxable
    )
    
    subtotal = taxable_subtotal + non_taxable_subtotal
    
    # Tax rate (estimate 설정 > company 기본값)
    tax_rate = estimate.tax_rate or company.default_tax_rate or 0
    tax_label = estimate.tax_label or company.default_tax_label or "Sales Tax"
    
    # Tax 계산
    tax_amount = taxable_subtotal * (tax_rate / 100)
    
    total = subtotal + tax_amount - estimate.discount_amount
    
    return {
        "subtotal": subtotal,
        "taxable_subtotal": taxable_subtotal,
        "tax_rate": tax_rate,
        "tax_label": tax_label,
        "tax_amount": tax_amount,
        "discount_amount": estimate.discount_amount,
        "total": total
    }
```

### Phase 2 확장: Zipcode 기반 Tax (미래)

```sql
-- Phase 2 테이블 (나중에 추가)
CREATE TABLE tax_rates (
    id UUID PRIMARY KEY,
    zipcode VARCHAR(10) NOT NULL,
    state_code VARCHAR(2) NOT NULL,
    combined_rate DECIMAL(5,3) NOT NULL,
    effective_date DATE,
    source VARCHAR(50)              -- 'manual', 'avalara', 'taxjar'
);
```

---

## 🔄 Alembic 마이그레이션

### 설정

```python
# alembic/env.py

from app.core.config import settings
from app.core.database import Base

# Import all models
from app.domains.user.models import User
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.line_item.models import LineItem, LineItemNote
from app.domains.estimate.models import Estimate, EstimateItem
from app.domains.invoice.models import Invoice, InvoiceItem, Payment
from app.domains.subscription.models import Plan, Subscription, UsageTracking

target_metadata = Base.metadata

def get_url():
    return settings.DATABASE_URL
```

### 명령어

```bash
# 새 마이그레이션 생성 (자동)
alembic revision --autogenerate -m "add customer table"

# 마이그레이션 적용
alembic upgrade head

# 롤백
alembic downgrade -1

# 현재 상태 확인
alembic current

# 히스토리 확인
alembic history --verbose
```

### 초기 마이그레이션 예시

```python
# alembic/versions/001_initial_schema.py

"""Initial schema

Revision ID: 001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

def upgrade():
    # ENUM Types
    op.execute("CREATE TYPE line_item_visibility AS ENUM ('company', 'private')")
    op.execute("CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'viewed', 'approved', 'declined', 'expired', 'converted')")
    op.execute("CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'canceled', 'refunded')")
    op.execute("CREATE TYPE payment_method AS ENUM ('cash', 'check', 'credit_card', 'bank_transfer', 'other')")
    
    # Companies table
    op.create_table('companies', ...)
    
    # Users table
    op.create_table('users', ...)
    
    # ... 나머지 테이블들
    

def downgrade():
    op.drop_table('payments')
    op.drop_table('invoice_items')
    op.drop_table('invoices')
    # ... 역순으로 삭제
    
    op.execute("DROP TYPE payment_method")
    op.execute("DROP TYPE invoice_status")
    op.execute("DROP TYPE estimate_status")
    op.execute("DROP TYPE line_item_visibility")
```

---

## 🔗 관련 문서

- [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) - 시스템 아키텍처
- [03-BACKEND.md](./03-BACKEND.md) - Backend 구현
- [06-EXTERNAL-API.md](./06-EXTERNAL-API.md) - Stripe 연동

---

*Last Updated: 2026-01-26*
