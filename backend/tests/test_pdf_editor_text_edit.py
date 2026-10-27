"""Edit Text changes the PDF's own text, not just what's painted over it.

A cover (an annotation whose id ends in ':cover') erases the page's glyphs
under it from the content stream; its replacement text is written with the
PDF font the original was printed in when the page has it."""
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.domains.tools.modules.pdf_editor.pdf_geometry import page_view
from app.domains.tools.modules.pdf_editor.pdf_text_edit import (
    PdfFont,
    erase_text,
    erased_page_pdf,
)
from app.domains.tools.modules.pdf_editor.service import flatten_annotations_bytes

pdfmetrics.registerFont(TTFont("Vera", "Vera.ttf"))

W, H = 300, 400


def _invert(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    return (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)


def cover(page, x, y, width, size, cover_id="t1:cover"):
    """A cover over text drawn at user-space baseline-left (x, y), the way
    the editor builds one from pdf.js's text run."""
    view = page_view(page)
    a, b, c, d, e, f = _invert(view.to_user)
    ux, uy = x + width / 2, y + size * 0.3
    return {
        "id": cover_id, "type": "shape", "page": 1, "content": "rect",
        "x": a * ux + c * uy + e, "y": b * ux + d * uy + f,
        "width": width + 2, "height": size * 1.1, "rotation": view.rotation,
        "style": {"background_color": "#ffffff", "color": "#ffffff", "border_width": 0},
    }


def text_width(text, font="Helvetica", size=12):
    return pdfmetrics.stringWidth(text, font, size)


def make_pdf(draw, rotate=0):
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    draw(c)
    c.showPage()
    c.save()
    reader = PdfReader(BytesIO(buf.getvalue()))
    writer = PdfWriter()
    page = writer.add_page(reader.pages[0])
    if rotate:
        page.rotate(rotate)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def raw_pdf(content: bytes, fonts: dict) -> bytes:
    """A one-page PDF with hand-written content and font resources."""
    writer = PdfWriter()
    page = writer.add_blank_page(W, H)
    font_dict = DictionaryObject()
    for name, font in fonts.items():
        font_dict[NameObject(name)] = writer._add_object(font)
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): font_dict})
    stream = DecodedStreamObject()
    stream.set_data(content)
    page[NameObject("/Contents")] = writer._add_object(stream)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


HELVETICA = DictionaryObject({
    NameObject("/Type"): NameObject("/Font"),
    NameObject("/Subtype"): NameObject("/Type1"),
    NameObject("/BaseFont"): NameObject("/Helvetica"),
    NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
})


def edit(pdf_bytes, covers):
    """erase_text on page 1; returns (erased ids, the edited page re-read)."""
    writer = PdfWriter()
    page = writer.add_page(PdfReader(BytesIO(pdf_bytes)).pages[0])
    erased = erase_text(page, covers, writer)
    out = BytesIO()
    writer.write(out)
    return erased, PdfReader(BytesIO(out.getvalue())).pages[0]


def flatten(pdf_bytes, annotations):
    storage = Mock()
    storage.read.return_value = pdf_bytes
    doc = SimpleNamespace(file_path="document.pdf", annotations=annotations)
    return PdfReader(BytesIO(flatten_annotations_bytes(doc, storage))).pages[0]


def ops(page):
    return page.get_contents().operations


def raw(s):
    """A string operand's bytes (pypdf reads some glyph codes as text)."""
    return s.original_bytes if hasattr(s, "original_bytes") else bytes(s)


def tj_arrays(page):
    return [
        [v if isinstance(v, (int, float)) else raw(v) for v in operands[0]]
        for operands, op in ops(page) if op == b"TJ"
    ]


def page_text(page):
    return " ".join(page.extract_text().split())


# ---------------------------------------------------------------------------
# Erasing
# ---------------------------------------------------------------------------

def table_row(c):
    c.setFont("Helvetica", 12)
    c.drawString(20, 300, "Total: $1,200")
    c.drawString(200, 300, "Paid")
    c.drawString(20, 285, "Next line")
    c.line(10, 296, 290, 296)  # a table rule running under the words


def test_erases_only_the_covered_words():
    pdf = make_pdf(table_row)
    page = PdfReader(BytesIO(pdf)).pages[0]
    erased, edited = edit(pdf, [cover(page, 20, 300, text_width("Total: $1,200"), 12)])

    assert erased == {"t1:cover"}
    text = page_text(edited)
    assert "Total" not in text and "1,200" not in text
    assert "Paid" in text and "Next line" in text


