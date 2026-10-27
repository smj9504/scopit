"""The PDF editor's Acrobat-style tools: Edit picking up a page's images,
Redact (search, and applying redactions for good), Protect / unlock, and the
page tools (crop, insert, extract)."""
import base64
import re
import zlib
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as Perm
from pypdf.generic import ContentStream, DictionaryObject
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.domains.tools.modules.pdf_editor.pdf_geometry import page_view
from app.domains.tools.modules.pdf_editor.pdf_page_content import (
    find_text,
    page_image,
    page_images,
    search_regex,
)
from app.domains.tools.modules.pdf_editor.pdf_redact import apply_redactions
from app.domains.tools.modules.pdf_editor.pdf_security import (
    PdfPasswordError,
    protect_pdf,
    unlock_pdf,
)
from app.domains.tools.modules.pdf_editor.pdf_text_edit import erased_page_pdf
from app.domains.tools.modules.pdf_editor.service import (
    PdfEditorService,
    _with_fresh_ids,
    flatten_annotations_bytes,
)

W, H = 300, 400


def make_pdf(draw, rotate=0, pages=1):
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    for n in range(1, pages + 1):
        draw(c, n) if draw.__code__.co_argcount == 2 else draw(c)
        c.showPage()
    c.save()
    if not rotate:
        return buf.getvalue()
    writer = PdfWriter(clone_from=PdfReader(BytesIO(buf.getvalue())))
    for page in writer.pages:
        page.rotate(rotate)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def photo(color=(200, 30, 30), size=(40, 30), mode="RGB"):
    return Image.new(mode, size, color)


def ops(page):
    return [op for _, op in ContentStream(page.get_contents(), None).operations]


def view_box(page, x0, y0, x1, y1, **extra):
    """An annotation-like box over the user-space rect (x0, y0)-(x1, y1)."""
    view = page_view(page)
    a, b, c, d, e, f = view.to_user
    det = a * d - b * c
    inv = (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)
    pts = [(inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5])
           for x, y in ((x0, y0), (x1, y1))]
    (vx0, vy0), (vx1, vy1) = pts
    return {
        "id": extra.pop("id", "area"), "type": "redact", "page": 1,
        "x": (vx0 + vx1) / 2, "y": (vy0 + vy1) / 2,
        "width": abs(vx1 - vx0), "height": abs(vy1 - vy0), "rotation": 0, **extra,
    }


def everything_in(pdf: bytes) -> bytes:
    """The whole file with every stream decoded -- referenced or not -- to
    look for leftovers."""
    chunks = [pdf]
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        data = m.group(1)
        for decode in (
            lambda d: zlib.decompress(d),
            lambda d: zlib.decompress(base64.a85decode(d.strip(), adobe=True)),
        ):
            try:
                chunks.append(decode(data))
            except Exception:
                pass
    return b"\n".join(chunks)


def page_text(pdf: bytes, n: int = 1) -> str:
    return PdfReader(BytesIO(pdf)).pages[n - 1].extract_text()


# ---------------------------------------------------------------------------
# Edit: picking up images
# ---------------------------------------------------------------------------

def logo_page(c):
    c.setFont("Helvetica", 12)
    c.drawString(20, 380, "Header")
    c.drawImage(ImageReader(photo()), 100, 100, 80, 60)


def test_lists_a_pages_images_in_viewport_geometry():
    images = page_images(make_pdf(logo_page), 1)
    assert len(images) == 1
    img = images[0]
    assert img["x"] == pytest.approx(140) and img["y"] == pytest.approx(H - 130)
    assert (img["width"], img["height"]) == (pytest.approx(80), pytest.approx(60))
    assert img["rotation"] == pytest.approx(0) and img["background"] is False


def test_image_geometry_follows_a_rotated_page():
    images = page_images(make_pdf(logo_page, rotate=90), 1)
    img = images[0]
    # Turned with the page: its top edge now runs down the screen
    assert img["rotation"] == pytest.approx(90)
    assert (img["width"], img["height"]) == (pytest.approx(80), pytest.approx(60))
    assert img["x"] == pytest.approx(130) and img["y"] == pytest.approx(140)


def test_a_full_page_scan_is_marked_background():
    def scan(c):
        c.drawImage(ImageReader(photo(size=(30, 40))), 0, 0, W, H)
    assert page_images(make_pdf(scan), 1)[0]["background"] is True


