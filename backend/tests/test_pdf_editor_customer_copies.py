"""Customer copies: one PDF copied once per customer, so each customer's form
is filled in or signed and kept on its own."""
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.domains.tools.modules.pdf_editor import service as service_module
from app.domains.tools.modules.pdf_editor.service import (
    PdfEditorService,
    _customer_copy_name,
)


@pytest.fixture(autouse=True)
def plain_documents(monkeypatch):
    """Service tests work on SimpleNamespace documents, not ORM rows."""
    monkeypatch.setattr(service_module, "PdfDocument", lambda **kw: SimpleNamespace(**kw))


class MemoryStorage:
    def __init__(self):
        self.files = {}

    def read(self, key):
        return self.files[key]

    def write(self, key, data, content_type=None):
        self.files[key] = data

    def exists(self, key):
        return key in self.files


def template(**kw):
    doc_id = uuid4()
    defaults = dict(
        id=doc_id, company_id=uuid4(), name="Moving Contract.pdf",
        file_path=f"co/pdf-editor/{doc_id}/document.pdf",
        thumbnail_path=f"co/pdf-editor/{doc_id}/thumbnail.png",
        file_size=4, page_count=2, mime_type="application/pdf",
        annotations=[{"id": "a1", "type": "text", "page": 1, "content": "Move date"}],
        field_definitions=[{"key": "signature", "type": "signature", "page": 2}],
        customer_id=None, template_id=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def service_with(doc, customers=()):
    service = PdfEditorService.__new__(PdfEditorService)
    service.db = MagicMock()
    service.db.query.return_value.filter.return_value.all.return_value = list(customers)
    service.storage = MemoryStorage()
    service.storage.files[doc.file_path] = b"%PDF"
    service.storage.files[doc.thumbnail_path] = b"PNG"
    service.get_document_or_404 = lambda company_id, document_id: doc
    return service


def customer(name):
    return SimpleNamespace(id=uuid4(), name=name)


def test_copy_name_puts_the_customer_before_the_extension():
    assert _customer_copy_name("Lease.pdf", "Jane Doe") == "Lease - Jane Doe.pdf"
    assert _customer_copy_name("Lease", "Jane Doe") == "Lease - Jane Doe"
    assert _customer_copy_name("v1.2 form", "Jane") == "v1.2 form - Jane"


def test_copy_name_shortens_the_document_name_to_fit():
    name = _customer_copy_name("x" * 300 + ".pdf", "Jane Doe")
    assert len(name) == 255
    assert name.endswith(" - Jane Doe.pdf")


def test_each_customer_gets_a_copy_of_their_own():
    doc = template()
    jane, sam = customer("Jane Doe"), customer("Sam Lee")
    service = service_with(doc, [jane, sam])

    copies = service.create_customer_copies(doc.company_id, doc.id, uuid4(), [jane.id, sam.id])

    assert [c.name for c in copies] == ["Moving Contract - Jane Doe.pdf", "Moving Contract - Sam Lee.pdf"]
    assert [c.customer_id for c in copies] == [jane.id, sam.id]
    assert all(c.template_id == doc.id for c in copies)
    # Own files: editing one customer's copy never touches another's
    paths = {c.file_path for c in copies} | {c.thumbnail_path for c in copies}
    assert len(paths) == 4 and doc.file_path not in paths
    assert all(service.storage.files[c.file_path] == b"%PDF" for c in copies)
    # The edits and field mapping come along; lists are not shared
    for c in copies:
        assert c.annotations == doc.annotations and c.annotations is not doc.annotations
        assert c.field_definitions == doc.field_definitions
        assert c.field_definitions is not doc.field_definitions
    service.db.commit.assert_called_once()


def test_a_customer_picked_twice_gets_one_copy():
    doc = template()
    jane = customer("Jane Doe")
    service = service_with(doc, [jane])

    copies = service.create_customer_copies(doc.company_id, doc.id, uuid4(), [jane.id, jane.id])

    assert len(copies) == 1


def test_a_customer_outside_the_company_copies_nothing():
    doc = template()
    jane = customer("Jane Doe")
    service = service_with(doc, [jane])  # the other id isn't this company's
    files_before = dict(service.storage.files)

    with pytest.raises(HTTPException) as err:
        service.create_customer_copies(doc.company_id, doc.id, uuid4(), [jane.id, uuid4()])

    assert err.value.status_code == 404
    assert service.storage.files == files_before
    service.db.add.assert_not_called()
    service.db.commit.assert_not_called()


def test_duplicating_a_customers_copy_keeps_it_with_that_customer():
    jane_id, template_id = uuid4(), uuid4()
    doc = template(name="Moving Contract - Jane Doe.pdf", customer_id=jane_id, template_id=template_id)
    service = service_with(doc)

    dup = service.duplicate_document(doc.company_id, doc.id, uuid4())

    assert dup.name == "Moving Contract - Jane Doe.pdf (Copy)"
    assert dup.customer_id == jane_id
    assert dup.template_id == template_id