def test_keeps_graphics_under_the_words():
    pdf = make_pdf(table_row)
    page = PdfReader(BytesIO(pdf)).pages[0]
    _, edited = edit(pdf, [cover(page, 20, 300, text_width("Total: $1,200"), 12)])
    names = [op for _, op in ops(edited)]
    assert b"l" in names and b"S" in names  # the rule is still drawn
    assert b"re" not in names  # and nothing was painted over it


def test_cover_without_text_under_it_erases_nothing():
    pdf = make_pdf(table_row)
    page = PdfReader(BytesIO(pdf)).pages[0]
    erased, edited = edit(pdf, [cover(page, 100, 100, 50, 12)])
    assert erased == set()
    assert "Total: $1,200" in page_text(edited)


def test_rest_of_the_line_keeps_its_position():
    # Hel, a -20 kern, "lo", a 300 gap, World -- drop "lo"
    content = b"BT /F1 12 Tf 20 300 Td [(Hel) -20 (lo) 300 (World)] TJ ET"
    pdf = raw_pdf(content, {"/F1": HELVETICA})
    page = PdfReader(BytesIO(pdf)).pages[0]
    x = 20 + text_width("Hel") + 20 / 1000 * 12
    erased, edited = edit(pdf, [cover(page, x, 300, text_width("lo"), 12)])

    assert erased == {"t1:cover"}
    (arr,) = tj_arrays(edited)
    # the kern, both glyphs' advances and the gap become one offset
    l_o = 222 + 556  # Helvetica widths
    assert arr == [b"Hel", pytest.approx(-20 + 300 - l_o, abs=0.01), b"World"]


def test_tj_without_kerning_becomes_tj_array():
    content = b"BT /F1 12 Tf 20 300 Td (Total 1200) Tj ET"
    pdf = raw_pdf(content, {"/F1": HELVETICA})
    page = PdfReader(BytesIO(pdf)).pages[0]
    x = 20 + text_width("Total ")
    _, edited = edit(pdf, [cover(page, x, 300, text_width("1200"), 12)])
    (arr,) = tj_arrays(edited)
    assert arr[0] == b"Total "
    # the trailing offset keeps the pen where the original text left it
    assert float(arr[1]) == pytest.approx(-pdfmetrics.stringWidth("1200", "Helvetica", 1000), abs=0.01)


def test_quote_operators_keep_their_line_moves():
    content = b'BT /F1 12 Tf 14 TL 20 300 Td (First) Tj (Second) \' 2 0 (Third) " ET'
    pdf = raw_pdf(content, {"/F1": HELVETICA})
    page = PdfReader(BytesIO(pdf)).pages[0]
    covers = [
        cover(page, 20, 286, text_width("Second"), 12, "a:cover"),
        cover(page, 20, 272, text_width("Third") + 4 * 2, 12, "b:cover"),
    ]
    erased, edited = edit(pdf, covers)
    assert erased == {"a:cover", "b:cover"}
    names = [op for _, op in ops(edited)]
    assert names.count(b"T*") == 2 and b"Tw" in names and b"Tc" in names
    assert page_text(edited) == "First"


def test_rotated_page():
    pdf = make_pdf(table_row, rotate=90)
    page = PdfReader(BytesIO(pdf)).pages[0]
    erased, edited = edit(pdf, [cover(page, 200, 300, text_width("Paid"), 12)])
    assert erased == {"t1:cover"}
    text = page_text(edited)
    assert "Paid" not in text and "Total: $1,200" in text


def test_text_inside_a_form_xobject():
    def draw(c):
        c.beginForm("header")
        c.setFont("Helvetica", 12)
        c.drawString(20, 350, "ACME Roofing")
        c.drawString(20, 335, "Estimate")
        c.endForm()
        c.doForm("header")
        c.saveState()
        c.translate(0, -200)
        c.doForm("header")  # the same form again, lower down
        c.restoreState()

    pdf = make_pdf(draw)
    page = PdfReader(BytesIO(pdf)).pages[0]
    erased, edited = edit(pdf, [cover(page, 20, 335, text_width("Estimate"), 12)])

    assert erased == {"t1:cover"}
    # Only the top copy is edited; the other still reads the original form
    assert page_text(edited).count("Estimate") == 1
    assert page_text(edited).count("ACME Roofing") == 2


