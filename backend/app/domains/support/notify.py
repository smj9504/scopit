"""
Scopit - Support inquiry notification email

Each message a user sends from the in-app Help form is emailed to the
internal support address (settings.SUPPORT_NOTIFY_EMAIL) with the user as
Reply-To, so answering is just replying to the email.
"""
import logging
from typing import Optional

from app.core.config import settings
from app.core.email import (
    COLOR_BG,
    COLOR_BORDER,
    COLOR_MUTED,
    COLOR_PRIMARY,
    COLOR_TEXT,
    FONT_STACK_BODY,
    FONT_STACK_HEADING,
    email_service,
)
from app.core.safe_text import html_text

logger = logging.getLogger(__name__)

CATEGORY_LABELS = {
    "question": "Question",
    "problem": "Problem",
    "idea": "Idea",
    "other": "Other",
}

_SUBJECT_SNIPPET_LENGTH = 60


def _snippet(message: str) -> str:
    """The message's first words on one line, for the subject."""
    text = " ".join(message.split())
    if len(text) <= _SUBJECT_SNIPPET_LENGTH:
        return text
    return text[: _SUBJECT_SNIPPET_LENGTH - 1].rstrip() + "…"


def send_inquiry_notification(
    *,
    email: str,
    name: Optional[str],
    company_name: Optional[str],
    category: str,
    message: str,
    page_url: Optional[str],
    user_agent: Optional[str],
) -> bool:
    """Email one inquiry to the support address. Never raises.

    Runs as a background task after the inquiry is saved, so a slow or
    failing SMTP server can't hold up or fail the user's request; the
    inquiry is in the admin console either way.
    """
    to_email = (settings.SUPPORT_NOTIFY_EMAIL or "").strip()
    if not to_email:
        return False

    try:
        label = CATEGORY_LABELS.get(category, category.title())
        sender = name or email
        subject = f"[{settings.APP_NAME}] {label} from {sender}: {_snippet(message)}"
        page_link = f"{settings.FRONTEND_URL}{page_url}" if page_url else None
        admin_link = f"{settings.FRONTEND_URL}/admin/inquiries"

        fields = [
            ("From", name),
            ("Email", email),
            ("Company", company_name),
            ("Page", page_link),
            ("Browser", user_agent),
        ]
        rows = "\n".join(
            f"""
        <tr>
          <td style="padding:7px 0; color:{COLOR_MUTED}; font-size:13px; line-height:1.6; font-family:{FONT_STACK_BODY}; white-space:nowrap;" valign="top">{html_text(field)}</td>
          <td style="padding:7px 0 7px 20px; color:{COLOR_PRIMARY}; font-size:14px; line-height:1.6; font-family:{FONT_STACK_BODY}; word-break:break-word;" valign="top">{_field_html(field, value)}</td>
        </tr>"""
            for field, value in fields
            if value
        )

        body_html = f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <p style="margin:0 0 8px 0; color:{COLOR_MUTED}; font-size:13px; font-weight:600; font-family:{FONT_STACK_BODY}; text-transform:uppercase; letter-spacing:0.04em;">
        {html_text(label)}
      </p>
      <h1 style="margin:0 0 18px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY}; letter-spacing:-0.3px;">
        New message from {html_text(sender)}
      </h1>
      <p style="margin:0 0 24px 0; padding:16px 18px; background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:8px; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY}; white-space:pre-wrap; word-break:break-word;">{html_text(message)}</p>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid {COLOR_BORDER}; border-radius:10px; padding:8px 20px;">
        {rows}
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:20px 0 4px 0; color:{COLOR_TEXT}; font-size:14px; line-height:1.6; font-family:{FONT_STACK_BODY};">
      Reply to this email to answer {html_text(email)} directly.
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:20px 0 24px 0;">
      <a href="{html_text(admin_link)}"
         style="display:inline-block; background-color:{COLOR_PRIMARY}; color:#ffffff; text-decoration:none; padding:14px 34px; border-radius:8px; font-family:{FONT_STACK_HEADING}; font-size:15px; font-weight:700;">
        Open inquiries &rarr;
      </a>
    </td>
  </tr>
</table>
"""

        # The shared brand wrapper used by every transactional email.
        html_content = email_service._base_template(
            title=subject,
            preheader=_snippet(message),
            body_html=body_html,
        )

        text_lines = [f"{label} from {sender}", "", message, ""]
        text_lines += [f"{field}: {value}" for field, value in fields if value]
        text_lines += [
            "",
            f"Reply to this email to answer {email} directly.",
            f"All inquiries: {admin_link}",
        ]

        return email_service.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content="\n".join(text_lines),
            reply_to=email,
        )
    except Exception:
        logger.exception("Failed to send support inquiry notification from %s", email)
        return False


def _field_html(field: str, value: str) -> str:
    """A field's value for the details table; the page and email become links."""
    if field == "Page":
        return (
            f'<a href="{html_text(value)}" style="color:{COLOR_PRIMARY};">'
            f"{html_text(value)}</a>"
        )
    if field == "Email":
        return (
            f'<a href="mailto:{html_text(value)}" style="color:{COLOR_PRIMARY};">'
            f"{html_text(value)}</a>"
        )
    return html_text(value)
