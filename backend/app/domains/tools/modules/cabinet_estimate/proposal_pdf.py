"""
Kitchen job PDFs for the customer: an option's products, and the proposal
that lays out the whole job.

- selected_products(): the "Selected Products" block of an option's own
  PDF - each product's picture, name, where it's sold and its price there.
- generate_proposal_pdf(): the restoration (on an insurance job) and each
  option side by side, what each option costs over the restoration, its
  products, its 3D view when the browser sent one, and the items that make
  the difference.

Neither ever goes to the carrier: the restoration's own PDF is the one the
insurance company gets, and it never mentions an option.
"""

import base64
import io
import logging
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from .selections import SLOTS, product_name

logger = logging.getLogger(__name__)

ImageLoader = Callable[[Optional[str]], Optional[bytes]]

_UNIT_SHORT = {"each": "ea", "sf": "sq ft", "box": "box", "lf": "lin ft"}
_RETAILERS = {
    "home_depot": "The Home Depot", "lowes": "Lowe's", "wayfair": "Wayfair",
    "amazon": "Amazon", "floor_decor": "Floor & Decor", "build_com": "Build.com",
    "ferguson": "Ferguson", "ikea": "IKEA",
}


def member_name(member: Dict[str, Any]) -> str:
    if member.get("kind") == "restore":
        return "Restoration"
    return member.get("option_label") or "Option"


