"""
Scopit - PDF Editor: editing the page's own text

The Edit Text tool stores each replacement as a pair of annotations: a
"cover" over the original words (id = text id + TEXT_COVER_SUFFIX) and the
new text. This module turns that pair into a real edit of the PDF instead of
paint on top of it:

  * erase_text drops every glyph whose center lies inside a cover from the
    page's content stream (and from the form XObjects it draws), leaving an
    equal TJ offset behind so the rest of the line doesn't move. Table rules,
    shading and images under the words stay as they are, and the old words
    are gone from copy/paste and search too.
  * page_font finds the PDF font the original words were printed in, so the
    new text can be written with it (see service._pdf_font_text_content).

Edit picks up a page's images the same way: an image cover (its partner is
an image annotation, see with_cover_kinds) removes the image it was made
over, and the image annotation draws it wherever it was moved to.

ContentWalker is the page-content walk all of this shares; redaction
(pdf_redact) and reading a page's text and images (pdf_page_content) are
built on it too.

Everything works on pages already attached to a PdfWriter: pypdf can't
reliably replace the contents of a page that only belongs to a reader.
Geometry is the editor's (pdf.js viewport at scale 1, see pdf_geometry).
"""

from __future__ import annotations

import logging
import math
import re
from io import BytesIO
from typing import Callable, NamedTuple, Optional

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    ByteStringObject,
    ContentStream,
    DecodedStreamObject,
    DictionaryObject,
    FloatObject,
    IndirectObject,
    NameObject,
    StreamObject,
    TextStringObject,
)

from app.domains.tools.modules.pdf_editor.pdf_geometry import invert as _invert
from app.domains.tools.modules.pdf_editor.pdf_geometry import multiply as _mul
from app.domains.tools.modules.pdf_editor.pdf_geometry import page_view

logger = logging.getLogger(__name__)

# Must match TEXT_COVER_SUFFIX in the editor's AnnotationLayer
TEXT_COVER_SUFFIX = ":cover"

# Where a glyph counts as "inside" a cover: the middle of its advance, this
# far (in font sizes) above the baseline -- inside the letters' x-height, so
# the line above or below never matches
_GLYPH_CENTER_RISE = 0.3

# Form XObjects nest; deeper than this is treated as opaque
_MAX_FORM_DEPTH = 8

# A bfrange/cidrange larger than this is malformed, not a real mapping
_MAX_CMAP_RANGE = 0x10000

_IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

