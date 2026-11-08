"""
The design quote: the other format of a kitchen quote, for the customer to
look at, beside the itemized one (CabinetExportService.generate_pdf).

Each section of the work with its price and what it holds, no unit prices or
line notes, under a summary of the kitchen. It carries the same terms, payment
schedule and signature as the itemized quote, and, when the person exporting
asks for them, the kitchen's drawings: the floor plan, the front elevations
and the 3D views. The browser draws those (frontend kitchenDrawings.tsx) and
sends them with the request, so a drawing left out, or one a browser couldn't
draw, simply isn't there.

The itemized quote stays the one that goes to the carrier, and never has
drawings. Here a restoration shows its own drawings and no products.
"""

import io
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .export_service import (
    TERMS_TEXT,
    _group_line_items,
    _merge_install_into_supply,
    payment_phases,
)
from .proposal_pdf import ImageLoader, _esc, member_name, render_picture, selected_products

# What a chosen product says instead of the estimate's own field.
_SET_BY_PRODUCT = {
    "Cabinet tier": "cabinets",
    "Door style": "cabinets",
    "Finish": "cabinets",
    "Countertop": "countertop",
    "Backsplash": "backsplash",
}


def _amount(value: Any, unit: str) -> str:
    return f"{float(value):g} {unit}"


def _cabinet_counts(boxes: List[Dict[str, Any]]) -> str:
    counts = {"base": 0, "wall": 0, "tall": 0, "island": 0}
    for box in boxes:
        kind = (
            "island" if box.get("location") == "island"
            else "base" if box.get("cab_type") == "specialty"
            else box.get("cab_type")
        )
        if kind in counts:
            counts[kind] += box.get("qty") or 0
    return " · ".join(f"{n} {kind}" for kind, n in counts.items() if n)


def kitchen_summary(estimate: Dict[str, Any]) -> List[List[str]]:
    """The kitchen in label and value pairs; only what the estimate has, and a
    chosen product's own words take over from the fields it replaces."""
    rows: List[List[str]] = [
        ["Layout", estimate.get("layout_type")],
        ["Kitchen size", estimate.get("kitchen_size_sqft") and _amount(estimate["kitchen_size_sqft"], "sq ft")],
        ["Cabinets", _cabinet_counts(estimate.get("boxes") or [])],
        ["Cabinet tier", estimate.get("tier")],
        ["Door style", estimate.get("door_style")],
        ["Finish", estimate.get("finish")],
        ["Overlay", estimate.get("overlay_style")],
        ["Box", estimate.get("box_material")],
    ]
    if estimate.get("include_countertop") and estimate.get("countertop_material"):
        sqft = estimate.get("countertop_sqft")
        rows.append(["Countertop", ", ".join(filter(None, [
            estimate["countertop_material"], sqft and _amount(sqft, "sq ft"),
        ]))])
    if estimate.get("include_backsplash") and estimate.get("backsplash_type"):
        sqft = estimate.get("backsplash_sqft")
        rows.append(["Backsplash", ", ".join(filter(None, [
            estimate["backsplash_type"].replace("_", " ").capitalize(), sqft and _amount(sqft, "sq ft"),
        ]))])
    chosen = (estimate.get("selections") or {}) if estimate.get("kind") == "option" else {}
    return [
        [label, str(value)] for label, value in rows
        if value and _SET_BY_PRODUCT.get(label) not in chosen
    ]