def test_picked_up_image_comes_back_with_its_pixels():
    data = page_image(make_pdf(logo_page), 1, 0)
    assert data["dataUrl"].startswith("data:image/")
    img = Image.open(BytesIO(base64.b64decode(data["dataUrl"].split(",", 1)[1]))).convert("RGB")
    assert img.size == (40, 30)
    r, g, b = img.getpixel((20, 15))
    assert r > 180 and g < 60 and b < 60


def test_transparent_image_keeps_its_alpha():
    def draw(c):
        c.drawImage(ImageReader(photo((0, 0, 255, 100), mode="RGBA")), 50, 50, 40, 30, mask="auto")
    data = page_image(make_pdf(draw), 1, 0)
    assert data["dataUrl"].startswith("data:image/png")
    img = Image.open(BytesIO(base64.b64decode(data["dataUrl"].split(",", 1)[1])))
    assert img.mode == "RGBA" and img.getpixel((5, 5))[3] == 100


def test_mirrored_image_is_turned_upright():
    top_red = Image.new("RGB", (10, 10), (0, 0, 255))
    top_red.paste((255, 0, 0), (0, 0, 10, 5))

    def draw(c):
        c.saveState()
        c.translate(0, 200)
        c.scale(1, -1)  # drawn upside down
        c.drawImage(ImageReader(top_red), 50, 0, 40, 40)
        c.restoreState()

    data = page_image(make_pdf(draw), 1, 0)
    img = Image.open(BytesIO(base64.b64decode(data["dataUrl"].split(",", 1)[1]))).convert("RGB")
    # On the page the red half is at the bottom, so it is in the result too
    assert img.getpixel((5, 8))[0] > 200 and img.getpixel((5, 1))[2] > 200


def test_missing_image_index_is_a_lookup_error():
    with pytest.raises(LookupError):
        page_image(make_pdf(logo_page), 1, 5)


def picked_up(pdf, dx=0.0):
    """The editor's pair for the page's image, moved right by dx."""
    img = page_image(pdf, 1, 0)
    box = {k: img[k] for k in ("x", "y", "width", "height", "rotation")}
    cover = {"id": "img1:cover", "type": "shape", "page": 1, "content": "rect", **box,
             "style": {"background_color": "#ffffff", "color": "#ffffff", "border_width": 0}}
    moved = {"id": "img1", "type": "image", "page": 1, **box, "x": box["x"] + dx,
             "content": img["dataUrl"], "style": {"opacity": 1}}
    return cover, moved


def test_export_moves_the_image_instead_of_copying_it():
    pdf = make_pdf(logo_page)
    cover, moved = picked_up(pdf, dx=50)
    doc = SimpleNamespace(file_path="d.pdf", annotations=[cover, moved])
    storage = MagicMock()
    storage.read.return_value = pdf
    out = flatten_annotations_bytes(doc, storage)
    images = page_images(out, 1)
    assert len(images) == 1
    assert images[0]["x"] == pytest.approx(190, abs=0.5)
    assert "Header" in page_text(out)


def test_deleted_image_leaves_no_image_and_no_paint():
    pdf = make_pdf(logo_page)
    cover, moved = picked_up(pdf)
    doc = SimpleNamespace(file_path="d.pdf", annotations=[cover, {**moved, "content": ""}])
    storage = MagicMock()
    storage.read.return_value = pdf
    out = flatten_annotations_bytes(doc, storage)
    assert page_images(out, 1) == []
    assert b"re" not in ops(PdfReader(BytesIO(out)).pages[0])  # the cover wasn't painted


def test_preview_erases_an_image_cover():
    pdf = make_pdf(logo_page)
    cover, _ = picked_up(pdf)
    out, erased = erased_page_pdf(pdf, 1, [{**cover, "kind": "image"}])
    assert erased == ["img1:cover"]
    assert page_images(out, 1) == []


def test_a_text_cover_never_takes_the_image_under_it():
    pdf = make_pdf(logo_page)
    cover, _ = picked_up(pdf)
    _, erased = erased_page_pdf(pdf, 1, [cover])  # no kind: text
    assert erased == []


# ---------------------------------------------------------------------------
# Redact: finding text
# ---------------------------------------------------------------------------

