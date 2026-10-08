"""Exercise the editor payload through schema serialization and real PDF output."""
import base64
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.domains.tools.modules.pdf_editor.schemas import AnnotationSaveRequest
from app.domains.tools.modules.pdf_editor.service import flatten_annotations_bytes


def source_pdf(page_count):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(300, 400))
    for page in range(1, page_count + 1):
        pdf.drawString(10, 380, f"Original page {page}")
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


@pytest.mark.parametrize("image_format", ["PNG", "JPEG"])
@pytest.mark.parametrize("page_count,target_page", [(1, 1), (3, 1), (3, 2), (3, 3)])
def test_export_embeds_photo_on_the_editor_page(image_format, page_count, target_page):
    image_buffer = BytesIO()
    Image.new("RGB", (16, 12), (240, 30, 20)).save(image_buffer, format=image_format)
    content = f"data:image/{image_format.lower()};base64," + base64.b64encode(
        image_buffer.getvalue()
    ).decode("ascii")
    # Exactly the one-based page number and data URL sent by AnnotationLayer.
    request = AnnotationSaveRequest.model_validate({"annotations": [{
        "id": "inserted-photo", "type": "image", "page": target_page,
        "x": 40, "y": 60, "width": 80, "height": 60,
        "rotation": 0, "content": content, "style": {"opacity": 1},
    }]})
    doc = SimpleNamespace(file_path="document.pdf", annotations=[
        annotation.model_dump() for annotation in request.annotations
    ])
    storage = Mock()
    storage.read.return_value = source_pdf(page_count)

    output = PdfReader(BytesIO(flatten_annotations_bytes(doc, storage)))

    assert len(output.pages) == page_count
    for page_number, page in enumerate(output.pages, start=1):
        assert f"Original page {page_number}" in page.extract_text()
        images = list(page.images)
        if page_number == target_page:
            assert len(images) == 1, "Inserted photo is missing from the exported page"
            assert images[0].image.size == (16, 12)
            red, green, blue = images[0].image.convert("RGB").getpixel((8, 6))
            assert red > 200 and green < 60 and blue < 60
            # The image must be painted, not merely included as an unused resource.
            assert any(op == b"Do" for _, op in page.get_contents().operations)
        else:
            assert not images, "Photo was exported onto a different page"


def test_export_without_annotations_preserves_original_pdf():
    original = source_pdf(1)
    storage = Mock()
    storage.read.return_value = original
    doc = SimpleNamespace(file_path="document.pdf", annotations=[])
    assert flatten_annotations_bytes(doc, storage) == original
