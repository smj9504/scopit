# Scopit - 외부 API 연동 가이드

> Stripe, Email, Storage, CompanyCam 등 외부 서비스 연동

---

## 📌 연동 서비스 개요

| 서비스 | 용도 | Phase | 필수 |
|--------|------|-------|------|
| **Stripe** | 결제 처리 | Phase 2 | ✓ (유료화 시) |
| **SendGrid / AWS SES** | 이메일 발송 | Phase 2 | ✓ |
| **AWS S3 / GCS** | 파일 저장 | Phase 2 | ✗ |
| **CompanyCam** | 사진 연동 | Phase 3 | ✗ |
| **Zapier** | 자동화 연동 | Phase 3 | ✗ |

---

## 💳 Stripe 연동

### 개요

Stripe를 사용한 구독 결제 처리

```
┌──────────────────────────────────────────────────────────────┐
│                      결제 플로우                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 사용자가 "Upgrade to Pro" 클릭                           │
│     │                                                        │
│     ▼                                                        │
│  ┌─────────────┐      ┌─────────────┐                       │
│  │  Frontend   │ ───▶ │   Backend   │                       │
│  │             │ POST │ /checkout   │                       │
│  └─────────────┘      └──────┬──────┘                       │
│                              │                               │
│  2. Checkout Session 생성    │                               │
│                              ▼                               │
│                       ┌─────────────┐                       │
│                       │   Stripe    │                       │
│                       │     API     │                       │
│                       └──────┬──────┘                       │
│                              │                               │
│  3. Checkout URL 반환        │                               │
│     │                        │                               │
│     ▼                        │                               │
│  ┌─────────────┐             │                               │
│  │  Frontend   │ ◀───────────┘                               │
│  │  Redirect   │                                             │
│  └──────┬──────┘                                             │
│         │                                                    │
│  4. Stripe Checkout 페이지                                   │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐  │
│  │   Stripe    │ ───▶ │   Webhook   │ ───▶ │   Backend   │  │
│  │  Checkout   │      │  (payment   │      │  Update DB  │  │
│  │             │      │  success)   │      │             │  │
│  └─────────────┘      └─────────────┘      └─────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 환경 설정

```bash
# backend/.env.production

STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxxxxxxxxxxxx
STRIPE_PRICE_ID_PRO_YEARLY=price_xxxxxxxxxxxxx
```

### Stripe 초기 설정

```python
# backend/app/integrations/stripe_client.py

import stripe
from app.core.config import settings

# Stripe 초기화
stripe.api_key = settings.STRIPE_SECRET_KEY


class StripeClient:
    """Stripe API 클라이언트"""
    
    @staticmethod
    def create_customer(email: str, name: str, company_id: str) -> str:
        """Stripe Customer 생성"""
        customer = stripe.Customer.create(
            email=email,
            name=name,
            metadata={
                "company_id": company_id
            }
        )
        return customer.id
    
    @staticmethod
    def create_checkout_session(
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str
    ) -> dict:
        """Checkout Session 생성"""
        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{
                "price": price_id,
                "quantity": 1
            }],
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
        )
        return {
            "session_id": session.id,
            "checkout_url": session.url
        }
    
    @staticmethod
    def create_portal_session(customer_id: str, return_url: str) -> str:
        """Customer Portal Session 생성 (구독 관리)"""
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url
        )
        return session.url
    
    @staticmethod
    def cancel_subscription(subscription_id: str) -> dict:
        """구독 취소 (기간 종료 시)"""
        subscription = stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=True
        )
        return {
            "status": subscription.status,
            "cancel_at": subscription.cancel_at
        }
    
    @staticmethod
    def verify_webhook(payload: bytes, signature: str) -> dict:
        """웹훅 서명 검증"""
        event = stripe.Webhook.construct_event(
            payload,
            signature,
            settings.STRIPE_WEBHOOK_SECRET
        )
        return event
```

### Webhook 처리

```python
# backend/app/domains/subscription/webhook_handler.py

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy.orm import Session

from app.integrations.stripe_client import StripeClient
from app.domains.subscription.repository import SubscriptionRepository

router = APIRouter()


