"""
Scopit - PDF Editor: redaction

Applying redactions takes what's under each marked area out of the PDF for
good, then paints the area over:

  * glyphs that reach into an area are dropped from the content stream
    (their advance stays, so the rest of the line doesn't move) -- invisible
    text too, like a scan's OCR layer;
  * images lose the pixels under it; one entirely inside an area is removed;
  * paths entirely inside an area aren't painted;
  * PDF annotations (links, form fields, comments) touching it are removed.

Then the file is rebuilt from its pages up, so nothing the pages no longer
use -- the old content streams, an image's unredacted original -- is left
anywhere in it. Areas are in the editor's geometry (pdf.js viewport at
scale 1, see pdf_geometry), like the annotations that mark them.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    ContentStream,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    StreamObject,
)

from app.domains.tools.modules.pdf_editor.pdf_geometry import invert, page_view
from app.domains.tools.modules.pdf_editor.pdf_page_content import image_pixels
from app.domains.tools.modules.pdf_editor.pdf_text_edit import (
    DROP,
    ContentWalker,
    _apply,
    _name,
    _Region,
    _resolve,
    append_content,
    quad,
    rewrite_page,
)

logger = logging.getLogger(__name__)

# The part of a glyph that has to reach into an area for it to go: the
# middle of its advance, from just above the baseline to about x-height.
# Grazing the edge of a letter on the next line doesn't take it.
_GLYPH_CORE = (0.15, 0.85)
_GLYPH_CORE_RISE = (0.1, 0.6)


def _overlap(a: list, b: list) -> bool:
    """Whether two convex polygons (lists of points) overlap."""
    for poly in (a, b):
        for i in range(len(poly)):
            x0, y0 = poly[i]
            x1, y1 = poly[(i + 1) % len(poly)]
            nx, ny = y0 - y1, x1 - x0
            if not nx and not ny:
                continue
            pa = [px * nx + py * ny for px, py in a]
            pb = [px * nx + py * ny for px, py in b]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


def _rgb(hex_color: Optional[str]) -> tuple[float, float, float]:
    h = (hex_color or "").lstrip("#")
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) if len(h) == 6 else (0.0, 0.0, 0.0)
    except ValueError:
        return 0.0, 0.0, 0.0


class _Redactor(ContentWalker):
    track_paths = True

    def __init__(self, areas: list[_Region], to_view, writer: PdfWriter, fill: tuple):
        super().__init__(to_view, writer)
        self.areas = areas
        self.polygons = [a.corners() for a in areas]
        self.fill = fill
        # Images that touched an area but couldn't be edited, so went whole
        self.removed_images = 0

    def _touches(self, points: list) -> bool:
        return any(_overlap(points, poly) for poly in self.polygons)

    def glyph(self, base, x, width, ts, code, n) -> bool:
        (c0, c1), (r0, r1) = _GLYPH_CORE, _GLYPH_CORE_RISE
        return self._touches(quad(base, x + c0 * width, ts.rise + r0 * ts.fs, x + c1 * width, ts.rise + r1 * ts.fs))

    def opaque_text(self, base, advance, ts) -> bool:
        # Where its glyphs are isn't known: all of it goes if any could be in
        lo, hi = sorted((0.0, advance))
        bottom, top = sorted((ts.rise - 0.25 * ts.fs, ts.rise + 0.95 * ts.fs))
        return self._touches(quad(base, lo, bottom, hi, top))

    def path(self, points) -> bool:
        return any(all(a.contains(px, py, slack=0.01) for px, py in points) for a in self.areas)

    def image(self, m, xobj):
        square = quad(m, 0.0, 0.0, 1.0, 1.0)
        hits = [a for a, poly in zip(self.areas, self.polygons) if _overlap(square, poly)]
        if not hits:
            return None
        if any(all(a.contains(px, py, slack=0.01) for px, py in square) for a in hits):
            return DROP
        if xobj is None:  # an inline image: small, and not worth splitting
            self.removed_images += 1
            return DROP
        try:
            return self._redacted_image(xobj, m, hits)
        except Exception:
            logger.warning("Couldn't redact inside an image; removing it", exc_info=True)
            self.removed_images += 1
            return DROP

    def _redacted_image(self, xobj: StreamObject, m, areas: list[_Region]) -> StreamObject:
        """A copy of the image with the areas' pixels painted over (opaque,
        so its soft mask doesn't keep their shape either)."""
        from PIL import Image, ImageDraw

        is_mask = bool(_resolve(xobj.get("/ImageMask")))
        img = image_pixels(xobj)
        w, h = img.size
        to_unit = invert(m)

        def pixel_polygon(area: _Region):
            return [
                (u * w, (1 - v) * h)
                for u, v in (_apply(to_unit, px, py) for px, py in area.corners())
            ]

        r, g, b = (round(c * 255) for c in self.fill)
        draw = ImageDraw.Draw(img)
        for area in areas:
            # A stencil mask can't hold a color: it just stops painting there
            # (the area is painted over on top anyway)
            if is_mask:
                fill = (0, 0, 0, 0)
            elif img.mode == "RGBA":
                fill = (r, g, b, 255)
            elif img.mode == "L":
                fill = round(0.299 * r + 0.587 * g + 0.114 * b)
            else:
                fill = (r, g, b)
            draw.polygon(pixel_polygon(area), fill=fill)

        if is_mask:
            # Back to a stencil: samples of 0 paint (no /Decode)
            stencil = Image.new("L", img.size, 255)
            stencil.paste(0, mask=img.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
            return self._image_stream(stencil.convert("1"), xobj, mask=True)
        if img.mode == "RGBA":
            smask = self._image_stream(img.getchannel("A"), xobj, smask=True)
            return self._image_stream(img.convert("RGB"), xobj, soft_mask=self.writer._add_object(smask))
        return self._image_stream(img, xobj)

    @staticmethod
    def _image_stream(img, original: StreamObject, mask=False, smask=False, soft_mask=None) -> StreamObject:
        stream = DecodedStreamObject()
        entries = {
            "/Type": NameObject("/XObject"),
            "/Subtype": NameObject("/Image"),
            "/Width": NumberObject(img.size[0]),
            "/Height": NumberObject(img.size[1]),
        }
        if mask:
            entries["/ImageMask"] = original["/ImageMask"]
            entries["/BitsPerComponent"] = NumberObject(1)
            stream.set_data(img.tobytes())
        else:
            entries["/ColorSpace"] = NameObject("/DeviceGray" if img.mode == "L" else "/DeviceRGB")
            entries["/BitsPerComponent"] = NumberObject(8)
            filters = _resolve(original.get("/Filter"))
            names = [_name(f) for f in filters] if isinstance(filters, list) else [_name(filters)]
            if not smask and "DCTDecode" in names:
                # A photo stays a JPEG
                buf = BytesIO()
                img.save(buf, "JPEG", quality=90)
                stream.set_data(buf.getvalue())
                entries["/Filter"] = NameObject("/DCTDecode")
            else:
                stream.set_data(img.tobytes())
            if soft_mask is not None:
                entries["/SMask"] = soft_mask
            if "/Interpolate" in original:
                entries["/Interpolate"] = original["/Interpolate"]
        for key, value in entries.items():
            stream[NameObject(key)] = value
        return stream if "/Filter" in entries else stream.flate_encode()


def _drop_annotations(page, areas: list[_Region], to_view) -> set[int]:
    """Remove the page's PDF annotations that touch an area -- and the
    pop-ups of those that go. Returns the ids of the removed objects."""
    annots = _resolve(page.get("/Annots"))
    if not annots:
        return set()
    polygons = [a.corners() for a in areas]
    gone: set[int] = set()
    for ref in annots:
        annot = _resolve(ref)
        rect = _resolve(annot.get("/Rect")) if hasattr(annot, "get") else None
        if not rect or len(rect) != 4:
            continue
        x0, y0, x1, y1 = (float(_resolve(v)) for v in rect)
        corners = [_apply(to_view, x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        if any(_overlap(corners, poly) for poly in polygons):
            gone.add(id(annot))
    if not gone:
        return gone

    def stays(ref) -> bool:
        annot = _resolve(ref)
        parent = _resolve(annot.get("/Parent")) if hasattr(annot, "get") else None
        if parent is not None and id(parent) in gone:
            gone.add(id(annot))
        return id(annot) not in gone

    kept = ArrayObject(ref for ref in annots if stays(ref))
    if kept:
        page[NameObject("/Annots")] = kept
    else:
        del page["/Annots"]
    return gone


def _drop_form_fields(writer: PdfWriter, gone: set[int]) -> None:
    """Take removed widgets out of the form's field tree, which would
    otherwise keep them -- and the values typed into them -- in the file.
    A field left with no widgets goes too."""
    form = _resolve(writer._root_object.get("/AcroForm"))
    if not form or not gone:
        return

    def prune(refs) -> ArrayObject:
        kept = ArrayObject()
        for ref in refs or []:
            field = _resolve(ref)
            if id(field) in gone:
                continue
            kids = _resolve(field.get("/Kids")) if hasattr(field, "get") else None
            if kids:
                remaining = prune(kids)
                if not remaining:
                    continue
                field[NameObject("/Kids")] = remaining
            kept.append(ref)
        return kept

    form[NameObject("/Fields")] = prune(_resolve(form.get("/Fields")))


def _drawn_xobjects(operations, resources, writer, depth: int = 0) -> set[str]:
    """Names of the XObjects these operations draw from `resources` --
    including what's drawn by a form that has no resources of its own (it
    draws from the same ones)."""
    xobjects = _resolve(resources.get("/XObject")) if resources else None
    names: set[str] = set()
    for operands, op in operations:
        if op != b"Do" or not operands:
            continue
        name = str(operands[0])
        if name in names:
            continue
        names.add(name)
        form = _resolve(xobjects.get(name)) if xobjects else None
        if (
            isinstance(form, StreamObject) and _name(form.get("/Subtype")) == "Form"
            and "/Resources" not in form and depth < 8
        ):
            ops = ContentStream(form, writer).operations
            names |= _drawn_xobjects(ops, resources, writer, depth + 1)
    return names


def _prune_xobjects(owner, operations, writer, depth: int = 0, seen=None) -> None:
    """Drop the XObjects `owner` (a page, or a form with its own resources)
    lists but no longer draws. A redacted form or image is drawn from an
    edited copy; its original would otherwise stay in the file, reachable
    through the resources. Resource dictionaries can be shared, so a pruned
    one is a copy."""
    seen = set() if seen is None else seen
    resources = _resolve(owner.get("/Resources"))
    xobjects = _resolve(resources.get("/XObject")) if resources else None
    if not xobjects or id(owner) in seen or depth > 8:
        return
    seen.add(id(owner))
    used = _drawn_xobjects(operations, resources, writer)
    kept = DictionaryObject({NameObject(k): xobjects.raw_get(k) for k in xobjects if k in used})
    if len(kept) != len(xobjects):
        pruned = DictionaryObject(resources.items())
        pruned[NameObject("/XObject")] = kept
        owner[NameObject("/Resources")] = pruned
    for name in kept:
        form = _resolve(kept.raw_get(name))
        if isinstance(form, StreamObject) and _name(form.get("/Subtype")) == "Form" and "/Resources" in form:
            _prune_xobjects(form, ContentStream(form, writer).operations, writer, depth + 1, seen)


def _fill_content(areas: list[_Region], to_user, fill: tuple) -> bytes:
    def n(v: float) -> str:
        s = f"{v:.4f}".rstrip("0").rstrip(".")
        return "0" if s in ("", "-0") else s

    parts = [f"q {n(fill[0])} {n(fill[1])} {n(fill[2])} rg"]
    for area in areas:
        points = [_apply(to_user, x, y) for x, y in area.corners()]
        (x0, y0), *rest = points
        parts.append(f"{n(x0)} {n(y0)} m " + " ".join(f"{n(x)} {n(y)} l" for x, y in rest) + " h f")
    parts.append("Q")
    return "\n".join(parts).encode("ascii")


def _without_unused_objects(writer: PdfWriter, remove_metadata: bool) -> bytes:
    """Write the document out with only what its pages and catalog still
    reach. A writer keeps every object it was given, so the old content of
    a redacted page would otherwise still be in the file."""
    first = BytesIO()
    writer.write(first)
    first.seek(0)
    rebuilt = PdfWriter(clone_from=PdfReader(first))
    if remove_metadata:
        rebuilt.metadata = None
        root = rebuilt._root_object
        if "/Metadata" in root:
            del root["/Metadata"]
    out = BytesIO()
    rebuilt.write(out)
    return out.getvalue()


def apply_redactions(
    pdf_data: bytes,
    areas_by_page: dict[int, list[dict]],
    fill_color: str = "#000000",
    remove_metadata: bool = False,
) -> tuple[bytes, int]:
    """Redact the areas (annotation-like boxes, by one-based page number)
    out of the PDF. Returns the new PDF and how many images had to be
    removed whole because their pixels couldn't be edited."""
    reader = PdfReader(BytesIO(pdf_data))
    writer = PdfWriter(clone_from=reader)
    fill = _rgb(fill_color)
    removed_images = 0
    removed_annots: set[int] = set()
    for page_number, boxes in sorted(areas_by_page.items()):
        if not 1 <= page_number <= len(writer.pages):
            raise IndexError(page_number)
        areas = [_Region(b) for b in boxes]
        if not areas:
            continue
        page = writer.pages[page_number - 1]
        view = page_view(page)
        to_view = invert(view.to_user)
        redactor = _Redactor(areas, to_view, writer, fill)
        if rewrite_page(page, redactor):
            _prune_xobjects(page, page.get_contents().operations, writer)
        removed_images += redactor.removed_images
        removed_annots |= _drop_annotations(page, areas, to_view)
        if "/Thumb" in page:
            del page["/Thumb"]  # a picture of the page as it was
        append_content(page, _fill_content(areas, view.to_user, fill))
    _drop_form_fields(writer, removed_annots)
    if remove_metadata:
        writer.metadata = None
    return _without_unused_objects(writer, remove_metadata), removed_images
