"""
Regression tests for the security review fixes in core, auth, estimates,
invoices and company settings.

Runs against a real Postgres (models use UUID/JSONB) through FastAPI's
TestClient. Each test makes its own companies/users with unique names.
Email sending is never configured in tests, so nothing leaves the process.
"""
import io
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.responses import RedirectResponse

from app.core import rate_limit
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import (
    create_access_token,
    create_oauth_code,
    create_refresh_token,
    get_password_hash,
)
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.estimate.models import EstimateItem, EstimateSection
from app.domains.settings.service import seed_default_settings
from app.domains.user.models import User
from main import app

client = TestClient(app)
API = "/api"


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_tenant(db, *, verified=True, password="Test1234!", superuser=False):
    unique = uuid.uuid4().hex[:10]
    company = Company(name=f"Sec Test Co {unique}")
    db.add(company)
    db.flush()
    seed_default_settings(db, company.id)
    user = User(
        email=f"sectest_{unique}@example.com",
        hashed_password=get_password_hash(password) if password else None,
        full_name="Sec Test",
        company_id=company.id,
        role="admin",
        is_active=True,
        is_verified=verified,
        is_superuser=superuser,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(company)
    return company, user


def _auth(user):
    token = create_access_token(
        user_id=str(user.id), company_id=str(user.company_id), role=user.role,
        token_version=user.token_version or 0,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def tenants(db):
    a = _make_tenant(db)
    b = _make_tenant(db)
    yield a, b


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    rate_limit.limiter.reset()
    yield
    rate_limit.limiter.reset()


def _create_estimate(user, **extra):
    body = {
        "title": "Test",
        "sections": [{"name": "Room", "order_index": 0, "items": [
            {"name": "Item 1", "quantity": 1, "unit_price": 10},
        ]}],
        **extra,
    }
    resp = client.post(f"{API}/estimates", json=body, headers=_auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Tenant isolation: estimate sections and items ──────────────────────────


def _first_section_and_item(db, estimate_id):
    section = db.query(EstimateSection).filter(EstimateSection.estimate_id == estimate_id).first()
    item = db.query(EstimateItem).filter(EstimateItem.estimate_id == estimate_id).first()
    return section, item


def test_bulk_action_cannot_touch_another_companys_items(db, tenants):
    (_, user_a), (_, user_b) = tenants
    est_a = _create_estimate(user_a)
    est_b = _create_estimate(user_b)
    section_a, _ = _first_section_and_item(db, est_a["id"])
    _, item_b = _first_section_and_item(db, est_b["id"])

    # Delete via A's own estimate path, naming B's item
    resp = client.post(
        f"{API}/estimates/{est_a['id']}/items/bulk-action",
        json={"action": "delete", "item_ids": [str(item_b.id)]},
        headers=_auth(user_a),
    )
    assert resp.status_code == 200
    assert resp.json()["affected_count"] == 0
    db.expire_all()
    assert db.query(EstimateItem).filter(EstimateItem.id == item_b.id).first() is not None

    # Copy B's item into A's section: nothing copied
    resp = client.post(
        f"{API}/estimates/{est_a['id']}/items/bulk-action",
        json={"action": "copy", "item_ids": [str(item_b.id)], "target_section_id": str(section_a.id)},
        headers=_auth(user_a),
    )
    assert resp.status_code == 200
    assert resp.json()["affected_count"] == 0

    # Using B's estimate id in the path is refused outright
    resp = client.post(
        f"{API}/estimates/{est_b['id']}/items/bulk-action",
        json={"action": "delete", "item_ids": [str(item_b.id)]},
        headers=_auth(user_a),
    )
    assert resp.status_code == 404


def test_section_endpoints_are_scoped_to_the_callers_estimate(db, tenants):
    (_, user_a), (_, user_b) = tenants
    est_a = _create_estimate(user_a)
    est_b = _create_estimate(user_b)
    section_b, item_b = _first_section_and_item(db, est_b["id"])
    section_a, _ = _first_section_and_item(db, est_a["id"])

    r = client.put(f"{API}/estimates/{est_a['id']}/sections/{section_b.id}",
                   json={"name": "pwned"}, headers=_auth(user_a))
    assert r.status_code == 404
    r = client.delete(f"{API}/estimates/{est_a['id']}/sections/{section_b.id}", headers=_auth(user_a))
    assert r.status_code == 404
    r = client.put(f"{API}/estimates/{est_a['id']}/items/reorder",
                   json={"item_id": str(item_b.id), "target_section_id": str(section_a.id), "target_index": 0},
                   headers=_auth(user_a))
    assert r.status_code == 404

    db.expire_all()
    assert db.query(EstimateSection).get(section_b.id).name != "pwned"
    assert db.query(EstimateItem).get(item_b.id).section_id == section_b.id

    # Own section still works, and "reorder" is no longer swallowed as a section id
    r = client.put(f"{API}/estimates/{est_a['id']}/sections/{section_a.id}",
                   json={"name": "Kitchen"}, headers=_auth(user_a))
    assert r.status_code == 200
    r = client.put(f"{API}/estimates/{est_a['id']}/sections/reorder",
                   json={"section_ids": [str(section_a.id)]}, headers=_auth(user_a))
    assert r.status_code == 200


def test_customer_from_another_company_is_rejected(db, tenants):
    (company_a, user_a), (company_b, user_b) = tenants
    other = Customer(company_id=company_b.id, name="Other Co Customer",
                     email="victim@example.com", created_by=user_b.id)
    db.add(other)
    db.commit()

    r = client.post(f"{API}/estimates", json={"title": "x", "customer_id": str(other.id), "sections": []},
                    headers=_auth(user_a))
    assert r.status_code == 400
    assert "victim@example.com" not in r.text

    r = client.post(f"{API}/invoices", json={"customerId": str(other.id), "sections": []},
                    headers=_auth(user_a))
    assert r.status_code == 400

    # Own customer still works
    mine = Customer(company_id=company_a.id, name="Mine", email="mine@example.com", created_by=user_a.id)
    db.add(mine)
    db.commit()
    est = _create_estimate(user_a, customer_id=str(mine.id))
    assert (est.get("customer_email") or est.get("customerEmail")) == "mine@example.com"


def test_invoice_cannot_link_another_companys_estimate(db, tenants):
    (_, user_a), (_, user_b) = tenants
    est_b = _create_estimate(user_b)
    r = client.post(f"{API}/invoices", json={"estimateId": est_b["id"], "sections": []},
                    headers=_auth(user_a))
    assert r.status_code == 400


# ── Excel import ────────────────────────────────────────────────────────────


def test_excel_import_requires_login():
    files = {"file": ("x.xlsx", b"PK", "application/octet-stream")}
    assert client.post(f"{API}/estimates/import-excel", files=files).status_code in (401, 403)
    assert client.post(f"{API}/invoices/import-excel", files=files).status_code in (401, 403)


def test_excel_import_refuses_zip_bombs(tenants):
    (_, user_a), _ = tenants
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", b"0" * (60 * 1024 * 1024))
    data = buf.getvalue()
    assert len(data) < 5 * 1024 * 1024
    r = client.post(f"{API}/estimates/import-excel",
                    files={"file": ("bomb.xlsx", data, "application/octet-stream")},
                    headers=_auth(user_a))
    assert r.status_code == 400
    assert "too large" in r.json()["detail"]


# ── Sending estimates ───────────────────────────────────────────────────────


def test_send_validates_and_caps_recipients(tenants):
    (_, user_a), _ = tenants
    est = _create_estimate(user_a)
    with patch("app.core.email.EmailService.is_configured", return_value=True), \
         patch("app.core.email.EmailService.send_email", return_value=True) as send, \
         patch("app.domains.estimate.api.generate_estimate_pdf", return_value=io.BytesIO(b"%PDF")):
        r = client.post(f"{API}/estimates/{est['id']}/send",
                        json={"to_email": "not-an-email"}, headers=_auth(user_a))
        assert r.status_code == 400
        r = client.post(f"{API}/estimates/{est['id']}/send",
                        json={"to_email": "a@example.com",
                              "cc_emails": [f"c{i}@example.com" for i in range(20)]},
                        headers=_auth(user_a))
        assert r.status_code == 400
        assert send.call_count == 0

        r = client.post(f"{API}/estimates/{est['id']}/send",
                        json={"to_email": "a@example.com", "message": "<a href='https://evil'>Pay</a>"},
                        headers=_auth(user_a))
        assert r.status_code == 200, r.text
        html = send.call_args.kwargs["html_content"]
        assert "<a href='https://evil'>" not in html
        assert "&lt;a href=" in html


def test_company_email_budget(tenants, limits_on, monkeypatch):
    (_, user_a), _ = tenants
    monkeypatch.setattr(settings, "EMAIL_SENDS_PER_COMPANY_PER_HOUR", 2)
    est = _create_estimate(user_a)
    with patch("app.core.email.EmailService.is_configured", return_value=True), \
         patch("app.core.email.EmailService.send_email", return_value=True), \
         patch("app.domains.estimate.api.generate_estimate_pdf", return_value=io.BytesIO(b"%PDF")):
        codes = [client.post(f"{API}/estimates/{est['id']}/send", json={"to_email": "a@example.com"},
                             headers=_auth(user_a)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


# ── Auth ───────────────────────────────────────────────────────────────────


def test_register_requires_a_real_password():
    r = client.post(f"{API}/auth/register", json={
        "email": f"weak_{uuid.uuid4().hex[:8]}@example.com", "password": "123",
        "company_name": "Weak Co"})
    assert r.status_code == 400


def test_login_is_rate_limited_per_account(db, limits_on):
    _, user = _make_tenant(db)
    codes = [client.post(f"{API}/auth/login", json={"email": user.email, "password": "wrong-pass"}).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429


def test_password_change_signs_out_other_sessions(db):
    _, user = _make_tenant(db)
    old_headers = _auth(user)
    old_refresh = create_refresh_token(str(user.id), token_version=user.token_version or 0)

    r = client.post(f"{API}/auth/me/change-password",
                    json={"current_password": "Test1234!", "new_password": "NewPass5678!"},
                    headers=old_headers)
    assert r.status_code == 200, r.text
    body = r.json()

    assert client.get(f"{API}/auth/me", headers=old_headers).status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401
    new_headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get(f"{API}/auth/me", headers=new_headers).status_code == 200
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": body["refresh_token"]}).status_code == 200


def test_tokens_without_version_claim_keep_working(db):
    """Tokens issued before this change carry no `ver`; they count as version 0."""
    from datetime import datetime, timedelta

    from jose import jwt as jose_jwt
    _, user = _make_tenant(db)
    legacy = jose_jwt.encode(
        {"sub": str(user.id), "type": "access", "exp": datetime.utcnow() + timedelta(minutes=5)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    assert client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {legacy}"}).status_code == 200


def test_google_code_exchange_requires_matching_state(db):
    _, user = _make_tenant(db)
    state = "s" * 32
    code = create_oauth_code(str(user.id), state)
    assert client.post(f"{API}/auth/google/exchange", json={"code": code, "state": "x" * 32}).status_code == 401
    r = client.post(f"{API}/auth/google/exchange", json={"code": code, "state": state})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == user.email
    # single use
    assert client.post(f"{API}/auth/google/exchange", json={"code": code, "state": state}).status_code == 401


_redirect_kwargs: list = []


def _fake_google(userinfo):
    async def authorize_redirect(request, redirect_uri, **kwargs):
        _redirect_kwargs.append(kwargs)
        return RedirectResponse("https://accounts.google.com/o/oauth2/auth")

    async def authorize_access_token(request):
        return {"userinfo": userinfo}

    return SimpleNamespace(google=SimpleNamespace(
        authorize_redirect=authorize_redirect, authorize_access_token=authorize_access_token))


def _google_round_trip(monkeypatch, userinfo, state="t" * 32):
    import app.domains.auth.api as auth_api
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setattr(auth_api, "oauth", _fake_google(userinfo))
    c = TestClient(app)
    r = c.get(f"{API}/auth/google", params={"state": state}, follow_redirects=False)
    assert r.status_code in (302, 307)
    return c.get(f"{API}/auth/google/callback", follow_redirects=False)


def test_google_callback_returns_a_code_in_the_fragment(db, monkeypatch):
    _, user = _make_tenant(db)
    r = _google_round_trip(monkeypatch, {"email": user.email, "email_verified": True, "sub": "g1"})
    location = r.headers["location"]
    assert "/auth/callback#" in location
    assert "access_token" not in location and "code=" in location and "state=" in location


def test_google_callback_refuses_unverified_google_email(db, monkeypatch):
    _, user = _make_tenant(db)
    r = _google_round_trip(monkeypatch, {"email": user.email, "email_verified": False, "sub": "g2"})
    assert "error=email_not_verified" in r.headers["location"]


def test_google_sign_in_takes_over_an_unverified_password_account_safely(db, monkeypatch):
    _, user = _make_tenant(db, verified=False)
    r = _google_round_trip(monkeypatch, {"email": user.email, "email_verified": True, "sub": "g3"})
    assert "/auth/callback#" in r.headers["location"]
    db.expire_all()
    fresh = db.query(User).get(user.id)
    assert fresh.is_verified is True
    assert fresh.hashed_password is None  # whoever set it can't sign in


def test_google_without_client_state_is_refused(monkeypatch):
    import app.domains.auth.api as auth_api
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setattr(auth_api, "oauth", _fake_google({}))
    r = client.get(f"{API}/auth/google", follow_redirects=False)
    assert "error=oauth_failed" in r.headers["location"]


# ── Company settings ───────────────────────────────────────────────────────


def test_company_logo_must_be_inline_image(tenants):
    (_, user_a), _ = tenants
    r = client.put(f"{API}/company", json={"logoUrl": "http://169.254.169.254/latest/meta-data/"},
                   headers=_auth(user_a))
    assert r.status_code == 422
    r = client.put(f"{API}/company", json={"logoUrl": "data:image/png;base64,iVBORw0KGgo="},
                   headers=_auth(user_a))
    assert r.status_code == 200


def test_staff_cannot_change_company_settings(db):
    _, user = _make_tenant(db)
    user.role = "staff"
    db.commit()
    r = client.put(f"{API}/company", json={"name": "Renamed"}, headers=_auth(user))
    assert r.status_code == 403


def test_status_cannot_be_deactivated_through_update(tenants):
    (_, user_a), _ = tenants
    statuses = client.get(f"{API}/settings/estimate-statuses", headers=_auth(user_a)).json()["items"]
    target = statuses[0]
    r = client.put(f"{API}/settings/estimate-statuses/{target['id']}", json={"is_active": False},
                   headers=_auth(user_a))
    assert r.status_code == 200
    assert r.json()["is_active"] is True


# ── Misc ───────────────────────────────────────────────────────────────────


def test_security_headers_on_api_responses():
    r = client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"


def test_item_index_rebuild_is_staff_only(tenants):
    (_, user_a), _ = tenants
    r = client.post(f"{API}/tools/item-recommender/reindex", headers=_auth(user_a))
    assert r.status_code == 403


def test_malformed_ids_are_a_bad_request_not_a_server_error(tenants):
    (_, user_a), _ = tenants
    c = TestClient(app, raise_server_exceptions=False)
    for path in ["/api/estimates/not-a-uuid", "/api/invoices/xyz", "/api/customers/abc"]:
        assert c.get(path, headers=_auth(user_a)).status_code == 400


def test_settings_reorder_works_as_the_settings_page_calls_it(db, tenants):
    """Reorder used to be shadowed by PUT /{id} and expected a different field name."""
    (_, user_a), _ = tenants
    h = _auth(user_a)
    statuses = client.get(f"{API}/settings/estimate-statuses", headers=h).json()["items"]
    ids = [s["id"] for s in statuses][::-1]
    r = client.put(f"{API}/settings/estimate-statuses/reorder", json={"ids": ids}, headers=h)
    assert r.status_code == 200, r.text
    after = client.get(f"{API}/settings/estimate-statuses", headers=h).json()["items"]
    assert [s["id"] for s in after] == ids

    for path in ["categories", "units"]:
        items = client.get(f"{API}/settings/{path}", headers=h).json()["items"]
        r = client.put(f"{API}/settings/{path}/reorder", json={"ids": [i["id"] for i in items]}, headers=h)
        assert r.status_code == 200, (path, r.text)


def test_staff_cannot_change_settings(db):
    _, user = _make_tenant(db)
    user.role = "staff"
    db.commit()
    h = _auth(user)
    assert client.get(f"{API}/settings/estimate-statuses", headers=h).status_code == 200
    assert client.put(f"{API}/settings/estimate-statuses/reorder", json={"ids": []}, headers=h).status_code == 403


def test_google_reauth_asks_for_the_password(monkeypatch):
    import app.domains.auth.api as auth_api
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setattr(auth_api, "oauth", _fake_google({}))
    _redirect_kwargs.clear()
    client.get(f"{API}/auth/google", params={"state": "r" * 32, "reauth": "1"}, follow_redirects=False)
    client.get(f"{API}/auth/google", params={"state": "r" * 32}, follow_redirects=False)
    assert _redirect_kwargs == [{"prompt": "login"}, {}]
