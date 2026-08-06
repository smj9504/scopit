# Scopit - API 명세서

> REST API 엔드포인트 상세 문서

---

## 📌 기본 정보

| 항목 | 값 |
|------|-----|
| **Base URL (Local)** | `http://localhost:8000/api` |
| **Base URL (Stage)** | `https://api.stage.scopit.work/api` |
| **Base URL (Prod)** | `https://api.scopit.work/api` |
| **인증 방식** | Bearer Token (JWT) |
| **Content-Type** | `application/json` |

---

## 🔐 인증 (Authentication)

### 공통 헤더

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### 에러 응답 형식

```json
{
  "detail": "에러 메시지",
  "error_code": "ERROR_CODE"
}
```

### 공통 에러 코드

| Status | Error Code | 설명 |
|--------|------------|------|
| 400 | BAD_REQUEST | 잘못된 요청 |
| 401 | UNAUTHORIZED | 인증 필요 |
| 403 | FORBIDDEN | 권한 없음 |
| 403 | FEATURE_NOT_ALLOWED | Pro 플랜 필요 |
| 403 | USAGE_LIMIT_EXCEEDED | 사용량 초과 |
| 404 | NOT_FOUND | 리소스 없음 |
| 409 | CONFLICT | 중복/충돌 |
| 500 | INTERNAL_ERROR | 서버 에러 |

---

## 📁 Auth API

### POST /auth/register
회원가입

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "fullName": "John Doe",
  "companyName": "ABC Restoration"
}
```

**Response (201):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "fullName": "John Doe",
    "companyId": "660e8400-e29b-41d4-a716-446655440000",
    "role": "admin",
    "isActive": true
  }
}
```

---

### POST /auth/login
로그인

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "fullName": "John Doe",
    "companyId": "660e8400-e29b-41d4-a716-446655440000",
    "role": "admin",
    "isActive": true
  }
}
```

---

### POST /auth/refresh
토큰 갱신

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### POST /auth/logout
로그아웃

**Response (200):**
```json
{
  "message": "Successfully logged out"
}
```

---

### GET /auth/me
현재 사용자 정보

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "fullName": "John Doe",
  "companyId": "660e8400-e29b-41d4-a716-446655440000",
  "role": "admin",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### POST /auth/forgot-password
비밀번호 재설정 요청

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "message": "Password reset email sent"
}
```

---

### POST /auth/reset-password
비밀번호 재설정

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "password": "newSecurePassword123"
}
```

**Response (200):**
```json
{
  "message": "Password successfully reset"
}
```

---

## 👥 Customers API

### GET /customers
고객 목록 조회

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| skip | int | ✗ | 건너뛸 개수 (default: 0) |
| limit | int | ✗ | 조회 개수 (default: 100, max: 500) |
| search | string | ✗ | 이름/이메일 검색 |
| isActive | bool | ✗ | 활성 상태 필터 |

**Response (200):**
```json
{
  "items": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "name": "ABC Company",
      "contactName": "Jane Smith",
      "email": "jane@abc.com",
      "phone": "555-1234",
      "addressLine1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipcode": "10001",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 100
}
```

---

### POST /customers
고객 생성 ⭐ **Pro 기능 (저장)**

**Request Body:**
```json
{
  "name": "ABC Company",
  "contactName": "Jane Smith",
  "email": "jane@abc.com",
  "phone": "555-1234",
  "addressLine1": "123 Main St",
  "addressLine2": "Suite 100",
  "city": "New York",
  "state": "NY",
  "zipcode": "10001",
  "notes": "VIP customer"
}
```

**Response (201):**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440000",
  "name": "ABC Company",
  "contactName": "Jane Smith",
  "email": "jane@abc.com",
  "phone": "555-1234",
  "addressLine1": "123 Main St",
  "addressLine2": "Suite 100",
  "city": "New York",
  "state": "NY",
  "zipcode": "10001",
  "notes": "VIP customer",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### GET /customers/{id}
고객 상세 조회

**Response (200):**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440000",
  "name": "ABC Company",
  "contactName": "Jane Smith",
  "email": "jane@abc.com",
  "phone": "555-1234",
  "addressLine1": "123 Main St",
  "city": "New York",
  "state": "NY",
  "zipcode": "10001",
  "notes": "VIP customer",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-15T00:00:00Z"
}
```

---

### PUT /customers/{id}
고객 수정

**Request Body:**
```json
{
  "name": "ABC Company Updated",
  "phone": "555-5678"
}
```

**Response (200):**
고객 상세 응답과 동일

