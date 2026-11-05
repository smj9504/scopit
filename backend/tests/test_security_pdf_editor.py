"""Security regression tests for the PDF editor and e-signature feature.

One section per fix: escaped e-sign emails, the sender address, send limits,
who sees signing links, checked signature images (and burning that survives
a bad stored one), Photos -> PDF limits, redaction leaving no replacement
text or hidden path data, DOCX conversion, download filenames, company
document roles, foreign customer ids, the envelope lock and the signed
PDF's fingerprint, and error messages that don't echo internals.

Unit tests: the DB session, storage and email are faked, nothing is sent.
"""
import asyncio
import base64
import hashlib
import re
import uuid
import zlib
from datetime import datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    ContentStream,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)
from reportlab.pdfgen import canvas

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.rate_limit import limiter
from app.domains.tools.modules.pdf_editor import api as editor_api
from app.domains.tools.modules.pdf_editor import company_docs_api, sign_api
from app.domains.tools.modules.pdf_editor import sign_service as sign_module
from app.domains.tools.modules.pdf_editor.pdf_geometry import page_view
from app.domains.tools.modules.pdf_editor.pdf_redact import apply_redactions
from app.domains.tools.modules.pdf_editor.schemas import (
    SignDeclineRequest,
    SignRequestCreate,
    SignSubmitRequest,
)
from app.domains.tools.modules.pdf_editor.service import PdfEditorService
from app.domains.tools.modules.pdf_editor.sign_service import SignService

# ── Fakes and builders ───────────────────────────────────────────────────


class MemoryStorage:
    def __init__(self, files=None):
        self.files = dict(files or {})

    def write(self, key, data, content_type="application/octet-stream"):
        self.files[key] = data

    def read(self, key):
        return self.files[key]

    def exists(self, key):
        return key in self.files

    def delete(self, key):
        self.files.pop(key, None)


def png_bytes(size=(20, 10), color=(255, 0, 0, 255), mode="RGBA", fmt="PNG"):
    buf = BytesIO()
    Image.new(mode, size, color if mode == "RGBA" else 0).save(buf, format=fmt)
    return buf.getvalue()


def png_b64(**kw):
    return base64.b64encode(png_bytes(**kw)).decode("ascii")


def blank_pdf(width=300, height=400):
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.drawString(10, 10, "page")
    c.showPage()
    c.save()
    return buf.getvalue()


def make_service(storage=None, db=None):
    service = SignService.__new__(SignService)
    service.db = db if db is not None else MagicMock()
    service.storage = storage if storage is not None else MemoryStorage()
    service.events = []
    service._log_event = lambda request_id, event_type, **kw: service.events.append(
        (event_type, kw)
    )
    return service


