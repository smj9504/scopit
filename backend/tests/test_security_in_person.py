"""In-person signing, once the device is handed to the signer: the signer's
part runs on a kiosk token that only reaches this visit -- its documents, its
customer, and the company's answers as they were handed over -- and is never
a way into the company's account.

Runs against the test database via FastAPI's TestClient; each test makes its
own companies, users, customers and documents and removes them afterwards.
Storage and email are faked, so nothing leaves the process.
"""
import base64
import uuid
from datetime import datetime, timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token, create_refresh_token, get_password_hash
from app.domains.company.models import Company
from app.domains.customer.models import Customer
from app.domains.tools.modules.pdf_editor import sign_service as sign_module
from app.domains.tools.modules.pdf_editor.in_person_service import (
    KIOSK_MAX_EMAILS,
    KIOSK_TOKEN_TYPE,
    issue_kiosk_token,
)
from app.domains.tools.modules.pdf_editor.models import PdfDocument, SignRequest
from app.domains.user.models import User
from main import app

client = TestClient(app)

BASE = "/api/tools/pdf-editor/sign/in-person"


# ── Fixtures ─────────────────────────────────────────────────────────────


def field(key, type_="text", mode="creator_input", label=None, role=None, source=None, **kw):
    entity, source_field = source.split(".") if source else (None, None)
    return {
        "key": key, "label": label if label is not None else key, "type": type_,
        "page": 1, "x": kw.pop("x", 0.05), "y": kw.pop("y", 0.1),
        "width": kw.pop("width", 0.4), "height": kw.pop("height", 0.035),
        "data_binding": {"mode": mode, "source_entity": entity, "source_field": source_field},
        "signer_role": role, "required": kw.pop("required", False), **kw,
    }


def signature(key="signature_1", role="signer_1", **kw):
    return field(key, type_="signature", mode="signer_input", role=role,
                 **{"y": 0.6, "width": 0.3, "height": 0.1, **kw})


def blank_pdf():
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(400, 500))
    c.drawString(10, 10, "page")
    c.showPage()
    c.save()
    return buf.getvalue()


