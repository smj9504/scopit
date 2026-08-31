"""
Tests for the internal "new signup" notification.

Pure unit tests -- the email transport and the DB session are both mocked,
so nothing here needs a live database or makes a network call.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import settings
from app.core.email import EmailService
from app.domains.auth.api import _notify_admin_of_signup


# ── Fixtures ─────────────────────────────────────────────────────────────

def make_user(**overrides):
    """A stand-in for a freshly created User row. A plain namespace keeps the
    test off the DB -- _notify_admin_of_signup only ever reads attributes."""
    defaults = dict(
        email="newuser@example.com",
        full_name="New User",
        company=SimpleNamespace(name="Example Restoration"),
        occupation="contractor",
        occupation_other=None,
        signup_city="Austin",
        signup_state="TX",
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


@pytest.fixture
def db():
    """Session whose count query returns a fixed signup number."""
    session = MagicMock()
    session.query.return_value.scalar.return_value = 42
    return session


# ── EmailService.send_signup_notification_email ──────────────────────────

class TestSignupNotificationEmail:
    def test_builds_subject_body_and_admin_link(self):
        service = EmailService()
        with patch.object(service, "send_email", return_value=True) as send:
            assert service.send_signup_notification_email(
                to_email="team@example.com",
                user_email="newuser@example.com",
                user_name="New User",
                company_name="Example Restoration",
                occupation="contractor",
                location="Austin, TX",
                signup_method="email",
                signup_number=42,
            ) is True

        kwargs = send.call_args.kwargs
        assert kwargs["to_email"] == "team@example.com"
        # Subject alone answers "how many signups do we have?"
        assert "#42" in kwargs["subject"]
        assert "newuser@example.com" in kwargs["subject"]

        for content in (kwargs["html_content"], kwargs["text_content"]):
            assert "New User" in content
            assert "Example Restoration" in content
            assert "contractor" in content
            assert "Austin, TX" in content
        assert "/admin/users" in kwargs["html_content"]

    def test_google_signups_are_labeled(self):
        service = EmailService()
        with patch.object(service, "send_email", return_value=True) as send:
            service.send_signup_notification_email(
                to_email="team@example.com",
                user_email="oauth@example.com",
                user_name="OAuth User",
                signup_method="google",
            )

        assert "Google" in send.call_args.kwargs["text_content"]

    def test_blank_fields_are_omitted_not_rendered_as_none(self):
        service = EmailService()
        with patch.object(service, "send_email", return_value=True) as send:
            service.send_signup_notification_email(
                to_email="team@example.com",
                user_email="sparse@example.com",
                user_name="Sparse User",
                company_name=None,
                occupation=None,
                location=None,
            )

        kwargs = send.call_args.kwargs
        assert "None" not in kwargs["text_content"]
        assert "Company" not in kwargs["text_content"]

    def test_user_controlled_values_are_html_escaped(self):
        """full_name and company name are attacker-controlled at signup, so
        they must not be able to inject markup into the email we read."""
        service = EmailService()
        with patch.object(service, "send_email", return_value=True) as send:
            service.send_signup_notification_email(
                to_email="team@example.com",
                user_email="xss@example.com",
                user_name="<script>alert(1)</script>",
                company_name="<img src=x onerror=alert(1)>",
            )

        html_content = send.call_args.kwargs["html_content"]
        # The payloads may survive as inert text; what matters is that no tag
        # delimiter reaches the markup, so nothing can execute.
        assert "<script>" not in html_content
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_content
        assert "<img src=x" not in html_content
        assert "&lt;img src=x onerror=alert(1)&gt;" in html_content

    def test_no_recipient_configured_is_a_no_op(self):
        service = EmailService()
        with patch.object(service, "send_email") as send:
            assert service.send_signup_notification_email(
                to_email="",
                user_email="newuser@example.com",
                user_name="New User",
            ) is False
        send.assert_not_called()


# ── _notify_admin_of_signup ──────────────────────────────────────────────

class TestNotifyAdminOfSignup:
    def test_sends_with_details_pulled_off_the_user(self, db):
        with patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, make_user(), signup_method="email")

        kwargs = email_service.send_signup_notification_email.call_args.kwargs
        assert kwargs["to_email"] == settings.SIGNUP_NOTIFY_EMAIL
        assert kwargs["user_email"] == "newuser@example.com"
        assert kwargs["company_name"] == "Example Restoration"
        assert kwargs["location"] == "Austin, TX"
        assert kwargs["signup_method"] == "email"
        assert kwargs["signup_number"] == 42

    def test_occupation_other_includes_the_free_text(self, db):
        user = make_user(occupation="other", occupation_other="Adjuster trainee")
        with patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, user, signup_method="email")

        kwargs = email_service.send_signup_notification_email.call_args.kwargs
        assert kwargs["occupation"] == "other (Adjuster trainee)"

    def test_partial_location_does_not_leave_a_dangling_comma(self, db):
        user = make_user(signup_city=None, signup_state="TX")
        with patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, user, signup_method="email")

        assert email_service.send_signup_notification_email.call_args.kwargs["location"] == "TX"

    def test_unknown_location_is_none_rather_than_empty_string(self, db):
        user = make_user(signup_city=None, signup_state=None)
        with patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, user, signup_method="google")

        assert email_service.send_signup_notification_email.call_args.kwargs["location"] is None

    def test_disabled_when_no_address_is_configured(self, db):
        with patch.object(settings, "SIGNUP_NOTIFY_EMAIL", ""), \
             patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, make_user(), signup_method="email")

        email_service.send_signup_notification_email.assert_not_called()

    def test_send_failure_never_breaks_signup(self, db):
        """A notification problem must not surface to the user mid-signup."""
        with patch("app.domains.auth.api.email_service") as email_service:
            email_service.send_signup_notification_email.side_effect = RuntimeError("SMTP down")
            _notify_admin_of_signup(db, make_user(), signup_method="email")  # must not raise

    def test_missing_company_relation_is_tolerated(self, db):
        with patch("app.domains.auth.api.email_service") as email_service:
            _notify_admin_of_signup(db, make_user(company=None), signup_method="email")

        assert email_service.send_signup_notification_email.call_args.kwargs["company_name"] is None
