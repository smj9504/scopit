"""
Scopit - Packing Lead API

Anonymous "packing estimate" lead capture, gated behind signup:
    submit (public, no auth)
      -> verify-email (public, no auth; 6-digit code)
      -> [background AI vision analysis]
      -> status (public; reveals only a teaser once ready)
      -> claim (authenticated; materializes a real ToolSession)

Two routers, both mounted at the same prefix "/api/packing-leads" in main.py:
    router        - authenticated (claim)
    public_router - public, token-based (submit/verify-email/status/retry)
"""
import base64
import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from pydantic import ValidationError
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db, get_db_context
from app.core.dependencies import get_current_user, get_current_user_optional
from app.core.email import (
    COLOR_BG,
    COLOR_BORDER,
    COLOR_FAINT,
    COLOR_MUTED,
    COLOR_PRIMARY,
    COLOR_TEXT,
    FONT_STACK_BODY,
    FONT_STACK_HEADING,
    FONT_STACK_MONO,
    email_service,
)
from app.core.storage import get_storage
from app.domains.auth.verification import generate_verification_code, hash_code
from app.domains.tools.models import ToolFile
from app.domains.tools.modules.packing import vision
from app.domains.tools.modules.packing.lead_cleanup import cleanup_expired_leads
from app.domains.tools.modules.packing.lead_models import PackingLead, PackingLeadStatus
from app.domains.tools.modules.packing.lead_schemas import (
    LeadClaimResponse,
    LeadProgress,
    LeadRetryResponse,
    LeadStatusResponse,
    LeadSubmitPayload,
    LeadSubmitResponse,
    LeadTeaser,
    LeadVerifyRequest,
    LeadVerifyResponse,
)
from app.domains.tools.service import ToolSessionService
from app.domains.user.models import User

logger = logging.getLogger(__name__)

router = APIRouter()
public_router = APIRouter()

limiter = Limiter(key_func=get_remote_address)

# ============================================
# CONSTANTS
# ============================================

MAX_ROOMS = settings.VISION_BATCH_MAX_ROOMS  # mirrors analyze-batch's own cap
MAX_PHOTOS_PER_ROOM = 10
MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MB
MAX_VERIFICATION_ATTEMPTS = 5
VERIFICATION_CODE_EXPIRY_MINUTES = 15
LEAD_INITIAL_EXPIRY_HOURS = 24
LEAD_VERIFIED_EXPIRY_DAYS = 14
STALE_ANALYSIS_MINUTES = 15
MAX_RETRY_COUNT = 2
SUPPORT_EMAIL = "hello@scopit.work"

# Friendly message shown when a returning account tries to claim a second free
# estimate. One claimed lead per account during beta (see claim_lead).
FREE_ESTIMATE_USED_MESSAGE = (
    "It looks like you've already used your free estimate on this account. "
    "During beta, each account gets one estimate on us — we'd love to keep "
    f"helping, so reach out at {SUPPORT_EMAIL} and we'll sort out more for you."
)


# ============================================
# HELPERS
# ============================================

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Postgres TIMESTAMPTZ columns round-trip as tz-aware via psycopg2, but
    guard defensively (e.g. SQLite in tests may return naive datetimes)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _get_active_lead(db: Session, token: str) -> PackingLead:
    """404 if the token doesn't resolve to a lead, or the lead has expired."""
    lead = db.query(PackingLead).filter(PackingLead.token == token).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if _aware(lead.expires_at) < _now():
        raise HTTPException(status_code=404, detail="Estimate not found")
    return lead


def _ext_for_upload(content_type: Optional[str], filename: Optional[str]) -> str:
    ct = (content_type or "").lower()
    mapped = {"image/png": ".png", "image/webp": ".webp"}.get(ct)
    if mapped:
        return mapped
    if filename and "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()
        if ext in (".png", ".webp", ".jpg", ".jpeg"):
            return ext
    return ".jpg"


