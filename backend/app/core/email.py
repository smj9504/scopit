"""
Scopit - Email Service
"""
import html
import logging
import smtplib
import ssl
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared brand tokens for transactional emails.
#
# Web fonts don't load in most email clients, so the brand fonts
# ('Plus Jakarta Sans' / 'Inter') are listed first for the handful of clients
# that do support them, backed by a Helvetica/Arial fallback that visually
# approximates them for everyone else. The verification code uses a
# monospace stack instead — fixed-width digits read faster and signal
# "this is a code to type", matching the convention used by 2FA emails.
# ---------------------------------------------------------------------------
FONT_STACK_HEADING = "'Plus Jakarta Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
FONT_STACK_BODY = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif"
FONT_STACK_MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

COLOR_PRIMARY = "#111827"
COLOR_BG = "#f9fafb"
COLOR_BORDER = "#e5e7eb"
COLOR_TEXT = "#374151"
COLOR_MUTED = "#6b7280"
COLOR_FAINT = "#9ca3af"

_RESPONSIVE_STYLE = """
  <style>
    @media only screen and (max-width: 600px) {
      .sc-container { width: 100% !important; }
      .sc-padded { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
"""


class EmailService:
    """Email sending service using SMTP"""

    def __init__(self):
        self.smtp_host = settings.SMTP_HOST
        self.smtp_port = settings.SMTP_PORT
        self.smtp_user = settings.SMTP_USER
        self.smtp_password = settings.SMTP_PASSWORD
        self.from_email = settings.EMAIL_FROM
        self.from_name = settings.EMAIL_FROM_NAME

    def is_configured(self) -> bool:
        """Check if email service is properly configured"""
        return all([
            self.smtp_host,
            self.smtp_user,
            self.smtp_password,
        ])

    def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
        reply_to: Optional[str] = None,
        from_display_name: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        cc_emails: Optional[list[str]] = None,
        bcc_emails: Optional[list[str]] = None,
    ) -> bool:
        """
        Send an email

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML body content
            text_content: Plain text body (optional, fallback)
            reply_to: Reply-To address (e.g. the user who triggered the email)
            from_display_name: Override display name (e.g. "Minjee Song via Scopit")
            cc_emails: Addresses to Cc, visible to all recipients
            bcc_emails: Addresses to Bcc, invisible to all other recipients

        Returns:
            True if email was sent successfully, False otherwise
        """
        cc_emails = cc_emails or []
        bcc_emails = bcc_emails or []

        if not self.is_configured():
            logger.warning("Email service is not configured. Skipping email send.")
            # In development, log the email content instead
            if settings.DEBUG:
                logger.info(f"[DEBUG EMAIL] To: {to_email}")
                logger.info(f"[DEBUG EMAIL] Cc: {cc_emails}")
                logger.info(f"[DEBUG EMAIL] Bcc: {bcc_emails}")
                logger.info(f"[DEBUG EMAIL] Subject: {subject}")
                logger.info(f"[DEBUG EMAIL] Reply-To: {reply_to}")
                logger.info(f"[DEBUG EMAIL] Content: {html_content[:500]}...")
            return True  # Return True in dev to not block registration

        try:
            # Create message — use "mixed" when attachments are present
            if attachments:
                message = MIMEMultipart("mixed")
                body_part = MIMEMultipart("alternative")
                if text_content:
                    body_part.attach(MIMEText(text_content, "plain"))
                body_part.attach(MIMEText(html_content, "html"))
                message.attach(body_part)

                for att in attachments:
                    part = MIMEBase(
                        att.get("mime_type", "application").split("/")[0],
                        att.get("mime_type", "application/octet-stream").split("/")[-1],
                    )
                    part.set_payload(att["data"])
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        "attachment",
                        filename=att.get("filename", "attachment"),
                    )
                    message.attach(part)
            else:
                message = MIMEMultipart("alternative")
                if text_content:
                    message.attach(MIMEText(text_content, "plain"))
                message.attach(MIMEText(html_content, "html"))

            message["Subject"] = subject
            display_name = from_display_name or self.from_name
            message["From"] = f"{display_name} <{self.from_email}>"
            message["To"] = to_email
            if cc_emails:
                message["Cc"] = ", ".join(cc_emails)
            if reply_to:
                message["Reply-To"] = reply_to
            # Bcc is deliberately never set as a header -- SMTP RCPT TO below
            # is what actually delivers it; a header would leak it to everyone.

            # Send email
            context = ssl.create_default_context()

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls(context=context)
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(
                    self.from_email,
                    [to_email, *cc_emails, *bcc_emails],
                    message.as_string()
                )

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {str(e)}")
            return False

    def _base_template(self, *, title: str, preheader: str, body_html: str) -> str:
        """
        Shared table-based, inline-CSS HTML shell for all transactional emails.
        Keeps every email visually consistent (wordmark, accent border, footer)
        without each template re-declaring the outer chrome.
        """
        year = datetime.now().year
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{title}</title>
{_RESPONSIVE_STYLE}
</head>
<body style="margin:0; padding:0; background-color:{COLOR_BG}; font-family:{FONT_STACK_BODY};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    {preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG};">
    <tr>
      <td align="center" style="padding:48px 20px;">
        <table role="presentation" class="sc-container" width="560" cellpadding="0" cellspacing="0"
               style="width:560px; max-width:560px; background-color:#ffffff; border:1px solid {COLOR_BORDER}; border-top:4px solid {COLOR_PRIMARY}; border-radius:12px;">
          <tr>
            <td class="sc-padded" style="padding:32px 40px 20px 40px;">
              <span style="font-family:{FONT_STACK_HEADING}; font-size:19px; font-weight:800; letter-spacing:-0.3px; color:{COLOR_PRIMARY};">
                Scope<span style="color:{COLOR_FAINT};">It</span>
              </span>
            </td>
          </tr>
          <tr>
            <td class="sc-padded" style="padding:0 40px 8px 40px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td class="sc-padded" style="padding:20px 40px 32px 40px; border-top:1px solid {COLOR_BORDER};">
              <p style="margin:0; color:{COLOR_FAINT}; font-size:12px; line-height:1.6; font-family:{FONT_STACK_BODY};">
                &copy; {year} {settings.APP_NAME}. All rights reserved.<br>
                This is a transactional email related to your {settings.APP_NAME} account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    def send_verification_code_email(
        self,
        to_email: str,
        user_name: str,
        code: str,
        expires_in_minutes: int = 10,
    ) -> bool:
        """
        Send the 6-digit email verification code issued at signup.

        Args:
            to_email: New user's email
            user_name: User's display name
            code: The plaintext 6-digit code (never stored, only ever emailed)
            expires_in_minutes: How long the code remains valid

        Returns:
            True if sent successfully
        """
        subject = f"Your {settings.APP_NAME} verification code: {code}"

        body_html = f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <h1 style="margin:0 0 14px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY}; letter-spacing:-0.3px;">
        Verify your email
      </h1>
      <p style="margin:0 0 28px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY};">
        Hi {user_name}, enter this code to finish setting up your {settings.APP_NAME} account.
      </p>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding-bottom:16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:10px;">
        <tr>
          <td style="padding:20px 30px; font-family:{FONT_STACK_MONO}; font-size:34px; font-weight:700; letter-spacing:10px; color:{COLOR_PRIMARY}; text-align:center;">
            {code}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding-bottom:28px;">
      <p style="margin:0; color:{COLOR_MUTED}; font-size:13px; font-family:{FONT_STACK_BODY};">
        Expires in {expires_in_minutes} minutes
      </p>
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid {COLOR_BORDER}; padding-top:20px;">
      <p style="margin:0; color:{COLOR_FAINT}; font-size:13px; line-height:1.6; font-family:{FONT_STACK_BODY};">
        Didn't request this? You can safely ignore this email — your account stays secure.
      </p>
    </td>
  </tr>
