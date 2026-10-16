from __future__ import annotations

"""
Scopit - PDF Editor Service

Handles PDF document CRUD, page operations (merge, reorder, delete, rotate),
annotation persistence, flattening, multi-image-to-PDF conversion, and the
company document library.

Storage: Abstracts file persistence via StorageBackend (local or R2).
Database: SQLAlchemy 2.0 SYNC (Session, not AsyncSession).
"""

import base64
import os
import tempfile
import uuid
from datetime import datetime
from io import BytesIO
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.storage import StorageBackend, get_storage
from app.domains.tools.modules.pdf_editor.models import (
    CompanyDocument,
    PdfDocument,
)
from app.domains.tools.modules.pdf_editor.pdf_geometry import (
    enter_screen_space,
    local_frame,
    page_view,
    page_view_size,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_UPLOAD_TYPES = {"application/pdf"}

ALLOWED_CONVERT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/tiff",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


_heif_registered = False


def _open_image(source):
    """PIL Image.open that also understands HEIC/HEIF (iPhone photos) when
    pillow-heif is installed, and turns unreadable files into a 400 instead
    of a 500."""
    global _heif_registered
    from PIL import Image, UnidentifiedImageError

    if not _heif_registered:
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except ImportError:
            pass
        _heif_registered = True
    try:
        return Image.open(source)
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=400,
            detail="This image format couldn't be read. Try a JPG or PNG.",
        )


def _hex_to_rgb(hex_color: Optional[str], default=(0.0, 0.0, 0.0)):
    """'#rrggbb' -> (r, g, b) floats in [0, 1]. Falls back to `default` for
    anything else (None, 'transparent', short/invalid hex, ...)."""
    if not hex_color:
        return default
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return default
    try:
        return (
            int(h[0:2], 16) / 255,
            int(h[2:4], 16) / 255,
            int(h[4:6], 16) / 255,
        )
    except ValueError:
        return default


def flatten_annotations_bytes(doc: PdfDocument, storage: StorageBackend) -> bytes:
    """Burn a document's annotations into its PDF pages.

    Pure (doc, storage) -> bytes so callers that already hold the PdfDocument
    ORM object -- e.g. sign_service, which reads the same "linked" document to
    burn signatures -- can flatten without a redundant company-scoped re-fetch.
    Returns the flattened PDF as bytes, or the original bytes unchanged if
    there are no annotations.

    Annotation geometry comes straight from the editor's fabric.js canvas:
    x/y are the object's CENTER (fabric 7 defaults originX/originY to
    "center"), width/height its scaled size, rotation its clockwise angle
    around that center, all in the pdf.js viewport at scale 1 -- which
    already includes the page's /Rotate and crop box. pdf_geometry maps that
    space back to PDF user space, so rotated and cropped pages line up.

    Each annotation burns independently: one malformed annotation (e.g. a
    corrupt image data URL) is skipped, not fatal to the rest of the page.
    "sign_field" placeholders are never burned.
    """
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas as rl_canvas

    pdf_data = storage.read(doc.file_path)

    if not doc.annotations:
        return pdf_data

    with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
        local_path = os.path.join(tmpdir, "document.pdf")
        with open(local_path, "wb") as fh:
            fh.write(pdf_data)

        reader = PdfReader(local_path)
        writer = PdfWriter()

        by_page: dict[int, list] = {}
        for ann in doc.annotations:
            pg = ann.get("page", 0)
            by_page.setdefault(pg, []).append(ann)

        # Editor annotations store one-based page numbers, just like PDF.js.
        for page_number, page in enumerate(reader.pages, start=1):
            page_anns = by_page.get(page_number, [])
            if page_anns:
                media_box = page.mediabox
                view = page_view(page)

                packet = BytesIO()
                c = rl_canvas.Canvas(
                    packet,
                    pagesize=(float(media_box.width), float(media_box.height)),
                )
                enter_screen_space(c, view)

                drawn = 0
                for ann in page_anns:
                    c.saveState()
                    try:
                        if _burn_one_annotation(c, ann):
                            drawn += 1
                    except Exception:
                        pass  # skip this annotation, keep the rest of the page
                    finally:
                        c.restoreState()

                # A Canvas with zero draw calls serializes to a zero-page PDF
                # (reportlab only finalizes a page once something is drawn on
                # it), which would make merge_page below blow up on an empty
                # pages list -- e.g. every annotation on this page was an
                # unsupported/malformed one. Nothing to merge is a no-op, not
                # an error.
                if drawn > 0:
                    c.save()
                    packet.seek(0)
                    overlay_reader = PdfReader(packet)
                    page.merge_page(overlay_reader.pages[0])

            writer.add_page(page)

        flat_path = os.path.join(tmpdir, "flattened.pdf")
        with open(flat_path, "wb") as fh:
            writer.write(fh)
        with open(flat_path, "rb") as fh:
            return fh.read()


# fabric.js text layout constants (fabric/src/shapes/Text/constants), so a
# burned text block has the same line spacing and box as the editor's IText.
_FABRIC_FONT_SIZE_MULT = 1.13
_FABRIC_LINE_HEIGHT = 1.16
_FABRIC_FONT_SIZE_FRACTION = 0.222
_FABRIC_UNDERLINE_OFFSET = 0.1

_STAMP_FONT_SIZE = 22

