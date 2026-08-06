"""
Scopit - Packing Estimate Converter

Converts packing/moving estimation results (EstimateResponse) stored in a
ToolSession into a Scopit EstimateCreate-compatible payload.

Session data shape (ToolSession.data JSONB):
{
    "result": {                         # Last calculated EstimateResponse (as dict)
        "sections": {"Pack-Out Labor": 1200.0, "Materials": 450.0, ...},
        "section_details": {
            "Pack-Out Labor": {
                "lines": [
                    {"name": "Pack labor - 4 crew", "detail": "8 hrs", "unit": "HR", "qty": 32, "rate": 37.50},
                    ...
                ]
            },
            ...
        },
        "material_details": [
            {"code": "SB", "name": "Small Box", "quantity": 20, "unit": "EA", "unit_price": 2.50, "total": 50.0},
            ...
        ],
        "subtotal": 5000.0,
        "op_amount": 1000.0,
        "contingency_amount": 250.0,
        "grand_total": 6250.0,
        ...
    },
    "client_info": {                    # Optional customer fields
        "name": "John Smith",
        "email": "john@example.com",
        "property_address": "123 Main St, Springfield, IL"
    },
    "settings": {                       # O&P / contingency flags and rates
        "include_op": true,
        "op_rate": 20,
        "include_contingency": true,
        "contingency_rate": 5
    }
}
"""
from app.domains.tools.converter import ToolEstimateConverter, register_converter


# Canonical display order matching the packing service output
_SECTION_ORDER = [
    "Pack-Out Labor",
    "Materials",
    "Transport Out",
    "On-Site Relocation",
    "Storage",
    "Debris Hauling",
    "Transport Back",
    "On-Site Pack-Back Move",
    "Pack-Back Labor",
    "Furniture Assembly",
    "Special Items",
]