_STANDARD_FAMILIES = {
    # family -> (regular, bold, italic, bold italic)
    "helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}


def is_text_cover(ann: dict) -> bool:
    return ann.get("type") == "shape" and str(ann.get("id") or "").endswith(TEXT_COVER_SUFFIX)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _apply(m, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def _resolve(obj):
    return obj.get_object() if obj is not None and hasattr(obj, "get_object") else obj


def _num(obj, default: float = 0.0) -> float:
    try:
        return float(_resolve(obj))
    except (TypeError, ValueError):
        return default


def _name(obj) -> str:
    obj = _resolve(obj)
    return str(obj).lstrip("/") if obj is not None else ""


def _matrix(operands) -> tuple:
    if len(operands) != 6:
        raise ValueError("matrix needs 6 numbers")
    return tuple(float(v) for v in operands)


def _raw_bytes(s) -> bytes:
    """The string's bytes exactly as they were in the content stream (pypdf
    may have decoded a glyph-code string as text)."""
    if isinstance(s, TextStringObject):
        return s.original_bytes
    return bytes(s)


def _stream(data: bytes, entries=None) -> StreamObject:
    stream = DecodedStreamObject()
    stream.set_data(data)
    if entries:
        stream.update(entries)
    return stream.flate_encode()


def _with_entries(resources, category: str, added: dict) -> DictionaryObject:
    """A copy of a resource dictionary with entries added under `category`.
    Resources are often shared between pages, so they're never edited in
    place."""
    res = DictionaryObject(resources.items()) if resources else DictionaryObject()
    sub = _resolve(res.get(category))
    sub = DictionaryObject(sub.items()) if sub else DictionaryObject()
    for key, value in added.items():
        sub[NameObject(key)] = value
    res[NameObject(category)] = sub
    return res


def _unused_name(existing, prefix: str, start: int = 1) -> str:
    n = start
    while f"/{prefix}{n}" in (existing or {}):
        n += 1
    return f"/{prefix}{n}"


# ---------------------------------------------------------------------------
# CMaps (encodings of composite fonts, ToUnicode)
# ---------------------------------------------------------------------------

_CMAP_TOKEN = re.compile(rb"<[0-9A-Fa-f\s]*>|\[|\]|/[^\s/<>\[\]()]+|[^\s<>\[\]/()]+")


def _hex_token(tok: bytes) -> Optional[bytes]:
    if not tok.startswith(b"<"):
        return None
    digits = re.sub(rb"\s", b"", tok[1:-1])
    if len(digits) % 2:
        digits += b"0"
    try:
        return bytes.fromhex(digits.decode())
    except ValueError:
        return None


def _utf16(data: bytes) -> str:
    return data.decode("utf-16-be", errors="ignore")


class _CMap:
    def __init__(self, data: bytes):
        self.code_ranges: list[tuple[bytes, bytes]] = []
        self.cid_ranges: list[tuple[int, int, int, int]] = []  # lo, hi, length, first cid
        self.cids: dict[tuple[int, int], int] = {}
        self.unicode: dict[tuple[int, int], str] = {}
        self.vertical = False
        self._parse(data)

    def _parse(self, data: bytes) -> None:
        toks = _CMAP_TOKEN.findall(data)
        section = None
        i = 0
        while i < len(toks):
            tok = toks[i]
            if tok.startswith(b"begin") and tok[5:] in (
                b"codespacerange", b"cidrange", b"cidchar", b"bfchar", b"bfrange",
            ):
                section = tok[5:]
                i += 1
                continue
            if section and tok == b"end" + section:
                section = None
                i += 1
                continue
            if tok == b"/WMode" and i + 1 < len(toks):
                self.vertical = toks[i + 1] == b"1"
            try:
                if section == b"codespacerange":
                    lo, hi = _hex_token(toks[i]), _hex_token(toks[i + 1])
                    if lo is not None and hi is not None and len(lo) == len(hi):
                        self.code_ranges.append((lo, hi))
                    i += 2
                elif section == b"cidrange":
                    lo, hi = _hex_token(toks[i]), _hex_token(toks[i + 1])
                    if lo is not None and hi is not None:
                        self.cid_ranges.append(
                            (int.from_bytes(lo, "big"), int.from_bytes(hi, "big"), len(lo), int(toks[i + 2]))
                        )
                    i += 3
                elif section == b"cidchar":
                    code = _hex_token(toks[i])
                    if code is not None:
                        self.cids[(int.from_bytes(code, "big"), len(code))] = int(toks[i + 1])
                    i += 2
                elif section == b"bfchar":
                    code, dst = _hex_token(toks[i]), _hex_token(toks[i + 1])
                    if code is not None and dst is not None:
                        self.unicode[(int.from_bytes(code, "big"), len(code))] = _utf16(dst)
                    i += 2
                elif section == b"bfrange":
                    i = self._bfrange(toks, i)
                else:
                    i += 1
            except (IndexError, ValueError):
                i += 1

    def _bfrange(self, toks: list[bytes], i: int) -> int:
        lo, hi = _hex_token(toks[i]), _hex_token(toks[i + 1])
        if lo is None or hi is None:
            return i + 1
        n = len(lo)
        start, end = int.from_bytes(lo, "big"), int.from_bytes(hi, "big")
        if end < start or end - start > _MAX_CMAP_RANGE:
            end = start - 1  # malformed: skip its entries
        if toks[i + 2] == b"[":
            j = i + 3
            code = start
            while j < len(toks) and toks[j] != b"]":
                dst = _hex_token(toks[j])
                if dst is not None and code <= end:
                    self.unicode[(code, n)] = _utf16(dst)
                code += 1
                j += 1
            return j + 1
        dst = _hex_token(toks[i + 2])
        if dst is not None and dst:
            base = int.from_bytes(dst, "big")
            for k in range(end - start + 1):
                value = (base + k).to_bytes(len(dst), "big", signed=False) if base + k < 256 ** len(dst) else dst
                self.unicode[(start + k, n)] = _utf16(value)
        return i + 3

    def cid(self, code: int, n: int) -> int:
        cid = self.cids.get((code, n))
        if cid is not None:
            return cid
        for lo, hi, length, first in self.cid_ranges:
            if length == n and lo <= code <= hi:
                return first + code - lo
        return code


# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------

def standard_font_name(base_font: str) -> Optional[str]:
    """The base-14 font a font name stands for (Arial -> Helvetica, ...)."""
    from reportlab.pdfbase._fontdata import standardFonts

    name = base_font.split("+", 1)[-1]
    flat = re.sub(r"[\s,\-_]", "", name).lower()
    for std in standardFonts:
        if flat == std.replace("-", "").lower():
            return std
    if "arial" in flat or "helvetica" in flat:
        family = "helvetica"
    elif "times" in flat:
        family = "times"
    elif "courier" in flat:
        family = "courier"
    else:
        return None
    bold = any(w in flat for w in ("bold", "black", "heavy"))
    italic = "italic" in flat or "oblique" in flat
    return _STANDARD_FAMILIES[family][(1 if bold else 0) + (2 if italic else 0)]


def _glyph_unicode(glyph: Optional[str]) -> Optional[str]:
    if not glyph:
        return None
    try:
        from pypdf._codecs import adobe_glyphs

        ch = adobe_glyphs.get("/" + glyph)
        if ch:
            return ch
    except ImportError:
        pass
    m = re.fullmatch(r"uni([0-9A-Fa-f]{4})|u([0-9A-Fa-f]{4,6})", glyph)
    if m:
        return chr(int(m.group(1) or m.group(2), 16))
    return glyph if len(glyph) == 1 else None


class PdfFont:
    """What editing needs from a PDF font: how a string splits into
    character codes, how far each code advances, and (for writing) which
    code draws a given character."""

    def __init__(self, font: DictionaryObject):
        self.font = font
        subtype = _name(font.get("/Subtype"))
        self.composite = subtype == "Type0"
        self.type3 = subtype == "Type3"
        self.vertical = False
        # False: the code -> width mapping is unknown, so glyph positions in
        # this font can't be trusted and nothing in it is erased
        self.supported = True
        self.scale = 0.001  # glyph space -> text space
        self._widths: dict[int, float] = {}
        self._default_width = 0.0
        self._cmap: Optional[_CMap] = None
        self._encoder: Optional[dict[str, bytes]] = None
        self._unicode: Optional[dict[tuple[int, int], str]] = None
        if self.composite:
            self._init_composite()
        else:
            self._init_simple()

    # ── construction ────────────────────────────────────────────────────────

    def _init_simple(self) -> None:
        font = self.font
        descriptor = _resolve(font.get("/FontDescriptor"))
        if descriptor:
            self._default_width = _num(descriptor.get("/MissingWidth"), 0.0)
        widths = _resolve(font.get("/Widths"))
        if widths is not None:
            first = int(_num(font.get("/FirstChar"), 0))
            for i, w in enumerate(widths):
                self._widths[first + i] = _num(w)
        else:
            self._widths = self._standard_widths()
            if not self._widths:
                self.supported = False
                self._default_width = 500.0
        if self.type3:
            matrix = _resolve(font.get("/FontMatrix"))
            self.scale = _num(matrix[0], 0.001) if matrix else 0.001

    def _glyph_names(self) -> list[Optional[str]]:
        from reportlab.pdfbase._fontdata import encodings

        font = self.font
        std = standard_font_name(_name(font.get("/BaseFont")))
        if std == "Symbol":
            base = "SymbolEncoding"
        elif std == "ZapfDingbats":
            base = "ZapfDingbatsEncoding"
        elif _name(font.get("/Subtype")) == "TrueType":
            base = "WinAnsiEncoding"
        else:
            base = "StandardEncoding"
        diffs = None
        enc = _resolve(font.get("/Encoding"))
        if isinstance(enc, str):
            base = _name(enc) or base
        elif isinstance(enc, DictionaryObject):
            if enc.get("/BaseEncoding"):
                base = _name(enc.get("/BaseEncoding"))
            diffs = _resolve(enc.get("/Differences"))
        names = list(encodings.get(base) or encodings["StandardEncoding"])
        if diffs:
            code = 0
            for item in diffs:
                item = _resolve(item)
                if isinstance(item, (int, float)):
                    code = int(item)
                elif 0 <= code < 256:
                    names[code] = _name(item)
                    code += 1
        return names

    def _standard_widths(self) -> dict[int, float]:
        from reportlab.pdfbase._fontdata import widthsByFontGlyph

        std = standard_font_name(_name(self.font.get("/BaseFont")))
        glyph_widths = widthsByFontGlyph.get(std) if std else None
        if not glyph_widths:
            return {}
        return {
            code: float(glyph_widths[name])
            for code, name in enumerate(self._glyph_names())
            if name in glyph_widths
        }

    def _init_composite(self) -> None:
        font = self.font
        descendants = _resolve(font.get("/DescendantFonts"))
        cid_font = _resolve(descendants[0]) if descendants else DictionaryObject()
        self._default_width = _num(cid_font.get("/DW"), 1000.0)
        self._parse_w(_resolve(cid_font.get("/W")))

        enc = _resolve(font.get("/Encoding"))
        if isinstance(enc, StreamObject):
            self._cmap = _CMap(enc.get_data())
            self.vertical = self._cmap.vertical or _num(enc.get("/WMode"), 0) == 1
            if not self._cmap.code_ranges:
                self._cmap.code_ranges = [(b"\x00\x00", b"\xff\xff")]
            return
        name = _name(enc)
        if name == "Identity-H":
            return
        self.vertical = name.endswith("-V")
        # Predefined CMaps other than Identity aren't bundled, so the CID (and
        # with it the width) of a code isn't known; UCS-2 / UTF-16 ones at
        # least split strings into 2-byte codes
        self.supported = False
        if "UCS2" not in name and "UTF16" not in name:
            self._cmap = _CMap(b"")
            self._cmap.code_ranges = [(b"\x00", b"\x80"), (b"\x81\x40", b"\xfe\xfe")]

    def _parse_w(self, w) -> None:
        if not w:
            return
        i = 0
        items = [_resolve(v) for v in w]
        while i < len(items):
            first = items[i]
            nxt = items[i + 1] if i + 1 < len(items) else None
            if isinstance(nxt, (list, ArrayObject)):
                for k, width in enumerate(nxt):
                    self._widths[int(first) + k] = _num(width)
                i += 2
            elif i + 2 < len(items):
                lo, hi, width = int(first), int(nxt), _num(items[i + 2])
                if 0 <= hi - lo <= _MAX_CMAP_RANGE:
                    for cid in range(lo, hi + 1):
                        self._widths[cid] = width
                i += 3
            else:
                break

    # ── reading ─────────────────────────────────────────────────────────────

    def codes(self, raw: bytes) -> list[tuple[int, int, bytes]]:
        """(code, byte length, the code's bytes) for each character code."""
        if not self.composite:
            return [(b, 1, raw[i:i + 1]) for i, b in enumerate(raw)]
        ranges = self._cmap.code_ranges if self._cmap else None
        out = []
        i = 0
        while i < len(raw):
            n = 2
            if ranges:
                n = 0
                for lo, hi in ranges:
                    k = len(lo)
                    chunk = raw[i:i + k]
                    if len(chunk) == k and all(lo[j] <= chunk[j] <= hi[j] for j in range(k)):
                        n = k
                        break
                if not n:
                    n = min(len(lo) for lo, _ in ranges)
            chunk = raw[i:i + n]
            out.append((int.from_bytes(chunk, "big"), len(chunk), chunk))
            i += n
        return out

    def _cid(self, code: int, n: int) -> int:
        return self._cmap.cid(code, n) if self._cmap else code

    def advance(self, code: int, n: int = 1) -> float:
        """Horizontal advance of a code, in text space units per unit of
        font size."""
        key = self._cid(code, n) if self.composite else code
        return self._widths.get(key, self._default_width) * self.scale

    def _unicode_map(self) -> dict[tuple[int, int], str]:
        """(code, byte length) -> the text it stands for."""
        if self._unicode is not None:
            return self._unicode
        mapping: dict[tuple[int, int], str] = {}
        to_unicode = _resolve(self.font.get("/ToUnicode"))
        if isinstance(to_unicode, StreamObject):
            try:
                mapping = _CMap(to_unicode.get_data()).unicode
            except Exception:
                mapping = {}
        if not mapping and not self.composite:
            for code, glyph in enumerate(self._glyph_names()):
                ch = _glyph_unicode(glyph)
                if ch:
                    mapping[(code, 1)] = ch
        self._unicode = mapping
        return mapping

    def text(self, code: int, n: int = 1) -> str:
        """The text a character code stands for ('' when the font doesn't
        say and it isn't plain ASCII)."""
        text = self._unicode_map().get((code, n))
        if text is not None:
            return text
        return chr(code) if n == 1 and 32 <= code < 127 else ""

    # ── writing ─────────────────────────────────────────────────────────────

    def encoder(self) -> dict[str, bytes]:
        """Character -> the code that draws it, for the characters this font
        (often a subset of the full typeface) actually has."""
        if self._encoder is not None:
            return self._encoder
        mapping = self._unicode_map()
        encoder: dict[str, bytes] = {}
        for (code, n), text in sorted(mapping.items()):
            if len(text) != 1 or text in encoder:
                continue
            # A subset's /Widths are 0 for the glyphs it left out
            if not self.composite and text != " " and self.advance(code) <= 0:
                continue
            encoder[text] = code.to_bytes(n, "big")
        self._encoder = encoder
        return encoder


def _font_names(font: DictionaryObject) -> set[str]:
    """Every name pdf.js might report for this font (it uses the font
    descriptor's FontName, which for composite fonts is the descendant's)."""
    names = {_name(font.get("/BaseFont"))}
    dicts = [font]
    descendants = _resolve(font.get("/DescendantFonts"))
    if descendants:
        cid_font = _resolve(descendants[0])
        dicts.append(cid_font)
        names.add(_name(cid_font.get("/BaseFont")))
    for d in dicts:
        descriptor = _resolve(d.get("/FontDescriptor"))
        if descriptor:
            names.add(_name(descriptor.get("/FontName")))
    names.discard("")
    return names


def _find_font(resources, name: str, depth: int = 0):
    """(resource name or None if it's only inside a form XObject, reference)
    of the font called `name`."""
    if not resources or depth > _MAX_FORM_DEPTH:
        return None
    fonts = _resolve(resources.get("/Font"))
    if fonts:
        for key in fonts:
            font = _resolve(fonts.raw_get(key))
            if isinstance(font, DictionaryObject) and name in _font_names(font):
                return (key if depth == 0 else None), fonts.raw_get(key)
    xobjects = _resolve(resources.get("/XObject"))
    for key in xobjects or []:
        xobj = _resolve(xobjects.raw_get(key))
        if isinstance(xobj, StreamObject) and _name(xobj.get("/Subtype")) == "Form":
            found = _find_font(_resolve(xobj.get("/Resources")), name, depth + 1)
            if found:
                return None, found[1]
    return None


def add_page_resource(page, category: str, value, prefix: str) -> str:
    resources = _resolve(page.get("/Resources"))
    existing = _resolve(resources.get(category)) if resources else None
    name = _unused_name(existing, prefix)
    page[NameObject("/Resources")] = _with_entries(resources, category, {name: value})
    return name


def base14_font(page, base_font: str) -> str:
    """Resource name of a base-14 font (WinAnsi) on the page, added once."""
    fonts = _resolve(_resolve(page.get("/Resources") or {}).get("/Font")) or {}
    for key in fonts:
        font = _resolve(fonts.raw_get(key))
        if str(key).startswith("/ScopitH") and _name(font.get("/BaseFont")) == base_font:
            return str(key)
    return add_page_resource(page, "/Font", DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/" + base_font),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    }), "ScopitH")


def page_font(page, name: str) -> Optional[tuple[str, PdfFont]]:
    """(resource name on this page, font) for the PDF font pdf.js calls
    `name`, or None if the page doesn't have it or it can't be written with
    (Type 3 glyph procedures, vertical writing)."""
    found = _find_font(_resolve(page.get("/Resources")), name)
    if not found:
        return None
    key, ref = found
    font = PdfFont(_resolve(ref))
    if font.type3 or font.vertical:
        return None
    if key is None:
        key = add_page_resource(page, "/Font", ref, "ScopitF")
    return str(key), font


# ---------------------------------------------------------------------------
# Walking a page's content
# ---------------------------------------------------------------------------

class _Region:
    """A box in viewport space, rotated `rotation` degrees clockwise around
    its center: an Edit Text cover ("text"), the cover of an image picked up
    with Edit ("image"), or an area to redact."""

    def __init__(self, ann: dict):
        self.id = str(ann.get("id"))
        self.kind = ann.get("kind") or "text"
        self.cx = float(ann.get("x") or 0)
        self.cy = float(ann.get("y") or 0)
        self.hw = float(ann.get("width") or 0) / 2
        self.hh = float(ann.get("height") or 0) / 2
        a = math.radians(-float(ann.get("rotation") or 0))
        self.cos, self.sin = math.cos(a), math.sin(a)
        self.hit = False

    def contains(self, px: float, py: float, slack: float = 0.0) -> bool:
        dx, dy = px - self.cx, py - self.cy
        lx = dx * self.cos - dy * self.sin
        ly = dx * self.sin + dy * self.cos
        return abs(lx) <= self.hw + slack and abs(ly) <= self.hh + slack

    def corners(self) -> list[tuple[float, float]]:
        # Local -> viewport is the inverse rotation of contains()
        c, s = self.cos, -self.sin
        return [
            (self.cx + lx * c - ly * s, self.cy + lx * s + ly * c)
            for lx, ly in ((-self.hw, -self.hh), (self.hw, -self.hh), (self.hw, self.hh), (-self.hw, self.hh))
        ]

    def matches(self, box: "ImageBox") -> bool:
        """Whether an image drawn at `box` is the one this cover was made
        over (the editor builds an image cover from that image's box)."""
        def close(a: float, b: float) -> bool:
            return abs(a - b) <= max(2.0, 0.1 * b)
        return (
            self.contains(box.cx, box.cy)
            and close(box.width, 2 * self.hw)
            and close(box.height, 2 * self.hh)
        )


class ImageBox(NamedTuple):
    """Where an image lands in the viewport: its center, its size along its
    own edges, the clockwise angle of its top edge, and whether it's drawn
    mirrored (its first row of pixels at the bottom)."""
    cx: float
    cy: float
    width: float
    height: float
    angle: float
    mirrored: bool


def image_box(m) -> ImageBox:
    """The unit square an image is painted into, under m (image space ->
    viewport). The image's first row of pixels is the square's top (v = 1)."""
    tlx, tly = _apply(m, 0.0, 1.0)
    trx, tr_y = _apply(m, 1.0, 1.0)
    blx, bly = _apply(m, 0.0, 0.0)
    ux, uy = trx - tlx, tr_y - tly
    vx, vy = blx - tlx, bly - tly
    width = math.hypot(ux, uy)
    cross = ux * vy - uy * vx
    # Measured square to the top edge, so a skewed image keeps its area
    height = abs(cross) / width if width else math.hypot(vx, vy)
    cx, cy = _apply(m, 0.5, 0.5)
    angle = math.degrees(math.atan2(uy, ux)) % 360 if width else 0.0
    return ImageBox(cx, cy, width, height, angle, cross < 0)


def quad(m, u0: float, v0: float, u1: float, v1: float) -> list[tuple[float, float]]:
    """The box [u0, u1] x [v0, v1] of a local space, mapped by m."""
    return [_apply(m, u0, v0), _apply(m, u1, v0), _apply(m, u1, v1), _apply(m, u0, v1)]


class _TextState:
    """Text state parameters; part of the graphics state, so q/Q save them."""

    __slots__ = ("tc", "tw", "th", "tl", "font", "fs", "rise")

    def __init__(self):
        self.tc = 0.0
        self.tw = 0.0
        self.th = 1.0
        self.tl = 0.0
        self.font: Optional[PdfFont] = None
        self.fs = 0.0
        self.rise = 0.0

    def copy(self) -> "_TextState":
        c = _TextState()
        for k in self.__slots__:
            setattr(c, k, getattr(self, k))
        return c


# An image hook's answer for "don't draw this image"
DROP = object()

# Path construction operators -> how many points their operands hold
_PATH_POINTS = {b"m": 1, b"l": 1, b"c": 3, b"v": 2, b"y": 2}
_PATH_PAINT = {b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*"}


class ContentWalker:
    """Walks a page's content stream -- and the form XObjects it draws --
    keeping the graphics and text state, so a subclass sees where each
    glyph, image and painted path lands in the viewport and can drop it (or,
    for an image, draw another one instead). Nothing is edited in place:
    rewrite() returns the new operations, or None when nothing changed.

    `pdf` is the PdfWriter the page belongs to; a walker that only looks
    (never drops anything) may be given the PdfReader instead."""

    # Paths are only followed for a subclass that looks at them
    track_paths = False

    def __init__(self, to_view, pdf):
        self.to_view = to_view  # PDF user space -> viewport
        self.writer = pdf
        self._fonts: dict[int, tuple[object, PdfFont]] = {}
        self._forms_in_progress: set[int] = set()
        self._next_name = 1

    # ── what a subclass decides ─────────────────────────────────────────────

    def glyph(self, base, x: float, width: float, ts: _TextState, code: int, n: int) -> bool:
        """A glyph drawn from x to x + width along the baseline of text space
        (`base`: text space -> viewport). True drops it."""
        return False

    def opaque_text(self, base, advance: float, ts: _TextState) -> bool:
        """A string in a font whose glyph positions aren't known, about
        `advance` long. True drops all of it."""
        return False

    def image(self, m, xobj: Optional[StreamObject]):
        """An image painted into the unit square under m (image space ->
        viewport); xobj is None for an inline image. None keeps it, DROP
        removes it, and a stream object draws that image there instead."""
        return None

    def path(self, points: list[tuple[float, float]]) -> bool:
        """A path about to be painted, as its points and control points in
        the viewport. True leaves it unpainted."""
        return False

    def _anchor(self, index: int, ctm) -> None:
        """A text object (or an edited form) ended at `index` of the page's
        new operations."""

    # ── walking ─────────────────────────────────────────────────────────────

    def font(self, resources, name) -> Optional[PdfFont]:
        fonts = _resolve(resources.get("/Font")) if resources else None
        font = _resolve(fonts.get(name)) if fonts else None
        if not isinstance(font, DictionaryObject):
            return None
        cached = self._fonts.get(id(font))
        if cached is None:
            # Keep the dict alive alongside its id so the id can't be reused
            cached = (font, PdfFont(font))
            self._fonts[id(font)] = cached
        return cached[1]

    def walk(self, page) -> None:
        """Walk a page without changing it."""
        content = page.get_contents()
        if content is not None:
            self.rewrite(content.operations, _resolve(page.get("/Resources")), _IDENTITY, _TextState(), 0)

    def _fresh_name(self, xobjects, prefix: str) -> str:
        name = _unused_name(xobjects, prefix, self._next_name)
        self._next_name = int(name[len(prefix) + 1:]) + 1
        return name

    def rewrite(self, operations, resources, ctm, ts: _TextState, depth: int):
        """Operations with what the subclass dropped left out, or None when
        nothing was; plus new XObjects (name -> ref) for `resources`."""
        out = []
        added: dict[str, IndirectObject] = {}
        changed = False
        stack = []
        tm = tlm = _IDENTITY
        points: list[tuple[float, float]] = []  # of the path being built

        def next_line(tx: float, ty: float):
            nonlocal tm, tlm
            tlm = _mul((1.0, 0.0, 0.0, 1.0, tx, ty), tlm)
            tm = tlm

        for operands, op in operations:
            try:
                if op == b"q":
                    stack.append((ctm, ts.copy()))
                elif op == b"Q":
                    if stack:
                        ctm, ts = stack.pop()
                elif op == b"cm":
                    ctm = _mul(_matrix(operands), ctm)
                elif op == b"BT":
                    tm = tlm = _IDENTITY
                elif op == b"Tc":
                    ts.tc = float(operands[0])
                elif op == b"Tw":
                    ts.tw = float(operands[0])
                elif op == b"Tz":
                    ts.th = float(operands[0]) / 100
                elif op == b"TL":
                    ts.tl = float(operands[0])
                elif op == b"Ts":
                    ts.rise = float(operands[0])
                elif op == b"Tf":
                    ts.font = self.font(resources, operands[0])
                    ts.fs = float(operands[1])
                elif op == b"Td":
                    next_line(float(operands[0]), float(operands[1]))
                elif op == b"TD":
                    ts.tl = -float(operands[1])
                    next_line(float(operands[0]), float(operands[1]))
                elif op == b"Tm":
                    tm = tlm = _matrix(operands)
                elif op == b"T*":
                    next_line(0.0, -ts.tl)
                elif op in (b"Tj", b"'", b'"', b"TJ"):
                    prefix = []
                    if op == b"'":
                        next_line(0.0, -ts.tl)
                        prefix = [([], b"T*")]
                    elif op == b'"':
                        ts.tw, ts.tc = float(operands[0]), float(operands[1])
                        next_line(0.0, -ts.tl)
                        prefix = [([operands[0]], b"Tw"), ([operands[1]], b"Tc"), ([], b"T*")]
                    items = list(operands[0]) if op == b"TJ" else [operands[-1]]
                    new_items, tm = self._show(items, tm, ctm, ts)
                    if new_items is not None:
                        out.extend(prefix)
                        out.append(([ArrayObject(new_items)], b"TJ"))
                        changed = True
                        continue
                elif op == b"Do":
                    xobjects = _resolve(resources.get("/XObject")) if resources else None
                    xobj = _resolve(xobjects.get(operands[0])) if xobjects else None
                    subtype = _name(xobj.get("/Subtype")) if isinstance(xobj, StreamObject) else ""
                    if subtype == "Form" and depth < _MAX_FORM_DEPTH:
                        edited = self._form(xobj, xobjects, resources, ctm, ts, depth)
                        if edited:
                            name, ref = edited
                            added[name] = ref
                            out.append(([NameObject(name)], b"Do"))
                            changed = True
                            if depth == 0:
                                self._anchor(len(out), ctm)
                            continue
                    elif subtype == "Image":
                        drawn = self.image(_mul(ctm, self.to_view), xobj)
                        if drawn is DROP:
                            changed = True
                            continue
                        if drawn is not None:
                            name = self._fresh_name(xobjects, "ScopitImage")
                            added[name] = self.writer._add_object(drawn)
                            out.append(([NameObject(name)], b"Do"))
                            changed = True
                            continue
                elif op == b"INLINE IMAGE":
                    if self.image(_mul(ctm, self.to_view), None) is DROP:
                        changed = True
                        continue
                elif self.track_paths:
                    if op in _PATH_POINTS:
                        m = _mul(ctm, self.to_view)
                        nums = [float(v) for v in operands]
                        points += [_apply(m, nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
                    elif op == b"re":
                        x, y, w, h = (float(v) for v in operands)
                        points += quad(_mul(ctm, self.to_view), x, y, x + w, y + h)
                    elif op in _PATH_PAINT:
                        painted, points = points, []
                        if painted and self.path(painted):
                            out.append(([], b"n"))
                            changed = True
                            continue
                    elif op == b"n":
                        points = []
            except (IndexError, TypeError, ValueError, ZeroDivisionError):
                pass  # malformed operator: keep it, as viewers do
            out.append((operands, op))
            if op == b"ET" and depth == 0:
                self._anchor(len(out), ctm)
        if depth == 0:
            self._anchor(len(out), ctm)
        return (out if changed else None), added

    def _show(self, items, tm, ctm, ts: _TextState):
        """Walk one text-showing operator. Returns (TJ items with the dropped
        glyphs turned into offsets, or None if none were dropped; Tm after)."""
        font, fs, th = ts.font, ts.fs, ts.th
        visible = font is not None and fs != 0 and th != 0
        positioned = visible and font.supported and not font.vertical
        base = _mul(_mul(tm, ctm), self.to_view)
        x = 0.0  # advance so far, in text space
        out: list = []
        kept = bytearray()
        gap = 0.0  # pending advance of dropped glyphs (and TJ offsets)
        removed = False

        def flush_kept():
            nonlocal kept
            if kept:
                out.append(ByteStringObject(bytes(kept)))
                kept = bytearray()

        def flush_gap():
            nonlocal gap
            if gap:
                out.append(FloatObject(round(-gap * 1000 / (fs * th), 4)))
                gap = 0.0

        for item in items:
            if isinstance(item, (int, float)):
                adv = -float(item) / 1000 * fs * th
                flush_kept()
                gap += adv
                x += adv
                continue
            if font is None:
                continue  # no font selected: nothing is drawn
            for code, n, chunk in font.codes(_raw_bytes(item)):
                w0 = font.advance(code, n)
                adv = (w0 * fs + ts.tc + (ts.tw if n == 1 and code == 32 else 0.0)) * th
                if positioned and self.glyph(base, x, w0 * fs * th, ts, code, n):
                    flush_kept()
                    gap += adv
                    removed = True
                else:
                    flush_gap()
                    kept += chunk
                x += adv

        tm = _mul((1.0, 0.0, 0.0, 1.0, x, 0.0), tm)
        if visible and not positioned and self.opaque_text(base, x, ts):
            # Only the pen move is left
            return [FloatObject(round(-x * 1000 / (fs * th), 4))], tm
        if not removed:
            return None, tm
        flush_kept()
        flush_gap()  # keeps the pen where the original text left it
        return out, tm

    def _form(self, form, xobjects, resources, ctm, ts: _TextState, depth: int):
        """Walk a form XObject: (new name, ref) of an edited copy, or None.
        The original is left as it is, since other pages (or other spots on
        this one) may draw it too."""
        if id(form) in self._forms_in_progress:
            return None
        matrix = _resolve(form.get("/Matrix"))
        form_ctm = _mul(_matrix(matrix) if matrix else _IDENTITY, ctm)
        own_resources = _resolve(form.get("/Resources"))
        form_resources = own_resources or resources

        self._forms_in_progress.add(id(form))
        try:
            ops = ContentStream(form, self.writer).operations
            new_ops, added = self.rewrite(ops, form_resources, form_ctm, ts.copy(), depth + 1)
        finally:
            self._forms_in_progress.discard(id(form))
        if new_ops is None:
            return None

        content = ContentStream(None, self.writer)
        content.operations = new_ops
        entries = {
            NameObject(k): v for k, v in form.items()
            if k not in ("/Length", "/Filter", "/DecodeParms", "/Resources")
        }
        if added:
            entries[NameObject("/Resources")] = _with_entries(form_resources, "/XObject", added)
        elif own_resources is not None:
            entries[NameObject("/Resources")] = form.raw_get("/Resources")
        ref = self.writer._add_object(_stream(content.get_data(), entries))
        return self._fresh_name(xobjects, "ScopitEdit"), ref


def rewrite_page(page, walker: ContentWalker) -> bool:
    """Run `walker` over a page that belongs to its writer and keep what it
    changed. Whether anything changed."""
    content = page.get_contents()
    if content is None:
        return False
    resources = _resolve(page.get("/Resources"))
    new_ops, added = walker.rewrite(content.operations, resources, _IDENTITY, _TextState(), 0)
    if new_ops is None:
        return False
    if added:
        page[NameObject("/Resources")] = _with_entries(resources, "/XObject", added)
    content.operations = new_ops
    page.replace_contents(content)
    page.compress_content_streams()
    return True


# ---------------------------------------------------------------------------
# Erasing (Edit Text and Edit image covers)
# ---------------------------------------------------------------------------

def with_cover_kinds(annotations: list[dict]) -> list[dict]:
    """The covers among a page's annotations, each tagged with what it
    covers: the partner of an image cover (its id without the suffix) is an
    image annotation, any other cover is Edit Text's."""
    images = {str(a.get("id")) for a in annotations if a.get("type") == "image"}
    return [
        {**a, "kind": "image" if str(a.get("id"))[: -len(TEXT_COVER_SUFFIX)] in images else "text"}
        for a in annotations if is_text_cover(a)
    ]


class _Eraser(ContentWalker):
    """Drops what covers sit on: glyphs whose center is inside a text cover,
    and the image an image cover was made over."""

    def __init__(self, regions: list[_Region], to_view, writer: PdfWriter):
        super().__init__(to_view, writer)
        self.text_regions = [r for r in regions if r.kind != "image"]
        self.image_regions = [r for r in regions if r.kind == "image"]
        # Cover id -> (index in the page's new operations, CTM there): where
        # its replacement goes, see _anchor
        self.anchors: dict[str, tuple[int, tuple]] = {}
        self._newly_hit: list[_Region] = []

    def glyph(self, base, x, width, ts, code, n) -> bool:
        px, py = _apply(base, x + width / 2, _GLYPH_CENTER_RISE * ts.fs + ts.rise)
        hit = False
        # Every cover over it counts: one inside another still erased its
        # words, it shouldn't be painted as a fallback
        for region in self.text_regions:
            if region.contains(px, py):
                if not region.hit:
                    self._newly_hit.append(region)
                region.hit = hit = True
        return hit

    def image(self, m, xobj):
        if not self.image_regions:
            return None
        box = image_box(m)
        hit = False
        for region in self.image_regions:
            if region.matches(box):
                region.hit = hit = True
        return DROP if hit else None

    def _anchor(self, index: int, ctm) -> None:
        """Covers whose first erased glyph was just passed get their
        replacement here, right after the text object (or form) that drew
        those words: copy/paste and screen readers still find the new words
        where the old ones were in the page's reading order."""
        for region in self._newly_hit:
            self.anchors.setdefault(region.id, (index, ctm))
        self._newly_hit.clear()


def erase_text(
    page,
    covers: list[dict],
    writer: PdfWriter,
    replacement: Optional[Callable[[str, tuple], Optional[bytes]]] = None,
) -> set[str]:
    """Remove what's under each cover from the page, in place: its glyphs,
    or for an image cover (kind "image", see with_cover_kinds) its image.
    `page` must belong to `writer`. Returns the ids of the covers that
    erased something; a cover over content this can't reach (or a page it
    can't parse) is left for the caller to paint over instead.

    `replacement(cover id, CTM)` may return content to put where the
    erased words were in the page's content, drawn under that CTM."""
    regions = [_Region(a) for a in covers]
    if not regions:
        return set()
    try:
        content = page.get_contents()
        if content is None:
            return set()
        resources = _resolve(page.get("/Resources"))
        eraser = _Eraser(regions, _invert(page_view(page).to_user), writer)
        new_ops, added = eraser.rewrite(content.operations, resources, _IDENTITY, _TextState(), 0)
        if new_ops is None:
            return set()
        if added:
            page[NameObject("/Resources")] = _with_entries(resources, "/XObject", added)
        if replacement:
            # Back to front, so earlier indices stay valid
            for cover_id, (index, ctm) in sorted(eraser.anchors.items(), key=lambda kv: -kv[1][0]):
                try:
                    data = replacement(cover_id, ctm)
                    if data:
                        inserted = ContentStream(None, None)
                        inserted.set_data(data)
                        new_ops[index:index] = inserted.operations
                except Exception:
                    logger.warning("Couldn't write a text replacement", exc_info=True)
        content.operations = new_ops
        page.replace_contents(content)
        page.compress_content_streams()
    except Exception:
        logger.warning("Couldn't erase text on a page", exc_info=True)
        return set()
    return {r.id for r in regions if r.hit}


def append_content(page, data: bytes) -> None:
    """Draw `data` on top of everything already on the page, starting from
    the default graphics state."""
    content = page.get_contents()
    existing = content.get_data() if content is not None else b""
    combined = ContentStream(None, None)
    combined.set_data(b"q\n" + existing + b"\nQ\n" + data)
    page.replace_contents(combined)
    page.compress_content_streams()


# ---------------------------------------------------------------------------
# Editor preview
# ---------------------------------------------------------------------------

# Annotation keys that point at other pages / the form tree; a preview page
# only needs what the annotation looks like
_PREVIEW_DROP_KEYS = ("/P", "/Parent", "/Dest", "/A", "/AA", "/Popup", "/IRT", "/StructParent")


def _keep_annotation_looks(page) -> None:
    """Strip the page's annotations down to their appearance. Their /P and
    /Dest entries would otherwise drag every page they point at into a
    one-page file."""
    annots = _resolve(page.get("/Annots"))
    if not annots:
        return
    kept = ArrayObject()
    for ref in annots:
        annot = _resolve(ref)
        if isinstance(annot, DictionaryObject) and "/AP" in annot:
            kept.append(DictionaryObject(
                (NameObject(k), v) for k, v in annot.items() if k not in _PREVIEW_DROP_KEYS
            ))
    if kept:
        page[NameObject("/Annots")] = kept
    else:
        del page["/Annots"]


def erased_page_pdf(pdf_data: bytes, page_number: int, covers: list[dict]) -> tuple[bytes, list[str]]:
    """One page of the document with the covers' text erased, for the editor
    to render while it edits (it draws the new text itself). Returns the PDF
    and the ids of the covers that erased something."""
    reader = PdfReader(BytesIO(pdf_data))
    if not 1 <= page_number <= len(reader.pages):
        raise IndexError(page_number)
    source = reader.pages[page_number - 1]
    _keep_annotation_looks(source)
    writer = PdfWriter()
    page = writer.add_page(source)
    erased = erase_text(page, covers, writer)
    out = BytesIO()
    writer.write(out)
    return out.getvalue(), sorted(erased)
