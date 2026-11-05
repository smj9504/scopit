"""In-person signing: what a visit asks, how answers land on each document,
and signing a visit's documents in one go.

Pure unit tests -- the DB session and storage are faked; nothing here needs a
live database or makes a network call.
"""
import base64
import uuid
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas

# Every model, so the ORM rows built below can resolve their relationships
import app.domains.admin.models  # noqa: F401
import app.domains.auth.models  # noqa: F401
import app.domains.company.models  # noqa: F401
import app.domains.estimate.models  # noqa: F401
import app.domains.invoice.models  # noqa: F401
import app.domains.line_item.models  # noqa: F401
import app.domains.settings.models  # noqa: F401
import app.domains.tools.models  # noqa: F401
import app.domains.user.models  # noqa: F401
from app.domains.customer.models import Customer
from app.domains.tools.modules.pdf_editor import sign_service as sign_module
from app.domains.tools.modules.pdf_editor.in_person import (
    build_questions,
    clean_answers,
    document_values,
    missing_required,
    role_label,
    signer_roles,
    signing_day,
)
from app.domains.tools.modules.pdf_editor.in_person_service import InPersonSignService
from app.domains.tools.modules.pdf_editor.models import PdfDocument, SignRequest
from app.domains.tools.modules.pdf_editor.sign_service import INITIALS_KEY

# ── Fixtures ─────────────────────────────────────────────────────────────


def field(key, type_="text", mode="creator_input", label=None, role=None, source=None, **kw):
    entity, source_field = source.split(".") if source else (None, None)
    return {
        "key": key, "label": label if label is not None else key, "type": type_,
        "page": kw.pop("page", 1), "x": kw.pop("x", 0.1), "y": kw.pop("y", 0.1),
        "width": kw.pop("width", 0.3), "height": kw.pop("height", 0.035),
        "data_binding": {"mode": mode, "source_entity": entity, "source_field": source_field},
        "signer_role": role, "required": kw.pop("required", False), **kw,
    }


def prefilled(key, source, **kw):
    return field(key, mode="prefilled", source=source, **kw)


def signature(key="signature_1", role="signer_1", type_="signature", **kw):
    return field(key, type_=type_, mode="signer_input", role=role, **{"height": 0.06, **kw})


COMPANY = SimpleNamespace(
    name="Acme Restoration", legal_name=None, email="office@acme.test", phone=None,
    website=None, address_line1="1 Main St", address_line2=None, city="Austin",
    state="TX", zipcode="78701", country="US",
)


# ── What a visit asks ────────────────────────────────────────────────────


def test_customer_fields_are_asked_with_the_record_value_and_company_gaps_only():
    fields = [
        prefilled("name", "customer.name", y=0.1),
        prefilled("co_name", "company.name", y=0.2),
        prefilled("co_phone", "company.phone", y=0.3),
        field("loss", type_="date", label="Date of loss", y=0.4),
        signature(y=0.9),
    ]
    known = {"customer.name": "Pat Doe", "company.name": "Acme Restoration"}
    questions = build_questions([("Work Authorization", fields)], known)

    assert [q["key"] for q in questions] == [
        "customer.name", "field.date.date of loss", "company.phone",
    ]
    assert questions[0]["value"] == "Pat Doe"
    assert questions[0]["label"] == "name"
    assert questions[1]["kind"] == "date"
    assert questions[2]["label"] == "co_phone" and questions[2]["value"] == ""


def test_the_same_fact_on_two_documents_is_asked_once():
    auth = [prefilled("a", "customer.full_address"), field("amt", label="Claim #")]
    dtp = [prefilled("b", "customer.full_address"), field("claim", label="  claim  # ", required=True)]
    questions = build_questions([("Auth", auth), ("Direction to Pay", dtp)], {})

    assert len(questions) == 2
    claim = questions[1]
    assert claim["required"] is True
    assert claim["documents"] == ["Auth", "Direction to Pay"]


def test_two_signers_own_fields_with_one_label_are_two_questions():
    fields = [
        field("p1", mode="signer_input", role="signer_1", label="Printed name"),
        field("p2", mode="signer_input", role="signer_2", label="Printed name"),
    ]
    questions = build_questions([("Doc", fields)], {})
    assert [q["role"] for q in questions] == ["signer_1", "signer_2"]


def test_signatures_and_a_signers_date_are_never_asked():
    fields = [
        signature(),
        signature("initials_1", type_="initials"),
        field("date_1", type_="date", mode="signer_input", role="signer_1"),
        field("date_2", type_="date", label="Start date"),
    ]
    assert [q["key"] for q in build_questions([("Doc", fields)], {})] == ["field.date.start date"]


