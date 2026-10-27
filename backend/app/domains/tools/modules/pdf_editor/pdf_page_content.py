"""
Scopit - PDF Editor: what's on a page

Reads a page's own content for the editor:

  * page_images / page_image: the images it draws, so Edit can pick one up
    as an image annotation (and an image cover that takes the original off
    the page, see pdf_text_edit) to move, resize, replace or delete;
  * find_text: where words are printed, so Redact can mark every place a
    word, phrase or pattern (email addresses, phone numbers, ...) appears.

Geometry is the editor's: the pdf.js viewport at scale 1 (see pdf_geometry),
boxes given as center, size and clockwise rotation like annotations.
"""

from __future__ import annotations

import base64
import math
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Optional

from pypdf import PdfReader
from pypdf.generic import StreamObject

from app.domains.tools.modules.pdf_editor.pdf_geometry import invert, page_view
from app.domains.tools.modules.pdf_editor.pdf_text_edit import (
    ContentWalker,
    ImageBox,
    _apply,
    _name,
    _resolve,
    image_box,
    quad,
)

# Images this small (pt, either side) are bullets and rules, not pictures
_MIN_IMAGE_SIZE = 4
# An image covering this much of the page is its background (a scan)
_BACKGROUND_SHARE = 0.85
# Longest side of an image handed to the editor; bigger ones are scaled down
_MAX_IMAGE_SIDE = 4096

MAX_MATCHES = 2000
MAX_QUERY_LENGTH = 200

# Patterns Redact can look for, besides the user's own words
SEARCH_PATTERNS = {
    "email": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    "phone": r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)",
    "ssn": r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)",
    "credit_card": r"(?<!\d)(?:\d{4}[ -]?\d{6}[ -]?\d{5}|(?:\d{4}[ -]?){3}\d{1,4})(?!\d)",
    "date": (
        r"(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?!\d)"
        r"|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b"
    ),
}


def _reader_page(pdf_data: bytes, page_number: int):
    reader = PdfReader(BytesIO(pdf_data))
    if not 1 <= page_number <= len(reader.pages):
        raise IndexError(page_number)
    return reader, reader.pages[page_number - 1]


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

class _ImageCollector(ContentWalker):
    def __init__(self, to_view, pdf):
        super().__init__(to_view, pdf)
        self.images: list[tuple[ImageBox, Optional[StreamObject]]] = []

    def image(self, m, xobj):
        self.images.append((image_box(m), xobj))
        return None


def _collect_images(pdf_data: bytes, page_number: int):
    reader, page = _reader_page(pdf_data, page_number)
    view = page_view(page)
    collector = _ImageCollector(invert(view.to_user), reader)
    collector.walk(page)
    return view, collector.images


def _box_json(box: ImageBox) -> dict:
    return {
        "x": box.cx,
        "y": box.cy,
        "width": box.width,
        "height": box.height,
        "rotation": round(box.angle, 3) % 360,
    }


def page_images(pdf_data: bytes, page_number: int) -> list[dict]:
    """The images a page draws that Edit can pick up. `index` is the
    image's place in the page's drawing order (what page_image takes);
    `background` marks one that fills most of the page, like a scan."""
    view, images = _collect_images(pdf_data, page_number)
    page_area = view.width * view.height or 1.0
    out = []
    for index, (box, xobj) in enumerate(images):
        # Inline images are small and can't be lifted out on their own
        if xobj is None or min(box.width, box.height) < _MIN_IMAGE_SIZE:
            continue
        out.append({
            "index": index,
            **_box_json(box),
            "background": box.width * box.height >= _BACKGROUND_SHARE * page_area,
        })
    return out


def _is_plain_jpeg(xobj: StreamObject) -> bool:
    filters = _resolve(xobj.get("/Filter"))
    if isinstance(filters, list) and len(filters) == 1:
        filters = _resolve(filters[0])
    space = _name(xobj.get("/ColorSpace"))
    return (
        _name(filters) == "DCTDecode"
        and "/SMask" not in xobj and "/Mask" not in xobj
        and space in ("DeviceRGB", "DeviceGray")
        and _resolve(xobj.get("/Decode")) is None
    )