def _media_type_for_key(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else "jpg"
    return {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def _build_lead_verification_email_html(code: str, expires_in_minutes: int) -> str:
    """Mirrors send_verification_code_email's look (same brand tokens) but
    addressed to a not-yet-registered visitor -- no user_name/account copy."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your {settings.APP_NAME} verification code</title>
</head>
<body style="margin:0; padding:0; background-color:{COLOR_BG}; font-family:{FONT_STACK_BODY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG};">
    <tr>
      <td align="center" style="padding:48px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="width:560px; max-width:560px; background-color:#ffffff; border:1px solid {COLOR_BORDER}; border-top:4px solid {COLOR_PRIMARY}; border-radius:12px;">
          <tr>
            <td style="padding:32px 40px 20px 40px;">
              <span style="font-family:{FONT_STACK_HEADING}; font-size:19px; font-weight:800; letter-spacing:-0.3px; color:{COLOR_PRIMARY};">
                Scope<span style="color:{COLOR_FAINT};">It</span>
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 8px 40px;">
              <h1 style="margin:0 0 14px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY};">
                Verify your email
              </h1>
              <p style="margin:0 0 28px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65;">
                Enter this code to view your packing estimate.
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
            <td align="center" style="padding-bottom:28px 40px 32px 40px;">
              <p style="margin:0; color:{COLOR_MUTED}; font-size:13px;">
                Expires in {expires_in_minutes} minutes
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px; border-top:1px solid {COLOR_BORDER}; padding-top:20px;">
              <p style="margin:0; color:{COLOR_FAINT}; font-size:13px; line-height:1.6;">
                Didn't request this? You can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _send_lead_verification_email(to_email: str, code: str) -> bool:
    subject = f"Your {settings.APP_NAME} verification code: {code}"
    html_content = _build_lead_verification_email_html(code, VERIFICATION_CODE_EXPIRY_MINUTES)
    text_content = (
        f"Enter this code to view your packing estimate:\n\n"
        f"    {code}\n\n"
        f"Expires in {VERIFICATION_CODE_EXPIRY_MINUTES} minutes."
    )
    return email_service.send_email(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
    )


def _join_address(line1, line2, city, state, zipcode) -> str:
    """Join structured address parts into a single display line for
    notification emails (which render one row/line per field, not a
    multi-line address block)."""
    csz = ", ".join(filter(None, [city, " ".join(filter(None, [state, zipcode]))]))
    parts = [p for p in [line1, line2, csz] if p]
    return ", ".join(parts)


def _esc(value: Optional[str]) -> str:
    """Minimal HTML escaping for user-supplied text dropped into the admin
    notification email (contact/company/property fields are free-form)."""
    if not value:
        return "—"
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _build_lead_notification_email_html(lead: PackingLead, room_count: int, photo_count: int) -> str:
    """Internal-facing notification sent to the team when a new anonymous lead
    is submitted on the public packing-estimate form."""
    def row(label: str, value: str) -> str:
        return f"""
          <tr>
            <td style="padding:6px 16px 6px 0; color:{COLOR_MUTED}; font-size:13px; white-space:nowrap; vertical-align:top;">{label}</td>
            <td style="padding:6px 0; color:{COLOR_TEXT}; font-size:14px; font-weight:600;">{value}</td>
          </tr>"""

    rows = "".join([
        row("Email", _esc(lead.contact_email)),
        row("Phone", _esc(lead.contact_phone)),
        row("Company", _esc(lead.company_name)),
        row("Company phone", _esc(lead.company_phone)),
        row("Company address", _esc(_join_address(
            lead.company_address_line1, lead.company_address_line2,
            lead.company_city, lead.company_state, lead.company_zipcode,
        ))),
        row("Property address", _esc(_join_address(
            lead.property_address_line1, lead.property_address_line2,
            lead.property_city, lead.property_state, lead.property_zipcode,
        ))),
        row("Rooms", str(room_count)),
        row("Photos", str(photo_count)),
    ])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New packing estimate lead</title>
</head>
<body style="margin:0; padding:0; background-color:{COLOR_BG}; font-family:{FONT_STACK_BODY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG};">
    <tr>
      <td align="center" style="padding:48px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="width:560px; max-width:560px; background-color:#ffffff; border:1px solid {COLOR_BORDER}; border-top:4px solid {COLOR_PRIMARY}; border-radius:12px;">
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <span style="font-family:{FONT_STACK_HEADING}; font-size:19px; font-weight:800; letter-spacing:-0.3px; color:{COLOR_PRIMARY};">
                Scope<span style="color:{COLOR_FAINT};">It</span>
              </span>
              <h1 style="margin:16px 0 8px 0; font-family:{FONT_STACK_HEADING}; font-size:21px; font-weight:800; color:{COLOR_PRIMARY};">
                New packing estimate lead
              </h1>
              <p style="margin:0 0 20px 0; color:{COLOR_TEXT}; font-size:14px; line-height:1.6;">
                A new visitor just submitted the public packing-estimate form.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background-color:{COLOR_BG}; border:1px solid {COLOR_BORDER}; border-radius:10px; padding:8px 16px;">
                {rows}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _send_lead_notification_email(lead: PackingLead, room_count: int, photo_count: int) -> bool:
    """Notify the internal team of a newly submitted lead. Best-effort: a
    failure here must never block the visitor's submission."""
    to_email = (settings.PACKING_LEAD_NOTIFY_EMAIL or "").strip()
    if not to_email:
        return False

    company = (lead.company_name or "").strip()
    subject = (
        f"[{settings.APP_NAME}] New packing lead: {company or lead.contact_email}"
    )
    html_content = _build_lead_notification_email_html(lead, room_count, photo_count)
    text_content = (
        "A new visitor just submitted the public packing-estimate form.\n\n"
        f"Email:            {lead.contact_email}\n"
        f"Phone:            {lead.contact_phone or '-'}\n"
        f"Company:          {lead.company_name or '-'}\n"
        f"Company phone:    {lead.company_phone or '-'}\n"
        f"Company address:  {_join_address(lead.company_address_line1, lead.company_address_line2, lead.company_city, lead.company_state, lead.company_zipcode) or '-'}\n"
        f"Property address: {_join_address(lead.property_address_line1, lead.property_address_line2, lead.property_city, lead.property_state, lead.property_zipcode) or '-'}\n"
        f"Rooms:            {room_count}\n"
        f"Photos:           {photo_count}\n"
    )
    return email_service.send_email(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
        reply_to=lead.contact_email,
    )


def _build_lead_ready_email_html(result_url: str) -> str:
    """Sent to the visitor once background analysis finishes, so someone who
    closed the tab mid-analysis has a link back to their estimate."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your {settings.APP_NAME} packing estimate is ready</title>
</head>
<body style="margin:0; padding:0; background-color:{COLOR_BG}; font-family:{FONT_STACK_BODY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{COLOR_BG};">
    <tr>
      <td align="center" style="padding:48px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="width:560px; max-width:560px; background-color:#ffffff; border:1px solid {COLOR_BORDER}; border-top:4px solid {COLOR_PRIMARY}; border-radius:12px;">
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <span style="font-family:{FONT_STACK_HEADING}; font-size:19px; font-weight:800; letter-spacing:-0.3px; color:{COLOR_PRIMARY};">
                Scope<span style="color:{COLOR_FAINT};">It</span>
              </span>
              <h1 style="margin:16px 0 8px 0; font-family:{FONT_STACK_HEADING}; font-size:23px; font-weight:800; color:{COLOR_PRIMARY};">
                Your estimate is ready
              </h1>
              <p style="margin:0 0 24px 0; color:{COLOR_TEXT}; font-size:15px; line-height:1.65;">
                We finished analyzing your room photos. Open your estimate to see the
                full breakdown and create a free account to save it.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 8px 40px;">
              <a href="{result_url}"
                 style="display:inline-block; background-color:{COLOR_PRIMARY}; color:#ffffff; text-decoration:none; padding:14px 34px; border-radius:8px; font-family:{FONT_STACK_HEADING}; font-size:15px; font-weight:700;">
                View my estimate &rarr;
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 32px 40px;">
              <p style="margin:0; color:{COLOR_FAINT}; font-size:13px; line-height:1.6;">
                Or paste this link into your browser:<br>
                <span style="color:{COLOR_MUTED};">{result_url}</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _send_lead_ready_email(lead: PackingLead) -> bool:
    result_url = f"{settings.FRONTEND_URL}/packing-estimate/result/{lead.token}"
    subject = f"Your {settings.APP_NAME} packing estimate is ready"
    html_content = _build_lead_ready_email_html(result_url)
    text_content = (
        "Your packing estimate is ready.\n\n"
        "We finished analyzing your room photos. Open your estimate here to see the "
        "full breakdown and create a free account to save it:\n\n"
        f"    {result_url}\n"
    )
    return email_service.send_email(
        to_email=lead.contact_email,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
    )


def _check_daily_cap_available(db: Session) -> bool:
    since = _now() - timedelta(hours=24)
    count = (
        db.query(PackingLead)
        .filter(
            PackingLead.analysis_started_at.isnot(None),
            PackingLead.analysis_started_at >= since,
        )
        .count()
    )
    return count < settings.PACKING_LEAD_DAILY_CAP


def _start_or_defer_analysis(
    db: Session, lead: PackingLead, background_tasks: BackgroundTasks,
) -> dict:
    """Shared by verify-email's success path and retry(): either schedules
    the background analysis job (status=analyzing) or fails fast with a
    capacity message if the daily cap is already hit."""
    if _check_daily_cap_available(db):
        lead.status = PackingLeadStatus.ANALYZING.value
        lead.analysis_started_at = _now()
        lead.analysis_completed_rooms = 0
        lead.analysis_processed_photos = 0
        lead.error_message = None
        db.commit()
        background_tasks.add_task(_run_analysis, lead.id)
    else:
        lead.status = PackingLeadStatus.FAILED.value
        lead.error_message = (
            "We're at capacity for free analyses today — please try again tomorrow."
        )
        db.commit()

    return {"status": lead.status, "error_message": lead.error_message}


def _compute_teaser(lead: PackingLead) -> LeadTeaser:
    rooms = (lead.ai_result or {}).get("rooms", [])
    room_count = len(lead.rooms_input or [])
    item_count = 0
    for room in rooms:
        result = room.get("result") or {}
        for item in result.get("items", []):
            item_count += item.get("quantity", 1)

    if room_count <= 2:
        size_category = "small"
    elif room_count <= 5:
        size_category = "medium"
    else:
        size_category = "large"

    return LeadTeaser(room_count=room_count, item_count=item_count, size_category=size_category)


def _compute_progress(lead: PackingLead) -> LeadProgress:
    rooms = lead.rooms_input or []
    total_rooms = len(rooms)
    total_photos = sum(len(r.get("photo_keys") or []) for r in rooms)
    completed_rooms = min(lead.analysis_completed_rooms or 0, total_rooms)
    processed_photos = min(lead.analysis_processed_photos or 0, total_photos)

    # The room currently being analyzed is the first not-yet-completed one.
    current_room: Optional[str] = None
    if completed_rooms < total_rooms:
        current_room = rooms[completed_rooms].get("room_name") or None

    return LeadProgress(
        total_rooms=total_rooms,
        completed_rooms=completed_rooms,
        total_photos=total_photos,
        processed_photos=processed_photos,
        current_room=current_room,
    )


# ============================================
# BACKGROUND ANALYSIS JOB
# ============================================

async def _run_analysis(lead_id) -> None:
    """Runs after the HTTP response is sent -- needs its own fresh DB
    session (the request-scoped one is already closed by then)."""
    with get_db_context() as db:
        lead = db.query(PackingLead).filter(PackingLead.id == lead_id).first()
        if not lead:
            return

        storage = get_storage()
        rooms_result: list = []
        any_success = False

        try:
            for room in (lead.rooms_input or []):
                room_name = room.get("room_name", "")
                keys = room.get("photo_keys") or []

                images: list = []
                for key in keys:
                    try:
                        raw = storage.read(key)
                    except Exception:
                        continue
                    media_type = _media_type_for_key(key)
                    b64 = base64.b64encode(raw).decode("ascii")
                    images.append(f"data:{media_type};base64,{b64}")

                if not images:
                    rooms_result.append({
                        "room_name": room_name,
                        "status": "error",
                        "result": None,
                        "error_message": "No photos available for this room",
                    })
                else:
                    resp, err_code, err_msg = await vision.analyze_room_with_retry(
                        room_name=room_name,
                        images=images,
                        max_retries=settings.VISION_RATE_LIMIT_RETRIES,
                        base_delay=settings.VISION_RATE_LIMIT_BASE_DELAY,
                    )

                    if resp is not None:
                        any_success = True
                        rooms_result.append({
                            "room_name": room_name,
                            "status": "success",
                            "result": resp.model_dump(),
                            "error_message": None,
                        })
                    else:
                        rooms_result.append({
                            "room_name": room_name,
                            "status": "error",
                            "result": None,
                            "error_message": err_msg,
                        })

                # Persist progress after each room so the status endpoint can
                # show "room X of Y" live while later rooms are still running.
                lead.analysis_completed_rooms = (lead.analysis_completed_rooms or 0) + 1
                lead.analysis_processed_photos = (lead.analysis_processed_photos or 0) + len(keys)
                db.commit()

            if any_success:
                lead.ai_result = {"rooms": rooms_result}
                lead.status = PackingLeadStatus.READY.value
                lead.error_message = None
            else:
                lead.status = PackingLeadStatus.FAILED.value
                lead.error_message = "Photo analysis failed for every room."
            db.commit()
        except Exception as exc:  # noqa: BLE001 -- must never crash the worker
            logger.exception("packing lead analysis failed for lead %s", lead_id)
            lead.status = PackingLeadStatus.FAILED.value
            lead.error_message = str(exc)
            db.commit()

        # Best-effort "your estimate is ready" email so a visitor who closed
        # the tab mid-analysis has a link back. Never let a mail failure affect
        # the analysis result that was just committed above.
        if lead.status == PackingLeadStatus.READY.value:
            try:
                _send_lead_ready_email(lead)
            except Exception:
                logger.exception("Failed to send packing lead ready email for %s", lead_id)


# ===========================================================================
# Public endpoints  (prefix: /api/packing-leads)
# ===========================================================================


@public_router.post("/submit", response_model=LeadSubmitResponse, status_code=201)
@limiter.limit(settings.PACKING_LEAD_RATE_LIMIT)
async def submit_lead(
    request: Request,
    payload: str = Form(...),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Anonymous entry point: contact info + per-room photos. No auth."""
    cleanup_expired_leads(db)

    try:
        data = LeadSubmitPayload(**json.loads(payload))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {exc}") from exc

    # Idempotency: a resubmit with the same key returns the existing lead.
    existing = (
        db.query(PackingLead)
        .filter(PackingLead.idempotency_key == data.idempotency_key)
        .first()
    )
    if existing:
        return LeadSubmitResponse(token=existing.token)

    # ---- Validate caps BEFORE storing anything ----
    if not data.rooms:
        raise HTTPException(status_code=400, detail="At least one room is required")
    if len(data.rooms) > MAX_ROOMS:
        raise HTTPException(status_code=400, detail=f"Too many rooms (max {MAX_ROOMS})")
    for room in data.rooms:
        if room.photo_count > MAX_PHOTOS_PER_ROOM:
            raise HTTPException(
                status_code=400,
                detail=f"Too many photos for room '{room.room_name}' (max {MAX_PHOTOS_PER_ROOM})",
            )

    total_expected = sum(r.photo_count for r in data.rooms)
    if len(photos) != total_expected:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {total_expected} photo(s) across rooms, received {len(photos)}",
        )

    photo_payloads: list = []
    for f in photos:
        content = await f.read()
        if len(content) > MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Photo '{f.filename}' exceeds the {MAX_PHOTO_BYTES // (1024 * 1024)}MB limit",
            )
        content_type = f.content_type or ""
        if not content_type.startswith("image/"):
            raise HTTPException(
                status_code=400, detail=f"File '{f.filename}' is not a supported image type",
            )
        photo_payloads.append((content, content_type, f.filename))

    lead_id = uuid.uuid4()
    token = secrets.token_urlsafe(32)
    now = _now()

    storage = get_storage()
    rooms_input: list = []
    idx = 0
    for room in data.rooms:
        keys: list = []
        for _ in range(room.photo_count):
            content, content_type, filename = photo_payloads[idx]
            idx += 1
            ext = _ext_for_upload(content_type, filename)
            key = f"leads/packing/{lead_id}/{uuid.uuid4()}{ext}"
            storage.write(key, content, content_type=content_type or "image/jpeg")
            keys.append(key)
        rooms_input.append({"room_name": room.room_name, "photo_keys": keys})

    code = generate_verification_code()
    lead = PackingLead(
        id=lead_id,
        token=token,
        idempotency_key=data.idempotency_key,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        company_name=data.company_name,
        company_phone=data.company_phone,
        company_address_line1=data.company_address_line1,
        company_address_line2=data.company_address_line2,
        company_city=data.company_city,
        company_state=data.company_state,
        company_zipcode=data.company_zipcode,
        property_address_line1=data.property_address_line1,
        property_address_line2=data.property_address_line2,
        property_city=data.property_city,
        property_state=data.property_state,
        property_zipcode=data.property_zipcode,
        rooms_input=rooms_input,
        status=PackingLeadStatus.PENDING_VERIFICATION.value,
        verification_code_hash=hash_code(code),
        verification_attempts=0,
        verification_expires_at=now + timedelta(minutes=VERIFICATION_CODE_EXPIRY_MINUTES),
        expires_at=now + timedelta(hours=LEAD_INITIAL_EXPIRY_HOURS),
    )
    db.add(lead)
    try:
        db.commit()
    except Exception:
        # Race: another concurrent request with the same idempotency_key won.
        db.rollback()
        existing = (
            db.query(PackingLead)
            .filter(PackingLead.idempotency_key == data.idempotency_key)
            .first()
        )
        if existing:
            return LeadSubmitResponse(token=existing.token)
        raise

    try:
        _send_lead_verification_email(data.contact_email, code)
    except Exception:
        logger.exception("Failed to send packing lead verification email")

    # Best-effort internal notification -- a new visitor just came in. Must
    # never block or fail the visitor's own submission.
    try:
        _send_lead_notification_email(lead, len(rooms_input), len(photos))
    except Exception:
        logger.exception("Failed to send packing lead notification email")

    return LeadSubmitResponse(token=token)


@public_router.post("/{token}/verify-email", response_model=LeadVerifyResponse)
@limiter.limit(settings.PACKING_LEAD_RATE_LIMIT)
async def verify_lead_email(
    token: str,
    data: LeadVerifyRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    lead = _get_active_lead(db, token)
    now = _now()

    if lead.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect attempts. Please submit the form again to request a new code.",
        )

    expires_at = _aware(lead.verification_expires_at)
    if (
        not lead.verification_code_hash
        or expires_at is None
        or expires_at < now
        or hash_code(data.code.strip()) != lead.verification_code_hash
    ):
        lead.verification_attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    lead.verified_at = now
    lead.expires_at = now + timedelta(days=LEAD_VERIFIED_EXPIRY_DAYS)
    db.commit()

    result = _start_or_defer_analysis(db, lead, background_tasks)
    return LeadVerifyResponse(**result)


@public_router.get("/{token}/status", response_model=LeadStatusResponse)
async def get_lead_status(
    token: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    cleanup_expired_leads(db)
    lead = _get_active_lead(db, token)

    # Stale-job recovery: a background task that never completed (worker
    # restart, crash, etc.) shouldn't leave the lead stuck "analyzing" forever.
    if (
        lead.status == PackingLeadStatus.ANALYZING.value
        and lead.ai_result is None
        and lead.analysis_started_at is not None
    ):
        started = _aware(lead.analysis_started_at)
        if started < _now() - timedelta(minutes=STALE_ANALYSIS_MINUTES):
            lead.status = PackingLeadStatus.FAILED.value
            lead.error_message = "Analysis didn't complete — please retry."
            db.commit()

    if lead.status != PackingLeadStatus.READY.value:
        return LeadStatusResponse(
            status=lead.status,
            can_retry=(
                lead.status == PackingLeadStatus.FAILED.value
                and lead.retry_count < MAX_RETRY_COUNT
            ),
            error_message=lead.error_message,
            progress=(
                _compute_progress(lead)
                if lead.status == PackingLeadStatus.ANALYZING.value
                else None
            ),
        )

    # Ready: teaser only. ai_result/pricing is NEVER returned here, auth or not.
    # contact_email/company_name are echoed back so the signup form can pre-fill
    # them (email already verified -> shown locked on the register page).
    #
    # Exact-match the user lookup (not case-insensitive) so is_existing_user is
    # true exactly when a fresh registration with this email would conflict --
    # letting the client offer "log in and continue" instead of a doomed signup.
    is_existing_user = (
        db.query(User.id).filter(User.email == lead.contact_email).first() is not None
    )
    return LeadStatusResponse(
        status=lead.status,
        requires_auth=current_user is None,
        already_claimed=lead.claimed_by_user_id is not None,
        teaser=_compute_teaser(lead),
        contact_email=lead.contact_email,
        company_name=lead.company_name,
        is_existing_user=is_existing_user,
    )


@public_router.post("/{token}/retry", response_model=LeadRetryResponse)
@limiter.limit(settings.PACKING_LEAD_RATE_LIMIT)
async def retry_lead(
    token: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    lead = _get_active_lead(db, token)

    if lead.status != PackingLeadStatus.FAILED.value:
        raise HTTPException(status_code=409, detail="This estimate is not in a failed state.")
    if lead.retry_count >= MAX_RETRY_COUNT:
        raise HTTPException(
            status_code=409,
            detail=(
                "This estimate has already been retried the maximum number of times. "
                "Please contact support for help."
            ),
        )

    lead.retry_count += 1
    db.commit()

    result = _start_or_defer_analysis(db, lead, background_tasks)
    return LeadRetryResponse(**result)


@public_router.get("/address-autocomplete")
@limiter.limit("60/minute")
async def lead_address_autocomplete(request: Request, q: str):
    """Public address autocomplete for the anonymous lead form.

    Proxies Geoapify (free tier) so the unauthenticated packing-estimate page
    can suggest US street addresses. Mirrors the authenticated
    /tools/packing/address-autocomplete endpoint but requires no login.
    Fails soft (empty list) on any upstream error so typing never breaks.
    """
    import httpx

    api_key = settings.GEOAPIFY_API_KEY
    if not api_key or len(q.strip()) < 3:
        return []

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.geoapify.com/v1/geocode/autocomplete",
                params={
                    "text": q,
                    "type": "street",
                    "filter": "countrycode:us",
                    "format": "json",
                    "limit": 5,
                    "apiKey": api_key,
                },
            )
            if resp.status_code != 200:
                return []

            results = resp.json().get("results", [])
            return [
                {
                    "address": r.get("formatted", ""),
                    "street": r.get("address_line1", ""),
                    "city": r.get("city", ""),
                    "state": r.get("state", ""),
                    "zip": r.get("postcode", ""),
                }
                for r in results
                if r.get("formatted")
            ]
    except Exception:
        return []


# ===========================================================================
# Authenticated endpoints  (prefix: /api/packing-leads)
# ===========================================================================


@router.post("/{token}/claim", response_model=LeadClaimResponse)
async def claim_lead(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Materialize a ready, verified lead into a real, owned ToolSession.

    Deliberately does NOT call require_tool_access/ToolAccessService --
    claiming your own already-submitted, already-verified lead is not
    "invoking the tool" in the metered/plan-gated sense. A brand-new free
    signup with zero plan entitlements must still be able to claim their
    own lead; this is a narrow, intentional exception scoped only to this
    action. require_tool_access itself is untouched.
    """
    lead = _get_active_lead(db, token)

    if lead.status == PackingLeadStatus.CLAIMED.value:
        if lead.claimed_by_user_id == current_user.id and lead.claimed_tool_session_id:
            return LeadClaimResponse(tool_session_id=str(lead.claimed_tool_session_id))
        raise HTTPException(
            status_code=409, detail="This estimate has already been claimed.",
        )

    if lead.status != PackingLeadStatus.READY.value:
        raise HTTPException(
            status_code=409, detail=f"This estimate is not ready to claim (status={lead.status}).",
        )

    # Free-tier limit: one claimed estimate per account. If this account has
    # already claimed a *different* lead, kindly decline rather than granting a
    # second free estimate. (Re-claiming this same lead is handled above via the
    # CLAIMED idempotent early-return, so it never reaches here.)
    prior_claim = (
        db.query(PackingLead)
        .filter(
            PackingLead.claimed_by_user_id == current_user.id,
            PackingLead.id != lead.id,
        )
        .first()
    )
    if prior_claim is not None:
        raise HTTPException(status_code=409, detail=FREE_ESTIMATE_USED_MESSAGE)

    storage = get_storage()
    ai_rooms_by_name = {r.get("room_name"): r for r in (lead.ai_result or {}).get("rooms", [])}

    photo_rooms: list = []
    copied_files: list = []  # (new_key, size, media_type)

    for room in (lead.rooms_input or []):
        room_name = room.get("room_name", "")
        new_keys: list = []
        for old_key in (room.get("photo_keys") or []):
            try:
                data = storage.read(old_key)
            except Exception:
                logger.warning("claim: failed to read lead photo %s", old_key)
                continue
            media_type = _media_type_for_key(old_key)
            file_id = old_key.rsplit("/", 1)[-1]
            new_key = f"{current_user.company_id}/packing/photos/{file_id}"
            storage.write(new_key, data, content_type=media_type)
            new_keys.append(new_key)
            copied_files.append((new_key, len(data), media_type))

        ai_room = ai_rooms_by_name.get(room_name) or {}
        result = ai_room.get("result") or {} if ai_room.get("status") == "success" else {}

        photo_rooms.append({
            "room_name": room_name,
            "photos": [],
            "photo_keys": new_keys,
            "items": result.get("items", []),
            "low_confidence_items": result.get("low_confidence_items", []),
            "dismissed_items": [],
            "analyzed": bool(result),
            "field_notes": result.get("field_notes", []),
            "special_items": [],
            "custom_special_items": [],
            "usePreset": False,
            "hints": [],
            "hint_volume": {},
            "hint_qty": {},
        })

    session_service = ToolSessionService(db)
    session = session_service.create_session(
        company_id=current_user.company_id,
        user_id=current_user.id,
        tool_id="packing",
        name=(f"{lead.company_name} - Photo AI" if lead.company_name else "Photo AI Estimate"),
        data={
            "mode": "content",
            "client_info": {
                "name": None,
                "phone": lead.contact_phone,
                "email": lead.contact_email,
                "property_address_line1": lead.property_address_line1,
                "property_address_line2": lead.property_address_line2,
                "property_city": lead.property_city,
                "property_state": lead.property_state,
                "property_zipcode": lead.property_zipcode,
            },
            "company_override": {
                "name": lead.company_name,
                "phone": lead.company_phone,
                "address_line1": lead.company_address_line1,
                "address_line2": lead.company_address_line2,
                "city": lead.company_city,
                "state": lead.company_state,
                "zipcode": lead.company_zipcode,
                "email": lead.contact_email,
            },
            "photo_rooms": photo_rooms,
        },
    )

    for new_key, size, media_type in copied_files:
        db.add(ToolFile(
            session_id=session.id,
            company_id=current_user.company_id,
            file_name=new_key.rsplit("/", 1)[-1],
            file_path=new_key,
            file_type="image",
            file_size=size,
            mime_type=media_type,
        ))

    # Delete the lead-scoped copies now that they've been copied over --
    # no reason to keep two copies of someone's uploaded home photos.
    for room in (lead.rooms_input or []):
        for old_key in (room.get("photo_keys") or []):
            try:
                storage.delete(old_key)
            except Exception:
                pass

    lead.claimed_by_user_id = current_user.id
    lead.claimed_tool_session_id = session.id
    lead.status = PackingLeadStatus.CLAIMED.value
    db.commit()

    return LeadClaimResponse(tool_session_id=str(session.id))