def test_questions_follow_the_page_reading_order():
    fields = [
        field("b", label="Second", page=1, y=0.5),
        field("c", label="Third", page=2, y=0.1),
        field("a", label="First", page=1, y=0.2),
    ]
    assert [q["label"] for q in build_questions([("Doc", fields)], {})] == ["First", "Second", "Third"]


def test_answers_only_count_for_questions_that_were_asked():
    questions = build_questions([("Doc", [prefilled("n", "customer.name")])], {"customer.name": "Pat"})
    cleaned = clean_answers({"customer.name": " Pat Doe ", "company.name": "Evil Co"}, questions)
    assert cleaned == {"customer.name": "Pat Doe"}
    # Left out, a question keeps the value it was asked with
    assert clean_answers({}, questions) == {"customer.name": "Pat"}


def test_a_required_checkbox_must_be_checked():
    questions = build_questions(
        [("Doc", [field("ok", type_="checkbox", label="I agree", required=True)])], {},
    )
    assert missing_required(questions, {"field.checkbox.i agree": ""}) == ["I agree"]
    assert missing_required(questions, {"field.checkbox.i agree": "true"}) == []


# ── Where answers land ───────────────────────────────────────────────────


def test_answers_land_on_the_request_and_each_signers_own_values():
    fields = [
        prefilled("name", "customer.name"),
        prefilled("co", "company.name"),
        field("amount", label="Amount"),
        field("printed", mode="signer_input", role="signer_1", label="Printed name"),
        field("date_signed", type_="date", mode="signer_input", role="signer_1"),
        field("agree", type_="checkbox", label="Agree"),
        signature(),
    ]
    known = {"customer.name": "Pat", "company.name": "Acme"}
    questions = build_questions([("Doc", fields)], known)
    answers = clean_answers({
        "customer.name": "Pat Doe",
        "field.text.amount": "1200",
        "field.text.signer_1.printed name": "Pat Q Doe",
        "field.checkbox.agree": "yes",
    }, questions)

    prefill, by_role = document_values(fields, answers, known, "11/05/2026")

    assert prefill == {"name": "Pat Doe", "co": "Acme", "amount": "1200", "agree": "true"}
    assert by_role == {"signer_1": {"printed": "Pat Q Doe", "date_signed": "11/05/2026"}}


def test_a_cleared_record_value_stays_off_the_document():
    fields = [prefilled("name", "customer.name")]
    prefill, _ = document_values(fields, {"customer.name": ""}, {"customer.name": "Pat"}, "11/05/2026")
    assert prefill == {}


def test_signers_are_everyone_with_a_line_across_the_visit():
    roles = signer_roles([
        [signature(role="signer_2"), signature("i", type_="initials", role="signer_1")],
        [signature(role="signer_1"), signature(role="signer_10")],
        [field("x", mode="creator_input")],
    ])
    assert [(r["role"], r["signature"], r["initials"]) for r in roles] == [
        ("signer_1", True, True), ("signer_2", True, False), ("signer_10", True, False),
    ]
    assert role_label("signer_2") == "Signer 2"


def test_the_signing_day_is_the_devices_and_falls_back_to_today():
    assert signing_day("11/05/2026") == "11/05/2026"
    assert len(signing_day("2026-11-05")) == 10


# ── Signing a visit ──────────────────────────────────────────────────────


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


class FakeSession:
    """Records what's added; a flush gives new rows their ids"""

    def __init__(self):
        self.added = []
        self.committed = False
        self.rolled_back = False
        self.query = MagicMock()

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in list(self.added):
            for row in [obj, *getattr(obj, "recipients", [])]:
                if getattr(row, "id", "missing") is None:
                    row.id = uuid.uuid4()

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def of(self, cls):
        return [o for o in self.added if isinstance(o, cls)]


def png_data_url(color=(0, 0, 0, 255)):
    buf = BytesIO()
    Image.new("RGBA", (40, 12), color).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def blank_pdf():
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(300, 400))
    c.drawString(10, 10, "page")
    c.showPage()
    c.save()
    return buf.getvalue()


def make_doc(name, fields):
    doc = PdfDocument(
        id=uuid.uuid4(), company_id=uuid.uuid4(), name=name, file_path=f"co/pdf-editor/{name}.pdf",
        file_size=1, page_count=1, mime_type="application/pdf", annotations=[],
        field_definitions=fields, is_active=True,
    )
    return doc


