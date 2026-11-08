"""
What the product library knows: the kinds of product it holds, the units a
price can be in, and the retailers it reads.

Shared by the Cabinet and Bathroom Estimators' upgrade options. The frontend
reads these through GET /api/products/meta rather than keeping a copy.
"""

from typing import Dict, List, Optional
from urllib.parse import urlparse

# key -> (label, trade). Trade says which estimates offer it first; any
# estimate can still pick any category.
CATEGORIES: Dict[str, Dict[str, str]] = {
    "cabinet": {"label": "Cabinets (line / door style)", "trade": "kitchen"},
    "cabinet_hardware": {"label": "Cabinet hardware", "trade": "kitchen"},
    "countertop": {"label": "Countertop", "trade": "kitchen"},
    "backsplash": {"label": "Backsplash tile", "trade": "kitchen"},
    "kitchen_sink": {"label": "Kitchen sink", "trade": "kitchen"},
    "kitchen_faucet": {"label": "Kitchen faucet", "trade": "kitchen"},
    "appliance": {"label": "Appliance", "trade": "kitchen"},
    "vanity": {"label": "Vanity", "trade": "bathroom"},
    "vanity_top": {"label": "Vanity top", "trade": "bathroom"},
    "bath_faucet": {"label": "Bath faucet", "trade": "bathroom"},
    "bathtub": {"label": "Bathtub", "trade": "bathroom"},
    "shower_base": {"label": "Shower base", "trade": "bathroom"},
    "shower_door": {"label": "Shower door", "trade": "bathroom"},
    "toilet": {"label": "Toilet", "trade": "bathroom"},
    "mirror": {"label": "Mirror", "trade": "bathroom"},
    "light": {"label": "Light fixture", "trade": "both"},
    "floor_tile": {"label": "Floor tile", "trade": "both"},
    "wall_tile": {"label": "Wall tile", "trade": "both"},
    "flooring": {"label": "Flooring (wood / vinyl plank)", "trade": "both"},
    "other": {"label": "Other", "trade": "both"},
}

# What a price is for: one item, a square foot, a box (of box_sf square
# feet, for tile), or a linear foot.
PRICE_UNITS: Dict[str, str] = {
    "each": "each",
    "sf": "per sq ft",
    "box": "per box",
    "lf": "per linear ft",
}

# Retailers recognised from a link's host; anything else is "other".
RETAILERS: Dict[str, Dict[str, object]] = {
    "home_depot": {"label": "The Home Depot", "hosts": ["homedepot.com"]},
    "lowes": {"label": "Lowe's", "hosts": ["lowes.com"]},
    "wayfair": {"label": "Wayfair", "hosts": ["wayfair.com"]},
    "amazon": {"label": "Amazon", "hosts": ["amazon.com", "a.co", "amzn.to"]},
    "floor_decor": {"label": "Floor & Decor", "hosts": ["flooranddecor.com"]},
    "build_com": {"label": "Build.com", "hosts": ["build.com"]},
    "ferguson": {"label": "Ferguson", "hosts": ["ferguson.com"]},
    "ikea": {"label": "IKEA", "hosts": ["ikea.com"]},
    "other": {"label": "Other", "hosts": []},
}


# How a product looks, for the 2D/3D drawings: the values each look key can
# take. Claude picks from these when it reads a listing (extract.py).
LOOK_OPTIONS: Dict[str, List[str]] = {
    "material": [
        "quartz", "granite", "marble", "quartzite", "solid_surface", "laminate", "butcher_block",
        "wood", "painted_wood", "porcelain", "ceramic", "glass", "natural_stone", "stainless_steel",
        "fireclay", "composite", "cast_iron", "acrylic", "vinyl", "brass", "metal", "other",
    ],
    "door_style": ["shaker", "raised", "slab", "glass", "beadboard", "other"],
    "hardware_style": ["bar", "knob", "cup", "edge", "other"],
    "sink_type": ["undermount", "farmhouse", "drop_in", "vessel", "other"],
    "faucet_style": ["gooseneck", "pull_down", "single_handle", "widespread", "centerset", "wall_mount", "other"],
    "pattern": ["subway", "herringbone", "hexagon", "square", "plank", "mosaic", "other"],
}


def retailer_of(url: Optional[str]) -> str:
    """The retailer a link is from, by its host; "other" when unknown."""
    host = (urlparse(url or "").hostname or "").lower()
    for key, info in RETAILERS.items():
        if any(host == h or host.endswith("." + h) for h in info["hosts"]):  # type: ignore[union-attr]
            return key
    return "other"


def meta() -> Dict[str, object]:
    return {
        "categories": [{"key": k, "label": v["label"], "trade": v["trade"]} for k, v in CATEGORIES.items()],
        "price_units": [{"key": k, "label": v} for k, v in PRICE_UNITS.items()],
        "retailers": [{"key": k, "label": str(v["label"])} for k, v in RETAILERS.items()],
        "look_options": LOOK_OPTIONS,
    }
