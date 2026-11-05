"""
Security regression tests for the packing estimator (signed-in tool, public
lead form, public demo).

Covers: image validation before decoding (pixel bombs, non-photo formats,
size/count caps), lead submit cleanup and field lengths, single-use
verification codes, the per-company AI quota, photo-key tenant checks,
ReportLab markup and Excel formula escaping, verification-email limits,
lead claim tied to the verified email, generic error messages, and the
slowapi key function.

Email and Claude calls are mocked; storage is faked where the test only
needs to observe writes/deletes.
"""
import asyncio
import base64
import io
import json
import re
import struct
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from PIL import Image, ImageFile
from pypdf import PdfReader

from app.core import rate_limit
from app.core.client_ip import get_client_ip
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.images import ImageRejected
from app.core.security import create_access_token, get_password_hash
from app.core.storage import get_storage
from app.domains.company.models import Company
from app.domains.tools.models import AIUsageEvent, ToolFile, ToolSession
from app.domains.tools.modules.packing import api as packing_api
from app.domains.tools.modules.packing import demo_api, export, lead_api, vision
from app.domains.tools.modules.packing.lead_models import PackingLead, PackingLeadStatus
from app.domains.tools.modules.packing.schemas import DetectedContentItem, RoomAnalysisResponse
from app.domains.user.models import User
from main import app

# The slowapi decorator limits (5/hour) are not under test here.
lead_api.limiter.enabled = False

client = TestClient(app)
client_no_raise = TestClient(app, raise_server_exceptions=False)


# ── Image helpers ────────────────────────────────────────────────────────

def _jpeg(size=(16, 12), color=(200, 120, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _png(size=(16, 12)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 200, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _chunk(ctype: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data)) + ctype + data
        + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)
    )


def _png_header_only(width: int, height: int) -> bytes:
    """A tiny PNG whose header declares width x height pixels.

    Decoding it would need width*height*3 bytes; reading the header does not.
    """
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"tEXt", b"Comment\x00" + b"x" * 200)
        + _chunk(b"IDAT", zlib.compress(b""))
        + _chunk(b"IEND", b"")
    )


PIXEL_BOMB = _png_header_only(30000, 30000)      # 900 MP: past Pillow's hard ceiling
OVER_LIMIT = _png_header_only(7500, 6000)        # 45 MP: over the 40 MP upload limit
NOT_AN_IMAGE = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n" + b"x" * 300