@pytest.fixture
def visit(monkeypatch):
    auth = make_doc("Work Authorization", [
        prefilled("name", "customer.name", x=0.05, y=0.05),
        field("amount", label="Amount", x=0.05, y=0.15, required=True),
        signature(x=0.05, y=0.5, width=0.3, height=0.1),
        signature("initials_1", type_="initials", x=0.6, y=0.5, width=0.1, height=0.1),
        signature("sig_rep", role="signer_2", x=0.05, y=0.7, width=0.3, height=0.1),
    ])
    dtp = make_doc("Direction to Pay", [
        prefilled("addr", "customer.full_address", x=0.05, y=0.05),
        signature(x=0.05, y=0.5, width=0.3, height=0.1),
    ])
    storage = MemoryStorage({auth.file_path: blank_pdf(), dtp.file_path: blank_pdf()})
    monkeypatch.setattr(sign_module, "get_storage", lambda: storage)
    db = FakeSession()
    service = InPersonSignService(db)
    service._documents = lambda company_id, ids, customer_id: [auth, dtp]
    service._company = lambda company_id: COMPANY
    user = SimpleNamespace(id=uuid.uuid4(), email="tech@acme.test", full_name="Tom Tech")
    return SimpleNamespace(service=service, db=db, storage=storage, auth=auth, dtp=dtp, user=user)


def sign(visit, **overrides):
    kwargs = dict(
        company_id=uuid.uuid4(),
        user=visit.user,
        document_ids=[visit.auth.id, visit.dtp.id],
        answers={"field.text.amount": "1,200.00", "customer.full_address": "9 Elm St, Austin, TX 78701"},
        today="11/05/2026",
        signers=[
            {"role": "signer_1", "name": "Pat Doe", "email": "pat@example.com"},
            {"role": "signer_2", "name": "Tom Tech", "email": "not-an-email"},
        ],
        marks={
            "signer_1": {"signature": png_data_url(), "initials": png_data_url((0, 0, 255, 255))},
            "signer_2": {"signature": png_data_url(), "signature_type": "type", "signature_font": "Caveat"},
        },
        consent_agreed=True,
        consent_text="I agree to sign electronically.",
        ip="10.0.0.1",
        user_agent="Tablet",
        new_customer={"name": "Pat Doe", "phone": "555-0100", "address_line1": "9 Elm St"},
    )
    kwargs.update(overrides)
    return visit.service.sign(**kwargs)


def test_signing_makes_the_customer_and_a_signed_request_per_document(visit):
    result = sign(visit)

    customers = visit.db.of(Customer)
    assert len(customers) == 1
    customer = customers[0]
    assert (customer.name, customer.phone, customer.address_line1) == ("Pat Doe", "555-0100", "9 Elm St")
    assert result["customerCreated"] is True
    assert result["customerEmail"] == "pat@example.com"
    assert visit.db.committed and not visit.db.rolled_back

    requests = visit.db.of(SignRequest)
    assert [r.document.name for r in requests] == ["Work Authorization", "Direction to Pay"]
    auth, dtp = requests
    assert all(r.status == "signed" and r.delivery_method == "in_person" for r in requests)
    assert all(r.customer is customer for r in requests)
    assert auth.prefill_data == {"name": "Pat Doe", "amount": "1,200.00"}
    assert dtp.prefill_data == {"addr": "9 Elm St, Austin, TX 78701"}

    # Each document lists only the signers it has lines for
    assert [(r.role, r.name, r.email) for r in auth.recipients] == [
        ("signer_1", "Pat Doe", "pat@example.com"), ("signer_2", "Tom Tech", ""),
    ]
    assert [r.role for r in dtp.recipients] == ["signer_1"]
    pat = auth.recipients[0]
    assert pat.status == "signed" and pat.consent_agreed and pat.document_hash
    assert not pat.signature_data.startswith("data:")
    assert pat.signed_field_values[INITIALS_KEY]
    assert auth.recipients[1].signature_type == "type"

    # The signed PDFs exist, with the answers burned in
    for r in requests:
        assert visit.storage.exists(r.signed_file_path)
    text = PdfReader(BytesIO(visit.storage.read(auth.signed_file_path))).pages[0].extract_text()
    assert "1,200.00" in text and "Pat Doe" in text
    assert [x["signedPdfReady"] for x in result["requests"]] == [True, True]


