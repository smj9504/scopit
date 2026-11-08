"""
Bathroom Estimate export service - PDF generation.
Follows the 7-Phase structure from the reference doc.
"""

import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class _NumberedCanvas:
    """Mixin-style canvas that tracks total page count.

    Usage: pass the *class* returned by make_numbered_canvas()
    as the ``canvasmaker`` arg to doc.build().
    """

    @staticmethod
    def make(on_first, on_later, page_w, margin):
        """Return a Canvas subclass wired to the callbacks."""
        from reportlab.pdfgen.canvas import Canvas

        class NC(Canvas):
            _first_cb = on_first
            _later_cb = on_later
            _pw = page_w
            _mg = margin

            def __init__(self, *args, **kwargs):
                Canvas.__init__(self, *args, **kwargs)
                self._saved_pages = []

            def showPage(self):
                self._saved_pages.append(dict(self.__dict__))
                self._startPage()  # reset for next page without committing current

            def save(self):
                total = len(self._saved_pages)
                for idx, state in enumerate(self._saved_pages):
                    self.__dict__.update(state)
                    self._draw_footer(idx + 1, total)
                    Canvas.showPage(self)
                Canvas.save(self)

            def _draw_footer(self, pg, total):
                from reportlab.lib import colors as c
                self.saveState()
                self.setFont("Helvetica", 7.5)
                self.setFillColor(c.HexColor("#4a5568"))
                self.drawCentredString(
                    self._pw / 2, 0.4 * 72,
                    f"Page {pg} / {total}",
                )
                self.restoreState()

        return NC

# Phase labels for grouping line items
PHASE_LABELS = {
    1: "Demo & Disposal",
    2: "Rough Trades (Plumbing & Electrical)",
    3: "Substrate & Waterproofing",
    4: "Tile & Flooring",
    5: "Fixtures Install",
    6: "Finish (Paint & Trim)",
    7: "Punch / Cleanup / Accessories",
}


def _group_line_items_by_phase(line_items: List[Dict]) -> List[Dict]:
    """Group line items by phase number."""
    sections = []
    for phase_num in sorted(PHASE_LABELS.keys()):
        items = [li for li in line_items if li.get("phase") == phase_num]
        if items:
            total = sum(li.get("total", 0) for li in items)
            sections.append({
                "phase": phase_num,
                "title": f"Phase {phase_num}: {PHASE_LABELS[phase_num]}",
                "items": items,
                "total": total,
            })
    return sections


def _company_cell(estimate: Dict[str, Any], style):
    """The company block at the top left of a bathroom PDF."""
    from reportlab.platypus import Paragraph, Spacer

    company = estimate.get("company_info") or {}
    company_parts = []
    if company.get("name"):
        company_parts.append(f"<b>{company['name']}</b>")
    if company.get("address"):
        addr = company["address"]
        city_state = ", ".join(filter(None, [company.get("city"), company.get("state"), company.get("zipcode")]))
        if city_state:
            addr += f", {city_state}"
        company_parts.append(addr)
    contact = []
    if company.get("phone"):
        contact.append(company["phone"])
    if company.get("email"):
        contact.append(company["email"])
    if contact:
        company_parts.append(" | ".join(contact))
    if company.get("license_number"):
        company_parts.append(f"License #: {company['license_number']}")

    return Paragraph("<br/>".join(company_parts), style) if company_parts else Spacer(1, 1)


def _full_address(estimate: Dict[str, Any]) -> str:
    """Street, city, state zip."""
    full_addr_parts = [estimate.get("property_address", "") or ""]
    city_state_zip = ", ".join(filter(None, [
        estimate.get("city", ""),
        estimate.get("state", ""),
    ]))
    if estimate.get("zip_code"):
        city_state_zip += f" {estimate['zip_code']}" if city_state_zip else estimate['zip_code']
    if city_state_zip:
        full_addr_parts.append(city_state_zip)
    return ", ".join(filter(None, full_addr_parts))


def _picture(image_base64: Optional[str], max_w: float, max_h: float):
    """A base64 image (the 3D view, rendered in the browser) fitted in max_w × max_h, or None."""
    if not image_base64:
        return None
    import base64
    try:
        return _picture_bytes(base64.b64decode(image_base64), max_w, max_h)
    except Exception as e:
        logger.warning(f"Failed to embed 3D view in PDF: {e}")
        return None


def _picture_bytes(data: Optional[bytes], max_w: float, max_h: float):
    """An image's bytes fitted in max_w × max_h, or None if it can't be read."""
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
        logger.warning(f"Failed to embed a picture in PDF: {e}")
        return None


_PRICE_UNITS = {"each": "each", "sf": "per sq ft", "box": "per box", "lf": "per linear ft"}