def make_recipient(role="signer_1", name="Pat Signer", email="pat@example.com", **kw):
    defaults = dict(
        id=uuid.uuid4(), role=role, name=name, email=email, status="viewed", phone=None,
        sequence=0, access_token=f"tok-{uuid.uuid4().hex}", signature_data=None,
        signed_at=None, signed_field_values={}, declined_at=None, viewed_at=None,
        consent_agreed=False,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def make_request(recipients, **kw):
    doc = kw.pop("document", None) or SimpleNamespace(
        id=uuid.uuid4(), name="Contract.pdf", file_path="co/pdf-editor/doc1/contract.pdf",
        mime_type="application/pdf", annotations=[], page_count=1,
    )
    now = datetime.utcnow()
    defaults = dict(
        id=uuid.uuid4(), status="viewed", document=doc, document_id=doc.id,
        recipients=recipients, sign_fields=[], prefill_data={},
        delivery_method="email_request", email_subject="Please sign",
        email_message=None, cc_emails=[], bcc_emails=[],
        sender_email="owner@company.com", sender_name="Owner", sent_by=uuid.uuid4(),
        customer_id=None, created_at=now, updated_at=None,
        expires_at=now + timedelta(days=10),
        sent_at=now, signed_at=None, declined_at=None, signed_file_path=None,
        company=SimpleNamespace(name="Acme"),
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def db_returning(obj):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = obj
    return db


def public_service(sign_req, recipient, storage=None, db=None):
    service = make_service(storage, db)
    service._resolve_by_token = lambda token: (sign_req, recipient)
    service._send_completion_notifications = MagicMock()
    service._burn_document = MagicMock(return_value="signed.pdf")
    return service


def user(role="staff", **kw):
    return SimpleNamespace(
        id=kw.pop("id", uuid.uuid4()), company_id=kw.pop("company_id", uuid.uuid4()),
        email=kw.pop("email", "me@company.com"), full_name=kw.pop("full_name", "Me Myself"),
        role=role, **kw,
    )


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def rate_limits(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    limiter.reset()
    yield
    limiter.reset()


SIG_FIELD = {
    "key": "signature_1", "type": "signature", "page": 1, "signer_role": "signer_1",
    "data_binding": {"mode": "signer_input"}, "required": True,
    "x": 0.1, "y": 0.1, "width": 0.3, "height": 0.1,
}


# ── 1. E-sign emails escape everything users typed ───────────────────────

EVIL_MESSAGE = '<a href="https://evil.example/login">Verify your account</a>'
EVIL_SENDER = '<img src=x onerror="alert(1)">Boss'
EVIL_RECIPIENT = "<b>Pat</b>"
EVIL_DOC = "<script>steal()</script>.pdf"


def evil_request(**kw):
    recipient = make_recipient(name=EVIL_RECIPIENT, status="signed")
    doc = SimpleNamespace(
        id=uuid.uuid4(), name=EVIL_DOC, file_path="co/pdf-editor/doc1/x.pdf",
        mime_type="application/pdf", annotations=[], page_count=1,
    )
    return recipient, make_request(
        [recipient], document=doc, email_message=EVIL_MESSAGE, sender_name=EVIL_SENDER,
        cc_emails=["cc@example.com"], company=SimpleNamespace(name="<i>Acme</i>"), **kw,
    )


def assert_inert(html):
    for raw in ('<a href="https://evil', "<img", "<script>", "<b>Pat", "<i>Acme"):
        assert raw not in html


def test_invitation_reminder_and_watcher_emails_escape_user_text():
    recipient, sign_req = evil_request()
    service = make_service()
    for html in (
        service._build_sign_email(sign_req, recipient, "https://app/sign/tok"),
        service._build_reminder_email(sign_req, recipient, "https://app/sign/tok"),
        service._build_watcher_notice_email(sign_req),
    ):
        assert_inert(html)
    invitation = service._build_sign_email(sign_req, recipient, "https://app/sign/tok")
    assert "&lt;a href=&quot;https://evil.example/login&quot;&gt;" in invitation
    assert "Hi &lt;b&gt;Pat&lt;/b&gt;," in invitation
    # The real signing link is still a link
    assert '<a href="https://app/sign/tok"' in invitation


def test_completion_emails_escape_user_text():
    _, sign_req = evil_request(status="signed", signed_at=datetime.utcnow())
    service = make_service()
    mock_email = MagicMock()
    with patch.object(sign_module, "email_service", mock_email):
        service._send_completion_notifications(sign_req)
    calls = [c.kwargs for c in mock_email.send_email.call_args_list]
    assert len(calls) == 3  # sender, recipient, Cc
    for call in calls:
        assert_inert(call["html_content"])


# ── 2. The sender address is always the signed-in user's ────────────────


def response_request(**kw):
    kw.setdefault("status", "sent")
    return make_request([make_recipient(status="sent")], **kw)


def test_create_ignores_a_requested_sender_email_and_keeps_the_name_one_line(monkeypatch):
    captured = {}

    class FakeService:
        def __init__(self, db):
            pass

        def create_sign_request(self, **kw):
            captured.update(kw)
            return response_request(status="draft", sender_email=kw["sender_email"],
                                    sender_name=kw["sender_name"], sent_by=kw["user_id"])

    monkeypatch.setattr(sign_api, "SignService", FakeService)
    me = user(email="me@company.com")
    data = SignRequestCreate(
        document_id=str(uuid.uuid4()),
        recipients=[{"role": "signer_1", "name": "Pat", "email": "pat@example.com"}],
        sender_email="ceo@bank.example",
        sender_name="Bank Security\r\nTeam   " + "x" * 300,
    )
    resp = run(sign_api.create_sign_request(data, db=None, current_user=me))
    assert captured["sender_email"] == "me@company.com"
    assert resp["senderEmail"] == "me@company.com"
    assert "\n" not in captured["sender_name"] and "\r" not in captured["sender_name"]
    assert captured["sender_name"].startswith("Bank Security Team x")
    assert len(captured["sender_name"]) <= sign_api.MAX_SENDER_NAME_LENGTH

    # No name given: the user's own
    data.sender_name = "   "
    run(sign_api.create_sign_request(data, db=None, current_user=me))
    assert captured["sender_name"] == "Me Myself"


# ── 3. Caps on recipients, Cc/Bcc, text, and throttled sends ─────────────


def create_payload(**kw):
    payload = {
        "document_id": str(uuid.uuid4()),
        "recipients": [{"role": "signer_1", "name": "Pat", "email": "pat@example.com"}],
    }
    payload.update(kw)
    return payload


@pytest.mark.parametrize("bad", [
    {"recipients": [{"role": f"r{i}", "name": "P", "email": f"p{i}@example.com"} for i in range(21)]},
    {"cc_emails": [f"c{i}@example.com" for i in range(6)],
     "bcc_emails": [f"b{i}@example.com" for i in range(5)]},
    {"cc_emails": ["not-an-email"]},
    {"bcc_emails": ["a@b"]},
    {"email_message": "x" * 5001},
    {"email_subject": "x" * 201},
    {"recipients": [{"role": "signer_1", "name": "P" * 201, "email": "p@example.com"}]},
])
def test_sign_request_limits(bad):
    with pytest.raises(ValidationError):
        SignRequestCreate(**create_payload(**bad))


def test_sign_request_within_limits_is_accepted():
    SignRequestCreate(**create_payload(
        recipients=[{"role": f"r{i}", "name": "P", "email": f"p{i}@example.com"} for i in range(20)],
        cc_emails=[f"c{i}@example.com" for i in range(5)],
        bcc_emails=[f"b{i}@example.com" for i in range(5)],
        email_message="x" * 5000, email_subject="x" * 200,
    ))
    with pytest.raises(ValidationError):
        SignDeclineRequest(reason="x" * 2001)


def remindable_request():
    return make_request([make_recipient(status="sent")], status="sent")


def test_reminders_are_throttled_per_request(rate_limits):
    sign_req = remindable_request()
    service = make_service(db=db_returning(sign_req))
    mock_email = MagicMock()
    with patch.object(sign_module, "email_service", mock_email):
        for _ in range(sign_module.REMINDERS_PER_REQUEST_PER_DAY):
            service.send_reminder(uuid.uuid4(), sign_req.id)
        with pytest.raises(HTTPException) as exc:
            service.send_reminder(uuid.uuid4(), sign_req.id)
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers
    assert mock_email.send_email.call_count == sign_module.REMINDERS_PER_REQUEST_PER_DAY

    # Another request has its own allowance
    other = remindable_request()
    service = make_service(db=db_returning(other))
    with patch.object(sign_module, "email_service", MagicMock()):
        service.send_reminder(uuid.uuid4(), other.id)


def test_sends_share_the_company_email_budget(rate_limits, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_SENDS_PER_COMPANY_PER_HOUR", 2)
    company_id = uuid.uuid4()
    # Two customer emails already went out (e.g. estimates) this hour
    for _ in range(2):
        assert limiter.hit(f"email-send:{company_id}", 2, 3600) == 0

    draft = make_request([make_recipient(status="pending")], status="draft")
    storage = MemoryStorage({draft.document.file_path: blank_pdf()})
    service = make_service(storage, db_returning(draft))
    mock_email = MagicMock()
    with patch.object(sign_module, "email_service", mock_email):
        with pytest.raises(HTTPException) as exc:
            service.send_sign_request(company_id, draft.id)
        assert exc.value.status_code == 429
        assert draft.status == "draft"

        sign_req = remindable_request()
        service = make_service(db=db_returning(sign_req))
        with pytest.raises(HTTPException) as exc:
            service.send_reminder(company_id, sign_req.id)
        assert exc.value.status_code == 429

        signed = make_request([make_recipient(status="signed")], status="signed")
        service = make_service(db=db_returning(signed))
        with pytest.raises(HTTPException) as exc:
            service.resend_signed_copies(company_id, signed.id, "me@company.com")
        assert exc.value.status_code == 429
    mock_email.send_email.assert_not_called()


def test_a_send_uses_one_slot_of_the_company_budget(rate_limits):
    company_id = uuid.uuid4()
    draft = make_request([make_recipient(status="pending")], status="draft")
    storage = MemoryStorage({draft.document.file_path: blank_pdf()})
    service = make_service(storage, db_returning(draft))
    with patch.object(sign_module, "email_service", MagicMock()):
        service.send_sign_request(company_id, draft.id)
    assert limiter.count(f"email-send:{company_id}", 3600) == 1


# ── 4. Live signing links only for the sender and admins/managers ────────


def test_sign_links_only_for_the_sender_and_admins_or_managers():
    sender = user("staff")
    sign_req = response_request(sent_by=sender.id)
    recipient = sign_req.recipients[0]

    assert recipient.access_token in sign_api._to_sign_response(sign_req, sender)["signUrls"][str(recipient.id)]
    for role in ("admin", "manager"):
        assert sign_api._to_sign_response(sign_req, user(role))["signUrls"]
    assert sign_api._to_sign_response(sign_req, user("staff"))["signUrls"] == {}
    assert sign_api._to_sign_response(sign_req, None)["signUrls"] == {}
    # The rest of the request is still there for a colleague
    assert sign_api._to_sign_response(sign_req, user("staff"))["recipients"][0]["email"] == recipient.email

    draft = response_request(status="draft", sent_by=sender.id)
    assert sign_api._to_sign_response(draft, sender)["signUrls"] == {}


# ── 5. Submitted images and values are checked; burning survives bad ones


def submit(service, signature, initials=None, values=None):
    return service.submit_signature(
        "tok", signature, "draw", "", values or {}, True, "1.2.3.4", "ua",
        initials_data=initials,
    )


def signer_setup(fields=(SIG_FIELD,)):
    recipient = make_recipient()
    sign_req = make_request([recipient], sign_fields=list(fields))
    return recipient, sign_req, public_service(sign_req, recipient)


BAD_SUBMITS = {
    "not-an-image": lambda: ("SIGB64", None),
    "gif": lambda: (png_b64(fmt="GIF", mode="RGBA"), None),
    "5-megapixels": lambda: (png_b64(size=(2500, 2000), mode="L"), None),
    "over-2MB": lambda: ("A" * (3 * 1024 * 1024), None),
    "bad-initials": lambda: (png_b64(), "not-an-image"),
}


@pytest.mark.parametrize("case", sorted(BAD_SUBMITS))
def test_bad_signature_images_are_refused(case):
    signature, initials = BAD_SUBMITS[case]()
    recipient, sign_req, service = signer_setup()
    with pytest.raises(HTTPException) as exc:
        submit(service, signature, initials)
    assert exc.value.status_code == 400
    assert recipient.status == "viewed" and recipient.signature_data is None


def test_png_and_jpeg_signatures_are_accepted_bare_or_as_data_urls():
    for signature in (
        png_b64(),
        "data:image/png;base64," + png_b64(),
        base64.b64encode(png_bytes(mode="RGB", color=(0, 0, 0), fmt="JPEG")).decode(),
    ):
        recipient, sign_req, service = signer_setup()
        submit(service, signature)
        assert recipient.status == "signed" and sign_req.status == "signed"


def test_no_signature_needed_still_submits_with_an_empty_image():
    text_field = {"key": "notes", "type": "text", "signer_role": "signer_1",
                  "data_binding": {"mode": "signer_input"}, "required": True}
    recipient, sign_req, service = signer_setup([text_field])
    submit(service, "", values={"notes": "ok"})
    assert recipient.status == "signed"


@pytest.mark.parametrize("values", [
    {f"k{i}": "v" for i in range(sign_module.MAX_FIELD_VALUES + 1)},
    {"notes": "x" * (sign_module.MAX_FIELD_VALUE_LENGTH + 1)},
    {"k" * (sign_module.MAX_FIELD_KEY_LENGTH + 1): "v"},
])
def test_too_many_or_too_long_field_values_are_refused(values):
    recipient, sign_req, service = signer_setup()
    with pytest.raises(HTTPException) as exc:
        submit(service, png_b64(), values=values)
    assert exc.value.status_code == 400
    assert recipient.status == "viewed"


def test_submit_schema_bounds_short_fields():
    with pytest.raises(ValidationError):
        SignSubmitRequest(signature_data="", signature_font="f" * 101)
    with pytest.raises(ValidationError):
        SignSubmitRequest(signature_data="", signature_type="t" * 21)


def legacy_signed_request(signature_data, document=None, text_value="Hello there"):
    text_field = {"key": "notes", "type": "text", "page": 1, "signer_role": "signer_1",
                  "data_binding": {"mode": "signer_input"}, "x": 0.1, "y": 0.5,
                  "width": 0.6, "height": 0.05}
    recipient = make_recipient(status="signed", signature_data=signature_data,
                               signed_at=datetime(2026, 1, 2, 15, 4),
                               signed_field_values={"notes": text_value})
    return make_request([recipient], status="signed", sign_fields=[SIG_FIELD, text_field],
                        **({"document": document} if document else {}))


BAD_STORED = {
    "not-base64": lambda: "not base64 at all !!",
    "not-an-image": lambda: base64.b64encode(b"GIF89a not really").decode(),
    "20-megapixels": lambda: png_b64(size=(5000, 4000), mode="L"),  # over the burn-time limit
}


@pytest.mark.parametrize("case", sorted(BAD_STORED))
def test_a_bad_stored_signature_never_stops_the_signed_pdf(case):
    sign_req = legacy_signed_request(BAD_STORED[case]())
    storage = MemoryStorage({sign_req.document.file_path: blank_pdf()})
    service = make_service(storage)

    key = service.ensure_signed_file(sign_req)

    page = PdfReader(BytesIO(storage.read(key))).pages[0]
    assert "Hello there" in page.extract_text()  # the rest is still burned
    assert not page["/Resources"].get("/XObject")  # the bad image is left out
    event, kw = service.events[-1]
    assert event == "signed_file_generated"
    assert kw["metadata"]["signed_sha256"] == hashlib.sha256(storage.read(key)).hexdigest()


def test_a_bad_stored_signature_on_an_image_document_is_left_out():
    doc = SimpleNamespace(
        id=uuid.uuid4(), name="Photo.png", file_path="co/pdf-editor/doc2/photo.png",
        mime_type="image/png", annotations=[], page_count=1,
    )
    sign_req = legacy_signed_request("garbage", document=doc)
    storage = MemoryStorage({doc.file_path: png_bytes(size=(300, 400), mode="RGBA")})
    key = make_service(storage)._burn_document(sign_req)
    assert storage.read(key).startswith(b"%PDF")


def test_a_good_stored_signature_is_still_burned():
    sign_req = legacy_signed_request("data:image/png;base64," + png_b64())
    storage = MemoryStorage({sign_req.document.file_path: blank_pdf()})
    key = make_service(storage)._burn_document(sign_req)
    page = PdfReader(BytesIO(storage.read(key))).pages[0]
    assert len(page["/Resources"]["/XObject"]) == 1


# ── 6. Photos -> PDF limits ──────────────────────────────────────────────


@pytest.fixture(autouse=True)
def plain_documents(monkeypatch):
    # New documents as plain objects: no mapper setup or database needed
    from app.domains.tools.modules.pdf_editor import service as service_module

    monkeypatch.setattr(service_module, "PdfDocument", lambda **kw: SimpleNamespace(**kw))


def photo_service():
    service = PdfEditorService.__new__(PdfEditorService)
    service.db = MagicMock()
    service.storage = MemoryStorage()
    service._generate_thumbnail = lambda *a: False
    return service


def upload(data, name="photo.png"):
    return SimpleNamespace(file=BytesIO(data), filename=name)


def test_photos_to_pdf_still_works():
    doc = photo_service().images_to_pdf(
        uuid.uuid4(), uuid.uuid4(),
        [upload(png_bytes(size=(60, 40))), upload(png_bytes(mode="RGB", color=(0, 0, 0), fmt="JPEG"), "b.jpg")],
    )
    assert doc.page_count == 2


BAD_PHOTOS = {
    "51-files": (lambda: [upload(png_bytes()) for _ in range(51)], "at most 50"),
    "eps": (lambda: [upload(b"%!PS-Adobe-3.0 EPSF-3.0\n", "evil.eps")], "evil.eps"),
    "49-megapixels": (lambda: [upload(png_bytes(size=(7000, 7000), mode="L"), "huge.png")], "megapixels"),
    "over-25MB": (lambda: [upload(b"x" * (25 * 1024 * 1024 + 1), "big.png")], "too large"),
}


@pytest.mark.parametrize("case", sorted(BAD_PHOTOS))
def test_photos_to_pdf_refuses_too_many_unknown_or_huge_files(case):
    make_files, message = BAD_PHOTOS[case]
    with pytest.raises(HTTPException) as exc:
        photo_service().images_to_pdf(uuid.uuid4(), uuid.uuid4(), make_files())
    assert exc.value.status_code == 400
    assert message in exc.value.detail


# ── 7. Redaction leaves no replacement text or hidden path data ──────────


def everything_in(pdf: bytes) -> bytes:
    chunks = [pdf]
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        try:
            chunks.append(zlib.decompress(m.group(1)))
        except Exception:
            pass
    return b"\n".join(chunks)


def view_box(page, x0, y0, x1, y1):
    """An annotation-like box over the user-space rect (x0, y0)-(x1, y1)."""
    a, b, c, d, e, f = page_view(page).to_user
    det = a * d - b * c
    inv = (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)
    (vx0, vy0), (vx1, vy1) = [
        (inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5])
        for x, y in ((x0, y0), (x1, y1))
    ]
    return {"id": "area", "type": "redact", "page": 1, "x": (vx0 + vx1) / 2,
            "y": (vy0 + vy1) / 2, "width": abs(vx1 - vx0), "height": abs(vy1 - vy0),
            "rotation": 0}


def _stream(writer, data: bytes):
    stream = DecodedStreamObject()
    stream.set_data(data)
    return writer._add_object(stream)


def tagged_pdf() -> bytes:
    """Two pages of a tagged PDF. Page 1 has replacement text everywhere it
    can be: inline and named marked-content properties, and its structure
    element's /Alt, /ActualText and /E. Page 2's element has an /Alt too."""
    w = PdfWriter()
    font = w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }))
    named = w._add_object(DictionaryObject({
        NameObject("/MCID"): NumberObject(1),
        NameObject("/ActualText"): TextStringObject("NAMEDSECRET"),
    }))
    pages = []
    for content, props in (
        (b"/Span <</ActualText (INLINESECRET) /MCID 0>> BDC BT /F1 12 Tf 20 350 Td (Jane Doe) Tj ET EMC\n"
         b"/Span /MC1 BDC BT /F1 12 Tf 20 330 Td (Account 42) Tj ET EMC\n"
         b"/Span <</Alt (FARAWAYSECRET) /MCID 2>> BDC BT /F1 12 Tf 20 50 Td (Footer) Tj ET EMC\n",
         {NameObject("/MC1"): named}),
        (b"/P <</MCID 0>> BDC BT /F1 12 Tf 20 350 Td (Page two) Tj ET EMC\n", {}),
    ):
        page = w.add_blank_page(300, 400)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
            NameObject("/Properties"): DictionaryObject(props),
        })
        page[NameObject("/Contents")] = _stream(w, content)
        pages.append(page)

    def elem(tag, page, kids, **text):
        entries = {
            NameObject("/Type"): NameObject("/StructElem"), NameObject("/S"): NameObject(f"/{tag}"),
            NameObject("/K"): kids,
        }
        if page is not None:
            entries[NameObject("/Pg")] = page.indirect_reference
        for key, value in text.items():
            entries[NameObject(f"/{key}")] = TextStringObject(value)
        return w._add_object(DictionaryObject(entries))

    span = elem("Span", pages[0], NumberObject(0), Alt="STRUCTALTSECRET",
                ActualText="STRUCTACTUALSECRET", E="EXPANSIONSECRET")
    # Content found through a marked-content reference (no /Pg of its own)
    mcr = DictionaryObject({NameObject("/Type"): NameObject("/MCR"),
                            NameObject("/Pg"): pages[0].indirect_reference,
                            NameObject("/MCID"): NumberObject(1)})
    figure = elem("Figure", None, ArrayObject([mcr]), Alt="FIGUREALTSECRET")
    other = elem("P", pages[1], NumberObject(0), Alt="Page two alt")
    section = elem("Sect", None, ArrayObject([span, figure]), Alt="SECTIONSUMMARYSECRET")
    document = elem("Document", None, ArrayObject([section, other]))
    w._root_object[NameObject("/StructTreeRoot")] = w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/StructTreeRoot"), NameObject("/K"): document,
    }))
    w._root_object[NameObject("/MarkInfo")] = DictionaryObject({NameObject("/Marked"): TextStringObject("true")})
    out = BytesIO()
    w.write(out)
    return out.getvalue()


