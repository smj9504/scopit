"""
PDF Generation Utility using WeasyPrint and Jinja2 Templates
"""
import os
import platform

# Fix fontconfig/GTK on Windows BEFORE any GTK/WeasyPrint import
if platform.system() == "Windows":
    _gtk_root = r"C:\Program Files\GTK3-Runtime Win64"
    if os.path.isdir(_gtk_root):
        if not os.environ.get("FONTCONFIG_FILE"):
            os.environ["FONTCONFIG_FILE"] = os.path.join(
                _gtk_root, "etc", "fonts", "fonts.conf"
            )
        _gtk_bin = os.path.join(_gtk_root, "bin")
        if _gtk_bin not in os.environ.get("PATH", ""):
            os.environ["PATH"] = (
                _gtk_bin + os.pathsep + os.environ.get("PATH", "")
            )

from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, Dict

from jinja2 import Environment, FileSystemLoader, select_autoescape

# WeasyPrint is imported lazily in generate_pdf() to avoid GTK initialization issues on Windows

# Template directory
TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "pdf"

# Available templates
AVAILABLE_TEMPLATES = ["classic", "modern", "professional", "detailed"]
DEFAULT_TEMPLATE = "classic"

# Payment method display labels
PAYMENT_METHOD_LABELS = {
    "cash": "Cash",
    "check": "Check",
    "credit_card": "Credit Card",
    "bank_transfer": "Bank Transfer",
    "other": "Other",
}


def get_jinja_env() -> Environment:
    """Create and configure Jinja2 environment"""
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )

    # Register custom filters
    env.filters["format_currency"] = format_currency
    env.filters["format_date"] = format_date
    env.filters["format_quantity"] = format_quantity

    return env


def format_currency(amount: Decimal | float | int | None) -> str:
    """Format amount as currency"""
    if amount is None:
        return "$0.00"
    value = float(amount)
    if value < 0:
        return f"-${abs(value):,.2f}"
    return f"${value:,.2f}"


def format_date(d: date | str | None) -> str:
    """Format date as string"""
    if not d:
        return ""
    if isinstance(d, str):
        # Try to parse common date formats
        try:
            from datetime import datetime
            # Try ISO format first
            parsed = datetime.fromisoformat(d.replace("Z", "+00:00"))
            return parsed.strftime("%B %d, %Y")
        except (ValueError, AttributeError):
            return d
    return d.strftime("%B %d, %Y")


def format_quantity(qty: float | int | None) -> str:
    """Format quantity, removing trailing zeros"""
    if qty is None:
        return "0"
    value = float(qty)
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def validate_template(template_name: str) -> str:
    """Validate and return template name, defaulting if invalid"""
    if template_name and template_name.lower() in AVAILABLE_TEMPLATES:
        return template_name.lower()
    return DEFAULT_TEMPLATE


