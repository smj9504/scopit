"""
Scopit - Packing Tool Room Presets

Room presets as Python constants (reference data, not user-editable).
Ported from moving_estimate standalone application.
"""

from typing import Any, Dict

ROOM_PRESETS: Dict[str, Dict[str, Any]] = {
    # ── Bedrooms ──────────────────────────────────────────────────────
    "bedroom_standard": {
        "name": "Bedroom - Standard",
        "category": "Bedroom",
        "size": "large",
        "base_items": 100,
        "default_hints": ["clothing_hanging", "clothing_folded", "furniture"],
        "mattress": "queen",
    },
    "bedroom_kids": {
        "name": "Bedroom - Kids",
        "category": "Bedroom",
        "size": "large",
        "base_items": 120,
        "default_hints": ["clothing_folded", "toys", "books", "furniture"],
        "mattress": "twin",
    },
    "bedroom_guest": {
        "name": "Bedroom - Guest",
        "category": "Bedroom",
        "size": "large",
        "base_items": 60,
        "default_hints": ["clothing_hanging", "furniture"],
        "mattress": "full",
    },
    "bedroom_master": {
        "name": "Master Bedroom",
        "category": "Bedroom",
        "size": "xlarge",
        "base_items": 150,
        "default_hints": ["clothing_hanging", "clothing_folded", "electronics", "furniture", "artwork"],
        "mattress": "king",
    },

    # ── Kitchen ───────────────────────────────────────────────────────
    "kitchen_standard": {
        "name": "Kitchen - Standard",
        "category": "Kitchen",
        "size": "large",
        "base_items": 90,
        "default_hints": ["kitchenware", "appliances_small", "fragile"],
        "mattress": None,
    },
    "kitchen_chef": {
        "name": "Kitchen - Chef's",
        "category": "Kitchen",
        "size": "xlarge",
        "base_items": 150,
        "default_hints": ["kitchenware", "appliances_small", "appliances_large", "fragile"],
        "mattress": None,
    },
    "kitchen_china": {
        "name": "Kitchen - Fine China",
        "category": "Kitchen",
        "size": "large",
        "base_items": 120,
        "default_hints": ["kitchenware", "fragile", "collectibles"],
        "mattress": None,
    },

    # ── Living ────────────────────────────────────────────────────────
    "living_standard": {
        "name": "Living Room - Standard",
        "category": "Living",
        "size": "large",
        "base_items": 80,
        "default_hints": ["electronics", "furniture", "artwork"],
        "mattress": None,
    },
    "living_entertainment": {
        "name": "Living Room - Entertainment",
        "category": "Living",
        "size": "xlarge",
        "base_items": 100,
        "default_hints": ["electronics", "furniture", "artwork", "collectibles"],
        "mattress": None,
    },
    "dining_standard": {
        "name": "Dining Room",
        "category": "Living",
        "size": "large",
        "base_items": 60,
        "default_hints": ["fragile", "furniture", "artwork"],
        "mattress": None,
    },

    # ── Office ────────────────────────────────────────────────────────
    "office_standard": {
        "name": "Office - Standard",
        "category": "Office",
        "size": "large",
        "base_items": 100,
        "default_hints": ["electronics", "books", "furniture"],
        "mattress": None,
    },
    "office_library": {
        "name": "Office - Library/Study",
        "category": "Office",
        "size": "xlarge",
        "base_items": 180,
        "default_hints": ["books", "collectibles", "furniture", "artwork"],
        "mattress": None,
    },
    "office_tech": {
        "name": "Office - Tech Heavy",
        "category": "Office",
        "size": "xlarge",
        "base_items": 120,
        "default_hints": ["electronics", "furniture"],
        "mattress": None,
    },

    # ── Storage ───────────────────────────────────────────────────────
    "basement_standard": {
        "name": "Basement - Standard",
        "category": "Storage",
        "size": "xlarge",
        "base_items": 175,
        "default_hints": ["furniture", "boxes_stored", "tools"],
        "mattress": None,
    },
    "basement_finished": {
        "name": "Basement - Finished",
        "category": "Storage",
        "size": "xlarge",
        "base_items": 200,
        "default_hints": ["electronics", "furniture", "boxes_stored", "collectibles"],
        "mattress": None,
    },
    "garage": {
        "name": "Garage",
        "category": "Storage",
        "size": "xlarge",
        "base_items": 150,
        "default_hints": ["tools", "sports", "boxes_stored"],
        "mattress": None,
    },
    "attic": {
        "name": "Attic",
        "category": "Storage",
        "size": "large",
        "base_items": 100,
        "default_hints": ["boxes_stored", "fragile", "collectibles"],
        "mattress": None,
    },

    # ── Small Rooms ───────────────────────────────────────────────────
    "bathroom": {
        "name": "Bathroom",
        "category": "Small",
        "size": "small",
        "base_items": 35,
        "default_hints": ["fragile"],
        "mattress": None,
    },
    "closet_walk": {
        "name": "Walk-in Closet",
        "category": "Small",
        "size": "small",
        "base_items": 80,
        "default_hints": ["clothing_hanging", "clothing_folded"],
        "mattress": None,
    },
    "closet_standard": {
        "name": "Closet - Standard",
        "category": "Small",
        "size": "small",
        "base_items": 40,
        "default_hints": ["clothing_hanging"],
        "mattress": None,
    },
    "laundry": {
        "name": "Laundry Room",
        "category": "Small",
        "size": "small",
        "base_items": 30,
        "default_hints": ["appliances_large"],
        "mattress": None,
    },
    "entryway": {
        "name": "Entryway/Foyer",
        "category": "Small",
        "size": "small",
        "base_items": 25,
        "default_hints": ["furniture", "artwork"],
        "mattress": None,
    },

    # ── Specialty ─────────────────────────────────────────────────────
    "gym": {
        "name": "Home Gym",
        "category": "Specialty",
        "size": "xlarge",
        "base_items": 50,
        "default_hints": ["equipment_heavy", "electronics"],
        "mattress": None,
    },
    "music_room": {
        "name": "Music Room",
        "category": "Specialty",
        "size": "large",
        "base_items": 60,
        "default_hints": ["instruments", "electronics", "furniture"],
        "mattress": None,
    },

    # ── Outdoor ───────────────────────────────────────────────────────
    "outdoor_patio": {
        "name": "Patio / Deck",
        "category": "Outdoor",
        "size": "large",
        "base_items": 40,
        "default_hints": ["furniture", "equipment_heavy"],
        "mattress": None,
    },
    "outdoor_shed": {
        "name": "Shed",
        "category": "Outdoor",
        "size": "large",
        "base_items": 60,
        "default_hints": ["tools", "equipment_heavy", "boxes_stored"],
        "mattress": None,
    },
    "outdoor_garage_detached": {
        "name": "Detached Garage",
        "category": "Outdoor",
        "size": "xlarge",
        "base_items": 120,
        "default_hints": ["tools", "sports", "equipment_heavy", "boxes_stored"],
        "mattress": None,
    },
}


def get_preset(key: str) -> dict | None:
    """Get a room preset by key."""
    return ROOM_PRESETS.get(key)


def get_all_presets() -> dict:
    """Get all room presets."""
    return ROOM_PRESETS


def get_presets_by_category() -> dict:
    """Get room presets grouped by category."""
    categories = {}
    for key, preset in ROOM_PRESETS.items():
        cat = preset["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({"key": key, **preset})
    return categories