def test_redaction_removes_actual_text_and_alt_text_of_the_redacted_page():
    pdf = tagged_pdf()
    secrets = (b"INLINESECRET", b"NAMEDSECRET", b"STRUCTALTSECRET",
               b"STRUCTACTUALSECRET", b"EXPANSIONSECRET", b"FIGUREALTSECRET",
               b"SECTIONSUMMARYSECRET", b"FARAWAYSECRET")
    assert all(s in everything_in(pdf) for s in secrets)  # (the fixture has them all)
    page = PdfReader(BytesIO(pdf)).pages[0]

    out, _ = apply_redactions(pdf, {1: [view_box(page, 15, 325, 200, 365)]})

    found = everything_in(out)
    for secret in secrets:
        assert secret not in found, secret
    reader = PdfReader(BytesIO(out))
    assert "Jane" not in reader.pages[0].extract_text()
    assert "Footer" in reader.pages[0].extract_text()
    # Another page's accessibility text is left alone
    assert b"Page two alt" in found
    assert "Page two" in reader.pages[1].extract_text()
    # Marked content still opens and closes (only the text entries went)
    ops = [op for _, op in ContentStream(reader.pages[0].get_contents(), None).operations]
    assert ops.count(b"BDC") == 3 and ops.count(b"EMC") == 3