def prepare_invoice_data(invoice_data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare and normalize invoice data for template rendering"""
    # Extract company info
    company = invoice_data.get("company", {})
    if not company:
        company = {
            "name": invoice_data.get("company_name", ""),
            "address_line1": invoice_data.get("company_address", ""),
            "city": invoice_data.get("company_city", ""),
            "state": invoice_data.get("company_state", ""),
            "zipcode": invoice_data.get("company_zipcode", ""),
            "phone": invoice_data.get("company_phone", ""),
            "email": invoice_data.get("company_email", ""),
            "logo_url": invoice_data.get("logo_url", ""),
        }

    # Extract customer info
    customer = invoice_data.get("customer", {})
    if not customer:
        customer = {
            "name": invoice_data.get("customer_name", ""),
            "address": invoice_data.get("customer_address", ""),
            "city": invoice_data.get("customer_city", ""),
            "state": invoice_data.get("customer_state", ""),
            "zipcode": invoice_data.get("customer_zipcode", ""),
            "phone": invoice_data.get("customer_phone", ""),
            "email": invoice_data.get("customer_email", ""),
        }

    # Prepare sections with items
    sections = invoice_data.get("sections", [])
    if not sections:
        # If no sections, create a default one with all items
        items = invoice_data.get("items", [])
        sections = [{"name": "Items", "items": items, "subtotal": sum(i.get("total", 0) for i in items)}]

    # Normalize section items
    for section in sections:
        # Ensure section has 'items' key (required for template access)
        section.setdefault("items", [])
        for item in section["items"]:
            # Ensure item has all required fields
            item.setdefault("name", "")
            item.setdefault("description", "")
            item.setdefault("quantity", 0)
            item.setdefault("unit", "ea")
            item.setdefault("unit_price", 0)
            item.setdefault("total", float(item.get("quantity", 0)) * float(item.get("unit_price", 0)))
            item.setdefault("notes", [])
            item.setdefault("images", [])

    # Collect attached photos from all items
    attached_photos = []
    for section in sections:
        for item in section["items"]:
            for img in item.get("images", []):
                if img.get("data"):
                    attached_photos.append({
                        "line_item_name": item.get("name", ""),
                        "filename": img.get("filename", "photo"),
                        "data": img["data"],
                    })

    # Prepare adjustments
    adjustments = invoice_data.get("adjustments", [])
    for adj in adjustments:
        adj.setdefault("name", "")
        adj.setdefault("type", "premium")
        adj.setdefault("percentage", 0)
        adj.setdefault("amount", 0)

    # Prepare payments
    payments = invoice_data.get("payments", [])

    return {
        "invoice_number": invoice_data.get("invoice_number", ""),
        "invoice_date": invoice_data.get("invoice_date"),
        "due_date": invoice_data.get("due_date"),
        "company": company,
        "customer": customer,
        "sections": sections,
        "attached_photos": attached_photos,
        "adjustments": adjustments,
        "payments": payments,
        "subtotal": float(invoice_data.get("subtotal", 0)),
        "taxable_subtotal": float(invoice_data.get("taxable_subtotal", 0)),
        "adjustments_total": float(invoice_data.get("adjustments_total", 0)),
        "tax_rate": float(invoice_data.get("tax_rate", 0)),
        "tax_label": invoice_data.get("tax_label", "Tax"),
        "tax_amount": float(invoice_data.get("tax_amount", 0)),
        "total": float(invoice_data.get("total", 0)),
        "amount_paid": float(invoice_data.get("amount_paid", 0)),
        "balance_due": float(invoice_data.get("balance_due", 0)),
        "notes": invoice_data.get("notes", ""),
        "terms": invoice_data.get("terms", ""),
        "payment_schedule": invoice_data.get("payment_schedule") or [],
        "next_due_description": _get_next_due_description(
            invoice_data.get("payment_schedule") or [],
            float(invoice_data.get("amount_paid", 0)),
        ),
        "primary_color": invoice_data.get("primary_color", "#111827"),
        "secondary_color": invoice_data.get("secondary_color", "#6b7280"),
    }


def _get_next_due_description(
    schedule: list, amount_paid: float
) -> str:
    """Find the due description of the next unpaid payment step."""
    if not schedule:
        return ""
    cumulative = 0.0
    for step in schedule:
        cumulative += float(step.get("amount", 0))
        if cumulative > amount_paid + 0.01:
            return (
                step.get("due_description")
                or step.get("dueDescription")
                or ""
            )
    return ""


def prepare_estimate_data(estimate_data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare and normalize estimate data for template rendering"""
    # Extract company info
    company = estimate_data.get("company", {})
    if not company:
        company = {
            "name": estimate_data.get("company_name", ""),
            "address_line1": estimate_data.get("company_address", ""),
            "city": estimate_data.get("company_city", ""),
            "state": estimate_data.get("company_state", ""),
            "zipcode": estimate_data.get("company_zipcode", ""),
            "phone": estimate_data.get("company_phone", ""),
            "email": estimate_data.get("company_email", ""),
            "logo_url": estimate_data.get("logo_url", ""),
        }

    # Extract customer info
    customer = estimate_data.get("customer", {})
    if not customer:
        customer = {
            "name": estimate_data.get("customer_name", ""),
            "address": estimate_data.get("customer_address", ""),
            "city": estimate_data.get("customer_city", ""),
            "state": estimate_data.get("customer_state", ""),
            "zipcode": estimate_data.get("customer_zipcode", ""),
            "phone": estimate_data.get("customer_phone", ""),
            "email": estimate_data.get("customer_email", ""),
        }

    # Prepare sections with items
    sections = estimate_data.get("sections", [])
    if not sections:
        # If no sections, create a default one with all items
        items = estimate_data.get("items", [])
        sections = [{"name": "Items", "items": items, "subtotal": sum(i.get("total", 0) for i in items)}]

    # Normalize section items
    for section in sections:
        # Ensure section has 'items' key (required for template access)
        section.setdefault("items", [])
        for item in section["items"]:
            # Ensure item has all required fields
            item.setdefault("name", "")
            item.setdefault("description", "")
            item.setdefault("quantity", 0)
            item.setdefault("unit", "ea")
            item.setdefault("unit_price", 0)
            item.setdefault("total", float(item.get("quantity", 0)) * float(item.get("unit_price", 0)))
            item.setdefault("notes", [])
            item.setdefault("images", [])

    # Collect attached photos from all items
    attached_photos = []
    for section in sections:
        for item in section["items"]:
            for img in item.get("images", []):
                if img.get("data"):
                    attached_photos.append({
                        "line_item_name": item.get("name", ""),
                        "filename": img.get("filename", "photo"),
                        "data": img["data"],
                    })

    # Prepare adjustments
    adjustments = estimate_data.get("adjustments", [])
    for adj in adjustments:
        adj.setdefault("name", "")
        adj.setdefault("type", "premium")
        adj.setdefault("percentage", 0)
        adj.setdefault("amount", 0)

    return {
        "estimate_number": estimate_data.get("estimate_number", ""),
        "estimate_date": estimate_data.get("estimate_date"),
        "valid_until": estimate_data.get("valid_until"),
        "company": company,
        "customer": customer,
        "sections": sections,
        "attached_photos": attached_photos,
        "adjustments": adjustments,
        "subtotal": float(estimate_data.get("subtotal", 0)),
        "taxable_subtotal": float(estimate_data.get("taxable_subtotal", 0)),
        "adjustments_total": float(estimate_data.get("adjustments_total", 0)),
        "tax_rate": float(estimate_data.get("tax_rate", 0)),
        "tax_label": estimate_data.get("tax_label", "Tax"),
        "tax_amount": float(estimate_data.get("tax_amount", 0)),
        "total": float(estimate_data.get("total", 0)),
        "notes": estimate_data.get("notes", ""),
        "terms": estimate_data.get("terms", ""),
        "primary_color": estimate_data.get("primary_color", "#111827"),
        "secondary_color": estimate_data.get("secondary_color", "#6b7280"),
    }


def generate_invoice_html(
    invoice_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> str:
    """Generate HTML for invoice using specified template"""
    template_name = validate_template(template_name)
    env = get_jinja_env()
    template = env.get_template(f"invoice_{template_name}.html")

    # Prepare data
    data = prepare_invoice_data(invoice_data)

    return template.render(**data)


def generate_estimate_html(
    estimate_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> str:
    """Generate HTML for estimate using specified template"""
    template_name = validate_template(template_name)
    env = get_jinja_env()
    template = env.get_template(f"estimate_{template_name}.html")

    # Prepare data
    data = prepare_estimate_data(estimate_data)

    return template.render(**data)


def generate_pdf(html_content: str) -> BytesIO:
    """Generate PDF from HTML content"""
    import logging

    # Suppress noisy GLib/Pango/fontconfig warnings on Windows
    logging.getLogger("weasyprint").setLevel(logging.ERROR)

    # Lazy import to avoid GTK initialization issues on Windows
    from weasyprint import HTML

    html = HTML(string=html_content)
    pdf_bytes = BytesIO()

    # Write PDF
    html.write_pdf(pdf_bytes)

    pdf_bytes.seek(0)
    return pdf_bytes


def generate_invoice_pdf(
    invoice_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> BytesIO:
    """Generate invoice PDF using specified template"""
    html_content = generate_invoice_html(invoice_data, template_name)
    return generate_pdf(html_content)


def generate_estimate_pdf(
    estimate_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> BytesIO:
    """Generate estimate PDF using specified template"""
    html_content = generate_estimate_html(estimate_data, template_name)
    return generate_pdf(html_content)


# Legacy functions for backward compatibility
def generate_invoice_pdf_html(invoice_data: Dict[str, Any]) -> str:
    """Legacy function - Generate HTML for invoice PDF using default template"""
    return generate_invoice_html(invoice_data, DEFAULT_TEMPLATE)


def generate_estimate_pdf_html(estimate_data: Dict[str, Any]) -> str:
    """Legacy function - Generate HTML for estimate PDF using default template"""
    return generate_estimate_html(estimate_data, DEFAULT_TEMPLATE)


def get_available_templates() -> list:
    """Return list of available template names"""
    return AVAILABLE_TEMPLATES.copy()


def get_template_info() -> list:
    """Return template information for UI display"""
    return [
        {
            "id": "classic",
            "name": "Classic",
            "description": "Traditional, professional design with serif fonts",
        },
        {
            "id": "modern",
            "name": "Modern",
            "description": "Clean, minimal design with bold accents",
        },
        {
            "id": "professional",
            "name": "Professional",
            "description": "Business-formal with refined typography",
        },
        {
            "id": "detailed",
            "name": "Detailed",
            "description": "Section-based layout with prominent "
            "headers, subtotals, and line-item detail rows",
        },
    ]


def prepare_receipt_data(receipt_data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare and normalize payment receipt data for template rendering"""
    # Extract company info
    company = receipt_data.get("company", {})
    if not company:
        company = {
            "name": receipt_data.get("company_name", ""),
            "address_line1": receipt_data.get("company_address", ""),
            "city": receipt_data.get("company_city", ""),
            "state": receipt_data.get("company_state", ""),
            "zipcode": receipt_data.get("company_zipcode", ""),
            "phone": receipt_data.get("company_phone", ""),
            "email": receipt_data.get("company_email", ""),
            "logo_url": receipt_data.get("logo_url", ""),
        }

    # Extract customer info
    customer = receipt_data.get("customer", {})
    if not customer:
        customer = {
            "name": receipt_data.get("customer_name", ""),
            "address": receipt_data.get("customer_address", ""),
            "city": receipt_data.get("customer_city", ""),
            "state": receipt_data.get("customer_state", ""),
            "zipcode": receipt_data.get("customer_zipcode", ""),
            "phone": receipt_data.get("customer_phone", ""),
            "email": receipt_data.get("customer_email", ""),
        }

    # Get payment method label
    payment_method = receipt_data.get("payment_method", "other")
    payment_method_label = PAYMENT_METHOD_LABELS.get(payment_method, "Other")

    return {
        "receipt_number": receipt_data.get("receipt_number", ""),
        "invoice_number": receipt_data.get("invoice_number", ""),
        "payment_date": receipt_data.get("payment_date"),
        "payment_method": payment_method,
        "payment_method_label": payment_method_label,
        "reference_number": receipt_data.get("reference_number", ""),
        "payment_notes": receipt_data.get("payment_notes", ""),
        "company": company,
        "customer": customer,
        # Financial details
        "original_total": float(receipt_data.get("original_total", 0)),
        "previously_paid": float(receipt_data.get("previously_paid", 0)),
        "balance_before": float(receipt_data.get("balance_before", 0)),
        "this_payment": float(receipt_data.get("this_payment", 0)),
        "total_paid": float(receipt_data.get("total_paid", 0)),
        "remaining_balance": float(receipt_data.get("remaining_balance", 0)),
        # Styling
        "primary_color": receipt_data.get("primary_color", "#111827"),
        "secondary_color": receipt_data.get("secondary_color", "#6b7280"),
    }


def generate_receipt_html(
    receipt_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> str:
    """Generate HTML for payment receipt using specified template"""
    template_name = validate_template(template_name)
    env = get_jinja_env()
    template = env.get_template(f"receipt_{template_name}.html")

    # Prepare data
    data = prepare_receipt_data(receipt_data)

    return template.render(**data)


def generate_receipt_pdf(
    receipt_data: Dict[str, Any],
    template_name: str = DEFAULT_TEMPLATE
) -> BytesIO:
    """Generate payment receipt PDF using specified template"""
    html_content = generate_receipt_html(receipt_data, template_name)
    return generate_pdf(html_content)