def png():
    buf = BytesIO()
    Image.new("RGBA", (40, 12), (0, 0, 0, 255)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


class MemoryStorage:
    def __init__(self):
        self.files = {}

    def write(self, key, data, content_type="application/octet-stream"):
        self.files[key] = data

    def read(self, key):
        return self.files[key]

    def exists(self, key):
        return key in self.files

    def delete(self, key):
        self.files.pop(key, None)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def mail(monkeypatch):
    """Addresses the signed copies went to"""
    sent = []

    def deliver(self, **kwargs):
        sent.append(kwargs["to_email"])
        return None

    monkeypatch.setattr(sign_module.SignService, "_deliver", deliver)
    return sent


@pytest.fixture
def world(db, monkeypatch):
    storage = MemoryStorage()
    monkeypatch.setattr(sign_module, "get_storage", lambda: storage)
    unique = uuid.uuid4().hex[:8]

    def company(name):
        row = Company(name=f"{name} {unique}")
        db.add(row)
        db.flush()
        return row

    def user(company_row, who):
        row = User(
            email=f"inperson_{who}_{unique}@example.com",
            hashed_password=get_password_hash("Test1234!"),
            full_name=f"{who.title()} Tech",
            company_id=company_row.id,
            role="admin",
            is_active=True,
            is_verified=True,
        )
        db.add(row)
        db.flush()
        return row

    def document(company_row, owner, name, fields):
        row = PdfDocument(
            company_id=company_row.id, created_by=owner.id, name=name,
            file_path=f"test/{unique}/{uuid.uuid4().hex}.pdf", file_size=1, page_count=1,
            mime_type="application/pdf", annotations=[], field_definitions=fields, is_active=True,
        )
        db.add(row)
        db.flush()
        storage.write(row.file_path, blank_pdf())
        return row

    acme, other = company("Acme Restoration"), company("Other Co")
    tech, stranger = user(acme, "tech"), user(other, "stranger")
    pat = Customer(company_id=acme.id, name="Pat Doe", email="pat@example.com")
    sam = Customer(company_id=acme.id, name="Sam Roe")
    theirs = Customer(company_id=other.id, name="Their Customer")
    db.add_all([pat, sam, theirs])
    db.flush()

    auth = document(acme, tech, "Work Authorization", [
        field("name", mode="prefilled", source="customer.name", y=0.05),
        field("amount", label="Amount", y=0.15, required=True),
        field("printed", mode="signer_input", role="signer_1", label="Printed name", y=0.25),
        signature(),
    ])
    dtp = document(acme, tech, "Direction to Pay", [signature()])
    unrelated = document(acme, tech, "Lien Waiver", [signature()])
    foreign = document(other, stranger, "Their Contract", [signature()])
    db.commit()

    yield type("World", (), dict(
        db=db, storage=storage, acme=acme, other=other, tech=tech, stranger=stranger,
        pat=pat, sam=sam, theirs=theirs, auth=auth, dtp=dtp, unrelated=unrelated, foreign=foreign,
    ))

    db.rollback()
    companies = [acme.id, other.id]
    db.query(SignRequest).filter(SignRequest.company_id.in_(companies)).delete(synchronize_session=False)
    db.query(PdfDocument).filter(PdfDocument.company_id.in_(companies)).delete(synchronize_session=False)
    db.query(Customer).filter(Customer.company_id.in_(companies)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_([tech.id, stranger.id])).delete(synchronize_session=False)
    db.query(Company).filter(Company.id.in_(companies)).delete(synchronize_session=False)
    db.commit()


def employee(user) -> dict:
    token = create_access_token(
        user_id=str(user.id), company_id=str(user.company_id), role=user.role,
        token_version=user.token_version or 0,
    )
    return {"Authorization": f"Bearer {token}"}


def bearer(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


AMOUNT = "field.text.amount"
PRINTED = "field.text.signer_1.printed name"


def hand_over(w, **body) -> dict:
    payload = {
        "customer_id": str(w.pat.id),
        "document_ids": [str(w.auth.id), str(w.dtp.id)],
        "answers": {AMOUNT: "1200", PRINTED: "Pat Doe"},
        **body,
    }
    resp = client.post(f"{BASE}/handoff", json=payload, headers=employee(w.tech))
    assert resp.status_code == 200, resp.text
    return resp.json()


def kiosk_sign(token, **body):
    payload = {
        "answers": {AMOUNT: "1200", PRINTED: "Pat Doe"},
        "today": "11/05/2026",
        "signers": [{"role": "signer_1", "name": "Pat Doe", "email": "pat@example.com"}],
        "marks": {"signer_1": {"signature": png()}},
        "consent_agreed": True,
        "consent_text": "I agree to sign electronically.",
        **body,
    }
    return client.post(f"{BASE}/kiosk/sign", json=payload, headers=bearer(token))


def preview_text(token, document_id, answers=None):
    resp = client.post(
        f"{BASE}/kiosk/preview",
        json={"document_id": str(document_id), "answers": answers or {}, "today": "11/05/2026"},
        headers=bearer(token),
    )
    assert resp.status_code == 200, resp.text
    return PdfReader(BytesIO(resp.content)).pages[0].extract_text()


def assert_ended(resp):
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"]["code"] == "KIOSK_ENDED"


# ── Handing over ─────────────────────────────────────────────────────────


def test_handing_over_returns_a_short_lived_kiosk_token_for_just_this_visit(world):
    handed = hand_over(world)

    claims = jwt.decode(handed["token"], settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    assert claims["type"] == KIOSK_TOKEN_TYPE
    assert claims["sub"] == str(world.tech.id)
    assert claims["company_id"] == str(world.acme.id)
    assert claims["docs"] == [str(world.auth.id), str(world.dtp.id)]
    assert claims["customer_id"] == str(world.pat.id)
    assert claims["answers"][AMOUNT] == "1200"
    assert 0 < claims["exp"] - claims["iat"] <= 2 * 3600

    assert handed["companyName"] == world.acme.name
    assert handed["staff"]["email"] == world.tech.email
    assert [d["id"] for d in handed["form"]["documents"]] == [str(world.auth.id), str(world.dtp.id)]
    assert handed["answers"][AMOUNT] == "1200"


def test_handing_over_checks_the_visit_as_signing_does(world):
    def attempt(**body):
        payload = {
            "customer_id": str(world.pat.id),
            "document_ids": [str(world.auth.id)],
            "answers": {AMOUNT: "1200"},
            **body,
        }
        return client.post(f"{BASE}/handoff", json=payload, headers=employee(world.tech))

    assert attempt(document_ids=[str(world.foreign.id)]).status_code == 404
    assert attempt(customer_id=str(world.theirs.id)).status_code == 404
    missing = attempt(answers={AMOUNT: ""})
    assert missing.status_code == 400 and "Amount" in missing.json()["detail"]
    assert attempt(customer_id=None, new_customer={"name": "  "}).status_code == 400
    # Only the employee hands over
    assert client.post(f"{BASE}/handoff", json={"document_ids": [str(world.auth.id)]}).status_code in (401, 403)


# ── Not a way into the account ───────────────────────────────────────────


def test_a_kiosk_token_is_not_a_sign_in(world):
    token = hand_over(world)["token"]

    assert client.get(f"{BASE}/documents", headers=bearer(token)).status_code == 401
    assert client.post(
        f"{BASE}/form", json={"document_ids": [str(world.auth.id)]}, headers=bearer(token)
    ).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": token}).status_code == 401
    # Nor are the employee's own signing endpoints open to it
    assert client.post(
        f"{BASE}/sign", json={"customer_id": str(world.pat.id), "document_ids": [str(world.auth.id)]},
        headers=bearer(token),
    ).status_code == 401


def test_the_signers_endpoints_take_only_a_kiosk_token(world):
    body = {"document_id": str(world.auth.id), "answers": {}}
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body))
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=employee(world.tech)))
    refresh = create_refresh_token(str(world.tech.id))
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(refresh)))
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer("not-a-token")))