def letter(c):
    c.setFont("Helvetica", 12)
    c.drawString(20, 350, "Homeowner: Jane Doe")
    c.drawString(20, 330, "Email jane.doe@example.com or call (555) 123-4567")
    c.drawString(20, 310, "SSN 123-45-6789 on file. Jane signed 03/14/2026.")


def test_finds_a_phrase_with_its_box():
    matches, truncated = find_text(make_pdf(letter), search_regex("jane doe"))
    assert not truncated
    assert [m["text"] for m in matches] == ["Jane Doe"]
    box = matches[0]["boxes"][0]
    from reportlab.pdfbase.pdfmetrics import stringWidth
    left = 20 + stringWidth("Homeowner: ", "Helvetica", 12)
    right = 20 + stringWidth("Homeowner: Jane Doe", "Helvetica", 12)
    assert box["x"] - box["width"] / 2 == pytest.approx(left, abs=1.5)
    assert box["x"] + box["width"] / 2 == pytest.approx(right, abs=1.5)
    assert box["y"] - box["height"] / 2 < H - 350 - 7 < H - 350 < box["y"] + box["height"] / 2
    assert box["rotation"] == pytest.approx(0)


def test_whole_word_and_case():
    pdf = make_pdf(letter)
    assert len(find_text(pdf, search_regex("jane"))[0]) == 3  # Jane, jane.doe, Jane
    assert len(find_text(pdf, search_regex("Jane", match_case=True))[0]) == 2
    assert len(find_text(pdf, search_regex("doe", whole_word=True))[0]) == 2


@pytest.mark.parametrize("pattern,found", [
    ("email", ["jane.doe@example.com"]),
    ("phone", ["(555) 123-4567"]),
    ("ssn", ["123-45-6789"]),
    ("date", ["03/14/2026"]),
])
def test_patterns(pattern, found):
    matches, _ = find_text(make_pdf(letter), search_regex(pattern=pattern))
    assert [m["text"] for m in matches] == found


def test_unknown_pattern_and_empty_query_are_rejected():
    with pytest.raises(ValueError):
        search_regex(pattern="passport")
    with pytest.raises(ValueError):
        search_regex("   ")


def test_search_on_a_rotated_page_gives_rotated_boxes():
    matches, _ = find_text(make_pdf(letter, rotate=90), search_regex("Jane Doe"))
    assert matches[0]["boxes"][0]["rotation"] == pytest.approx(90)


def test_search_reports_pages_and_stops_at_the_limit():
    pdf = make_pdf(lambda c, n: (c.setFont("Helvetica", 12), c.drawString(20, 300, f"Claim {n} claim")), pages=3)
    matches, truncated = find_text(pdf, search_regex("claim"))
    assert [m["page"] for m in matches] == [1, 1, 2, 2, 3, 3]
    matches, truncated = find_text(pdf, search_regex("claim"), limit=4)
    assert len(matches) == 4 and truncated


# ---------------------------------------------------------------------------
# Redact: applying
# ---------------------------------------------------------------------------

def redact(pdf, areas, **kw):
    return apply_redactions(pdf, {1: areas}, **kw)


def test_redacted_words_are_gone_from_the_whole_file():
    pdf = make_pdf(letter)
    match = find_text(pdf, search_regex("Jane Doe"))[0][0]
    out, removed = redact(pdf, [{"id": "r1", "page": 1, **match["boxes"][0]}])
    assert removed == 0
    text = page_text(out)
    assert "Jane Doe" not in text and "Homeowner:" in text
    assert "jane.doe@example.com" in text  # other lines untouched
    assert b"Jane Doe" not in everything_in(out)
    assert b"(Jane" not in everything_in(out)
    # And painted over
    assert b"f" in ops(PdfReader(BytesIO(out)).pages[0])


def test_redaction_reaches_inside_shared_forms_without_leaving_the_original():
    def draw(c):
        c.beginForm("header")
        c.setFont("Helvetica", 12)
        c.drawString(20, 350, "SECRET-ACCOUNT-42")
        c.endForm()
        c.doForm("header")

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 15, 340, 200, 365)])
    assert "SECRET" not in page_text(out)
    assert b"SECRET" not in everything_in(out)