def _products_table(
    selections: Optional[Dict[str, Any]],
    pictures: Optional[Dict[str, bytes]],
    width: float,
    thumb: float,
):
    """An option's picked products, for its customer: picture, what and whose it
    is, where it's sold (a link), and its price as sold. None when it has none."""
    from xml.sax.saxutils import escape

    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle

    from app.domains.product_library.catalog import RETAILERS

    from .selections import SLOTS

    dark, grey = "#1a2332", "#4a5568"
    text_style = ParagraphStyle("Product", fontSize=8.5, fontName="Helvetica", textColor=colors.HexColor(dark), leading=11)
    price_style = ParagraphStyle("ProductPrice", parent=text_style, alignment=2)
    rows = []
    for slot, meta in SLOTS.items():
        p = (selections or {}).get(slot)
        if not isinstance(p, dict) or not p.get("title"):
            continue
        image_ids = p.get("image_file_ids") or []
        picture = _picture_bytes((pictures or {}).get(image_ids[0]) if image_ids else None, thumb, thumb) or ""
        size = " × ".join(f'{float(p[k]):g}"' for k in ("width_in", "depth_in", "height_in") if p.get(k))
        details = " · ".join(escape(str(v)) for v in (p.get("brand"), p.get("finish"), p.get("model_number"), size) if v)
        lines = [
            f'<font size="6.5" color="{grey}">{escape(meta["label"].upper())}</font>',
            f"<b>{escape(p['title'])}</b>",
        ]
        if details:
            lines.append(f'<font color="{grey}">{details}</font>')
        if p.get("source_url"):
            seller = escape(str(RETAILERS.get(p.get("retailer") or "other", {}).get("label", "Listing")))
            lines.append(f'<link href="{escape(p["source_url"])}" color="#2c5282">{seller}</link>')
        price = ""
        if p.get("price") not in (None, ""):
            unit = _PRICE_UNITS.get(p.get("price_unit") or "each", p.get("price_unit") or "")
            price = f"${float(p['price']):,.2f} {unit}"
            if p.get("price_unit") == "box" and p.get("box_sf"):
                price += f'<br/><font color="{grey}">{float(p["box_sf"]):g} sq ft a box</font>'
            if slot == "vanity" and p.get("includes_top"):
                price += f'<br/><font color="{grey}">top included</font>'
        rows.append([picture, Paragraph("<br/>".join(lines), text_style), Paragraph(price, price_style)])
    if not rows:
        return None
    price_w = 1.25 * 72
    table = Table(rows, colWidths=[thumb + 10, width - thumb - 10 - price_w, price_w])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
    ]))
    return table


def _member_name(member: Dict[str, Any]) -> str:
    if member.get("kind") == "restore":
        return "Restoration"
    return member.get("option_label") or "Option"