def identity_h_font():
    to_unicode = DecodedStreamObject()
    to_unicode.set_data(
        b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        b"1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
        b"2 beginbfchar <0001> <0041> <0002> <0042> endbfchar\n"
        b"endcmap CMapName currentdict /CMap defineresource pop end end"
    )
    return DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type0"),
        NameObject("/BaseFont"): NameObject("/ABCDEF+Test"),
        NameObject("/Encoding"): NameObject("/Identity-H"),
        NameObject("/ToUnicode"): to_unicode,
        NameObject("/DescendantFonts"): ArrayObject([DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/CIDFontType2"),
            NameObject("/BaseFont"): NameObject("/ABCDEF+Test"),
            NameObject("/DW"): NumberObject(1000),
            NameObject("/W"): ArrayObject([NumberObject(1), ArrayObject([NumberObject(500), NumberObject(600)])]),
        })]),
    })


def test_two_byte_codes():
    content = b"BT /F1 10 Tf 100 100 Td <000100020001> Tj ET"
    pdf = raw_pdf(content, {"/F1": identity_h_font()})
    page = PdfReader(BytesIO(pdf)).pages[0]
    erased, edited = edit(pdf, [cover(page, 105, 100, 6, 10)])  # the B
    assert erased == {"t1:cover"}
    (arr,) = tj_arrays(edited)
    assert [bytes(arr[0]), float(arr[1]), bytes(arr[2])] == [b"\x00\x01", pytest.approx(-600), b"\x00\x01"]


def test_identity_h_encoder_reads_to_unicode():
    font = PdfFont(identity_h_font())
    assert font.encoder() == {"A": b"\x00\x01", "B": b"\x00\x02"}
    assert font.advance(2, 2) == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def vera_line(c):
    c.setFont("Vera", 12)
    c.drawString(20, 300, "Total 1200")
    c.setFont("Helvetica", 12)
    c.drawString(200, 300, "Paid")


def vera_name(pdf):
    fonts = PdfReader(BytesIO(pdf)).pages[0]["/Resources"]["/Font"]
    return next(str(f["/BaseFont"])[1:] for f in fonts.values() if "Vera" in str(f["/BaseFont"]))


def replacement(page, text, pdf_font, width, x=20, y=300):
    view = page_view(page)
    a, b, c, d, e, f = _invert(view.to_user)
    # fabric IText box around user-space baseline-left (x, y): the baseline
    # is 77.8% down a box 1.13 font sizes tall, see FABRIC_BASELINE_RATIO
    h = 12 * 1.13
    ux, uy = x + width / 2, y + h * (1 - 0.222) - h / 2
    return {
        "id": "t1", "type": "text", "page": 1, "content": text,
        "x": a * ux + c * uy + e, "y": b * ux + d * uy + f,
        "width": width, "height": h, "rotation": 0,
        "style": {"font_size": 12, "font_family": "Arial", "color": "#000000", "pdf_font": pdf_font},
    }


def test_export_replaces_text_in_the_original_font():
    pdf = make_pdf(vera_line)
    page = PdfReader(BytesIO(pdf)).pages[0]
    name = vera_name(pdf)
    width = text_width("Total 2100", "Vera")
    out = flatten(pdf, [
        cover(page, 20, 300, text_width("Total 1200", "Vera"), 12),
        replacement(page, "Total 2100", name, width),
    ])

    text = page_text(out)
    assert "1200" not in text
    assert "Total 2100" in text and "Paid" in text
    # Written with the page's own Vera resource, nothing painted, no overlay font
    fonts = out["/Resources"]["/Font"]
    used = {str(operands[0]) for operands, op in ops(out) if op == b"Tf"}
    assert {str(fonts[n]["/BaseFont"])[1:] for n in used} == {name, "Helvetica"}
    assert b"re" not in [op for _, op in ops(out)]


def test_export_falls_back_for_characters_the_subset_lacks():
    pdf = make_pdf(vera_line)
    page = PdfReader(BytesIO(pdf)).pages[0]
    name = vera_name(pdf)
    out = flatten(pdf, [
        cover(page, 20, 300, text_width("Total 1200", "Vera"), 12),
        # reportlab's first Vera subset is plain ASCII: no euro sign
        replacement(page, "Total €1200", name, text_width("Total €1200", "Vera")),
    ])
    assert "Total €1200" in page_text(out)
    fonts = out["/Resources"]["/Font"]
    added = [k for k in fonts if k.startswith("/ScopitH")]
    assert len(added) == 1 and fonts[added[0]]["/BaseFont"] == "/Helvetica"