def test_image_loses_only_the_redacted_pixels():
    def draw(c):
        c.drawImage(ImageReader(photo((0, 200, 0), size=(100, 100))), 100, 100, 100, 100)

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    # The left half of the image
    out, removed = redact(pdf, [view_box(page, 90, 90, 150, 210)])
    assert removed == 0
    img = Image.open(BytesIO(base64.b64decode(page_image(out, 1, 0)["dataUrl"].split(",", 1)[1]))).convert("RGB")
    assert img.getpixel((10, 50)) == (0, 0, 0)
    g = img.getpixel((90, 50))
    assert g[1] > 150 and g[0] < 60
    # The unredacted original image isn't still in the file
    assert len([o for o in everything_in(out).split(b"\n") if o]) > 0
    reader = PdfReader(BytesIO(out))
    xobjects = reader.pages[0]["/Resources"]["/XObject"]
    assert len(xobjects) == 1


def test_image_entirely_inside_is_removed():
    pdf = make_pdf(logo_page)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 90, 90, 200, 170)])
    assert page_images(out, 1) == []
    assert "Header" in page_text(out)


def test_paths_inside_go_paths_across_stay():
    def draw(c):
        c.setStrokeColorRGB(1, 0, 0)
        c.rect(110, 110, 20, 20, stroke=1, fill=0)   # inside
        c.line(0, 120, 300, 120)                      # across

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 100, 100, 150, 150)])
    ops_out = ContentStream(PdfReader(BytesIO(out)).pages[0].get_contents(), None).operations
    painted = [op for _, op in ops_out if op in (b"S", b"f", b"B")]
    # The line is still stroked; the rectangle isn't; the area fill is added
    assert painted.count(b"S") == 1
    assert b"n" in [op for _, op in ops_out]


def test_links_touching_the_area_are_removed_and_metadata_can_go():
    def draw(c):
        c.setFont("Helvetica", 12)
        c.drawString(20, 300, "Visit portal")
        c.linkURL("https://example.com/private", (20, 295, 120, 312))
        c.linkURL("https://example.com/public", (20, 100, 120, 115))
        c.setAuthor("Jane Doe")

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 15, 290, 130, 315)], remove_metadata=True)
    annots = PdfReader(BytesIO(out)).pages[0].get("/Annots")
    uris = [a.get_object()["/A"]["/URI"] for a in annots]
    assert uris == ["https://example.com/public"]
    assert b"private" not in everything_in(out)
    assert not (PdfReader(BytesIO(out)).metadata or {}).get("/Author")


def test_form_field_values_under_the_area_are_gone():
    def draw(c):
        c.acroForm.textfield(name="ssn", value="999-88-7777", x=20, y=300, width=150, height=20)
        c.acroForm.textfield(name="city", value="Austin", x=20, y=100, width=150, height=20)

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 15, 295, 175, 325)])
    reader = PdfReader(BytesIO(out))
    fields = reader.get_fields() or {}
    assert "ssn" not in fields and "city" in fields
    assert b"999-88-7777" not in everything_in(out)


def test_redaction_fill_color():
    pdf = make_pdf(letter)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out, _ = redact(pdf, [view_box(page, 15, 345, 200, 362)], fill_color="#ff0000")
    content = PdfReader(BytesIO(out)).pages[0].get_contents().get_data()
    assert b"1 0 0 rg" in content


def test_redaction_on_a_rotated_page():
    pdf = make_pdf(letter, rotate=90)
    match = find_text(pdf, search_regex("Jane Doe"))[0][0]
    out, _ = redact(pdf, [{"id": "r", "page": 1, **match["boxes"][0]}])
    assert "Jane Doe" not in page_text(out)
    assert "Homeowner" in page_text(out)


def test_redaction_rejects_a_missing_page():
    with pytest.raises(IndexError):
        apply_redactions(make_pdf(letter), {3: [{"x": 1, "y": 1, "width": 1, "height": 1}]})


# ---------------------------------------------------------------------------
# Protect / unlock
# ---------------------------------------------------------------------------

def test_open_password_protects_the_copy():
    out = protect_pdf(make_pdf(letter), open_password="s3cret")
    reader = PdfReader(BytesIO(out))
    assert reader.is_encrypted
    assert not reader.decrypt("wrong")
    assert reader.decrypt("s3cret")
    assert "Jane Doe" in reader.pages[0].extract_text()


