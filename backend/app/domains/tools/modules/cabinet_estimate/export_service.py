"""
Cabinet Estimate export service - PDF and Excel generation.
"""

import io
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Line item category → section mapping ──
# Installation shares the cabinet section: the PDF folds each install line
# into the supply line it installs, leaving only stand-alone install scope
# (toe kick, quarter round) behind. See _merge_install_into_supply.
SECTION_ORDER = [
    ("Cabinets", ["supply", "premium", "install"]),
    ("Demolition & Removal", ["demo"]),
    ("Plumbing & Fixtures", ["plumbing"]),
    ("Countertop", ["countertop"]),
    ("Backsplash", ["backsplash"]),
    ("Finishing", ["finishing"]),
    ("General Conditions", ["misc"]),
]

# "Tall Cabinets 24"W x 84"H - Stock", "Oven Cabinet 33"W x 84"H - Stock"
_TALL_SUPPLY = re.compile(r'\d+"W x [\d.]+"H - ')
# The tag a supply line carries while its install is quoted separately
_SUPPLY_TAG = re.compile(r" \((?:Material|Supply)\)$")

# The terms every kitchen quote carries, whichever format it's in
TERMS_TEXT = (
    "<b>Validity</b><br/>"
    "1. This estimate is valid for 30 days "
    "from the date above.<br/><br/>"
    "<b>Change Orders</b><br/>"
    "2. Any changes to the scope of work "
    "must be documented in a written Change "
    "Order signed by both parties before "
    "work proceeds. Change orders will "
    "detail the scope change, cost impact, "
    "and schedule impact. No verbal "
    "agreements will be honored.<br/><br/>"
    "<b>Lead Time &amp; Scheduling</b><br/>"
    "3. Lead times for cabinet orders are "
    "typically 2-6 weeks depending on tier "
    "and availability. Contractor is not "
    "responsible for manufacturer "
    "delays.<br/><br/>"
    "<b>Warranty</b><br/>"
    "4. Workmanship warranty: 1 year from "
    "substantial completion, covering "
    "cabinet installation (level, plumb, "
    "secure), plumbing connections (leaks), "
    "tile/grout (cracks, separation), and "
    "all contractor-performed work.<br/>"
    "5. Manufacturer warranties for "
    "cabinets, countertops, fixtures, and "
    "appliances are passed through to the "
    "homeowner per manufacturer terms.<br/><br/>"
    "<b>Permits &amp; Inspections</b><br/>"
    "6. Permits required by the local "
    "jurisdiction will be obtained by the "
    "contractor. Permit fees are included "
    "only if 'Permit Allowance' is listed "
    "above. Any additional permit costs "
    "beyond the allowance will be billed "
    "at cost.<br/><br/>"
    "<b>Material Specifications</b><br/>"
    "7. Materials and fixtures are as "
    "specified in the line items above. "
    "Substitutions of equal or greater "
    "quality may be made with homeowner "
    "approval. Any upgrade requests will "
    "be handled via Change Order."
)


def payment_phases(
    total: float,
    zip_code: Optional[str],
) -> List[Dict[str, Any]]:
    """The payment schedule of a quote; the deposit limit depends on the state."""
    zip3 = (zip_code or "")[:3]
    # DC zip codes: 200-205
    is_dc = zip3 in (
        "200", "201", "202", "203", "204", "205",
    )
    if is_dc:
        deposit_pct, progress_pct, final_pct = (
            0.34, 0.50, 0.16,
        )
    else:
        # VA, MD, PA: 33% max deposit
        deposit_pct, progress_pct, final_pct = (
            0.33, 0.50, 0.17,
        )

    deposit_amt = round(total * deposit_pct, 2)
    progress_amt = round(total * progress_pct, 2)
    final_amt = round(
        total - deposit_amt - progress_amt, 2,
    )
    return [
        {
            "phase": "1. Deposit",
            "pct": deposit_pct,
            "amount": deposit_amt,
            "due": "Upon contract signing",
        },
        {
            "phase": "2. Progress",
            "pct": progress_pct,
            "amount": progress_amt,
            "due": "Upon cabinet delivery / "
            "installation start",
        },
        {
            "phase": "3. Final",
            "pct": final_pct,
            "amount": final_amt,
            "due": "Upon final walk-through "
            "& approval",
        },
    ]