# The editor's font list mapped onto the PDF base-14 families
# (regular, bold, italic, bold italic).
_PDF_FONTS = {
    "helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}


def _pdf_font_name(family: Optional[str], bold: bool, italic: bool) -> str:
    f = (family or "").lower()
    if "times" in f or "georgia" in f or f == "serif":
        key = "times"
    elif "courier" in f or "mono" in f:
        key = "courier"
    else:
        key = "helvetica"
    return _PDF_FONTS[key][(1 if bold else 0) + (2 if italic else 0)]


def _is_bold(weight) -> bool:
    if weight is None:
        return False
    w = str(weight).lower()
    return w == "bold" or (w.isdigit() and int(w) >= 600)


def _draw_text_block(
    c,
    text: str,
    font_size: float,
    font_name: str,
    color,
    background=None,
    underline: bool = False,
) -> None:
    """Draw fabric-style IText centered on the current origin (y-up frame)."""
    lines = text.split("\n")
    line_impl = font_size * _FABRIC_FONT_SIZE_MULT
    line_step = line_impl * _FABRIC_LINE_HEIGHT
    box_h = line_impl * (_FABRIC_LINE_HEIGHT * (len(lines) - 1) + 1)
    widths = [c.stringWidth(line, font_name, font_size) for line in lines]
    box_w = max(widths) if widths else 0
    left = -box_w / 2
    top = box_h / 2

    if background:
        c.setFillColorRGB(*background)
        c.rect(left, -box_h / 2, box_w, box_h, fill=1, stroke=0)

    c.setFillColorRGB(*color)
    c.setStrokeColorRGB(*color)
    c.setFont(font_name, font_size)
    for i, line in enumerate(lines):
        baseline = top - (i * line_step + line_impl * (1 - _FABRIC_FONT_SIZE_FRACTION))
        c.drawString(left, baseline, line)
        if underline and widths[i]:
            uy = baseline - font_size * _FABRIC_UNDERLINE_OFFSET
            c.setLineWidth(font_size / 15)
            c.line(left, uy, left + widths[i], uy)


def _parse_drawing_path(content: str) -> list:
    """Freehand path data as saved by the editor: a JSON array of fabric
    path commands ([["M", x, y], ["Q", x1, y1, x, y], ...]) or, for older
    data, an SVG path string."""
    import json
    import re

    try:
        data = json.loads(content)
        if isinstance(data, list):
            return [list(cmd) for cmd in data if isinstance(cmd, (list, tuple)) and cmd]
    except (ValueError, TypeError):
        pass

    commands = []
    for letter, args in re.findall(r"([MmLlQqCcZz])([^MmLlQqCcZz]*)", content):
        nums = [float(n) for n in re.findall(r"-?\d*\.?\d+(?:e-?\d+)?", args)]
        commands.append([letter.upper(), *nums])
    return commands


def _quad_extrema(p0: float, p1: float, p2: float) -> list[float]:
    denom = p0 - 2 * p1 + p2
    if denom == 0:
        return []
    t = (p0 - p1) / denom
    if 0 < t < 1:
        return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2]
    return []


def _cubic_extrema(p0: float, p1: float, p2: float, p3: float) -> list[float]:
    import math

    a = -p0 + 3 * p1 - 3 * p2 + p3
    b = 2 * (p0 - 2 * p1 + p2)
    cc = p1 - p0
    ts = []
    if abs(a) < 1e-12:
        if abs(b) > 1e-12:
            ts.append(-cc / b)
    else:
        disc = b * b - 4 * a * cc
        if disc >= 0:
            r = math.sqrt(disc)
            ts += [(-b + r) / (2 * a), (-b - r) / (2 * a)]
    out = []
    for t in ts:
        if 0 < t < 1:
            mt = 1 - t
            out.append(mt ** 3 * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t ** 3 * p3)
    return out


def _path_segments(commands: list) -> list:
    """Normalize to absolute ("M"|"L"|"C", points...) segments, converting
    quadratics to cubics, like fabric's makePathSimpler."""
    segs = []
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    for cmd in commands:
        op, nums = str(cmd[0]).upper(), [float(n) for n in cmd[1:]]
        if op == "M" and len(nums) >= 2:
            cur = start = (nums[0], nums[1])
            segs.append(("M", cur))
        elif op == "L" and len(nums) >= 2:
            cur = (nums[0], nums[1])
            segs.append(("L", cur))
        elif op == "Q" and len(nums) >= 4:
            q = (nums[0], nums[1])
            end = (nums[2], nums[3])
            c1 = (cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1]))
            c2 = (end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1]))
            segs.append(("C", c1, c2, end))
            cur = end
        elif op == "C" and len(nums) >= 6:
            end = (nums[4], nums[5])
            segs.append(("C", (nums[0], nums[1]), (nums[2], nums[3]), end))
            cur = end
        elif op == "Z":
            cur = start
            segs.append(("L", start))
    return segs


