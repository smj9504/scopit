"""
Scopit - Bathroom estimate → Scopit estimate

Turns a calculated bathroom estimate into the payload tools/estimate_writer.py
writes as a Scopit estimate, sectioned by the estimate's phases the way its
PDF is (demo, rough trades, substrate, tile, fixtures, finish, punch list).

The calculator bakes overhead and profit into every unit price, so the line
items alone add up to the bathroom estimate's total. It bakes in the
material sales tax too (pricing.get_material_tax_loading: the contractor is
the taxed consumer, and tax is never a separate charge), so no line goes over
taxable: the company's default tax rate would charge that tax a second time.
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List

from .export_service import PHASE_LABELS

# EstimateItem.name is 255 characters
_NAME_MAX = 255
_CENT = Decimal("0.01")
# EstimateItem.quantity keeps 4 decimal places
_QTY = Decimal("0.0001")


def _cents(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)


def line_total(item: Dict[str, Any]) -> Decimal:
    """A line's total the way the Scopit estimate works it out
    (estimate/api.py recalculate_estimate): quantity to 4 places × unit
    price, rounded half up to the cent. Float round() would not match:
    2.5 × 405.73 is 1014.325, which it rounds down to 1014.32."""
    quantity = Decimal(str(item["quantity"])).quantize(_QTY, rounding=ROUND_HALF_UP)
    return (quantity * Decimal(str(item["unit_price"]))).quantize(_CENT, rounding=ROUND_HALF_UP)


def _lump(item: Dict[str, Any], total: Decimal) -> None:
    """Send a line over as one lump sum of `total`, its quantity noted."""
    noted = " ".join(filter(None, [f"{item['quantity']:g}", item["unit"], f"at ${item['unit_price']:,.2f}"]))
    item["description"] = "\n".join(filter(None, [noted, item["description"]]))
    item.update(quantity=1.0, unit="LS", unit_price=float(total))


def _item(li: Dict[str, Any], order: int) -> Dict[str, Any]:
    description = (li.get("description") or "").strip()
    name = description if len(description) <= _NAME_MAX else description[: _NAME_MAX - 1] + "…"
    details = [description] if name != description else []
    if li.get("notes"):
        details.append(li["notes"])
    quantity = float(li.get("quantity") or 0)
    unit_price = float(_cents(li.get("unit_price")))
    total = _cents(li.get("total"))
    item = {
        "name": name,
        "description": "\n".join(details) or None,
        "unit": li.get("unit"),
        "quantity": quantity,
        "unit_price": unit_price,
        # Material tax is already in the unit prices (see the module docstring)
        "is_taxable": False,
        "order_index": order,
    }
    if line_total(item) == total:
        return item
    if _cents(round(quantity * unit_price, 2)) == total:
        # The calculator's float round() took a half cent down (138.1 SF ×
        # $2.55 is 352.155, which it makes 352.15; the Scopit estimate makes
        # it 352.16). The line keeps its quantity and unit price, and
        # _true_up takes the cent back on a one-unit line.
        item["_total"] = total
        return item
    # A total set by hand may not be quantity × unit price; the Scopit
    # estimate keeps the total. When no unit price to the cent makes it, the
    # line goes over as one lump sum, its quantity noted.
    rebuilt = float(_cents(total / Decimal(str(quantity)))) if quantity else None
    if rebuilt is not None and line_total({"quantity": quantity, "unit_price": rebuilt}) == total:
        item["unit_price"] = rebuilt
    else:
        _lump(item, total)
    return item


def _true_up(sections: List[Dict[str, Any]], target: Any) -> None:
    """Make quantity × unit price add up to the bathroom total to the cent.

    A line the Scopit estimate rounds a half cent up, or one rebuilt from its
    total, can leave the sum a few cents off; a one-unit line takes the
    difference. With no one-unit line, the half-cent lines go over as lump
    sums of their own totals instead.
    """
    items = [it for s in sections for it in s["items"]]

    def drift() -> Decimal:
        return _cents(target) - sum((line_total(it) for it in items), Decimal("0"))

    off = drift()
    if off and not any(it["quantity"] == 1 for it in items):
        for it in items:
            if "_total" in it:
                _lump(it, it["_total"])
        off = drift()
    singles = [it for it in items if it["quantity"] == 1]
    if off and singles:
        largest = max(singles, key=lambda it: it["unit_price"])
        largest["unit_price"] = float(_cents(largest["unit_price"]) + off)
    for it in items:
        it.pop("_total", None)


def title_for(estimate: Dict[str, Any]) -> str:
    designation = (estimate.get("designation") or "").replace("_", " ").strip()
    parts = [f"{designation.title()} Bathroom" if designation else "Bathroom"]
    if estimate.get("kind") == "option" and estimate.get("option_label"):
        parts.append(estimate["option_label"])
    if estimate.get("property_address"):
        parts.append(estimate["property_address"])
    return " — ".join(parts)[:255]


def to_estimate_payload(estimate: Dict[str, Any]) -> Dict[str, Any]:
    """The Scopit estimate payload for a calculated bathroom estimate (a service._full dict)."""
    line_items = sorted(
        estimate.get("line_items") or [],
        key=lambda li: (li.get("phase") or 0, li.get("display_order") or 0),
    )
    grouped: List[Dict[str, Any]] = []
    for phase, label in sorted(PHASE_LABELS.items()):
        items = [li for li in line_items if li.get("phase") == phase]
        if items:
            grouped.append({"title": label, "items": items})
    # A phase the PDF doesn't name still has to be on the estimate
    leftover = [li for li in line_items if li.get("phase") not in PHASE_LABELS]
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

    description_lines = []
    if estimate.get("claim_number"):
        description_lines.append(f"Claim #: {estimate['claim_number']}")
    if estimate.get("overview_text"):
        description_lines.append(estimate["overview_text"])
    return {
        "title": title_for(estimate),
        "description": "\n\n".join(description_lines) or None,
        "sections": sections,
    }