def _supply_lines_installed_by(
    install: Dict[str, Any],
    supply: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """The supply lines an install line installs, or [] if it stands alone.

    Matched on the descriptions calculator.py builds. One install line can
    cover several supply lines - "Base Cabinet Installation" installs the
    standard, non-standard and sink base runs alike - so all are returned.
    """
    m = re.fullmatch(
        r"(Island )?(.+) Installation",
        install.get("description", ""),
    )
    if not m:
        return []
    prefix, subject = m.group(1) or "", m.group(2)
    if subject == "Tall Cabinet":
        # Generic and typed tall boxes alike, billed per EA by size
        return [
            s for s in supply
            if s.get("description", "").startswith(prefix)
            and _TALL_SUPPLY.search(s.get("description", ""))
        ]
    if subject == "Hardware":
        lead = f"{prefix}Cabinet Hardware"
    else:
        # "Wall Cabinet Standard" → "Wall Cabinets Standard - Stock",
        # "Crown Molding" → "Crown Molding - Stock (Material)"
        lead = (
            f"{prefix}"
            f"{subject.replace('Cabinet', 'Cabinets', 1)} - "
        )
    return [
        s for s in supply
        if s.get("description", "").startswith(lead)
    ]


def _merge_install_into_supply(
    line_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Show material and labor as one line: fold install into its supply.

    The calculator quotes cabinet supply and installation as separate lines
    (and the estimate screen keeps them that way); the customer PDF shows
    one supply-and-install price per item instead. An install line spread
    over several supply lines is split by quantity, the last line taking
    the rounding remainder so every section total stays exact.
    """
    items = [dict(li) for li in line_items]
    folded = set()
    for inst in items:
        if inst.get("category") != "install":
            continue
        loc = inst.get("location", "perimeter")
        covered = _supply_lines_installed_by(inst, [
            s for s in items
            if s.get("category") == "supply"
            and s.get("location", "perimeter") == loc
            and s.get("unit") == inst.get("unit")
        ])
        qty = sum(s.get("quantity", 0) for s in covered)
        if qty <= 0:
            continue

        left = {
            k: inst.get(k) or 0
            for k in ("total", "material_total", "labor_total")
        }
        for i, s in enumerate(covered):
            for k in left:
                part = (
                    left[k] if i == len(covered) - 1
                    else round(
                        (inst.get(k) or 0)
                        * s.get("quantity", 0) / qty, 2,
                    )
                )
                left[k] = round(left[k] - part, 2)
                s[k] = round((s.get(k) or 0) + part, 2)
            for k in (
                "unit_price",
                "material_unit_price",
                "labor_unit_price",
            ):
                s[k] = round(
                    (s.get(k) or 0) + (inst.get(k) or 0), 2,
                )
            s["description"] = _SUPPLY_TAG.sub(
                "", s.get("description", ""),
            )
            s["notes"] = " · ".join(
                filter(None, [s.get("notes"), "Supply & install"]),
            )
        folded.add(id(inst))

    return [li for li in items if id(li) not in folded]


def _group_line_items(
    line_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Group line items by location then category."""
    sections = []

    has_island = any(
        li.get("location") == "island"
        for li in line_items
    )

    if has_island:
        # Perimeter: split by category sections
        perim_items = [
            li for li in line_items
            if li.get("location", "perimeter")
            == "perimeter"
        ]
        if perim_items:
            for title, cats in SECTION_ORDER:
                items = [
                    li for li in perim_items
                    if li.get("category") in cats
                ]
                if items:
                    total = sum(
                        li.get("total", 0)
                        for li in items
                    )
                    sections.append({
                        "title": (
                            f"Perimeter — {title}"
                        ),
                        "items": items,
                        "total": total,
                    })

        # Island: single combined section
        island_items = [
            li for li in line_items
            if li.get("location") == "island"
        ]
        if island_items:
            total = sum(
                li.get("total", 0)
                for li in island_items
            )
            sections.append({
                "title": "Island",
                "items": island_items,
                "total": total,
            })

        shared = [
            li for li in line_items
            if li.get("location") == "shared"
        ]
        if shared:
            for title, cats in SECTION_ORDER:
                items = [
                    li for li in shared
                    if li.get("category") in cats
                ]
                if items:
                    total = sum(
                        li.get("total", 0)
                        for li in items
                    )
                    sections.append({
                        "title": title,
                        "items": items,
                        "total": total,
                    })
    else:
        for title, cats in SECTION_ORDER:
            items = [
                li for li in line_items
                if li.get("category") in cats
            ]
            if items:
                total = sum(
                    li.get("total", 0)
                    for li in items
                )
                sections.append({
                    "title": title,
                    "items": items,
                    "total": total,
                })
    return sections


class CabinetExportService:
    """Generates PDF estimates and Excel purchase orders."""

    # ── PDF Export ──

    def generate_pdf(
        self,
        estimate: Dict[str, Any],
        show_signature: bool = True,
        image_loader=None,
        render: Optional[str] = None,
    ) -> io.BytesIO:
        """Generate a professional PDF estimate.

        An upgrade option's PDF names the option and shows its products
        (pictures read with image_loader(file_id) -> bytes) and, when the
        browser sent one, its 3D view (render, base64). The restoration's PDF
        - the one the carrier gets - never has either.
        """
        from .proposal_pdf import render_picture, selected_products

        is_option = estimate.get("kind") == "option"
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import (
            ParagraphStyle,
        )
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable,
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
            buffer,
            pagesize=letter,
            rightMargin=margin,
            leftMargin=margin,
            topMargin=margin,
            bottomMargin=0.8 * inch,
        )

        usable_w = page_w - 2 * margin

        # Page header/footer data (used by callbacks)
        est_id_short = str(
            estimate.get("id", "")
        )[:8].upper()
        prop_addr = estimate.get(
            "property_address", ""
        ) or ""

        def _on_later_pages(canvas, doc_ref):
            """Header + footer on pages 2+."""
            canvas.saveState()
            # Header: property address (left) + quote # (right)
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(colors.HexColor("#4a5568"))
            canvas.drawString(
                margin, page_h - margin + 8,
                prop_addr,
            )
            canvas.drawRightString(
                page_w - margin, page_h - margin + 8,
                f"Quote # {est_id_short}",
            )
            # thin line below header
            canvas.setStrokeColor(
                colors.HexColor("#e2e8f0")
            )
            canvas.setLineWidth(0.5)
            canvas.line(
                margin, page_h - margin + 3,
                page_w - margin, page_h - margin + 3,
            )
            # Footer: page number
            canvas.setFont("Helvetica", 7.5)
            canvas.drawCentredString(
                page_w / 2, 0.45 * inch,
                f"Page {doc_ref.page}",
            )
            canvas.restoreState()

        # ── Colors ──
        brand_dark = colors.HexColor("#1a2332")
        brand_accent = colors.HexColor("#2c5282")
        brand_light_bg = colors.HexColor("#f7fafc")
        text_grey = colors.HexColor("#4a5568")
        border_grey = colors.HexColor("#e2e8f0")
        section_bg = colors.HexColor("#edf2f7")

        # ── Styles ──
        company_info_style = ParagraphStyle(
            "CompanyInfo",
            fontSize=8,
            fontName="Helvetica",
            textColor=text_grey,
            leading=12,
        )
        section_title_style = ParagraphStyle(
            "SectionTitle",
            fontSize=10,
            fontName="Helvetica-Bold",
            textColor=brand_dark,
            spaceBefore=14,
            spaceAfter=4,
        )
        normal = ParagraphStyle(
            "NormalCustom",
            fontSize=9,
            fontName="Helvetica",
            textColor=brand_dark,
        )
        small_grey = ParagraphStyle(
            "SmallGrey",
            fontSize=7.5,
            fontName="Helvetica",
            textColor=text_grey,
            leading=10,
        )
        terms_style = ParagraphStyle(
            "Terms",
            fontSize=8.5,
            fontName="Helvetica",
            textColor=text_grey,
            leading=12,
            spaceBefore=2,
        )

        elements = []

        # ══════════════════════════════════════
        # HEADER: Company info + Estimate title
        # ══════════════════════════════════════

        company = estimate.get("company_info") or {}

        # Left: company info
        # Company text (single Paragraph for table cell)
        company_parts = []
        if company.get("name"):
            company_parts.append(
                f"<b>{company['name']}</b>"
            )
        if company.get("address"):
            addr = company["address"]
            city_state = ", ".join(
                filter(None, [
                    company.get("city"),
                    company.get("state"),
                    company.get("zipcode"),
                ])
            )
            if city_state:
                addr += f", {city_state}"
            company_parts.append(addr)
        contact = []
        if company.get("phone"):
            contact.append(company["phone"])
        if company.get("email"):
            contact.append(company["email"])
        if contact:
            company_parts.append(
                " | ".join(contact),
            )
        if company.get("license_number"):
            company_parts.append(
                f"License #: "
                f"{company['license_number']}"
            )

        if company_parts:
            company_cell = Paragraph(
                "<br/>".join(company_parts),
                company_info_style,
            )
        else:
            company_cell = Spacer(1, 1)

        # Right: QUOTE title + number + date
        est_date = datetime.now()
        valid_until = est_date + timedelta(days=30)

        option_line = (
            f"<br/><font size=11>{estimate.get('option_label') or 'Option'}</font>"
            if is_option else ""
        )
        right_text = (
            f"<font size=20><b>QUOTE</b></font>{option_line}"
            f"<br/><br/>"
            f"<font size=8>"
            f"<b>Quote #:</b> {est_id_short}<br/>"
            f"<b>Date:</b> "
            f"{est_date.strftime('%B %d, %Y')}<br/>"
            f"<b>Valid Until:</b> "
            f"{valid_until.strftime('%B %d, %Y')}"
            f"</font>"
        )
        right_cell = Paragraph(
            right_text,
            ParagraphStyle(
                "RightHeader",
                fontSize=8,
                fontName="Helvetica",
                textColor=brand_dark,
                alignment=2,  # RIGHT
                leading=14,
            ),
        )

        # Build header table
        header_data = [[company_cell, right_cell]]
        header_table = Table(
            header_data,
            colWidths=[usable_w * 0.6, usable_w * 0.4],
        )
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ]))
        elements.append(header_table)

        elements.append(Spacer(1, 14))

        # ══════════════════════════════════════
        # PROJECT INFO: Bill To + Project
        # ══════════════════════════════════════

        bill_to_parts = []
        if estimate.get("client_name"):
            bill_to_parts.append(
                f"<b>{estimate['client_name']}</b>"
            )
        if estimate.get("property_address"):
            bill_to_parts.append(
                estimate["property_address"]
            )
        if estimate.get("claim_number"):
            bill_to_parts.append(
                f"Claim #: {estimate['claim_number']}"
            )

        project_parts = []
        if estimate.get("layout_type"):
            project_parts.append(
                f"Layout: {estimate['layout_type']}"
            )
        if estimate.get("kitchen_size_sqft"):
            project_parts.append(
                f"Kitchen Size: "
                f"{estimate['kitchen_size_sqft']} sqft"
            )
        tier = estimate.get("tier", "")
        if tier:
            project_parts.append(f"Tier: {tier}")

        info_style = ParagraphStyle(
            "InfoBox",
            fontSize=8,
            fontName="Helvetica",
            textColor=text_grey,
            leading=11,
        )
        left_cell = Paragraph(
            "<b>BILL TO</b><br/>"
            + "<br/>".join(
                bill_to_parts
                or ["(Customer information)"]
            ),
            info_style,
        )
        right_cell = Paragraph(
            "<b>PROJECT</b><br/>"
            + "<br/>".join(
                project_parts
                or ["(Project details)"]
            ),
            info_style,
        )

        info_table = Table(
            [[left_cell, right_cell]],
            colWidths=[usable_w * 0.5, usable_w * 0.5],
        )
        info_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, -1), brand_light_bg),
            ("BOX", (0, 0), (-1, -1), 0.5, border_grey),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 10))

        # ══════════════════════════════════════
        # OVERVIEW
        # ══════════════════════════════════════

        overview = estimate.get("overview_text") or ""
        if overview:
            elements.append(
                Paragraph(
                    "<b>Overview</b>",
                    section_title_style,
                )
            )
            elements.append(
                Paragraph(
                    overview,
                    ParagraphStyle(
                        "Overview",
                        fontSize=8,
                        fontName="Helvetica",
                        textColor=text_grey,
                        leading=11,
                        spaceBefore=2,
                        spaceAfter=10,
                    ),
                )
            )

        # ══════════════════════════════════════
        # AN OPTION: how it will look, and its products
        # ══════════════════════════════════════

        if is_option:
            picture = render_picture(render, usable_w, 3.4 * inch)
            if picture is not None:
                elements.append(Paragraph("<b>How It Will Look</b>", section_title_style))
                elements.append(picture)
                elements.append(Spacer(1, 8))
            elements.extend(selected_products(
                estimate, usable_w, image_loader, section_title_style,
                ParagraphStyle("ProductCell", fontSize=8.5, fontName="Helvetica",
                               textColor=brand_dark, leading=11),
                ParagraphStyle("ProductNote", fontSize=7, fontName="Helvetica",
                               textColor=text_grey, leading=9, spaceBefore=4, spaceAfter=10),
            ))

        # ══════════════════════════════════════
        # LINE ITEMS: Grouped by section
        # ══════════════════════════════════════

        line_items = _merge_install_into_supply(
            estimate.get("line_items", []),
        )
        sections = _group_line_items(line_items)

        col_widths = [
            usable_w * 0.48,   # Description
            usable_w * 0.12,   # Qty
            usable_w * 0.08,   # Unit
            usable_w * 0.15,   # Unit Price
            usable_w * 0.17,   # Total
        ]

        for section in sections:
            # Section header row
            section_header = Table(
                [[
                    Paragraph(
                        section["title"].upper(),
                        ParagraphStyle(
                            "SH",
                            fontSize=8,
                            fontName="Helvetica-Bold",
                            textColor=brand_dark,
                        ),
                    ),
                    "",
                    "",
                    "",
                    "",
                ]],
                colWidths=col_widths,
            )
            section_header.setStyle(TableStyle([
                (
                    "BACKGROUND", (0, 0), (-1, 0),
                    section_bg,
                ),
                (
                    "LINEBELOW", (0, 0), (-1, 0),
                    0.5, brand_accent,
                ),
                ("TOPPADDING", (0, 0), (-1, 0), 5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
                ("LEFTPADDING", (0, 0), (0, 0), 6),
                ("SPAN", (0, 0), (-1, 0)),
            ]))
            elements.append(section_header)

            # Items
            table_data = []
            for li in section["items"]:
                desc = li.get("description", "")
                notes = li.get("notes", "")
                if notes:
                    desc_p = Paragraph(
                        f"{desc}<br/>"
                        f"<font size=7.5 color='#718096'>"
                        f"{notes}</font>",
                        normal,
                    )
                else:
                    desc_p = Paragraph(desc, normal)

                table_data.append([
                    desc_p,
                    f'{li.get("quantity", 0):.1f}',
                    li.get("unit", ""),
                    f'${li.get("unit_price", 0):,.2f}',
                    f'${li.get("total", 0):,.2f}',
                ])

            # Section subtotal row
            table_data.append([
                Paragraph(
                    f"<b>{section['title']} Subtotal</b>",
                    ParagraphStyle(
                        "SSub",
                        fontSize=8,
                        fontName="Helvetica-Bold",
                        textColor=text_grey,
                        alignment=2,  # RIGHT
                    ),
                ),
                "",
                "",
                "",
                f'${section["total"]:,.2f}',
            ])

            items_table = Table(
                table_data, colWidths=col_widths,
            )

            row_styles = [
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                (
                    "ALIGN", (1, 0), (-1, -1), "RIGHT",
                ),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                (
                    "LINEBELOW", (0, -1), (-1, -1),
                    0.5, border_grey,
                ),
                (
                    "TOPPADDING", (0, 0), (-1, -1), 3,
                ),
                (
                    "BOTTOMPADDING", (0, 0), (-1, -1),
                    3,
                ),
                ("LEFTPADDING", (0, 0), (0, -1), 12),
                # Last row (subtotal) styling
                (
                    "FONTNAME", (0, -1), (-1, -1),
                    "Helvetica-Bold",
                ),
                (
                    "LINEABOVE", (0, -1), (-1, -1),
                    1, brand_accent,
                ),
                (
                    "TOPPADDING", (0, -1), (-1, -1),
                    6,
                ),
                (
                    "BOTTOMPADDING", (0, -1), (-1, -1),
                    6,
                ),
                ("SPAN", (0, -1), (3, -1)),
            ]
            # Alternating row backgrounds
            for i in range(0, len(table_data) - 1, 2):
                row_styles.append(
                    (
                        "BACKGROUND", (0, i), (-1, i),
                        colors.HexColor("#fafbfc"),
                    )
                )

            items_table.setStyle(TableStyle(row_styles))
            elements.append(items_table)

        # ══════════════════════════════════════
        # TOTALS
        # ══════════════════════════════════════

        elements.append(Spacer(1, 16))

        total = estimate.get("total", 0)

        totals_data = [
            ["TOTAL", f"${total:,.2f}"],
        ]

        tw_label = usable_w * 0.65
        tw_amount = usable_w * 0.35
        totals_table = Table(
            totals_data,
            colWidths=[tw_label, tw_amount],
        )
        totals_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (0, 0), "RIGHT"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
            ("TOPPADDING", (0, 0), (-1, 0), 4),
            (
                "FONTNAME", (0, 0), (-1, 0),
                "Helvetica-Bold",
            ),
            ("FONTSIZE", (0, 0), (-1, 0), 14),
            (
                "TEXTCOLOR", (0, 0), (-1, 0),
                brand_dark,
            ),
            (
                "LINEABOVE", (0, 0), (-1, 0),
                1.5, brand_accent,
            ),
            (
                "BACKGROUND", (0, 0), (-1, 0),
                brand_light_bg,
            ),
        ]))
        elements.append(totals_table)

        # ══════════════════════════════════════
        # TERMS & CONDITIONS
        # ══════════════════════════════════════

        elements.append(Spacer(1, 20))
        elements.append(
            HRFlowable(
                width="100%", thickness=0.5,
                color=border_grey,
            )
        )
        elements.append(Spacer(1, 6))
        elements.append(
            Paragraph(
                "TERMS & CONDITIONS",
                section_title_style,
            )
        )

        elements.append(Paragraph(TERMS_TEXT, terms_style))

        # ══════════════════════════════════════
        # PAYMENT SCHEDULE
        # ══════════════════════════════════════
        elements.append(Spacer(1, 16))

        pay_title = Paragraph(
            "<b>PAYMENT SCHEDULE</b>",
            ParagraphStyle(
                "PayTitle",
                parent=terms_style,
                fontSize=9,
                spaceAfter=6,
            ),
        )
        elements.append(pay_title)

        pay_data = [
            [
                Paragraph("<b>Phase</b>", small_grey),
                Paragraph("<b>%</b>", small_grey),
                Paragraph("<b>Amount</b>", small_grey),
                Paragraph("<b>Due</b>", small_grey),
            ],
            *[
                [
                    phase["phase"],
                    f"{phase['pct']*100:.0f}%",
                    f"${phase['amount']:,.2f}",
                    phase["due"],
                ]
                for phase in payment_phases(
                    total, estimate.get("zip_code", ""),
                )
            ],
            [
                Paragraph(
                    "<b>Total</b>", small_grey,
                ),
                "100%",
                f"${total:,.2f}",
                "",
            ],
        ]

        pay_table = Table(
            pay_data,
            colWidths=[120, 40, 90, 200],
        )
        pay_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0),
             colors.HexColor("#f0f5ff")),
            ("TEXTCOLOR", (0, 0), (-1, 0),
             colors.HexColor("#333333")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("FONTNAME", (0, 0), (-1, 0),
             "Helvetica-Bold"),
            ("FONTNAME", (0, -1), (-1, -1),
             "Helvetica-Bold"),
            ("ALIGN", (1, 0), (2, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5,
             colors.HexColor("#dddddd")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(pay_table)

        # ══════════════════════════════════════
        # ACCEPTANCE / SIGNATURE
        # ══════════════════════════════════════

        if show_signature:
            elements.append(Spacer(1, 24))

            sig_line = "_" * 45
            sig_data = [
                [
                    Paragraph(
                        "<b>ACCEPTED BY:</b>",
                        small_grey,
                    ),
                    "",
                    Paragraph(
                        "<b>AUTHORIZED BY:</b>",
                        small_grey,
                    ),
                    "",
                ],
                [
                    Paragraph(
                        f"Signature: {sig_line}",
                        small_grey,
                    ),
                    "",
                    Paragraph(
                        f"Signature: {sig_line}",
                        small_grey,
                    ),
                    "",
                ],
                [
                    Paragraph(
                        f"Name: {sig_line}",
                        small_grey,
                    ),
                    "",
                    Paragraph(
                        f"Name: {sig_line}",
                        small_grey,
                    ),
                    "",
                ],
                [
                    Paragraph(
                        f"Date: {sig_line}",
                        small_grey,
                    ),
                    "",
                    Paragraph(
                        f"Date: {sig_line}",
                        small_grey,
                    ),
                    "",
                ],
            ]
            sig_table = Table(
                sig_data,
                colWidths=[
                    usable_w * 0.45,
                    usable_w * 0.05,
                    usable_w * 0.45,
                    usable_w * 0.05,
                ],
            )
            sig_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]))
            elements.append(sig_table)

        # ══════════════════════════════════════
        # FOOTER: Thank you note
        # ══════════════════════════════════════

        elements.append(Spacer(1, 16))
        elements.append(
            HRFlowable(
                width="100%", thickness=0.5,
                color=border_grey,
            )
        )
        footer_text = (
            "Thank you for the opportunity to "
            "provide this estimate."
        )
        if company.get("name"):
            footer_text += (
                f" — {company['name']}"
            )
        elements.append(Spacer(1, 4))
        elements.append(
            Paragraph(
                f"<i>{footer_text}</i>",
                ParagraphStyle(
                    "Footer",
                    fontSize=8,
                    fontName="Helvetica-Oblique",
                    textColor=text_grey,
                    alignment=1,  # CENTER
                ),
            )
        )

        doc.build(
            elements,
            onLaterPages=_on_later_pages,
        )
        buffer.seek(0)
        return buffer

    def generate_proposal_pdf(
        self,
        group: Dict[str, Any],
        show_signature: bool = True,
        renders: Optional[Dict[str, str]] = None,
        image_loader=None,
    ) -> io.BytesIO:
        """The customer's side-by-side of a kitchen job (proposal_pdf.py)."""
        from .proposal_pdf import generate_proposal_pdf
        return generate_proposal_pdf(group, show_signature, renders, image_loader)

    def generate_design_quote_pdf(
        self,
        estimate: Dict[str, Any],
        show_signature: bool = True,
        image_loader=None,
        drawings: Optional[Dict[str, Any]] = None,
    ) -> io.BytesIO:
        """The other format of a kitchen quote (design_quote_pdf.py)."""
        from .design_quote_pdf import generate_design_quote_pdf
        return generate_design_quote_pdf(estimate, show_signature, image_loader, drawings)

    # ── Excel Export (for supplier purchase order) ──

    def generate_excel(
        self,
        estimate: Dict[str, Any],
        purchase_order: Dict[str, Any],
    ) -> io.BytesIO:
        """Generate an Excel purchase order."""
        from openpyxl import Workbook
        from openpyxl.styles import (
            Alignment,
            Border,
            Font,
            PatternFill,
            Side,
        )

        wb = Workbook()

        # ── Sheet 1: Purchase Order ──
        ws = wb.active
        ws.title = "Purchase Order"

        header_font = Font(
            bold=True, size=11, color="FFFFFF",
        )
        header_fill = PatternFill(
            start_color="2C3E50",
            end_color="2C3E50",
            fill_type="solid",
        )
        thin_border = Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        )

        # Title
        ws["A1"] = "Cabinet Purchase Order"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = (
            f"Property: "
            f"{estimate.get('property_address', '-')}"
        )
        ws["A3"] = (
            f"Date: "
            f"{datetime.now().strftime('%B %d, %Y')}"
        )
        tier = estimate.get("tier", "-")
        ws["A4"] = f"Tier: {tier}"

        # Headers
        headers = [
            "Code", "Type", "Description",
            "Width", "Height", "Qty",
        ]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(
                row=6, column=col, value=header,
            )
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(
                horizontal="center",
            )
            cell.border = thin_border

        # Data
        items = purchase_order.get("items", [])
        for i, item in enumerate(items, 7):
            ws.cell(
                row=i, column=1,
                value=item["code"],
            ).border = thin_border
            ws.cell(
                row=i, column=2,
                value=item["cab_type"],
            ).border = thin_border
            ws.cell(
                row=i, column=3,
                value=item["description"],
            ).border = thin_border
            ws.cell(
                row=i, column=4,
                value=f'{item["width_inches"]}"',
            ).border = thin_border
            ws.cell(
                row=i, column=5,
                value=f'{item["height_inches"]}"',
            ).border = thin_border
            qty_cell = ws.cell(
                row=i, column=6, value=item["qty"],
            )
            qty_cell.border = thin_border
            qty_cell.alignment = Alignment(
                horizontal="center",
            )

        # Total row
        total_row = 7 + len(items)
        ws.cell(
            row=total_row, column=5,
            value="Total Boxes:",
        ).font = Font(bold=True)
        ws.cell(
            row=total_row, column=6,
            value=purchase_order.get("total_boxes", 0),
        ).font = Font(bold=True)

        # Column widths
        ws.column_dimensions["A"].width = 12
        ws.column_dimensions["B"].width = 10
        ws.column_dimensions["C"].width = 40
        ws.column_dimensions["D"].width = 10
        ws.column_dimensions["E"].width = 10
        ws.column_dimensions["F"].width = 8

        # ── Sheet 2: Estimate Summary ──
        ws2 = wb.create_sheet("Estimate Summary")

        ws2["A1"] = "Cabinet Estimate Summary"
        ws2["A1"].font = Font(bold=True, size=14)

        line_items = estimate.get("line_items", [])
        li_headers = [
            "Description", "Qty", "Unit",
            "Unit Price", "Total",
        ]
        for col, header in enumerate(li_headers, 1):
            cell = ws2.cell(
                row=3, column=col, value=header,
            )
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border

        for i, li in enumerate(line_items, 4):
            ws2.cell(
                row=i, column=1,
                value=li.get("description", ""),
            ).border = thin_border
            ws2.cell(
                row=i, column=2,
                value=round(li.get("quantity", 0), 2),
            ).border = thin_border
            ws2.cell(
                row=i, column=3,
                value=li.get("unit", ""),
            ).border = thin_border
            ws2.cell(
                row=i, column=4,
                value=round(
                    li.get("unit_price", 0), 2,
                ),
            ).border = thin_border
            ws2.cell(
                row=i, column=5,
                value=round(li.get("total", 0), 2),
            ).border = thin_border

        sr = 4 + len(line_items) + 1
        ws2.cell(
            row=sr, column=4, value="TOTAL:",
        ).font = Font(bold=True, size=12)
        ws2.cell(
            row=sr, column=5,
            value=estimate.get("total", 0),
        ).font = Font(bold=True, size=12)

        ws2.column_dimensions["A"].width = 40
        ws2.column_dimensions["B"].width = 10
        ws2.column_dimensions["C"].width = 8
        ws2.column_dimensions["D"].width = 12
        ws2.column_dimensions["E"].width = 12

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer
