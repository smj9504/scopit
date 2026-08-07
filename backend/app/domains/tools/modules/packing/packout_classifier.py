"""
Packout Classifier — Classifies AI-detected items into packout categories.

Maps DetectedContentItem[] → non-boxable items + box counts for the
packout estimation workflow.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

from .schemas import (
    DetectedContentItem,
    NonBoxableItem,
    NonBoxableType,
    VolumeSize,
    WeightClass,
)

# ── Size/weight string → enum mapping ────────────────────────────────────────

_SIZE_TO_VOLUME: Dict[str, VolumeSize] = {
    "XS": VolumeSize.SMALL,
    "S": VolumeSize.SMALL,
    "M": VolumeSize.MEDIUM,
    "L": VolumeSize.LARGE,
    "XL": VolumeSize.LARGE,
    "XXL": VolumeSize.XLARGE,
}

_WEIGHT_TO_CLASS: Dict[str, WeightClass] = {
    "light": WeightClass.LIGHT,
    "medium": WeightClass.MODERATE,
    "heavy": WeightClass.HEAVY,
    "extra_heavy": WeightClass.EXTRA_HEAVY,
}

# ── Category → NonBoxableType mapping ────────────────────────────────────────

_CATEGORY_TYPE_MAP: Dict[str, Dict[str, NonBoxableType]] = {
    "Furniture": {
        "large": NonBoxableType.FURNITURE_LARGE,
        "default": NonBoxableType.FURNITURE_MEDIUM,
    },
    "Appliances": {
        "large": NonBoxableType.APPLIANCE_LARGE,
        "default": NonBoxableType.APPLIANCE_SMALL,
    },
    "Sports": {"default": NonBoxableType.SPORTS},
    "Tools": {"default": NonBoxableType.GARAGE},
}

# Items matching these categories with large size are non-boxable
_NON_BOXABLE_CATEGORIES = {"Furniture", "Appliances"}

# ── Protection material defaults by type ─────────────────────────────────────

PROTECTION_MAP: Dict[str, Dict[str, float]] = {
    "furniture_large": {"blanket": 2, "shrink_wrap_roll": 0.5, "furniture_pad": 1},
    "furniture_medium": {"blanket": 1, "shrink_wrap_roll": 0.3},
    "appliance_large": {"blanket": 1, "furniture_pad": 1, "shrink_wrap_roll": 0.5},
    "appliance_small": {"blanket": 1, "bubble_wrap": 1},
    "outdoor": {"blanket": 1, "shrink_wrap_roll": 0.5},
    "garage": {"blanket": 1},
    "specialty": {"blanket": 2, "furniture_pad": 2, "corner_protector": 4},
    "sports": {"blanket": 1, "shrink_wrap_roll": 0.3},
    "instruments": {"blanket": 2, "furniture_pad": 1, "corner_protector": 2},
    "rugs_art": {"blanket": 1, "corner_protector": 4},
    "custom": {"blanket": 1, "shrink_wrap_roll": 0.3},
}

# ── Box type mapping (category → box type + items per box) ───────────────────

_BOX_RULES: List[Dict[str, Any]] = [
    # category, condition_fn, box_type, items_per_box
    {"category": "Kitchenware", "condition": lambda i: i.is_fragile, "box": "dish_pack", "per_box": 12},
    {"category": "Kitchenware", "condition": lambda _: True, "box": "medium", "per_box": 10},
    {"category": "Clothing", "condition": lambda _: True, "box": "wardrobe", "per_box": 20},
    {"category": "Artwork", "condition": lambda _: True, "box": "picture", "per_box": 2},
    {"category": "Fragile", "condition": lambda i: (i.size or "M") in ("XS", "S", "M"), "box": "picture", "per_box": 2},
    {"category": "Books", "condition": lambda _: True, "box": "small", "per_box": 15},
    {"category": "Collectibles", "condition": lambda _: True, "box": "specialty", "per_box": 6},
]

# Default box mapping by item size
_SIZE_TO_BOX: Dict[str, str] = {
    "XS": "small",
    "S": "small",
    "M": "medium",
    "L": "large",
    "XL": "large",
    "XXL": "large",
}


# ── Room size → approx square footage (for floor coverage estimation) ────────

_ROOM_SF = {"small": 100, "large": 200, "xlarge": 350}

# Volume → approximate floor coverage per item (sq ft)
_VOLUME_FLOOR_SF = {
    VolumeSize.SMALL: 2,
    VolumeSize.MEDIUM: 6,
    VolumeSize.LARGE: 12,
    VolumeSize.XLARGE: 20,
}

_BOX_FLOOR_SF = {"small": 1.5, "medium": 2.5, "large": 4, "wardrobe": 4, "picture": 3, "dish_pack": 2.5, "specialty": 3}


# ── Public API ───────────────────────────────────────────────────────────────

def classify_items_for_packout(
    items: List[DetectedContentItem],
    detail_level: str = "detailed",
    room_size: str = "large",
) -> Dict[str, Any]:
    """Classify AI-detected items into packout categories.

    Args:
        items: AI-detected content items from vision analysis.
        detail_level: 'detailed' returns NonBoxableItem list;
                      'lump_sum' returns a single count.
        room_size: Room size for floor coverage estimation.

    Returns:
        dict with non_boxable_items (or lump_large_item_count),
        box_counts, blanket_count, estimated_floor_coverage_pct.
    """
    non_boxable_items: List[NonBoxableItem] = []
    box_counts: Dict[str, int] = {
        "small": 0, "medium": 0, "large": 0,
        "wardrobe": 0, "picture": 0, "dish_pack": 0, "specialty": 0,
    }

    for item in items:
        if _is_non_boxable(item):
            nb = _to_non_boxable_item(item)
            non_boxable_items.append(nb)
        else:
            _add_to_box_counts(item, box_counts)

    # Blanket count from protection materials
    blanket_count = sum(
        math.ceil(nb.quantity * PROTECTION_MAP.get(nb.type.value, {}).get("blanket", 1))
        for nb in non_boxable_items
    )

    # Floor coverage estimation
    room_sf = _ROOM_SF.get(room_size, 200)
    coverage_sf = 0.0
    for nb in non_boxable_items:
        coverage_sf += _VOLUME_FLOOR_SF.get(nb.volume, 6) * nb.quantity
    for bt, count in box_counts.items():
        coverage_sf += _BOX_FLOOR_SF.get(bt, 2.5) * count
    floor_coverage_pct = min(100.0, round((coverage_sf / room_sf) * 100, 1))

    if detail_level == "lump_sum":
        return {
            "non_boxable_items": [],
            "lump_large_item_count": sum(nb.quantity for nb in non_boxable_items),
            "box_counts": box_counts,
            "blanket_count": blanket_count,
            "estimated_floor_coverage_pct": floor_coverage_pct,
        }

    return {
        "non_boxable_items": [nb.model_dump() for nb in non_boxable_items],
        "lump_large_item_count": sum(nb.quantity for nb in non_boxable_items),
        "box_counts": box_counts,
        "blanket_count": blanket_count,
        "estimated_floor_coverage_pct": floor_coverage_pct,
    }


# ── Internal helpers ─────────────────────────────────────────────────────────

def _is_non_boxable(item: DetectedContentItem) -> bool:
    """Determine if an item is too large/heavy to box."""
    size = (item.size or "M").upper()
    weight = (item.weight or "medium").lower()
    cat = item.category or ""

    # Furniture and appliances with size L+ are non-boxable
    if cat in _NON_BOXABLE_CATEGORIES and size in ("L", "XL", "XXL"):
        return True

    # Items requiring disassembly are non-boxable
    if item.needs_disassembly:
        return True

    # Heavy/extra-heavy items in large categories
    if weight in ("heavy", "extra_heavy") and size in ("L", "XL", "XXL"):
        return True

    # Specific categories that are typically non-boxable
    if cat == "Sports" and size in ("L", "XL", "XXL"):
        return True
    if cat == "Tools" and weight in ("heavy", "extra_heavy"):
        return True

    return False


def _to_non_boxable_item(item: DetectedContentItem) -> NonBoxableItem:
    """Convert a DetectedContentItem to a NonBoxableItem."""
    cat = item.category or ""
    size = (item.size or "M").upper()
    weight_str = (item.weight or "medium").lower()

    # Determine type
    nb_type = NonBoxableType.CUSTOM
    cat_map = _CATEGORY_TYPE_MAP.get(cat)
    if cat_map:
        is_large = size in ("L", "XL", "XXL")
        nb_type = cat_map.get("large" if is_large else "default", cat_map["default"])
    elif cat == "Artwork" and size in ("L", "XL", "XXL"):
        nb_type = NonBoxableType.RUGS_ART
    elif item.needs_disassembly and cat == "Furniture":
        nb_type = NonBoxableType.FURNITURE_LARGE

    # Special detection for instruments, outdoor, specialty items
    name_lower = (item.name or "").lower()
    if any(kw in name_lower for kw in ("piano", "drum", "guitar amp", "organ")):
        nb_type = NonBoxableType.INSTRUMENTS
    elif any(kw in name_lower for kw in ("grill", "patio", "planter", "outdoor")):
        nb_type = NonBoxableType.OUTDOOR
    elif any(kw in name_lower for kw in ("pool table", "gun safe", "wine cellar", "hot tub")):
        nb_type = NonBoxableType.SPECIALTY

    # Volume and weight
    volume = _SIZE_TO_VOLUME.get(size, VolumeSize.MEDIUM)
    weight_cls = _WEIGHT_TO_CLASS.get(weight_str, WeightClass.MODERATE)

    # Protection materials
    protection_map = PROTECTION_MAP.get(nb_type.value, PROTECTION_MAP["custom"])
    protection = list(protection_map.keys())

    return NonBoxableItem(
        type=nb_type,
        custom_type_name=item.name if nb_type == NonBoxableType.CUSTOM else None,
        name=item.name,
        quantity=item.quantity,
        volume=volume,
        weight=weight_cls,
        protection=protection,
        needs_disassembly=item.needs_disassembly,
        needs_crating=item.is_high_value and size in ("L", "XL", "XXL"),
        special_instructions=item.special_instructions,
    )


def _add_to_box_counts(item: DetectedContentItem, box_counts: Dict[str, int]) -> None:
    """Classify a boxable item and add to box counts."""
    cat = item.category or ""
    qty = item.quantity

    # Check specific rules first
    for rule in _BOX_RULES:
        if rule["category"] == cat and rule["condition"](item):
            boxes_needed = max(1, math.ceil(qty / rule["per_box"]))
            box_counts[rule["box"]] = box_counts.get(rule["box"], 0) + boxes_needed
            return

    # Fallback: map by item size
    size = (item.size or "M").upper()
    box_type = _SIZE_TO_BOX.get(size, "medium")
    box_counts[box_type] = box_counts.get(box_type, 0) + max(1, math.ceil(qty / 8))
