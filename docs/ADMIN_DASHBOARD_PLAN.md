# Scopit Admin Dashboard 구현 계획

## 📋 개요

**목적**: 비즈니스 분석을 위한 관리자 전용 대시보드 구현
- 사용자/회원 관리 및 분석
- 로그인/활동 추적 (지역, 시간대)
- 직종 분석
- Subscription 수익 분석 (향후 확장)

---

## 🏗️ 아키텍처

### Backend 구조 (Domain-Driven Design)
```
backend/app/domains/admin/
├── __init__.py
├── models.py          # LoginLog, UserActivity 모델
├── schemas.py         # Request/Response 스키마
├── repository.py      # 데이터 접근 레이어
├── service.py         # 비즈니스 로직
└── api.py             # API 라우터
```

### Frontend 구조
```
frontend/src/
├── pages/admin/
│   ├── AdminDashboardPage.tsx    # 메인 대시보드
│   ├── AdminUsersPage.tsx        # 사용자 목록
│   ├── AdminUserDetailPage.tsx   # 사용자 상세
│   └── AdminAnalyticsPage.tsx    # 상세 분석
├── components/admin/
│   ├── KPICard.tsx
│   ├── UserTable.tsx
│   ├── Charts/
│   │   ├── UserGrowthChart.tsx
│   │   ├── LoginHeatmap.tsx
│   │   └── OccupationPieChart.tsx
│   └── GeoMap.tsx                # 지역별 시각화
├── services/adminService.ts
└── types/admin.ts
```

---

## 📊 Phase 1: 기본 인프라 (Week 1)

### 1.1 User 모델 확장

**현재 User 모델에 추가할 필드:**
```python
# backend/app/domains/user/models.py

class User(Base):
    # ... 기존 필드 ...

    # 추가 프로필 정보
    occupation = Column(String(50))  # contractor, public_adjuster, attorney, other
    occupation_other = Column(String(100))  # occupation이 'other'일 때
    business_type = Column(String(50))  # roofing, interior, siding, general
    years_in_business = Column(Integer)

    # 마케팅/유입 정보
    utm_source = Column(String(100))
    utm_medium = Column(String(100))
    utm_campaign = Column(String(100))
    referral_code = Column(String(50))

    # 지역 정보 (회원가입 시)
    signup_ip = Column(String(45))
    signup_city = Column(String(100))
    signup_state = Column(String(50))
    signup_country = Column(String(50), default="US")

    # 통계
    login_count = Column(Integer, default=0)
    estimate_count = Column(Integer, default=0)
    invoice_count = Column(Integer, default=0)
```

### 1.2 LoginLog 모델 (신규)

```python
# backend/app/domains/admin/models.py

class LoginLog(Base):
    __tablename__ = "login_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))

    # 로그인 정보
    login_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    login_method = Column(String(20))  # email, google, apple

    # 위치 정보
    ip_address = Column(String(45))
    city = Column(String(100))
    state = Column(String(50))
    country = Column(String(50))
    latitude = Column(DECIMAL(10, 8))
    longitude = Column(DECIMAL(11, 8))

    # 디바이스 정보
    user_agent = Column(String(500))
    device_type = Column(String(20))  # desktop, mobile, tablet
    browser = Column(String(50))
    os = Column(String(50))

    # 관계
    user = relationship("User", back_populates="login_logs")
```

### 1.3 UserActivity 모델 (신규)

```python
class UserActivity(Base):
    __tablename__ = "user_activities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"))

    # 활동 정보
    action = Column(String(50))  # login, estimate_created, invoice_sent, etc.
    resource_type = Column(String(50))  # estimate, invoice, customer
    resource_id = Column(UUID(as_uuid=True))
    metadata = Column(JSON)  # 추가 정보

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
```

### 1.4 Superuser 인증 미들웨어

```python
# backend/app/core/dependencies.py

async def get_superuser(
    current_user: User = Depends(get_current_user)
) -> User:
    """Require superuser access"""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser access required"
        )
    return current_user
```

---

## 📊 Phase 2: Admin API 구현 (Week 1-2)

### 2.1 대시보드 KPI API

