"""E-sign service tests: burn geometry, per-request storage keys, email
routing and public-endpoint state checks.

Pure unit tests -- the DB session, storage and email transport are all
faked, so nothing here needs a live database or makes a network call.
"""
import base64
import uuid
from datetime import datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject
from reportlab.pdfgen import canvas

from app.domains.tools.modules.pdf_editor import sign_service as sign_module
from app.domains.tools.modules.pdf_editor.sign_service import INITIALS_KEY, SignService

# ── Fakes ────────────────────────────────────────────────────────────────


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


def png_b64(color=(255, 0, 0, 255), size=(20, 10)):
    buf = BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def blank_pdf(width=300, height=400, rotate=0):
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.drawString(10, 10, "page")
    c.showPage()
    c.save()
    if not rotate:
        return buf.getvalue()
    reader = PdfReader(BytesIO(buf.getvalue()))
    writer = PdfWriter()
    page = reader.pages[0]
    page[NameObject("/Rotate")] = NumberObject(rotate)
    writer.add_page(page)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


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
        id=uuid.uuid4(), role=role, name=name, email=email, status="pending",
        access_token=f"tok-{uuid.uuid4().hex}", signature_data=None,
        signed_at=None, signed_field_values={}, declined_at=None, viewed_at=None,
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
        id=uuid.uuid4(), status="draft", document=doc, document_id=doc.id,
        recipients=recipients, sign_fields=[], prefill_data={},
        delivery_method="email_request", email_subject="Please sign",
        email_message=None, cc_emails=[], bcc_emails=[],
        sender_email="owner@company.com", sender_name="Owner",
        created_at=now - timedelta(days=3), expires_at=now - timedelta(days=3) + timedelta(days=14),
        sent_at=None, signed_at=None, declined_at=None, signed_file_path=None,
        company=SimpleNamespace(name="Acme"),
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def db_returning(obj):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = obj
    return db


# ── Burn geometry ────────────────────────────────────────────────────────


def _mat_mul(m1, m2):
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2, a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2,
    )


def image_bboxes(page):
    """User-space bounding boxes of every image XObject painted on the page
    (tracks q/Q/cm so nested transforms are honoured)."""
    xobjects = page["/Resources"].get("/XObject", {})
    ctm = (1, 0, 0, 1, 0, 0)
    stack, boxes = [], []
    for operands, op in page.get_contents().operations:
        if op == b"q":
            stack.append(ctm)
        elif op == b"Q":
            ctm = stack.pop()
        elif op == b"cm":
            ctm = _mat_mul(tuple(float(v) for v in operands), ctm)
        elif op == b"Do":
            xobj = xobjects[operands[0]].get_object()
            if xobj.get("/Subtype") != "/Image":
                continue
            pts = []
            for ux, uy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                a, b, c, d, e, f = ctm
                pts.append((a * ux + c * uy + e, b * ux + d * uy + f))
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def burn(tmp_path, pdf_bytes, field):
    src = tmp_path / "src.pdf"
    out = tmp_path / "out.pdf"
    src.write_bytes(pdf_bytes)
    recipient = make_recipient(
        signature_data=png_b64(), status="signed", signed_at=datetime(2026, 1, 2, 15, 4),
    )
    sign_req = make_request([recipient], sign_fields=[field])
    make_service()._burn_fields_pdf(sign_req, str(src), str(out))
    return PdfReader(str(out)).pages[0]


SIG_FIELD = {
    "key": "signature_1", "type": "signature", "page": 1, "signer_role": "signer_1",
    "data_binding": {"mode": "signer_input"}, "required": True,
}


def test_rotated_page_signature_lands_where_the_viewer_placed_it(tmp_path):
    # 300x400 page displayed with /Rotate 90 -> pdf.js viewport is 400x300.
    # Screen box: x 0.5..0.7 of 400 = 200..280, y 0.1..0.4 of 300 = 30..120.
    # For /Rotate 90, screen (sx, sy) == user (uy, ux), so the image must
    # occupy user x 30..120, y 200..280 (bottom-right quadrant of the
    # unrotated page's left half), not the unrotated mediabox mapping.
    field = {**SIG_FIELD, "x": 0.5, "y": 0.1, "width": 0.2, "height": 0.3}
    page = burn(tmp_path, blank_pdf(300, 400, rotate=90), field)

    boxes = image_bboxes(page)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert (x0, y0, x1, y1) == pytest.approx((30, 200, 120, 280), abs=0.5)