def scope_sections(estimate: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Each section of the work: its title, its price, and what it holds in words."""
    sections = _group_line_items(_merge_install_into_supply(estimate.get("line_items") or []))
    return [
        {
            "title": section["title"],
            "total": section["total"],
            "items": [
                f"{li.get('description', '')} · {_amount(li.get('quantity') or 0, li.get('unit') or '')}".strip()
                for li in section["items"]
            ],
        }
        for section in sections
    ]


def _pictures(drawings: Dict[str, Any], key: str, default_label: str, max_w: float, max_h: float) -> List[Any]:
    """The (label, picture) pairs of one kind of drawing; any it can't read are left out."""
    sent = drawings.get(key)
    pairs = [
        (item.get("label") or default_label, render_picture(item.get("image"), max_w, max_h))
        for item in (sent if isinstance(sent, list) else [])
        if isinstance(item, dict)
    ]
    return [(label, picture) for label, picture in pairs if picture is not None]


def generate_design_quote_pdf(
    estimate: Dict[str, Any],
    show_signature: bool = True,
    image_loader: Optional[ImageLoader] = None,
    drawings: Optional[Dict[str, Any]] = None,
) -> io.BytesIO:
    """The design quote of one estimate.

    drawings: base64 pictures from the browser, each part optional -
    {plan, elevations: [{label, image}], views: [{label, image}]}.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        HRFlowable,
        KeepTogether,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    drawings = drawings if isinstance(drawings, dict) else {}
    buffer = io.BytesIO()
    page_w, page_h = letter
    margin = 0.6 * inch
    usable_w = page_w - 2 * margin
    # The page's frame pads its contents, so its edge sits this far outside the margin.
    frame_padding = 6
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=margin - frame_padding,
                            leftMargin=margin - frame_padding, topMargin=margin, bottomMargin=0.8 * inch)

    quote_number = str(estimate.get("id", ""))[:8].upper()
    prop_addr = estimate.get("property_address", "") or ""
    company = estimate.get("company_info") or {}
    total = estimate.get("total") or 0

    brand_dark = colors.HexColor("#1a2332")
    text_grey = colors.HexColor("#4a5568")
    border_grey = colors.HexColor("#e2e8f0")

    def _footer(canvas, doc_ref):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(text_grey)
        canvas.drawCentredString(page_w / 2, 0.45 * inch, f"Page {doc_ref.page}")
        canvas.restoreState()

    def _on_later_pages(canvas, doc_ref):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(text_grey)
        canvas.drawString(margin, page_h - 0.4 * inch, prop_addr[:80])
        canvas.drawRightString(page_w - margin, page_h - 0.4 * inch, f"Quote # {quote_number}")
        canvas.setStrokeColor(border_grey)
        canvas.line(margin, page_h - 0.48 * inch, page_w - margin, page_h - 0.48 * inch)
        canvas.restoreState()
        _footer(canvas, doc_ref)

    company_style = ParagraphStyle("Company", fontSize=8.5, fontName="Helvetica", textColor=text_grey, leading=12)
    label_style = ParagraphStyle("Label", fontSize=7, fontName="Helvetica-Bold", textColor=text_grey, leading=11)
    value_style = ParagraphStyle("Value", fontSize=9.5, fontName="Helvetica", textColor=brand_dark, leading=13)
    heading_style = ParagraphStyle("Heading", fontSize=12, fontName="Helvetica-Bold", textColor=brand_dark,
                                   spaceBefore=16, spaceAfter=8)
    body_style = ParagraphStyle("Body", fontSize=8.5, fontName="Helvetica", textColor=text_grey, leading=12)
    small_style = ParagraphStyle("Small", fontSize=7.5, fontName="Helvetica", textColor=text_grey, leading=10)
    section_style = ParagraphStyle("Section", fontSize=10, fontName="Helvetica-Bold", textColor=brand_dark, leading=14)
    item_style = ParagraphStyle("Item", fontSize=8.5, fontName="Helvetica", textColor=text_grey, leading=12)
    caption_style = ParagraphStyle("Caption", fontSize=9.5, fontName="Helvetica-Bold", textColor=brand_dark,
                                   spaceBefore=4, spaceAfter=4)

    elements: List[Any] = []

    # ══════ LETTERHEAD: the company, and the quote's number and dates ══════
    lines = []
    if company.get("name"):
        lines.append(f"<font size=11 color='#1a2332'><b>{_esc(company['name'])}</b></font>")
    place = ", ".join(filter(None, [company.get("city"), company.get("state"), company.get("zipcode")]))
    address = ", ".join(filter(None, [company.get("address"), place]))
    if address:
        lines.append(_esc(address))
    contact = " | ".join(filter(None, [company.get("phone"), company.get("email")]))
    if contact:
        lines.append(_esc(contact))
    if company.get("license_number"):
        lines.append(f"License #: {_esc(company['license_number'])}")
    date = datetime.now()
    valid_until = date + timedelta(days=30)
    quote_cell = Paragraph(
        f"Quote # {quote_number}<br/>{date.strftime('%B %d, %Y')}<br/>Valid until {valid_until.strftime('%B %d, %Y')}",
        ParagraphStyle("QuoteLines", parent=company_style, alignment=2),
    )
    logo = render_picture(company.get("logo"), 1.3 * inch, 0.75 * inch)
    text = Paragraph("<br/>".join(lines), company_style) if lines else ""
    quote_w = usable_w * 0.32
    logo_w = 1.45 * inch if logo else 0
    letterhead = Table(
        [[logo, text, quote_cell] if logo else [text, quote_cell]],
        colWidths=[logo_w, usable_w - logo_w - quote_w, quote_w] if logo else [usable_w - quote_w, quote_w],
    )
    letterhead.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements += [letterhead, Spacer(1, 22)]

    # ══════ TITLE ══════
    elements.append(Paragraph("Kitchen Cabinet Quote", ParagraphStyle(
        "QuoteTitle", fontSize=24, fontName="Helvetica-Bold", textColor=brand_dark, leading=29)))
    if estimate.get("kind") == "option":
        elements.append(Paragraph(_esc(member_name(estimate)), ParagraphStyle(
            "QuoteOption", fontSize=12, fontName="Helvetica", textColor=text_grey, leading=16)))
    elements += [Spacer(1, 8), HRFlowable(width="100%", thickness=1, color=brand_dark), Spacer(1, 10)]

    # ══════ WHO, WHERE, HOW MUCH ══════
    client = [f"{_esc(estimate.get('client_name') or '—')}"]
    if estimate.get("claim_number"):
        client.append(f"Claim #: {_esc(estimate['claim_number'])}")
    who = Table([
        [Paragraph("PREPARED FOR", label_style), Paragraph("PROPERTY", label_style),
         Paragraph("TOTAL", ParagraphStyle("TotalLabel", parent=label_style, alignment=2))],
        [Paragraph("<br/>".join(client), value_style),
         Paragraph(_esc(prop_addr) or "—", value_style),
         Paragraph(f"${total:,.2f}", ParagraphStyle(
             "TotalValue", fontSize=16, fontName="Helvetica-Bold", textColor=brand_dark, leading=20, alignment=2))],
    ], colWidths=[usable_w * 0.3, usable_w * 0.42, usable_w * 0.28])
    who.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    elements.append(who)

    # ══════ HOW IT WILL LOOK ══════
    views = _pictures(drawings, "views", "3D view", usable_w, 4.2 * inch)
    if views:
        elements += [Spacer(1, 14), views[0][1]]

    # ══════ THE KITCHEN ══════
    if estimate.get("overview_text"):
        elements += [Spacer(1, 12), Paragraph(_esc(estimate["overview_text"]), body_style)]
    summary = kitchen_summary(estimate)
    if summary:
        cells = [[Paragraph(label.upper(), label_style), Paragraph(_esc(value), value_style)]
                 for label, value in summary]
        rows = [cells[i] + (cells[i + 1] if i + 1 < len(cells) else ["", ""]) for i in range(0, len(cells), 2)]
        summary_table = Table(rows, colWidths=[usable_w * 0.15, usable_w * 0.35, usable_w * 0.15, usable_w * 0.35])
        summary_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, border_grey),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(KeepTogether([Paragraph("Your Kitchen", heading_style), summary_table]))

    # ══════ AN OPTION'S PRODUCTS ══════
    elements.extend(selected_products(estimate, usable_w, image_loader, heading_style, value_style, small_style))

    # ══════ SCOPE OF WORK ══════
    scope_rows: List[List[Any]] = [
        [
            [Paragraph(_esc(section["title"]), section_style),
             Paragraph("<br/>".join(_esc(item) for item in section["items"]), item_style)],
            Paragraph(f"${section['total']:,.2f}", ParagraphStyle("SectionPrice", parent=section_style, alignment=2)),
        ]
        for section in scope_sections(estimate)
    ]
    total_style = ParagraphStyle("ScopeTotal", parent=section_style, fontSize=12, leading=16)
    scope_rows.append([
        Paragraph("Total", total_style),
        Paragraph(f"${total:,.2f}", ParagraphStyle("ScopeTotalPrice", parent=total_style, alignment=2)),
    ])
    scope_table = Table(scope_rows, colWidths=[usable_w * 0.76, usable_w * 0.24])
    scope_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEABOVE", (0, 0), (-1, 0), 1, brand_dark),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, border_grey),
        ("LINEABOVE", (0, -1), (-1, -1), 1, brand_dark),
    ]))
    elements += [Paragraph("Scope of Work", heading_style), scope_table]

    # ══════ DRAWINGS ══════
    plan = render_picture(drawings.get("plan"), usable_w, 7.6 * inch)
    elevations = _pictures(drawings, "elevations", "Front elevation", usable_w, 4 * inch)
    if plan is not None:
        elements.append(KeepTogether([
            Paragraph("Floor Plan", heading_style),
            plan,
            Spacer(1, 6),
            Paragraph(
                "Solid shapes are base and tall cabinets, dashed shapes wall cabinets; grey shapes are "
                "appliances (D&amp;R: detached and reset). Each grid square is 1 ft.", small_style),
        ]))
    for heading, pictures in (("Front Elevations", elevations), ("3D Views", views[1:])):
        for i, (label, picture) in enumerate(pictures):
            block = [Paragraph(_esc(label), caption_style), picture, Spacer(1, 6)]
            if i == 0:
                block.insert(0, Paragraph(heading, heading_style))
            elements.append(KeepTogether(block))
    if plan is not None or elevations or views:
        elements += [Spacer(1, 4), Paragraph(
            "Drawings show the planned layout for reference and are not to scale as printed. "
            "3D views are illustrations; actual materials and colors may vary.", small_style)]

    # ══════ TERMS, PAYMENT, SIGNATURE ══════
    elements.append(Paragraph("Terms &amp; Conditions", heading_style))
    elements.append(Paragraph(TERMS_TEXT, body_style))

    payment = [["Phase", "%", "Amount", "Due"]]
    for phase in payment_phases(total, estimate.get("zip_code")):
        payment.append([phase["phase"], f"{phase['pct'] * 100:.0f}%", f"${phase['amount']:,.2f}", phase["due"]])
    payment.append(["Total", "100%", f"${total:,.2f}", ""])
    payment_table = Table(payment, colWidths=[usable_w * 0.24, usable_w * 0.09, usable_w * 0.2, usable_w * 0.47])
    payment_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
        ("TEXTCOLOR", (0, 0), (-1, 0), text_grey),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (2, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, border_grey),
        ("LINEABOVE", (0, -1), (-1, -1), 1, brand_dark),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(KeepTogether([Paragraph("Payment Schedule", heading_style), payment_table]))

    if show_signature:
        line = "_" * 45
        signature = [
            [Paragraph("<b>ACCEPTED BY:</b>", small_style), "", Paragraph("<b>AUTHORIZED BY:</b>", small_style), ""],
            *[
                [Paragraph(f"{field}: {line}", small_style), "", Paragraph(f"{field}: {line}", small_style), ""]
                for field in ("Signature", "Name", "Date")
            ],
        ]
        signature_table = Table(signature, colWidths=[usable_w * 0.45, usable_w * 0.05, usable_w * 0.45, usable_w * 0.05])
        signature_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(KeepTogether([Spacer(1, 20), signature_table]))

    doc.build(elements, onFirstPage=_footer, onLaterPages=_on_later_pages)
    buffer.seek(0)
    return buffer
