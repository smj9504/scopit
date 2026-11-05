"""E-sign integrity against the real (test) database: the last two signers
submitting at the same moment must complete the envelope, not leave it
partially_signed for good.

Needs the app's models registered (imported through main) and the test
database; storage and email are faked.
"""
import base64
import hashlib
import threading
import uuid
from datetime import datetime, timedelta
from io import BytesIO

import pytest
from PIL import Image
from reportlab.pdfgen import canvas

pytest.importorskip("main")  # registers every model, so the mappers can configure

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.domains.company.models import Company  # noqa: E402
from app.domains.tools.modules.pdf_editor import sign_service as sign_module  # noqa: E402
from app.domains.tools.modules.pdf_editor.models import (  # noqa: E402
    PdfDocument,
    SignAuditEvent,
    SignRecipient,
    SignRequest,
)
from app.domains.user.models import User  # noqa: E402


class MemoryStorage:
    def __init__(self):
        self.files = {}
        self.lock = threading.Lock()

    def write(self, key, data, content_type=None):
        with self.lock:
            self.files[key] = data

    def read(self, key):
        return self.files[key]

    def exists(self, key):
        return key in self.files

    def delete(self, key):
        self.files.pop(key, None)


def png():
    buf = BytesIO()
    Image.new("RGBA", (40, 16), (0, 0, 0, 255)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def blank_pdf():
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(300, 400))
    c.drawString(10, 10, "contract")
    c.showPage()
    c.save()
    return buf.getvalue()


def sig_field(role, y):
    return {
        "key": f"sig_{role}", "label": f"Signature {role}", "type": "signature", "page": 1,
        "x": 0.1, "y": y, "width": 0.3, "height": 0.08, "signer_role": role,
        "data_binding": {"mode": "signer_input"}, "required": True,
    }


@pytest.fixture
def envelope(monkeypatch):
    storage = MemoryStorage()
    monkeypatch.setattr(sign_module, "get_storage", lambda: storage)
    monkeypatch.setattr(sign_module.SignService, "_deliver", lambda self, **kw: None)
    unique = uuid.uuid4().hex[:8]
    db = SessionLocal()
    company = Company(name=f"Lock Test {unique}")
    db.add(company)
    db.flush()
    owner = User(
        email=f"esign_lock_{unique}@example.com", hashed_password=get_password_hash("Test1234!"),
        full_name="Owner", company_id=company.id, role="admin", is_active=True, is_verified=True,
    )
    db.add(owner)
    db.flush()
    fields = [sig_field("signer_1", 0.1), sig_field("signer_2", 0.4)]
    doc = PdfDocument(
        company_id=company.id, created_by=owner.id, name="Contract.pdf",
        file_path=f"test/{unique}/contract.pdf", file_size=1, page_count=1,
        mime_type="application/pdf", annotations=[], field_definitions=fields, is_active=True,
    )
    db.add(doc)
    db.flush()
    storage.write(doc.file_path, blank_pdf())
    now = datetime.utcnow()
    sign_req = SignRequest(
        company_id=company.id, document_id=doc.id, sent_by=owner.id,
        sender_email=owner.email, sender_name="Owner", sign_fields=fields, prefill_data={},
        delivery_method="direct_link", status="sent", access_token=uuid.uuid4().hex,
        expires_at=now + timedelta(days=7), sent_at=now,
    )
    db.add(sign_req)
    db.flush()
    tokens = []
    for i, role in enumerate(("signer_1", "signer_2")):
        token = uuid.uuid4().hex
        db.add(SignRecipient(
            sign_request_id=sign_req.id, role=role, name=role, email=f"{role}@example.com",
            sequence=i, status="viewed", access_token=token,
        ))
        tokens.append(token)
    db.commit()
    request_id = sign_req.id

    yield request_id, tokens, storage

    db.rollback()
    db.query(SignRequest).filter(SignRequest.id == request_id).delete(synchronize_session=False)
    db.query(PdfDocument).filter(PdfDocument.company_id == company.id).delete(synchronize_session=False)
    db.query(User).filter(User.id == owner.id).delete(synchronize_session=False)
    db.query(Company).filter(Company.id == company.id).delete(synchronize_session=False)
    db.commit()
    db.close()


def test_last_two_signers_at_the_same_moment_complete_the_envelope(envelope, monkeypatch):
    request_id, tokens, storage = envelope
    # Both submits reach the lock together, so without it each would see the
    # other as unsigned
    barrier = threading.Barrier(2, timeout=30)
    original = sign_module.SignService._lock_envelope

    def lock_together(self, sign_req):
        barrier.wait()
        return original(self, sign_req)

    monkeypatch.setattr(sign_module.SignService, "_lock_envelope", lock_together)
    errors = []

    def sign(token):
        db = SessionLocal()
        try:
            sign_module.SignService(db).submit_signature(
                token, png(), "draw", "", {}, True, "127.0.0.1", "pytest",
            )
        except Exception as exc:  # noqa: BLE001 -- reported below
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=sign, args=(t,)) for t in tokens]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)

    assert errors == []
    db = SessionLocal()
    try:
        sign_req = db.query(SignRequest).filter(SignRequest.id == request_id).one()
        assert sign_req.status == "signed"
        assert {r.status for r in sign_req.recipients} == {"signed"}
        completed = (
            db.query(SignAuditEvent)
            .filter(SignAuditEvent.sign_request_id == request_id, SignAuditEvent.event_type == "completed")
            .all()
        )
        assert len(completed) == 1
        signed_pdf = storage.read(sign_req.signed_file_path)
        assert completed[0].event_metadata["signed_sha256"] == hashlib.sha256(signed_pdf).hexdigest()
    finally:
        db.close()