def _segments_bbox(segs: list) -> Optional[tuple[float, float, float, float]]:
    xs: list[float] = []
    ys: list[float] = []
    cur = None
    for seg in segs:
        if seg[0] in ("M", "L"):
            cur = seg[1]
            xs.append(cur[0])
            ys.append(cur[1])
        else:
            _, c1, c2, end = seg
            p0 = cur or c1
            xs += [end[0], *_cubic_extrema(p0[0], c1[0], c2[0], end[0])]
            ys += [end[1], *_cubic_extrema(p0[1], c1[1], c2[1], end[1])]
            cur = end
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _burn_one_annotation(c, ann: dict) -> bool:
    """Draw a single annotation onto the in-progress reportlab canvas `c`,
    which is already in top-down viewport space (see enter_screen_space).
    Returns whether it actually drew anything -- a Canvas that never draws
    serializes to a zero-page PDF (see the zero-page guard around this
    function's caller), so "didn't raise" alone isn't a safe proxy: several
    branches below intentionally no-op on unusable data (empty image src,
    missing dimensions, unsupported annotation type) without raising.
    """
    ann_type = ann.get("type")
    style = ann.get("style") or {}
    w = float(ann.get("width") or 0)
    h = float(ann.get("height") or 0)

    if ann_type not in ("text", "stamp", "image", "shape", "drawing"):
        return False  # sign_field placeholders, unknown types

    opacity = style.get("opacity")
    if opacity is not None and opacity < 1:
        c.setFillAlpha(max(0.0, opacity))
        c.setStrokeAlpha(max(0.0, opacity))

    # y-up frame centered on the object, rotated like the editor shows it
    local_frame(
        c,
        float(ann.get("x") or 0),
        float(ann.get("y") or 0),
        float(ann.get("rotation") or 0),
    )

    if ann_type == "text":
        content = ann.get("content") or ""
        if not content:
            return False
        bg_hex = style.get("background_color")
        _draw_text_block(
            c,
            content,
            float(style.get("font_size") or 16),
            _pdf_font_name(
                style.get("font_family"),
                _is_bold(style.get("font_weight")),
                (style.get("font_style") or "") in ("italic", "oblique"),
            ),
            _hex_to_rgb(style.get("color"), default=(0.07, 0.09, 0.15)),
            background=(
                _hex_to_rgb(bg_hex) if bg_hex and bg_hex != "transparent" else None
            ),
            underline=style.get("text_decoration") == "underline",
        )
        return True

    if ann_type == "stamp":
        content = ann.get("content") or ""
        if not content:
            return False
        _draw_text_block(
            c,
            content,
            float(style.get("font_size") or _STAMP_FONT_SIZE),
            "Helvetica-Bold",
            _hex_to_rgb(style.get("color"), default=(0.42, 0.45, 0.50)),
        )
        return True

    if ann_type == "image":
        from reportlab.lib.utils import ImageReader

        content = ann.get("content") or ""
        if not content.startswith("data:") or "," not in content or not w or not h:
            return False
        _, b64data = content.split(",", 1)
        img_reader = ImageReader(BytesIO(base64.b64decode(b64data)))
        c.drawImage(img_reader, -w / 2, -h / 2, w, h, mask="auto")
        border = style.get("border_width") or 0
        if border > 0:
            c.setStrokeColorRGB(*_hex_to_rgb(style.get("border_color"), default=(0.42, 0.45, 0.50)))
            c.setLineWidth(border)
            c.rect(-w / 2, -h / 2, w, h, fill=0, stroke=1)
        return True

    stroke_width = style.get("border_width") or 2
    c.setStrokeColorRGB(*_hex_to_rgb(style.get("color"), default=(0.07, 0.09, 0.16)))
    c.setLineWidth(stroke_width)

    if ann_type == "drawing":
        segs = _path_segments(_parse_drawing_path(ann.get("content") or ""))
        bbox = _segments_bbox(segs)
        if not bbox:
            return False
        bx0, by0, bx1, by1 = bbox
        raw_w, raw_h = bx1 - bx0, by1 - by0
        sx = w / raw_w if raw_w > 0 and w > 0 else 1.0
        sy = h / raw_h if raw_h > 0 and h > 0 else 1.0
        ox, oy = (bx0 + bx1) / 2, (by0 + by1) / 2

        def pt(p):  # path space -> local y-up frame around the center
            return (p[0] - ox) * sx, -(p[1] - oy) * sy

        c.setLineCap(1)
        c.setLineJoin(1)
        path = c.beginPath()
        for seg in segs:
            if seg[0] == "M":
                path.moveTo(*pt(seg[1]))
            elif seg[0] == "L":
                path.lineTo(*pt(seg[1]))
            else:
                path.curveTo(*pt(seg[1]), *pt(seg[2]), *pt(seg[3]))
        c.drawPath(path, stroke=1, fill=0)
        return True

    # ann_type == "shape"
    fill_hex = style.get("background_color")
    has_fill = bool(fill_hex) and fill_hex != "transparent"
    if has_fill:
        c.setFillColorRGB(*_hex_to_rgb(fill_hex))

    kind = ann.get("content")
    if kind == "rect" and w and h:
        c.rect(-w / 2, -h / 2, w, h, fill=1 if has_fill else 0, stroke=1)
        return True
    if kind == "circle" and w and h:
        c.ellipse(-w / 2, -h / 2, w / 2, h / 2, fill=1 if has_fill else 0, stroke=1)
        return True
    if kind == "line" and w:
        c.line(-w / 2, 0, w / 2, 0)
        return True
    if kind == "check" and w and h:
        # Same polyline as the editor's check path, in a w x h box
        c.setLineCap(1)
        c.setLineJoin(1)
        p = c.beginPath()
        p.moveTo(-w / 2, h / 2 - 0.55 * h)
        p.lineTo(-w / 2 + 0.36 * w, -h / 2)
        p.lineTo(w / 2, h / 2)
        c.drawPath(p, stroke=1, fill=0)
        return True
    return False


def _remap_page_items(items: Optional[list], new_page_for) -> list:
    """Move annotations / field definitions to their new page numbers after a
    page operation. `new_page_for(old_page)` returns the new one-based page,
    or None when that page was removed (its items are dropped)."""
    out = []
    for item in items or []:
        new_page = new_page_for(item.get("page"))
        if new_page is None:
            continue
        out.append({**item, "page": new_page})
    return out


def _rotate_annotation(ann: dict, degrees: int, view_w: float, view_h: float) -> dict:
    """Keep an annotation glued to the page content when the page turns by
    `degrees` clockwise. x/y are the object's center in viewport space of
    size view_w x view_h (before the turn)."""
    cx = float(ann.get("x") or 0)
    cy = float(ann.get("y") or 0)
    if degrees == 90:
        nx, ny = view_h - cy, cx
    elif degrees == 180:
        nx, ny = view_w - cx, view_h - cy
    else:  # 270
        nx, ny = cy, view_w - cx
    angle = (float(ann.get("rotation") or 0) + degrees) % 360
    return {**ann, "x": nx, "y": ny, "rotation": angle}


def _rotate_field(field: dict, degrees: int) -> dict:
    """Same for a field definition, whose box is stored as top-left x/y plus
    width/height in 0-1 fractions of the page."""
    x = float(field.get("x") or 0)
    y = float(field.get("y") or 0)
    w = float(field.get("width") or 0)
    h = float(field.get("height") or 0)
    if degrees == 90:
        nx, ny, nw, nh = 1 - y - h, x, h, w
    elif degrees == 180:
        nx, ny, nw, nh = 1 - x - w, 1 - y - h, w, h
    else:  # 270
        nx, ny, nw, nh = y, 1 - x - w, h, w
    return {**field, "x": nx, "y": ny, "width": nw, "height": nh}


# ===========================================================================
# PdfEditorService
# ===========================================================================

