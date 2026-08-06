"""
ScopeIt - E-Sign Available Field Registry

Registry of source entities/fields that a document template's "prefilled"
fields can auto-map from. Adding a new entity means one new registry key
plus one branch in resolve_entity_value() -- no schema changes elsewhere.
"""
from typing import Optional

from app.domains.company.models import Company
from app.domains.customer.models import Customer


AVAILABLE_FIELD_REGISTRY: dict[str, list[dict]] = {
    "customer": [
        {"source_field": "name", "label": "Customer Name", "type": "text"},
        {"source_field": "contact_name", "label": "Contact Name", "type": "text"},
        {"source_field": "email", "label": "Customer Email", "type": "text"},
        {"source_field": "phone", "label": "Customer Phone", "type": "text"},
        {"source_field": "address_line1", "label": "Address Line 1", "type": "text"},
        {"source_field": "address_line2", "label": "Address Line 2", "type": "text"},
        {"source_field": "city", "label": "City", "type": "text"},
        {"source_field": "state", "label": "State", "type": "text"},
        {"source_field": "zipcode", "label": "ZIP Code", "type": "text"},
        {"source_field": "country", "label": "Country", "type": "text"},
        {"source_field": "full_address", "label": "Full Address", "type": "text"},
    ],
    "company": [
        {"source_field": "name", "label": "Company Name", "type": "text"},
        {"source_field": "legal_name", "label": "Legal Name", "type": "text"},
        {"source_field": "email", "label": "Company Email", "type": "text"},
        {"source_field": "phone", "label": "Company Phone", "type": "text"},
        {"source_field": "website", "label": "Website", "type": "text"},
        {"source_field": "address_line1", "label": "Address Line 1", "type": "text"},
        {"source_field": "address_line2", "label": "Address Line 2", "type": "text"},
        {"source_field": "city", "label": "City", "type": "text"},
        {"source_field": "state", "label": "State", "type": "text"},
        {"source_field": "zipcode", "label": "ZIP Code", "type": "text"},
        {"source_field": "country", "label": "Country", "type": "text"},
        {"source_field": "full_address", "label": "Full Address", "type": "text"},
    ],
}


def get_available_fields() -> list[dict]:
    """Flattened registry for the GET /fields/available endpoint."""
    return [
        {
            "source_entity": entity,
            "source_field": field["source_field"],
            "label": field["label"],
            "type": field["type"],
        }
        for entity, fields in AVAILABLE_FIELD_REGISTRY.items()
        for field in fields
    ]


def is_valid_source(source_entity: Optional[str], source_field: Optional[str]) -> bool:
    """True if (source_entity, source_field) names a real registry entry."""
    if not source_entity or not source_field:
        return False
    return any(
        f["source_field"] == source_field
        for f in AVAILABLE_FIELD_REGISTRY.get(source_entity, [])
    )


def _company_full_address(company: Company) -> str:
    parts = [company.address_line1 or ""]
    if company.address_line2:
        parts.append(company.address_line2)
    if company.city or company.state or company.zipcode:
        city_state_zip = []
        if company.city:
            city_state_zip.append(company.city)
        state_zip = " ".join(filter(None, [company.state, company.zipcode]))
        if state_zip:
            city_state_zip.append(state_zip)
        parts.append(", ".join(city_state_zip))
    return ", ".join(p for p in parts if p)


def resolve_entity_value(
    source_entity: Optional[str],
    source_field: Optional[str],
    *,
    customer: Optional[Customer] = None,
    company: Optional[Company] = None,
) -> Optional[str]:
    """Resolve one (source_entity, source_field) pair against live ORM rows.
    Returns None if unresolvable (missing source row, unknown field, etc.)."""
    if not is_valid_source(source_entity, source_field):
        return None

    if source_entity == "customer":
        if not customer:
            return None
        if source_field == "full_address":
            value = customer.full_address
        else:
            value = getattr(customer, source_field, None)
    elif source_entity == "company":
        if not company:
            return None
        if source_field == "full_address":
            value = _company_full_address(company)
        else:
            value = getattr(company, source_field, None)
    else:
        return None

    return str(value) if value is not None else None