def test_permissions_password_restricts_printing_and_copying():
    out = protect_pdf(
        make_pdf(letter), permissions_password="owner", allow_printing=False, allow_copying=False,
    )
    reader = PdfReader(BytesIO(out))
    assert reader.is_encrypted and reader.decrypt("")  # opens without a password
    flags = reader.user_access_permissions
    assert not flags & Perm.PRINT and not flags & Perm.EXTRACT
    assert flags & Perm.MODIFY and flags & Perm.EXTRACT_TEXT_AND_GRAPHICS


@pytest.mark.parametrize("kwargs", [
    {},
    {"allow_printing": False, "open_password": "x"},
    {"open_password": "same", "permissions_password": "same"},
])
def test_protect_needs_sensible_passwords(kwargs):
    with pytest.raises(ValueError):
        protect_pdf(make_pdf(letter), **kwargs)


def test_unlock_asks_for_the_password_then_opens():
    locked = protect_pdf(make_pdf(letter), open_password="pw")
    with pytest.raises(PdfPasswordError) as exc:
        unlock_pdf(locked)
    assert exc.value.code == "password_required"
    with pytest.raises(PdfPasswordError) as exc:
        unlock_pdf(locked, "nope")
    assert exc.value.code == "password_incorrect"
    opened = PdfReader(BytesIO(unlock_pdf(locked, "pw")))
    assert not opened.is_encrypted and "Jane Doe" in opened.pages[0].extract_text()


def test_unlock_leaves_plain_and_permission_only_files_open():
    plain = make_pdf(letter)
    assert unlock_pdf(plain) is plain
    restricted = protect_pdf(plain, permissions_password="owner", allow_editing=False)
    assert not PdfReader(BytesIO(unlock_pdf(restricted))).is_encrypted


# ---------------------------------------------------------------------------
# Service: page tools
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def plain_documents(monkeypatch):
    """Service tests work on SimpleNamespace documents, not ORM rows."""
    from app.domains.tools.modules.pdf_editor import service as service_module

    monkeypatch.setattr(service_module, "flag_modified", lambda *a: None)
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


def service_with(*docs):
    service = PdfEditorService.__new__(PdfEditorService)
    service.db = MagicMock()
    service.storage = MemoryStorage()
    by_id = {}
    for doc in docs:
        service.storage.files[doc.file_path] = doc.pdf
        by_id[doc.id] = doc
    service.get_document = lambda company_id, document_id: by_id.get(document_id)
    service.get_document_or_404 = lambda company_id, document_id: by_id[document_id]
    service._generate_thumbnail = lambda *a: False
    return service


def stored(pdf, annotations=(), fields=(), name="Claim.pdf"):
    doc_id = uuid4()
    return SimpleNamespace(
        id=doc_id, company_id=uuid4(), name=name, file_path=f"{doc_id}.pdf", pdf=pdf,
        annotations=list(annotations), field_definitions=list(fields),
        thumbnail_path=None, file_size=len(pdf), page_count=len(PdfReader(BytesIO(pdf)).pages),
        updated_at=None,
    )


def numbered(c, n):
    c.setFont("Helvetica", 24)
    c.drawString(40, 300, f"Page {n}")


def texts(service, doc):
    reader = PdfReader(BytesIO(service.storage.read(doc.file_path)))
    return [p.extract_text().strip() for p in reader.pages]


def note(page, x=100.0, y=100.0, ann_id=None):
    return {"id": ann_id or str(uuid4()), "type": "text", "page": page, "x": x, "y": y,
            "width": 50, "height": 20, "rotation": 0, "content": f"note {page}", "style": {}}


def test_crop_trims_margins_and_keeps_annotations_on_the_content():
    doc = stored(make_pdf(numbered, pages=2), [note(1), note(2)],
                 [{"key": "f", "page": 1, "x": 0.5, "y": 0.5, "width": 0.1, "height": 0.1}])
    service = service_with(doc)
    service.crop_pages(doc.company_id, doc.id, [1], {"left": 30, "top": 40, "right": 10, "bottom": 20})

    reader = PdfReader(BytesIO(service.storage.read(doc.file_path)))
    assert [float(v) for v in reader.pages[0].cropbox] == [30, 20, 290, 360]
    assert [float(v) for v in reader.pages[1].cropbox] == [0, 0, 300, 400]
    assert (doc.annotations[0]["x"], doc.annotations[0]["y"]) == (pytest.approx(70), pytest.approx(60))
    assert (doc.annotations[1]["x"], doc.annotations[1]["y"]) == (100, 100)
    field = doc.field_definitions[0]
    assert field["x"] == pytest.approx((150 - 30) / 260)
    assert field["y"] == pytest.approx((200 - 40) / 340)
    assert field["width"] == pytest.approx(30 / 260)