def _esc(text: Any) -> str:
    return (str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _fit(data: Optional[bytes], max_w: float, max_h: float):
    """Image bytes as a flowable fitted in max_w × max_h, or None."""
    if not data:
        return None
    try:
        from reportlab.platypus import Image
        img = Image(io.BytesIO(data))
        w, h = img.drawWidth, img.drawHeight
        if w <= 0 or h <= 0:
            return None
        scale = min(max_w / w, max_h / h)
        img.drawWidth, img.drawHeight = w * scale, h * scale
        img.hAlign = "CENTER"
        return img
    except Exception as e:
        logger.warning("Picture not embedded in the kitchen PDF: %s", e)
        return None


def render_picture(image_base64: Optional[str], max_w: float, max_h: float):
    """A base64 image (the 3D view, rendered in the browser) fitted in max_w × max_h, or None."""
    if not image_base64:
        return None
    try:
        return _fit(base64.b64decode(image_base64.split(",", 1)[-1]), max_w, max_h)
    except Exception as e:
        logger.warning("3D view not embedded in the kitchen PDF: %s", e)
        return None


def _price_text(product: Dict[str, Any]) -> str:
    try:
        price = float(product.get("price"))
    except (TypeError, ValueError):
        return ""
    unit = product.get("price_unit") or "each"
    box = f" ({float(product['box_sf']):g} sq ft)" if unit == "box" and product.get("box_sf") else ""
    return f"${price:,.2f} / {_UNIT_SHORT.get(unit, unit)}{box}"


def selected_products(
    estimate: Dict[str, Any],
    usable_w: float,
    image_loader: Optional[ImageLoader],
    title_style,
    cell_style,
    small_style,
) -> List[Any]:
    """The "Selected Products" block of an option's PDF; [] for a restoration or none chosen."""
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    if estimate.get("kind") != "option":
        return []
    chosen = estimate.get("selections") or {}
    rows = []
    pic_w = 0.85 * 72
    for slot in SLOTS:
        product = chosen.get(slot["key"])
        if not isinstance(product, dict):
            continue
        ids = product.get("image_file_ids") or []
        pic = _fit(image_loader(ids[0]) if image_loader and ids else None, pic_w, pic_w)
        lines = [f"<font size=7 color='#4a5568'>{slot['label'].upper()}</font>",
                 f"<b>{_esc(product_name(product))}</b>"]
        where = []
        retailer = _RETAILERS.get(product.get("retailer") or "")
        if retailer:
            where.append(retailer)
        ident = product.get("model_number") or product.get("sku")
        if ident:
            where.append(f"#{_esc(ident)}")
        if product.get("source_url"):
            where.append(f"<link href='{_esc(product['source_url'])}' color='#2c5282'>View product</link>")
        if where:
            lines.append(f"<font size=8 color='#4a5568'>{' · '.join(where)}</font>")
        rows.append([pic or "", Paragraph("<br/>".join(lines), cell_style),
                     Paragraph(_price_text(product), cell_style)])
    if not rows:
        return []
    table = Table(rows, colWidths=[pic_w + 10, usable_w * 0.62, usable_w - pic_w - 10 - usable_w * 0.62])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return [
        Paragraph("<b>Selected Products</b>", title_style),
        table,
        Paragraph("Prices are the retailer's at the time this was written; the line items carry them "
                  "with our handling and installation.", small_style),
    ]


def _company_cell(estimate: Dict[str, Any], style):
    from reportlab.platypus import Paragraph, Spacer

    company = estimate.get("company_info") or {}
    parts = []
    if company.get("name"):
        parts.append(f"<b>{_esc(company['name'])}</b>")
    if company.get("address"):
        addr = company["address"]
        city_state = ", ".join(filter(None, [company.get("city"), company.get("state"), company.get("zipcode")]))
        parts.append(_esc(f"{addr}, {city_state}" if city_state else addr))
    contact = [c for c in (company.get("phone"), company.get("email")) if c]
    if contact:
        parts.append(_esc(" | ".join(contact)))
    if company.get("license_number"):
        parts.append(f"License #: {_esc(company['license_number'])}")
    return Paragraph("<br/>".join(parts), style) if parts else Spacer(1, 1)


def line_item_changes(base: Dict[str, Any], option: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Line items that differ between two estimates, matched by location and description.

    One that only one estimate has comes out with 0 on the other side.
    """
    def by_key(est):
        items: Dict[tuple, float] = {}
        for li in est.get("line_items") or []:
            key = (li.get("location") or "perimeter", li.get("description", ""))
            items[key] = items.get(key, 0) + (li.get("total") or 0)
        return items

    before, after = by_key(base), by_key(option)
    changes = []
    for key in sorted(set(before) | set(after), key=lambda k: (k[0], k[1])):
        was, now = before.get(key, 0), after.get(key, 0)
        if round(now - was, 2) != 0:
            changes.append({
                "location": key[0], "description": key[1],
                "base": was, "option": now, "difference": round(now - was, 2),
            })
    return changes


def generate_proposal_pdf(
    group: Dict[str, Any],
    show_signature: bool = True,
    renders: Optional[Dict[str, str]] = None,
    image_loader: Optional[ImageLoader] = None,
) -> io.BytesIO:
    """The customer's side-by-side of a kitchen job's estimates.

    Insurance job: the restoration, then each option with what it costs over
    the restoration, its products and the items that make that difference.
    Remodel job: the options and their prices. For the customer only.

    renders: each estimate's 3D view by id, rendered in the browser.
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

    members = [m for m in group.get("members") or [] if m.get("kind") in ("restore", "option")]
    if not members:
        raise ValueError("This job has no estimates to compare")
    insurance = group.get("project_type") == "insurance"
    restoration = next((m for m in members if m.get("kind") == "restore"), None)
    options = [m for m in members if m.get("kind") == "option"]
    first = members[0]
    compare_to_restoration = insurance and restoration is not None

    buffer = io.BytesIO()
    page_w, page_h = letter
    margin = 0.6 * inch
    usable_w = page_w - 2 * margin
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=margin, leftMargin=margin,
                            topMargin=margin, bottomMargin=0.8 * inch)
    prop_addr = first.get("property_address", "") or ""

    def _on_later_pages(canvas, doc_ref):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#4a5568"))
        canvas.drawString(margin, page_h - 0.4 * inch, "Kitchen Options")
        canvas.drawRightString(page_w - margin, page_h - 0.4 * inch, prop_addr[:60])
        canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
        canvas.line(margin, page_h - 0.48 * inch, page_w - margin, page_h - 0.48 * inch)
        canvas.drawCentredString(page_w / 2, 0.45 * inch, f"Page {doc_ref.page}")
        canvas.restoreState()

    def _on_first_page(canvas, doc_ref):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#4a5568"))
        canvas.drawCentredString(page_w / 2, 0.45 * inch, f"Page {doc_ref.page}")
        canvas.restoreState()

    brand_dark = colors.HexColor("#1a2332")
    brand_accent = colors.HexColor("#2c5282")
    text_grey = colors.HexColor("#4a5568")
    border_grey = colors.HexColor("#e2e8f0")
    section_bg = colors.HexColor("#edf2f7")
    company_info_style = ParagraphStyle("CompanyInfo", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13)
    section_title_style = ParagraphStyle("SectionTitle", fontSize=11, fontName="Helvetica-Bold", textColor=brand_dark, spaceBefore=14, spaceAfter=8)
    normal = ParagraphStyle("NormalCustom", fontSize=10, fontName="Helvetica", textColor=brand_dark)
    small_grey = ParagraphStyle("SmallGrey", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=11)
    body_style = ParagraphStyle("Body", fontSize=9.5, fontName="Helvetica", textColor=text_grey, leading=14)
    cell_style = ParagraphStyle("Cell", fontSize=9, fontName="Helvetica", textColor=brand_dark, leading=11)

    def money(v: float) -> str:
        return f"${v:,.2f}"

    def signed(v: float) -> str:
        return f"+{money(v)}" if v >= 0 else f"-{money(-v)}"

    def over(m: Dict[str, Any]) -> float:
        return (m.get("total") or 0) - (restoration.get("total") or 0)

    def table_style(extra=()):
        return TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BACKGROUND", (0, 0), (-1, 0), section_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, border_grey),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            *extra,
        ])

    elements: List[Any] = []

    # ══════ HEADER ══════
    est_date = datetime.now()
    valid_until = est_date + timedelta(days=30)
    right_cell = Paragraph(
        f"<b>KITCHEN OPTIONS</b><br/>"
        f"Date: {est_date.strftime('%m/%d/%Y')}<br/>"
        f"Valid Through: {valid_until.strftime('%m/%d/%Y')}",
        ParagraphStyle("RightHeader", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, alignment=2),
    )
    header_table = Table([[_company_cell(first, company_info_style), right_cell]],
                         colWidths=[usable_w * 0.55, usable_w * 0.45])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements += [header_table, Spacer(1, 12),
                 HRFlowable(width="100%", thickness=1.5, color=brand_accent), Spacer(1, 12)]

    # ══════ PROJECT INFO ══════
    address = ", ".join(filter(None, [prop_addr, first.get("zip_code")]))
    info_data = [["Property:", address or "—"]]
    if first.get("client_name"):
        info_data.append(["Client:", first["client_name"]])
    if insurance and first.get("claim_number"):
        info_data.append(["Claim #:", first["claim_number"]])
    info_table = Table(info_data, colWidths=[usable_w * 0.14, usable_w * 0.86])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements += [info_table, Spacer(1, 6)]

    # ══════ SUMMARY ══════
    elements.append(Paragraph("Your Options", section_title_style))
    if compare_to_restoration:
        elements.append(Paragraph(
            "The restoration returns the kitchen to its condition before the loss. Each option is "
            "priced in full; the last column is what it costs over the restoration.", body_style))
    else:
        elements.append(Paragraph("Each option is priced in full.", body_style))
    elements.append(Spacer(1, 8))
    summary = [["", "Total", "Over restoration"] if compare_to_restoration else ["", "Total"]]
    for m in members:
        row = [member_name(m) + (" (pre-loss condition)" if m.get("kind") == "restore" else ""),
               money(m.get("total") or 0)]
        if compare_to_restoration:
            row.append("—" if m is restoration else signed(over(m)))
        summary.append(row)
    widths = ([usable_w * 0.50, usable_w * 0.25, usable_w * 0.25] if compare_to_restoration
              else [usable_w * 0.65, usable_w * 0.35])
    summary_table = Table(summary, colWidths=widths)
    summary_table.setStyle(table_style([("FONTSIZE", (0, 1), (-1, -1), 10)]))
    elements.append(summary_table)

    # ══════ HOW EACH LOOKS: the 3D views, two to a row ══════
    renders = renders or {}
    cell_w = (usable_w - 12) / 2
    pictured = [(m, render_picture(renders.get(str(m.get("id"))), cell_w - 8, 2.6 * inch)) for m in members]
    pictured = [(m, img) for m, img in pictured if img is not None]
    if pictured:
        caption_style = ParagraphStyle("Caption", fontSize=9, fontName="Helvetica", textColor=brand_dark,
                                       alignment=1, spaceBefore=4)
        cells = []
        for m, img in pictured:
            caption = f"<b>{_esc(member_name(m))}</b> &nbsp; {money(m.get('total') or 0)}"
            if compare_to_restoration and m is not restoration:
                caption += f" ({signed(over(m))})"
            cells.append([img, Paragraph(caption, caption_style)])
        for i in range(0, len(cells), 2):
            row = cells[i:i + 2] + [""] * (2 - len(cells[i:i + 2]))
            grid = Table([row], colWidths=[cell_w + 6, cell_w + 6])
            grid.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]))
            elements.append(KeepTogether([Paragraph("How Each Looks", section_title_style), grid]) if i == 0 else grid)

    # ══════ EACH OPTION: its products, and what changes ══════
    max_rows = 30
    for option in options:
        name = member_name(option)
        block: List[Any] = [Paragraph(_esc(name), ParagraphStyle(
            "OptionTitle", parent=section_title_style, fontSize=13, spaceBefore=18))]
        products = selected_products(option, usable_w, image_loader, section_title_style, cell_style, small_grey)
        if products:
            block += products[1:2]  # the table, under the option's own title
            block.append(Spacer(1, 6))
        if compare_to_restoration:
            changes = line_item_changes(restoration, option)
            if not changes:
                block.append(Paragraph("Same scope and price as the restoration.", body_style))
            else:
                rows = [["What changes from the restoration", "Restoration", name, "Difference"]]
                for c in changes[:max_rows]:
                    label = ("Island: " if c["location"] == "island" else "") + c["description"]
                    rows.append([
                        Paragraph(_esc(label), cell_style),
                        money(c["base"]) if c["base"] else "—",
                        money(c["option"]) if c["option"] else "—",
                        signed(c["difference"]),
                    ])
                rows.append(["Total difference (with overhead and profit)", "", "", signed(over(option))])
                change_table = Table(rows, colWidths=[usable_w * 0.49, usable_w * 0.17, usable_w * 0.17,
                                                      usable_w * 0.17], repeatRows=1)
                change_table.setStyle(table_style([
                    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                    ("LINEABOVE", (0, -1), (-1, -1), 1, brand_accent),
                ]))
                block.append(change_table)
                if len(changes) > max_rows:
                    block += [Spacer(1, 4), Paragraph(
                        f"…and {len(changes) - max_rows} more changed items; the {_esc(name)} "
                        f"estimate lists every item.", small_grey)]
        else:
            block.append(Paragraph(f"Total: <b>{money(option.get('total') or 0)}</b>", body_style))
        elements += block

    # ══════ SELECTION ══════
    elements.append(Spacer(1, 12))
    elements.append(Paragraph("Selection", section_title_style))
    elements.append(Paragraph(
        "&nbsp;&nbsp;&nbsp;&nbsp;".join(f"[&nbsp;&nbsp;] {_esc(member_name(m))}" for m in members), normal))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        "Each option's full estimate, with every line item, is available on request. Product prices "
        "are the retailers' when this was written and may change.", small_grey))
    if show_signature:
        elements.append(Spacer(1, 14))
        sig_data = [
            [Paragraph("<b>Accepted By:</b>", normal), "", Paragraph("<b>Date:</b>", normal), ""],
            ["_" * 40, "", "_" * 25, ""],
            [Paragraph("Customer Signature", small_grey), "", Paragraph("Date", small_grey), ""],
        ]
        sig_table = Table(sig_data, colWidths=[usable_w * 0.45, usable_w * 0.05, usable_w * 0.30, usable_w * 0.20])
        sig_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        elements.append(sig_table)

    doc.build(elements, onFirstPage=_on_first_page, onLaterPages=_on_later_pages)
    buffer.seek(0)
    return buffer