def page_with(content: bytes) -> bytes:
    w = PdfWriter()
    page = w.add_blank_page(300, 400)
    page[NameObject("/Resources")] = DictionaryObject()
    page[NameObject("/Contents")] = _stream(w, content)
    out = BytesIO()
    w.write(out)
    return out.getvalue()


def ops_of(pdf: bytes) -> list:
    page = PdfReader(BytesIO(pdf)).pages[0]
    return [([float(v) for v in o if isinstance(v, (int, float))], op)
            for o, op in ContentStream(page.get_contents(), None).operations]


def redact_box(pdf, x0, y0, x1, y1):
    page = PdfReader(BytesIO(pdf)).pages[0]
    return apply_redactions(pdf, {1: [view_box(page, x0, y0, x1, y1)]})[0]


def test_a_path_partly_inside_the_area_goes_with_its_coordinates():
    # A signature-like stroke that dips into the area at (125, 125)
    pdf = page_with(b"1 0 0 RG 40 300 m 125 125 l 260 300 l S\n")
    ops = ops_of(redact_box(pdf, 100, 100, 150, 150))
    assert ([125.0, 125.0], b"l") not in ops
    assert ([40.0, 300.0], b"m") not in ops
    assert b"S" not in [op for _, op in ops]


def test_only_the_subpaths_reaching_into_the_area_go():
    # One path: a rule across the area (both ends outside) and a box inside it
    pdf = page_with(b"0 120 m 300 120 l 110 110 20 20 re S\n")
    ops = ops_of(redact_box(pdf, 100, 100, 150, 150))
    assert ([0.0, 120.0], b"m") in ops and ([300.0, 120.0], b"l") in ops
    assert ([110.0, 110.0, 20.0, 20.0], b"re") not in ops
    assert [op for _, op in ops].count(b"S") == 1


