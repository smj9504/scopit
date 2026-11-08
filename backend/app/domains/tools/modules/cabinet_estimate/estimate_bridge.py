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
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List

from .export_service import _group_line_items, _merge_install_into_supply

# EstimateItem.name is 255 characters
_NAME_MAX = 255
_CENT = Decimal("0.01")
# EstimateItem.quantity keeps 4 decimal places
_QTY = Decimal("0.0001")


def _cents(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(_CENT, rounding=ROUND_HALF_UP)


def line_total(item: Dict[str, Any]) -> Decimal:
    """A line's total the way the Scopit estimate works it out
    (estimate/api.py recalculate_estimate): quantity × unit price, rounded
    half up to the cent. Float round() would not do: 2.5 × 405.73 is
    1014.325, which it rounds down to 1014.32 where the estimate shows 1014.33.
    """
    quantity = Decimal(str(item["quantity"])).quantize(_QTY, rounding=ROUND_HALF_UP)
    return (quantity * Decimal(str(item["unit_price"]))).quantize(_CENT, rounding=ROUND_HALF_UP)


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
        "unit_price": float(_cents(li.get("unit_price") or 0)),
        "is_taxable": True,
        "order_index": order,
    }


def _true_up(sections: List[Dict[str, Any]], target: Any) -> None:
    """Make the estimate's line totals add up to the cabinet total to the cent.

    Rounding each line to the cent (2.5 LF × $405.73 shows as $1,014.33), and
    folding install into supply, which splits an install line's dollars over
    several supply lines, can leave the lines a few cents off the total. A
    one-unit line takes the difference.
    """
    items = [it for s in sections for it in s["items"]]
    drift = _cents(target) - sum((line_total(it) for it in items), Decimal("0"))
    if not drift:
        return
    singles = [it for it in items if it["quantity"] == 1]
    if singles:
        largest = max(singles, key=lambda it: it["unit_price"])
        largest["unit_price"] = float(_cents(largest["unit_price"]) + drift)


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
    _true_up(sections, estimate.get("total") or 0)

    description = None
    if estimate.get("claim_number"):
        description = f"Claim #: {estimate['claim_number']}"
    return {
        "title": title_for(estimate),
        "description": description,
        "sections": sections,
    }