---

### DELETE /customers/{id}
고객 삭제 (Soft Delete)

**Response (204):**
No Content

---

### GET /customers/{id}/estimates
고객별 견적서 목록

**Response (200):**
견적서 목록 응답과 동일

---

### GET /customers/{id}/invoices
고객별 인보이스 목록

**Response (200):**
인보이스 목록 응답과 동일

---

## 📦 Line Items API

### GET /line-items
라인 아이템 목록 조회

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| skip | int | ✗ | 건너뛸 개수 |
| limit | int | ✗ | 조회 개수 |
| cat | string | ✗ | 카테고리 필터 |
| search | string | ✗ | 이름/코드 검색 |

**Response (200):**
```json
{
  "items": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "code": "WD-001",
      "name": "Water Extraction - Carpet",
      "includes": "Includes setup, extraction, and cleanup",
      "unit": "SF",
      "unitPrice": 2.50,
      "cat": "Water Damage",
      "isTaxable": true,
      "visibility": "company",
      "companyId": "660e8400-e29b-41d4-a716-446655440000",
      "createdBy": "550e8400-e29b-41d4-a716-446655440000",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "notes": [
        {
          "id": "990e8400-e29b-41d4-a716-446655440000",
          "content": "Use truck-mounted extractor for best results",
          "orderIndex": 0
        }
      ]
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 100
}
```

---

### GET /line-items/categories
카테고리 목록

**Response (200):**
```json
[
  "Water Damage",
  "Fire Damage",
  "Mold Remediation",
  "General Restoration",
  "Cleaning"
]
```

---

### POST /line-items
라인 아이템 생성 ⭐ **Pro 기능**

**Request Body:**
```json
{
  "code": "WD-002",
  "name": "Dehumidifier Rental",
  "includes": "Per day rental, includes delivery and pickup",
  "unit": "DAY",
  "unitPrice": 75.00,
  "cat": "Water Damage",
  "isTaxable": true,
  "visibility": "company",
  "notes": [
    {
      "content": "Minimum 3-day rental",
      "orderIndex": 0
    }
  ]
}
```

**Response (201):**
라인 아이템 상세 응답과 동일

---

### GET /line-items/{id}
라인 아이템 상세 조회

**Response (200):**
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440000",
  "code": "WD-001",
  "name": "Water Extraction - Carpet",
  "includes": "Includes setup, extraction, and cleanup",
  "unit": "SF",
  "unitPrice": 2.50,
  "cat": "Water Damage",
  "isTaxable": true,
  "visibility": "company",
  "companyId": "660e8400-e29b-41d4-a716-446655440000",
  "createdBy": "550e8400-e29b-41d4-a716-446655440000",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-15T00:00:00Z",
  "notes": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440000",
      "content": "Use truck-mounted extractor",
      "orderIndex": 0,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### PUT /line-items/{id}
라인 아이템 수정

**Request Body:**
```json
{
  "name": "Water Extraction - Carpet (Updated)",
  "unitPrice": 3.00,
  "visibility": "private"
}
```

**Response (200):**
라인 아이템 상세 응답과 동일

---

### DELETE /line-items/{id}
라인 아이템 삭제

**Response (204):**
No Content

---

### POST /line-items/{id}/notes
노트 추가

**Request Body:**
```json
{
  "content": "New note content",
  "orderIndex": 1
}
```

**Response (201):**
```json
{
  "id": "aa0e8400-e29b-41d4-a716-446655440000",
  "content": "New note content",
  "orderIndex": 1,
  "createdAt": "2026-01-20T00:00:00Z"
}
```

---

### DELETE /line-items/{id}/notes/{noteId}
노트 삭제

**Response (204):**
No Content

---

## 📄 Estimates API

### GET /estimates
견적서 목록 조회

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| skip | int | ✗ | 건너뛸 개수 |
| limit | int | ✗ | 조회 개수 |
| status | string | ✗ | 상태 필터 |
| customerId | uuid | ✗ | 고객 ID 필터 |
| search | string | ✗ | 번호/고객명 검색 |
| dateFrom | date | ✗ | 시작일 |
| dateTo | date | ✗ | 종료일 |

**Response (200):**
```json
{
  "items": [
    {
      "id": "bb0e8400-e29b-41d4-a716-446655440000",
      "estimateNumber": "EST-1001",
      "status": "approved",
      "estimateDate": "2026-01-15",
      "validUntil": "2026-02-14",
      "customerId": "770e8400-e29b-41d4-a716-446655440000",
      "customerName": "ABC Company",
      "customerEmail": "jane@abc.com",
      "title": "Water Damage Restoration",
      "subtotal": 5000.00,
      "taxableSubtotal": 4500.00,
      "taxRate": 8.25,
      "taxLabel": "Sales Tax",
      "taxAmount": 371.25,
      "total": 5371.25,
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 100
}
```