@router.post("/subscription/webhook")
async def stripe_webhook(request: Request, db: Session):
    """Stripe 웹훅 처리"""
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    
    try:
        event = StripeClient.verify_webhook(payload, signature)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    repo = SubscriptionRepository(db)
    
    # 이벤트 타입별 처리
    if event["type"] == "checkout.session.completed":
        # 결제 완료 → 구독 활성화
        session = event["data"]["object"]
        await handle_checkout_completed(session, repo)
    
    elif event["type"] == "invoice.paid":
        # 정기 결제 성공
        invoice = event["data"]["object"]
        await handle_invoice_paid(invoice, repo)
    
    elif event["type"] == "invoice.payment_failed":
        # 결제 실패
        invoice = event["data"]["object"]
        await handle_payment_failed(invoice, repo)
    
    elif event["type"] == "customer.subscription.deleted":
        # 구독 취소됨
        subscription = event["data"]["object"]
        await handle_subscription_deleted(subscription, repo)
    
    return {"status": "success"}


async def handle_checkout_completed(session: dict, repo: SubscriptionRepository):
    """결제 완료 처리"""
    customer_id = session["customer"]
    subscription_id = session["subscription"]
    
    # DB에서 company_id 찾기
    subscription = repo.get_by_stripe_customer_id(customer_id)
    if subscription:
        repo.update(subscription.id, {
            "stripe_subscription_id": subscription_id,
            "status": "active",
            "plan_id": get_pro_plan_id()  # Pro 플랜으로 변경
        })


async def handle_invoice_paid(invoice: dict, repo: SubscriptionRepository):
    """정기 결제 성공 처리"""
    subscription_id = invoice["subscription"]
    subscription = repo.get_by_stripe_subscription_id(subscription_id)
    
    if subscription:
        # 기간 업데이트
        repo.update(subscription.id, {
            "status": "active",
            "current_period_start": invoice["period_start"],
            "current_period_end": invoice["period_end"]
        })


async def handle_payment_failed(invoice: dict, repo: SubscriptionRepository):
    """결제 실패 처리"""
    subscription_id = invoice["subscription"]
    subscription = repo.get_by_stripe_subscription_id(subscription_id)
    
    if subscription:
        repo.update(subscription.id, {
            "status": "past_due"
        })
        # TODO: 이메일 알림


async def handle_subscription_deleted(stripe_sub: dict, repo: SubscriptionRepository):
    """구독 취소 처리"""
    subscription_id = stripe_sub["id"]
    subscription = repo.get_by_stripe_subscription_id(subscription_id)
    
    if subscription:
        repo.update(subscription.id, {
            "status": "canceled",
            "plan_id": get_free_plan_id()  # Free로 다운그레이드
        })
```

### Checkout API

```python
# backend/app/domains/subscription/api.py

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.integrations.stripe_client import StripeClient
from app.domains.subscription.repository import SubscriptionRepository

router = APIRouter(prefix="/subscription", tags=["Subscription"])