def _data_url(data: bytes, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


class FakeStorage:
    def __init__(self):
        self.files = {}
        self.deleted = []

    def write(self, key, data, content_type="application/octet-stream"):
        self.files[key] = (data, content_type)

    def read(self, key):
        return self.files[key][0]

    def exists(self, key):
        return key in self.files

    def delete(self, key):
        self.deleted.append(key)
        self.files.pop(key, None)


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_company_user(db, email=None):
    unique = uuid.uuid4().hex[:8]
    company = Company(name=f"Sec Test Co {unique}")
    db.add(company)
    db.flush()
    user = User(
        email=email or f"sectest_{unique}@example.com",
        hashed_password=get_password_hash("Test1234!"),
        full_name="Sec Test User",
        company_id=company.id,
        role="admin",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(company)
    db.refresh(user)
    return company, user


def _drop_company_user(db, company, user):
    db.rollback()
    db.query(PackingLead).filter(PackingLead.claimed_by_user_id == user.id).delete()
    db.query(AIUsageEvent).filter(AIUsageEvent.company_id == company.id).delete()
    db.query(ToolFile).filter(ToolFile.company_id == company.id).delete()
    db.query(ToolSession).filter(ToolSession.company_id == company.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.query(Company).filter(Company.id == company.id).delete()
    db.commit()


@pytest.fixture
def company_and_user(db):
    company, user = _make_company_user(db)
    yield company, user
    _drop_company_user(db, company, user)


@pytest.fixture
def other_company_and_user(db):
    company, user = _make_company_user(db)
    yield company, user
    _drop_company_user(db, company, user)


@pytest.fixture
def tool_access():
    with patch(
        "app.domains.tools.service.ToolAccessService.can_access_tool",
        return_value=True,
    ):
        yield


@pytest.fixture
def rate_limits_on(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    rate_limit.limiter.reset()
    yield
    rate_limit.limiter.reset()


@pytest.fixture
def lead_cleanup(db):
    """Delete leads created by a test (tracked by contact email)."""
    emails: list = []
    yield emails
    db.rollback()
    if emails:
        db.query(PackingLead).filter(PackingLead.contact_email.in_(emails)).delete(
            synchronize_session=False,
        )
        db.commit()


def _auth_headers(user) -> dict:
    token = create_access_token(
        user_id=str(user.id), company_id=str(user.company_id), role=user.role,
    )
    return {"Authorization": f"Bearer {token}"}


def _pdf_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    return re.sub(r"\s+", "", text)


def _fake_room_result(room_name="Den") -> RoomAnalysisResponse:
    return RoomAnalysisResponse(
        room_name=room_name,
        items=[DetectedContentItem(name="Sofa", category="Furniture", quantity=1, confidence=0.95)],
        low_confidence_items=[],
        density="normal",
        room_size="large",
        confidence_score=0.9,
        total_labor_hours=0.5,
        fragile_count=0,
        high_value_count=0,
        field_notes=[],
    )


# ── Lead submit helper ───────────────────────────────────────────────────

def _submit(photos, *, email=None, extra=None, rooms=None, idempotency_key=None, http=client):
    """POST /packing-leads/submit with explicit photo tuples (name, bytes, ctype)."""
    email = email or f"sec_{uuid.uuid4().hex[:10]}@example.com"
    if rooms is None:
        rooms = [{"room_name": "Bedroom", "photo_count": len(photos)}]
    payload = {
        "contact_email": email,
        "property_address_line1": "123 Main St",
        "idempotency_key": idempotency_key or uuid.uuid4().hex,
        "rooms": rooms,
    }
    payload.update(extra or {})
    files = [("photos", (name, io.BytesIO(data), ctype)) for name, data, ctype in photos]
    with patch(
        "app.domains.tools.modules.packing.lead_api.email_service.send_email",
        return_value=True,
    ) as mock_send:
        resp = http.post(
            "/api/packing-leads/submit", data={"payload": json.dumps(payload)}, files=files,
        )
    return resp, mock_send, email, payload["idempotency_key"]


# ═════════════════════════════════════════════════════════════════════════
# 1. Images are validated (header only) before anything decodes them
# ═════════════════════════════════════════════════════════════════════════

class TestImageValidation:
    def test_compress_rejects_pixel_bomb_and_non_photos(self):
        for bad in (PIXEL_BOMB, OVER_LIMIT, NOT_AN_IMAGE):
            with pytest.raises(ImageRejected):
                export._compress_image_bytes(bad)

    def test_compress_still_handles_normal_photos(self):
        out = export._compress_image_bytes(_jpeg((1200, 900)), max_width=800, max_height=800)
        with Image.open(io.BytesIO(out)) as im:
            assert im.format == "JPEG"
            assert max(im.size) == 800
        assert export._compress_image_bytes(_png((300, 200)))[:2] == b"\xff\xd8"

    def test_compress_allows_large_jpeg_via_draft_but_not_png(self, monkeypatch):
        """JPEGs decode at reduced scale (draft), so only the post-draft size
        has to fit the pixel limit; formats without draft must fit as-is."""
        monkeypatch.setattr(export, "MAX_UPLOAD_PIXELS", 10_000)
        out = export._compress_image_bytes(_jpeg((400, 400)), max_width=50, max_height=50)
        assert out[:2] == b"\xff\xd8"
        with pytest.raises(ImageRejected):
            export._compress_image_bytes(_png((400, 400)), max_width=50, max_height=50)

    def test_vision_never_decodes_pixel_bomb(self):
        calls = []

        def _no_load(self, *a, **k):
            calls.append(1)
            raise RuntimeError("decode attempted")

        bomb_b64 = base64.b64encode(OVER_LIMIT).decode("ascii")
        with patch.object(ImageFile.ImageFile, "load", _no_load):
            selected = vision._select_diverse_images([bomb_b64])
            media_type, data = vision._compress_image_base64(
                "data:image/png;base64," + bomb_b64, max_bytes=10,
            )
        assert calls == []
        assert selected == [bomb_b64]
        assert data == bomb_b64  # passed through untouched, not decoded

    def test_demo_report_rejects_pixel_bomb(self):
        for bad in (PIXEL_BOMB, OVER_LIMIT):
            r = client.post("/api/demo/packing/report", json={
                "rooms": [{"room_name": "Den", "photos": [{"image": _data_url(bad, "image/png")}]}],
            })
            assert r.status_code == 400, r.text
            assert "Photo 1" in r.json()["detail"]

    def test_demo_report_rejects_non_image(self):
        r = client.post("/api/demo/packing/report", json={
            "rooms": [{"room_name": "Den", "photos": [{"image": _data_url(NOT_AN_IMAGE)}]}],
        })
        assert r.status_code == 400

    def test_demo_report_total_photo_bytes_capped(self, monkeypatch):
        monkeypatch.setattr(demo_api, "MAX_DEMO_PHOTO_BYTES_PER_REQUEST", 1000)
        photo = {"image": _data_url(_jpeg((64, 64), (1, 2, 3)))}
        r = client.post("/api/demo/packing/report", json={
            "rooms": [{"room_name": "Den", "photos": [photo] * 3}],
        })
        assert r.status_code == 400
        assert "too large" in r.json()["detail"]

    def test_demo_report_photos_per_page_bounded(self):
        r = client.post("/api/demo/packing/report", json={"rooms": [], "photos_per_page": 100000})
        assert r.status_code == 422

    def test_demo_report_normal_photos_still_render(self):
        r = client.post("/api/demo/packing/report", json={
            "rooms": [{
                "room_name": "Den",
                "photos": [{"image": _data_url(_jpeg((640, 480))), "caption": "Den - Photo 1"}],
                "items": [{"name": "Sofa", "category": "Furniture", "quantity": 1}],
            }],
        })
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"

    def test_demo_exports_rate_limited_per_ip(self, rate_limits_on, monkeypatch):
        monkeypatch.setattr(demo_api, "DEMO_EXPORTS_PER_HOUR", 2)
        monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "X-Test-Client-IP")
        ip_a = {"X-Test-Client-IP": "203.0.113.7"}
        ip_b = {"X-Test-Client-IP": "203.0.113.8"}
        for _ in range(2):
            assert client.post("/api/demo/packing/report", json={"rooms": []}, headers=ip_a).status_code == 200
        r = client.post("/api/demo/packing/report", json={"rooms": []}, headers=ip_a)
        assert r.status_code == 429
        assert "Retry-After" in r.headers
        # Another visitor has their own bucket.
        assert client.post("/api/demo/packing/report", json={"rooms": []}, headers=ip_b).status_code == 200


# ═════════════════════════════════════════════════════════════════════════
# 2. Lead submit: total-size cap, field lengths, cleanup on failure
# ═════════════════════════════════════════════════════════════════════════

class TestLeadSubmit:
    def test_total_photo_bytes_capped_before_anything_is_stored(self, monkeypatch, db, lead_cleanup):
        fake = FakeStorage()
        jpeg = _jpeg()
        monkeypatch.setattr(lead_api, "MAX_TOTAL_PHOTO_BYTES", int(len(jpeg) * 1.5))
        with patch.object(lead_api, "get_storage", return_value=fake):
            resp, _, email, key = _submit([("a.jpg", jpeg, "image/jpeg"), ("b.jpg", jpeg, "image/jpeg")])
        lead_cleanup.append(email)
        assert resp.status_code == 400
        assert "MB" in resp.json()["detail"]
        assert fake.files == {}
        assert db.query(PackingLead).filter(PackingLead.idempotency_key == key).first() is None

    def test_bad_photo_after_a_good_one_leaves_nothing_behind(self, db, lead_cleanup):
        fake = FakeStorage()
        with patch.object(lead_api, "get_storage", return_value=fake):
            resp, mock_send, email, key = _submit([
                ("good.jpg", _jpeg(), "image/jpeg"),
                ("bad.jpg", b"definitely not an image" * 10, "image/jpeg"),
            ])
        lead_cleanup.append(email)
        assert resp.status_code == 400
        assert "bad.jpg" in resp.json()["detail"]
        assert fake.files == {}
        assert len(fake.deleted) == 1  # the good photo was written, then removed
        assert not mock_send.called
        assert db.query(PackingLead).filter(PackingLead.idempotency_key == key).first() is None

    def test_pixel_bomb_rejected(self, lead_cleanup):
        fake = FakeStorage()
        with patch.object(lead_api, "get_storage", return_value=fake):
            resp, _, email, _ = _submit([("bomb.png", PIXEL_BOMB, "image/png")])
        lead_cleanup.append(email)
        assert resp.status_code == 400
        assert "pixels" in resp.json()["detail"]
        assert fake.files == {}

    def test_failed_insert_removes_stored_photos(self, db, lead_cleanup):
        """A DB error after the photos were written must not orphan them."""
        fake = FakeStorage()
        with patch.object(lead_api, "get_storage", return_value=fake), patch.object(
            lead_api, "hash_code", return_value="x" * 100,  # too long for String(64)
        ):
            resp, _, email, key = _submit([("a.jpg", _jpeg(), "image/jpeg")], http=client_no_raise)
        lead_cleanup.append(email)
        # 400 or 500 depending on whether a global DB-error handler is installed.
        assert resp.status_code in (400, 500)
        assert fake.files == {}
        assert len(fake.deleted) == 1
        assert db.query(PackingLead).filter(PackingLead.idempotency_key == key).first() is None

    def test_over_long_fields_are_a_400_not_a_failed_insert(self, lead_cleanup):
        fake = FakeStorage()
        for field, length in (("contact_phone", 51), ("company_state", 51), ("property_zipcode", 21)):
            with patch.object(lead_api, "get_storage", return_value=fake):
                resp, _, email, _ = _submit(
                    [("a.jpg", _jpeg(), "image/jpeg")], extra={field: "1" * length},
                )
            lead_cleanup.append(email)
            assert resp.status_code == 400, field
        assert fake.files == {}

    def test_stored_type_comes_from_the_bytes_not_the_client(self, db, lead_cleanup):
        fake = FakeStorage()
        with patch.object(lead_api, "get_storage", return_value=fake):
            resp, _, email, _ = _submit([("photo.jpg", _png(), "image/jpeg")])
        lead_cleanup.append(email)
        assert resp.status_code == 201
        [(key, (_, content_type))] = fake.files.items()
        assert key.endswith(".png")
        assert content_type == "image/png"


# ═════════════════════════════════════════════════════════════════════════
# 3. Verification codes are single-use
# ═════════════════════════════════════════════════════════════════════════

class TestVerifyEmailReplay:
    def test_reposting_the_code_does_not_restart_analysis(self, db, lead_cleanup):
        fake = FakeStorage()
        run = AsyncMock()
        with patch.object(lead_api, "get_storage", return_value=fake), patch.object(
            lead_api, "generate_verification_code", return_value="654321",
        ):
            resp, _, email, _ = _submit([("a.jpg", _jpeg(), "image/jpeg")])
        lead_cleanup.append(email)
        token = resp.json()["token"]

        with patch.object(lead_api, "_run_analysis", run), patch(
            "app.domains.tools.modules.packing.lead_api.email_service.send_email",
            return_value=True,
        ):
            r1 = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "654321"})
            assert r1.status_code == 200
            assert r1.json()["status"] == "analyzing"
            assert run.call_count == 1

            db.expire_all()
            lead = db.query(PackingLead).filter(PackingLead.token == token).first()
            assert lead.verification_code_hash is None
            started = lead.analysis_started_at

            # Analysis then fails; re-posting the old code must not start a
            # fresh (uncounted) run -- only the capped /retry may.
            lead.status = PackingLeadStatus.FAILED.value
            lead.error_message = "Analysis didn't complete — please retry."
            db.commit()

            r2 = client.post(f"/api/packing-leads/{token}/verify-email", json={"code": "654321"})
            assert r2.status_code == 200
            assert r2.json()["status"] == "failed"
            assert run.call_count == 1

        db.expire_all()
        lead = db.query(PackingLead).filter(PackingLead.token == token).first()
        assert lead.status == PackingLeadStatus.FAILED.value
        assert lead.analysis_started_at == started


# ═════════════════════════════════════════════════════════════════════════
# 4. Signed-in analysis counts against the company's daily AI quota
# ═════════════════════════════════════════════════════════════════════════

class TestAIQuota:
    @pytest.fixture(autouse=True)
    def _vision_ready(self, monkeypatch):
        monkeypatch.setattr(vision, "_require_vision_dependencies", lambda: None)
        monkeypatch.setattr(settings, "AI_VISION_ROOMS_PER_COMPANY_PER_DAY", 2)
        monkeypatch.setattr(settings, "VISION_BATCH_INTER_ROOM_DELAY", 0)

    def test_analyze_room_stops_at_the_daily_cap(self, db, company_and_user, tool_access):
        _, user = company_and_user
        body = {"room_name": "Den", "images": [_data_url(_jpeg())]}
        fake = AsyncMock(return_value=_fake_room_result())
        with patch.object(vision, "analyze_room_photos", fake):
            for _ in range(2):
                r = client.post("/api/tools/packing/analyze-room", json=body, headers=_auth_headers(user))
                assert r.status_code == 200, r.text
            r = client.post("/api/tools/packing/analyze-room", json=body, headers=_auth_headers(user))
        assert r.status_code == 429
        assert "Daily photo-analysis limit" in r.json()["detail"]
        assert fake.call_count == 2

    def test_batch_reserves_one_unit_per_room_up_front(self, db, company_and_user, tool_access):
        _, user = company_and_user
        room = {"room_name": "Den", "images": [_data_url(_jpeg())]}
        retry = AsyncMock(return_value=(_fake_room_result(), None, None))
        with patch.object(vision, "analyze_room_with_retry", retry):
            r = client.post(
                "/api/tools/packing/analyze-batch",
                json={"rooms": [room, room, room]}, headers=_auth_headers(user),
            )
            assert r.status_code == 429
            assert retry.call_count == 0

            r = client.post(
                "/api/tools/packing/analyze-batch",
                json={"rooms": [room, room]}, headers=_auth_headers(user),
            )
            assert r.status_code == 200
            assert "batch_complete" in r.text
            assert retry.call_count == 2

        used = db.query(AIUsageEvent).filter(AIUsageEvent.company_id == user.company_id).all()
        assert sum(e.units for e in used) == 2

    def test_invalid_photo_rejected_without_charging_quota(self, db, company_and_user, tool_access):
        _, user = company_and_user
        fake = AsyncMock(return_value=_fake_room_result())
        with patch.object(vision, "analyze_room_photos", fake):
            for images in ([_data_url(OVER_LIMIT, "image/png")], [_data_url(NOT_AN_IMAGE)]):
                r = client.post(
                    "/api/tools/packing/analyze-room",
                    json={"room_name": "Den", "images": images}, headers=_auth_headers(user),
                )
                assert r.status_code == 400
        assert fake.call_count == 0
        assert db.query(AIUsageEvent).filter(AIUsageEvent.company_id == user.company_id).count() == 0


# ═════════════════════════════════════════════════════════════════════════
# 5 & 6. Photo keys are confined to the caller's own photo folder
# ═════════════════════════════════════════════════════════════════════════

class TestPhotoKeys:
    def test_key_check(self):
        cid = uuid.uuid4()
        ok = f"{cid}/packing/photos/a.jpg"
        assert packing_api._is_company_photo_key(ok, cid)
        for bad in (
            f"{cid}/packing/photos/../../other/x.jpg",
            f"{cid}/packing/photos/..",
            f"{cid}/estimates/x.pdf",
            f"{cid}0/packing/photos/x.jpg",
            f"/{cid}/packing/photos/x.jpg",
            f"{cid}/packing/photos\\..\\x.jpg",
            f"{uuid.uuid4()}/packing/photos/x.jpg",
            None,
        ):
            assert not packing_api._is_company_photo_key(bad, cid), bad

    def test_serve_photo_only_serves_own_photo_folder(self, company_and_user, other_company_and_user, tool_access):
        _, user = company_and_user
        _, other = other_company_and_user
        storage = get_storage()
        own_key = f"{user.company_id}/packing/photos/{uuid.uuid4()}.png"
        foreign_key = f"{other.company_id}/packing/photos/{uuid.uuid4()}.png"
        sideways_key = f"{user.company_id}/private/{uuid.uuid4()}.png"
        for k in (own_key, foreign_key, sideways_key):
            storage.write(k, _png(), content_type="image/png")
        try:
            h = _auth_headers(user)
            r = client.get(f"/api/tools/packing/photos/{own_key}", headers=h)
            assert r.status_code == 200
            assert r.headers["content-type"] == "image/png"
            # An old client still sending ?token= keeps working (param ignored).
            assert client.get(f"/api/tools/packing/photos/{own_key}?token=x", headers=h).status_code == 200

            assert client.get(f"/api/tools/packing/photos/{foreign_key}", headers=h).status_code == 403
            assert client.get(f"/api/tools/packing/photos/{sideways_key}", headers=h).status_code == 403
            traversal = (
                f"/api/tools/packing/photos/{user.company_id}/packing/photos/"
                f"%2E%2E/%2E%2E/%2E%2E/{foreign_key}"
            )
            assert client.get(traversal, headers=h).status_code in (403, 404)
            assert client.get(traversal, headers=h).status_code != 200
        finally:
            for k in (own_key, foreign_key, sideways_key):
                storage.delete(k)

    def test_report_export_skips_foreign_photo_keys(self, db, company_and_user, other_company_and_user, tool_access):
        company, user = company_and_user
        _, other = other_company_and_user
        storage = get_storage()
        own_key = f"{user.company_id}/packing/photos/{uuid.uuid4()}.jpg"
        foreign_key = f"{other.company_id}/packing/photos/{uuid.uuid4()}.jpg"
        for k in (own_key, foreign_key):
            storage.write(k, _jpeg((300, 200)), content_type="image/jpeg")

        session = ToolSession(
            company_id=company.id, created_by=user.id, tool_id="packing", name="Sec",
            data={"photo_rooms": [{
                "room_name": "Den",
                "photo_keys": [own_key, foreign_key, f"{user.company_id}/packing/photos/../../{foreign_key}"],
                "items": [],
            }]},
        )
        db.add(session)
        db.commit()

        captured = {}

        def _fake_report(**kwargs):
            captured["rooms"] = kwargs["rooms_data"]
            return b"%PDF-1.4 fake"

        try:
            with patch.object(packing_api, "generate_report_pdf", _fake_report):
                r = client.post(
                    "/api/tools/packing/export/report",
                    json={"session_id": str(session.id)}, headers=_auth_headers(user),
                )
            assert r.status_code == 200, r.text
            photos = captured["rooms"][0]["photos"]
            assert len(photos) == 1  # only the caller's own photo was read
        finally:
            for k in (own_key, foreign_key):
                storage.delete(k)


# ═════════════════════════════════════════════════════════════════════════
# 7. /photos/upload: caps, real-image check, detected content type
# ═════════════════════════════════════════════════════════════════════════

class TestPhotoUpload:
    def _post(self, user, images):
        return client.post(
            "/api/tools/packing/photos/upload", json={"images": images}, headers=_auth_headers(user),
        )

    def test_valid_photos_stored_with_detected_type(self, company_and_user, tool_access):
        _, user = company_and_user
        fake = FakeStorage()
        with patch("app.core.storage.get_storage", return_value=fake):
            r = self._post(user, [
                _data_url(_jpeg()),
                _data_url(_png(), "image/jpeg"),  # client lies about the type
                base64.b64encode(_jpeg()).decode("ascii"),  # bare base64
            ])
        assert r.status_code == 200, r.text
        keys = r.json()["photo_keys"]
        assert len(keys) == 3
        assert keys[0].endswith(".jpg") and fake.files[keys[0]][1] == "image/jpeg"
        assert keys[1].endswith(".png") and fake.files[keys[1]][1] == "image/png"
        assert all(k.startswith(f"{user.company_id}/packing/photos/") for k in keys)
        assert f"{keys[0]}.report.jpg" in fake.files  # report companion still written

    def test_one_bad_photo_rejects_the_request_and_stores_nothing(self, company_and_user, tool_access):
        _, user = company_and_user
        for bad in (OVER_LIMIT, PIXEL_BOMB, NOT_AN_IMAGE):
            fake = FakeStorage()
            with patch("app.core.storage.get_storage", return_value=fake):
                r = self._post(user, [_data_url(_jpeg()), _data_url(bad, "image/png")])
            assert r.status_code == 400
            assert "Photo 2" in r.json()["detail"]
            assert fake.files == {}

    def test_count_and_total_size_capped(self, company_and_user, tool_access, monkeypatch):
        _, user = company_and_user
        fake = FakeStorage()
        tiny = _data_url(_jpeg((4, 4)))
        with patch("app.core.storage.get_storage", return_value=fake):
            r = self._post(user, [tiny] * (packing_api.MAX_PHOTOS_PER_REQUEST + 1))
            assert r.status_code == 400
            monkeypatch.setattr(packing_api, "MAX_UPLOAD_BYTES_PER_REQUEST", 1000)
            r = self._post(user, [_data_url(_jpeg((64, 64), (9, 9, 9)))] * 3)
            assert r.status_code == 400
        assert fake.files == {}


# ═════════════════════════════════════════════════════════════════════════
# 8. ReportLab markup in user/AI text is escaped
# ═════════════════════════════════════════════════════════════════════════

INJECT = '<img src="/etc/passwd"/>'
BROKEN = "<b>unclosed & <font"


class TestPdfMarkupEscaping:
    def test_estimate_pdf_renders_markup_literally(self):
        estimate = {
            "line_items": [{
                "title": f"Section {BROKEN}",
                "items": [{
                    "name": f"Item {INJECT}", "qty": 1, "price": 10.0,
                    "unit": "EA<", "detail": f"detail {BROKEN}",
                }],
            }],
            "subtotal": 10.0,
            "supplements": [{"name": f"Supp {INJECT}", "reason": "</font>", "amount": 5, "enabled": True}],
            "ai_rooms": [{"room_name": f"Room {BROKEN}", "floor": "<x>"}],
            "storage_months": "<b>2",
        }
        pdf = export.generate_estimate_pdf(
            estimate,
            client_name=INJECT,
            client_phone="<i>555",
            client_email="a&b@example.com",
            property_address=f"1 Main {BROKEN}\nCity <x>",
            notes=f"note {INJECT}",
            company_info={"name": f"Acme {BROKEN}", "address": "1 <Main>", "phone": "<p>", "email": "x@y.z"},
        )
        text = _pdf_text(pdf)
        assert '<imgsrc="/etc/passwd"/>' in text
        assert "<b>unclosed&<font" in text

    def test_report_pdf_renders_markup_literally(self):
        rooms = [{
            "room_name": f"Room {BROKEN}",
            "items": [{"name": f"Item {INJECT}", "category": "Furniture", "quantity": 1}],
            "photos": [{"image_bytes": _jpeg((200, 150)), "caption": f"Cap {INJECT}"}],
            "field_notes": [f"note {BROKEN}"],
            "labor_hours": 1.0,
            "labor_notes": f"labor {INJECT}",
        }]
        pdf = export.generate_report_pdf(
            session_data={"id": "<b>id"},
            rooms_data=rooms,
            sections_config={"inventory_list": True, "labor_log": True, "room_photos": True},
            client_name=INJECT,
            property_address=f"1 Main {BROKEN}",
            company_info={"name": f"Acme {BROKEN}", "address": "", "phone": "", "email": ""},
            notes=f"extra {INJECT}",
            include_signature_page=True,
            include_field_notes=True,
        )
        text = _pdf_text(pdf)
        assert '<imgsrc="/etc/passwd"/>' in text
        assert "<b>unclosed&<font" in text


# ═════════════════════════════════════════════════════════════════════════
# 9. Excel cells never become formulas from user text
# ═════════════════════════════════════════════════════════════════════════

class TestExcelFormulaInjection:
    def test_estimate_excel_neutralises_formula_text(self):
        evil = '=HYPERLINK("http://evil.example","click")'
        estimate = {
            "line_items": [{
                "title": evil,
                "items": [{"name": evil, "qty": 1, "price": 10.0, "unit": "+cmd", "detail": "@x"}],
            }],
            "subtotal": 10.0,
            "supplements": [{"name": evil, "amount": 5, "enabled": True}],
        }
        xlsx = export.generate_estimate_excel(
            estimate,
            client_name=evil,
            client_phone="-1+1",
            client_email="@SUM(A1)",
            property_address=f"{evil}\n-12.5",
            notes=f"{evil}\n-12.5",
            company_info={"name": evil, "address": evil, "phone": "+1 555", "email": "x@y.z"},
        )
        ws = load_workbook(io.BytesIO(xlsx)).active
        values = []
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == "f":
                    # Only the template's own formulas remain.
                    assert re.fullmatch(r"=(B\d+\*D\d+|SUM\(E\d+:E\d+\))", cell.value), cell.value
                if isinstance(cell.value, str):
                    values.append(cell.value)
        assert "'" + evil in values
        # Only "=" becomes a formula in .xlsx; other text is stored as-is,
        # as plain strings Excel never evaluates (no stray apostrophes).
        assert "-1+1" in values
        assert "@SUM(A1)" in values
        assert "+1 555" in values
        assert "-12.5" in values  # plain negative numbers are left readable

    def test_inventory_excel_neutralises_formula_text(self):
        evil = "=1+1"
        xlsx = export.generate_inventory_excel([{
            "room_name": evil,
            "items": [{"name": evil, "category": "+x", "special_instructions": "@y", "quantity": 1}],
        }])
        ws = load_workbook(io.BytesIO(xlsx)).active
        for row in ws.iter_rows():
            for cell in row:
                assert cell.data_type != "f", cell.value


# ═════════════════════════════════════════════════════════════════════════
# 10. Verification emails are limited per address
# ═════════════════════════════════════════════════════════════════════════

class TestLeadEmailFlooding:
    def test_verification_emails_limited_per_address(self, rate_limits_on, db, lead_cleanup):
        fake = FakeStorage()
        email = f"Flood_{uuid.uuid4().hex[:8]}@Example.com"
        lead_cleanup.extend([email, email.lower()])
        sent = 0
        with patch.object(lead_api, "get_storage", return_value=fake):
            for i in range(lead_api.MAX_VERIFICATION_EMAILS_PER_HOUR):
                # Mixed case still counts against the same address.
                addr = email if i % 2 == 0 else email.lower()
                resp, mock_send, _, _ = _submit([("a.jpg", _jpeg(), "image/jpeg")], email=addr)
                assert resp.status_code == 201
                sent += mock_send.call_count
            resp, mock_send, _, key = _submit([("a.jpg", _jpeg(), "image/jpeg")], email=email)
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers
        assert not mock_send.called
        assert sent == lead_api.MAX_VERIFICATION_EMAILS_PER_HOUR
        assert db.query(PackingLead).filter(PackingLead.idempotency_key == key).first() is None

    def test_unverified_submit_does_not_notify_the_team(self, lead_cleanup):
        fake = FakeStorage()
        with patch.object(lead_api, "get_storage", return_value=fake):
            resp, mock_send, email, _ = _submit([("a.jpg", _jpeg(), "image/jpeg")])
        lead_cleanup.append(email)
        assert resp.status_code == 201
        recipients = [c.kwargs.get("to_email") for c in mock_send.call_args_list]
        assert recipients == [email]


# ═════════════════════════════════════════════════════════════════════════
# 11. Only the verified email's account can claim a lead
# ═════════════════════════════════════════════════════════════════════════

def _seed_ready_lead(db, contact_email) -> PackingLead:
    now = datetime.now(timezone.utc)
    lead = PackingLead(
        id=uuid.uuid4(),
        token=uuid.uuid4().hex + uuid.uuid4().hex,
        idempotency_key=uuid.uuid4().hex,
        contact_email=contact_email,
        rooms_input=[],
        ai_result={"rooms": []},
        status=PackingLeadStatus.READY.value,
        verification_attempts=0,
        retry_count=0,
        verified_at=now,
        expires_at=now + timedelta(days=14),
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


class TestLeadClaim:
    def test_other_account_cannot_claim(self, db, company_and_user, lead_cleanup):
        _, user = company_and_user
        victim = f"victim_{uuid.uuid4().hex[:8]}@example.com"
        lead_cleanup.append(victim)
        lead = _seed_ready_lead(db, victim)

        r = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(user))
        assert r.status_code == 403
        assert "different email" in r.json()["detail"]

        db.expire_all()
        refreshed = db.query(PackingLead).filter(PackingLead.id == lead.id).first()
        assert refreshed.status == PackingLeadStatus.READY.value
        assert refreshed.claimed_by_user_id is None

    def test_matching_email_claims_case_insensitively(self, db, company_and_user, lead_cleanup):
        _, user = company_and_user
        lead_email = user.email.upper()
        lead_cleanup.append(lead_email)
        lead = _seed_ready_lead(db, lead_email)

        r = client.post(f"/api/packing-leads/{lead.token}/claim", headers=_auth_headers(user))
        assert r.status_code == 200, r.text
        assert r.json()["tool_session_id"]


# ═════════════════════════════════════════════════════════════════════════
# 12. Upstream exception text never reaches users
# ═════════════════════════════════════════════════════════════════════════

SECRET = "upstream-secret sk-ant-api03-XYZ request_id=req_123"


class TestGenericErrors:
    def test_failed_lead_analysis_stores_generic_message(self, db, lead_cleanup):
        fake = FakeStorage()
        key = f"leads/packing/{uuid.uuid4()}/a.jpg"
        fake.write(key, _jpeg(), "image/jpeg")
        email = f"err_{uuid.uuid4().hex[:8]}@example.com"
        lead_cleanup.append(email)
        now = datetime.now(timezone.utc)
        lead = PackingLead(
            id=uuid.uuid4(), token=uuid.uuid4().hex, idempotency_key=uuid.uuid4().hex,
            contact_email=email, rooms_input=[{"room_name": "Den", "photo_keys": [key]}],
            status=PackingLeadStatus.ANALYZING.value, verification_attempts=0, retry_count=0,
            verified_at=now, analysis_started_at=now, expires_at=now + timedelta(days=14),
        )
        db.add(lead)
        db.commit()

        with patch.object(lead_api, "get_storage", return_value=fake), patch.object(
            vision, "analyze_room_with_retry", AsyncMock(side_effect=RuntimeError(SECRET)),
        ):
            asyncio.run(lead_api._run_analysis(lead.id))

        body = client.get(f"/api/packing-leads/{lead.token}/status").json()
        assert body["status"] == "failed"
        assert body["error_message"]
        assert "secret" not in body["error_message"].lower()
        assert "sk-ant" not in body["error_message"]

    def test_retry_helper_returns_generic_message(self, monkeypatch):
        monkeypatch.setattr(vision, "_require_vision_dependencies", lambda: None)
        monkeypatch.setattr(vision, "_analyze_room_with_claude", AsyncMock(side_effect=Exception(SECRET)))
        resp, code, msg = asyncio.run(vision.analyze_room_with_retry(
            "Den", [base64.b64encode(_jpeg()).decode("ascii")], max_retries=1, base_delay=0,
        ))
        assert resp is None
        assert code == "INTERNAL_ERROR"
        assert "secret" not in msg.lower()

    def test_analyze_room_and_master_content_hide_exception_text(
        self, company_and_user, tool_access, monkeypatch,
    ):
        _, user = company_and_user
        monkeypatch.setattr(vision, "_require_vision_dependencies", lambda: None)
        with patch.object(vision, "analyze_room_photos", AsyncMock(side_effect=RuntimeError(SECRET))):
            r = client.post(
                "/api/tools/packing/analyze-room",
                json={"room_name": "Den", "images": [_data_url(_jpeg())]},
                headers=_auth_headers(user),
            )
        assert r.status_code == 503
        assert "secret" not in r.json()["detail"].lower()

        with patch.object(vision, "build_master_content_list", side_effect=RuntimeError(SECRET)):
            r = client.post(
                "/api/tools/packing/master-content",
                json={"rooms": [{"room_name": "Den", "items": []}]},
                headers=_auth_headers(user),
            )
        assert r.status_code == 503
        assert "secret" not in r.json()["detail"].lower()


# ═════════════════════════════════════════════════════════════════════════
# 13. The lead form's slowapi limiter keys on the real client IP
# ═════════════════════════════════════════════════════════════════════════

def test_lead_limiter_keys_on_client_ip():
    assert lead_api.limiter._key_func is get_client_ip