def image_pixels(xobj: StreamObject):
    """An image XObject as a PIL image in RGB, L or RGBA (alpha from its
    soft mask; a stencil mask becomes black ink on transparency)."""
    from PIL import Image, ImageOps

    img = xobj.decode_as_image()
    if _resolve(xobj.get("/ImageMask")):
        # Samples of 0 paint, unless /Decode [1 0] flips that
        decode = _resolve(xobj.get("/Decode"))
        painted_is_one = bool(decode) and float(decode[0]) == 1
        ink = img.convert("L")
        alpha = ink if painted_is_one else ImageOps.invert(ink)
        out = Image.new("RGBA", img.size, (0, 0, 0, 0))
        out.putalpha(alpha)
        return out
    if img.mode in ("RGB", "L", "RGBA"):
        return img
    if img.mode in ("LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        return img.convert("RGBA")
    if img.mode in ("1", "I", "I;16", "F"):
        return img.convert("L")
    return img.convert("RGB")


def _data_url(img, mirrored: bool, xobj: StreamObject) -> str:
    from PIL import Image

    if not mirrored and _is_plain_jpeg(xobj) and max(img.size) <= _MAX_IMAGE_SIDE:
        # The JPEG as it's stored: no second round of compression
        return "data:image/jpeg;base64," + base64.b64encode(xobj.get_data()).decode("ascii")
    if mirrored:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if max(img.size) > _MAX_IMAGE_SIDE:
        img = img.copy()
        img.thumbnail((_MAX_IMAGE_SIDE, _MAX_IMAGE_SIDE))
    buf = BytesIO()
    if img.mode == "RGBA":
        img.save(buf, "PNG", optimize=True)
        mime = "image/png"
    else:
        img.save(buf, "JPEG", quality=92)
        mime = "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def page_image(pdf_data: bytes, page_number: int, index: int) -> dict:
    """One image of a page (by page_images index) as a data URL, with where
    it's drawn. Its pixels are turned the way the page shows them, so an
    image annotation of that box and rotation looks the same. LookupError if
    there's no such image or it can't be read."""
    _, images = _collect_images(pdf_data, page_number)
    if not 0 <= index < len(images) or images[index][1] is None:
        raise LookupError(index)
    box, xobj = images[index]
    try:
        img = image_pixels(xobj)
    except Exception as exc:
        raise LookupError(index) from exc
    return {"index": index, **_box_json(box), "dataUrl": _data_url(img, box.mirrored, xobj)}


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

@dataclass
class _Glyph:
    text: str
    x: float          # baseline start, viewport
    y: float
    end_x: float      # baseline end
    end_y: float
    size: float       # font size in the viewport
    corners: list     # glyph box (descender to ascender), viewport


class _TextCollector(ContentWalker):
    def __init__(self, to_view, pdf):
        super().__init__(to_view, pdf)
        self.glyphs: list[_Glyph] = []

    def glyph(self, base, x, width, ts, code, n) -> bool:
        text = ts.font.text(code, n)
        if text:
            x0, y0 = _apply(base, x, ts.rise)
            x1, y1 = _apply(base, x + width, ts.rise)
            ux, uy = _apply(base, x, ts.rise + ts.fs)
            lo, hi = sorted((ts.rise - 0.22 * ts.fs, ts.rise + 0.88 * ts.fs))
            self.glyphs.append(_Glyph(
                text, x0, y0, x1, y1, math.hypot(ux - x0, uy - y0), quad(base, x, lo, x + width, hi),
            ))
        return False


@dataclass
class _Line:
    """A run of glyphs on one baseline: its origin, direction (unit vector
    along the baseline) and the glyph indices in it."""
    x: float
    y: float
    dx: float
    dy: float
    size: float


def _page_text(glyphs: list[_Glyph]) -> tuple[str, list[int], list[int], list[_Line]]:
    """The page's text as one string, with each character's glyph index (-1
    for a space or line break put in between glyphs) and each glyph's line."""
    chars: list[str] = []
    char_glyph: list[int] = []
    glyph_line: list[int] = []
    lines: list[_Line] = []
    prev: Optional[_Glyph] = None
    for i, g in enumerate(glyphs):
        dx, dy = g.end_x - g.x, g.end_y - g.y
        length = math.hypot(dx, dy)
        line = lines[-1] if lines else None
        joined = False
        if line and prev is not None:
            # Same baseline, same direction, not too far along it
            ox, oy = g.x - line.x, g.y - line.y
            off = abs(-ox * line.dy + oy * line.dx)
            same_dir = length == 0 or (dx * line.dx + dy * line.dy) / length > 0.99
            gap = (g.x - prev.end_x) * line.dx + (g.y - prev.end_y) * line.dy
            size = max(line.size, g.size, 1e-6)
            if same_dir and off <= 0.35 * size and -0.6 * size <= gap <= 1.6 * size:
                joined = True
                if gap > 0.2 * size and not prev.text.isspace() and not g.text.isspace():
                    chars.append(" ")
                    char_glyph.append(-1)
        if not joined:
            if chars:
                chars.append("\n")
                char_glyph.append(-1)
            ux, uy = (dx / length, dy / length) if length else (1.0, 0.0)
            lines.append(_Line(g.x, g.y, ux, uy, g.size))
        glyph_line.append(len(lines) - 1)
        for ch in g.text:
            chars.append(ch)
            char_glyph.append(i)
        prev = g
    return "".join(chars), char_glyph, glyph_line, lines


def _match_boxes(glyphs, glyph_line, lines, indices: list[int]) -> list[dict]:
    """One box per line a match spans: the glyphs' boxes in that line's own
    frame (u along the baseline, v down from it)."""
    by_line: dict[int, list[int]] = {}
    for i in indices:
        by_line.setdefault(glyph_line[i], []).append(i)
    boxes = []
    for line_no, members in by_line.items():
        line = lines[line_no]
        nx, ny = -line.dy, line.dx  # "down" across the baseline
        us, vs = [], []
        for i in members:
            for px, py in glyphs[i].corners:
                ox, oy = px - line.x, py - line.y
                us.append(ox * line.dx + oy * line.dy)
                vs.append(ox * nx + oy * ny)
        pad = 0.06 * line.size
        u0, u1 = min(us) - pad, max(us) + pad
        v0, v1 = min(vs) - pad, max(vs) + pad
        uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
        boxes.append({
            "x": line.x + uc * line.dx + vc * nx,
            "y": line.y + uc * line.dy + vc * ny,
            "width": u1 - u0,
            "height": v1 - v0,
            "rotation": round(math.degrees(math.atan2(line.dy, line.dx)), 3) % 360,
        })
    return boxes


def search_regex(query: str = "", pattern: Optional[str] = None, match_case: bool = False,
                 whole_word: bool = False) -> re.Pattern:
    """The expression find_text looks for: the user's words taken literally
    (spaces match any run of whitespace), or one of SEARCH_PATTERNS."""
    if pattern:
        if pattern not in SEARCH_PATTERNS:
            raise ValueError(f"Unknown pattern: {pattern}")
        return re.compile(SEARCH_PATTERNS[pattern])
    words = query.strip().split()
    if not words:
        raise ValueError("Nothing to search for")
    expr = r"\s+".join(re.escape(w) for w in words)
    if whole_word:
        expr = rf"(?<!\w){expr}(?!\w)"
    return re.compile(expr, 0 if match_case else re.IGNORECASE)


def find_text(pdf_data: bytes, regex: re.Pattern, limit: int = MAX_MATCHES) -> tuple[list[dict], bool]:
    """Every place `regex` matches the document's text: (matches, whether
    there were more than `limit`). A match has its page, text and boxes."""
    reader = PdfReader(BytesIO(pdf_data))
    matches: list[dict] = []
    for page_number, page in enumerate(reader.pages, start=1):
        collector = _TextCollector(invert(page_view(page).to_user), reader)
        try:
            collector.walk(page)
        except Exception:
            continue  # an unreadable page has nothing to find
        glyphs = collector.glyphs
        text, char_glyph, glyph_line, lines = _page_text(glyphs)
        for m in regex.finditer(text):
            indices = sorted({char_glyph[k] for k in range(m.start(), m.end()) if char_glyph[k] >= 0})
            if not indices:
                continue
            if len(matches) >= limit:
                return matches, True
            matches.append({
                "page": page_number,
                "text": m.group(0),
                "boxes": _match_boxes(glyphs, glyph_line, lines, indices),
            })
    return matches, False