def test_a_background_behind_the_area_stays():
    pdf = page_with(b"0.9 g 0 0 300 400 re f\n")
    ops = ops_of(redact_box(pdf, 100, 100, 150, 150))
    assert ([0.0, 0.0, 300.0, 400.0], b"re") in ops
    assert [op for _, op in ops].count(b"f") == 2  # the background and the area


def test_a_clipping_path_still_clips_but_is_not_painted():
    pdf = page_with(b"q 110 110 20 20 re W f 0 0 1 rg 0 0 300 400 re f Q\n")
    ops = [op for _, op in ops_of(redact_box(pdf, 100, 100, 150, 150))]
    assert b"W" in ops
    # The clip's own paint is gone; what's drawn inside the clip is still there
    assert ops[ops.index(b"W") + 1] == b"n"


# ── 8. DOCX conversion keeps text as text and doesn't echo errors ────────


def test_docx_text_is_not_read_as_markup(tmp_path):
    from docx import Document

    path = tmp_path / "in.docx"
    d = Document()
    d.add_paragraph("<b>Bold & <i>unclosed")
    d.add_paragraph('<img src="/etc/passwd" width="10" height="10"/> after')
    d.save(path)
    out = tmp_path / "out.pdf"

    photo_service()._docx_to_pdf(str(path), str(out))

    text = PdfReader(str(out)).pages[0].extract_text()
    assert "<b>Bold & <i>unclosed" in text
    assert '<img src="/etc/passwd"' in text


