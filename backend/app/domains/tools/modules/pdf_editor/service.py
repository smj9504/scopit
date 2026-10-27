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
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.core.storage import StorageBackend, get_storage
from app.domains.customer.models import Customer
from app.domains.tools.modules.pdf_editor.models import (
    CompanyDocument,
    PdfDocument,
)
from app.domains.tools.modules.pdf_editor.pdf_geometry import (
    enter_screen_space,
    invert,
    local_frame,
    local_frame_matrix,
    multiply,
    page_view,
    page_view_box,
    page_view_size,
)
from app.domains.tools.modules.pdf_editor.pdf_page_content import (
    MAX_MATCHES,
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
from app.domains.tools.modules.pdf_editor.pdf_text_edit import (
    TEXT_COVER_SUFFIX,
    _Region,
    append_content,
    base14_font,
    erase_text,
    erased_page_pdf,
    page_font,
    with_cover_kinds,
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

# Smallest a crop may leave of a page, either side (points)
MIN_CROP_SIZE = 36
# Most pages one insert (blank pages) or one extract (separate files) makes
MAX_PAGES_PER_OPERATION = 100


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

    Edit Text pairs edit the page itself: the original words under a cover
    are erased from the page's content (the cover is only painted where
    that isn't possible), and the replacement is written in the PDF font of
    the words it replaces when the page has that font.
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
        for page_number, source in enumerate(reader.pages, start=1):
            # Edit the writer's copy: pypdf can't reliably rewrite the
            # contents of a page that only belongs to a reader
            page = writer.add_page(source)
            page_anns = by_page.get(page_number, [])
            if not page_anns:
                continue
            media_box = page.mediabox
            view = page_view(page)

            in_font = {
                a.get("id"): a for a in page_anns
                if a.get("type") == "text" and (a.get("style") or {}).get("pdf_font")
            }
            done: set = set()

            def pdf_font_text(ann: dict, ctm=None) -> Optional[bytes]:
                try:
                    content = _pdf_font_text_content(page, ann, view, ctm)
                except Exception:
                    content = None  # burned the usual way below
                if content is not None:
                    done.add(ann.get("id"))
                return content

            def in_place(cover_id: str, ctm) -> Optional[bytes]:
                ann = in_font.get(cover_id[: -len(TEXT_COVER_SUFFIX)])
                return pdf_font_text(ann, ctm) if ann else None

            # Before the overlay is merged, so only the PDF's own text (and
            # images picked up with Edit) goes; each text replacement takes
            # its original's place in the content
            done |= erase_text(page, with_cover_kinds(page_anns), writer, in_place)
            # A cover that couldn't erase is painted below: its text goes on top
            on_top = [
                content for content in (
                    pdf_font_text(ann) for ann_id, ann in in_font.items() if ann_id not in done
                ) if content is not None
            ]

            packet = BytesIO()
            c = rl_canvas.Canvas(
                packet,
                pagesize=(float(media_box.width), float(media_box.height)),
            )
            enter_screen_space(c, view)

            drawn = 0
            for ann in page_anns:
                if ann.get("id") in done:
                    continue
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

            if on_top:
                append_content(page, b"\n".join(on_top))

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


def _n(v: float) -> str:
    """A number for a content stream."""
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _pdf_font_text_content(page, ann: dict, view, ctm=None) -> Optional[bytes]:
    """Content that draws an Edit Text replacement in the PDF font its
    original words were printed in (style.pdf_font, the name pdf.js gave the
    editor), laid out like _draw_text_block. Characters that font doesn't
    have -- embedded fonts are usually subsets -- use the base-14 font the
    editor would otherwise use. `ctm`: the CTM where the content goes, if
    not the page's default. None if the page doesn't have the font (or the
    text is translucent): the caller then burns it the usual way."""
    from reportlab.pdfbase.pdfmetrics import stringWidth

    style = ann.get("style") or {}
    opacity = style.get("opacity")
    if opacity is not None and opacity < 1:
        return None
    found = page_font(page, style["pdf_font"])
    if not found:
        return None
    font_res, font = found
    text = ann.get("content") or ""
    if not text:
        return b""

    size = float(style.get("font_size") or 16)
    fallback = _pdf_font_name(
        style.get("font_family"),
        _is_bold(style.get("font_weight")),
        (style.get("font_style") or "") in ("italic", "oblique"),
    )
    fallback_res = None
    encoder = font.encoder()

    def segments(line: str) -> list[tuple[str, bytes, float]]:
        """(font resource, codes, width) runs of a line, split where the
        font changes."""
        nonlocal fallback_res
        out: list[tuple[str, bytes, float]] = []
        for ch in line:
            code = encoder.get(ch)
            if code is not None:
                run = (font_res, code, font.advance(int.from_bytes(code, "big"), len(code)) * size)
            else:
                if fallback_res is None:
                    fallback_res = base14_font(page, fallback)
                data = ch.encode("cp1252", errors="replace")
                run = (fallback_res, data, stringWidth(data.decode("cp1252"), fallback, size))
            if out and out[-1][0] == run[0]:
                out[-1] = (run[0], out[-1][1] + run[1], out[-1][2] + run[2])
            else:
                out.append(run)
        return out

    lines = [segments(line) for line in text.split("\n")]
    line_impl = size * _FABRIC_FONT_SIZE_MULT
    line_step = line_impl * _FABRIC_LINE_HEIGHT
    box_h = line_impl * (_FABRIC_LINE_HEIGHT * (len(lines) - 1) + 1)
    widths = [sum(w for _, _, w in line) for line in lines]
    # The editor measured the box with the same font, so its width places
    # the text exactly where it was shown
    box_w = float(ann.get("width") or 0) or max(widths)
    left = -box_w / 2
    top = box_h / 2
    rgb = " ".join(_n(v) for v in _hex_to_rgb(style.get("color"), default=(0.07, 0.09, 0.15)))

    frame = local_frame_matrix(
        view, float(ann.get("x") or 0), float(ann.get("y") or 0), float(ann.get("rotation") or 0),
    )
    if ctm is not None:
        frame = multiply(frame, invert(ctm))
    out = ["q", " ".join(_n(v) for v in frame) + " cm"]
    bg_hex = style.get("background_color")
    if bg_hex and bg_hex != "transparent":
        bg = " ".join(_n(v) for v in _hex_to_rgb(bg_hex))
        out.append(f"{bg} rg {_n(left)} {_n(-box_h / 2)} {_n(box_w)} {_n(box_h)} re f")
    # Text state may be anything where this goes in the page's content
    out += ["BT", "0 Tr 0 Tc 0 Tw 100 Tz 0 Ts", f"{rgb} rg"]
    baselines = []
    for i, line in enumerate(lines):
        baseline = top - (i * line_step + line_impl * (1 - _FABRIC_FONT_SIZE_FRACTION))
        baselines.append(baseline)
        out.append(f"1 0 0 1 {_n(left)} {_n(baseline)} Tm")
        current = None
        for res, codes, _ in line:
            if res != current:
                out.append(f"{res} {_n(size)} Tf")
                current = res
            out.append(f"<{codes.hex()}> Tj")
    out.append("ET")
    if style.get("text_decoration") == "underline":
        out.append(f"{rgb} RG {_n(size / 15)} w")
        for baseline, width in zip(baselines, widths):
            if width:
                uy = baseline - size * _FABRIC_UNDERLINE_OFFSET
                out.append(f"{_n(left)} {_n(uy)} m {_n(left + width)} {_n(uy)} l S")
    out.append("Q")
    return "\n".join(out).encode("latin-1")


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

    # 0 means no outline (e.g. Edit Text's cover boxes), same as the editor;
    # only a missing width falls back to the default
    stroke_width = style.get("border_width")
    if stroke_width is None:
        stroke_width = 2
    stroke = 1 if stroke_width > 0 else 0
    c.setStrokeColorRGB(*_hex_to_rgb(style.get("color"), default=(0.07, 0.09, 0.16)))
    c.setLineWidth(stroke_width)

    if ann_type == "drawing":
        if not stroke:
            return False
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
    if kind in ("rect", "circle") and not (has_fill or stroke):
        return False
    if kind == "rect" and w and h:
        c.rect(-w / 2, -h / 2, w, h, fill=1 if has_fill else 0, stroke=stroke)
        return True
    if kind == "circle" and w and h:
        c.ellipse(-w / 2, -h / 2, w / 2, h / 2, fill=1 if has_fill else 0, stroke=stroke)
        return True
    if not stroke:
        return False
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


def _with_fresh_ids(annotations: Optional[list]) -> list:
    """Copies of annotations under new ids, for pages that now exist twice
    (merging a document with itself, duplicating pages). An Edit cover's id
    stays its partner's id + TEXT_COVER_SUFFIX, so the pair stays a pair."""
    new_ids: dict[str, str] = {}

    def fresh(old: str) -> str:
        return new_ids.setdefault(old, str(uuid.uuid4())) if old else str(uuid.uuid4())

    out = []
    for ann in annotations or []:
        old = str(ann.get("id") or "")
        if old.endswith(TEXT_COVER_SUFFIX):
            new = fresh(old[: -len(TEXT_COVER_SUFFIX)]) + TEXT_COVER_SUFFIX
        else:
            new = fresh(old)
        out.append({**ann, "id": new})
    return out


def _with_unique_keys(fields: Optional[list], used_keys: set[str]) -> list:
    """Field definitions whose keys don't clash with `used_keys` (which
    takes the new keys): a clash gets a _2, _3, ... suffix."""
    out = []
    for field in fields or []:
        key = field.get("key") or "field"
        unique, n = key, 2
        while unique in used_keys:
            unique, n = f"{key}_{n}", n + 1
        used_keys.add(unique)
        out.append({**field, "key": unique})
    return out


def _customer_copy_name(name: str, customer_name: str) -> str:
    """'Lease.pdf' for Jane Doe -> 'Lease - Jane Doe.pdf', within the
    255-character name column (the document's own name gives way first)."""
    base, ext = os.path.splitext(name)
    if ext.lower() != ".pdf":
        base, ext = name, ""
    tail = f" - {customer_name}{ext}"
    return (base[: max(0, 255 - len(tail))] + tail)[:255]


def _page_ranges(pages: list[int]) -> str:
    """[1, 2, 3, 5] -> "1-3, 5" """
    parts, start = [], None
    for i, p in enumerate(pages):
        if start is None:
            start = p
        if i + 1 == len(pages) or pages[i + 1] != p + 1:
            parts.append(str(start) if start == p else f"{start}-{p}")
            start = None
    return ", ".join(parts)


def _cropped_box(view, margins: dict) -> tuple[float, float, float, float]:
    """The crop box (PDF user space) that trims `margins` (points; left,
    top, right, bottom as the page is shown) off what's visible now."""
    left = max(0.0, float(margins.get("left") or 0))
    top = max(0.0, float(margins.get("top") or 0))
    right = max(0.0, float(margins.get("right") or 0))
    bottom = max(0.0, float(margins.get("bottom") or 0))
    x0, y0, x1, y1 = left, top, view.width - right, view.height - bottom
    if x1 - x0 < MIN_CROP_SIZE or y1 - y0 < MIN_CROP_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"The crop leaves less than {MIN_CROP_SIZE / 72:g} inch of the page.",
        )
    a, b, c, d, e, f = view.to_user
    xs, ys = [], []
    for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        xs.append(a * px + c * py + e)
        ys.append(b * px + d * py + f)
    return min(xs), min(ys), max(xs), max(ys)


def _restored_box(page, box: list[float]) -> tuple[float, float, float, float]:
    """A crop box given in PDF user space (one Undo puts back), clipped to
    the page's media box."""
    if len(box) != 4:
        raise HTTPException(status_code=400, detail="A crop box is four numbers: x0, y0, x1, y1")
    mx0, mx1 = sorted(float(page.mediabox[i]) for i in (0, 2))
    my0, my1 = sorted(float(page.mediabox[i]) for i in (1, 3))
    bx0, bx1 = sorted(float(box[i]) for i in (0, 2))
    by0, by1 = sorted(float(box[i]) for i in (1, 3))
    x0, y0, x1, y1 = max(mx0, bx0), max(my0, by0), min(mx1, bx1), min(my1, by1)
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise HTTPException(status_code=400, detail="That crop box is outside the page")
    return x0, y0, x1, y1


def _shift_with_view(ann: dict, old_view, new_view) -> dict:
    """Keep an annotation on the same spot of the page when what's visible
    of it changes (crop): the viewport moves, the content doesn't."""
    a, b, c, d, e, f = old_view.to_user
    x, y = float(ann.get("x") or 0), float(ann.get("y") or 0)
    ux, uy = a * x + c * y + e, b * x + d * y + f
    a, b, c, d, e, f = invert(new_view.to_user)
    return {**ann, "x": a * ux + c * uy + e, "y": b * ux + d * uy + f}


def _shift_field_with_view(field: dict, old_view, new_view) -> dict:
    """Same for a field definition (top-left x/y and size in 0-1 fractions
    of the page). The page keeps its orientation, so it's a translation."""
    moved = _shift_with_view({"x": 0, "y": 0}, old_view, new_view)
    ow, oh, nw, nh = old_view.width, old_view.height, new_view.width, new_view.height
    return {
        **field,
        "x": (float(field.get("x") or 0) * ow + moved["x"]) / nw,
        "y": (float(field.get("y") or 0) * oh + moved["y"]) / nh,
        "width": float(field.get("width") or 0) * ow / nw,
        "height": float(field.get("height") or 0) * oh / nh,
    }


def _without_redacted(annotations: list, marks: list[dict]) -> list:
    """The annotations left once `marks` are applied: the marks go, and so
    does anything added on top whose center is in one of them (an Edit pair
    goes together)."""
    applied = {str(m.get("id")) for m in marks}
    regions: dict[int, list[_Region]] = {}
    for mark in marks:
        regions.setdefault(mark.get("page"), []).append(_Region(mark))
    gone: set[str] = set()
    for ann in annotations:
        if ann.get("type") == "redact":
            continue
        x, y = float(ann.get("x") or 0), float(ann.get("y") or 0)
        if any(r.contains(x, y) for r in regions.get(ann.get("page"), [])):
            base = str(ann.get("id") or "")
            base = base[: -len(TEXT_COVER_SUFFIX)] if base.endswith(TEXT_COVER_SUFFIX) else base
            gone |= {base, base + TEXT_COVER_SUFFIX}
    return [a for a in annotations if str(a.get("id")) not in applied | gone]


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

            # The crop box, as the editor (pdf.js) shows the page
            images = convert_from_path(
                pdf_local_path, first_page=1, last_page=1, size=(300, None),
                use_cropbox=True,
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

    def _upload_to_pdf(
        self,
        file: UploadFile,
        tmpdir: str,
        password: Optional[str] = None,
        rotation: int = 0,
    ) -> str:
        """An uploaded PDF, image or DOCX as a local PDF file (in tmpdir).
        A password-protected PDF is opened with `password`; a 400 whose
        detail has `code` "pdf_password_required" / "pdf_password_incorrect"
        says the editor should ask for one."""
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

        pdf_path = os.path.join(tmpdir, f"upload-{uuid.uuid4().hex}.pdf")
        if file.content_type == "application/pdf":
            try:
                content = unlock_pdf(content, password)
            except PdfPasswordError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"code": f"pdf_{exc.code}", "message": exc.message},
                )
            with open(pdf_path, "wb") as fh:
                fh.write(content)
            return pdf_path

        ext = (
            file.filename.rsplit(".", 1)[-1]
            if file.filename and "." in file.filename
            else "bin"
        )
        original_path = os.path.join(tmpdir, f"original-{uuid.uuid4().hex}.{ext}")
        with open(original_path, "wb") as fh:
            fh.write(content)
        self._convert_to_pdf(original_path, pdf_path, file.content_type, rotation)
        return pdf_path

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
        password: Optional[str] = None,
    ) -> PdfDocument:
        doc_id = uuid.uuid4()
        is_pdf = file.content_type == "application/pdf"

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            pdf_path = self._upload_to_pdf(file, tmpdir, password, rotation)

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
        customer_id: Optional[UUID] = None,
        template_id: Optional[UUID] = None,
        has_customer: Optional[bool] = None,
    ) -> tuple[list[PdfDocument], int]:
        query = self.db.query(PdfDocument).filter(
            PdfDocument.company_id == company_id,
            PdfDocument.is_active == True,
        )
        if search:
            query = query.filter(PdfDocument.name.ilike(f"%{search}%"))
        if has_customer is not None:
            query = query.filter(
                PdfDocument.customer_id.isnot(None)
                if has_customer
                else PdfDocument.customer_id.is_(None)
            )
        if customer_id:
            query = query.filter(PdfDocument.customer_id == customer_id)
        if template_id:
            query = query.filter(PdfDocument.template_id == template_id)

        total = query.count()
        items = (
            query.options(joinedload(PdfDocument.customer))
            .order_by(PdfDocument.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return items, total

    def customer_copy_counts(
        self, company_id: UUID, document_ids: list[UUID]
    ) -> dict[UUID, int]:
        """How many customer copies each of these documents has."""
        if not document_ids:
            return {}
        rows = (
            self.db.query(PdfDocument.template_id, func.count(PdfDocument.id))
            .filter(
                PdfDocument.company_id == company_id,
                PdfDocument.is_active == True,
                PdfDocument.customer_id.isnot(None),
                PdfDocument.template_id.in_(document_ids),
            )
            .group_by(PdfDocument.template_id)
            .all()
        )
        return {template_id: count for template_id, count in rows}

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

    def _document_files(self, doc: PdfDocument) -> tuple[bytes, Optional[bytes]]:
        """The document's PDF and thumbnail (None if it has none)."""
        thumb = None
        if doc.thumbnail_path and self.storage.exists(doc.thumbnail_path):
            thumb = self.storage.read(doc.thumbnail_path)
        return self.storage.read(doc.file_path), thumb

    def _copy_document(
        self,
        original: PdfDocument,
        files: tuple[bytes, Optional[bytes]],
        user_id: UUID,
        name: str,
        **fields,
    ) -> PdfDocument:
        """A new document with its own copy of the original's file (`files`,
        from _document_files), edits and field mapping. Added, not committed."""
        new_id = uuid.uuid4()
        pdf_data, thumb_data = files

        new_pdf_key = self._key(original.company_id, new_id, "document.pdf")
        self.storage.write(new_pdf_key, pdf_data, "application/pdf")
        new_thumb_key: Optional[str] = None
        if thumb_data is not None:
            new_thumb_key = self._key(original.company_id, new_id, "thumbnail.png")
            self.storage.write(new_thumb_key, thumb_data, "image/png")

        doc = PdfDocument(
            id=new_id,
            company_id=original.company_id,
            created_by=user_id,
            name=name,
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
            **fields,
        )
        self.db.add(doc)
        return doc

    def duplicate_document(
        self,
        company_id: UUID,
        document_id: UUID,
        user_id: UUID,
        new_name: Optional[str] = None,
    ) -> PdfDocument:
        original = self.get_document_or_404(company_id, document_id)
        # A copy of a customer's document is still that customer's
        doc = self._copy_document(
            original,
            self._document_files(original),
            user_id,
            new_name or f"{original.name} (Copy)",
            customer_id=original.customer_id,
            template_id=original.template_id,
        )
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def create_customer_copies(
        self,
        company_id: UUID,
        document_id: UUID,
        user_id: UUID,
        customer_ids: list[UUID],
    ) -> list[PdfDocument]:
        """One copy of the document per customer, each filled in or signed
        and kept on its own. The original stays as it is, to copy again."""
        original = self.get_document_or_404(company_id, document_id)
        wanted = list(dict.fromkeys(customer_ids))
        customers = {
            c.id: c
            for c in self.db.query(Customer)
            .filter(Customer.company_id == company_id, Customer.id.in_(wanted))
            .all()
        }
        if len(customers) != len(wanted):
            raise HTTPException(status_code=404, detail="Customer not found")

        files = self._document_files(original)
        copies = [
            self._copy_document(
                original,
                files,
                user_id,
                _customer_copy_name(original.name, customers[cid].name),
                customer_id=cid,
                template_id=original.id,
            )
            for cid in wanted
        ]
        self.db.commit()
        for doc in copies:
            self.db.refresh(doc)
        return copies

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
                merged_annotations += _with_fresh_ids(  # same doc may be merged twice
                    _remap_page_items(doc.annotations, lambda p: p + offset if p else None)
                )
                merged_fields += _with_unique_keys(
                    _remap_page_items(doc.field_definitions, lambda p: p + offset if p else None),
                    used_keys,
                )
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

    def _local_copy(self, doc: PdfDocument, tmpdir: str, name: str = "document.pdf") -> str:
        path = os.path.join(tmpdir, name)
        with open(path, "wb") as fh:
            fh.write(self.storage.read(doc.file_path))
        return path

    def _store_pdf(self, doc: PdfDocument, writer, tmpdir: str) -> None:
        """Make `writer`'s output the document's file: storage, thumbnail,
        size and page count. The caller commits."""
        local_path = os.path.join(tmpdir, "rewritten.pdf")
        with open(local_path, "wb") as fh:
            writer.write(fh)
        with open(local_path, "rb") as fh:
            self.storage.write(doc.file_path, fh.read(), "application/pdf")
        thumb_local = os.path.join(tmpdir, "thumbnail.png")
        if self._generate_thumbnail(local_path, thumb_local):
            if not doc.thumbnail_path:
                doc.thumbnail_path = self._key(doc.company_id, doc.id, "thumbnail.png")
            with open(thumb_local, "rb") as fh:
                self.storage.write(doc.thumbnail_path, fh.read(), "image/png")
        doc.file_size = os.path.getsize(local_path)
        doc.page_count = len(writer.pages)
        doc.updated_at = datetime.utcnow()

    def _new_document(
        self,
        company_id: UUID,
        user_id: UUID,
        writer,
        tmpdir: str,
        name: str,
        source_type: str,
        annotations: Optional[list] = None,
        fields: Optional[list] = None,
    ) -> PdfDocument:
        """A new document from `writer`'s pages. The caller commits."""
        new_id = uuid.uuid4()
        local_path = os.path.join(tmpdir, f"{new_id}.pdf")
        with open(local_path, "wb") as fh:
            writer.write(fh)
        pdf_key, file_size, page_count, thumb_key = self._persist_pdf_and_thumb(
            company_id, new_id, local_path, tmpdir
        )
        doc = PdfDocument(
            id=new_id,
            company_id=company_id,
            created_by=user_id,
            name=name,
            file_path=pdf_key,
            file_size=file_size,
            page_count=page_count,
            mime_type="application/pdf",
            source_type=source_type,
            annotations=annotations or [],
            field_definitions=fields or [],
            thumbnail_path=thumb_key,
        )
        self.db.add(doc)
        return doc

    @staticmethod
    def _check_pages(page_numbers: list[int], total: int) -> list[int]:
        pages = sorted(set(page_numbers))
        invalid = [p for p in pages if not 1 <= p <= total]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Page(s) out of range: {invalid}",
            )
        if not pages:
            raise HTTPException(status_code=400, detail="No pages selected")
        return pages

    def crop_pages(
        self,
        company_id: UUID,
        document_id: UUID,
        page_numbers: Optional[list[int]],
        margins: Optional[dict] = None,
        reset: bool = False,
        boxes: Optional[dict[int, list[float]]] = None,
    ) -> tuple[PdfDocument, dict[int, list[float]]]:
        """Set the crop box of pages (all when page_numbers is None): trim
        `margins` (points; left/top/right/bottom as the page is shown) off
        what's visible now, with `reset` show the whole page again, or with
        `boxes` ({page number: [x0, y0, x1, y1]}, PDF user space) put back
        exactly those boxes -- how a crop is undone.
        Content outside the crop stays in the file, hidden -- as in Acrobat.
        Annotations and fields stay where they were on the page.
        Returns the document and what each changed page showed before, in
        the form `boxes` takes."""
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject

        if not reset and not margins and not boxes:
            raise HTTPException(status_code=400, detail="Give margins to crop, or reset")
        doc = self.get_document_or_404(company_id, document_id)

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            reader = PdfReader(self._local_copy(doc, tmpdir))
            total = len(reader.pages)
            if boxes:
                targets = set(self._check_pages(list(boxes), total))
            else:
                targets = set(
                    self._check_pages(page_numbers, total) if page_numbers is not None
                    else range(1, total + 1)
                )
            writer = PdfWriter()
            views: dict[int, tuple] = {}
            previous: dict[int, list[float]] = {}
            for page_number, source in enumerate(reader.pages, start=1):
                page = writer.add_page(source)
                if page_number not in targets:
                    continue
                old = page_view(page)
                previous[page_number] = list(page_view_box(page))
                if boxes:
                    box = _restored_box(page, boxes[page_number])
                elif reset:
                    box = tuple(float(v) for v in page.mediabox)
                else:
                    box = _cropped_box(old, margins)
                page.cropbox = RectangleObject(box)
                views[page_number] = (old, page_view(page))

            doc.annotations = [
                _shift_with_view(a, *views[a.get("page")]) if a.get("page") in views else a
                for a in doc.annotations or []
            ]
            doc.field_definitions = [
                _shift_field_with_view(f, *views[f.get("page")]) if f.get("page") in views else f
                for f in doc.field_definitions or []
            ]
            flag_modified(doc, "annotations")
            flag_modified(doc, "field_definitions")
            self._store_pdf(doc, writer, tmpdir)

        self.db.commit()
        self.db.refresh(doc)
        return doc, previous

    def insert_pages(
        self,
        company_id: UUID,
        user_id: UUID,
        document_id: UUID,
        after: int,
        kind: str,
        count: int = 1,
        file: Optional[UploadFile] = None,
        password: Optional[str] = None,
        source_document_id: Optional[UUID] = None,
        source_pages: Optional[list[int]] = None,
    ) -> PdfDocument:
        """Insert pages after page `after` (0 = before the first): `count`
        blank pages the size of that page ("blank"), an uploaded PDF, image
        or Word file ("file"), or pages of another document -- or of this
        one, to duplicate them -- with their unflattened edits ("document")."""
        from pypdf import PdfReader, PdfWriter

        doc = self.get_document_or_404(company_id, document_id)

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            reader = PdfReader(self._local_copy(doc, tmpdir))
            total = len(reader.pages)
            if not 0 <= after <= total:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insert position must be between 0 and {total}",
                )

            new_pages: list = []
            new_annotations: list = []
            new_fields: list = []
            blank_size = None
            if kind == "blank":
                if not 1 <= count <= MAX_PAGES_PER_OPERATION:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insert between 1 and {MAX_PAGES_PER_OPERATION} blank pages",
                    )
                # As the neighboring page is shown (turned pages included)
                blank_size = page_view_size(reader.pages[max(after, 1) - 1])
            elif kind == "file":
                if file is None:
                    raise HTTPException(status_code=400, detail="Choose a file to insert")
                new_pages = list(PdfReader(self._upload_to_pdf(file, tmpdir, password)).pages)
            elif kind == "document":
                source = (
                    self.get_document(company_id, source_document_id)
                    if source_document_id else None
                )
                if not source:
                    raise HTTPException(status_code=404, detail="Document to insert from not found")
                source_reader = PdfReader(self._local_copy(source, tmpdir, "source.pdf"))
                pages = (
                    self._check_pages(source_pages, len(source_reader.pages)) if source_pages
                    else list(range(1, len(source_reader.pages) + 1))
                )
                new_pages = [source_reader.pages[p - 1] for p in pages]
                position = {p: after + i + 1 for i, p in enumerate(pages)}
                new_annotations = _with_fresh_ids(_remap_page_items(source.annotations, position.get))
                new_fields = _remap_page_items(source.field_definitions, position.get)
            else:
                raise HTTPException(status_code=400, detail=f"Unknown insert kind: {kind}")

            writer = PdfWriter()
            for page in reader.pages[:after]:
                writer.add_page(page)
            if blank_size:
                for _ in range(count):
                    writer.add_blank_page(*blank_size)
            for page in new_pages:
                writer.add_page(page)
            inserted = len(writer.pages) - after
            for page in reader.pages[after:]:
                writer.add_page(page)

            def shifted(p):
                return p if p <= after else p + inserted

            doc.annotations = _remap_page_items(doc.annotations, shifted) + new_annotations
            used_keys = {f.get("key") for f in doc.field_definitions or []}
            doc.field_definitions = (
                _remap_page_items(doc.field_definitions, shifted)
                + _with_unique_keys(new_fields, used_keys)
            )
            flag_modified(doc, "annotations")
            flag_modified(doc, "field_definitions")
            self._store_pdf(doc, writer, tmpdir)

        self.db.commit()
        self.db.refresh(doc)
        return doc

    def extract_pages(
        self,
        company_id: UUID,
        user_id: UUID,
        document_id: UUID,
        page_numbers: list[int],
        separate: bool = False,
        delete_after: bool = False,
        name: Optional[str] = None,
    ) -> tuple[list[PdfDocument], Optional[PdfDocument]]:
        """Copy pages into a new document -- or one document per page with
        `separate` -- carrying their unflattened edits along. With
        `delete_after` they're then removed from this one, which is
        returned too."""
        from pypdf import PdfReader, PdfWriter

        doc = self.get_document_or_404(company_id, document_id)
        created: list[PdfDocument] = []

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            reader = PdfReader(self._local_copy(doc, tmpdir))
            total = len(reader.pages)
            pages = self._check_pages(page_numbers, total)
            if delete_after and len(pages) == total:
                raise HTTPException(
                    status_code=400,
                    detail="Can't delete every page: a document needs at least one",
                )
            if separate and len(pages) > MAX_PAGES_PER_OPERATION:
                raise HTTPException(
                    status_code=400,
                    detail=f"Extract at most {MAX_PAGES_PER_OPERATION} pages as separate files",
                )
            base = doc.name[:-4] if doc.name.lower().endswith(".pdf") else doc.name
            groups = [[p] for p in pages] if separate else [pages]
            for group in groups:
                writer = PdfWriter()
                for p in group:
                    writer.add_page(reader.pages[p - 1])
                position = {p: i + 1 for i, p in enumerate(group)}
                if name and not separate:
                    label = name
                else:
                    label = f"{base} ({'page' if len(group) == 1 else 'pages'} {_page_ranges(group)})"
                created.append(self._new_document(
                    company_id, user_id, writer, tmpdir, label[:255], "extract",
                    _with_fresh_ids(_remap_page_items(doc.annotations, position.get)),
                    _remap_page_items(doc.field_definitions, position.get),
                ))
            self.db.commit()

        for new_doc in created:
            self.db.refresh(new_doc)
        source = (
            self.delete_pages(company_id, document_id, pages) if delete_after else None
        )
        return created, source

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

    def preview_text_edits(
        self, company_id: UUID, document_id: UUID, page_number: int, covers: list
    ) -> tuple[bytes, list[str]]:
        """One page with what Edit covers sit on (text, or an image picked up)
        erased (see erased_page_pdf), for the editor to show while it edits."""
        doc = self.get_document_or_404(company_id, document_id)
        try:
            return erased_page_pdf(self.storage.read(doc.file_path), page_number, covers)
        except IndexError:
            raise HTTPException(status_code=404, detail="Page not found")

    # ------------------------------------------------------------------
    # Reading a page: images (Edit) and text (Redact search)
    # ------------------------------------------------------------------

    def list_page_images(
        self, company_id: UUID, document_id: UUID, page_number: int
    ) -> list[dict]:
        doc = self.get_document_or_404(company_id, document_id)
        try:
            return page_images(self.storage.read(doc.file_path), page_number)
        except IndexError:
            raise HTTPException(status_code=404, detail="Page not found")

    def get_page_image(
        self, company_id: UUID, document_id: UUID, page_number: int, index: int
    ) -> dict:
        doc = self.get_document_or_404(company_id, document_id)
        try:
            return page_image(self.storage.read(doc.file_path), page_number, index)
        except IndexError:
            raise HTTPException(status_code=404, detail="Page not found")
        except LookupError:
            raise HTTPException(status_code=404, detail="This image can't be edited")

    def search_text(
        self,
        company_id: UUID,
        document_id: UUID,
        query: str = "",
        pattern: Optional[str] = None,
        match_case: bool = False,
        whole_word: bool = False,
    ) -> tuple[list[dict], bool]:
        """Where the words (or a SEARCH_PATTERNS pattern) are printed in the
        document: (matches with their page and boxes, truncated)."""
        try:
            regex = search_regex(query, pattern, match_case, whole_word)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        doc = self.get_document_or_404(company_id, document_id)
        return find_text(self.storage.read(doc.file_path), regex, MAX_MATCHES)

    # ------------------------------------------------------------------
    # Redact / Protect
    # ------------------------------------------------------------------

    def apply_redactions(
        self,
        company_id: UUID,
        document_id: UUID,
        mark_ids: Optional[list[str]] = None,
        fill_color: str = "#000000",
        remove_metadata: bool = False,
    ) -> tuple[PdfDocument, int]:
        """Redact the areas marked with "redact" annotations (those in
        mark_ids, or all) out of the document's file for good -- see
        pdf_redact. The marks are used up, and anything added on top in
        those areas goes with them. Returns the document and how many images
        were removed whole (their pixels couldn't be edited)."""
        doc = self.get_document_or_404(company_id, document_id)
        wanted = set(mark_ids) if mark_ids is not None else None
        marks = [
            a for a in doc.annotations or []
            if a.get("type") == "redact" and (wanted is None or a.get("id") in wanted)
        ]
        if not marks:
            raise HTTPException(status_code=400, detail="Nothing is marked for redaction")
        areas: dict[int, list[dict]] = {}
        for mark in marks:
            areas.setdefault(int(mark.get("page") or 0), []).append(mark)

        try:
            redacted, removed_images = apply_redactions(
                self.storage.read(doc.file_path), areas, fill_color, remove_metadata
            )
        except IndexError as exc:
            raise HTTPException(status_code=400, detail=f"Page {exc} doesn't exist")

        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            local_path = os.path.join(tmpdir, "document.pdf")
            with open(local_path, "wb") as fh:
                fh.write(redacted)
            self.storage.write(doc.file_path, redacted, "application/pdf")
            thumb_local = os.path.join(tmpdir, "thumbnail.png")
            if doc.thumbnail_path and self._generate_thumbnail(local_path, thumb_local):
                with open(thumb_local, "rb") as fh:
                    self.storage.write(doc.thumbnail_path, fh.read(), "image/png")

        doc.file_size = len(redacted)
        doc.annotations = _without_redacted(doc.annotations or [], marks)
        flag_modified(doc, "annotations")
        doc.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(doc)
        return doc, removed_images

    def protected_copy(
        self,
        company_id: UUID,
        document_id: UUID,
        open_password: Optional[str] = None,
        permissions_password: Optional[str] = None,
        allow_printing: bool = True,
        allow_copying: bool = True,
        allow_editing: bool = True,
        allow_commenting: bool = True,
    ) -> bytes:
        """The document as Download PDF gives it (edits burned in),
        password-protected -- see pdf_security.protect_pdf."""
        doc = self.get_document_or_404(company_id, document_id)
        flat = flatten_annotations_bytes(doc, self.storage)
        try:
            return protect_pdf(
                flat,
                open_password=open_password,
                permissions_password=permissions_password,
                allow_printing=allow_printing,
                allow_copying=allow_copying,
                allow_editing=allow_editing,
                allow_commenting=allow_commenting,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))

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