# ── Only this visit ──────────────────────────────────────────────────────


def test_the_signer_sees_only_the_handed_over_documents(world):
    token = hand_over(world)["token"]

    assert "Pat Doe" in preview_text(token, world.auth.id)
    for doc in (world.unrelated, world.foreign):
        resp = client.post(
            f"{BASE}/kiosk/preview", json={"document_id": str(doc.id)}, headers=bearer(token)
        )
        assert resp.status_code == 404


def test_the_company_answers_are_the_ones_handed_over(world):
    token = hand_over(world)["token"]

    text = preview_text(token, world.auth.id, {AMOUNT: "999999", "customer.name": "Evil Name"})
    assert "1200" in text and "999999" not in text
    assert "Pat Doe" in text and "Evil Name" not in text

    resp = kiosk_sign(token, answers={
        AMOUNT: "999999", "customer.name": "Evil Name", PRINTED: "Pat Q. Doe",
    })
    assert resp.status_code == 201, resp.text
    world.db.expire_all()
    auth = world.db.query(SignRequest).filter(
        SignRequest.id == resp.json()["requests"][0]["id"]
    ).one()
    assert auth.prefill_data == {"name": "Pat Doe", "amount": "1200"}
    # A signer's own field is theirs to fill on the device
    assert auth.recipients[0].signed_field_values["printed"] == "Pat Q. Doe"


def test_signing_ignores_any_other_documents_or_customer_in_the_request(world):
    token = hand_over(world)["token"]

    resp = kiosk_sign(
        token,
        document_ids=[str(world.unrelated.id), str(world.foreign.id)],
        customer_id=str(world.sam.id),
        new_customer={"name": "Someone Else"},
    )
    assert resp.status_code == 201, resp.text
    result = resp.json()
    assert result["customerId"] == str(world.pat.id) and result["customerCreated"] is False
    assert [r["documentId"] for r in result["requests"]] == [str(world.auth.id), str(world.dtp.id)]
    world.db.expire_all()
    assert world.db.query(Customer).filter(Customer.name == "Someone Else").count() == 0


def test_a_new_customer_is_the_one_handed_over(world):
    token = hand_over(
        world, customer_id=None, new_customer={"name": "Lee Park", "phone": "555-0100"},
        answers={AMOUNT: "50"},
    )["token"]

    resp = kiosk_sign(token, new_customer={"name": "Not Lee"}, answers={"customer.name": "Not Lee"})
    assert resp.status_code == 201, resp.text
    result = resp.json()
    assert result["customerName"] == "Lee Park" and result["customerCreated"] is True
    world.db.expire_all()
    lee = world.db.query(Customer).filter(Customer.id == result["customerId"]).one()
    assert (lee.company_id, lee.phone) == (world.acme.id, "555-0100")