</table>
"""

        html_content = self._base_template(
            title=subject,
            preheader=f"Your verification code is {code} — expires in {expires_in_minutes} minutes.",
            body_html=body_html,
        )

        text_content = (
            f"Verify your email\n\n"
            f"Hi {user_name}, enter this code to finish setting up your {settings.APP_NAME} account:\n\n"
            f"    {code}\n\n"
            f"Expires in {expires_in_minutes} minutes.\n\n"
            f"Didn't request this? You can safely ignore this email — your account stays secure."
        )

        return self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
        )

    def send_welcome_email(self, to_email: str, user_name: str) -> bool:
        """
        Send welcome email to new user

        Args:
            to_email: New user's email
            user_name: User's display name

        Returns:
            True if sent successfully
        """
        subject = f"Welcome to {settings.APP_NAME}! 🎉"

        features = [
            "Create detailed estimates with line items",
            "Convert estimates to invoices with one click",
            "Manage your customer database",
            "Build your company's line item library",
        ]
        feature_rows = "\n".join(
            f"""
      <tr>
        <td width="20" valign="top" style="padding:7px 10px 7px 0;">
          <span style="display:inline-block; width:6px; height:6px; margin-top:8px; background-color:{COLOR_PRIMARY}; border-radius:1px;"></span>
        </td>
        <td style="padding:7px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.6; font-family:{FONT_STACK_BODY};">{feature}</td>
      </tr>"""
            for feature in features
        )

        body_html = f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <h1 style="margin:0 0 20px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY}; letter-spacing:-0.3px;">
        Welcome to {settings.APP_NAME}!
      </h1>
      <p style="margin:0 0 18px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY};">
        Hi {user_name}, your email is verified and your account is ready. We're excited to have you on board.
      </p>
      <p style="margin:0 0 6px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY};">
        {settings.APP_NAME} helps restoration contractors create professional estimates quickly and easily. Here's what you can do:
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:6px 0 8px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        {feature_rows}
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:28px 0 24px 0;">
      <a href="{settings.FRONTEND_URL}/app/dashboard"
         style="display:inline-block; background-color:{COLOR_PRIMARY}; color:#ffffff; text-decoration:none; padding:14px 34px; border-radius:8px; font-family:{FONT_STACK_HEADING}; font-size:15px; font-weight:700;">
        Get Started &rarr;
      </a>
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid {COLOR_BORDER}; padding-top:20px;">
      <p style="margin:0; color:{COLOR_MUTED}; font-size:14px; line-height:1.6; font-family:{FONT_STACK_BODY};">
        Questions? Just reply to this email — our team is happy to help.
      </p>
    </td>
  </tr>
</table>
"""

        html_content = self._base_template(
            title=subject,
            preheader=f"Your {settings.APP_NAME} account is ready to go.",
            body_html=body_html,
        )

        text_content = f"""Welcome to {settings.APP_NAME}!

Hi {user_name},

Your email is verified and your account is ready. We're excited to have you on board.

{settings.APP_NAME} helps restoration contractors create professional estimates quickly and easily. Here's what you can do:

- Create detailed estimates with line items
- Convert estimates to invoices with one click
- Manage your customer database
- Build your company's line item library

Get started: {settings.FRONTEND_URL}/app/dashboard

Questions? Just reply to this email — our team is happy to help.

Best regards,
The {settings.APP_NAME} Team
"""

        return self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
        )

    def send_signup_notification_email(
        self,
        *,
        to_email: str,
        user_email: str,
        user_name: str,
        company_name: Optional[str] = None,
        occupation: Optional[str] = None,
        location: Optional[str] = None,
        signup_method: str = "email",
        signup_number: Optional[int] = None,
    ) -> bool:
        """
        Notify the internal team that a new account finished signup.

        Sent once per account, at the point it becomes a real user (email
        verified, or a first Google sign-in) rather than at /register, so
        abandoned half-signups don't generate noise.

        Args:
            to_email: Internal address to notify
            user_email: The new user's email
            user_name: The new user's display name
            company_name: Company created for/with the account
            occupation: Self-reported occupation, when collected
            location: "City, ST" resolved from the signup IP, when available
            signup_method: "email" or "google"
            signup_number: Total user count including this one (so the
                subject line alone answers "how many signups do we have?")

        Returns:
            True if sent successfully
        """
        if not to_email:
            return False

        method_label = "Google" if signup_method == "google" else "Email"
        count_suffix = f" (#{signup_number})" if signup_number else ""
        subject = f"[{settings.APP_NAME}] New signup{count_suffix}: {user_email}"

        # Every value below is user-controlled, so escape before interpolating.
        fields = [
            ("Name", user_name),
            ("Email", user_email),
            ("Company", company_name),
            ("Occupation", occupation),
            ("Location", location),
            ("Signed up via", method_label),
        ]
        rows = "\n".join(
            f"""
        <tr>
          <td style="padding:7px 0; color:{COLOR_MUTED}; font-size:13px; line-height:1.6; font-family:{FONT_STACK_BODY}; white-space:nowrap;" valign="top">{html.escape(label)}</td>
          <td style="padding:7px 0 7px 20px; color:{COLOR_PRIMARY}; font-size:14px; line-height:1.6; font-family:{FONT_STACK_BODY}; word-break:break-word;" valign="top">{html.escape(str(value))}</td>
        </tr>"""
            for label, value in fields
            if value
        )

        body_html = f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <h1 style="margin:0 0 14px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY}; letter-spacing:-0.3px;">
        New signup{html.escape(count_suffix)}
      </h1>
      <p style="margin:0 0 24px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY};">
        Someone just finished creating a {settings.APP_NAME} account.
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:10px; padding:8px 20px;">
        {rows}
      </table>
    </td>
  </tr>
  <tr>
    <td align="center" style="padding:28px 0 24px 0;">
      <a href="{settings.FRONTEND_URL}/admin/users"
         style="display:inline-block; background-color:{COLOR_PRIMARY}; color:#ffffff; text-decoration:none; padding:14px 34px; border-radius:8px; font-family:{FONT_STACK_HEADING}; font-size:15px; font-weight:700;">
        View in admin &rarr;
      </a>
    </td>
  </tr>
