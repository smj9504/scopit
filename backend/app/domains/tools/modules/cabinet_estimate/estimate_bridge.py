"""
Scopit - Cabinet estimate → Scopit estimate

Turns a calculated cabinet estimate into the payload tools/estimate_writer.py
writes as a Scopit estimate, sectioned the way the customer PDF is: each
install line folded into the supply line it installs, grouped by part of
the job (cabinets, demolition, plumbing, countertop...), and the island
apart when there is one.

The calculator bakes overhead and profit into every unit price, so the line
items alone add up to the cabinet estimate's total.
"""
from typing import Any, Dict, List

from .export_service import _group_line_items, _merge_install_into_supply

# EstimateItem.name is 255 characters
_NAME_MAX = 255


def _item(li: Dict[str, Any], order: int) -> Dict[str, Any]:
    description = (li.get("description") or "").strip()
    name = description if len(description) <= _NAME_MAX else description[: _NAME_MAX - 1] + "…"
    details = [description] if name != description else []
    if li.get("notes"):
        details.append(li["notes"])
    return {
        "name": name,
        "description": "\n".join(details) or None,
        "unit": li.get("unit"),
        "quantity": float(li.get("quantity") or 0),
        "unit_price": round(float(li.get("unit_price") or 0), 2),
        "is_taxable": True,
        "order_index": order,
    }


def _true_up(sections: List[Dict[str, Any]], target: float) -> None:
    """Make quantity × unit price add up to the cabinet total to the cent.

    Folding install into supply splits an install line's dollars over
    several supply lines, which can leave a line a cent off quantity × unit
    price. A one-unit line takes the difference.
    """
    items = [it for s in sections for it in s["items"]]
    drift = round(target - sum(round(it["quantity"] * it["unit_price"], 2) for it in items), 2)
    if not drift:
        return
    singles = [it for it in items if it["quantity"] == 1]
    if singles:
        largest = max(singles, key=lambda it: it["unit_price"])
        largest["unit_price"] = round(largest["unit_price"] + drift, 2)


def title_for(estimate: Dict[str, Any]) -> str:
    parts = ["Kitchen Cabinets"]
    if estimate.get("kind") == "option" and estimate.get("option_label"):
        parts.append(estimate["option_label"])
    if estimate.get("property_address"):
        parts.append(estimate["property_address"])
    return " — ".join(parts)[:255]


def to_estimate_payload(estimate: Dict[str, Any]) -> Dict[str, Any]:
    """The Scopit estimate payload for a calculated cabinet estimate (a service._full dict)."""
    line_items = estimate.get("line_items") or []
    merged = _merge_install_into_supply(line_items)
    grouped = _group_line_items(merged)

    # Anything the PDF's sections don't name still has to be on the estimate
    placed = {id(li) for g in grouped for li in g["items"]}
    leftover = [li for li in merged if id(li) not in placed]
    if leftover:
        grouped.append({"title": "Other", "items": leftover})

    sections = [
        {
            "name": g["title"],
            "order_index": i,
            "items": [_item(li, j) for j, li in enumerate(g["items"])],
        }
        for i, g in enumerate(grouped)
    ]
    _true_up(sections, round(float(estimate.get("total") or 0), 2))

    description = None
    if estimate.get("claim_number"):
        description = f"Claim #: {estimate['claim_number']}"
    return {
        "title": title_for(estimate),
        "description": description,
        "sections": sections,
    }
