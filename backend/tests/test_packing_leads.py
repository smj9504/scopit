"""
Tests for the anonymous "packing estimate" lead capture flow, gated
behind signup:
    submit -> verify-email -> [background AI analysis] -> status -> claim

Runs against the project's live database via FastAPI's TestClient.
PackingLead uses Postgres-native UUID/JSONB columns (like every other
model in this codebase), so an in-memory SQLite substitute isn't viable
here -- each test creates and tears down its own company/user/lead rows
so it never leaves garbage behind in the shared dev DB.

Email sending and Claude Vision calls are mocked; nothing here makes a
real network call.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import create_access_token, get_password_hash
from app.domains.company.models import Company
from app.domains.tools.modules.packing.lead_api import limiter as lead_limiter
from app.domains.tools.modules.packing.lead_models import PackingLead, PackingLeadStatus
from app.domains.tools.modules.packing.schemas import DetectedContentItem, RoomAnalysisResponse
from app.domains.tools.models import ToolFile, ToolSession
from app.domains.user.models import User
from main import app

# The rate limit is baked into the decorator at import time from
# settings.PACKING_LEAD_RATE_LIMIT ("5/hour"), so a single test module
# calling submit/verify/retry repeatedly would otherwise trip 429s across
# unrelated tests. Rate limiting itself isn't what's under test here.
lead_limiter.enabled = False

client = TestClient(app)


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def company_and_user(db):
    unique = uuid.uuid4().hex[:8]
    company = Company(name=f"Lead Test Co {unique}")
    db.add(company)
    db.flush()
    user = User(
        email=f"leadtest_{unique}@example.com",
        hashed_password=get_password_hash("Test1234!"),
        full_name="Lead Test User",
        company_id=company.id,
        role="admin",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(company)
    db.refresh(user)

    yield company, user

    # Teardown -- FK order matters (packing_leads/tool_files/tool_sessions
    # reference users/companies).
    db.query(PackingLead).filter(PackingLead.claimed_by_user_id == user.id).delete()
    db.query(ToolFile).filter(ToolFile.company_id == company.id).delete()
    db.query(ToolSession).filter(ToolSession.company_id == company.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.query(Company).filter(Company.id == company.id).delete()
    db.commit()


@pytest.fixture
def lead_ids(db):
    """Tracks lead ids created directly via ORM (bypassing the API) so
    they get cleaned up even though no company/user fixture owns them."""
    created: list = []
    yield created
    if created:
        db.query(PackingLead).filter(PackingLead.id.in_(created)).delete(synchronize_session=False)
        db.commit()


def _auth_headers(user) -> dict:
    token = create_access_token(
        user_id=str(user.id), company_id=str(user.company_id), role=user.role,
    )
    return {"Authorization": f"Bearer {token}"}


def _submit_lead(rooms=None, contact_email=None, idempotency_key=None):
    if rooms is None:
        rooms = [{"room_name": "Bedroom", "photo_count": 1}]
    payload = {
        "contact_email": contact_email or f"lead_{uuid.uuid4().hex[:10]}@example.com",
        "contact_phone": None,
        "property_address": "123 Main St, Springfield",
        "idempotency_key": idempotency_key or uuid.uuid4().hex,
        "rooms": rooms,
    }
    total_photos = sum(r["photo_count"] for r in rooms)
    files = [
        ("photos", (f"photo{i}.jpg", BytesIO(b"fake-jpeg-bytes"), "image/jpeg"))
        for i in range(total_photos)
    ]
    data = {"payload": json.dumps(payload)}
    with patch(
        "app.domains.tools.modules.packing.lead_api.email_service.send_email",
        return_value=True,
    ) as mock_send:
        resp = client.post("/api/packing-leads/submit", data=data, files=files)
    return resp, mock_send


def _fixed_code(code: str):
    return patch(
        "app.domains.tools.modules.packing.lead_api.generate_verification_code",
        return_value=code,
    )


def _fake_room_result(room_name: str, quantity: int = 1) -> RoomAnalysisResponse:
    return RoomAnalysisResponse(
        room_name=room_name,
        items=[DetectedContentItem(
            name="Queen Bed Frame", category="Furniture",
            quantity=quantity, confidence=0.95,
        )],
        low_confidence_items=[],
        density="normal",
        room_size="large",
        confidence_score=0.9,
        total_labor_hours=0.5,
        fragile_count=0,
        high_value_count=0,
        field_notes=[],
    )


async def _fake_analyze_success(room_name, images, existing_items=None, max_retries=3, base_delay=2.0):
    return _fake_room_result(room_name), None, None


def _patched_vision_success():
    return patch(
        "app.domains.tools.modules.packing.vision.analyze_room_with_retry",
        side_effect=_fake_analyze_success,
    )


def _seed_lead(db, **overrides) -> PackingLead:
    """Directly insert a PackingLead row for scenarios that need to skip
    straight to a specific state (daily cap, staleness, expiry, etc)."""
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.uuid4(),
        token=secrets_token(),
        idempotency_key=uuid.uuid4().hex,
        contact_email=f"seed_{uuid.uuid4().hex[:10]}@example.com",
        rooms_input=[],
        status=PackingLeadStatus.PENDING_VERIFICATION.value,
        verification_attempts=0,
        retry_count=0,
        expires_at=now + timedelta(hours=24),
    )
    defaults.update(overrides)
    lead = PackingLead(**defaults)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def secrets_token() -> str:
    import secrets
    return secrets.token_urlsafe(32)


# ── 1. submit() ──────────────────────────────────────────────────────────

class TestSubmit:
    def test_submit_creates_lead_and_sends_code(self, db):
        resp, mock_send = _submit_lead()
        assert resp.status_code == 201
        token = resp.json()["token"]
        assert token

        lead = db.query(PackingLead).filter(PackingLead.token == token).first()
        assert lead is not None
        assert lead.status == PackingLeadStatus.PENDING_VERIFICATION.value
        assert lead.verification_code_hash is not None
        assert mock_send.called

        db.delete(lead)
        db.commit()

    def test_duplicate_idempotency_key_returns_same_lead(self, db):
        key = uuid.uuid4().hex
        resp1, _ = _submit_lead(idempotency_key=key)
        resp2, _ = _submit_lead(idempotency_key=key)
        assert resp1.status_code == 201
        assert resp2.status_code == 201
        assert resp1.json()["token"] == resp2.json()["token"]

        matches = db.query(PackingLead).filter(PackingLead.idempotency_key == key).all()
        assert len(matches) == 1

        db.delete(matches[0])
        db.commit()


# ── 2. verify-email() ────────────────────────────────────────────────────

class TestVerifyEmail:
    def test_wrong_code_rejected_and_locks_out_after_five_attempts(self, db):
        with _fixed_code("111111"):
            resp, _ = _submit_lead()
        token = resp.json()["token"]

        for i in range(5):
            r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "999999"})
            assert r.status_code == 400, f"attempt {i}"

        r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "999999"})
        assert r.status_code == 429

        # Even the correct code is now locked out.
        r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "111111"})
        assert r.status_code == 429

        db.query(PackingLead).filter(PackingLead.token == token).delete()
        db.commit()

    def test_expired_code_rejected(self, db):
        with _fixed_code("222222"):
            resp, _ = _submit_lead()
        token = resp.json()["token"]

        lead = db.query(PackingLead).filter(PackingLead.token == token).first()
        lead.verification_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

        r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "222222"})
        assert r.status_code == 400

        db.delete(lead)
        db.commit()

    def test_success_extends_expiry_to_fourteen_days(self, db):
        with _fixed_code("333333"), _patched_vision_success():
            resp, _ = _submit_lead()
            token = resp.json()["token"]
            r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "333333"})

        assert r.status_code == 200
        assert r.json()["status"] in ("analyzing", "ready", "failed")

        db.expire_all()
        lead = db.query(PackingLead).filter(PackingLead.token == token).first()
        assert lead.verified_at is not None
        delta = lead.expires_at - lead.verified_at
        assert timedelta(days=13, hours=23) < delta <= timedelta(days=14, hours=1)

        db.delete(lead)
        db.commit()

    def test_daily_cap_under_and_at_limit(self, db, lead_ids, monkeypatch):
        monkeypatch.setattr(
            "app.domains.tools.modules.packing.lead_api.settings.PACKING_LEAD_DAILY_CAP", 1,
        )
        # Fill the only slot with a lead analyzed in the last 24h.
        filler = _seed_lead(
            db,
            status=PackingLeadStatus.ANALYZING.value,
            analysis_started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        lead_ids.append(filler.id)

        with _fixed_code("444444"):
            resp, _ = _submit_lead()
        token = resp.json()["token"]

        r = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "444444"})
        assert r.status_code == 200
        assert r.json()["status"] == "failed"
        assert "capacity" in (r.json()["error_message"] or "").lower()

        db.expire_all()
        lead = db.query(PackingLead).filter(PackingLead.token == token).first()
        lead_ids.append(lead.id)


# ── 3. status() ──────────────────────────────────────────────────────────

class TestStatus:
    def test_ready_status_never_leaks_ai_result_unauthenticated(self, db, lead_ids):
        lead = _seed_lead(
            db,
            status=PackingLeadStatus.READY.value,
            rooms_input=[{"room_name": "Bedroom", "photo_keys": []}],
            ai_result={"rooms": [{
                "room_name": "Bedroom", "status": "success",
                "result": {
                    "room_name": "Bedroom",
                    "items": [{"name": "Sofa", "category": "Furniture", "quantity": 2, "confidence": 0.9}],
                    "low_confidence_items": [], "density": "normal", "room_size": "large",
                    "confidence_score": 0.9, "field_notes": [],
                },
                "error_message": None,
            }]},
        )
        lead_ids.append(lead.id)

        r = client.get(f"/api/packing-leads/{lead.token}/status")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ready"
        assert body["requires_auth"] is True
        assert body["already_claimed"] is False
        assert "ai_result" not in body
        assert set(body["teaser"].keys()) == {"room_count", "item_count", "size_category"}
        assert body["teaser"]["room_count"] == 1
        assert body["teaser"]["item_count"] == 2

    def test_stale_analyzing_flips_to_failed(self, db, lead_ids):
        lead = _seed_lead(
            db,
            status=PackingLeadStatus.ANALYZING.value,
            analysis_started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
            ai_result=None,
        )
        lead_ids.append(lead.id)

        r = client.get(f"/api/packing-leads/{lead.token}/status")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "failed"
        assert body["can_retry"] is True
        assert "retry" in (body["error_message"] or "").lower() or "complete" in (body["error_message"] or "").lower()

        db.expire_all()
        refreshed = db.query(PackingLead).filter(PackingLead.id == lead.id).first()
        assert refreshed.status == PackingLeadStatus.FAILED.value

    def test_unverified_lead_404s_after_24h_window(self, db, lead_ids):
        lead = _seed_lead(
            db,
            status=PackingLeadStatus.PENDING_VERIFICATION.value,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        lead_ids.append(lead.id)

        r = client.get(f"/api/packing-leads/{lead.token}/status")
        assert r.status_code == 404

    def test_verified_unclaimed_lead_404s_after_14_day_window(self, db, lead_ids):
        lead = _seed_lead(
            db,
            status=PackingLeadStatus.READY.value,
            verified_at=datetime.now(timezone.utc) - timedelta(days=15),
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        lead_ids.append(lead.id)

        r = client.get(f"/api/packing-leads/{lead.token}/status")
        assert r.status_code == 404


# ── 4. retry() ───────────────────────────────────────────────────────────

class TestRetry:
    def test_retry_rejected_once_limit_reached(self, db, lead_ids):
        lead = _seed_lead(
            db, status=PackingLeadStatus.FAILED.value, retry_count=2,
        )
        lead_ids.append(lead.id)

        r = client.post(f"/api/packing-leads/{lead.token}/retry")
        assert r.status_code == 409

    def test_retry_rejected_when_not_failed(self, db, lead_ids):
        lead = _seed_lead(db, status=PackingLeadStatus.ANALYZING.value)
        lead_ids.append(lead.id)

        r = client.post(f"/api/packing-leads/{lead.token}/retry")
        assert r.status_code == 409


# ── 5. claim() ───────────────────────────────────────────────────────────

class TestClaim:
    def _seed_ready_lead_with_photo(self, db, lead_ids) -> PackingLead:
        from app.core.storage import get_storage

        storage = get_storage()
        lead_id = uuid.uuid4()
        key = f"leads/packing/{lead_id}/test.jpg"
        storage.write(key, b"fake-jpeg-bytes", content_type="image/jpeg")

        lead = _seed_lead(
            db,
            id=lead_id,
            status=PackingLeadStatus.READY.value,
            rooms_input=[{"room_name": "Bedroom", "photo_keys": [key]}],
            ai_result={"rooms": [{
                "room_name": "Bedroom", "status": "success",
                "result": {
                    "room_name": "Bedroom",
                    "items": [{"name": "Sofa", "category": "Furniture", "quantity": 1, "confidence": 0.9}],
                    "low_confidence_items": [], "density": "normal", "room_size": "large",
                    "confidence_score": 0.9, "field_notes": [],
                },
                "error_message": None,
            }]},
        )
        lead_ids.append(lead.id)
        return lead

    def test_claim_succeeds_without_tool_plan_entitlement(self, db, lead_ids, company_and_user):
        """Regression test: claiming your own already-verified lead must
        not depend on require_tool_access/ToolAccessService -- a brand-new
        free signup with zero plan entitlements must still be able to
        claim their own lead."""
        _, user = company_and_user
        lead = self._seed_ready_lead_with_photo(db, lead_ids)

        with patch(
            "app.domains.tools.service.ToolAccessService.can_access_tool",
            return_value=False,
        ):
            r = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(user))

        assert r.status_code == 200
        session_id = r.json()["tool_session_id"]
        assert session_id

        session = db.query(ToolSession).filter(ToolSession.id == uuid.UUID(session_id)).first()
        assert session is not None
        assert session.company_id == user.company_id
        assert session.data.get("mode") == "content"
        assert len(session.data.get("photo_rooms", [])) == 1

        files = db.query(ToolFile).filter(ToolFile.session_id == session.id).all()
        assert len(files) == 1

    def test_claim_is_idempotent_same_user_conflict_other_user(self, db, lead_ids, company_and_user):
        _, user = company_and_user
        lead = self._seed_ready_lead_with_photo(db, lead_ids)

        r1 = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(user))
        assert r1.status_code == 200
        session_id_1 = r1.json()["tool_session_id"]

        r2 = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(user))
        assert r2.status_code == 200
        assert r2.json()["tool_session_id"] == session_id_1

        unique = uuid.uuid4().hex[:8]
        other_company = Company(name=f"Other Co {unique}")
        db.add(other_company)
        db.flush()
        other_user = User(
            email=f"other_{unique}@example.com",
            hashed_password=get_password_hash("Test1234!"),
            full_name="Other User",
            company_id=other_company.id,
            role="admin",
            is_active=True,
            is_verified=True,
        )
        db.add(other_user)
        db.commit()
        try:
            r3 = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(other_user))
            assert r3.status_code == 409
        finally:
            db.query(ToolFile).filter(ToolFile.company_id == other_company.id).delete()
            db.query(ToolSession).filter(ToolSession.company_id == other_company.id).delete()
            db.delete(other_user)
            db.delete(other_company)
            db.commit()