def test_docx_conversion_failure_is_generic(tmp_path):
    path = tmp_path / "broken.docx"
    path.write_bytes(b"this is not a zip file")
    with pytest.raises(HTTPException) as exc:
        photo_service()._docx_to_pdf(str(path), str(tmp_path / "out.pdf"))
    assert exc.value.status_code == 400
    assert "zip" not in exc.value.detail.lower()
    assert str(tmp_path) not in exc.value.detail


# ── 9. Downloads with Korean (or quoted) names ───────────────────────────

KOREAN = '견적서 "최종".pdf'


def assert_safe_disposition(response, expected_name):
    header = response.headers["content-disposition"]
    header.encode("latin-1")  # a header that can't be is what used to 500
    assert header.startswith("attachment; filename=")
    assert "filename*=UTF-8''" in header
    from urllib.parse import unquote
    assert unquote(header.split("filename*=UTF-8''", 1)[1]) == expected_name


def test_editor_downloads_with_korean_names(monkeypatch):
    doc = SimpleNamespace(id=uuid.uuid4(), name=KOREAN, file_path="d.pdf")

    class FakeService:
        def __init__(self, db):
            pass

        def get_document_or_404(self, **kw):
            return doc

        def flatten_annotations(self, **kw):
            return b"%PDF flat"

        def protected_copy(self, **kw):
            return b"%PDF locked"

    monkeypatch.setattr(editor_api, "PdfEditorService", FakeService)
    monkeypatch.setattr(editor_api, "get_storage", lambda: MemoryStorage({"d.pdf": b"%PDF"}))
    me = user()
    resp = run(editor_api.download_document(doc.id, flatten=False, db=None, current_user=me))
    assert_safe_disposition(resp, '견적서 _최종_.pdf')
    resp = run(editor_api.flatten_document(doc.id, db=None, current_user=me))
    assert_safe_disposition(resp, 'flattened-견적서 _최종_.pdf')
    body = SimpleNamespace(open_password="pw", permissions_password=None, allow_printing=True,
                           allow_copying=True, allow_editing=True, allow_commenting=True)
    resp = run(editor_api.protect_document(doc.id, body, db=None, current_user=me))
    assert_safe_disposition(resp, '견적서 _최종_ (protected).pdf')


