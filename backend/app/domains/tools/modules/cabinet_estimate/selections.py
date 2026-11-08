"""
Products an upgrade option is built from.

An option of a kitchen job can take products from the shared product
library (app/domains/product_library), one per slot: the cabinet line, the
hardware, the countertop, the backsplash tile, the sink and the faucet.
Each is kept on the estimate as a snapshot (ProductSnapshot), never a live
reference, so the estimate stays as it was priced.

A chosen product prices the material of its lines at the product's own
price; our labor stays on the rate tables (decided with the user,
2026-10-26: "product price + our labor"). A restoration never takes
products: the carrier's estimate is priced from the rate tables alone.

The functions here turn a snapshot's price, in whatever unit the retailer
sells it (each / sq ft / box / linear ft), into the unit a line is quoted
in. They return None when it can't be done, and the calculator then keeps
the rate-table price and says why in the warnings.
"""

from typing import Any, Dict, List, Optional

# slot → what it is, the library category it takes products from, and what
# it changes. The order is the order they're listed on screen and in the PDF.
SLOTS: List[Dict[str, str]] = [
    {
        "key": "cabinets",
        "label": "Cabinets",
        "category": "cabinet",
        "prices": "Cabinet supply, at the product's price per linear foot",
    },
    {
        "key": "cabinet_hardware",
        "label": "Hardware",
        "category": "cabinet_hardware",
        "prices": "One per door and drawer front",
    },
    {
        "key": "countertop",
        "label": "Countertop",
        "category": "countertop",
        "prices": "Countertop material per sq ft, plus our fabrication and install",
    },
    {
        "key": "backsplash",
        "label": "Backsplash",
        "category": "backsplash",
        "prices": "Tile per sq ft with overage, plus our install",
    },
    {
        "key": "kitchen_sink",
        "label": "Sink",
        "category": "kitchen_sink",
        "prices": "One per sink base (needs the plumbing scope)",
    },
    {
        "key": "kitchen_faucet",
        "label": "Faucet",
        "category": "kitchen_faucet",
        "prices": "One per sink (needs the plumbing scope)",
    },
]
SLOT_KEYS = {s["key"] for s in SLOTS}
SLOT_CATEGORY = {s["key"]: s["category"] for s in SLOTS}

# A retail listing's price is over the counter: nothing for sourcing,
# pickup or delivery, storage, or the return and damage risk we carry on
# it. The same loading bathroom options put on a retail price
# (bathroom_estimate.pricing.MATERIAL_HANDLING), so the two trades quote a
# product alike.
MATERIAL_HANDLING = 1.15

# Material bought over what is installed: cut loss and spares. Working
# assumptions, the same allowance a tile setter or fabricator adds.
TILE_OVERAGE = 1.10
COUNTERTOP_OVERAGE = 1.10


def with_handling(price: float) -> float:
    """A retail price as we carry it (MATERIAL_HANDLING)."""
    return round(price * MATERIAL_HANDLING, 2)

# A countertop priced by the piece or the linear foot is a standard-depth
# top unless the listing says otherwise.
COUNTERTOP_DEPTH_IN = 25.5

# Telling base, wall and tall cabinets apart by size, for a cabinet product
# whose listing gives its size: a wall cabinet is shallow, a tall one is
# floor to (near) ceiling.
WALL_CABINET_MAX_DEPTH_IN = 15
TALL_CABINET_MIN_HEIGHT_IN = 80


def _num(v: Any) -> Optional[float]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def price_of(product: Dict[str, Any]) -> Optional[float]:
    return _num(product.get("price"))


def each_price(product: Dict[str, Any]) -> Optional[float]:
    """Price of one piece: a sink, a faucet, a pull."""
    if product.get("price_unit", "each") != "each":
        return None
    return price_of(product)