def test_a_hand_over_signs_once(world):
    token = hand_over(world)["token"]

    first = kiosk_sign(token)
    again = kiosk_sign(token, signers=[{"role": "signer_1", "name": "Someone Else"}])
    assert first.status_code == 201 and again.status_code == 201
    assert [r["id"] for r in again.json()["requests"]] == [r["id"] for r in first.json()["requests"]]
    world.db.expire_all()
    assert world.db.query(SignRequest).filter(SignRequest.company_id == world.acme.id).count() == 2


def test_the_signer_can_email_only_what_they_just_signed(world, mail):
    earlier = kiosk_sign(hand_over(world)["token"]).json()["requests"][0]["id"]
    token = hand_over(world)["token"]
    ids = [r["id"] for r in kiosk_sign(token).json()["requests"]]

    def email(request_ids, to="pat@example.com"):
        return client.post(
            f"{BASE}/kiosk/email", json={"request_ids": request_ids, "emails": [to]},
            headers=bearer(token),
        )

    assert email([earlier]).status_code == 404
    assert email([*ids, earlier]).status_code == 404
    assert mail == []

    for _ in range(KIOSK_MAX_EMAILS):
        resp = email(ids)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"emails": ["pat@example.com"]}
    assert email(ids).status_code == 429
    assert mail == ["pat@example.com"] * KIOSK_MAX_EMAILS


# ── When the hand-over ends ──────────────────────────────────────────────


def test_expired_or_forged_kiosk_tokens_are_refused(world):
    body = {"document_id": str(world.auth.id)}
    args = dict(
        user=world.tech, company_id=world.acme.id, document_ids=[world.auth.id],
        customer_id=world.pat.id, new_customer=None, answers={AMOUNT: "1200"},
    )

    expired, _ = issue_kiosk_token(**args, now=datetime.utcnow() - timedelta(hours=2, minutes=1))
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(expired)))

    good, _ = issue_kiosk_token(**args)
    claims = jwt.get_unverified_claims(good)
    forged = jwt.encode(claims, "not-the-secret-key-not-the-secret-key", algorithm="HS256")
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(forged)))

    # Widening a genuine token's documents breaks its signature
    header, payload, sig = good.split(".")
    widened = {**claims, "docs": [str(world.auth.id), str(world.unrelated.id)]}
    tampered_payload = jwt.encode(widened, "x", algorithm="HS256").split(".")[1]
    tampered = ".".join([header, tampered_payload, sig])
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(tampered)))

    # A token of another type, signed with the real key, isn't one either
    other_type = jwt.encode({**claims, "type": "access"}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(other_type)))

    assert client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(good)).status_code == 200


def test_the_hand_over_ends_when_the_employees_password_changes(world):
    token = hand_over(world)["token"]
    world.tech.token_version = (world.tech.token_version or 0) + 1
    world.db.commit()

    assert_ended(kiosk_sign(token))
    world.db.expire_all()
    assert world.db.query(SignRequest).filter(SignRequest.company_id == world.acme.id).count() == 0


def test_the_hand_over_ends_when_the_employee_is_deactivated_or_leaves(world):
    token = hand_over(world)["token"]
    body = {"document_id": str(world.auth.id)}

    world.tech.is_active = False
    world.db.commit()
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(token)))

    world.tech.is_active = True
    world.tech.company_id = world.other.id
    world.db.commit()
    assert_ended(client.post(f"{BASE}/kiosk/preview", json=body, headers=bearer(token)))


def test_the_company_must_still_have_the_documents_and_customer(world):
    token = hand_over(world)["token"]

    world.dtp.is_active = False
    world.db.commit()
    assert kiosk_sign(token).status_code == 404

    world.dtp.is_active = True
    world.pat.company_id = world.other.id
    world.db.commit()
    resp = kiosk_sign(token)
    assert resp.status_code == 404 and resp.json()["detail"] == "Customer not found"
    world.db.expire_all()
    assert world.db.query(SignRequest).filter(SignRequest.company_id == world.acme.id).count() == 0