```python
# GET /api/admin/dashboard

class AdminDashboardResponse(BaseModel):
    # 사용자 통계
    total_users: int
    new_users_today: int
    new_users_this_week: int
    new_users_this_month: int
    active_users_today: int  # 오늘 로그인한 유저

    # 회사 통계
    total_companies: int
    active_companies: int  # 최근 30일 내 활동

    # 문서 통계
    total_estimates: int
    total_invoices: int
    estimates_this_month: int
    invoices_this_month: int

    # 직종별 분포
    occupation_stats: List[OccupationStat]

    # 최근 가입자
    recent_users: List[UserSummary]

    # 차트 데이터
    user_growth_data: List[DailyCount]  # 최근 30일
    login_activity_data: List[HourlyCount]  # 시간대별 활동
```

### 2.2 사용자 관리 API

```python
# GET /api/admin/users
# Query params: page, limit, search, occupation, sort_by, sort_order

class AdminUserListResponse(BaseModel):
    items: List[AdminUserResponse]
    total: int
    page: int
    limit: int

class AdminUserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str]
    company_name: Optional[str]
    occupation: Optional[str]

    # 활동 통계
    login_count: int
    last_login_at: Optional[datetime]
    estimate_count: int
    invoice_count: int

    # 지역 정보
    signup_city: Optional[str]
    signup_state: Optional[str]
    last_login_city: Optional[str]
    last_login_state: Optional[str]

    # 상태
    is_active: bool
    is_verified: bool
    created_at: datetime

# GET /api/admin/users/{user_id}
# 사용자 상세 정보 + 로그인 히스토리 + 활동 내역
```

### 2.3 분석 API

```python
# GET /api/admin/analytics/geography
# 지역별 사용자 분포

# GET /api/admin/analytics/occupation
# 직종별 분석

# GET /api/admin/analytics/retention
# 리텐션 분석 (코호트)

# GET /api/admin/analytics/activity
# 활동 패턴 분석
```

---

## 📊 Phase 3: Frontend 구현 (Week 2-3)

### 3.1 Admin 라우팅

```tsx
// App.tsx에 추가

// Admin Routes (Superuser only)
<Route
  path="/admin"
  element={
    <AdminRoute>
      <AdminLayout />
    </AdminRoute>
  }
>
  <Route index element={<Navigate to="/admin/dashboard" replace />} />
  <Route path="dashboard" element={<AdminDashboardPage />} />
  <Route path="users" element={<AdminUsersPage />} />
  <Route path="users/:id" element={<AdminUserDetailPage />} />
  <Route path="analytics" element={<AdminAnalyticsPage />} />
</Route>
```

### 3.2 AdminRoute 컴포넌트

```tsx
// components/layout/AdminRoute.tsx

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!user?.is_superuser) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <>{children}</>;
};
```

### 3.3 Admin Dashboard 페이지

```tsx
// pages/admin/AdminDashboardPage.tsx

const AdminDashboardPage: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminService.getDashboard,
  });

  return (
    <div>
      {/* KPI Cards */}
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <KPICard
            title="Total Users"
            value={data?.total_users}
            trend={data?.new_users_this_week}
          />
        </Col>
        {/* ... more cards */}
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <UserGrowthChart data={data?.user_growth_data} />
        </Col>
        <Col span={12}>
          <OccupationPieChart data={data?.occupation_stats} />
        </Col>
      </Row>

      {/* Recent Users Table */}
      <UserTable users={data?.recent_users} />
    </div>
  );
};
```

---

## 📊 Phase 4: Subscription 분석 (Week 3-4, 향후 확장)

### 4.1 Subscription 모델

```python
# backend/app/domains/subscription/models.py

class SubscriptionPlan(str, Enum):
    FREE = "free"
    PRO_MONTHLY = "pro_monthly"
    PRO_YEARLY = "pro_yearly"

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), unique=True)

    # Stripe 정보
    stripe_customer_id = Column(String(100))
    stripe_subscription_id = Column(String(100))

    # 플랜 정보
    plan = Column(Enum(SubscriptionPlan), default=SubscriptionPlan.FREE)
    status = Column(String(20))  # active, past_due, canceled, trialing

    # 기간
    current_period_start = Column(TIMESTAMP(timezone=True))
    current_period_end = Column(TIMESTAMP(timezone=True))
    canceled_at = Column(TIMESTAMP(timezone=True))

    # 가격
    monthly_amount = Column(DECIMAL(10, 2))
    currency = Column(String(3), default="USD")

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
```