def test_unrotated_page_signature_position_is_unchanged(tmp_path):
    field = {**SIG_FIELD, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1}
    page = burn(tmp_path, blank_pdf(300, 400), field)
    x0, y0, x1, y1 = image_bboxes(page)[0]
    # x 30..90; y measured from the top: 40..80 -> user y 320..360
    assert (x0, y0, x1, y1) == pytest.approx((30, 320, 90, 360), abs=0.5)


def test_burned_timestamp_is_labelled_utc(tmp_path):
    field = {**SIG_FIELD, "x": 0.1, "y": 0.1, "width": 0.4, "height": 0.1}
    page = burn(tmp_path, blank_pdf(300, 400, rotate=90), field)
    assert "01/02/2026 03:04 PM UTC" in page.extract_text()


# ── Initials ─────────────────────────────────────────────────────────────


def test_initials_field_burns_initials_image_with_legacy_fallback():
    sig, initials = png_b64((255, 0, 0, 255)), png_b64((0, 0, 255, 255))
    field = {"key": "initials_1", "type": "initials", "signer_role": "signer_1"}
    service = make_service()

    with_initials = make_request([make_recipient(
        signature_data=sig, signed_field_values={INITIALS_KEY: initials},
    )])
    assert service._resolve_burn_value(field, with_initials)["image_b64"] == initials

    legacy = make_request([make_recipient(signature_data=sig, signed_field_values={})])
    assert service._resolve_burn_value(field, legacy)["image_b64"] == sig

    sig_field = {**field, "type": "signature"}
    assert service._resolve_burn_value(sig_field, with_initials)["image_b64"] == sig


def test_submit_stores_initials_separately():
    recipient = make_recipient(status="viewed")
    sign_req = make_request(
        [recipient], status="viewed",
        sign_fields=[
            {**SIG_FIELD},
            {"key": "initials_1", "type": "initials", "signer_role": "signer_1", "required": True},
        ],
    )
    service = make_service()
    service._resolve_by_token = lambda token: (sign_req, recipient)
    service._send_completion_notifications = MagicMock()
    service._burn_document = MagicMock(return_value="key.pdf")

    service.submit_signature(
        "tok", "SIGB64", "draw", "", {"__initials__": "spoofed"}, True, "1.2.3.4", "ua",
        initials_data="INITB64",
    )
    assert recipient.signature_data == "SIGB64"
    assert recipient.signed_field_values == {INITIALS_KEY: "INITB64"}
    assert sign_req.status == "signed"


# ── Storage keys ─────────────────────────────────────────────────────────


