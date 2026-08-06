"""
Scopit - Roof Analyzer Estimate Converter

Converts roof analysis session data into estimate line items.
"""
from app.domains.tools.converter import ToolEstimateConverter, register_converter


class RoofEstimateConverter(ToolEstimateConverter):
    """Converts roof analysis results into estimate sections/items."""

    def to_estimate_payload(self, session_data: dict, **kwargs) -> dict:
        """
        Convert roof analysis data to estimate payload.

        Expected session_data shape (when fully implemented):
        {
            "faces": [{"id": "F1", "area_sqft": 500, "slope": "6/12", ...}],
            "total_area_sqft": 2500,
            "accessories": {"ridge_ft": 120, "valley_ft": 80, ...}
        }
        """
        sections = []
        items = []

        total_area = session_data.get("total_area_sqft", 0)
        if total_area > 0:
            # Convert squares (1 square = 100 sqft)
            squares = round(total_area / 100, 2)
            items.append({
                "name": "Roofing Shingles",
                "description": f"Total roof area: {total_area} sqft",
                "unit": "SQ",
                "quantity": squares,
                "unit_price": 0,
                "is_taxable": True,
                "order_index": 0,
            })

        accessories = session_data.get("accessories", {})
        order = 1
        if accessories.get("ridge_ft", 0) > 0:
            items.append({
                "name": "Ridge Cap",
                "unit": "LF",
                "quantity": accessories["ridge_ft"],
                "unit_price": 0,
                "is_taxable": True,
                "order_index": order,
            })
            order += 1

        if accessories.get("valley_ft", 0) > 0:
            items.append({
                "name": "Valley Metal",
                "unit": "LF",
                "quantity": accessories["valley_ft"],
                "unit_price": 0,
                "is_taxable": True,
                "order_index": order,
            })
            order += 1

        if items:
            sections.append({
                "name": "Roofing",
                "order_index": 0,
                "items": items,
            })

        return {
            "title": kwargs.get("title") or "Roof Estimate",
            "customer_id": kwargs.get("customer_id"),
            "customer_name": kwargs.get("customer_name"),
            "sections": sections,
        }


# Register this converter
register_converter("roof_analyzer", RoofEstimateConverter())