def sf_price(product: Dict[str, Any], depth_in: Optional[float] = None) -> Optional[float]:
    """Price per square foot, however it's sold.

    sf as is; a box over the square feet it covers; a piece (tile or top)
    over its own area; a linear foot over the depth (depth_in, for a top).
    """
    price = price_of(product)
    if price is None:
        return None
    unit = product.get("price_unit", "each")
    if unit == "sf":
        return price
    if unit == "box":
        box_sf = _num(product.get("box_sf"))
        return price / box_sf if box_sf else None
    if unit == "lf":
        depth = _num(product.get("depth_in")) or depth_in
        return price / (depth / 12) if depth else None
    # each: a tile, or a top cut to a size
    tile_w, tile_l = _num(product.get("tile_width_in")), _num(product.get("tile_length_in"))
    if tile_w and tile_l:
        return price / (tile_w * tile_l / 144)
    width = _num(product.get("width_in"))
    depth = _num(product.get("depth_in")) or depth_in
    if width and depth:
        return price / (width * depth / 144)
    return None


def cabinet_kind(product: Dict[str, Any]) -> str:
    """base / wall / tall, from the listing's size (base when it doesn't say)."""
    height = _num(product.get("height_in"))
    depth = _num(product.get("depth_in"))
    if height and height >= TALL_CABINET_MIN_HEIGHT_IN:
        return "tall"
    if depth and depth <= WALL_CABINET_MAX_DEPTH_IN:
        return "wall"
    return "base"


def lf_price(product: Dict[str, Any]) -> Optional[float]:
    """Price per linear foot of cabinet: lf as is, or one cabinet over its width."""
    price = price_of(product)
    if price is None:
        return None
    unit = product.get("price_unit", "each")
    if unit == "lf":
        return price
    if unit == "each":
        width = _num(product.get("width_in"))
        return price / (width / 12) if width else None
    return None


def product_name(product: Dict[str, Any]) -> str:
    """The product as a line names it: brand, title, finish."""
    title = (product.get("title") or "").strip()
    brand = (product.get("brand") or "").strip()
    name = title if not brand or title.lower().startswith(brand.lower()) else f"{brand} {title}"
    finish = (product.get("finish") or "").strip()
    if finish and finish.lower() not in name.lower():
        name = f"{name} ({finish})"
    return name[:300]


_UNIT_SHORT = {"each": "ea", "sf": "sq ft", "box": "box", "lf": "lin ft"}


def product_note(product: Dict[str, Any], extra: Optional[str] = None) -> str:
    """Where it's from and what it costs there, for the line's notes."""
    parts = []
    retailer = product.get("retailer_label") or product.get("retailer")
    if retailer and retailer != "other":
        parts.append(str(retailer).replace("_", " ").title() if retailer == product.get("retailer") else retailer)
    ident = product.get("model_number") or product.get("sku")
    if ident:
        parts.append(f"#{ident}")
    price = price_of(product)
    if price is not None:
        unit = product.get("price_unit", "each")
        box = f" ({product['box_sf']:g} sq ft)" if unit == "box" and _num(product.get("box_sf")) else ""
        parts.append(f"${price:,.2f}/{_UNIT_SHORT.get(unit, unit)}{box}")
    if extra:
        parts.append(extra)
    return " · ".join(parts)[:500]


def backsplash_install_type(product: Dict[str, Any], fallback: Optional[str]) -> str:
    """Which BACKSPLASH_TYPES install rate a tile takes: by its look, else the estimate's type."""
    look = product.get("look") or {}
    material = str(look.get("material") or "").lower()
    pattern = str(look.get("pattern") or "").lower()
    if "glass" in material:
        return "glass_tile"
    if any(s in material for s in ("marble", "stone", "travertine", "slate", "granite", "quartzite")):
        return "stone_marble"
    if "subway" in pattern:
        return "subway_tile"
    return fallback or "ceramic_tile"


def clean_selections(selections: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Known slots that hold a product, nothing else."""
    if not isinstance(selections, dict):
        return {}
    return {k: v for k, v in selections.items() if k in SLOT_KEYS and isinstance(v, dict)}