def test_crop_follows_how_a_rotated_page_is_shown():
    doc = stored(make_pdf(numbered, rotate=90))
    service = service_with(doc)
    # Shown landscape (400 x 300): trim 50 off its shown top
    service.crop_pages(doc.company_id, doc.id, None, {"top": 50})
    page = PdfReader(BytesIO(service.storage.read(doc.file_path))).pages[0]
    view = page_view(page)
    assert (view.width, view.height) == (pytest.approx(400), pytest.approx(250))


def test_crop_reset_and_too_small_crop():
    from fastapi import HTTPException

    doc = stored(make_pdf(numbered), [note(1)])
    service = service_with(doc)
    service.crop_pages(doc.company_id, doc.id, None, {"left": 50})
    service.crop_pages(doc.company_id, doc.id, None, reset=True)
    page = PdfReader(BytesIO(service.storage.read(doc.file_path))).pages[0]
    assert [float(v) for v in page.cropbox] == [0, 0, 300, 400]
    assert doc.annotations[0]["x"] == pytest.approx(100)
    with pytest.raises(HTTPException):
        service.crop_pages(doc.company_id, doc.id, None, {"left": 140, "right": 140})


def test_crop_undo_puts_back_exactly_what_pages_showed():
    from fastapi import HTTPException

    doc = stored(make_pdf(numbered, pages=2), [note(1), note(2)])
    service = service_with(doc)
    service.crop_pages(doc.company_id, doc.id, [1], {"left": 50})
    # A second crop on top of the first: undo returns to the first, not the whole page
    _, before = service.crop_pages(doc.company_id, doc.id, None, {"top": 40})
    assert before == {1: [50, 0, 300, 400], 2: [0, 0, 300, 400]}
    assert (doc.annotations[0]["x"], doc.annotations[0]["y"]) == (pytest.approx(50), pytest.approx(60))

    _, undone = service.crop_pages(doc.company_id, doc.id, None, boxes=before)
    assert undone == {1: [50, 0, 300, 360], 2: [0, 0, 300, 360]}
    reader = PdfReader(BytesIO(service.storage.read(doc.file_path)))
    assert [float(v) for v in reader.pages[0].cropbox] == [50, 0, 300, 400]
    assert [float(v) for v in reader.pages[1].cropbox] == [0, 0, 300, 400]
    assert (doc.annotations[0]["x"], doc.annotations[0]["y"]) == (pytest.approx(50), pytest.approx(100))
    assert (doc.annotations[1]["x"], doc.annotations[1]["y"]) == (pytest.approx(100), pytest.approx(100))

    with pytest.raises(HTTPException):
        service.crop_pages(doc.company_id, doc.id, None, boxes={1: [400, 500, 600, 700]})
    with pytest.raises(HTTPException):
        service.crop_pages(doc.company_id, doc.id, None, boxes={3: [0, 0, 300, 400]})


def test_insert_blank_pages_shifts_later_annotations():
    doc = stored(make_pdf(numbered, pages=2), [note(1), note(2)])
    service = service_with(doc)
    service.insert_pages(doc.company_id, uuid4(), doc.id, after=1, kind="blank", count=2)
    assert texts(service, doc) == ["Page 1", "", "", "Page 2"]
    assert [a["page"] for a in doc.annotations] == [1, 4]
    assert doc.page_count == 4


