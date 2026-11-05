"""
Tests for in-app support inquiries (the Help form).

Pure unit tests: the DB session and the email transport are mocked and the
endpoint functions are called directly, so nothing here needs a live
database, the HTTP test client, or the network.
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError

import main  # noqa: F401  (registers every model, so SQLAlchemy mappers can configure)
from app.core.config import settings
from app.core.rate_limit import limiter
from app.domains.support import notify
from app.domains.support.api import create_inquiry, update_inquiry_status
from app.domains.support.models import SupportInquiry
from app.domains.support.notify import send_inquiry_notification
from app.domains.support.schemas import InquiryCreate, InquiryStatusUpdate

# ── Fixtures ─────────────────────────────────────────────────────────────

def make_user(**overrides):
    defaults = dict(
        id=uuid4(),
        company_id=uuid4(),
        email="owner@example.com",
        full_name="Pat Owner",
        company=SimpleNamespace(name="Example Restoration"),
        is_superuser=False,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_db():
    """Session whose refresh() fills in what the database would."""
    db = MagicMock()

    def refresh(obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime(2026, 11, 5, 9, 30, tzinfo=timezone.utc)

    db.refresh.side_effect = refresh
    return db


def make_request(user_agent="Mozilla/5.0 (Windows NT 10.0) Edge/130"):
    return SimpleNamespace(headers={"user-agent": user_agent} if user_agent else {})


@pytest.fixture(autouse=True)
def _fresh_rate_limits(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    limiter.reset()
    yield
    limiter.reset()


def send(data, *, user=None, db=None, request=None, tasks=None):
    return asyncio.run(
        create_inquiry(
            data=data,
            request=request or make_request(),
            background_tasks=tasks if tasks is not None else BackgroundTasks(),
            current_user=user or make_user(),
            db=db or make_db(),
        )
    )


# ── InquiryCreate ────────────────────────────────────────────────────────

class TestInquiryCreate:
    def test_trims_message(self):
        data = InquiryCreate(category="problem", message="  PDF won't open  \n")
        assert data.message == "PDF won't open"

    @pytest.mark.parametrize("message", ["", "   ", "\n\t"])
    def test_rejects_blank_message(self, message):
        with pytest.raises(ValidationError):
            InquiryCreate(message=message)

    def test_rejects_overlong_message(self):
        with pytest.raises(ValidationError):
            InquiryCreate(message="x" * 5001)

    def test_rejects_unknown_category(self):
        with pytest.raises(ValidationError):
            InquiryCreate(category="billing", message="hi")

    def test_defaults_to_question(self):
        assert InquiryCreate(message="hi").category == "question"

    def test_keeps_in_app_path(self):
        data = InquiryCreate(message="hi", page_url="/app/estimates/12/edit?tab=items")
        assert data.page_url == "/app/estimates/12/edit?tab=items"

    @pytest.mark.parametrize(
        "page_url",
        [
            "javascript:alert(1)",
            "https://evil.example/app",
            "//evil.example/app",
            "/\\evil.example",
            "app/estimates",
            123,
        ],
    )
    def test_drops_anything_but_an_in_app_path(self, page_url):
        # Dropped, not rejected: the user's message still goes through.
        assert InquiryCreate(message="hi", page_url=page_url).page_url is None

    def test_truncates_long_path(self):
        data = InquiryCreate(message="hi", page_url="/app/" + "a" * 600)
        assert len(data.page_url) == 500


# ── send_inquiry_notification ────────────────────────────────────────────

class TestInquiryNotification:
    @pytest.fixture(autouse=True)
    def _settings(self, monkeypatch):
        monkeypatch.setattr(settings, "SUPPORT_NOTIFY_EMAIL", "team@example.com")
        monkeypatch.setattr(settings, "FRONTEND_URL", "https://www.scopit.work")

    def _send(self, **overrides):
        kwargs = dict(
            email="owner@example.com",
            name="Pat Owner",
            company_name="Example Restoration",
            category="problem",
            message="The PDF export is blank.\nIt worked yesterday.",
            page_url="/app/estimates/12",
            user_agent="Mozilla/5.0 Edge/130",
        )
        kwargs.update(overrides)
        with patch.object(notify.email_service, "send_email", return_value=True) as send_email:
            result = send_inquiry_notification(**kwargs)
        return result, send_email

    def test_sends_to_support_address_with_user_as_reply_to(self):
        result, send_email = self._send()
        assert result is True
        kwargs = send_email.call_args.kwargs
        assert kwargs["to_email"] == "team@example.com"
        assert kwargs["reply_to"] == "owner@example.com"

    def test_subject_names_category_sender_and_message(self):
        _, send_email = self._send()
        subject = send_email.call_args.kwargs["subject"]
        assert subject == (
            "[Scopit] Problem from Pat Owner: The PDF export is blank. It worked yesterday."
        )

    def test_subject_shortens_long_message(self):
        _, send_email = self._send(message="word " * 40)
        subject = send_email.call_args.kwargs["subject"]
        assert subject.endswith("…")
        assert len(subject.split(": ", 1)[1]) <= 60

    def test_subject_falls_back_to_email_without_name(self):
        _, send_email = self._send(name=None)
        assert "Problem from owner@example.com:" in send_email.call_args.kwargs["subject"]

    def test_body_has_message_page_link_and_admin_link(self):
        _, send_email = self._send()
        kwargs = send_email.call_args.kwargs
        html = kwargs["html_content"]
        assert "The PDF export is blank." in html
        assert 'href="https://www.scopit.work/app/estimates/12"' in html
        assert "https://www.scopit.work/admin/inquiries" in html
        assert "Example Restoration" in html
        text = kwargs["text_content"]
        assert "The PDF export is blank.\nIt worked yesterday." in text
        assert "Page: https://www.scopit.work/app/estimates/12" in text

    def test_escapes_user_text(self):
        _, send_email = self._send(
            name='<img src=x onerror="alert(1)">',
            message="<script>alert(1)</script>",
            company_name="<b>Acme</b>",
        )
        html = send_email.call_args.kwargs["html_content"]
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html
        assert "<img src=x" not in html
        assert "<b>Acme</b>" not in html

    def test_skips_optional_rows_when_empty(self):
        _, send_email = self._send(company_name=None, page_url=None, user_agent=None)
        text = send_email.call_args.kwargs["text_content"]
        assert "Company:" not in text
        assert "Page:" not in text
        assert "Browser:" not in text

    def test_disabled_when_no_support_address(self, monkeypatch):
        monkeypatch.setattr(settings, "SUPPORT_NOTIFY_EMAIL", "  ")
        result, send_email = self._send()
        assert result is False
        send_email.assert_not_called()

    def test_never_raises(self):
        with patch.object(
            notify.email_service, "send_email", side_effect=RuntimeError("smtp down")
        ):
            assert send_inquiry_notification(
                email="owner@example.com",
                name=None,
                company_name=None,
                category="question",
                message="hi",
                page_url=None,
                user_agent=None,
            ) is False


# ── POST /api/support/inquiries ──────────────────────────────────────────

class TestCreateInquiry:
    def test_saves_inquiry_with_user_and_context(self):
        user = make_user()
        db = make_db()
        send(
            InquiryCreate(category="idea", message="Add a dark mode", page_url="/app/tools"),
            user=user,
            db=db,
        )
        inquiry = db.add.call_args.args[0]
        assert isinstance(inquiry, SupportInquiry)
        assert inquiry.user_id == user.id
        assert inquiry.company_id == user.company_id
        assert inquiry.email == "owner@example.com"
        assert inquiry.name == "Pat Owner"
        assert inquiry.category == "idea"
        assert inquiry.message == "Add a dark mode"
        assert inquiry.page_url == "/app/tools"
        assert inquiry.user_agent == "Mozilla/5.0 (Windows NT 10.0) Edge/130"
        db.commit.assert_called_once()

    def test_returns_reply_address(self):
        result = send(InquiryCreate(message="hi"))
        assert result.reply_to == "owner@example.com"
        assert result.id

    def test_emails_the_team_after_responding(self):
        tasks = BackgroundTasks()
        send(InquiryCreate(category="problem", message="Broken"), tasks=tasks)
        assert len(tasks.tasks) == 1
        task = tasks.tasks[0]
        assert task.func is send_inquiry_notification
        assert task.kwargs["email"] == "owner@example.com"
        assert task.kwargs["company_name"] == "Example Restoration"
        assert task.kwargs["category"] == "problem"
        assert task.kwargs["message"] == "Broken"

    def test_user_without_company(self):
        tasks = BackgroundTasks()
        send(
            InquiryCreate(message="hi"),
            user=make_user(company_id=None, company=None),
            tasks=tasks,
        )
        assert tasks.tasks[0].kwargs["company_name"] is None

    def test_missing_or_long_user_agent(self):
        db = make_db()
        send(InquiryCreate(message="hi"), db=db, request=make_request(user_agent=None))
        assert db.add.call_args.args[0].user_agent is None

        db = make_db()
        send(InquiryCreate(message="hi"), db=db, request=make_request("x" * 900))
        assert len(db.add.call_args.args[0].user_agent) == 500

    def test_rate_limited_per_user(self, monkeypatch):
        monkeypatch.setattr(settings, "SUPPORT_INQUIRIES_PER_USER_PER_HOUR", 2)
        user = make_user()
        send(InquiryCreate(message="one"), user=user)
        send(InquiryCreate(message="two"), user=user)

        db = make_db()
        with pytest.raises(HTTPException) as exc:
            send(InquiryCreate(message="three"), user=user, db=db)
        assert exc.value.status_code == 429
        assert "Retry-After" in exc.value.headers
        db.add.assert_not_called()

        # Another user isn't affected.
        send(InquiryCreate(message="hello"), user=make_user())


# ── PATCH /api/admin/inquiries/{id} ──────────────────────────────────────

class TestUpdateInquiryStatus:
    def _inquiry(self, **overrides):
        defaults = dict(
            id=uuid4(),
            user_id=uuid4(),
            company_id=None,
            email="owner@example.com",
            name="Pat Owner",
            category="question",
            message="hi",
            page_url=None,
            user_agent=None,
            status="open",
            created_at=datetime(2026, 11, 5, tzinfo=timezone.utc),
            resolved_at=None,
        )
        defaults.update(overrides)
        return SupportInquiry(**defaults)

    def _update(self, db, inquiry_id, new_status):
        return asyncio.run(
            update_inquiry_status(
                inquiry_id=inquiry_id,
                data=InquiryStatusUpdate(status=new_status),
                current_user=make_user(is_superuser=True),
                db=db,
            )
        )

    def test_resolve_then_reopen(self):
        inquiry = self._inquiry()
        db = make_db()
        db.get.return_value = inquiry

        result = self._update(db, inquiry.id, "resolved")
        assert result.status == "resolved"
        assert inquiry.resolved_at is not None

        result = self._update(db, inquiry.id, "open")
        assert result.status == "open"
        assert inquiry.resolved_at is None
        assert db.commit.call_count == 2

    def test_same_status_is_a_no_op(self):
        resolved_at = datetime(2026, 11, 1, tzinfo=timezone.utc)
        inquiry = self._inquiry(status="resolved", resolved_at=resolved_at)
        db = make_db()
        db.get.return_value = inquiry

        self._update(db, inquiry.id, "resolved")
        assert inquiry.resolved_at == resolved_at
        db.commit.assert_not_called()

    def test_unknown_inquiry_404s(self):
        db = make_db()
        db.get.return_value = None
        with pytest.raises(HTTPException) as exc:
            self._update(db, uuid4(), "resolved")
        assert exc.value.status_code == 404

    def test_rejects_unknown_status(self):
        with pytest.raises(ValidationError):
            InquiryStatusUpdate(status="spam")