def test_a_saved_customers_blanks_are_filled_but_nothing_is_overwritten(visit):
    saved = Customer(id=uuid.uuid4(), name="Pat Doe", email=None, phone="555-0000")
    visit.service._customer = lambda company_id, customer_id: saved
    visit.auth.field_definitions = visit.auth.field_definitions + [
        prefilled("email", "customer.email", y=0.3), prefilled("phone", "customer.phone", y=0.35),
    ]

    result = sign(
        visit, customer_id=saved.id, new_customer=None,
        answers={"field.text.amount": "5", "customer.email": "pat@new.test", "customer.phone": "555-9999"},
    )

    assert visit.db.of(Customer) == []
    assert result["customerCreated"] is False
    assert saved.email == "pat@new.test"
    assert saved.phone == "555-0000"
    # The document still shows what was entered on site
    assert visit.db.of(SignRequest)[0].prefill_data["phone"] == "555-9999"


@pytest.mark.parametrize("change, detail", [
    ({"consent_agreed": False}, "agree to sign electronically"),
    ({"answers": {}}, "required fields: Amount"),
    ({"marks": {"signer_2": {"signature": png_data_url()}}}, "Signer 1 hasn't signed"),
    ({"signers": [{"role": "signer_1", "name": "Pat Doe"}]}, "Signer 2's full name"),
    ({"new_customer": None}, "Pick a customer"),
])
def test_nothing_is_written_until_everything_checks_out(visit, change, detail):
    with pytest.raises(HTTPException) as exc:
        sign(visit, **change)
    assert detail in exc.value.detail
    assert visit.db.added == []
    assert visit.storage.files.keys() == {visit.auth.file_path, visit.dtp.file_path}


def test_initials_must_be_a_real_image(visit):
    marks = {
        "signer_1": {"signature": png_data_url(), "initials": "data:image/png;base64,bm90IGEgcG5n"},
        "signer_2": {"signature": png_data_url()},
    }
    with pytest.raises(HTTPException) as exc:
        sign(visit, marks=marks)
    assert "hasn't initialed" in exc.value.detail


def test_a_failure_part_way_saves_none_of_the_visit(visit, monkeypatch):
    calls = {"n": 0}
    real = visit.service.esign._write_snapshot

    def flaky(sign_req):
        calls["n"] += 1
        if calls["n"] == 2:
            raise HTTPException(status_code=400, detail="Source document not found")
        return real(sign_req)

    monkeypatch.setattr(visit.service.esign, "_write_snapshot", flaky)
    with pytest.raises(HTTPException):
        sign(visit)
    assert visit.db.rolled_back and not visit.db.committed


def test_the_preview_fills_the_document_without_signatures(visit):
    visit.service._documents = lambda company_id, ids, customer_id: [visit.auth]
    pdf = visit.service.preview(
        uuid.uuid4(), visit.auth.id, {"field.text.amount": "77"}, "11/05/2026",
        new_customer={"name": "Pat Doe"},
    )
    page = PdfReader(BytesIO(pdf)).pages[0]
    assert "77" in page.extract_text() and "Pat Doe" in page.extract_text()
    assert len(page.images) == 0
    assert visit.db.added == []


def test_the_form_lists_each_documents_lines_and_the_signers(visit):
    form = visit.service.form(uuid.uuid4(), [visit.auth.id, visit.dtp.id], new_customer={"name": "Pat"})
    assert [d["name"] for d in form["documents"]] == ["Work Authorization", "Direction to Pay"]
    assert [line["key"] for line in form["documents"][0]["lines"]] == ["signature_1", "initials_1", "sig_rep"]
    assert [(s["role"], s["label"]) for s in form["signers"]] == [("signer_1", "Signer 1"), ("signer_2", "Signer 2")]
    assert [q["key"] for q in form["questions"]] == ["customer.name", "customer.full_address", "field.text.amount"]
    assert form["questions"][0]["value"] == "Pat"
    assert form["customer"] == {"id": None, "name": "Pat", "contactName": None, "email": None}


# ── Emailing copies ──────────────────────────────────────────────────────


def test_completion_emails_skip_a_signer_with_no_address(monkeypatch):
    service = sign_module.SignService.__new__(sign_module.SignService)
    service.storage = MemoryStorage()
    sent = []
    service._deliver = lambda **kw: sent.append(kw["to_email"])
    sign_req = SimpleNamespace(
        id=uuid.uuid4(), document=SimpleNamespace(name="Doc.pdf"), company=SimpleNamespace(name="Acme"),
        signed_at=None, signed_file_path=None, sender_email="tech@acme.test", sender_name="Tom",
        cc_emails=[], bcc_emails=[],
        recipients=[SimpleNamespace(name="Pat", email=""), SimpleNamespace(name="Sam", email="sam@x.test")],
    )
    service._send_completion_notifications(sign_req)
    assert sent == ["tech@acme.test", "sam@x.test"]