def test_fallback_font_is_added_once_per_page():
    pdf = make_pdf(vera_line)
    page = PdfReader(BytesIO(pdf)).pages[0]
    name = vera_name(pdf)
    second = replacement(page, "€9", name, text_width("€9", "Vera"), x=200)
    second["id"] = "t2"
    out = flatten(pdf, [
        cover(page, 20, 300, text_width("Total 1200", "Vera"), 12),
        replacement(page, "Total €1200", name, text_width("Total €1200", "Vera")),
        cover(page, 200, 300, text_width("Paid"), 12, "t2:cover"),
        second,
    ])
    assert page_text(out) == "Total €1200 €9"
    assert [k for k in out["/Resources"]["/Font"] if k.startswith("/ScopitH")] == ["/ScopitH1"]


def test_export_without_the_font_burns_text_as_before():
    pdf = make_pdf(table_row)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out = flatten(pdf, [
        cover(page, 20, 300, text_width("Total: $1,200"), 12),
        replacement(page, "Total: $900", "NotOnThisPage", text_width("Total: $900")),
    ])
    text = page_text(out)
    assert "1,200" not in text and "Total: $900" in text


def test_export_keeps_the_reading_order():
    pdf = make_pdf(vera_line)  # "Total 1200" is drawn before "Paid"
    page = PdfReader(BytesIO(pdf)).pages[0]
    out = flatten(pdf, [
        cover(page, 20, 300, text_width("Total 1200", "Vera"), 12),
        replacement(page, "Total 2100", vera_name(pdf), text_width("Total 2100", "Vera")),
    ])
    assert page_text(out) == "Total 2100 Paid"


def test_replacement_in_place_under_a_scaled_flipped_ctm():
    # Like Chrome's output: a y-down CTM, text un-flipped by its Tm
    content = (
        b"q .5 0 0 -.5 0 400 cm BT /F1 24 Tf 1 0 0 -1 40 100 Tm (Total 1200) Tj ET Q "
        b"BT /F1 12 Tf 200 300 Td (Paid) Tj ET"
    )
    pdf = raw_pdf(content, {"/F1": HELVETICA})
    page = PdfReader(BytesIO(pdf)).pages[0]
    # "Total 1200" ends up at user (20, 350), 12pt
    out = flatten(pdf, [
        cover(page, 20, 350, text_width("Total 1200"), 12),
        replacement(page, "Total 2100", "Helvetica", text_width("Total 2100"), y=350),
    ])
    assert page_text(out) == "Total 2100 Paid"

    seen = []

    def visit(text, cm, tm, font, size):
        if text.strip():
            seen.append((text, cm, tm))

    out.extract_text(visitor_text=visit)
    text, cm, tm = next(s for s in seen if "2100" in s[0])
    a, b, c, d, e, f = (float(v) for v in tm)
    ca, cb, cc, cd, ce, cf = (float(v) for v in cm)
    x, y = ca * e + cc * f + ce, cb * e + cd * f + cf
    assert (x, y) == (pytest.approx(20, abs=0.05), pytest.approx(350, abs=0.05))


def test_export_paints_a_cover_that_erased_nothing():
    pdf = make_pdf(table_row)
    page = PdfReader(BytesIO(pdf)).pages[0]
    out = flatten(pdf, [cover(page, 100, 100, 50, 12)])
    assert b"f*" in [op for _, op in ops(out)]


# ---------------------------------------------------------------------------
# Editor preview
# ---------------------------------------------------------------------------

def test_preview_is_one_erased_page():
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setFont("Helvetica", 12)
    c.drawString(20, 300, "Page one words")
    c.linkAbsolute("", "p2", (20, 280, 120, 295))
    c.showPage()
    c.bookmarkPage("p2")
    c.drawString(20, 300, "Page two")
    c.showPage()
    c.save()
    pdf = buf.getvalue()
    page = PdfReader(BytesIO(pdf)).pages[0]

    out, erased = erased_page_pdf(pdf, 1, [cover(page, 20, 300, text_width("Page one"), 12)])
    reader = PdfReader(BytesIO(out))
    assert erased == ["t1:cover"]
    assert len(reader.pages) == 1
    assert page_text(reader.pages[0]) == "words"
    # The link's destination didn't pull page two into the file
    ids = set(reader.xref.get(0, {})) | set(reader.xref_objStm)
    objects = [reader.get_object(i) for i in ids]
    assert sum(isinstance(o, DictionaryObject) and o.get("/Type") == "/Page" for o in objects) == 1


def test_preview_rejects_a_missing_page():
    with pytest.raises(IndexError):
        erased_page_pdf(make_pdf(table_row), 2, [])