---

### POST /estimates
견적서 생성 ⭐ **사용량 제한 (Free: 3개/월)**

**Request Body:**
```json
{
  "customerId": "770e8400-e29b-41d4-a716-446655440000",
  "estimateDate": "2026-01-15",
  "validUntil": "2026-02-14",
  "title": "Water Damage Restoration",
  "description": "Restoration work for basement flooding",
  "taxRate": 8.25,
  "taxLabel": "Sales Tax",
  "notes": "Payment due upon completion",
  "terms": "Standard terms and conditions apply",
  "items": [
    {
      "lineItemId": "880e8400-e29b-41d4-a716-446655440000",
      "name": "Water Extraction - Carpet",
      "description": "Living room and basement",
      "unit": "SF",
      "quantity": 1500,
      "unitPrice": 2.50,
      "isTaxable": true,
      "orderIndex": 0
    },
    {
      "name": "Emergency Service Fee",
      "unit": "EA",
      "quantity": 1,
      "unitPrice": 500.00,
      "isTaxable": false,
      "orderIndex": 1
    }
  ]
}
```

**Response (201):**
```json
{
  "id": "bb0e8400-e29b-41d4-a716-446655440000",
  "estimateNumber": "EST-1001",
  "status": "draft",
  "estimateDate": "2026-01-15",
  "validUntil": "2026-02-14",
  "customerId": "770e8400-e29b-41d4-a716-446655440000",
  "customerName": "ABC Company",
  "customerEmail": "jane@abc.com",
  "customerAddress": "123 Main St, New York, NY 10001",
  "title": "Water Damage Restoration",
  "description": "Restoration work for basement flooding",
  "subtotal": 4250.00,
  "taxableSubtotal": 3750.00,
  "taxRate": 8.25,
  "taxLabel": "Sales Tax",
  "taxAmount": 309.38,
  "discountAmount": 0,
  "total": 4559.38,
  "notes": "Payment due upon completion",
  "terms": "Standard terms and conditions apply",
  "items": [
    {
      "id": "cc0e8400-e29b-41d4-a716-446655440000",
      "lineItemId": "880e8400-e29b-41d4-a716-446655440000",
      "name": "Water Extraction - Carpet",
      "description": "Living room and basement",
      "unit": "SF",
      "quantity": 1500,
      "unitPrice": 2.50,
      "total": 3750.00,
      "isTaxable": true,
      "orderIndex": 0
    },
    {
      "id": "dd0e8400-e29b-41d4-a716-446655440000",
      "name": "Emergency Service Fee",
      "unit": "EA",
      "quantity": 1,
      "unitPrice": 500.00,
      "total": 500.00,
      "isTaxable": false,
      "orderIndex": 1
    }
  ],
  "createdBy": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-01-15T10:00:00Z"
}
```

---

### GET /estimates/{id}
견적서 상세 조회

**Response (200):**
견적서 생성 응답과 동일한 구조

---

### PUT /estimates/{id}
견적서 수정

**Request Body:**
견적서 생성과 동일한 구조 (부분 업데이트 가능)

**Response (200):**
견적서 상세 응답과 동일

---

### DELETE /estimates/{id}
견적서 삭제

**Response (204):**
No Content

---

### POST /estimates/{id}/send
견적서 이메일 발송 ⭐ **Pro 기능**

**Request Body:**
```json
{
  "to": "customer@example.com",
  "subject": "Estimate EST-1001 from ABC Restoration",
  "message": "Please find attached your estimate for the water damage restoration work."
}
```

**Response (200):**
```json
{
  "message": "Estimate sent successfully",
  "sentAt": "2026-01-15T10:30:00Z"
}
```

---

### POST /estimates/{id}/convert
견적서 → 인보이스 변환 ⭐ **Pro 기능**

**Request Body (선택):**
```json
{
  "invoiceDate": "2026-01-20",
  "dueDate": "2026-02-20"
}
```

**Response (201):**
```json
{
  "id": "ee0e8400-e29b-41d4-a716-446655440000",
  "invoiceNumber": "INV-1001",
  "status": "draft",
  "estimateId": "bb0e8400-e29b-41d4-a716-446655440000",
  "...": "... 인보이스 상세 정보"
}
```

---

