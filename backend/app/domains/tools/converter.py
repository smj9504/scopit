"""
Scopit - Tool-to-Estimate Converter Interface

Each tool module implements this interface to convert its session data
into an estimate creation payload, reusing the existing estimate domain.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any


# Registry of converters: tool_id -> converter instance
_CONVERTERS: Dict[str, "ToolEstimateConverter"] = {}


class ToolEstimateConverter(ABC):
    """
    Abstract base for converting tool session data into estimate payloads.

    Each tool module implements this and registers itself via register_converter().
    The payload returned must match the EstimateCreate schema shape:
    {
        "title": "...",
        "sections": [
            {
                "name": "...",
                "order_index": 0,
                "items": [
                    {"name": "...", "unit": "SF", "quantity": 100, "unit_price": 1.50, "is_taxable": True}
                ]
            }
        ]
    }
    """

    @abstractmethod
    def to_estimate_payload(self, session_data: dict, **kwargs) -> dict:
        """Convert tool session data to EstimateCreate-compatible dict."""
        pass


def register_converter(tool_id: str, converter: ToolEstimateConverter):
    _CONVERTERS[tool_id] = converter


def get_converter(tool_id: str) -> ToolEstimateConverter | None:
    return _CONVERTERS.get(tool_id)
