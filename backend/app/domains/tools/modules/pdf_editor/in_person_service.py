"""
Scopit - In-person signing service

Signing on the company's own device, with the signer there: no link is sent.
What a visit asks for is worked out in in_person.py; this does the rest.

Each document signed becomes an ordinary sign request, delivered "in_person"
and already fully signed, so it shows wherever sign requests do (the Sign
Requests tab, the customer's Signatures) and its signed PDF, audit trail and
"Resend signed copy" work as for any other. Nothing is written until the
signer signs, and a visit's documents are saved together or not at all.
"""
from __future__ import annotations

import base64
import binascii
import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.tools.modules.pdf_editor.field_registry import resolve_entity_value
from app.domains.tools.modules.pdf_editor.in_person import (
    build_questions,
    clean_answers,
    clean_email,
    document_values,
    has_signature_line,
    is_signature,
    missing_required,
    question_key,
    reading_order,
    role_label,
    signer_roles,
    signing_day,
    strip_data_url,
)
from app.domains.tools.modules.pdf_editor.models import PdfDocument, SignRecipient, SignRequest
from app.domains.tools.modules.pdf_editor.sign_service import (
    DEFAULT_EXPIRY_DAYS,
    INITIALS_KEY,
    SignService,
)

logger = logging.getLogger(__name__)

IN_PERSON = "in_person"

# The most documents one visit signs together
MAX_DOCUMENTS = 10

# Customer record fields an answer may fill when the record is blank there
_CUSTOMER_FIELDS = (
    "name", "contact_name", "email", "phone",
    "address_line1", "address_line2", "city", "state", "zipcode", "country",
)


def _is_png(value: str) -> bool:
    try:
        return base64.b64decode(value, validate=True).startswith(b"\x89PNG")
    except (binascii.Error, ValueError):
        return False