def _line_item_changes(base: Dict[str, Any], option: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Line items that differ between two estimates, matched by phase and description.

    One that only one estimate has comes out with 0 on the other side.
    """
    def by_key(est):
        items: Dict[tuple, float] = {}
        for li in est.get("line_items") or []:
            key = (li.get("phase"), li.get("description", ""))
            items[key] = items.get(key, 0) + (li.get("total") or 0)
        return items

    before, after = by_key(base), by_key(option)
    changes = []
    for key in sorted(set(before) | set(after), key=lambda k: (k[0] or 0, k[1])):
        was, now = before.get(key, 0), after.get(key, 0)
        if round(now - was, 2) != 0:
            changes.append({
                "phase": key[0], "description": key[1],
                "base": was, "option": now, "difference": round(now - was, 2),
            })
    return changes


def _filter_notes_prices(notes: Optional[str], show_prices: bool) -> Optional[str]:
    """Filter dollar amounts from notes if show_prices is False.

    Keeps area/dimension info (SF, LF, IN, %, waste) but removes $xxx.xx amounts.
    """
    import re
    if not notes or show_prices:
        return notes
    # Remove standalone dollar amounts like "$700.00" or "$1,234.56"
    filtered = re.sub(r'\s*\$[\d,]+\.?\d*', '', notes)
    # Clean up leftover artifacts: empty labels like "Cabinet: " or double separators
    filtered = re.sub(r':\s*(?=\||$)', '', filtered)
    filtered = re.sub(r'\|\s*\|', '|', filtered)
    filtered = re.sub(r'^\s*\|\s*', '', filtered)
    filtered = re.sub(r'\s*\|\s*$', '', filtered)
    filtered = re.sub(r'\s{2,}', ' ', filtered)
    return filtered.strip() or None


class BathroomExportService:
    """Generates PDF estimates for bathroom remodels."""

    def generate_pdf(
        self,
        estimate: Dict[str, Any],
        show_signature: bool = True,
        sketch_image_base64: Optional[str] = None,
        show_breakdown_prices: bool = True,
        render_image_base64: Optional[str] = None,
        product_pictures: Optional[Dict[str, bytes]] = None,
    ) -> io.BytesIO:
        """Generate a professional PDF estimate.

        render_image_base64: the 3D view, shown on an option's PDF, as are the
        products it's built from (product_pictures: their pictures by file
        id). The restoration's PDF (the carrier's) is left as it is.
        """
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable,
            KeepInFrame,
            KeepTogether,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )

        buffer = io.BytesIO()
        page_w, page_h = letter
        margin = 0.6 * inch

        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            rightMargin=margin, leftMargin=margin,
            topMargin=margin, bottomMargin=0.8 * inch,
        )

        usable_w = page_w - 2 * margin
        est_id_short = str(estimate.get("id", ""))[:8].upper()
        prop_addr = estimate.get("property_address", "") or ""

        def _on_later_pages(canvas, doc_ref):
            """Header on pages 2+ (footer handled by NumberedCanvas)."""
            canvas.saveState()
            grey = colors.HexColor("#4a5568")
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(grey)
            canvas.drawString(
                margin, page_h - 0.4 * inch,
                f"Quote #: {est_id_short}"
            )
            canvas.drawRightString(
                page_w - margin, page_h - 0.4 * inch,
                prop_addr[:60]
            )
            canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
            canvas.line(
                margin, page_h - 0.48 * inch,
                page_w - margin, page_h - 0.48 * inch
            )
            canvas.restoreState()

        def _on_first_page(canvas, doc_ref):
            """No header on page 1 (footer handled by NumberedCanvas)."""
            pass

        # Colors
        brand_dark = colors.HexColor("#1a2332")
        brand_accent = colors.HexColor("#2c5282")
        text_grey = colors.HexColor("#4a5568")
        border_grey = colors.HexColor("#e2e8f0")
        section_bg = colors.HexColor("#edf2f7")

        # Styles
        company_info_style = ParagraphStyle("CompanyInfo", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13)
        section_title_style = ParagraphStyle("SectionTitle", fontSize=11, fontName="Helvetica-Bold", textColor=brand_dark, spaceBefore=14, spaceAfter=10)
        normal = ParagraphStyle("NormalCustom", fontSize=10, fontName="Helvetica", textColor=brand_dark)
        small_grey = ParagraphStyle("SmallGrey", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=11)
        terms_style = ParagraphStyle("Terms", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, spaceBefore=2)

        elements = []

        # ══════ HEADER ══════
        company_cell = _company_cell(estimate, company_info_style)

        est_date = datetime.now()
        valid_until = est_date + timedelta(days=30)
        # An option says which one it is; the restoration's header stays as
        # it always was, since that's the PDF the carrier gets.
        option_line = (
            f"{estimate.get('option_label') or 'Option'}<br/>"
            if estimate.get("kind") == "option" else ""
        )
        right_text = (
            f"<b>ESTIMATE</b><br/>"
            f"{option_line}"
            f"Quote #: {est_id_short}<br/>"
            f"Date: {est_date.strftime('%m/%d/%Y')}<br/>"
            f"Valid Through: {valid_until.strftime('%m/%d/%Y')}"
        )
        right_cell = Paragraph(right_text, ParagraphStyle("RightHeader", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, alignment=2))

        header_table = Table([[company_cell, right_cell]], colWidths=[usable_w * 0.55, usable_w * 0.45])
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 12))
        elements.append(HRFlowable(width="100%", thickness=1.5, color=brand_accent))
        elements.append(Spacer(1, 12))

        # ══════ PROJECT INFO ══════
        designation = (estimate.get("designation") or "").replace("_", " ").title()
        bath_fn = (estimate.get("bath_function") or "").replace("_", " ").title()
        client_name = estimate.get("client_name", "") or ""
        full_address = _full_address(estimate)

        # Use full-width rows for long values, 2-col for short pairs
        info_data = []

        # Property address (full width)
        info_data.append(["Property:", full_address])

        # Client (full width, skip if empty)
        if client_name:
            info_data.append(["Client:", client_name])

        # Bathroom type
        bath_desc = " - ".join(filter(None, [designation, bath_fn]))
        if bath_desc:
            info_data.append(["Bathroom:", bath_desc])

        # Claim # (only if present)
        claim_number = estimate.get("claim_number", "") or ""
        if claim_number:
            info_data.append(["Claim #:", claim_number])

        # Size: floor SF + ceiling height
        height_ft = estimate.get("height_ft", 8) or 8
        floor_sf = estimate.get("floor_sf")
        if not floor_sf and estimate.get("length_ft") and estimate.get("width_ft"):
            floor_sf = estimate["length_ft"] * estimate["width_ft"]
        if floor_sf:
            info_data.append([
                "Size:",
                f"{floor_sf:.0f} SF  (Ceiling: {height_ft}')",
            ])

        info_table = Table(
            info_data,
            colWidths=[usable_w * 0.14, usable_w * 0.86],
        )
        info_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))

        # ══════ OVERVIEW NOTE ══════
        overview = estimate.get("overview_text")
        if overview:
            elements.append(Paragraph("Project Overview", section_title_style))
            elements.append(Paragraph(overview, ParagraphStyle("Overview", fontSize=9.5, fontName="Helvetica", textColor=text_grey, leading=14, spaceBefore=2)))
            elements.append(Spacer(1, 8))

        # ══════ SKETCH + PHASE SUMMARY (side by side) ══════
        left_col_w = usable_w * 0.48
        right_col_w = usable_w * 0.52
        max_sketch_h = 5.0 * inch

        sketch_element = None

        # Try client-captured PNG first
        if sketch_image_base64:
            try:
                import base64

                from reportlab.platypus import Image
                img_data = base64.b64decode(sketch_image_base64)
                img_stream = io.BytesIO(img_data)
                img = Image(img_stream)
                iw, ih = img.drawWidth, img.drawHeight
                if iw > 0 and ih > 0:
                    fit_w = left_col_w - 8
                    fit_h = fit_w * (ih / iw)
                    if fit_h > max_sketch_h:
                        fit_h = max_sketch_h
                        fit_w = fit_h * (iw / ih)
                    img.drawWidth = fit_w
                    img.drawHeight = fit_h
                    img.hAlign = 'CENTER'
                    sketch_element = img
            except Exception as e:
                logger.warning(f"Failed to embed sketch image in PDF: {e}")

        # Fallback: server-side rendering from sketch_data
        if not sketch_element:
            sketch_data = estimate.get("sketch_data")
            if sketch_data and (sketch_data.get("rooms") or sketch_data.get("walls") or sketch_data.get("fixtures")):
                try:
                    drawing = self._render_sketch_drawing(
                        sketch_data, left_col_w - 8, max_sketch_h)
                    if drawing:
                        sketch_element = drawing
                except Exception as e:
                    logger.warning(f"Failed to render sketch drawing: {e}")

        # Build summary table
        line_items = estimate.get("line_items", [])
        sections = _group_line_items_by_phase(line_items)

        summary_col_w = right_col_w - 8 if sketch_element else usable_w
        s_col_widths = [summary_col_w * 0.10, summary_col_w * 0.64, summary_col_w * 0.26]
        summary_data = [["Phase", "Description", "Amount"]]
        for sec in sections:
            summary_data.append([
                str(sec["phase"]),
                PHASE_LABELS.get(sec["phase"], ""),
                f"${sec['total']:,.2f}",
            ])

        subtotal = estimate.get("subtotal", 0)
        summary_data.append(["", "Subtotal", f"${subtotal:,.2f}"])

        # O&P is absorbed into line item pricing — not shown separately on PDF.
        # Material tax is likewise loaded into line item pricing: on lump-sum
        # improvement contracts the contractor is the final consumer, so no
        # sales tax line may appear on the client-facing PDF.

        total = estimate.get("total", 0)
        summary_data.append(["", "GRAND TOTAL", f"${total:,.2f}"])

        summary_table = Table(summary_data, colWidths=s_col_widths)

        font_sz = 9 if sketch_element else 9.5
        table_style = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), font_sz),
            ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
            ("BACKGROUND", (0, 0), (-1, 0), section_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 1, border_grey),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ]

        num_phases = len(sections)
        subtotal_row = num_phases + 1
        total_row = len(summary_data) - 1
        table_style.append(("FONTNAME", (1, subtotal_row), (-1, subtotal_row), "Helvetica-Bold"))
        table_style.append(("LINEABOVE", (1, subtotal_row), (-1, subtotal_row), 1, border_grey))
        table_style.append(("FONTNAME", (1, total_row), (-1, total_row), "Helvetica-Bold"))
        table_style.append(("FONTSIZE", (1, total_row), (-1, total_row), 10.5 if sketch_element else 11))
        table_style.append(("LINEABOVE", (1, total_row), (-1, total_row), 1.5, brand_accent))
        table_style.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#ebf8ff")))
        summary_table.setStyle(TableStyle(table_style))

        if sketch_element:
            sketch_title = Paragraph("Floor Plan", section_title_style)
            summary_title = Paragraph("Estimate Summary", section_title_style)

            # Wrap sketch in KeepInFrame to force size constraint
            sketch_block = KeepInFrame(
                left_col_w, max_sketch_h + 30,
                [sketch_title, Spacer(1, 8), sketch_element],
                mode='shrink',
            )
            summary_block = KeepInFrame(
                right_col_w, max_sketch_h + 30,
                [summary_title, summary_table],
                mode='truncate',
            )

            side_by_side = Table(
                [[sketch_block, summary_block]],
                colWidths=[left_col_w, right_col_w],
            )
            side_by_side.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            elements.append(side_by_side)
        else:
            elements.append(Paragraph("Estimate Summary", section_title_style))
            elements.append(summary_table)

        # ══════ 3D VIEW (an option only) ══════
        render = _picture(render_image_base64, usable_w, 4.6 * inch) if estimate.get("kind") == "option" else None
        if render is not None:
            elements.append(Spacer(1, 12))
            # The title moves to the next page with the picture rather than end this one alone
            elements.append(KeepTogether([Paragraph("How It Will Look", section_title_style), render]))

        # ══════ PRODUCTS (an option only) ══════
        products = (
            _products_table(estimate.get("selections"), product_pictures, usable_w, 0.85 * inch)
            if estimate.get("kind") == "option" else None
        )
        if products is not None:
            elements.append(Spacer(1, 6))
            elements.append(Paragraph("Selected Products", section_title_style))
            elements.append(products)

        elements.append(Spacer(1, 28))

        # ══════ DETAILED LINE ITEMS ══════
        elements.append(Paragraph("Detailed Line Items", section_title_style))

        for sec in sections:
            # Section header
            elements.append(Paragraph(sec["title"], ParagraphStyle(
                "PhaseTitle", fontSize=10, fontName="Helvetica-Bold",
                textColor=brand_accent, spaceBefore=10, spaceAfter=4,
            )))

            detail_data = [["Description", "Qty", "Unit", "Rate", "Total"]]
            for li in sec["items"]:
                desc_text = li.get("description", "")
                notes_text = _filter_notes_prices(
                    li.get("notes", ""), show_breakdown_prices)
                if notes_text:
                    desc_text += (
                        f'<br/><font size="8.5" color="#666666">'
                        f'{notes_text}</font>'
                    )
                detail_data.append([
                    Paragraph(desc_text, ParagraphStyle(
                        "LiDesc", fontSize=10,
                        fontName="Helvetica",
                        textColor=brand_dark)),
                    f"{li.get('quantity', 0):.1f}",
                    li.get("unit", ""),
                    f"${li.get('unit_price', 0):,.2f}",
                    f"${li.get('total', 0):,.2f}",
                ])

            # Section subtotal
            detail_data.append(["", "", "", "Subtotal:", f"${sec['total']:,.2f}"])

            dcol = [usable_w * 0.45, usable_w * 0.10, usable_w * 0.10, usable_w * 0.15, usable_w * 0.20]
            detail_table = Table(detail_data, colWidths=dcol)
            detail_style = [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), brand_dark),
                ("BACKGROUND", (0, 0), (-1, 0), section_bg),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, border_grey),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("FONTNAME", (3, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (3, -1), (-1, -1), 0.5, border_grey),
            ]
            # Alternating row colors
            for i in range(1, len(detail_data) - 1):
                if i % 2 == 0:
                    detail_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f7fafc")))
            detail_table.setStyle(TableStyle(detail_style))
            elements.append(detail_table)

        elements.append(Spacer(1, 16))

        # ══════ WARNINGS ══════
        # Filter out internal-only fields from client-facing PDF
        _internal_keywords = {"adjustment factor", "target total", "factor:", "multiplier:",
                               "strongly recommend replacing valve"}
        warnings = [
            w for w in (estimate.get("warning_flags") or [])
            if not any(kw in w.lower() for kw in _internal_keywords)
        ]
        if warnings:
            elements.append(Paragraph("Important Notes", section_title_style))
            for w in warnings:
                elements.append(Paragraph(f"\u2022 {w}", terms_style))
            elements.append(Spacer(1, 8))

        # ══════ EXCLUSIONS ══════
        elements.append(Paragraph("Exclusions", section_title_style))
        exclusions = [
            "Structural changes or wall relocation",
            "HVAC modifications",
            "Window or door replacement",
            "Environmental remediation (if required, separate estimate)",
            "Asbestos testing or abatement",
            "Customer-supplied materials (unless pre-approved in writing)",
        ]
        for ex in exclusions:
            elements.append(Paragraph(f"• {ex}", terms_style))
        elements.append(Spacer(1, 8))


        # ══════ WARRANTY ══════
        elements.append(Paragraph("Warranty", section_title_style))
        warranty_items = [
            "Workmanship warranty: 1 year from completion date",
            "Waterproofing (shower pan, membrane): 5 years",
            "Manufacturer warranties on fixtures and materials apply per product",
            "Warranty does not cover issues from misuse, neglect, or acts of nature",
        ]
        for w in warranty_items:
            elements.append(Paragraph(f"\u2022 {w}", terms_style))
        elements.append(Spacer(1, 8))

        # ══════ PAYMENT SCHEDULE ══════
        elements.append(Paragraph("Payment Schedule", section_title_style))
        total = estimate.get("total", 0)
        zip_code = estimate.get("zip_code", "") or ""
        zip3 = zip_code[:3] if zip_code else ""
        is_dc = zip3 in ("200", "201", "202", "203", "204", "205")
        if is_dc:
            dep_pct, prog_pct, fin_pct = 0.34, 0.50, 0.16
        else:
            dep_pct, prog_pct, fin_pct = 0.33, 0.50, 0.17
        dep_amt = round(total * dep_pct, 2)
        prog_amt = round(total * prog_pct, 2)
        fin_amt = round(total - dep_amt - prog_amt, 2)
        pay_items = [
            f"{dep_pct*100:.0f}% (${dep_amt:,.2f}) \u2014 Upon contract signing",
            f"{prog_pct*100:.0f}% (${prog_amt:,.2f}) \u2014 Upon material delivery / rough-in start",
            f"{fin_pct*100:.0f}% (${fin_amt:,.2f}) \u2014 Upon final walk-through & approval",
        ]
        for p in pay_items:
            elements.append(Paragraph(f"\u2022 {p}", terms_style))
        elements.append(Spacer(1, 8))

        # ══════ TERMS ══════
        elements.append(Paragraph("Terms & Conditions", section_title_style))
        general_terms = [
            "This estimate is valid for 30 days from the date issued.",
            "Any changes to the scope of work after contract signing "
            "will require a written change order.",
            "Unforeseen conditions discovered during demolition "
            "(e.g., concealed conditions, plumbing/electrical "
            "code violations) will be documented with photos, "
            "presented as a written change order with itemized cost, "
            "and require Owner's written approval before work "
            "proceeds. Verbal approvals will not be honored.",
            "Work schedule is weather-permitting and subject to "
            "material availability.",
            "Customer-supplied materials must be on-site before "
            "scheduled installation date.",
            "Owner-selected materials exceeding allowances specified "
            "in this estimate will be billed at cost difference "
            "plus 15% handling.",
        ]
        for t in general_terms:
            elements.append(Paragraph(f"\u2022 {t}", terms_style))
        elements.append(Spacer(1, 8))

        elements.append(Spacer(1, 8))

        # ══════ SIGNATURE ══════
        if show_signature:
            sig_data = [
                [Paragraph("<b>Accepted By:</b>", normal), "", Paragraph("<b>Date:</b>", normal), ""],
                ["_" * 40, "", "_" * 25, ""],
                [Paragraph("Customer Signature", small_grey), "",
                 Paragraph("Date", small_grey), ""],
            ]
            sig_table = Table(sig_data, colWidths=[usable_w * 0.45, usable_w * 0.05,
                                                    usable_w * 0.30, usable_w * 0.20])
            sig_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            elements.append(sig_table)

        # ══════ BUILD ══════
        numbered_canvas = _NumberedCanvas.make(
            _on_first_page, _on_later_pages, page_w, margin,
        )
        doc.build(
            elements,
            onFirstPage=_on_first_page,
            onLaterPages=_on_later_pages,
            canvasmaker=numbered_canvas,
        )
        buffer.seek(0)
        return buffer

    def generate_proposal_pdf(
        self, group: Dict[str, Any], show_signature: bool = True,
        renders: Optional[Dict[str, str]] = None,
        product_pictures: Optional[Dict[str, bytes]] = None,
    ) -> io.BytesIO:
        """The customer's side-by-side of a bathroom job's estimates.

        Insurance job: the restoration, then each option with what it costs
        over the restoration and the line items that make that difference.
        Remodel job: the options and their prices. This one is for the
        customer only; the carrier gets the restoration's own PDF.

        renders: each estimate's 3D view by id, rendered in the browser.
        product_pictures: the pictures of the options' picked products, by file id.
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

        buffer = io.BytesIO()
        page_w, page_h = letter
        margin = 0.6 * inch
        usable_w = page_w - 2 * margin
        doc = SimpleDocTemplate(
            buffer, pagesize=letter,
            rightMargin=margin, leftMargin=margin,
            topMargin=margin, bottomMargin=0.8 * inch,
        )
        prop_addr = first.get("property_address", "") or ""

        def _on_later_pages(canvas, doc_ref):
            canvas.saveState()
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(colors.HexColor("#4a5568"))
            canvas.drawString(margin, page_h - 0.4 * inch, "Bathroom Options")
            canvas.drawRightString(page_w - margin, page_h - 0.4 * inch, prop_addr[:60])
            canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
            canvas.line(margin, page_h - 0.48 * inch, page_w - margin, page_h - 0.48 * inch)
            canvas.restoreState()

        def _on_first_page(canvas, doc_ref):
            pass

        brand_dark = colors.HexColor("#1a2332")
        brand_accent = colors.HexColor("#2c5282")
        text_grey = colors.HexColor("#4a5568")
        border_grey = colors.HexColor("#e2e8f0")
        section_bg = colors.HexColor("#edf2f7")
        company_info_style = ParagraphStyle("CompanyInfo", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13)
        section_title_style = ParagraphStyle("SectionTitle", fontSize=11, fontName="Helvetica-Bold", textColor=brand_dark, spaceBefore=14, spaceAfter=10)
        normal = ParagraphStyle("NormalCustom", fontSize=10, fontName="Helvetica", textColor=brand_dark)
        small_grey = ParagraphStyle("SmallGrey", fontSize=8, fontName="Helvetica", textColor=text_grey, leading=11)
        body_style = ParagraphStyle("Body", fontSize=9.5, fontName="Helvetica", textColor=text_grey, leading=14)
        cell_style = ParagraphStyle("Cell", fontSize=9, fontName="Helvetica", textColor=brand_dark, leading=11)

        def money(v: float) -> str:
            return f"${v:,.2f}"

        def signed(v: float) -> str:
            return f"+{money(v)}" if v >= 0 else f"-{money(-v)}"

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

        elements = []

        # ══════ HEADER ══════
        est_date = datetime.now()
        valid_until = est_date + timedelta(days=30)
        right_cell = Paragraph(
            f"<b>BATHROOM OPTIONS</b><br/>"
            f"Date: {est_date.strftime('%m/%d/%Y')}<br/>"
            f"Valid Through: {valid_until.strftime('%m/%d/%Y')}",
            ParagraphStyle("RightHeader", fontSize=9, fontName="Helvetica", textColor=text_grey, leading=13, alignment=2),
        )
        header_table = Table(
            [[_company_cell(first, company_info_style), right_cell]],
            colWidths=[usable_w * 0.55, usable_w * 0.45],
        )
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements += [header_table, Spacer(1, 12),
                     HRFlowable(width="100%", thickness=1.5, color=brand_accent), Spacer(1, 12)]

        # ══════ PROJECT INFO ══════
        info_data = [["Property:", _full_address(first)]]
        if first.get("client_name"):
            info_data.append(["Client:", first["client_name"]])
        bath_desc = " - ".join(filter(None, [
            (first.get("designation") or "").replace("_", " ").title(),
            (first.get("bath_function") or "").replace("_", " ").title(),
        ]))
        if bath_desc:
            info_data.append(["Bathroom:", bath_desc])
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
        if insurance and restoration:
            elements.append(Paragraph(
                "The restoration returns the bathroom to its condition before the "
                "loss. Each option is priced in full; the last column is what it "
                "costs over the restoration.", body_style))
        else:
            elements.append(Paragraph("Each option is priced in full.", body_style))
        elements.append(Spacer(1, 8))

        compare_to_restoration = insurance and restoration is not None
        summary = [["", "Total", "Over restoration"] if compare_to_restoration else ["", "Total"]]
        for m in members:
            row = [_member_name(m) + (" (pre-loss condition)" if m.get("kind") == "restore" else ""),
                   money(m.get("total") or 0)]
            if compare_to_restoration:
                row.append("—" if m is restoration
                           else signed((m.get("total") or 0) - (restoration.get("total") or 0)))
            summary.append(row)
        widths = ([usable_w * 0.50, usable_w * 0.25, usable_w * 0.25] if compare_to_restoration
                  else [usable_w * 0.65, usable_w * 0.35])
        summary_table = Table(summary, colWidths=widths)
        summary_table.setStyle(table_style([("FONTSIZE", (0, 1), (-1, -1), 10)]))
        elements.append(summary_table)

        # ══════ HOW EACH LOOKS: the 3D views, two to a row ══════
        renders = renders or {}
        cell_w = (usable_w - 12) / 2
        pictured = [(m, _picture(renders.get(str(m.get("id"))), cell_w - 8, 2.6 * inch)) for m in members]
        pictured = [(m, img) for m, img in pictured if img is not None]
        if pictured:
            caption_style = ParagraphStyle("Caption", fontSize=9, fontName="Helvetica", textColor=brand_dark, alignment=1, spaceBefore=4)
            cells = []
            for m, img in pictured:
                caption = f"<b>{_member_name(m)}</b> &nbsp; {money(m.get('total') or 0)}"
                if compare_to_restoration and m is not restoration:
                    caption += f" ({signed((m.get('total') or 0) - (restoration.get('total') or 0))})"
                cells.append([img, Paragraph(caption, caption_style)])
            for i in range(0, len(cells), 2):
                row = cells[i:i + 2] + [""] * (2 - len(cells[i:i + 2]))
                grid = Table([row], colWidths=[cell_w + 6, cell_w + 6])
                grid.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]))
                # The title stays with the first row of pictures
                elements.append(KeepTogether([Paragraph("How Each Looks", section_title_style), grid]) if i == 0 else grid)

        # ══════ THE PRODUCTS EACH OPTION IS BUILT FROM ══════
        built_from = [(m, _products_table(m.get("selections"), product_pictures, usable_w, 0.6 * inch)) for m in options]
        built_from = [(m, t) for m, t in built_from if t is not None]
        for i, (m, table) in enumerate(built_from):
            heading = [Paragraph(f"<b>{_member_name(m)}</b>", cell_style), Spacer(1, 4)]
            if i == 0:
                heading.insert(0, Paragraph("Products in Each Option", section_title_style))
            elements.append(KeepTogether([*heading, table, Spacer(1, 10)]))

        # ══════ BY PHASE ══════
        phases = sorted({li.get("phase") for m in members for li in (m.get("line_items") or [])
                         if li.get("phase") in PHASE_LABELS})
        if phases and len(members) > 1:
            elements.append(Paragraph("By Phase", section_title_style))
            name_w = usable_w * 0.34
            col_w = (usable_w - name_w) / len(members)
            matrix = [[""] + [Paragraph(f"<b>{_member_name(m)}</b>", cell_style) for m in members]]
            for phase in phases:
                matrix.append([Paragraph(f"{phase}. {PHASE_LABELS[phase]}", cell_style)] + [
                    money(sum(li.get("total") or 0 for li in (m.get("line_items") or [])
                              if li.get("phase") == phase))
                    for m in members
                ])
            matrix.append(["Total"] + [money(m.get("total") or 0) for m in members])
            matrix_table = Table(matrix, colWidths=[name_w] + [col_w] * len(members), repeatRows=1)
            matrix_table.setStyle(table_style([
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 1, brand_accent),
            ]))
            elements.append(matrix_table)

        # ══════ WHAT EACH OPTION CHANGES ══════
        if compare_to_restoration:
            max_rows = 30
            for option in options:
                changes = _line_item_changes(restoration, option)
                name = _member_name(option)
                block = [Paragraph(f"{name}: what changes from the restoration", section_title_style)]
                if not changes:
                    block.append(Paragraph("Same scope and price as the restoration.", body_style))
                    elements.append(KeepTogether(block))
                    continue
                rows = [["Item", "Restoration", name, "Difference"]]
                for c in changes[:max_rows]:
                    rows.append([
                        Paragraph(c["description"], cell_style),
                        money(c["base"]) if c["base"] else "—",
                        money(c["option"]) if c["option"] else "—",
                        signed(c["difference"]),
                    ])
                rows.append(["Total difference", "", "",
                             signed((option.get("total") or 0) - (restoration.get("total") or 0))])
                change_table = Table(
                    rows, colWidths=[usable_w * 0.49, usable_w * 0.17, usable_w * 0.17, usable_w * 0.17],
                    repeatRows=1,
                )
                change_table.setStyle(table_style([
                    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                    ("LINEABOVE", (0, -1), (-1, -1), 1, brand_accent),
                ]))
                block.append(change_table)
                if len(changes) > max_rows:
                    block.append(Spacer(1, 4))
                    block.append(Paragraph(
                        f"…and {len(changes) - max_rows} more changed items; "
                        f"the {name} estimate lists every item.", small_grey))
                elements += block

        # ══════ SELECTION ══════
        elements.append(Spacer(1, 12))
        elements.append(Paragraph("Selection", section_title_style))
        elements.append(Paragraph(
            "&nbsp;&nbsp;&nbsp;&nbsp;".join(f"[&nbsp;&nbsp;] {_member_name(m)}" for m in members),
            normal))
        elements.append(Spacer(1, 6))
        elements.append(Paragraph(
            "Each option's full estimate, with every line item, is available on request.",
            small_grey))
        if show_signature:
            elements.append(Spacer(1, 14))
            sig_data = [
                [Paragraph("<b>Accepted By:</b>", normal), "", Paragraph("<b>Date:</b>", normal), ""],
                ["_" * 40, "", "_" * 25, ""],
                [Paragraph("Customer Signature", small_grey), "", Paragraph("Date", small_grey), ""],
            ]
            sig_table = Table(sig_data, colWidths=[usable_w * 0.45, usable_w * 0.05,
                                                    usable_w * 0.30, usable_w * 0.20])
            sig_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            elements.append(sig_table)

        doc.build(
            elements,
            onFirstPage=_on_first_page,
            onLaterPages=_on_later_pages,
            canvasmaker=_NumberedCanvas.make(_on_first_page, _on_later_pages, page_w, margin),
        )
        buffer.seek(0)
        return buffer

    def _render_sketch_drawing(
        self, sketch_data: Dict[str, Any], max_w: float, max_h: float
    ):
        """Render sketch_data as a ReportLab Drawing (server-side fallback)."""
        from reportlab.graphics.shapes import Drawing, Line, Rect, String
        from reportlab.lib import colors

        rooms = sketch_data.get("rooms", [])
        walls = sketch_data.get("walls", [])
        fixtures = sketch_data.get("fixtures", [])
        ppf = sketch_data.get("settings", {}).get("pixelsPerFoot", 30)

        if not rooms and not walls and not fixtures:
            return None

        # Compute bounding box of all elements
        all_x, all_y = [], []
        for r in rooms:
            for pt in r.get("boundary", []):
                all_x.append(pt["x"])
                all_y.append(pt["y"])
        for w in walls:
            all_x.extend([w["start"]["x"], w["end"]["x"]])
            all_y.extend([w["start"]["y"], w["end"]["y"]])
        for f in fixtures:
            all_x.append(f["position"]["x"])
            all_y.append(f["position"]["y"])

        if not all_x:
            return None

        min_x, max_x_val = min(all_x), max(all_x)
        min_y, max_y_val = min(all_y), max(all_y)
        src_w = max(max_x_val - min_x + 20, 1)
        src_h = max(max_y_val - min_y + 20, 1)

        scale = min(max_w / src_w, max_h / src_h)
        draw_w = src_w * scale
        draw_h = src_h * scale

        d = Drawing(draw_w, draw_h)

        def tx(x):
            return (x - min_x + 10) * scale

        def ty(y):
            return draw_h - (y - min_y + 10) * scale  # flip Y

        # Draw rooms
        for r in rooms:
            pts = r.get("boundary", [])
            if len(pts) < 3:
                continue
            for i in range(len(pts)):
                p1 = pts[i]
                p2 = pts[(i + 1) % len(pts)]
                d.add(Line(tx(p1["x"]), ty(p1["y"]), tx(p2["x"]), ty(p2["y"]),
                           strokeColor=colors.HexColor("#90caf9"), strokeWidth=1))
            # Area label
            cx = sum(p["x"] for p in pts) / len(pts)
            cy = sum(p["y"] for p in pts) / len(pts)
            area = r.get("netFloorAreaSF") or r.get("floorAreaSF", 0)
            name = r.get("name", "Room")
            d.add(String(tx(cx) - 15, ty(cy), f"{name} {area}SF",
                         fontSize=7, fillColor=colors.HexColor("#333333")))

        # Draw walls
        for w in walls:
            d.add(Line(tx(w["start"]["x"]), ty(w["start"]["y"]),
                        tx(w["end"]["x"]), ty(w["end"]["y"]),
                        strokeColor=colors.HexColor("#333333"), strokeWidth=1.5))

        # Draw fixtures
        for f in fixtures:
            px = tx(f["position"]["x"])
            py = ty(f["position"]["y"])
            fw = (f.get("dimensions", {}).get("width", 24) / 12) * ppf * scale
            fh = (f.get("dimensions", {}).get("height", 24) / 12) * ppf * scale
            d.add(Rect(px - fw / 2, py - fh / 2, fw, fh,
                        strokeColor=colors.HexColor("#666666"), fillColor=None, strokeWidth=0.8))
            label = f.get("label") or f.get("type", "")
            d.add(String(px - 10, py - 3, label, fontSize=5.5,
                         fillColor=colors.HexColor("#666666")))

        return d