### GET /estimates/{id}/pdf
견적서 PDF 다운로드

**Response (200):**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="EST-1001.pdf"

[PDF Binary]
```

---

## 💵 Invoices API

### GET /invoices
인보이스 목록 조회

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| skip | int | ✗ | 건너뛸 개수 |
| limit | int | ✗ | 조회 개수 |
| status | string | ✗ | 상태 필터 |
| customerId | uuid | ✗ | 고객 ID 필터 |
| overdue | bool | ✗ | 연체만 |

**Response (200):**
```json
{
  "items": [
    {
      "id": "ee0e8400-e29b-41d4-a716-446655440000",
      "invoiceNumber": "INV-1001",
      "status": "sent",
      "invoiceDate": "2026-01-20",
      "dueDate": "2026-02-20",
      "customerId": "770e8400-e29b-41d4-a716-446655440000",
      "customerName": "ABC Company",
      "subtotal": 4250.00,
      "taxAmount": 309.38,
      "total": 4559.38,
      "amountPaid": 0,
      "balanceDue": 4559.38,
      "createdAt": "2026-01-20T10:00:00Z"
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 100
}
```

---

### POST /invoices
인보이스 생성 ⭐ **사용량 제한 (Free: 3개/월)**

**Request Body:**
```json
{
  "customerId": "770e8400-e29b-41d4-a716-446655440000",
  "invoiceDate": "2026-01-20",
  "dueDate": "2026-02-20",
  "title": "Water Damage Restoration",
  "taxRate": 8.25,
  "notes": "Thank you for your business",
  "items": [
    {
      "name": "Water Extraction - Carpet",
      "unit": "SF",
      "quantity": 1500,
      "unitPrice": 2.50,
      "isTaxable": true
    }
  ]
}
```

**Response (201):**
인보이스 상세 응답

---

### GET /invoices/{id}
인보이스 상세 조회

**Response (200):**
```json
{
  "id": "ee0e8400-e29b-41d4-a716-446655440000",
  "invoiceNumber": "INV-1001",
  "status": "sent",
  "invoiceDate": "2026-01-20",
  "dueDate": "2026-02-20",
  "customerId": "770e8400-e29b-41d4-a716-446655440000",
  "customerName": "ABC Company",
  "customerEmail": "jane@abc.com",
  "customerAddress": "123 Main St, New York, NY 10001",
  "estimateId": "bb0e8400-e29b-41d4-a716-446655440000",
  "title": "Water Damage Restoration",
  "subtotal": 4250.00,
  "taxableSubtotal": 3750.00,
  "taxRate": 8.25,
  "taxLabel": "Sales Tax",
  "taxAmount": 309.38,
  "total": 4559.38,
  "amountPaid": 1000.00,
  "balanceDue": 3559.38,
  "items": [...],
  "payments": [
    {
      "id": "ff0e8400-e29b-41d4-a716-446655440000",
      "amount": 1000.00,
      "paymentMethod": "check",
      "paymentDate": "2026-01-25",
      "referenceNumber": "CHK-12345",
      "createdAt": "2026-01-25T14:00:00Z"
    }
  ],
  "createdAt": "2026-01-20T10:00:00Z"
}
```

---

### PUT /invoices/{id}
인보이스 수정

**Response (200):**
인보이스 상세 응답

---

### DELETE /invoices/{id}
인보이스 삭제

**Response (204):**
No Content

---

### POST /invoices/{id}/send
인보이스 이메일 발송 ⭐ **Pro 기능**

**Request Body:**
```json
{
  "to": "customer@example.com",
  "subject": "Invoice INV-1001 from ABC Restoration",
  "message": "Please find attached your invoice."
}
```

**Response (200):**
```json
{
  "message": "Invoice sent successfully",
  "sentAt": "2026-01-20T10:30:00Z"
}
```

---

### POST /invoices/{id}/record-payment
결제 기록

**Request Body:**
```json
{
  "amount": 1000.00,
  "paymentMethod": "check",
  "paymentDate": "2026-01-25",
  "referenceNumber": "CHK-12345",
  "notes": "Partial payment"
}
```

**Response (201):**
```json
{
  "id": "ff0e8400-e29b-41d4-a716-446655440000",
  "amount": 1000.00,
  "paymentMethod": "check",
  "paymentDate": "2026-01-25",
  "referenceNumber": "CHK-12345",
  "notes": "Partial payment",
  "createdAt": "2026-01-25T14:00:00Z"
}
```

---

### GET /invoices/{id}/pdf
인보이스 PDF 다운로드

**Response (200):**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="INV-1001.pdf"

[PDF Binary]
```

---

## 💳 Subscription API

### GET /subscription/plans
플랜 목록 조회

**Response (200):**
```json
[
  {
    "id": "100e8400-e29b-41d4-a716-446655440000",
    "name": "free",
    "displayName": "Free",
    "priceMonthly": 0,
    "priceYearly": 0,
    "maxEstimatesPerMonth": 3,
    "maxInvoicesPerMonth": 3,
    "canSaveLineItems": false,
    "canSaveCustomers": false,
    "canConvertEstimate": false,
    "canSendEmail": false,
    "canExportPdf": true
  },
  {
    "id": "200e8400-e29b-41d4-a716-446655440000",
    "name": "pro",
    "displayName": "Pro",
    "priceMonthly": 29,
    "priceYearly": 290,
    "maxEstimatesPerMonth": null,
    "maxInvoicesPerMonth": null,
    "canSaveLineItems": true,
    "canSaveCustomers": true,
    "canConvertEstimate": true,
    "canSendEmail": true,
    "canExportPdf": true
  }
]
```

---

### GET /subscription/me
내 구독 정보

**Response (200):**
```json
{
  "id": "300e8400-e29b-41d4-a716-446655440000",
  "planId": "100e8400-e29b-41d4-a716-446655440000",
  "plan": {
    "name": "free",
    "displayName": "Free",
    "...": "..."
  },
  "status": "active",
  "isBetaUser": true,
  "betaExpiresAt": "2026-06-30T00:00:00Z",
  "currentPeriodStart": "2026-01-01T00:00:00Z",
  "currentPeriodEnd": "2026-02-01T00:00:00Z",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### GET /subscription/usage
이번 달 사용량

**Response (200):**
```json
{
  "periodStart": "2026-01-01",
  "periodEnd": "2026-01-31",
  "estimates": {
    "used": 2,
    "limit": 3,
    "remaining": 1,
    "unlimited": false
  },
  "invoices": {
    "used": 1,
    "limit": 3,
    "remaining": 2,
    "unlimited": false
  },
  "isBetaUser": true
}
```

---

### POST /subscription/checkout
Stripe 결제 시작 ⭐ **Phase 2**

**Request Body:**
```json
{
  "planId": "200e8400-e29b-41d4-a716-446655440000",
  "billingPeriod": "monthly"
}
```

**Response (200):**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/pay/cs_xxx",
  "sessionId": "cs_xxx"
}
```

---

### POST /subscription/webhook
Stripe 웹훅 ⭐ **Phase 2**

Stripe에서 호출하는 웹훅 엔드포인트

---

### POST /subscription/cancel
구독 취소 ⭐ **Phase 2**

**Response (200):**
```json
{
  "message": "Subscription will be canceled at period end",
  "cancelAt": "2026-02-01T00:00:00Z"
}
```

---

## 🏢 Company API

### GET /company
내 회사 정보

**Response (200):**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "ABC Restoration",
  "legalName": "ABC Restoration LLC",
  "email": "info@abcrestoration.com",
  "phone": "555-0100",
  "website": "https://abcrestoration.com",
  "addressLine1": "456 Business Ave",
  "city": "New York",
  "state": "NY",
  "zipcode": "10002",
  "logoUrl": "https://storage.scopit.work/logos/abc.png",
  "defaultTaxRate": 8.25,
  "defaultTaxLabel": "Sales Tax",
  "estimatePrefix": "EST",
  "invoicePrefix": "INV",
  "nextEstimateNumber": 1005,
  "nextInvoiceNumber": 1003,
  "defaultEstimateValidityDays": 30,
  "defaultInvoiceDueDays": 30,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### PUT /company
회사 정보 수정

**Request Body:**
```json
{
  "name": "ABC Restoration Updated",
  "defaultTaxRate": 8.5,
  "defaultInvoiceDueDays": 15
}
```

**Response (200):**
회사 상세 응답과 동일

---

### POST /company/logo
로고 업로드

**Request:**
```
Content-Type: multipart/form-data

file: [image file]
```

**Response (200):**
```json
{
  "logoUrl": "https://storage.scopit.work/logos/abc-new.png"
}
```

---

## 🔗 관련 문서

- [BACKEND.md](./BACKEND.md) - 백엔드 구현 상세
- [FRONTEND.md](./FRONTEND.md) - 프론트엔드 가이드
- [INTEGRATIONS.md](./INTEGRATIONS.md) - 외부 API 연동

---

*Last Updated: 2026-01-26*
