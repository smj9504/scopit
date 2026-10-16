"""
Scopit - E-Sign Service
"""
import base64
import hashlib
import html
import json
import logging
import os
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email import email_service
from app.core.storage import StorageBackend, get_storage
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.tools.modules.pdf_editor.field_registry import resolve_entity_value
from app.domains.tools.modules.pdf_editor.models import (
    PdfDocument,
    SignAuditEvent,
    SignRecipient,
    SignRequest,
)
from app.domains.tools.modules.pdf_editor.pdf_geometry import (
    enter_screen_space,
    local_frame,
    page_view,
)
from app.domains.tools.modules.pdf_editor.service import flatten_annotations_bytes

logger = logging.getLogger(__name__)

# Envelope statuses that block any further public access/action. A draft has
# not been sent yet, so its recipient links must not work either.
BLOCKED_STATUSES = ("draft", "cancelled", "expired", "declined")

# Envelope statuses that are still waiting on at least one recipient.
ACTIVE_STATUSES = ("sent", "viewed", "partially_signed")

# Reserved key inside SignRecipient.signed_field_values holding the
# recipient's initials image (base64 PNG). There is no dedicated column, and
# generated field keys never start with an underscore, so it can't collide.
INITIALS_KEY = "__initials__"

# Every burned signing timestamp is rendered in UTC and labelled as such.
SIGNED_TS_FORMAT = "%m/%d/%Y %I:%M %p UTC"

DEFAULT_EXPIRY_DAYS = 14