class PackingEstimateConverter(ToolEstimateConverter):
    """Converts packing/moving estimation results into Scopit estimate sections and items."""

    def to_estimate_payload(self, session_data: dict, **kwargs) -> dict:
        """
        Convert packing estimation session data to an EstimateCreate-compatible payload.

        Parameters
        ----------
        session_data:
            The full ToolSession.data dict.  The ``result`` key holds the last
            computed EstimateResponse (serialised as a plain dict).
        **kwargs:
            Caller-supplied overrides forwarded from the bridge endpoint:
            ``title``, ``customer_id``, ``customer_name``.

        Returns
        -------
        dict
            A dict whose top-level keys are compatible with the inline estimate
            creation logic in ``tools/api.py::create_estimate_from_tool``:
            ``title``, ``customer_id``, ``customer_name``, ``customer_email``,
            ``customer_address``, ``sections``, and optionally ``adjustments``.
        """
        result = session_data.get("result", {})
        client_info = session_data.get("client_info", {})
        settings = session_data.get("settings", {})
        company_override = session_data.get("company_override") or {}

        sections_totals: dict = result.get("sections", {})
        section_details: dict = result.get("section_details", {})
        material_details: list = result.get("material_details") or []

        sections = []

        for idx, section_name in enumerate(_SECTION_ORDER):
            # Skip sections that were not computed (e.g. no storage, no pack-back)
            if section_name not in sections_totals:
                continue

            items = []

            if section_name == "Materials" and material_details:
                # Check if already grouped into categories
                # (Packing Supplies / Protective Wrapping / etc.)
                is_category = all(
                    m.get("unit") == "LS"
                    and m.get("quantity", 1) == 1
                    for m in material_details
                )
                if is_category:
                    # Use category lines as-is
                    for i, mat in enumerate(material_details):
                        items.append({
                            "name": mat.get("name", "Material"),
                            "description": mat.get("detail", ""),
                            "unit": "LS",
                            "quantity": 1.0,
                            "unit_price": float(
                                mat.get("unit_price")
                                or mat.get("total", 0)
                            ),
                            "amount": float(
                                mat.get("total", 0)
                            ),
                            "is_taxable": True,
                            "order_index": i,
                        })
                else:
                    # Legacy individual items — group into
                    # 3 categories matching estimate PDF
                    _specialty_codes = {
                        "3033", "3029", "3031",  # mirror, tv, lamp
                        "3036", "3037",  # mattress
                        "3035", "3034",  # sofa, chair cover
                    }
                    _supply_codes = {
                        "3026", "3025", "3027", "3028",  # boxes
                        "3024", "3030", "3032",  # book, dish, wardrobe
                        "3089", "3088",  # packing paper, tape
                    }
                    supply_total = 0.0
                    protective_total = 0.0
                    specialty_total = 0.0
                    for m in material_details:
                        t = float(m.get("total", 0))
                        code = m.get("code", "")
                        if code in _supply_codes:
                            supply_total += t
                        elif code in _specialty_codes:
                            specialty_total += t
                        else:
                            protective_total += t
                    idx = 0
                    if supply_total > 0:
                        items.append({
                            "name": "Packing Supplies",
                            "description": "",
                            "unit": "LS",
                            "quantity": 1.0,
                            "unit_price": round(supply_total, 2),
                            "amount": round(supply_total, 2),
                            "is_taxable": True,
                            "order_index": idx,
                        })
                        idx += 1
                    if protective_total > 0:
                        items.append({
                            "name": "Protective Wrapping",
                            "description": "",
                            "unit": "LS",
                            "quantity": 1.0,
                            "unit_price": round(
                                protective_total, 2
                            ),
                            "amount": round(
                                protective_total, 2
                            ),
                            "is_taxable": True,
                            "order_index": idx,
                        })
                        idx += 1
                    if specialty_total > 0:
                        items.append({
                            "name": "Specialty Packaging",
                            "description": "",
                            "unit": "LS",
                            "quantity": 1.0,
                            "unit_price": round(
                                specialty_total, 2
                            ),
                            "amount": round(
                                specialty_total, 2
                            ),
                            "is_taxable": True,
                            "order_index": idx,
                        })
            else:
                detail = section_details.get(section_name, {})
                lines: list = detail.get("lines", [])

                for line_idx, line in enumerate(lines):
                    items.append({
                        "name": line.get("name", section_name),
                        "description": line.get("detail", ""),
                        "unit": line.get("unit", "EA"),
                        "quantity": float(line.get("qty", 1)),
                        "unit_price": float(line.get("rate", 0)),
                        "amount": float(line.get("amount", 0)),
                        "is_taxable": True,
                        "order_index": line_idx,
                    })

            # Fallback: no line-level detail available — create one summary item
            if not items:
                section_total = sections_totals[section_name]
                items.append({
                    "name": section_name,
                    "description": "",
                    "unit": "EA",
                    "quantity": 1.0,
                    "unit_price": float(section_total),
                    "is_taxable": True,
                    "order_index": 0,
                })

            sections.append({
                "name": section_name,
                "order_index": idx,
                "items": items,
            })

        # Customer fields: prefer kwargs (caller may have looked up a customer record)
        # then fall back to whatever client_info was captured during the session.
        payload: dict = {
            "title": (
                kwargs.get("title")
                or "Packing & Moving Estimate"
            ),
            "customer_id": kwargs.get("customer_id"),
            "customer_name": (
                kwargs.get("customer_name")
                or client_info.get("name")
            ),
            "customer_email": client_info.get("email"),
            "customer_address": (
                client_info.get("property_address")
            ),
            "sections": sections,
            "company_override": company_override or None,
        }

        # O&P and contingency: surfaced as named premium adjustments so the
        # bridge endpoint (or future adjustment logic) can attach them to the
        # estimate rather than baking them silently into a line item.
        adjustments = []

        include_op = settings.get("include_op", result.get("include_op", False))
        op_amount = float(result.get("op_amount", 0))
        if include_op and op_amount > 0:
            op_rate = settings.get("op_rate", result.get("op_rate", 20))
            adjustments.append({
                "type": "premium",
                "name": f"Overhead & Profit ({op_rate}%)",
                "value": op_amount,
            })

        # Legacy contingency support
        include_contingency = settings.get(
            "include_contingency",
            result.get("include_contingency", False),
        )
        contingency_amount = float(result.get("contingency_amount", 0))
        if include_contingency and contingency_amount > 0:
            contingency_rate = settings.get(
                "contingency_rate",
                result.get("contingency_rate", 5),
            )
            adjustments.append({
                "name": f"Contingency ({contingency_rate}%)",
                "value": contingency_amount,
                "type": "contingency",
            })

        # Conditional supplements
        for supp in result.get("supplements", []):
            if supp.get("enabled", True) and supp.get("amount", 0) > 0:
                adjustments.append({
                    "name": supp["name"],
                    "value": supp["amount"],
                    "type": "supplement",
                })

        if adjustments:
            payload["adjustments"] = adjustments

        return payload


# Register converter so get_converter("packing") resolves this instance
register_converter("packing", PackingEstimateConverter())