class InPersonSignService:
    def __init__(self, db: Session):
        self.db = db
        self.esign = SignService(db)

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def signable_documents(self, company_id: UUID, customer_id: Optional[UUID] = None) -> list:
        """Documents with a signature or initials line to sign: the company's
        templates, and this customer's own copies first"""
        owners = [PdfDocument.customer_id.is_(None)]
        if customer_id:
            owners.append(PdfDocument.customer_id == customer_id)
        docs = (
            self.db.query(PdfDocument)
            .filter(
                PdfDocument.company_id == company_id,
                PdfDocument.is_active == True,  # noqa: E712
                or_(*owners),
                or_(
                    PdfDocument.field_definitions.contains([{"type": "signature"}]),
                    PdfDocument.field_definitions.contains([{"type": "initials"}]),
                ),
            )
            .order_by(PdfDocument.created_at.desc())
            .limit(200)
            .all()
        )
        docs = [d for d in docs if has_signature_line(d.field_definitions)]
        return sorted(docs, key=lambda d: d.customer_id is None)

    def _customer(self, company_id: UUID, customer_id: UUID) -> Customer:
        customer = (
            self.db.query(Customer)
            .filter(Customer.id == customer_id, Customer.company_id == company_id)
            .first()
        )
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        return customer

    def _company(self, company_id: UUID) -> Optional[Company]:
        return self.db.query(Company).filter(Company.id == company_id).first()

    def _documents(self, company_id: UUID, document_ids: list, customer_id: Optional[UUID]) -> list:
        """The visit's documents in the order they're signed"""
        if not document_ids:
            raise HTTPException(status_code=400, detail="Pick a document to sign")
        ids = [str(i) for i in document_ids]
        if len(set(ids)) != len(ids):
            raise HTTPException(status_code=400, detail="A document is listed twice")
        if len(ids) > MAX_DOCUMENTS:
            raise HTTPException(
                status_code=400, detail=f"Sign at most {MAX_DOCUMENTS} documents at a time"
            )
        found = {
            str(d.id): d
            for d in self.db.query(PdfDocument)
            .filter(
                PdfDocument.id.in_([UUID(i) for i in ids]),
                PdfDocument.company_id == company_id,
                PdfDocument.is_active == True,  # noqa: E712
            )
            .all()
        }
        docs = []
        for doc_id in ids:
            doc = found.get(doc_id)
            # Another customer's copy isn't this visit's to sign
            if not doc or (doc.customer_id and str(doc.customer_id) != str(customer_id or "")):
                raise HTTPException(status_code=404, detail="Document not found")
            if not has_signature_line(doc.field_definitions):
                raise HTTPException(
                    status_code=400,
                    detail=f"{doc.name} has no signature or initials line. Add one in Fields first.",
                )
            docs.append(doc)
        return docs

    @staticmethod
    def draft_customer(new_customer: Optional[dict]) -> Optional[Customer]:
        """A customer not yet saved, to read a new customer's details the same
        way as a saved one's. Never added to the session."""
        if not new_customer:
            return None
        values = {k: (new_customer.get(k) or "").strip() or None for k in _CUSTOMER_FIELDS}
        if not values["name"]:
            return None
        return Customer(**values)

    def _known(self, docs: list, customer: Optional[Customer], company: Optional[Company]) -> dict:
        """What's on record for every record field the documents map"""
        known: dict[str, str] = {}
        for doc in docs:
            for field in doc.field_definitions or []:
                binding = field.get("data_binding") or {}
                if binding.get("mode") != "prefilled":
                    continue
                key = question_key(field)
                if not key or key in known:
                    continue
                value = resolve_entity_value(
                    binding.get("source_entity"),
                    binding.get("source_field"),
                    customer=customer,
                    company=company,
                )
                if value and value.strip():
                    known[key] = value.strip()
        return known

    def _subject(self, company_id: UUID, customer_id: Optional[UUID], new_customer: Optional[dict]):
        """(saved customer or None, the customer to read details from)"""
        if customer_id:
            customer = self._customer(company_id, customer_id)
            return customer, customer
        return None, self.draft_customer(new_customer)

    # ------------------------------------------------------------------
    # Before signing
    # ------------------------------------------------------------------

    def form(
        self,
        company_id: UUID,
        document_ids: list,
        customer_id: Optional[UUID] = None,
        new_customer: Optional[dict] = None,
    ) -> dict:
        """What to ask, once for all of the visit's documents; each document's
        lines to sign; and who signs them"""
        saved, customer = self._subject(company_id, customer_id, new_customer)
        docs = self._documents(company_id, document_ids, customer_id)
        known = self._known(docs, customer, self._company(company_id))
        fields_of = [doc.field_definitions or [] for doc in docs]
        return {
            "documents": [
                {
                    "id": str(doc.id),
                    "name": doc.name,
                    "pageCount": doc.page_count or 1,
                    "customerCopy": bool(doc.customer_id),
                    "lines": [
                        {
                            "key": f["key"],
                            "label": f.get("label") or "",
                            "type": f.get("type"),
                            "page": f.get("page", 1),
                            "x": f.get("x", 0),
                            "y": f.get("y", 0),
                            "width": f.get("width", 0.2),
                            "height": f.get("height", 0.06),
                            "signerRole": f.get("signer_role"),
                        }
                        for f in reading_order(fields)
                        if is_signature(f) and f.get("signer_role")
                    ],
                }
                for doc, fields in zip(docs, fields_of)
            ],
            "questions": build_questions(zip((d.name for d in docs), fields_of), known),
            "signers": [
                {**entry, "label": role_label(entry["role"])}
                for entry in signer_roles(fields_of)
            ],
            "customer": {
                "id": str(saved.id) if saved else None,
                "name": customer.name if customer else "",
                "contactName": customer.contact_name if customer else None,
                "email": customer.email if customer else None,
            },
        }

    def preview(
        self,
        company_id: UUID,
        document_id: UUID,
        answers: Optional[dict],
        today: Optional[str],
        customer_id: Optional[UUID] = None,
        new_customer: Optional[dict] = None,
    ) -> bytes:
        """One document filled in with the answers so far, for the signer to
        read before signing. Nothing is saved."""
        _, customer = self._subject(company_id, customer_id, new_customer)
        doc = self._documents(company_id, [document_id], customer_id)[0]
        fields = doc.field_definitions or []
        known = self._known([doc], customer, self._company(company_id))
        questions = build_questions([(doc.name, fields)], known)
        prefill, by_role = document_values(
            fields, clean_answers(answers, questions), known, signing_day(today)
        )
        try:
            return self.esign.render_filled_document(doc, fields, prefill, by_role)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Document file not found") from exc

    # ------------------------------------------------------------------
    # Signing
    # ------------------------------------------------------------------

    def _marks(self, roles: list, names: dict, marks: dict) -> dict:
        """Each signer's signature and initials, checked against what their
        lines need"""
        checked: dict[str, dict] = {}
        for entry in roles:
            role = entry["role"]
            if not names.get(role):
                raise HTTPException(
                    status_code=400, detail=f"Enter {role_label(role)}'s full name"
                )
            mark = marks.get(role) or {}
            signature = strip_data_url(mark.get("signature"))
            initials = strip_data_url(mark.get("initials"))
            if entry["signature"] and not _is_png(signature):
                raise HTTPException(
                    status_code=400, detail=f"{role_label(role)} hasn't signed yet"
                )
            if entry["initials"] and not _is_png(initials):
                raise HTTPException(
                    status_code=400, detail=f"{role_label(role)} hasn't initialed yet"
                )
            checked[role] = {
                "signature": signature if entry["signature"] else None,
                "initials": initials if entry["initials"] else None,
                "type": "type" if mark.get("signature_type") == "type" else "draw",
                "font": (mark.get("signature_font") or "")[:100] or None,
            }
        return checked

    def _save_customer(
        self,
        company_id: UUID,
        user_id: UUID,
        saved: Optional[Customer],
        draft: Optional[Customer],
        answers: dict,
    ) -> tuple:
        """The customer the documents belong to: a new one is made now, from
        what was entered; a saved one gets any blanks on its record filled
        from the answers, never a value it already has. Returns (customer, created)."""
        given = {
            name: answers.get(f"customer.{name}", "")
            for name in _CUSTOMER_FIELDS
            if answers.get(f"customer.{name}")
        }
        if saved is None:
            values = {name: getattr(draft, name) for name in _CUSTOMER_FIELDS if getattr(draft, name)}
            values.update(given)
            customer = Customer(company_id=company_id, created_by=user_id, **values)
            self.db.add(customer)
            self.db.flush()
            return customer, True
        for name, value in given.items():
            if not getattr(saved, name):
                setattr(saved, name, value)
        return saved, False

    def sign(
        self,
        *,
        company_id: UUID,
        user,
        document_ids: list,
        answers: Optional[dict],
        today: Optional[str],
        signers: list,
        marks: dict,
        consent_agreed: bool,
        consent_text: Optional[str],
        ip: str,
        user_agent: str,
        customer_id: Optional[UUID] = None,
        new_customer: Optional[dict] = None,
    ) -> dict:
        """Sign: makes the customer if they're new, then one fully signed
        request with its signed PDF per document. Everything is checked
        before anything is written."""
        if not consent_agreed:
            raise HTTPException(
                status_code=400, detail="The signer must agree to sign electronically"
            )
        saved, customer = self._subject(company_id, customer_id, new_customer)
        if customer is None:
            raise HTTPException(
                status_code=400, detail="Pick a customer, or enter the new customer's name"
            )
        docs = self._documents(company_id, document_ids, customer_id)
        company = self._company(company_id)
        known = self._known(docs, customer, company)
        fields_of = [doc.field_definitions or [] for doc in docs]
        questions = build_questions(zip((d.name for d in docs), fields_of), known)
        answered = clean_answers(answers, questions)
        missing = missing_required(questions, answered)
        if missing:
            raise HTTPException(
                status_code=400, detail=f"Fill in the required fields: {', '.join(missing)}"
            )

        roles = signer_roles(fields_of)
        names = {s.get("role"): " ".join((s.get("name") or "").split())[:255] for s in signers}
        emails = {s.get("role"): clean_email(s.get("email")) for s in signers}
        checked = self._marks(roles, names, marks or {})
        day = signing_day(today)

        try:
            customer, created = self._save_customer(company_id, user.id, saved, customer, answered)
            requests = [
                self._sign_document(
                    doc, fields, company, customer, user, answered, known, day,
                    names, emails, checked, consent_text, ip, user_agent,
                )
                for doc, fields in zip(docs, fields_of)
            ]
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        email = (
            customer.email
            or answered.get("customer.email")
            or next((emails[r["role"]] for r in roles if emails.get(r["role"])), "")
        )
        return {
            "customerId": str(customer.id),
            "customerName": customer.name,
            "customerCreated": created,
            "customerEmail": email or None,
            "requests": [
                {
                    "id": str(r.id),
                    "documentId": str(r.document_id),
                    "documentName": r.document.name if r.document else None,
                    "signedPdfReady": bool(r.signed_file_path),
                }
                for r in requests
            ],
        }

    def _sign_document(
        self, doc, fields, company, customer, user, answered, known, day,
        names, emails, checked, consent_text, ip, user_agent,
    ) -> SignRequest:
        """One document's request, signed by everyone it needs. Flushed, not
        committed: the visit commits its documents together."""
        now = datetime.utcnow()
        prefill, by_role = document_values(fields, answered, known, day)
        sign_req = SignRequest(
            company_id=doc.company_id,
            document=doc,
            document_id=doc.id,
            sent_by=user.id,
            sender_email=user.email,
            sender_name=user.full_name or user.email,
            customer=customer,
            customer_id=customer.id,
            sign_fields=fields,
            prefill_data=prefill,
            delivery_method=IN_PERSON,
            email_subject=f"Signed in person: {doc.name}",
            cc_emails=[],
            bcc_emails=[],
            access_token=self.esign._generate_token(),
            # Nothing to expire: it's signed before it exists. The column is required.
            expires_at=now + timedelta(days=DEFAULT_EXPIRY_DAYS),
            status="signed",
            sent_at=now,
            viewed_at=now,
            signed_at=now,
        )
        if company is not None:
            sign_req.company = company
        self.db.add(sign_req)
        self.db.flush()

        # What was signed, frozen as a sent request's document is
        source_key, source_sha = self.esign._write_snapshot(sign_req)

        doc_roles = signer_roles([fields])
        for sequence, entry in enumerate(doc_roles):
            role = entry["role"]
            mark = checked[role]
            values = dict(by_role.get(role, {}))
            if mark["initials"]:
                values[INITIALS_KEY] = mark["initials"]
            sign_req.recipients.append(SignRecipient(
                role=role,
                name=names[role],
                email=emails.get(role) or "",
                sequence=sequence,
                status="signed",
                access_token=self.esign._generate_token(),
                viewed_at=now,
                signed_at=now,
                signature_data=mark["signature"],
                signature_type=mark["type"],
                signature_font=mark["font"],
                signer_ip=ip,
                signer_user_agent=(user_agent or "")[:500],
                consent_agreed=True,
                signed_field_values=values,
            ))
        self.db.flush()

        self.esign._log_event(
            sign_req.id,
            "created",
            actor_email=user.email,
            metadata={
                "delivery_method": IN_PERSON,
                "recipient_count": len(doc_roles),
                "source_key": source_key,
                "source_sha256": source_sha,
            },
        )
        for recipient in sign_req.recipients:
            own = {
                k: v for k, v in (recipient.signed_field_values or {}).items() if k != INITIALS_KEY
            }
            initials = (recipient.signed_field_values or {}).get(INITIALS_KEY)
            recipient.document_hash = self.esign._compute_document_hash(
                sign_req, recipient, own, initials
            )
            self.esign._log_event(
                sign_req.id,
                "signed",
                recipient_id=recipient.id,
                actor_email=recipient.email or None,
                actor_ip=ip,
                actor_user_agent=(user_agent or "")[:500],
                metadata={
                    "signature_type": recipient.signature_type,
                    "in_person": True,
                    "collected_by": user.email,
                    "signer_name": recipient.name,
                    "consent_text": (consent_text or "")[:1000],
                },
            )

        try:
            sign_req.signed_file_path = self.esign._burn_document(sign_req)
        except Exception as exc:  # noqa: BLE001
            # The signatures are saved regardless; the download re-burns it
            logger.exception("Burn failed for in-person request %s", sign_req.id)
            self.esign._log_event(sign_req.id, "burn_failed", metadata={"error": str(exc)})
        self.esign._log_event(
            sign_req.id, "completed", metadata={"recipient_count": len(doc_roles)}
        )
        return sign_req
