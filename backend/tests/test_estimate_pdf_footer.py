"""
Every estimate PDF template must print the estimate number in its page footer.

The classic and modern templates printed only "Page N of M", so an exported
estimate carried no identifying number on any page after the first — and
classic is the default template, so this was the common case. The detailed and
professional templates already did it correctly via a string-set setter.

These assert on rendered HTML rather than a rendered PDF: WeasyPrint needs
system libraries that are only present in the deploy image, but the footer is
entirely determined by the CSS and the setter element, both visible here.
"""
import pytest

from app.core.pdf_generator import generate_estimate_html

TEMPLATES = ["classic", "modern", "detailed", "professional"]

ESTIMATE = {
    "estimate_number": "EST-1042",
    "estimate_date": "2026-09-07",
    "valid_until": None,
    "customer_name": "J Smith",
    "customer_address_line1": "2641 Sledding Hill Rd",
    "customer_city": "Vienna",
    "customer_state": "VA",
    "customer_zipcode": "22181",
    "company": {"name": "Acme Restoration", "address_line1": "1 Main St"},
    "sections": [
        {
            "name": "Labor",
            "items": [
                {
                    "name": "Pack-Out",
                    "quantity": 6,
                    "unit": "HR",
                    "unit_price": 300,
                    "total": 1800,
                    "description": "4-person crew",
                }
            ],
        }
    ],
    "subtotal": 1800,
    "tax_rate": 0,
    "tax_amount": 0,
    "total": 1800,
    "notes": "",
    "terms": "",
}


@pytest.mark.parametrize("template", TEMPLATES)
def test_footer_prints_the_estimate_number(template):
    html = generate_estimate_html(ESTIMATE, template)
    assert 'content: "Estimate #" string(doc-number)' in html, (
        f"{template}: page footer does not print the estimate number"
    )


@pytest.mark.parametrize("template", TEMPLATES)
def test_doc_number_string_is_actually_set(template):
    """A string() in a margin box renders empty unless something sets it."""
    html = generate_estimate_html(ESTIMATE, template)
    assert "string-set: doc-number content(text)" in html, (
        f"{template}: doc-number is never set, so the footer would be blank"
    )
    assert 'class="doc-number-setter">EST-1042<' in html, (
        f"{template}: the setter element does not carry the estimate number"
    )


@pytest.mark.parametrize("template", TEMPLATES)
def test_setter_is_not_visible_in_the_document_body(template):
    """The setter exists only to feed the footer; it must not render inline."""
    html = generate_estimate_html(ESTIMATE, template)
    assert ".page-header-data" in html, f"{template}: setter has no hiding rule"
    assert "visibility: hidden" in html, (
        f"{template}: setter container is not hidden, so it would print inline"
    )


@pytest.mark.parametrize("template", TEMPLATES)
def test_page_counter_is_still_present(template):
    """Adding the number must not displace the existing page counter."""
    html = generate_estimate_html(ESTIMATE, template)
    assert 'counter(page) " of " counter(pages)' in html, (
        f"{template}: lost its page counter"
    )