def test_each_signed_copy_of_a_shared_template_gets_its_own_key():
    doc = SimpleNamespace(
        id=uuid.uuid4(), name="Template.pdf", file_path="co/pdf-editor/doc1/template.pdf",
        mime_type="application/pdf", annotations=[], page_count=1,
    )
    storage = MemoryStorage({doc.file_path: blank_pdf()})
    service = make_service(storage)

    keys = []
    for _ in range(2):
        recipient = make_recipient(status="signed", signature_data=png_b64(), signed_at=datetime.utcnow())
        sign_req = make_request([recipient], document=doc, sign_fields=[
            {**SIG_FIELD, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
        ])
        key = service._burn_document(sign_req)
        assert key == f"co/pdf-editor/doc1/signed/{sign_req.id}.pdf"
        keys.append(key)

    assert len(set(keys)) == 2
    assert all(storage.exists(k) for k in keys)
    assert "co/pdf-editor/doc1/signed.pdf" not in storage.files


def test_burn_and_page_source_prefer_the_send_time_snapshot():
    doc = SimpleNamespace(
        id=uuid.uuid4(), name="Doc.pdf", file_path="co/pdf-editor/doc1/doc.pdf",
        mime_type="application/pdf", annotations=[], page_count=1,
    )
    storage = MemoryStorage({doc.file_path: b"LIVE"})
    service = make_service(storage)
    sign_req = make_request([make_recipient()], document=doc)

    assert service.get_source_bytes(sign_req) == b"LIVE"  # legacy fallback
    storage.write(f"co/pdf-editor/doc1/sign-requests/{sign_req.id}/source.pdf", b"SNAP")
    assert service.get_source_bytes(sign_req) == b"SNAP"


# ── Sending ──────────────────────────────────────────────────────────────


def _send(sign_req, storage=None, send_email=None):
    storage = storage or MemoryStorage({sign_req.document.file_path: blank_pdf()})
    service = make_service(storage, db_returning(sign_req))
    mock_email = MagicMock()
    mock_email.send_email.side_effect = send_email or (lambda **kw: True)
    with patch.object(sign_module, "email_service", mock_email):
        result, failures = service.send_sign_request(uuid.uuid4(), sign_req.id)
    return service, result, failures, mock_email, storage


def test_cc_and_bcc_never_receive_signing_links():
    a = make_recipient(name="A", email="a@example.com")
    b = make_recipient(role="signer_2", name="B", email="b@example.com")
    sign_req = make_request([a, b], cc_emails=["cc@example.com"], bcc_emails=["bcc@example.com"])

    _, result, failures, mock_email, _ = _send(sign_req)

    assert failures == []
    assert result.status == "sent"
    calls = [c.kwargs for c in mock_email.send_email.call_args_list]
    tokens = [a.access_token, b.access_token]
    watchers = {"cc@example.com", "bcc@example.com"}

    invitations = [c for c in calls if c["to_email"] in ("a@example.com", "b@example.com")]
    assert len(invitations) == 2
    for call in invitations:
        assert not call.get("cc_emails") and not call.get("bcc_emails")

    watcher_calls = [
        c for c in calls
        if watchers & {c["to_email"], *(c.get("cc_emails") or []), *(c.get("bcc_emails") or [])}
    ]
    assert len(watcher_calls) == 1  # one informational email
    for call in watcher_calls:
        assert not any(t in call["html_content"] for t in tokens)
        assert "/sign/" not in call["html_content"]


def test_send_snapshots_document_and_rebases_expiry_on_send_time():
    sign_req = make_request([make_recipient()])
    _, result, _, _, storage = _send(sign_req)

    snapshot = f"co/pdf-editor/doc1/sign-requests/{sign_req.id}/source.pdf"
    assert storage.exists(snapshot)
    # Created 3 days ago with a 14-day window -> expires 14 days from *now*.
    remaining = result.expires_at - datetime.utcnow()
    assert timedelta(days=13, hours=23) < remaining <= timedelta(days=14)


def test_failed_invitation_leaves_recipient_pending_and_is_reported():
    ok = make_recipient(name="Ok", email="ok@example.com")
    bad = make_recipient(role="signer_2", name="Bad", email="bad@example.com")
    sign_req = make_request([ok, bad])

    service, result, failures, _, _ = _send(
        sign_req, send_email=lambda **kw: kw["to_email"] != "bad@example.com",
    )

    assert result.status == "sent"
    assert ok.status == "sent"
    assert bad.status == "pending"
    assert [f["email"] for f in failures] == ["bad@example.com"]
    assert any(e[0] == "send_failed" for e in service.events)


def test_send_stays_draft_when_every_invitation_fails():
    sign_req = make_request([make_recipient()])

    def boom(**kw):
        raise RuntimeError("smtp down")

    _, result, failures, _, _ = _send(sign_req, send_email=boom)
    assert result.status == "draft"
    assert failures and failures[0]["error"] == "smtp down"


def test_reminder_failures_are_logged_and_returned():
    r = make_recipient(status="sent")
    sign_req = make_request([r], status="sent", expires_at=datetime.utcnow() + timedelta(days=3))
    service = make_service(db=db_returning(sign_req))
    mock_email = MagicMock()
    mock_email.send_email.return_value = False
    with patch.object(sign_module, "email_service", mock_email):
        _, failures = service.send_reminder(uuid.uuid4(), sign_req.id)
    assert [f["email"] for f in failures] == [r.email]
    assert [e[0] for e in service.events] == ["reminder_failed"]


def test_reminder_refuses_expired_requests():
    sign_req = make_request(
        [make_recipient(status="sent")], status="sent",
        expires_at=datetime.utcnow() - timedelta(minutes=1),
    )
    service = make_service(db=db_returning(sign_req))
    with pytest.raises(HTTPException) as exc:
        service.send_reminder(uuid.uuid4(), sign_req.id)
    assert exc.value.status_code == 400
    assert sign_req.status == "expired"


def test_get_flips_overdue_request_to_expired():
    sign_req = make_request(
        [make_recipient(status="viewed")], status="viewed",
        expires_at=datetime.utcnow() - timedelta(seconds=5),
    )
    service = make_service(db=db_returning(sign_req))
    assert service.get_sign_request(uuid.uuid4(), sign_req.id).status == "expired"


# ── Public endpoints ─────────────────────────────────────────────────────


def _public_service(sign_req, recipient):
    service = make_service()
    service._resolve_by_token = lambda token: (sign_req, recipient)
    return service


def test_draft_cannot_be_submitted_viewed_or_declined():
    recipient = make_recipient()
    sign_req = make_request([recipient], status="draft")
    service = _public_service(sign_req, recipient)

    with pytest.raises(HTTPException) as exc:
        service.submit_signature("tok", "SIG", "draw", "", {}, True, "ip", "ua")
    assert exc.value.status_code == 410
    with pytest.raises(HTTPException):
        service.view_document("tok", "ip", "ua")
    with pytest.raises(HTTPException):
        service.decline_signature("tok", "", "ip", "ua")
    assert recipient.status == "pending"
    assert sign_req.status == "draft"


def test_already_signed_submit_is_a_conflict():
    recipient = make_recipient(status="signed")
    sign_req = make_request([recipient], status="partially_signed")
    with pytest.raises(HTTPException) as exc:
        _public_service(sign_req, recipient).submit_signature(
            "tok", "SIG", "draw", "", {}, True, "ip", "ua",
        )
    assert exc.value.status_code == 409


@pytest.mark.parametrize("status", ["cancelled", "expired", "draft", "signed", "declined"])
def test_decline_rejects_closed_requests(status):
    recipient = make_recipient(status="sent")
    sign_req = make_request([recipient], status=status)
    with pytest.raises(HTTPException):
        _public_service(sign_req, recipient).decline_signature("tok", "", "ip", "ua")
    assert recipient.status == "sent"


def test_decline_emails_the_sender_with_the_reason():
    recipient = make_recipient(status="viewed")
    sign_req = make_request(
        [recipient], status="viewed", expires_at=datetime.utcnow() + timedelta(days=1),
    )
    service = _public_service(sign_req, recipient)
    mock_email = MagicMock()
    with patch.object(sign_module, "email_service", mock_email):
        service.decline_signature("tok", "Price is wrong", "ip", "ua")

    assert sign_req.status == "declined"
    kwargs = mock_email.send_email.call_args.kwargs
    assert kwargs["to_email"] == "owner@company.com"
    assert "Price is wrong" in kwargs["html_content"]


def test_completion_email_only_claims_an_attachment_when_there_is_one():
    recipient = make_recipient(status="signed")
    sign_req = make_request([recipient], status="signed", signed_at=datetime.utcnow(),
                            signed_file_path=None, cc_emails=["cc@example.com"])
    service = make_service()
    mock_email = MagicMock()
    with patch.object(sign_module, "email_service", mock_email):
        service._send_completion_notifications(sign_req)

    calls = [c.kwargs for c in mock_email.send_email.call_args_list]
    assert {c["to_email"] for c in calls} == {"owner@company.com", recipient.email, "cc@example.com"}
    for call in calls:
        assert call["attachments"] is None
        assert "is attached" not in call["html_content"]