def test_signed_and_library_downloads_with_korean_names(monkeypatch):
    sign_req = response_request(status="signed", document=SimpleNamespace(
        id=uuid.uuid4(), name="계약서.pdf", file_path="x", mime_type="application/pdf"))

    class FakeSignService:
        def __init__(self, db):
            pass

        def get_sign_request(self, **kw):
            return sign_req

        def ensure_signed_file(self, req):
            return "signed.pdf"

    monkeypatch.setattr(sign_api, "SignService", FakeSignService)
    monkeypatch.setattr(sign_api, "get_storage", lambda: MemoryStorage({"signed.pdf": b"%PDF"}))
    resp = run(sign_api.download_signed_document(sign_req.id, db=None, current_user=user()))
    assert_safe_disposition(resp, "계약서_signed.pdf")

    library_doc = SimpleNamespace(name="보증서", file_path="lib.pdf")

    class FakeLibrary:
        def __init__(self, db):
            pass

        def get_or_404(self, **kw):
            return library_doc

    monkeypatch.setattr(company_docs_api, "CompanyDocumentService", FakeLibrary)
    monkeypatch.setattr(company_docs_api, "get_storage", lambda: MemoryStorage({"lib.pdf": b"%PDF"}))
    resp = company_docs_api.download_company_document(uuid.uuid4(), db=None, current_user=user())
    assert_safe_disposition(resp, "보증서.pdf")


# ── 10. Only admins/managers change the company document library ─────────


def library_client(monkeypatch, role):
    calls = []

    class FakeLibrary:
        def __init__(self, db):
            pass

        def list(self, **kw):
            return [], 0

        def upload(self, **kw):
            calls.append("upload")
            raise HTTPException(status_code=418, detail="reached the service")

        def update(self, **kw):
            calls.append("update")
            raise HTTPException(status_code=418, detail="reached the service")

        def delete(self, **kw):
            calls.append("delete")
            return True

    monkeypatch.setattr(company_docs_api, "CompanyDocumentService", FakeLibrary)
    app = FastAPI()
    app.include_router(company_docs_api.router, prefix="/api/company-documents")
    app.dependency_overrides[get_current_user] = lambda: user(role)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    return TestClient(app), calls


def library_writes(client, doc_id):
    return [
        client.post("/api/company-documents/upload", data={"name": "Lease"},
                    files={"file": ("lease.pdf", b"%PDF-1.4", "application/pdf")}).status_code,
        client.patch(f"/api/company-documents/{doc_id}", json={"name": "New"}).status_code,
        client.delete(f"/api/company-documents/{doc_id}").status_code,
    ]


def test_staff_cannot_change_the_company_document_library(monkeypatch):
    client, calls = library_client(monkeypatch, "staff")
    assert library_writes(client, uuid.uuid4()) == [403, 403, 403]
    assert calls == []
    # Reading stays open to everyone in the company
    assert client.get("/api/company-documents").status_code == 200