</table>
"""

        html_content = self._base_template(
            title=subject,
            preheader=f"{user_email} signed up via {method_label}.",
            body_html=body_html,
        )

        text_lines = [f"New signup{count_suffix}", ""]
        text_lines += [f"{label}: {value}" for label, value in fields if value]
        text_lines += ["", f"Admin: {settings.FRONTEND_URL}/admin/users"]
        text_content = "\n".join(text_lines)

        return self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
        )

    def send_document_email(
        self,
        to_email: str,
        document_type: str,
        document_number: str,
        company_name: str,
        customer_name: str,
        total: str,
        pdf_data: bytes,
        pdf_filename: str,
        sender_name: Optional[str] = None,
        sender_email: Optional[str] = None,
        message: Optional[str] = None,
        subject: Optional[str] = None,
        cc_emails: Optional[list[str]] = None,
    ) -> bool:
        """
        Email an estimate or invoice PDF to a customer.

        Args:
            to_email: Customer's email address
            document_type: "estimate" or "invoice" (controls wording only)
            document_number: e.g. "EST-0001" or "INV-0042"
            company_name: Sending company's display name
            customer_name: Customer's display name
            total: Pre-formatted total amount (e.g. "$1,234.56")
            pdf_data: Rendered PDF bytes to attach
            pdf_filename: Attachment filename
            sender_name: The user who triggered the send (for From/reply context)
            sender_email: Reply-To address so customer replies reach the sender
            message: Optional custom note from the sender, shown above the summary
            subject: Optional subject override
            cc_emails: Additional recipients to Cc

        Returns:
            True if sent successfully
        """
        label = "Estimate" if document_type == "estimate" else "Invoice"
        subject = subject or f"{label} {document_number} from {company_name}"

        message_block = ""
        if message:
            message_block = f"""
      <p style="margin:0 0 20px 0; padding:16px 18px; background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:8px; color:{COLOR_TEXT}; font-size:14px; line-height:1.6; font-family:{FONT_STACK_BODY}; white-space:pre-wrap;">{message}</p>"""

        body_html = f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>
      <h1 style="margin:0 0 14px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY}; letter-spacing:-0.3px;">
        {label} {document_number}
      </h1>
      <p style="margin:0 0 18px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65; font-family:{FONT_STACK_BODY};">
        Hi {customer_name}, {company_name} has sent you {'an' if document_type == 'estimate' else 'an'} {document_type} for your review. The full details are in the attached PDF.
      </p>
      {message_block}
    </td>
  </tr>
  <tr>
    <td style="padding-bottom:24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:10px;">
        <tr>
          <td style="padding:18px 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:{COLOR_MUTED}; font-size:13px; font-family:{FONT_STACK_BODY};">{label} Number</td>
                <td align="right" style="color:{COLOR_PRIMARY}; font-size:13px; font-weight:600; font-family:{FONT_STACK_BODY};">{document_number}</td>
              </tr>
              <tr>
                <td style="padding-top:8px; color:{COLOR_MUTED}; font-size:13px; font-family:{FONT_STACK_BODY};">Total</td>
                <td align="right" style="padding-top:8px; color:{COLOR_PRIMARY}; font-size:15px; font-weight:700; font-family:{FONT_STACK_BODY};">{total}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid {COLOR_BORDER}; padding-top:20px;">
      <p style="margin:0; color:{COLOR_FAINT}; font-size:13px; line-height:1.6; font-family:{FONT_STACK_BODY};">
        A copy of this {document_type} is attached as a PDF. Questions? Just reply to this email.
      </p>
    </td>
  </tr>
</table>
"""

        html_content = self._base_template(
            title=subject,
            preheader=f"{label} {document_number} — {total}",
            body_html=body_html,
        )

        text_lines = [
            f"{label} {document_number}",
            "",
            f"Hi {customer_name}, {company_name} has sent you {'an' if document_type == 'estimate' else 'an'} {document_type} for your review. The full details are in the attached PDF.",
        ]
        if message:
            text_lines += ["", message]
        text_lines += [
            "",
            f"{label} Number: {document_number}",
            f"Total: {total}",
            "",
            f"A copy of this {document_type} is attached as a PDF. Questions? Just reply to this email.",
        ]
        text_content = "\n".join(text_lines)

        return self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            reply_to=sender_email,
            from_display_name=f"{sender_name} via {settings.APP_NAME}" if sender_name else None,
            attachments=[{
                "data": pdf_data,
                "filename": pdf_filename,
                "mime_type": "application/pdf",
            }],
            cc_emails=cc_emails or [],
        )


# Singleton instance
email_service = EmailService()