@router.post("/checkout")
async def create_checkout(
    billing_period: str = "monthly",  # monthly, yearly
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Stripe Checkout Session 생성"""
    
    repo = SubscriptionRepository(db)
    subscription = repo.get_by_company_id(current_user.company_id)
    
    # Stripe Customer 생성 (없으면)
    if not subscription.stripe_customer_id:
        customer_id = StripeClient.create_customer(
            email=current_user.email,
            name=current_user.full_name,
            company_id=str(current_user.company_id)
        )
        repo.update(subscription.id, {"stripe_customer_id": customer_id})
    else:
        customer_id = subscription.stripe_customer_id
    
    # Price ID 선택
    price_id = (
        settings.STRIPE_PRICE_ID_PRO_YEARLY 
        if billing_period == "yearly" 
        else settings.STRIPE_PRICE_ID_PRO_MONTHLY
    )
    
    # Checkout Session 생성
    result = StripeClient.create_checkout_session(
        customer_id=customer_id,
        price_id=price_id,
        success_url=f"{settings.FRONTEND_URL}/app/settings/billing?success=true",
        cancel_url=f"{settings.FRONTEND_URL}/app/settings/billing?canceled=true"
    )
    
    return result


@router.post("/portal")
async def create_portal_session(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Customer Portal Session 생성 (구독 관리)"""
    
    repo = SubscriptionRepository(db)
    subscription = repo.get_by_company_id(current_user.company_id)
    
    if not subscription.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No subscription found")
    
    portal_url = StripeClient.create_portal_session(
        customer_id=subscription.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/app/settings/billing"
    )
    
    return {"portal_url": portal_url}
```

### Frontend 연동

```typescript
// frontend/src/services/subscriptionService.ts

import api from './api';

export const subscriptionService = {
  // Checkout Session 생성
  createCheckout: async (billingPeriod: 'monthly' | 'yearly') => {
    const response = await api.post('/subscription/checkout', {
      billing_period: billingPeriod
    });
    return response.data;
  },
  
  // Checkout 페이지로 리다이렉트
  redirectToCheckout: async (billingPeriod: 'monthly' | 'yearly') => {
    const { checkout_url } = await subscriptionService.createCheckout(billingPeriod);
    window.location.href = checkout_url;
  },
  
  // Customer Portal 열기
  openPortal: async () => {
    const response = await api.post('/subscription/portal');
    window.location.href = response.data.portal_url;
  }
};
```

---

## 📧 이메일 연동 (SendGrid)

### 환경 설정

```bash
# backend/.env.production

EMAIL_PROVIDER=sendgrid  # sendgrid, ses, smtp
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
EMAIL_FROM=noreply@scopit.work
EMAIL_FROM_NAME=Scopit
```

### 이메일 서비스

```python
# backend/app/integrations/email_client.py

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Attachment, FileContent, FileName, FileType, Disposition
import base64
from typing import Optional, List

from app.core.config import settings


class EmailClient:
    """이메일 발송 클라이언트"""
    
    def __init__(self):
        self.client = SendGridAPIClient(settings.SENDGRID_API_KEY)
        self.from_email = settings.EMAIL_FROM
        self.from_name = settings.EMAIL_FROM_NAME
    
    def send(
        self,
        to: str,
        subject: str,
        html_content: str,
        attachments: Optional[List[dict]] = None
    ) -> bool:
        """이메일 발송"""
        
        message = Mail(
            from_email=(self.from_email, self.from_name),
            to_emails=to,
            subject=subject,
            html_content=html_content
        )
        
        # 첨부파일 추가
        if attachments:
            for att in attachments:
                attachment = Attachment(
                    FileContent(base64.b64encode(att["content"]).decode()),
                    FileName(att["filename"]),
                    FileType(att["content_type"]),
                    Disposition("attachment")
                )
                message.attachment = attachment
        
        try:
            response = self.client.send(message)
            return response.status_code in [200, 201, 202]
        except Exception as e:
            print(f"Email send error: {e}")
            return False


# 싱글톤 인스턴스
email_client = EmailClient()
```

### 이메일 템플릿

```python
# backend/app/integrations/email_templates.py

from jinja2 import Environment, FileSystemLoader
import os

# 템플릿 로더
template_dir = os.path.join(os.path.dirname(__file__), "../templates/email")
env = Environment(loader=FileSystemLoader(template_dir))


def render_estimate_email(estimate: dict, message: str) -> str:
    """견적서 이메일 템플릿"""
    template = env.get_template("estimate.html")
    return template.render(
        estimate=estimate,
        message=message,
        company_name=estimate["company_name"],
        estimate_number=estimate["estimate_number"],
        total=estimate["total"]
    )


def render_invoice_email(invoice: dict, message: str) -> str:
    """인보이스 이메일 템플릿"""
    template = env.get_template("invoice.html")
    return template.render(
        invoice=invoice,
        message=message,
        company_name=invoice["company_name"],
        invoice_number=invoice["invoice_number"],
        total=invoice["total"],
        due_date=invoice["due_date"]
    )


def render_password_reset_email(reset_url: str) -> str:
    """비밀번호 재설정 이메일"""
    template = env.get_template("password_reset.html")
    return template.render(reset_url=reset_url)
```

### 이메일 템플릿 HTML

```html
<!-- backend/app/templates/email/estimate.html -->

<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #111827;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 1px solid #e5e7eb;
        }
        .content {
            padding: 30px 0;
        }
        .estimate-info {
            background: #f9fafb;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .total {
            font-size: 24px;
            font-weight: bold;
            color: #111827;
        }
        .button {
            display: inline-block;
            background: #111827;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            padding: 20px 0;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>{{ company_name }}</h2>
    </div>
    
    <div class="content">
        <p>{{ message }}</p>
        
        <div class="estimate-info">
            <p><strong>Estimate #:</strong> {{ estimate_number }}</p>
            <p><strong>Amount:</strong> <span class="total">${{ "%.2f"|format(total) }}</span></p>
        </div>
        
        <p>Please find the estimate attached to this email.</p>
        
        <a href="{{ view_url }}" class="button">View Estimate</a>
    </div>
    
    <div class="footer">
        <p>Sent via Scopit</p>
    </div>
</body>
</html>
```

### 견적서/인보이스 발송 구현

```python
# backend/app/domains/estimate/service.py

from app.integrations.email_client import email_client
from app.integrations.email_templates import render_estimate_email
from app.domains.estimate.pdf_generator import generate_estimate_pdf


class EstimateService:
    # ... 기존 코드 ...
    
    async def send_email(
        self,
        estimate_id: str,
        to: str,
        subject: str,
        message: str,
        current_user
    ) -> bool:
        """견적서 이메일 발송"""
        
        # 견적서 조회
        estimate = self.get_by_id(estimate_id, current_user)
        
        # PDF 생성
        pdf_content = generate_estimate_pdf(estimate)
        
        # 이메일 렌더링
        html_content = render_estimate_email(
            estimate=estimate.to_dict(),
            message=message
        )
        
        # 발송
        success = email_client.send(
            to=to,
            subject=subject,
            html_content=html_content,
            attachments=[{
                "content": pdf_content,
                "filename": f"{estimate.estimate_number}.pdf",
                "content_type": "application/pdf"
            }]
        )
        
        if success:
            # 상태 업데이트
            self.repo.update(estimate_id, {
                "status": "sent",
                "sent_at": datetime.utcnow()
            })
        
        return success
```

---

## 📁 파일 저장소 (AWS S3)

### 환경 설정

```bash
# backend/.env.production

STORAGE_PROVIDER=s3  # local, s3, gcs
AWS_S3_BUCKET=scopit-files
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

### S3 클라이언트

```python
# backend/app/integrations/storage_client.py

import boto3
from botocore.exceptions import ClientError
from typing import Optional
import uuid
from datetime import datetime

from app.core.config import settings


class StorageClient:
    """파일 저장소 클라이언트"""
    
    def __init__(self):
        if settings.STORAGE_PROVIDER == "s3":
            self.s3 = boto3.client(
                "s3",
                region_name=settings.AWS_S3_REGION,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY
            )
            self.bucket = settings.AWS_S3_BUCKET
        else:
            self.s3 = None
            self.bucket = None
    
    def upload_file(
        self,
        file_content: bytes,
        filename: str,
        content_type: str,
        folder: str = "uploads"
    ) -> str:
        """파일 업로드"""
        
        # 고유 파일명 생성
        ext = filename.split(".")[-1] if "." in filename else ""
        unique_name = f"{uuid.uuid4()}.{ext}" if ext else str(uuid.uuid4())
        key = f"{folder}/{datetime.utcnow().strftime('%Y/%m')}/{unique_name}"
        
        if settings.STORAGE_PROVIDER == "s3":
            self.s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=file_content,
                ContentType=content_type
            )
            return f"https://{self.bucket}.s3.amazonaws.com/{key}"
        else:
            # 로컬 저장
            import os
            local_path = os.path.join(settings.STORAGE_BASE_DIR, key)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(file_content)
            return f"/uploads/{key}"
    
    def delete_file(self, url: str) -> bool:
        """파일 삭제"""
        if settings.STORAGE_PROVIDER == "s3":
            key = url.split(f"{self.bucket}.s3.amazonaws.com/")[-1]
            try:
                self.s3.delete_object(Bucket=self.bucket, Key=key)
                return True
            except ClientError:
                return False
        else:
            import os
            local_path = url.replace("/uploads/", f"{settings.STORAGE_BASE_DIR}/")
            if os.path.exists(local_path):
                os.remove(local_path)
                return True
            return False
    
    def get_presigned_url(self, url: str, expires_in: int = 3600) -> str:
        """임시 다운로드 URL 생성"""
        if settings.STORAGE_PROVIDER == "s3":
            key = url.split(f"{self.bucket}.s3.amazonaws.com/")[-1]
            return self.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_in
            )
        return url


# 싱글톤
storage_client = StorageClient()
```

### 로고 업로드 API

```python
# backend/app/domains/company/api.py

from fastapi import APIRouter, UploadFile, File, Depends
from app.integrations.storage_client import storage_client


@router.post("/company/logo")
async def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """회사 로고 업로드"""
    
    # 파일 검증
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    if file.size > 5 * 1024 * 1024:  # 5MB
        raise HTTPException(status_code=400, detail="File too large")
    
    # 업로드
    content = await file.read()
    url = storage_client.upload_file(
        file_content=content,
        filename=file.filename,
        content_type=file.content_type,
        folder=f"logos/{current_user.company_id}"
    )
    
    # DB 업데이트
    company_repo = CompanyRepository(db)
    company_repo.update(current_user.company_id, {"logo_url": url})
    
    return {"logo_url": url}
```

---

## 📷 CompanyCam 연동 (Phase 3)

### 개요

CompanyCam API를 통해 프로젝트 사진 연동

```
┌─────────────────────────────────────────────────────────────┐
│                   CompanyCam 연동 플로우                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. OAuth 인증                                               │
│     ┌─────────┐      ┌─────────────┐      ┌─────────────┐   │
│     │ Scopit │ ───▶ │ CompanyCam  │ ───▶ │   사용자    │   │
│     │         │      │   OAuth     │      │   인증      │   │
│     └─────────┘      └─────────────┘      └─────────────┘   │
│                                                              │
│  2. 프로젝트 연결                                            │
│     ┌─────────┐      ┌─────────────┐                        │
│     │ Scopit │ ◀──▶ │ CompanyCam  │                        │
│     │ Estimate│      │  Projects   │                        │
│     └─────────┘      └─────────────┘                        │
│                                                              │
│  3. 사진 불러오기                                            │
│     ┌─────────┐      ┌─────────────┐                        │
│     │ Scopit │ ◀─── │ CompanyCam  │                        │
│     │  PDF    │      │   Photos    │                        │
│     └─────────┘      └─────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 환경 설정

```bash
# backend/.env.production

COMPANYCAM_CLIENT_ID=xxx
COMPANYCAM_CLIENT_SECRET=xxx
COMPANYCAM_REDIRECT_URI=https://api.scopit.work/api/integrations/companycam/callback
```

### CompanyCam 클라이언트

```python
# backend/app/integrations/companycam_client.py

import httpx
from typing import Optional, List
from app.core.config import settings


class CompanyCamClient:
    """CompanyCam API 클라이언트"""
    
    BASE_URL = "https://api.companycam.com/v2"
    
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
    
    async def get_projects(self, page: int = 1, per_page: int = 50) -> dict:
        """프로젝트 목록 조회"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/projects",
                headers=self.headers,
                params={"page": page, "per_page": per_page}
            )
            response.raise_for_status()
            return response.json()
    
    async def get_project_photos(
        self, 
        project_id: str,
        page: int = 1,
        per_page: int = 50
    ) -> List[dict]:
        """프로젝트 사진 조회"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/projects/{project_id}/photos",
                headers=self.headers,
                params={"page": page, "per_page": per_page}
            )
            response.raise_for_status()
            return response.json()
    
    async def get_photo(self, photo_id: str) -> dict:
        """사진 상세 조회"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/photos/{photo_id}",
                headers=self.headers
            )
            response.raise_for_status()
            return response.json()
    
    @staticmethod
    def get_oauth_url(state: str) -> str:
        """OAuth 인증 URL"""
        return (
            f"https://app.companycam.com/oauth/authorize"
            f"?client_id={settings.COMPANYCAM_CLIENT_ID}"
            f"&redirect_uri={settings.COMPANYCAM_REDIRECT_URI}"
            f"&response_type=code"
            f"&state={state}"
        )
    
    @staticmethod
    async def exchange_code(code: str) -> dict:
        """인증 코드 → 토큰 교환"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://app.companycam.com/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.COMPANYCAM_CLIENT_ID,
                    "client_secret": settings.COMPANYCAM_CLIENT_SECRET,
                    "redirect_uri": settings.COMPANYCAM_REDIRECT_URI
                }
            )
            response.raise_for_status()
            return response.json()