@pytest.mark.parametrize("role", ["admin", "manager"])
def test_admins_and_managers_can_change_the_company_document_library(monkeypatch, role):
    client, calls = library_client(monkeypatch, role)
    assert library_writes(client, uuid.uuid4()) == [418, 418, 200]
    assert calls == ["upload", "update", "delete"]


# ── 11. A customer from another company is refused, not stored ───────────


def test_create_refuses_a_customer_that_is_not_the_companys(monkeypatch):
    created = []
    monkeypatch.setattr(sign_module, "SignRequest", lambda **kw: created.append(kw))
    doc = SimpleNamespace(id=uuid.uuid4(), name="Lease.pdf", field_definitions=[], customer_id=None)
    db = MagicMock()
    # The document is found; the customer isn't (it's another company's)
    db.query.return_value.filter.return_value.first.side_effect = [doc, None, SimpleNamespace()]
    service = make_service(db=db)
    with pytest.raises(HTTPException) as exc:
        service.create_sign_request(
            company_id=uuid.uuid4(), user_id=uuid.uuid4(), document_id=doc.id,
            recipients=[{"role": "signer", "name": "Jane", "email": "jane@example.com"}],
            sender_email="owner@company.com", sender_name="Owner",
            customer_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
    assert created == []


# ── 12. The envelope is locked for submit/decline; the PDF's hash is kept ─


def test_last_two_signers_at_once_still_complete_the_envelope():
    """B signed in another transaction a moment ago; this session still has
    B as 'viewed'. The lock makes A wait for B's commit and re-read, so A's
    submit completes the envelope instead of leaving it partially_signed."""
    a = make_recipient(name="A")
    b = make_recipient(role="signer_2", name="B", email="b@example.com")
    sign_req = make_request([a, b], sign_fields=[SIG_FIELD], status="partially_signed")
    db = MagicMock()
    order = []
    db.query.return_value.filter.return_value.with_for_update.side_effect = (
        lambda **kw: order.append(("lock", kw)) or MagicMock()
    )

    def refresh(obj):
        order.append(("refresh", obj))
        if obj is b:  # what B's committed transaction wrote
            b.status, b.signature_data = "signed", png_b64()

    db.refresh.side_effect = refresh
    storage = MemoryStorage({"signed.pdf": b"%PDF signed bytes"})
    service = public_service(sign_req, a, storage=storage, db=db)

    submit(service, png_b64())

    assert order[0] == ("lock", {"key_share": True})  # FOR NO KEY UPDATE, first
    assert ("refresh", sign_req) in order and ("refresh", b) in order
    assert sign_req.status == "signed"
    completed = [kw for event, kw in service.events if event == "completed"]
    assert completed[0]["metadata"]["signed_sha256"] == hashlib.sha256(b"%PDF signed bytes").hexdigest()


def test_a_signer_who_already_signed_elsewhere_gets_a_conflict_after_the_lock():
    a = make_recipient()
    sign_req = make_request([a], sign_fields=[SIG_FIELD])
    db = MagicMock()
    db.refresh.side_effect = lambda obj: setattr(a, "status", "signed") if obj is a else None
    with pytest.raises(HTTPException) as exc:
        submit(public_service(sign_req, a, db=db), png_b64())
    assert exc.value.status_code == 409


def test_decline_takes_the_envelope_lock():
    a = make_recipient()
    sign_req = make_request([a])
    db = MagicMock()
    with patch.object(sign_module, "email_service", MagicMock()):
        public_service(sign_req, a, db=db).decline_signature("tok", "no", "ip", "ua")
    db.query.return_value.filter.return_value.with_for_update.assert_called_with(key_share=True)
    assert sign_req.status == "declined"


# ── 13. Rendering errors don't echo internals ────────────────────────────


def test_page_rendering_errors_are_generic(monkeypatch):
    import pdf2image

    def boom(*a, **kw):
        raise RuntimeError(r"pdftoppm failed reading C:\secret\storage\doc.pdf")

    monkeypatch.setattr(pdf2image, "convert_from_bytes", boom)

    doc = SimpleNamespace(id=uuid.uuid4(), name="d.pdf", file_path="d.pdf", page_count=1)

    class FakeService:
        def __init__(self, db):
            pass

        def get_document_or_404(self, **kw):
            return doc

    monkeypatch.setattr(editor_api, "PdfEditorService", FakeService)
    monkeypatch.setattr(editor_api, "get_storage", lambda: MemoryStorage({"d.pdf": b"%PDF"}))
    with pytest.raises(HTTPException) as exc:
        run(editor_api.get_page_image(doc.id, 1, db=None, current_user=user()))
    assert exc.value.status_code == 503
    assert "secret" not in exc.value.detail and "pdftoppm" not in exc.value.detail

    sign_req = response_request()

    class FakeSignService:
        def __init__(self, db):
            pass

        def get_by_token(self, token):
            return sign_req

        def get_page_count(self, req):
            return 1

        def get_source_bytes(self, req):
            return b"%PDF"

    monkeypatch.setattr(sign_api, "SignService", FakeSignService)
    with pytest.raises(HTTPException) as exc:
        run(sign_api.get_page_image("tok", 1, request=None, db=None))
    assert exc.value.status_code == 503
    assert "secret" not in exc.value.detail
