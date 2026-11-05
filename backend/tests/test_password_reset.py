"""
Password reset: /auth/forgot-password emails a single-use link, and
/auth/reset-password sets the new password from it.

Runs against Postgres through TestClient; the email is patched, so nothing
is sent.
"""
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token, create_password_reset_token, get_password_hash
from app.domains.company.models import Company
from app.domains.user.models import User
from main import app

client = TestClient(app)
API = "/api/auth"
SEND = "app.core.email.EmailService.send_password_reset_email"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user(db):
    unique = uuid.uuid4().hex[:10]
    company = Company(name=f"Reset Co {unique}")
    db.add(company)
    db.flush()
    u = User(
        email=f"reset_{unique}@example.com",
        hashed_password=get_password_hash("OldPass123!"),
        full_name="Reset Test",
        company_id=company.id,
        role="admin",
        is_active=True,
        is_verified=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _token_from_email(send_mock) -> str:
    url = send_mock.call_args.kwargs["reset_url"]
    assert url.startswith(f"{settings.FRONTEND_URL}/reset-password#token=")
    return url.split("#token=", 1)[1]


def _login(email, password):
    return client.post(f"{API}/login", json={"email": email, "password": password})


def test_forgot_password_answers_the_same_for_unknown_and_known_emails(user):
    with patch(SEND, return_value=True) as send:
        unknown = client.post(f"{API}/forgot-password", json={"email": "nobody_xyz@example.com"})
        assert send.call_count == 0
        known = client.post(f"{API}/forgot-password", json={"email": user.email})
        assert send.call_count == 1
    assert unknown.status_code == known.status_code == 200
    assert unknown.json() == known.json()


def test_reset_link_sets_the_new_password_once(user):
    with patch(SEND, return_value=True) as send:
        client.post(f"{API}/forgot-password", json={"email": user.email})
    token = _token_from_email(send)

    r = client.post(f"{API}/reset-password", json={"token": token, "password": "NewPass456!"})
    assert r.status_code == 200, r.text
    assert _login(user.email, "NewPass456!").status_code == 200
    assert _login(user.email, "OldPass123!").status_code == 401

    # The same link can't be used again
    again = client.post(f"{API}/reset-password", json={"token": token, "password": "Another789!"})
    assert again.status_code == 400
    assert _login(user.email, "NewPass456!").status_code == 200


def test_reset_signs_out_every_session(db, user):
    old = {"Authorization": "Bearer " + create_access_token(
        str(user.id), str(user.company_id), user.role, token_version=user.token_version or 0)}
    assert client.get(f"{API}/me", headers=old).status_code == 200
    token = create_password_reset_token(user)
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "NewPass456!"}).status_code == 200
    assert client.get(f"{API}/me", headers=old).status_code == 401


def test_link_dies_when_the_password_changes_another_way(db, user):
    token = create_password_reset_token(user)
    login = _login(user.email, "OldPass123!").json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    r = client.post(f"{API}/me/change-password",
                    json={"current_password": "OldPass123!", "new_password": "Changed999!"}, headers=headers)
    assert r.status_code == 200
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "NewPass456!"}).status_code == 400


def test_weak_password_is_refused_and_the_link_still_works(user):
    token = create_password_reset_token(user)
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "short"}).status_code == 400
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "LongEnough1!"}).status_code == 200


def test_expired_forged_and_wrong_type_tokens_are_refused(user):
    expired = jwt.encode(
        {"sub": str(user.id), "type": "password_reset", "pwf": "x" * 32,
         "exp": datetime.utcnow() - timedelta(minutes=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    forged = jwt.encode(
        {"sub": str(user.id), "type": "password_reset", "pwf": "x" * 32,
         "exp": datetime.utcnow() + timedelta(minutes=10)},
        "not-the-secret", algorithm=settings.JWT_ALGORITHM)
    access = create_access_token(str(user.id))
    for bad in [expired, forged, access, "garbage"]:
        r = client.post(f"{API}/reset-password", json={"token": bad, "password": "NewPass456!"})
        assert r.status_code == 400, bad
    assert _login(user.email, "OldPass123!").status_code == 200


def test_reset_verifies_an_unverified_account(db, user):
    user.is_verified = False
    db.commit()
    token = create_password_reset_token(user)
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "NewPass456!"}).status_code == 200
    db.expire_all()
    assert db.query(User).get(user.id).is_verified is True
    assert _login(user.email, "NewPass456!").status_code == 200


def test_google_only_account_can_set_a_password_by_reset(db, user):
    user.hashed_password = None
    db.commit()
    token = create_password_reset_token(user)
    assert client.post(f"{API}/reset-password", json={"token": token, "password": "NewPass456!"}).status_code == 200
    assert _login(user.email, "NewPass456!").status_code == 200


def test_reset_email_escapes_the_name_and_links_the_page():
    from app.core.email import EmailService
    with patch.object(EmailService, "send_email", return_value=True) as send:
        EmailService().send_password_reset_email(
            to_email="a@example.com", user_name="<b>Eve</b>",
            reset_url="https://scopit.work/reset-password#token=abc", expires_in_minutes=30)
    html = send.call_args.kwargs["html_content"]
    assert "<b>Eve</b>" not in html and "&lt;b&gt;Eve&lt;/b&gt;" in html
    assert 'href="https://scopit.work/reset-password#token=abc"' in html
