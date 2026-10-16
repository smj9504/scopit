"""Burned annotations must land where the editor shows them.

The editor stores fabric.js geometry: x/y is the object's center, in the
pdf.js viewport at scale 1 (rotation and crop box already applied)."""
import base64
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from app.domains.tools.modules.pdf_editor.pdf_geometry import page_view
from app.domains.tools.modules.pdf_editor.service import (
    _rotate_annotation,
    _rotate_field,
    flatten_annotations_bytes,
)


def source_pdf(width=300, height=400, rotate=0):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    pdf.drawString(10, 10, "Original")
    pdf.showPage()
    pdf.save()
    if not rotate:
        return buffer.getvalue()
    reader = PdfReader(BytesIO(buffer.getvalue()))
    writer = PdfWriter()
    page = reader.pages[0]
    page.rotate(rotate)
    writer.add_page(page)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def image_data_url():
    buf = BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def flatten(pdf_bytes, annotations):
    storage = Mock()
    storage.read.return_value = pdf_bytes
    doc = SimpleNamespace(file_path="document.pdf", annotations=annotations)
    return PdfReader(BytesIO(flatten_annotations_bytes(doc, storage))).pages[0]


def _mul(m, n):
    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return (
        a * a2 + b * c2, a * b2 + b * d2,
        c * a2 + d * c2, c * b2 + d * d2,
        e * a2 + f * c2 + e2, e * b2 + f * d2 + f2,
    )


def image_bboxes(page):
    """User-space bounding boxes of every image painted on the page."""
    ctm = (1, 0, 0, 1, 0, 0)
    stack, boxes = [], []
    for operands, op in page.get_contents().operations:
        if op == b"q":
            stack.append(ctm)
        elif op == b"Q":
            ctm = stack.pop()
        elif op == b"cm":
            ctm = _mul(tuple(float(v) for v in operands), ctm)
        elif op == b"Do":
            a, b, c, d, e, f = ctm
            corners = [(a * x + c * y + e, b * x + d * y + f) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
            xs, ys = [p[0] for p in corners], [p[1] for p in corners]
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def image_ann(x, y, w, h, rotation=0):
    return {
        "id": "img", "type": "image", "page": 1, "x": x, "y": y,
        "width": w, "height": h, "rotation": rotation,
        "content": image_data_url(), "style": {"opacity": 1},
    }


def assert_box(actual, expected):
    assert actual == pytest.approx(expected, abs=0.01)


def test_image_center_maps_to_top_down_position():
    page = flatten(source_pdf(), [image_ann(100, 150, 80, 60)])
    # center (100,150) top-down on a 400pt-tall page
    assert_box(image_bboxes(page)[0], (60, 220, 140, 280))


def test_rotated_annotation_turns_around_its_center():
    page = flatten(source_pdf(), [image_ann(100, 150, 80, 60, rotation=90)])
    assert_box(image_bboxes(page)[0], (70, 210, 130, 290))


def test_rotated_page_uses_the_viewport_the_editor_saw():
    # /Rotate 90: the editor shows a 400x300 landscape page whose top-left
    # is the original bottom-left corner
    page = flatten(source_pdf(rotate=90), [image_ann(50, 40, 20, 10)])
    assert_box(image_bboxes(page)[0], (35, 40, 45, 60))


def test_multiline_text_draws_every_line():
    page = flatten(source_pdf(), [{
        "id": "t", "type": "text", "page": 1, "x": 150, "y": 200,
        "width": 0, "height": 0, "rotation": 0, "content": "first\nsecond",
        "style": {"font_size": 14, "font_weight": "bold"},
    }])
    shows = [op for _, op in page.get_contents().operations if op == b"Tj"]
    assert len(shows) >= 2
    text = page.extract_text()
    assert "first" in text and "second" in text


def test_freehand_drawing_is_burned():
    path = [["M", 10, 10], ["Q", 20, 30, 40, 10], ["L", 60, 20]]
    page = flatten(source_pdf(), [{
        "id": "d", "type": "drawing", "page": 1, "x": 100, "y": 100,
        "width": 50, "height": 15, "rotation": 0,
        "content": json.dumps(path), "style": {"color": "#ff0000", "border_width": 2},
    }])
    ops = [op for _, op in page.get_contents().operations]
    assert b"c" in ops and b"S" in ops


@pytest.mark.parametrize("degrees", [90, 180, 270])
def test_page_rotation_keeps_annotation_on_the_same_content(degrees):
    reader = PdfReader(BytesIO(source_pdf(width=300, height=400)))
    page = reader.pages[0]
    before = page_view(page)
    ann = {"x": 70.0, "y": 90.0, "rotation": 0}

    a, b, c, d, e, f = before.to_user
    user = (a * ann["x"] + c * ann["y"] + e, b * ann["x"] + d * ann["y"] + f)

    page.rotate(degrees)
    after = page_view(page)
    moved = _rotate_annotation(ann, degrees, before.width, before.height)

    a, b, c, d, e, f = after.to_user
    user_after = (a * moved["x"] + c * moved["y"] + e, b * moved["x"] + d * moved["y"] + f)
    assert user_after == pytest.approx(user)
    assert moved["rotation"] == degrees


def test_field_rotation_round_trips():
    field = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.05}
    turned = field
    for _ in range(4):
        turned = _rotate_field(turned, 90)
    assert {k: turned[k] for k in field} == pytest.approx(field)


def rect_ann(style):
    return {
        "id": "r", "type": "shape", "page": 1, "x": 100, "y": 100,
        "width": 80, "height": 20, "rotation": 0, "content": "rect", "style": style,
    }


def test_zero_width_border_draws_fill_only():
    # Edit Text's cover box: filled, no outline, as the editor shows it
    page = flatten(source_pdf(), [rect_ann({"background_color": "#ffffff", "border_width": 0})])
    ops = [op for _, op in page.get_contents().operations]
    assert b"f*" in ops
    assert not {b"S", b"B", b"B*"} & set(ops)


def test_missing_border_width_keeps_default_outline():
    page = flatten(source_pdf(), [rect_ann({"background_color": "#ffffff"})])
    ops = [op for _, op in page.get_contents().operations]
    assert b"B*" in ops