```

### CompanyCam 연동 API

```python
# backend/app/domains/integration/api.py

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/integrations", tags=["Integrations"])


@router.get("/companycam/connect")
async def companycam_connect(current_user = Depends(get_current_user)):
    """CompanyCam OAuth 시작"""
    state = generate_state_token(current_user.company_id)
    oauth_url = CompanyCamClient.get_oauth_url(state)
    return {"oauth_url": oauth_url}


@router.get("/companycam/callback")
async def companycam_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db)
):
    """CompanyCam OAuth 콜백"""
    # State 검증
    company_id = verify_state_token(state)
    if not company_id:
        return RedirectResponse(url="/app/settings/integrations?error=invalid_state")
    
    # 토큰 교환
    tokens = await CompanyCamClient.exchange_code(code)
    
    # 토큰 저장
    integration_repo = IntegrationRepository(db)
    integration_repo.save_companycam_tokens(
        company_id=company_id,
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"]
    )
    
    return RedirectResponse(url="/app/settings/integrations?success=companycam")


@router.get("/companycam/projects")
async def get_companycam_projects(
    page: int = 1,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """CompanyCam 프로젝트 목록"""
    integration = get_companycam_integration(current_user.company_id, db)
    if not integration:
        raise HTTPException(status_code=400, detail="CompanyCam not connected")
    
    client = CompanyCamClient(integration.access_token)
    return await client.get_projects(page=page)


@router.get("/companycam/projects/{project_id}/photos")
async def get_project_photos(
    project_id: str,
    page: int = 1,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """프로젝트 사진 목록"""
    integration = get_companycam_integration(current_user.company_id, db)
    client = CompanyCamClient(integration.access_token)
    return await client.get_project_photos(project_id, page=page)
```

---

## 🔌 Zapier 연동 (Phase 3)

### Webhook 트리거

```python
# backend/app/integrations/zapier_webhook.py

import httpx
from typing import Optional
from app.domains.integration.repository import IntegrationRepository


async def trigger_zapier_webhook(
    company_id: str,
    event_type: str,
    payload: dict,
    db
):
    """Zapier 웹훅 트리거"""
    repo = IntegrationRepository(db)
    webhook_url = repo.get_zapier_webhook_url(company_id, event_type)
    
    if not webhook_url:
        return
    
    async with httpx.AsyncClient() as client:
        try:
            await client.post(webhook_url, json=payload, timeout=5.0)
        except Exception as e:
            print(f"Zapier webhook failed: {e}")


# 사용 예시
async def on_estimate_approved(estimate, db):
    await trigger_zapier_webhook(
        company_id=estimate.company_id,
        event_type="estimate.approved",
        payload={
            "estimate_id": str(estimate.id),
            "estimate_number": estimate.estimate_number,
            "customer_name": estimate.customer_name,
            "total": float(estimate.total),
            "approved_at": estimate.approved_at.isoformat()
        },
        db=db
    )
```

---

## 📊 연동 상태 관리

### Integration 모델

```python
# backend/app/domains/integration/models.py

from sqlalchemy import Column, String, Text, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB

from app.core.database import Base


class Integration(Base):
    __tablename__ = "integrations"
    
    id = Column(UUID(as_uuid=True), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    
    provider = Column(String(50), nullable=False)  # stripe, companycam, zapier
    
    # OAuth Tokens
    access_token = Column(Text)
    refresh_token = Column(Text)
    token_expires_at = Column(TIMESTAMP(timezone=True))
    
    # Config
    config = Column(JSONB, default={})
    
    # Status
    is_active = Column(Boolean, default=True)
    
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
```

---

## 🔗 관련 문서

- [BACKEND.md](./BACKEND.md) - 백엔드 구현 상세
- [API.md](./API.md) - API 명세
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) - 인프라 가이드

---

*Last Updated: 2026-01-26*