def test_duplicating_pages_copies_their_edits_as_new_pairs():
    pair = [
        {"id": "t1:cover", "type": "shape", "page": 2, "x": 1, "y": 1, "width": 1, "height": 1,
         "rotation": 0, "content": "rect", "style": {}},
        note(2, ann_id="t1"),
    ]
    doc = stored(make_pdf(numbered, pages=2), pair,
                 [{"key": "sig", "page": 2, "x": 0, "y": 0, "width": 0.1, "height": 0.1}])
    service = service_with(doc)
    service.insert_pages(doc.company_id, uuid4(), doc.id, after=2, kind="document",
                         source_document_id=doc.id, source_pages=[2])
    assert texts(service, doc) == ["Page 1", "Page 2", "Page 2"]
    copies = [a for a in doc.annotations if a["page"] == 3]
    cover = next(a for a in copies if a["id"].endswith(":cover"))
    text = next(a for a in copies if not a["id"].endswith(":cover"))
    assert cover["id"] == text["id"] + ":cover" and text["id"] != "t1"
    assert sorted(f["key"] for f in doc.field_definitions) == ["sig", "sig_2"]


def test_insert_from_an_uploaded_file():
    doc = stored(make_pdf(numbered, pages=2))
    service = service_with(doc)
    upload = SimpleNamespace(
        content_type="application/pdf", filename="x.pdf",
        file=BytesIO(protect_pdf(make_pdf(lambda c: c.drawString(40, 300, "Inserted")), open_password="pw")),
    )
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        service.insert_pages(doc.company_id, uuid4(), doc.id, after=0, kind="file", file=upload)
    assert exc.value.detail["code"] == "pdf_password_required"
    upload.file.seek(0)
    service.insert_pages(doc.company_id, uuid4(), doc.id, after=0, kind="file", file=upload, password="pw")
    assert texts(service, doc) == ["Inserted", "Page 1", "Page 2"]


def test_extract_as_separate_documents_and_delete():
    doc = stored(make_pdf(numbered, pages=3), [note(2), note(3)])
    service = service_with(doc)
    service.delete_pages = MagicMock(return_value=doc)
    created, source = service.extract_pages(doc.company_id, uuid4(), doc.id, [3, 2], separate=True,
                                            delete_after=True)
    assert [d.name for d in created] == ["Claim (page 2)", "Claim (page 3)"]
    for new_doc, n in zip(created, (2, 3)):
        reader = PdfReader(BytesIO(service.storage.read(new_doc.file_path)))
        assert [p.extract_text().strip() for p in reader.pages] == [f"Page {n}"]
        assert [a["page"] for a in new_doc.annotations] == [1]
    service.delete_pages.assert_called_once_with(doc.company_id, doc.id, [2, 3])
    assert source is doc


def test_extract_cannot_delete_every_page():
    from fastapi import HTTPException

    doc = stored(make_pdf(numbered, pages=2))
    with pytest.raises(HTTPException):
        service_with(doc).extract_pages(doc.company_id, uuid4(), doc.id, [1, 2], delete_after=True)


def test_applying_redactions_uses_up_the_marks_and_what_sat_on_them():
    pdf = make_pdf(letter)
    match = find_text(pdf, search_regex("Jane Doe"))[0][0]
    box = match["boxes"][0]
    mark = {"id": "m1", "type": "redact", "page": 1, **box, "content": "", "style": {}}
    other = {"id": "m2", "type": "redact", "page": 1, "x": 10, "y": 10, "width": 5, "height": 5,
             "rotation": 0, "content": "", "style": {}}
    on_top = note(1, box["x"], box["y"])
    elsewhere = note(1, 250, 380)
    doc = stored(pdf, [mark, other, on_top, elsewhere])
    service = service_with(doc)
    _, removed = service.apply_redactions(doc.company_id, doc.id, ["m1"])
    assert removed == 0
    assert [a["id"] for a in doc.annotations] == ["m2", elsewhere["id"]]
    assert "Jane Doe" not in texts(service, doc)[0]


def test_fresh_ids_keep_edit_pairs_together():
    out = _with_fresh_ids([{"id": "a:cover"}, {"id": "a"}, {"id": "b"}])
    assert out[0]["id"] == out[1]["id"] + ":cover"
    assert out[1]["id"] not in ("a", out[2]["id"])


def test_pdf_with_encryption_unlocked_is_cloneable():
    # The stored copy of an unlocked upload has no /Encrypt left
    locked = protect_pdf(make_pdf(letter), open_password="pw")
    assert "/Encrypt" not in PdfReader(BytesIO(unlock_pdf(locked, "pw"))).trailer
    assert isinstance(PdfReader(BytesIO(locked)).trailer["/Encrypt"].get_object(), DictionaryObject)