def _utc_naive(dt: Optional[datetime]) -> Optional[datetime]:
    """Normalize a (possibly tz-aware) timestamp to naive UTC. Naive input is
    assumed to already be UTC (that's how this module writes them)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _format_signed_ts(dt: Optional[datetime]) -> str:
    return (_utc_naive(dt) or datetime.utcnow()).strftime(SIGNED_TS_FORMAT)


class SignService:
    def __init__(self, db: Session):
        self.db = db
        self.storage: StorageBackend = get_storage()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _generate_token(self) -> str:
        return secrets.token_urlsafe(48)

    def _log_event(
        self,
        sign_request_id: UUID,
        event_type: str,
        recipient_id: UUID = None,
        actor_email: str = None,
        actor_ip: str = None,
        actor_user_agent: str = None,
        metadata: dict = None,
    ):
        event = SignAuditEvent(
            sign_request_id=sign_request_id,
            recipient_id=recipient_id,
            event_type=event_type,
            actor_email=actor_email,
            actor_ip=actor_ip,
            actor_user_agent=actor_user_agent,
            event_metadata=metadata or {},
        )
        self.db.add(event)

    def _resolve_by_token(self, token: str):
        """Resolve a public access token to (sign_request, recipient).

        Tries the per-recipient token first (the multi-recipient path);
        falls back to the legacy envelope-level access_token as a defensive
        safety net -- after the sign_recipients backfill migration every
        SignRequest has >=1 recipient sharing its old token, so this
        fallback should never actually trigger, but costs nothing to keep.
        """
        recipient = (
            self.db.query(SignRecipient)
            .filter(SignRecipient.access_token == token)
            .first()
        )
        if recipient:
            return recipient.sign_request, recipient

        sign_req = (
            self.db.query(SignRequest)
            .filter(SignRequest.access_token == token)
            .first()
        )
        if sign_req and sign_req.recipients:
            return sign_req, sign_req.recipients[0]
        return None, None

    def _build_prefill_data(
        self,
        field_definitions: list,
        customer: Optional[Customer],
        company: Optional[Company],
    ) -> dict:
        """Resolve every 'prefilled' field into a {field_key: value}
        snapshot. Called once at creation time; the result is stored
        verbatim and never recomputed (FR-3.2)."""
        values: dict = {}
        for field in field_definitions or []:
            binding = field.get("data_binding") or {}
            if binding.get("mode") != "prefilled":
                continue
            value = resolve_entity_value(
                binding.get("source_entity"),
                binding.get("source_field"),
                customer=customer,
                company=company,
            )
            if value is not None:
                values[field["key"]] = value
        return values

    def _from_display_name(self, sign_req: SignRequest) -> Optional[str]:
        return f"{sign_req.sender_name} via Scopit" if sign_req.sender_name else None

    def _doc_name(self, sign_req: SignRequest, default: str = "Document") -> str:
        return sign_req.document.name if sign_req.document else default

    def _deliver(self, **kwargs) -> Optional[str]:
        """Send one email. Returns None on success or an error string.
        email_service.send_email reports SMTP failures by returning False
        rather than raising, so both paths count as a failure."""
        try:
            ok = email_service.send_email(**kwargs)
        except Exception as exc:  # noqa: BLE001 -- surfaced to the caller
            return str(exc) or exc.__class__.__name__
        if ok is False:
            return "Email delivery failed"
        return None

    def _send_to_watchers(
        self,
        sign_req: SignRequest,
        subject: str,
        html_content: str,
        attachments: Optional[list] = None,
    ) -> list:
        """Send one informational email to the envelope's Cc/Bcc list. Cc
        addresses see each other (one message); Bcc-only lists get one
        message each so no address is exposed. Returns error strings."""
        cc = [e for e in (sign_req.cc_emails or []) if e]
        bcc = [e for e in (sign_req.bcc_emails or []) if e]
        if cc:
            batches = [(cc[0], cc[1:], bcc)]
        else:
            batches = [(addr, [], []) for addr in bcc]

        errors = []
        for to_email, cc_rest, bcc_list in batches:
            error = self._deliver(
                to_email=to_email,
                subject=subject,
                html_content=html_content,
                reply_to=sign_req.sender_email,
                from_display_name=self._from_display_name(sign_req),
                cc_emails=cc_rest,
                bcc_emails=bcc_list,
                attachments=attachments,
            )
            if error:
                logger.warning(
                    "Sign request %s: Cc/Bcc email to %s failed: %s",
                    sign_req.id, to_email, error,
                )
                errors.append(error)
        return errors

    # -- Expiry ---------------------------------------------------------

    def _is_past_expiry(self, sign_req: SignRequest) -> bool:
        expires_at = _utc_naive(sign_req.expires_at)
        return bool(expires_at and datetime.utcnow() > expires_at)

    def _expire_if_due(self, sign_req: Optional[SignRequest]) -> bool:
        """Flip an outstanding request past its expires_at to 'expired'.
        Returns True if it changed (caller commits)."""
        if (
            sign_req is not None
            and sign_req.status in ACTIVE_STATUSES
            and self._is_past_expiry(sign_req)
        ):
            sign_req.status = "expired"
            self._log_event(sign_req.id, "expired")
            return True
        return False

    def _expire_overdue_for_company(self, company_id: UUID) -> None:
        overdue = (
            self.db.query(SignRequest)
            .filter(
                SignRequest.company_id == company_id,
                SignRequest.status.in_(ACTIVE_STATUSES),
                SignRequest.expires_at < datetime.now(timezone.utc),
            )
            .all()
        )
        changed = False
        for sign_req in overdue:
            changed = self._expire_if_due(sign_req) or changed
        if changed:
            self.db.commit()

    def _expiry_duration(self, sign_req: SignRequest) -> timedelta:
        """The duration chosen at creation (expires_at - created_at), rounded
        to whole days, so it can be re-applied from the actual send time."""
        created = _utc_naive(sign_req.created_at)
        expires = _utc_naive(sign_req.expires_at)
        if created and expires:
            days = round((expires - created).total_seconds() / 86400)
            if days >= 1:
                return timedelta(days=days)
        return timedelta(days=DEFAULT_EXPIRY_DAYS)

    # -- Document source / snapshot ---------------------------------------

    def _is_image_doc(self, doc: PdfDocument) -> bool:
        return (doc.mime_type or "").lower().startswith("image/")

    def _doc_folder(self, doc: PdfDocument) -> str:
        parts = (doc.file_path or "").rsplit("/", 1)
        return parts[0] if len(parts) == 2 else "sign"

    def snapshot_key(self, sign_req: SignRequest) -> Optional[str]:
        """Storage key of the document as it was when this request was
        sent. Derived from the request id, so no column is needed."""
        doc = sign_req.document
        if not doc:
            return None
        name = "source.img" if self._is_image_doc(doc) else "source.pdf"
        return f"{self._doc_folder(doc)}/sign-requests/{sign_req.id}/{name}"

    def _live_source_bytes(self, doc: PdfDocument) -> bytes:
        # Any content edits made via the PDF editor live as annotations until
        # burned in. flatten_annotations_bytes only understands PDF pages, so
        # image-source documents use the raw file.
        if not self._is_image_doc(doc) and doc.annotations:
            return flatten_annotations_bytes(doc, self.storage)
        return self.storage.read(doc.file_path)

    def _has_snapshot(self, sign_req: SignRequest) -> bool:
        key = self.snapshot_key(sign_req)
        return bool(key and self.storage.exists(key))

    def get_source_bytes(self, sign_req: SignRequest) -> bytes:
        """What the signer sees and signs: the send-time snapshot when one
        exists, else (requests sent before snapshots existed) the live
        document with its annotations flattened."""
        doc = sign_req.document
        if not doc:
            raise ValueError("Source document not found")
        key = self.snapshot_key(sign_req)
        if key and self.storage.exists(key):
            return self.storage.read(key)
        if not doc.file_path or not self.storage.exists(doc.file_path):
            raise ValueError("Source document not found")
        return self._live_source_bytes(doc)

    def get_page_count(self, sign_req: SignRequest) -> int:
        doc = sign_req.document
        if not doc:
            return 0
        if not self._is_image_doc(doc) and self._has_snapshot(sign_req):
            try:
                from pypdf import PdfReader

                data = self.storage.read(self.snapshot_key(sign_req))
                return len(PdfReader(BytesIO(data)).pages)
            except Exception:  # noqa: BLE001 -- fall back to the stored count
                logger.exception("Couldn't count pages of snapshot for %s", sign_req.id)
        return doc.page_count or 0

    def _write_snapshot(self, sign_req: SignRequest) -> tuple:
        """Freeze the document for this envelope. Returns (key, sha256)."""
        doc = sign_req.document
        if not doc or not doc.file_path or not self.storage.exists(doc.file_path):
            raise HTTPException(status_code=400, detail="Source document not found")
        try:
            data = self._live_source_bytes(doc)
        except Exception as exc:
            logger.exception("Snapshot failed for sign request %s", sign_req.id)
            raise HTTPException(
                status_code=500,
                detail="Couldn't prepare the document for signing. Please try again.",
            ) from exc
        key = self.snapshot_key(sign_req)
        content_type = (doc.mime_type or "application/octet-stream") if self._is_image_doc(doc) else "application/pdf"
        self.storage.write(key, data, content_type)
        return key, hashlib.sha256(data).hexdigest()

    def _snapshot_sha256(self, sign_req: SignRequest) -> Optional[str]:
        try:
            if self._has_snapshot(sign_req):
                return hashlib.sha256(
                    self.storage.read(self.snapshot_key(sign_req))
                ).hexdigest()
        except Exception:  # noqa: BLE001 -- hash is best-effort extra evidence
            logger.exception("Couldn't hash snapshot for %s", sign_req.id)
        return None

    # ------------------------------------------------------------------
    # Authenticated (company-scoped) operations
    # ------------------------------------------------------------------

    def create_sign_request(
        self,
        company_id: UUID,
        user_id: UUID,
        document_id: UUID,
        recipients: list,
        sender_email: str,
        sender_name: str,
        customer_id: UUID = None,
        delivery_method: str = "email_request",
        email_subject: str = None,
        email_message: str = None,
        cc_emails: list = None,
        bcc_emails: list = None,
        expires_in_days: int = DEFAULT_EXPIRY_DAYS,
    ) -> SignRequest:
        doc = (
            self.db.query(PdfDocument)
            .filter(
                PdfDocument.id == document_id,
                PdfDocument.company_id == company_id,
                PdfDocument.is_active == True,
            )
            .first()
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        field_definitions = doc.field_definitions or []

        recipient_roles = {r["role"] for r in recipients}
        for field in field_definitions:
            needs_role = field.get("type") in ("signature", "initials") or (
                field.get("data_binding") or {}
            ).get("mode") == "signer_input"
            if not needs_role:
                continue
            role = field.get("signer_role")
            if not role or role not in recipient_roles:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Field '{field.get('label') or field.get('key')}' "
                        f"requires signer role '{role}', which is not among "
                        "the given recipients"
                    ),
                )

        customer = None
        if customer_id:
            customer = (
                self.db.query(Customer)
                .filter(
                    Customer.id == customer_id,
                    Customer.company_id == company_id,
                )
                .first()
            )
        company = self.db.query(Company).filter(Company.id == company_id).first()
        prefill_data = self._build_prefill_data(field_definitions, customer, company)

        sign_req = SignRequest(
            company_id=company_id,
            document_id=document_id,
            sent_by=user_id,
            sender_email=sender_email,
            sender_name=sender_name,
            customer_id=customer_id,
            sign_fields=field_definitions,
            prefill_data=prefill_data,
            delivery_method=delivery_method,
            email_subject=email_subject or f"Signature requested: {doc.name}",
            email_message=email_message,
            cc_emails=cc_emails or [],
            bcc_emails=bcc_emails or [],
            access_token=self._generate_token(),
            # Provisional: re-based on the actual send time by
            # send_sign_request, preserving this duration.
            expires_at=datetime.utcnow() + timedelta(days=expires_in_days),
        )
        self.db.add(sign_req)
        self.db.flush()

        for index, r in enumerate(recipients):
            self.db.add(
                SignRecipient(
                    sign_request_id=sign_req.id,
                    role=r["role"],
                    name=r["name"],
                    email=r["email"],
                    phone=r.get("phone"),
                    sequence=index,
                    access_token=self._generate_token(),
                )
            )

        self._log_event(
            sign_req.id,
            "created",
            actor_email=sender_email,
            metadata={"recipient_count": len(recipients)},
        )
        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req

    def set_creator_field_values(
        self, company_id: UUID, request_id: UUID, values: dict
    ) -> SignRequest:
        sign_req = self.get_sign_request(company_id, request_id)
        if not sign_req:
            raise HTTPException(status_code=404, detail="Sign request not found")
        if sign_req.status != "draft":
            raise HTTPException(
                status_code=400,
                detail="Can only set field values while the request is a draft",
            )

        creator_keys = {
            field["key"]
            for field in (sign_req.sign_fields or [])
            if (field.get("data_binding") or {}).get("mode") == "creator_input"
        }
        unknown = set(values.keys()) - creator_keys
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown creator-input field(s): {', '.join(sorted(unknown))}",
            )

        merged = {**(sign_req.prefill_data or {}), **values}
        sign_req.prefill_data = merged
        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req

    def get_preview(self, company_id: UUID, request_id: UUID) -> dict:
        sign_req = self.get_sign_request(company_id, request_id)
        if not sign_req:
            raise HTTPException(status_code=404, detail="Sign request not found")
        doc = sign_req.document
        return {
            "fields": sign_req.sign_fields or [],
            "values": sign_req.prefill_data or {},
            "page_count": doc.page_count if doc else 0,
            "document_name": doc.name if doc else None,
        }

    def _get_owned(self, company_id: UUID, request_id: UUID) -> SignRequest:
        sign_req = (
            self.db.query(SignRequest)
            .filter(
                SignRequest.id == request_id,
                SignRequest.company_id == company_id,
            )
            .first()
        )
        if not sign_req:
            raise HTTPException(status_code=404, detail="Sign request not found")
        return sign_req

    def send_sign_request(self, company_id: UUID, request_id: UUID) -> tuple:
        """Send a draft. Returns (sign_request, failures) where failures is a
        list of {recipient_id, name, email, error} for invitations that could
        not be delivered (those recipients stay 'pending'). If every email
        invitation fails, the request stays a draft so it can be re-sent."""
        sign_req = self._get_owned(company_id, request_id)
        if sign_req.status not in ("draft",):
            raise HTTPException(
                status_code=400, detail="Can only send draft requests"
            )

        missing = []
        for field in sign_req.sign_fields or []:
            binding = field.get("data_binding") or {}
            if binding.get("mode") == "creator_input" and field.get("required"):
                if not (sign_req.prefill_data or {}).get(field["key"]):
                    missing.append(field.get("label") or field["key"])
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Please fill required field(s) before sending: "
                    f"{', '.join(missing)}"
                ),
            )

        # Freeze exactly what the recipients will see and sign, so edits made
        # to the document after sending can't change this envelope.
        snapshot_key, snapshot_sha = self._write_snapshot(sign_req)

        now = datetime.utcnow()
        previous_expires_at = sign_req.expires_at
        sign_req.expires_at = now + self._expiry_duration(sign_req)

        failures: list = []
        if sign_req.delivery_method == "email_request":
            for recipient in sign_req.recipients:
                if recipient.status != "pending":
                    continue
                sign_url = f"{settings.FRONTEND_URL}/sign/{recipient.access_token}"
                # Deliberately no cc/bcc here: this email carries the
                # recipient's private signing link.
                error = self._deliver(
                    to_email=recipient.email,
                    subject=sign_req.email_subject or "Please sign this document",
                    html_content=self._build_sign_email(sign_req, recipient, sign_url),
                    reply_to=sign_req.sender_email,
                    from_display_name=self._from_display_name(sign_req),
                )
                if error:
                    failures.append({
                        "recipient_id": str(recipient.id),
                        "name": recipient.name,
                        "email": recipient.email,
                        "error": error,
                    })
                    self._log_event(
                        sign_req.id,
                        "send_failed",
                        recipient_id=recipient.id,
                        actor_email=sign_req.sender_email,
                        metadata={"error": error},
                    )
                else:
                    recipient.status = "sent"
        else:  # direct_link -- no email, sender copies each recipient's link
            for recipient in sign_req.recipients:
                recipient.status = "sent"

        if not any(r.status == "sent" for r in sign_req.recipients):
            # Nothing reached anyone: keep it a draft so Send can be retried.
            sign_req.expires_at = previous_expires_at
            self.db.commit()
            self.db.refresh(sign_req)
            return sign_req, failures

        sign_req.status = "sent"
        sign_req.sent_at = now
        self._log_event(
            sign_req.id,
            "sent",
            actor_email=sign_req.sender_email,
            metadata={
                "delivery_method": sign_req.delivery_method,
                "source_key": snapshot_key,
                "source_sha256": snapshot_sha,
                "failed_recipient_count": len(failures),
            },
        )

        if sign_req.cc_emails or sign_req.bcc_emails:
            errors = self._send_to_watchers(
                sign_req,
                subject=f"FYI: {self._doc_name(sign_req)} was sent for signature",
                html_content=self._build_watcher_notice_email(sign_req),
            )
            if errors:
                self._log_event(
                    sign_req.id,
                    "cc_notice_failed",
                    actor_email=sign_req.sender_email,
                    metadata={"error": "; ".join(errors)},
                )

        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req, failures

    def send_reminder(
        self, company_id: UUID, request_id: UUID, recipient_id: UUID = None
    ) -> tuple:
        """Returns (sign_request, failures). Recipients whose original
        invitation failed (still 'pending') are included, so a reminder also
        works as a retry."""
        sign_req = self._get_owned(company_id, request_id)
        if self._expire_if_due(sign_req):
            self.db.commit()
        if sign_req.status == "expired":
            raise HTTPException(
                status_code=400,
                detail="This request has expired; reminders can't be sent",
            )
        if sign_req.status not in ACTIVE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Can only send reminders for outstanding requests",
            )

        targets = [
            r for r in sign_req.recipients
            if r.status in ("pending", "sent", "viewed")
        ]
        if recipient_id:
            targets = [r for r in targets if r.id == recipient_id]
            if not targets:
                raise HTTPException(
                    status_code=404,
                    detail="Recipient not found or already completed",
                )

        failures: list = []
        for recipient in targets:
            sign_url = f"{settings.FRONTEND_URL}/sign/{recipient.access_token}"
            error = self._deliver(
                to_email=recipient.email,
                subject=f"Reminder: Please sign {self._doc_name(sign_req, 'document')}",
                html_content=self._build_reminder_email(sign_req, recipient, sign_url),
                reply_to=sign_req.sender_email,
                from_display_name=self._from_display_name(sign_req),
            )
            if error:
                failures.append({
                    "recipient_id": str(recipient.id),
                    "name": recipient.name,
                    "email": recipient.email,
                    "error": error,
                })
                self._log_event(
                    sign_req.id,
                    "reminder_failed",
                    recipient_id=recipient.id,
                    actor_email=sign_req.sender_email,
                    metadata={"error": error},
                )
                continue
            if recipient.status == "pending":
                recipient.status = "sent"
            self._log_event(
                sign_req.id,
                "reminder_sent",
                recipient_id=recipient.id,
                actor_email=sign_req.sender_email,
            )

        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req, failures

    def ensure_signed_file(self, sign_req: SignRequest) -> str:
        """Return the signed PDF's storage key, (re-)burning and persisting
        it if it's missing (e.g. the burn failed at completion)."""
        key = sign_req.signed_file_path
        if key and self.storage.exists(key):
            return key
        try:
            key = self._burn_document(sign_req)
        except Exception as exc:
            logger.exception("Burning signed document failed for %s", sign_req.id)
            raise HTTPException(
                status_code=500,
                detail="The signed document couldn't be generated. Please try again.",
            ) from exc
        sign_req.signed_file_path = key
        self._log_event(sign_req.id, "signed_file_generated", metadata={"key": key})
        self.db.commit()
        return key

    def resend_signed_copies(
        self, company_id: UUID, request_id: UUID, actor_email: str
    ) -> SignRequest:
        """Re-send the fully-signed PDF to the sender and every recipient,
        on demand (the same emails already sent automatically once the
        envelope first completed)."""
        sign_req = self._get_owned(company_id, request_id)
        if sign_req.status != "signed":
            raise HTTPException(
                status_code=400,
                detail="Document has not been fully signed yet",
            )

        try:
            self.ensure_signed_file(sign_req)
        except HTTPException:
            pass  # still send; the emails say there's no attachment

        self._send_completion_notifications(sign_req)
        self._log_event(
            sign_req.id,
            "signed_copy_sent",
            actor_email=actor_email,
            metadata={"recipient_count": len(sign_req.recipients)},
        )

        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req

    def cancel_sign_request(
        self, company_id: UUID, request_id: UUID
    ) -> SignRequest:
        """Void a sign request. Stored status value stays 'cancelled' for
        backward compatibility; only the audit event type and user-facing
        copy say 'voided'."""
        sign_req = self._get_owned(company_id, request_id)
        if sign_req.status in ("signed", "cancelled"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot void a {sign_req.status} request",
            )

        sign_req.status = "cancelled"
        self._log_event(
            sign_req.id, "voided", actor_email=sign_req.sender_email
        )
        self.db.commit()
        self.db.refresh(sign_req)
        return sign_req

    def delete_draft(self, company_id: UUID, request_id: UUID) -> None:
        """Permanently delete an unsent draft (and anything it wrote)."""
        sign_req = self._get_owned(company_id, request_id)
        if sign_req.status != "draft":
            raise HTTPException(
                status_code=400,
                detail="Only drafts can be deleted; void a sent request instead",
            )
        key = self.snapshot_key(sign_req)
        if key:
            try:
                if self.storage.exists(key):
                    self.storage.delete(key)
            except Exception:  # noqa: BLE001 -- orphaned file is harmless
                logger.exception("Couldn't delete snapshot %s", key)
        self.db.delete(sign_req)
        self.db.commit()

    def list_sign_requests(
        self,
        company_id: UUID,
        status: str = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple:
        self._expire_overdue_for_company(company_id)
        query = self.db.query(SignRequest).filter(
            SignRequest.company_id == company_id
        )
        if status:
            query = query.filter(SignRequest.status == status)
        total = query.count()
        items = (
            query.order_by(SignRequest.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def get_sign_request(
        self, company_id: UUID, request_id: UUID
    ) -> Optional[SignRequest]:
        sign_req = (
            self.db.query(SignRequest)
            .filter(
                SignRequest.id == request_id,
                SignRequest.company_id == company_id,
            )
            .first()
        )
        if self._expire_if_due(sign_req):
            self.db.commit()
            self.db.refresh(sign_req)
        return sign_req

    def get_audit_trail(self, company_id: UUID, request_id: UUID) -> list:
        sign_req = self.get_sign_request(company_id, request_id)
        if not sign_req:
            raise HTTPException(status_code=404, detail="Sign request not found")
        return (
            self.db.query(SignAuditEvent)
            .filter(SignAuditEvent.sign_request_id == request_id)
            .order_by(SignAuditEvent.created_at.asc())
            .all()
        )

    # ------------------------------------------------------------------
    # Public signing (token-based, no auth)
    # ------------------------------------------------------------------

    def get_by_token(self, token: str) -> Optional[SignRequest]:
        """Envelope-only lookup, for callers that don't need a specific
        recipient (e.g. page image rendering)."""
        sign_req, _ = self._resolve_by_token(token)
        if self._expire_if_due(sign_req):
            self.db.commit()
        return sign_req

    def _raise_if_unavailable(self, sign_req: SignRequest, recipient: SignRecipient) -> None:
        if sign_req.status == "draft":
            raise HTTPException(
                status_code=410,
                detail="This signing request hasn't been sent yet",
            )
        if sign_req.status in BLOCKED_STATUSES or recipient.status == "declined":
            raise HTTPException(
                status_code=410,
                detail="This signing request is no longer available",
            )
        if self._expire_if_due(sign_req):
            self.db.commit()
            raise HTTPException(
                status_code=410,
                detail="This signing request has expired",
            )

    def view_document(self, token: str, ip: str, user_agent: str):
        """Returns (sign_request, recipient)."""
        sign_req, recipient = self._resolve_by_token(token)
        if not sign_req or not recipient:
            raise HTTPException(status_code=404, detail="Sign request not found")
        self._raise_if_unavailable(sign_req, recipient)

        if recipient.status in ("pending", "sent"):
            recipient.status = "viewed"
            recipient.viewed_at = datetime.utcnow()
        if sign_req.status == "sent":
            sign_req.status = "viewed"

        self._log_event(
            sign_req.id,
            "viewed",
            recipient_id=recipient.id,
            actor_email=recipient.email,
            actor_ip=ip,
            actor_user_agent=user_agent,
        )
        self.db.commit()
        return sign_req, recipient

    def submit_signature(
        self,
        token: str,
        signature_data: str,
        signature_type: str,
        signature_font: str,
        field_values: dict,
        consent_agreed: bool,
        ip: str,
        user_agent: str,
        initials_data: Optional[str] = None,
    ) -> SignRecipient:
        sign_req, recipient = self._resolve_by_token(token)
        if not sign_req or not recipient:
            raise HTTPException(status_code=404, detail="Sign request not found")
        if recipient.status == "signed" or sign_req.status == "signed":
            raise HTTPException(status_code=409, detail="Document already signed")
        self._raise_if_unavailable(sign_req, recipient)
        if not consent_agreed:
            raise HTTPException(
                status_code=400,
                detail="You must agree to sign electronically before submitting",
            )

        field_values = {
            k: v for k, v in (field_values or {}).items() if k != INITIALS_KEY
        }
        my_fields = [
            f for f in (sign_req.sign_fields or [])
            if f.get("signer_role") == recipient.role
        ]
        missing = []
        for field in my_fields:
            if not field.get("required"):
                continue
            if field.get("type") == "signature":
                if not signature_data:
                    missing.append(field.get("label") or field["key"])
            elif field.get("type") == "initials":
                if not (initials_data or signature_data):
                    missing.append(field.get("label") or field["key"])
            elif not field_values.get(field["key"]):
                missing.append(field.get("label") or field["key"])
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Please complete required field(s): {', '.join(missing)}",
            )

        stored_values = dict(field_values)
        if initials_data:
            stored_values[INITIALS_KEY] = initials_data

        recipient.signature_data = signature_data
        recipient.signature_type = signature_type
        recipient.signature_font = signature_font
        recipient.signer_ip = ip
        recipient.signer_user_agent = user_agent
        recipient.consent_agreed = True
        recipient.signed_field_values = stored_values
        recipient.status = "signed"
        recipient.signed_at = datetime.utcnow()
        recipient.document_hash = self._compute_document_hash(
            sign_req, recipient, field_values, initials_data
        )

        self._log_event(
            sign_req.id,
            "signed",
            recipient_id=recipient.id,
            actor_email=recipient.email,
            actor_ip=ip,
            actor_user_agent=user_agent,
            metadata={"signature_type": signature_type},
        )

        all_signed = all(r.status == "signed" for r in sign_req.recipients)
        any_signed = any(r.status == "signed" for r in sign_req.recipients)

        if all_signed:
            sign_req.status = "signed"
            sign_req.signed_at = datetime.utcnow()
            try:
                sign_req.signed_file_path = self._burn_document(sign_req)
            except Exception as exc:  # noqa: BLE001
                # Field/signature data is saved regardless; the download
                # endpoint re-burns lazily (ensure_signed_file).
                logger.exception("Burn failed at completion for %s", sign_req.id)
                self._log_event(
                    sign_req.id, "burn_failed", metadata={"error": str(exc)}
                )
            self._log_event(
                sign_req.id,
                "completed",
                metadata={"recipient_count": len(sign_req.recipients)},
            )
        elif any_signed:
            sign_req.status = "partially_signed"

        self.db.commit()
        self.db.refresh(recipient)

        if all_signed:
            self._send_completion_notifications(sign_req)

        return recipient

    def decline_signature(
        self, token: str, reason: str, ip: str, user_agent: str
    ) -> SignRecipient:
        sign_req, recipient = self._resolve_by_token(token)
        if not sign_req or not recipient:
            raise HTTPException(status_code=404, detail="Sign request not found")
        if recipient.status in ("signed", "declined"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot decline a {recipient.status} request",
            )
        if sign_req.status == "signed":
            raise HTTPException(status_code=400, detail="Document already signed")
        self._raise_if_unavailable(sign_req, recipient)

        recipient.status = "declined"
        recipient.declined_at = datetime.utcnow()
        # Any decline halts the whole envelope -- every recipient is
        # required, so the document can no longer reach full completion.
        sign_req.status = "declined"
        sign_req.declined_at = datetime.utcnow()

        self._log_event(
            sign_req.id,
            "declined",
            recipient_id=recipient.id,
            actor_email=recipient.email,
            actor_ip=ip,
            actor_user_agent=user_agent,
            metadata={"reason": reason},
        )
        self.db.commit()
        self.db.refresh(recipient)

        error = self._deliver(
            to_email=sign_req.sender_email,
            subject=f"{recipient.name} declined to sign {self._doc_name(sign_req)}",
            html_content=self._build_decline_email(sign_req, recipient, reason),
            reply_to=recipient.email,
        )
        if error:
            logger.warning(
                "Sign request %s: decline notification to sender failed: %s",
                sign_req.id, error,
            )
        return recipient

    def _compute_document_hash(
        self,
        sign_req: SignRequest,
        recipient: SignRecipient,
        field_values: dict,
        initials_data: Optional[str] = None,
    ) -> str:
        """Hash over what this recipient attested to (fields + prefill +
        their own inputs + signature + the send-time document snapshot) --
        not a burned PDF file, since for early signers in a multi-recipient
        envelope the final combined PDF doesn't exist yet (it's only burned
        once, at full completion)."""
        payload = {
            "document_id": str(sign_req.document_id),
            "sign_fields": sign_req.sign_fields or [],
            "prefill_data": sign_req.prefill_data or {},
            "recipient_role": recipient.role,
            "field_values": field_values or {},
            "signature_data": recipient.signature_data,
        }
        if initials_data:
            payload["initials_data"] = initials_data
        source_sha = self._snapshot_sha256(sign_req)
        if source_sha:
            payload["source_sha256"] = source_sha
        canonical = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    # ------------------------------------------------------------------
    # PDF field/signature burning
    # ------------------------------------------------------------------

    def _resolve_burn_value(self, field: dict, sign_req: SignRequest) -> Optional[dict]:
        """Returns {"image_b64", "signed_at"} for a signature/initials
        field, {"text": ...} for any other bound field, or None to skip."""
        field_type = field.get("type")
        role = field.get("signer_role")
        recipient = None
        if role:
            recipient = next(
                (r for r in sign_req.recipients if r.role == role), None
            )

        if field_type in ("signature", "initials"):
            if not recipient:
                return None
            image = recipient.signature_data
            if field_type == "initials":
                # Legacy rows (before initials were captured separately)
                # fall back to the signature image.
                image = (
                    (recipient.signed_field_values or {}).get(INITIALS_KEY)
                    or recipient.signature_data
                )
            if image:
                return {"image_b64": image, "signed_at": recipient.signed_at}
            return None

        mode = (field.get("data_binding") or {}).get("mode")
        if mode in ("prefilled", "creator_input"):
            value = (sign_req.prefill_data or {}).get(field.get("key"))
        elif mode == "signer_input":
            value = (
                (recipient.signed_field_values or {}).get(field.get("key"))
                if recipient else None
            )
        else:
            return None

        return {"text": value} if value else None

    def _signed_key(self, sign_req: SignRequest) -> str:
        """Per-request key: a template shared by many envelopes must never
        have one signed copy overwrite another."""
        return f"{self._doc_folder(sign_req.document)}/signed/{sign_req.id}.pdf"

    def _burn_document(self, sign_req: SignRequest) -> str:
        """Burn every resolved field value (prefill/creator/signer inputs +
        each recipient's signature) into the document. Returns storage key.
        Called when the envelope reaches full completion (or lazily on
        download if that failed), so every recipient has already signed."""
        doc = sign_req.document
        if not doc:
            raise ValueError("Source document not found")

        source_bytes = self.get_source_bytes(sign_req)

        with tempfile.TemporaryDirectory(prefix="scopit_sign_") as tmpdir:
            src_path = os.path.join(tmpdir, "source")
            with open(src_path, "wb") as f:
                f.write(source_bytes)

            signed_path = os.path.join(tmpdir, "signed.pdf")

            if self._is_image_doc(doc):
                self._burn_fields_image(sign_req, src_path, signed_path)
            else:
                self._burn_fields_pdf(sign_req, src_path, signed_path)

            signed_key = self._signed_key(sign_req)
            with open(signed_path, "rb") as f:
                self.storage.write(signed_key, f.read(), "application/pdf")

        return signed_key

    def _burn_fields_image(
        self, sign_req: SignRequest, src_path: str, output_path: str,
    ) -> None:
        """Burn resolved field values onto an image file, output as PDF."""
        from PIL import Image, ImageDraw, ImageFont

        base_img = Image.open(src_path).convert("RGBA")
        img_w, img_h = base_img.size
        draw = ImageDraw.Draw(base_img)

        for field in sign_req.sign_fields or []:
            value = self._resolve_burn_value(field, sign_req)
            if not value:
                continue

            fx = field.get("x", 0)
            fy = field.get("y", 0)
            fw = field.get("width", 200)
            fh = field.get("height", 60)

            px = int(fx * img_w) if fx <= 1 else int(fx)
            py = int(fy * img_h) if fy <= 1 else int(fy)
            pw = int(fw * img_w) if fw <= 1 else int(fw)
            ph = int(fh * img_h) if fh <= 1 else int(fh)

            if "image_b64" in value:
                sig_img = Image.open(
                    BytesIO(base64.b64decode(value["image_b64"]))
                ).convert("RGBA")
                resized = sig_img.resize((pw, ph), Image.LANCZOS)
                base_img.paste(resized, (px, py), resized)
                ts_size = max(9, int(ph * 0.2))
                try:
                    ts_font = ImageFont.truetype("arial.ttf", ts_size)
                except OSError:
                    ts_font = ImageFont.load_default()
                draw.text(
                    (px + 2, py + ph + 2),
                    _format_signed_ts(value.get("signed_at")),
                    fill=(107, 114, 128, 255),
                    font=ts_font,
                )
            elif field.get("type") == "checkbox":
                if str(value.get("text") or "").strip().lower() in (
                    "true", "1", "yes", "on", "checked",
                ):
                    font_size = max(12, int(ph * 0.7))
                    try:
                        font = ImageFont.truetype("arial.ttf", font_size)
                    except OSError:
                        font = ImageFont.load_default()
                    draw.text(
                        (px + pw * 0.25, py + (ph - font_size) // 2),
                        "X", fill=(17, 24, 39, 255), font=font,
                    )
            else:
                text_val = str(value.get("text") or "")
                lines = text_val.split("\n")
                if len(lines) > 1:
                    # Multi-line text field: shrink the font to fit every
                    # line within the box and draw top-down.
                    font_size = max(10, min(int(ph * 0.6), int(ph / len(lines) * 0.8)))
                    try:
                        font = ImageFont.truetype("arial.ttf", font_size)
                    except OSError:
                        font = ImageFont.load_default()
                    draw.multiline_text(
                        (px + 4, py + 2),
                        text_val,
                        fill=(17, 24, 39, 255),
                        font=font,
                        spacing=max(2, int(font_size * 0.25)),
                    )
                else:
                    font_size = max(12, int(ph * 0.6))
                    try:
                        font = ImageFont.truetype("arial.ttf", font_size)
                    except OSError:
                        font = ImageFont.load_default()
                    draw.text(
                        (px + 4, py + (ph - font_size) // 2),
                        text_val,
                        fill=(17, 24, 39, 255),
                        font=font,
                    )

        output = base_img.convert("RGB")
        output.save(output_path, "PDF", resolution=150)

    def _burn_fields_pdf(
        self, sign_req: SignRequest, src_path: str, output_path: str,
    ) -> None:
        """Burn resolved field values onto a PDF file.

        Field coordinates are 0-1 fractions of the pdf.js viewport at scale 1
        (which already includes /Rotate and the crop box), so the overlay is
        drawn in that top-down screen space and each field gets its own
        y-up local frame with the origin at the field's bottom-left."""
        from pypdf import PdfReader, PdfWriter
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas as rl_canvas

        reader = PdfReader(src_path)
        writer = PdfWriter()

        fields_by_page: dict = {}
        for field in sign_req.sign_fields or []:
            pg = field.get("page", 1)
            fields_by_page.setdefault(pg, []).append(field)

        for i, page in enumerate(reader.pages):
            page_num = i + 1
            page_fields = fields_by_page.get(page_num, [])
            if page_fields:
                media_box = page.mediabox
                pw = float(media_box.width)
                ph = float(media_box.height)
                view = page_view(page)

                packet = BytesIO()
                c = rl_canvas.Canvas(packet, pagesize=(pw, ph))
                enter_screen_space(c, view)

                for field in page_fields:
                    value = self._resolve_burn_value(field, sign_req)
                    if not value:
                        continue

                    fx = field.get("x", 0)
                    fy = field.get("y", 0)
                    fw = field.get("width", 200)
                    fh = field.get("height", 60)

                    sx = fx * view.width if fx <= 1 else fx
                    sy = fy * view.height if fy <= 1 else fy
                    sw = fw * view.width if fw <= 1 else fw
                    sh = fh * view.height if fh <= 1 else fh

                    c.saveState()
                    local_frame(c, sx, sy + sh)
                    x, y, w, h = 0.0, 0.0, sw, sh

                    if "image_b64" in value:
                        sig_bytes = base64.b64decode(value["image_b64"])
                        sig_reader = ImageReader(BytesIO(sig_bytes))
                        c.drawImage(sig_reader, x, y, w, h, mask="auto")
                        ts_size = max(6, min(8, h * 0.18))
                        c.setFont("Helvetica", ts_size)
                        c.setFillColorRGB(0.42, 0.45, 0.50)
                        c.drawString(
                            x + 1, y - ts_size - 1,
                            _format_signed_ts(value.get("signed_at")),
                        )
                        c.setFillColorRGB(0, 0, 0)
                    elif field.get("type") == "checkbox":
                        if str(value.get("text") or "").strip().lower() in (
                            "true", "1", "yes", "on", "checked",
                        ):
                            c.setFont("Helvetica-Bold", h * 0.6)
                            c.drawString(x + w * 0.25, y + h * 0.2, "X")
                    else:
                        text_val = str(value.get("text") or "")
                        lines = text_val.split("\n")
                        # A creator-chosen size is a preference, not a
                        # guarantee -- still shrink to fit multi-line text
                        # so a large chosen size can never overflow the box.
                        preferred_size = field.get("font_size") or 11
                        if len(lines) > 1:
                            # Multi-line text field: shrink the font to fit
                            # every line within the box and draw top-down.
                            font_size = max(7, min(preferred_size, h / len(lines) * 0.7))
                            c.setFont("Helvetica", font_size)
                            line_height = font_size * 1.25
                            start_y = y + h - line_height + (line_height - font_size) * 0.3
                            for idx, line in enumerate(lines):
                                ly = start_y - idx * line_height
                                if ly < y - line_height * 0.5:
                                    break
                                c.drawString(x + 2, ly, line)
                        else:
                            font_size = preferred_size
                            c.setFont("Helvetica", font_size)
                            c.drawString(x + 2, y + h * 0.3, text_val)

                    c.restoreState()

                c.save()
                packet.seek(0)
                overlay = PdfReader(packet)
                page.merge_page(overlay.pages[0])

            writer.add_page(page)

        with open(output_path, "wb") as f:
            writer.write(f)

    # ------------------------------------------------------------------
    # Email templates
    # ------------------------------------------------------------------

    def _email_shell(self, title: str, body: str, footer_note: str = "Sent via Scopit") -> str:
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f9fafb;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px; margin:0 auto; padding:40px 20px;">
<tr><td style="background:#fff; border-radius:12px; padding:40px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
  <h1 style="margin:0 0 20px; color:#111827; font-size:24px;">{title}</h1>
  {body}
  <hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 20px;">
  <p style="color:#9ca3af; font-size:12px; text-align:center; margin:0;">
    {footer_note}
  </p>
</td></tr></table>
</body>
</html>"""

    def _build_sign_email(
        self, sign_req: SignRequest, recipient: SignRecipient, sign_url: str
    ) -> str:
        """Build HTML email for a signing invitation to one recipient."""
        expires_str = (
            sign_req.expires_at.strftime("%B %d, %Y")
            if sign_req.expires_at
            else "N/A"
        )
        message_block = (
            f'<p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">'
            f"{sign_req.email_message}</p>"
            if sign_req.email_message
            else ""
        )
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f9fafb;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px; margin:0 auto; padding:40px 20px;">
<tr><td style="background:#fff; border-radius:12px; padding:40px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
  <h1 style="margin:0 0 20px; color:#111827; font-size:24px;">Signature Requested</h1>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 10px;">
    Hi {recipient.name},
  </p>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">
    {sign_req.sender_name} ({sign_req.sender_email}) has requested your signature on a document.
  </p>
  {message_block}
  <table width="100%" cellspacing="0" cellpadding="0">
    <tr><td style="text-align:center; padding:25px 0;">
      <a href="{sign_url}" style="display:inline-block; background:#111827; color:#fff; text-decoration:none; padding:14px 32px; border-radius:6px; font-size:16px; font-weight:600;">
        Review &amp; Sign Document
      </a>
    </td></tr>
  </table>
  <p style="color:#6b7280; font-size:14px; margin:20px 0 0;">
    This link expires on {expires_str}.
  </p>
  <hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 20px;">
  <p style="color:#9ca3af; font-size:12px; text-align:center; margin:0;">
    Sent via Scopit &bull; Do not reply to this email
  </p>
</td></tr></table>
</body>
</html>"""

    def _build_watcher_notice_email(self, sign_req: SignRequest) -> str:
        """Informational email for Cc/Bcc at send time. No signing link."""
        doc_name = html.escape(self._doc_name(sign_req))
        names = html.escape(", ".join(r.name for r in sign_req.recipients) or "the recipients")
        sender = html.escape(f"{sign_req.sender_name} ({sign_req.sender_email})")
        message_block = (
            f'<p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">'
            f"{sign_req.email_message}</p>"
            if sign_req.email_message
            else ""
        )
        body = f"""<p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">
    {sender} sent <strong>{doc_name}</strong> to {names} for signature.
  </p>
  {message_block}
  <p style="color:#6b7280; font-size:14px; line-height:1.6; margin:0;">
    You were copied for your information and don't need to do anything. You'll get a copy of the signed document once everyone has signed.
  </p>"""
        return self._email_shell("Sent for Signature", body)

    def _build_decline_email(
        self, sign_req: SignRequest, recipient: SignRecipient, reason: str
    ) -> str:
        doc_name = html.escape(self._doc_name(sign_req))
        who = html.escape(f"{recipient.name} ({recipient.email})")
        reason_block = (
            f'<p style="color:#374151; font-size:15px; line-height:1.6; margin:0 0 20px; '
            f'padding:12px 16px; background:#f9fafb; border-left:3px solid #ef4444;">'
            f"<strong>Reason:</strong> {html.escape(reason)}</p>"
            if reason
            else '<p style="color:#6b7280; font-size:14px; margin:0 0 20px;">No reason was given.</p>'
        )
        body = f"""<p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 10px;">
    Hi {html.escape(sign_req.sender_name or '')},
  </p>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">
    {who} declined to sign <strong>{doc_name}</strong>. The request has been closed and no one else can sign it.
  </p>
  {reason_block}"""
        return self._email_shell("Signature Declined", body)

    def _build_reminder_email(
        self, sign_req: SignRequest, recipient: SignRecipient, sign_url: str
    ) -> str:
        """Build HTML email for a signing reminder to one recipient."""
        expires_str = (
            sign_req.expires_at.strftime("%B %d, %Y")
            if sign_req.expires_at
            else "N/A"
        )
        doc_name = sign_req.document.name if sign_req.document else "a document"
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f9fafb;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px; margin:0 auto; padding:40px 20px;">
<tr><td style="background:#fff; border-radius:12px; padding:40px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
  <h1 style="margin:0 0 20px; color:#111827; font-size:24px;">Friendly Reminder</h1>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 10px;">
    Hi {recipient.name},
  </p>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">
    {sign_req.sender_name} ({sign_req.sender_email}) is waiting for your signature on <strong>{doc_name}</strong>.
  </p>
  <table width="100%" cellspacing="0" cellpadding="0">
    <tr><td style="text-align:center; padding:25px 0;">
      <a href="{sign_url}" style="display:inline-block; background:#111827; color:#fff; text-decoration:none; padding:14px 32px; border-radius:6px; font-size:16px; font-weight:600;">
        Review &amp; Sign Document
      </a>
    </td></tr>
  </table>
  <p style="color:#6b7280; font-size:14px; margin:20px 0 0;">
    This link expires on {expires_str}.
  </p>
  <hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 20px;">
  <p style="color:#9ca3af; font-size:12px; text-align:center; margin:0;">
    Sent via Scopit &bull; Do not reply to this email
  </p>
</td></tr></table>
</body>
</html>"""

    def _send_completion_notifications(self, sign_req: SignRequest) -> None:
        """Notify the sender, every recipient and the Cc/Bcc list that the
        envelope is fully signed, attaching the final combined PDF when it
        exists. Each email is independent so one bad address never blocks
        another (extends the original single-recipient FR-6.5 guarantee)."""
        doc_name = self._doc_name(sign_req)
        company_name = sign_req.company.name if sign_req.company else "Scopit"
        completed_at_str = (
            _utc_naive(sign_req.signed_at).strftime("%B %d, %Y at %I:%M %p UTC")
            if sign_req.signed_at else "just now"
        )
        signer_names = ", ".join(r.name for r in sign_req.recipients) or "Your recipients"

        attachments = None
        signed_key = sign_req.signed_file_path
        try:
            if signed_key and self.storage.exists(signed_key):
                pdf_data = self.storage.read(signed_key)
                base_name = os.path.splitext(doc_name)[0]
                attachments = [{
                    "data": pdf_data,
                    "filename": f"{base_name}_signed.pdf",
                    "mime_type": "application/pdf",
                }]
        except Exception:  # noqa: BLE001 -- send without the attachment
            logger.exception("Couldn't read signed file for %s", sign_req.id)
            attachments = None
        attached = attachments is not None

        copy_note_sender = (
            "The fully signed document is attached."
            if attached
            else "The signed PDF couldn't be attached; download it from the request in Scopit."
        )
        copy_note_other = (
            "A copy of the fully signed document is attached for your records."
            if attached
            else (
                f"A copy of the signed document is available from "
                f"{sign_req.sender_name} ({sign_req.sender_email})."
            )
        )

        def _send(to_email, subject, html_content, reply_to, **extra):
            error = self._deliver(
                to_email=to_email,
                subject=subject,
                html_content=html_content,
                reply_to=reply_to,
                attachments=attachments,
                **extra,
            )
            if error:
                logger.warning(
                    "Sign request %s: completion email to %s failed: %s",
                    sign_req.id, to_email, error,
                )

        _send(
            sign_req.sender_email,
            f"{signer_names} signed {doc_name}",
            self._build_completion_email(
                greeting_name=sign_req.sender_name,
                intro=(
                    f"<strong>{signer_names}</strong> "
                    f"{'have' if len(sign_req.recipients) != 1 else 'has'} "
                    f"signed <strong>{doc_name}</strong>. {copy_note_sender}"
                ),
                completed_at_str=completed_at_str,
                footer=None,
            ),
            sign_req.recipients[0].email if sign_req.recipients else None,
        )

        for recipient in sign_req.recipients:
            _send(
                recipient.email,
                f"Your signed copy of {doc_name}",
                self._build_completion_email(
                    greeting_name=recipient.name,
                    intro=(
                        f"Thank you for signing <strong>{doc_name}</strong>. "
                        f"{copy_note_other}"
                    ),
                    completed_at_str=completed_at_str,
                    footer=(
                        f"This document was requested by {sign_req.sender_name} "
                        f"({sign_req.sender_email}) on behalf of {company_name}."
                    ),
                ),
                sign_req.sender_email,
            )

        if sign_req.cc_emails or sign_req.bcc_emails:
            self._send_to_watchers(
                sign_req,
                subject=f"Signed: {doc_name}",
                html_content=self._build_completion_email(
                    greeting_name="there",
                    intro=(
                        f"<strong>{signer_names}</strong> "
                        f"{'have' if len(sign_req.recipients) != 1 else 'has'} "
                        f"signed <strong>{doc_name}</strong>. {copy_note_other}"
                    ),
                    completed_at_str=completed_at_str,
                    footer=(
                        f"You were copied on this request by {sign_req.sender_name} "
                        f"({sign_req.sender_email}) on behalf of {company_name}."
                    ),
                ),
                attachments=attachments,
            )

    def _build_completion_email(
        self, greeting_name: str, intro: str, completed_at_str: str,
        footer: Optional[str],
    ) -> str:
        footer_block = (
            f'<p style="color:#6b7280; font-size:13px; line-height:1.6; margin:0;">{footer}</p>'
            if footer else ""
        )
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f9fafb;">
<table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px; margin:0 auto; padding:40px 20px;">
<tr><td style="background:#fff; border-radius:12px; padding:40px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
  <h1 style="margin:0 0 20px; color:#111827; font-size:24px;">Document Signed</h1>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 10px;">
    Hi {greeting_name},
  </p>
  <p style="color:#374151; font-size:16px; line-height:1.6; margin:0 0 20px;">
    {intro}
  </p>
  <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
    <tr>
      <td style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px;">
        <p style="margin:0; color:#166534; font-size:14px; font-weight:600;">Signed successfully</p>
        <p style="margin:6px 0 0; color:#166534; font-size:13px;">{completed_at_str}</p>
      </td>
    </tr>
  </table>
  {footer_block}
  <hr style="border:none; border-top:1px solid #e5e7eb; margin:30px 0 20px;">
  <p style="color:#9ca3af; font-size:12px; text-align:center; margin:0;">
    Sent via Scopit
  </p>
</td></tr></table>
</body>
</html>"""