### 4.2 수익 분석 API

```python
# GET /api/admin/analytics/revenue

class RevenueAnalyticsResponse(BaseModel):
    # 현재 MRR (Monthly Recurring Revenue)
    mrr: Decimal
    mrr_growth_rate: float  # vs 전월

    # ARR (Annual Recurring Revenue)
    arr: Decimal

    # 구독 통계
    total_subscriptions: int
    active_subscriptions: int
    churned_this_month: int
    new_subscriptions_this_month: int

    # 플랜별 분포
    plan_distribution: List[PlanStat]

    # 월별 수익 추이
    monthly_revenue: List[MonthlyRevenue]

    # 이탈률
    churn_rate: float
```

---

## 🗄️ 데이터베이스 마이그레이션

### Migration 1: User 테이블 확장
```bash
alembic revision --autogenerate -m "add_user_profile_and_tracking_fields"
```

### Migration 2: LoginLog 테이블 생성
```bash
alembic revision --autogenerate -m "create_login_logs_table"
```

### Migration 3: UserActivity 테이블 생성
```bash
alembic revision --autogenerate -m "create_user_activities_table"
```

---

## 🔧 IP Geolocation 서비스

### 옵션 1: ip-api.com (무료, 개발용)
```python
import httpx

async def get_location_from_ip(ip: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"http://ip-api.com/json/{ip}")
        data = response.json()
        return {
            "city": data.get("city"),
            "state": data.get("regionName"),
            "country": data.get("country"),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
        }
```

### 옵션 2: MaxMind GeoLite2 (프로덕션용)
```python
import geoip2.database

reader = geoip2.database.Reader('GeoLite2-City.mmdb')

def get_location_from_ip(ip: str) -> dict:
    response = reader.city(ip)
    return {
        "city": response.city.name,
        "state": response.subdivisions.most_specific.name,
        "country": response.country.name,
        "lat": response.location.latitude,
        "lon": response.location.longitude,
    }
```

---

## 📱 Frontend 라이브러리 추가

```bash
# 차트
npm install recharts

# 지도 (옵션)
npm install mapbox-gl
# 또는
npm install @react-google-maps/api
```

---

## 🚀 구현 순서

### Week 1
1. [ ] User 모델 필드 추가 + Migration
2. [ ] LoginLog, UserActivity 모델 생성 + Migration
3. [ ] 로그인 시 LoginLog 기록 로직 추가
4. [ ] Admin API 기본 구조 생성

### Week 2
5. [ ] Admin Dashboard API 구현
6. [ ] Admin Users API 구현
7. [ ] Frontend Admin 라우팅 설정
8. [ ] AdminDashboardPage UI 구현

### Week 3
9. [ ] AdminUsersPage UI 구현
10. [ ] AdminUserDetailPage UI 구현
11. [ ] 차트 컴포넌트 구현
12. [ ] IP Geolocation 연동

### Week 4 (향후)
13. [ ] Subscription 모델 구현
14. [ ] Stripe 연동
15. [ ] Revenue Analytics 구현

---

## 🔐 보안 고려사항

1. **Superuser 전용 접근**: 모든 Admin API는 `is_superuser=True` 체크
2. **Rate Limiting**: Admin API에 rate limit 적용
3. **Audit Log**: Admin 액션 로깅
4. **IP 화이트리스트**: 프로덕션에서 Admin 접근 IP 제한 고려
5. **2FA**: Superuser 계정에 2FA 적용 고려

---

## 📊 KPI 정의

### 사용자 메트릭
- **DAU**: Daily Active Users (하루 최소 1회 로그인)
- **WAU**: Weekly Active Users
- **MAU**: Monthly Active Users
- **Stickiness**: DAU/MAU 비율

### 비즈니스 메트릭
- **Conversion Rate**: Free → Pro 전환율
- **Churn Rate**: 월간 이탈률
- **LTV**: Customer Lifetime Value
- **CAC**: Customer Acquisition Cost

### 제품 메트릭
- **Estimates per User**: 사용자당 평균 견적 수
- **Conversion to Invoice**: 견적 → 인보이스 전환율
- **Feature Adoption**: 각 기능 사용률