class PdfEditorService:
    """
    Core service for user-owned PDF documents.

    File paths stored in the database are *storage keys* (relative paths),
    e.g. ``{company_id}/pdf-editor/{doc_id}/document.pdf``.
    The active StorageBackend resolves these to local paths or R2 objects.
    """

    def __init__(self, db: Session):
        self.db = db
        self.storage: StorageBackend = get_storage()

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _key(company_id: UUID, doc_id: UUID, filename: str) -> str:
        return f"{company_id}/pdf-editor/{doc_id}/{filename}"

    # ------------------------------------------------------------------
    # Local processing helpers
    # ------------------------------------------------------------------

    def _generate_thumbnail(
        self, pdf_local_path: str, thumb_local_path: str
    ) -> bool:
        try:
            from pdf2image import convert_from_path

            images = convert_from_path(
                pdf_local_path, first_page=1, last_page=1, size=(300, None)
            )
            if images:
                images[0].save(thumb_local_path, "PNG")
                return True
        except Exception:
            pass
        return False

    @staticmethod
    def _page_count(pdf_local_path: str) -> int:
        try:
            from pypdf import PdfReader
            return len(PdfReader(pdf_local_path).pages)
        except Exception:
            return 1

    # ------------------------------------------------------------------
    # File-format converters
    # ------------------------------------------------------------------

    def _image_to_pdf(
        self, image_path: str, output_path: str, rotation: int = 0
    ) -> None:
        from PIL import ImageOps
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as rl_canvas

        img = _open_image(image_path)
        img = ImageOps.exif_transpose(img)
        if rotation:
            img = img.rotate(-rotation, expand=True)
        if img.mode != "RGB":
            img = img.convert("RGB")

        temp_jpg = image_path + ".tmp.jpg"
        img.save(temp_jpg, "JPEG", quality=95)
        img_w, img_h = img.size
        img.close()

        page_w, page_h = letter
        scale = min(page_w / img_w, page_h / img_h, 1.0)
        draw_w, draw_h = img_w * scale, img_h * scale
        x = (page_w - draw_w) / 2
        y = (page_h - draw_h) / 2

        c = rl_canvas.Canvas(output_path, pagesize=letter)
        c.drawImage(temp_jpg, x, y, draw_w, draw_h)
        c.save()

        try:
            os.remove(temp_jpg)
        except OSError:
            pass

    def _docx_to_pdf(self, docx_path: str, output_path: str) -> None:
        try:
            from docx import Document as DocxDocument
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.platypus import (
                Paragraph,
                SimpleDocTemplate,
                Spacer,
            )

            doc = DocxDocument(docx_path)
            styles = getSampleStyleSheet()
            story = []
            for para in doc.paragraphs:
                if para.text.strip():
                    story.append(Paragraph(para.text, styles["Normal"]))
                    story.append(Spacer(1, 6))

            if not story:
                story.append(
                    Paragraph("(Empty document)", styles["Normal"])
                )

            pdf_doc = SimpleDocTemplate(output_path, pagesize=letter)
            pdf_doc.build(story)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Failed to convert DOCX: {exc}"
            )

    def _convert_to_pdf(
        self,
        source_path: str,
        output_path: str,
        mime_type: str,
        rotation: int = 0,
    ) -> None:
        if mime_type.startswith("image/"):
            self._image_to_pdf(source_path, output_path, rotation=rotation)
        elif "wordprocessingml" in mime_type:
            self._docx_to_pdf(source_path, output_path)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot convert {mime_type} to PDF",
            )

    # ------------------------------------------------------------------
    # Storage persistence helpers
    # ------------------------------------------------------------------

    def _persist_pdf_and_thumb(
        self,
        company_id: UUID,
        doc_id: UUID,
        pdf_local_path: str,
        tmpdir: str,
    ) -> tuple[str, int, int, Optional[str]]:
        """Upload PDF + thumbnail to storage.

        Returns (pdf_key, file_size, page_count, thumb_key_or_None).
        """
        pdf_key = self._key(company_id, doc_id, "document.pdf")
        with open(pdf_local_path, "rb") as f:
            pdf_data = f.read()
        self.storage.write(pdf_key, pdf_data, "application/pdf")

        file_size = len(pdf_data)
        page_count = self._page_count(pdf_local_path)

        thumb_local = os.path.join(tmpdir, "thumbnail.png")
        thumb_key: Optional[str] = None
        if self._generate_thumbnail(pdf_local_path, thumb_local):
            thumb_key = self._key(company_id, doc_id, "thumbnail.png")
            with open(thumb_local, "rb") as f:
                self.storage.write(thumb_key, f.read(), "image/png")

        return pdf_key, file_size, page_count, thumb_key

    # ------------------------------------------------------------------
    # Document CRUD
    # ------------------------------------------------------------------

    def upload_document(
        self,
        company_id: UUID,
        user_id: UUID,
        file: UploadFile,
        name: Optional[str] = None,
        rotation: int = 0,
    ) -> PdfDocument:
        if file.content_type not in ALLOWED_CONVERT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file.content_type}",
            )

        content = file.file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="File too large. Maximum size is 50 MB.",
            )

        doc_id = uuid.uuid4()
        is_pdf = file.content_type == "application/pdf"

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            if is_pdf:
                pdf_path = os.path.join(tmpdir, "document.pdf")
                with open(pdf_path, "wb") as fh:
                    fh.write(content)
            else:
                ext = (
                    file.filename.rsplit(".", 1)[-1]
                    if file.filename and "." in file.filename
                    else "bin"
                )
                original_path = os.path.join(tmpdir, f"original.{ext}")
                with open(original_path, "wb") as fh:
                    fh.write(content)
                pdf_path = os.path.join(tmpdir, "document.pdf")
                self._convert_to_pdf(
                    original_path, pdf_path, file.content_type, rotation
                )

            pdf_key, file_size, page_count, thumb_key = (
                self._persist_pdf_and_thumb(
                    company_id, doc_id, pdf_path, tmpdir
                )
            )

        doc = PdfDocument(
            id=doc_id,
            company_id=company_id,
            created_by=user_id,
            name=name or file.filename or "Untitled",
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type="convert" if not is_pdf else "upload",
            annotations=[],
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def get_document(
        self, company_id: UUID, document_id: UUID
    ) -> Optional[PdfDocument]:
        return (
            self.db.query(PdfDocument)
            .filter(
                PdfDocument.id == document_id,
                PdfDocument.company_id == company_id,
                PdfDocument.is_active == True,
            )
            .first()
        )

    def get_document_or_404(
        self, company_id: UUID, document_id: UUID
    ) -> PdfDocument:
        doc = self.get_document(company_id, document_id)
        if not doc:
            raise HTTPException(
                status_code=404, detail="Document not found"
            )
        return doc

    def list_documents(
        self,
        company_id: UUID,
        skip: int = 0,
        limit: int = 20,
        search: Optional[str] = None,
    ) -> tuple[list[PdfDocument], int]:
        query = self.db.query(PdfDocument).filter(
            PdfDocument.company_id == company_id,
            PdfDocument.is_active == True,
        )
        if search:
            query = query.filter(PdfDocument.name.ilike(f"%{search}%"))

        total = query.count()
        items = (
            query.order_by(PdfDocument.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def rename_document(
        self, company_id: UUID, document_id: UUID, new_name: str
    ) -> PdfDocument:
        doc = self.get_document_or_404(company_id, document_id)
        doc.name = new_name
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def delete_document(
        self, company_id: UUID, document_id: UUID
    ) -> bool:
        doc = self.get_document(company_id, document_id)
        if not doc:
            return False
        doc.is_active = False
        self.db.commit()
        return True

    def duplicate_document(
        self,
        company_id: UUID,
        document_id: UUID,
        user_id: UUID,
        new_name: Optional[str] = None,
    ) -> PdfDocument:
        original = self.get_document_or_404(company_id, document_id)
        new_id = uuid.uuid4()

        # Copy PDF
        new_pdf_key = self._key(company_id, new_id, "document.pdf")
        pdf_data = self.storage.read(original.file_path)
        self.storage.write(new_pdf_key, pdf_data, "application/pdf")

        # Copy thumbnail
        new_thumb_key: Optional[str] = None
        if original.thumbnail_path and self.storage.exists(
            original.thumbnail_path
        ):
            new_thumb_key = self._key(company_id, new_id, "thumbnail.png")
            thumb_data = self.storage.read(original.thumbnail_path)
            self.storage.write(new_thumb_key, thumb_data, "image/png")

        doc = PdfDocument(
            id=new_id,
            company_id=company_id,
            created_by=user_id,
            name=new_name or f"{original.name} (Copy)",
            file_path=new_pdf_key,
            file_size=original.file_size,
            page_count=original.page_count,
            mime_type=original.mime_type,
            source_type="upload",
            annotations=(
                list(original.annotations) if original.annotations else []
            ),
            field_definitions=list(original.field_definitions or []),
            thumbnail_path=new_thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # Page operations
    # ------------------------------------------------------------------

    def merge_documents(
        self,
        company_id: UUID,
        user_id: UUID,
        document_ids: list[str],
        name: Optional[str] = None,
    ) -> PdfDocument:
        from pypdf import PdfReader, PdfWriter

        if len(document_ids) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least 2 documents are required for merge",
            )

        new_id = uuid.uuid4()

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            writer = PdfWriter()
            doc_names: list[str] = []
            merged_annotations: list = []
            merged_fields: list = []
            used_keys: set[str] = set()
            page_offset = 0

            for i, did in enumerate(document_ids):
                doc = self.get_document(company_id, UUID(did))
                if not doc:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Document {did} not found",
                    )
                # Download each source PDF to temp
                src_path = os.path.join(tmpdir, f"src_{i}.pdf")
                with open(src_path, "wb") as fh:
                    fh.write(self.storage.read(doc.file_path))
                reader = PdfReader(src_path)
                for page in reader.pages:
                    writer.add_page(page)
                doc_names.append(doc.name)

                # Carry over unflattened edits and field mappings, shifted to
                # where this document's pages land in the merged file
                offset = page_offset
                merged_annotations += [
                    {**a, "id": str(uuid.uuid4())}  # same doc may be merged twice
                    for a in _remap_page_items(
                        doc.annotations, lambda p: p + offset if p else None
                    )
                ]
                for field in _remap_page_items(
                    doc.field_definitions, lambda p: p + offset if p else None
                ):
                    key = field.get("key") or "field"
                    unique, n = key, 2
                    while unique in used_keys:
                        unique, n = f"{key}_{n}", n + 1
                    used_keys.add(unique)
                    merged_fields.append({**field, "key": unique})
                page_offset += len(reader.pages)

            merged_path = os.path.join(tmpdir, "document.pdf")
            with open(merged_path, "wb") as fh:
                writer.write(fh)

            pdf_key, file_size, page_count, thumb_key = (
                self._persist_pdf_and_thumb(
                    company_id, new_id, merged_path, tmpdir
                )
            )

        label = name or f"Merged - {', '.join(doc_names[:3])}"
        doc = PdfDocument(
            id=new_id,
            company_id=company_id,
            created_by=user_id,
            name=label,
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type="merge",
            annotations=merged_annotations,
            field_definitions=merged_fields,
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def reorder_pages(
        self, company_id: UUID, document_id: UUID, page_order: list[int]
    ) -> PdfDocument:
        from pypdf import PdfReader, PdfWriter

        doc = self.get_document_or_404(company_id, document_id)

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            local_path = os.path.join(tmpdir, "document.pdf")
            with open(local_path, "wb") as fh:
                fh.write(self.storage.read(doc.file_path))

            reader = PdfReader(local_path)
            if sorted(page_order) != list(range(len(reader.pages))):
                raise HTTPException(
                    status_code=400,
                    detail="page_order must be a permutation of "
                    "0-indexed page indices",
                )

            writer = PdfWriter()
            for idx in page_order:
                writer.add_page(reader.pages[idx])

            # Annotations and fields follow their page to its new position
            old_to_new = {old + 1: new + 1 for new, old in enumerate(page_order)}
            doc.annotations = _remap_page_items(doc.annotations, old_to_new.get)
            doc.field_definitions = _remap_page_items(
                doc.field_definitions, old_to_new.get
            )
            flag_modified(doc, "annotations")
            flag_modified(doc, "field_definitions")

            with open(local_path, "wb") as fh:
                writer.write(fh)

            # Persist updated PDF
            with open(local_path, "rb") as fh:
                self.storage.write(
                    doc.file_path, fh.read(), "application/pdf"
                )

            # Regenerate thumbnail
            if doc.thumbnail_path:
                thumb_local = os.path.join(tmpdir, "thumbnail.png")
                if self._generate_thumbnail(local_path, thumb_local):
                    with open(thumb_local, "rb") as fh:
                        self.storage.write(
                            doc.thumbnail_path, fh.read(), "image/png"
                        )

            doc.file_size = os.path.getsize(local_path)

        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def delete_pages(
        self, company_id: UUID, document_id: UUID, page_numbers: list[int]
    ) -> PdfDocument:
        from pypdf import PdfReader, PdfWriter

        doc = self.get_document_or_404(company_id, document_id)

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            local_path = os.path.join(tmpdir, "document.pdf")
            with open(local_path, "wb") as fh:
                fh.write(self.storage.read(doc.file_path))

            reader = PdfReader(local_path)
            total = len(reader.pages)
            invalid = [p for p in page_numbers if not 1 <= p <= total]
            if invalid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Page(s) out of range: {invalid}",
                )
            to_delete = {p - 1 for p in page_numbers}
            remaining = [i for i in range(total) if i not in to_delete]

            if not remaining:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete all pages from a document",
                )

            writer = PdfWriter()
            for idx in remaining:
                writer.add_page(reader.pages[idx])

            with open(local_path, "wb") as fh:
                writer.write(fh)

            with open(local_path, "rb") as fh:
                self.storage.write(
                    doc.file_path, fh.read(), "application/pdf"
                )

            if doc.thumbnail_path:
                thumb_local = os.path.join(tmpdir, "thumbnail.png")
                if self._generate_thumbnail(local_path, thumb_local):
                    with open(thumb_local, "rb") as fh:
                        self.storage.write(
                            doc.thumbnail_path, fh.read(), "image/png"
                        )

            doc.page_count = len(remaining)
            doc.file_size = os.path.getsize(local_path)

            # Drop what sat on removed pages; shift the rest up
            old_to_new = {old + 1: new + 1 for new, old in enumerate(remaining)}
            doc.annotations = _remap_page_items(doc.annotations, old_to_new.get)
            doc.field_definitions = _remap_page_items(
                doc.field_definitions, old_to_new.get
            )
            flag_modified(doc, "annotations")
            flag_modified(doc, "field_definitions")

        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def rotate_pages(
        self, company_id: UUID, document_id: UUID, rotations: dict[str, int]
    ) -> PdfDocument:
        from pypdf import PdfReader, PdfWriter

        doc = self.get_document_or_404(company_id, document_id)

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            local_path = os.path.join(tmpdir, "document.pdf")
            with open(local_path, "wb") as fh:
                fh.write(self.storage.read(doc.file_path))

            reader = PdfReader(local_path)
            writer = PdfWriter()
            annotations = list(doc.annotations or [])
            fields = list(doc.field_definitions or [])

            for i, page in enumerate(reader.pages):
                key = str(i + 1)
                if key in rotations:
                    degrees = rotations[key]
                    if degrees not in (90, 180, 270):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid rotation {degrees} for "
                            f"page {key}. Use 90, 180, or 270.",
                        )
                    # Keep annotations/fields on the same spot of the
                    # content: measured in the viewport before the turn
                    view_w, view_h = page_view_size(page)
                    page_no = i + 1
                    annotations = [
                        _rotate_annotation(a, degrees, view_w, view_h)
                        if a.get("page") == page_no else a
                        for a in annotations
                    ]
                    fields = [
                        _rotate_field(f, degrees)
                        if f.get("page") == page_no else f
                        for f in fields
                    ]
                    page.rotate(degrees)
                writer.add_page(page)

            doc.annotations = annotations
            doc.field_definitions = fields
            flag_modified(doc, "annotations")
            flag_modified(doc, "field_definitions")

            with open(local_path, "wb") as fh:
                writer.write(fh)

            with open(local_path, "rb") as fh:
                self.storage.write(
                    doc.file_path, fh.read(), "application/pdf"
                )

            if doc.thumbnail_path:
                thumb_local = os.path.join(tmpdir, "thumbnail.png")
                if self._generate_thumbnail(local_path, thumb_local):
                    with open(thumb_local, "rb") as fh:
                        self.storage.write(
                            doc.thumbnail_path, fh.read(), "image/png"
                        )

            doc.file_size = os.path.getsize(local_path)

        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # Annotations
    # ------------------------------------------------------------------

    def save_annotations(
        self, company_id: UUID, document_id: UUID, annotations: list
    ) -> PdfDocument:
        doc = self.get_document_or_404(company_id, document_id)
        doc.annotations = annotations
        flag_modified(doc, "annotations")
        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def save_field_definitions(
        self, company_id: UUID, document_id: UUID, fields: list
    ) -> PdfDocument:
        """Persist the reusable field-mapping template for a document.
        Every future SignRequest created against this document copies
        these definitions as its starting sign_fields snapshot."""
        from app.domains.tools.modules.pdf_editor.field_registry import (
            is_valid_source,
        )

        keys = [f["key"] for f in fields]
        if len(keys) != len(set(keys)):
            raise HTTPException(
                status_code=400,
                detail="Field keys must be unique within a document",
            )
        for f in fields:
            binding = f.get("data_binding") or {}
            if binding.get("mode") == "prefilled" and not is_valid_source(
                binding.get("source_entity"), binding.get("source_field")
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Field '{f.get('label') or f['key']}' is set to "
                        "auto-fill but has no valid data source"
                    ),
                )

        doc = self.get_document_or_404(company_id, document_id)
        doc.field_definitions = fields
        flag_modified(doc, "field_definitions")
        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def flatten_annotations(
        self, company_id: UUID, document_id: UUID
    ) -> bytes:
        """Burn text annotations into the PDF pages.

        Returns the flattened PDF as bytes. If no annotations exist the
        original PDF bytes are returned unchanged.
        """
        doc = self.get_document_or_404(company_id, document_id)
        return flatten_annotations_bytes(doc, self.storage)

    # ------------------------------------------------------------------
    # Multi-image -> PDF
    # ------------------------------------------------------------------

    def images_to_pdf(
        self,
        company_id: UUID,
        user_id: UUID,
        files: list[UploadFile],
        name: Optional[str] = None,
    ) -> PdfDocument:
        from PIL import ImageOps
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as rl_canvas

        doc_id = uuid.uuid4()

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            pdf_path = os.path.join(tmpdir, "document.pdf")
            page_w, page_h = letter
            c = rl_canvas.Canvas(pdf_path, pagesize=letter)
            page_count = 0

            for upload_file in files:
                content = upload_file.file.read()
                if not content:
                    continue

                img = _open_image(BytesIO(content))
                img = ImageOps.exif_transpose(img)
                if img.mode != "RGB":
                    img = img.convert("RGB")

                temp_img = os.path.join(tmpdir, f"_tmp_{page_count}.jpg")
                img.save(temp_img, "JPEG", quality=95)
                img_w, img_h = img.size
                img.close()

                scale = min(page_w / img_w, page_h / img_h, 1.0)
                draw_w, draw_h = img_w * scale, img_h * scale
                x = (page_w - draw_w) / 2
                y = (page_h - draw_h) / 2

                if page_count > 0:
                    c.showPage()
                c.drawImage(temp_img, x, y, draw_w, draw_h)
                page_count += 1

            if page_count == 0:
                raise HTTPException(
                    status_code=400, detail="No valid images provided"
                )

            c.save()

            pdf_key, file_size, pc, thumb_key = (
                self._persist_pdf_and_thumb(
                    company_id, doc_id, pdf_path, tmpdir
                )
            )

        doc = PdfDocument(
            id=doc_id,
            company_id=company_id,
            created_by=user_id,
            name=name or "Photos PDF",
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type="convert",
            annotations=[],
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # Import helpers (estimate / invoice / company-doc)
    # ------------------------------------------------------------------

    def import_estimate_as_document(
        self,
        company_id: UUID,
        user_id: UUID,
        estimate_id: str,
        template: str = "classic",
    ) -> PdfDocument:
        from app.core.pdf_generator import generate_estimate_pdf
        from app.domains.company.models import Company
        from app.domains.estimate.api import _prepare_estimate_pdf_data
        from app.domains.estimate.models import Estimate

        estimate = (
            self.db.query(Estimate)
            .filter(
                Estimate.id == estimate_id,
                Estimate.company_id == company_id,
            )
            .first()
        )
        if not estimate:
            raise HTTPException(
                status_code=404, detail="Estimate not found"
            )

        company = (
            self.db.query(Company)
            .filter(Company.id == company_id)
            .first()
        )
        if not company:
            raise HTTPException(
                status_code=404, detail="Company not found"
            )

        pdf_data = _prepare_estimate_pdf_data(estimate, company, self.db)
        pdf_bytes: bytes = generate_estimate_pdf(pdf_data, template)

        doc_id = uuid.uuid4()

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            pdf_path = os.path.join(tmpdir, "document.pdf")
            with open(pdf_path, "wb") as fh:
                fh.write(pdf_bytes)

            pdf_key, file_size, page_count, thumb_key = (
                self._persist_pdf_and_thumb(
                    company_id, doc_id, pdf_path, tmpdir
                )
            )

        est_number = (
            getattr(estimate, "estimate_number", None) or estimate_id
        )
        doc = PdfDocument(
            id=doc_id,
            company_id=company_id,
            created_by=user_id,
            name=f"Estimate {est_number}",
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type="estimate",
            source_id=UUID(estimate_id),
            annotations=[],
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def import_invoice_as_document(
        self,
        company_id: UUID,
        user_id: UUID,
        invoice_id: str,
        template: str = "classic",
    ) -> PdfDocument:
        from app.core.pdf_generator import generate_invoice_pdf
        from app.domains.company.models import Company
        from app.domains.invoice.api import _prepare_invoice_pdf_data
        from app.domains.invoice.models import Invoice

        invoice = (
            self.db.query(Invoice)
            .filter(
                Invoice.id == invoice_id,
                Invoice.company_id == company_id,
            )
            .first()
        )
        if not invoice:
            raise HTTPException(
                status_code=404, detail="Invoice not found"
            )

        company = (
            self.db.query(Company)
            .filter(Company.id == company_id)
            .first()
        )
        if not company:
            raise HTTPException(
                status_code=404, detail="Company not found"
            )

        pdf_data = _prepare_invoice_pdf_data(invoice, company, self.db)
        pdf_bytes: bytes = generate_invoice_pdf(pdf_data, template)

        doc_id = uuid.uuid4()

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            pdf_path = os.path.join(tmpdir, "document.pdf")
            with open(pdf_path, "wb") as fh:
                fh.write(pdf_bytes)

            pdf_key, file_size, page_count, thumb_key = (
                self._persist_pdf_and_thumb(
                    company_id, doc_id, pdf_path, tmpdir
                )
            )

        inv_number = (
            getattr(invoice, "invoice_number", None) or invoice_id
        )
        doc = PdfDocument(
            id=doc_id,
            company_id=company_id,
            created_by=user_id,
            name=f"Invoice {inv_number}",
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type="invoice",
            source_id=UUID(invoice_id),
            annotations=[],
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def get_or_create_linked_document(
        self,
        company_id: UUID,
        user_id: UUID,
        company_document_id: str,
    ) -> PdfDocument:
        """Get the persistent, e-signature-capable PdfDocument copy linked
        to a CompanyDocument, creating it on first use via
        import_company_document(). Unlike that method's always-fresh-copy
        semantics (used by the editor's one-off "Import" action), this
        reuses the same linked copy on every call -- which is what makes
        field mapping done once from the company document library stay
        reusable rather than being redone on every visit."""
        existing = self._find_linked_document(company_id, company_document_id)
        if existing:
            return existing
        return self.import_company_document(
            company_id, user_id, company_document_id, linked=True
        )

    def _find_linked_document(
        self, company_id: UUID, company_document_id: str
    ) -> Optional[PdfDocument]:
        candidates = (
            self.db.query(PdfDocument)
            .filter(
                PdfDocument.company_id == company_id,
                PdfDocument.source_type == "company_doc",
                PdfDocument.source_id == UUID(company_document_id),
                PdfDocument.is_active == True,
            )
            .order_by(PdfDocument.created_at.asc())
            .all()
        )
        if not candidates:
            return None
        # Editor imports used to share this source_type, so several copies
        # can exist; the one that holds a field mapping is the real template.
        return next(
            (d for d in candidates if d.field_definitions), candidates[0]
        )

    def import_company_document(
        self,
        company_id: UUID,
        user_id: UUID,
        company_document_id: str,
        linked: bool = False,
    ) -> PdfDocument:
        """Copy a company-library document into a new PdfDocument.

        linked=True creates the one persistent template copy (see
        get_or_create_linked_document). Otherwise it's a one-off editor
        import: a separate source_type so it can never shadow the template,
        starting from the template's field mapping when one exists."""
        company_doc = (
            self.db.query(CompanyDocument)
            .filter(
                CompanyDocument.id == company_document_id,
                CompanyDocument.company_id == company_id,
                CompanyDocument.is_active == True,
            )
            .first()
        )
        if not company_doc:
            raise HTTPException(
                status_code=404, detail="Company document not found"
            )

        template_fields: list = []
        if not linked:
            template = self._find_linked_document(company_id, company_document_id)
            if template and template.field_definitions:
                template_fields = list(template.field_definitions)

        new_id = uuid.uuid4()

        # Copy PDF
        new_pdf_key = self._key(company_id, new_id, "document.pdf")
        pdf_data = self.storage.read(company_doc.file_path)
        self.storage.write(new_pdf_key, pdf_data, "application/pdf")

        # Copy thumbnail
        new_thumb_key: Optional[str] = None
        if company_doc.thumbnail_path and self.storage.exists(
            company_doc.thumbnail_path
        ):
            new_thumb_key = self._key(company_id, new_id, "thumbnail.png")
            thumb_data = self.storage.read(company_doc.thumbnail_path)
            self.storage.write(new_thumb_key, thumb_data, "image/png")

        doc = PdfDocument(
            id=new_id,
            company_id=company_id,
            created_by=user_id,
            name=company_doc.name,
            file_path=new_pdf_key,
            file_size=company_doc.file_size,
            page_count=company_doc.page_count,
            mime_type=company_doc.mime_type,
            source_type="company_doc" if linked else "company_doc_import",
            source_id=UUID(company_document_id),
            annotations=[],
            field_definitions=template_fields,
            thumbnail_path=new_thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)

        # Bump use count on source
        company_doc.use_count = (company_doc.use_count or 0) + 1
        company_doc.last_used_at = datetime.utcnow()
        self.db.commit()

        return doc


# ===========================================================================
# CompanyDocumentService
# ===========================================================================

class CompanyDocumentService:
    """
    Service for the company-wide document library.

    Documents here are shared templates / reference files that any
    member of a company can import into their own working documents
    via PdfEditorService.import_company_document().
    """

    def __init__(self, db: Session):
        self.db = db
        self.storage: StorageBackend = get_storage()

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _key(company_id: UUID, doc_id: UUID, filename: str) -> str:
        return f"{company_id}/company-documents/{doc_id}/{filename}"

    # ------------------------------------------------------------------
    # Local processing helpers
    # ------------------------------------------------------------------

    def _generate_thumbnail(
        self, pdf_local_path: str, thumb_local_path: str
    ) -> bool:
        try:
            from pdf2image import convert_from_path

            images = convert_from_path(
                pdf_local_path,
                first_page=1,
                last_page=1,
                size=(300, None),
            )
            if images:
                images[0].save(thumb_local_path, "PNG")
                return True
        except Exception:
            pass
        return False

    @staticmethod
    def _page_count(pdf_local_path: str) -> int:
        try:
            from pypdf import PdfReader
            return len(PdfReader(pdf_local_path).pages)
        except Exception:
            return 1

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def upload(
        self,
        company_id: UUID,
        user_id: UUID,
        file: UploadFile,
        name: str,
        description: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> CompanyDocument:
        if file.content_type not in ALLOWED_UPLOAD_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Only PDF files are accepted. "
                    f"Got: {file.content_type}"
                ),
            )

        content = file.file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="File too large. Maximum size is 50 MB.",
            )

        doc_id = uuid.uuid4()

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            pdf_path = os.path.join(tmpdir, "document.pdf")
            with open(pdf_path, "wb") as fh:
                fh.write(content)

            page_count = self._page_count(pdf_path)
            file_size = len(content)

            # Persist PDF
            pdf_key = self._key(company_id, doc_id, "document.pdf")
            self.storage.write(pdf_key, content, "application/pdf")

            # Thumbnail
            thumb_key: Optional[str] = None
            thumb_local = os.path.join(tmpdir, "thumbnail.png")
            if self._generate_thumbnail(pdf_path, thumb_local):
                thumb_key = self._key(
                    company_id, doc_id, "thumbnail.png"
                )
                with open(thumb_local, "rb") as fh:
                    self.storage.write(
                        thumb_key, fh.read(), "image/png"
                    )

        doc = CompanyDocument(
            id=doc_id,
            company_id=company_id,
            uploaded_by=user_id,
            name=name,
            description=description,
            file_path=pdf_key,
            file_size=file_size,
            mime_type="application/pdf",
            page_count=page_count,
            category=category,
            tags=tags or [],
            use_count=0,
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def get(
        self, company_id: UUID, doc_id: UUID
    ) -> Optional[CompanyDocument]:
        return (
            self.db.query(CompanyDocument)
            .filter(
                CompanyDocument.id == doc_id,
                CompanyDocument.company_id == company_id,
                CompanyDocument.is_active == True,
            )
            .first()
        )

    def get_or_404(
        self, company_id: UUID, doc_id: UUID
    ) -> CompanyDocument:
        doc = self.get(company_id, doc_id)
        if not doc:
            raise HTTPException(
                status_code=404, detail="Company document not found"
            )
        return doc

    def list(
        self,
        company_id: UUID,
        skip: int = 0,
        limit: int = 20,
        search: Optional[str] = None,
        category: Optional[str] = None,
    ) -> tuple[list[CompanyDocument], int]:
        query = self.db.query(CompanyDocument).filter(
            CompanyDocument.company_id == company_id,
            CompanyDocument.is_active == True,
        )
        if search:
            query = query.filter(
                CompanyDocument.name.ilike(f"%{search}%")
            )
        if category:
            query = query.filter(CompanyDocument.category == category)

        total = query.count()
        items = (
            query.order_by(CompanyDocument.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def update(
        self,
        company_id: UUID,
        doc_id: UUID,
        name: Optional[str] = None,
        description: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> CompanyDocument:
        doc = self.get_or_404(company_id, doc_id)
        if name is not None:
            doc.name = name
        if description is not None:
            doc.description = description
        if category is not None:
            doc.category = category
        if tags is not None:
            doc.tags = tags
            flag_modified(doc, "tags")
        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def delete(self, company_id: UUID, doc_id: UUID) -> bool:
        doc = self.get(company_id, doc_id)
        if not doc:
            return False
        doc.is_active = False
        doc.updated_at = datetime.utcnow()
        self.db.commit()
        return True

    def increment_use_count(
        self, company_id: UUID, doc_id: UUID
    ) -> None:
        doc = self.get(company_id, doc_id)
        if doc:
            doc.use_count = (doc.use_count or 0) + 1
            doc.last_used_at = datetime.utcnow()
            self.db.commit()
