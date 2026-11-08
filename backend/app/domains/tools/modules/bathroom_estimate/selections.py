"""
Products picked for a bathroom option, and what the calculator does with them.

An option can name a real product for each slot (the vanity, the floor
tile…), picked from the company's product library. The estimate keeps a
copy of it (product_library.service.snapshot), never a link, so it stays as
it was sent. The product's retail price becomes the material cost in place
of the rate table's allowance, with the same procurement handling the
SKU-priced tables get; the labor stays the rate tables'.

A restoration is never priced from products: what goes to the carrier is
like-kind, from the rate tables. The calculator ignores selections on
anything but an option, and the service won't store one there.
"""

import math
import re
from typing import Any, Dict, List, Optional, Set

from .pricing import TILE_SIZE_MULTIPLIER

# slot -> what it is, which library categories fill it, and how it's priced
# ("each" for one, "sf" per square foot of the surface).
SLOTS: Dict[str, Dict[str, Any]] = {
    "vanity": {"label": "Vanity", "categories": ["vanity"], "unit": "each"},
    "vanity_top": {"label": "Vanity top", "categories": ["vanity_top"], "unit": "each"},
    "bath_faucet": {"label": "Faucet", "categories": ["bath_faucet"], "unit": "each"},
    "mirror": {"label": "Mirror", "categories": ["mirror"], "unit": "each"},
    "vanity_light": {"label": "Vanity light", "categories": ["light"], "unit": "each"},
    "toilet": {"label": "Toilet", "categories": ["toilet"], "unit": "each"},
    "bathtub": {"label": "Bathtub", "categories": ["bathtub"], "unit": "each"},
    "shower_door": {"label": "Shower door", "categories": ["shower_door"], "unit": "each"},
    "floor_tile": {"label": "Floor tile", "categories": ["floor_tile", "flooring"], "unit": "sf"},
    "wall_tile": {"label": "Wall tile", "categories": ["wall_tile"], "unit": "sf"},
    "shower_wall_tile": {"label": "Shower & tub wall tile", "categories": ["wall_tile"], "unit": "sf"},
    "shower_floor_tile": {"label": "Shower floor tile", "categories": ["floor_tile"], "unit": "sf"},
}


# A product's look.material (product_library.catalog.LOOK_OPTIONS) as the rate tables name it
_TILE_MATERIALS = {
    "porcelain": "porcelain", "ceramic": "ceramic", "glass": "glass_mosaic", "vinyl": "lvt_spc",
    "natural_stone": "natural_stone", "marble": "natural_stone", "granite": "natural_stone",
    "quartzite": "natural_stone",
}
_TUB_MATERIALS = {
    "acrylic": "acrylic", "cast_iron": "cast_iron", "porcelain": "porcelain_steel",
}


def slots_meta() -> List[Dict[str, Any]]:
    return [{"key": k, **v} for k, v in SLOTS.items()]


_WITH_TOP = re.compile(r"\bwith\b[^,;]*\btops?\b|\btops? included\b|\bvanity (?:set|combo)\b", re.I)


def sold_with_top(title: Optional[str]) -> bool:
    """Whether a vanity listing comes with its top ("… Bath Vanity with White Cultured Marble Top")."""
    return bool(_WITH_TOP.search(title or ""))


def product_name(p: Dict[str, Any]) -> str:
    """"Brand Title", without saying the brand twice."""
    title = (p.get("title") or "").strip()
    brand = (p.get("brand") or "").strip()
    if brand and not title.lower().startswith(brand.lower()):
        title = f"{brand} {title}"
    # Retail titles run long; a line item names it, the listing says the rest
    return title if len(title) <= 64 else title[:61].rstrip() + "…"


def tile_size_key(width_in: Optional[float], length_in: Optional[float]) -> Optional[str]:
    """The rate tables' tile size nearest a product's real one (3 × 12 → "4x12_subway")."""
    if not width_in or not length_in:
        return None
    short, long_ = sorted((float(width_in), float(length_in)))
    best, best_d = None, math.inf
    for key in TILE_SIZE_MULTIPLIER:
        a, b = sorted(float(x) for x in key.split("_")[0].split("x"))
        d = abs(math.log(short / a)) + abs(math.log(long_ / b))
        if d < best_d:
            best, best_d = key, d
    return best


class Picks:
    """An option's picked products, as the calculator asks for them.

    each() and per_sf() give the product's price in the unit the line is
    priced in, or None to keep the rate table's allowance (no product
    picked, or none that can be priced that way, with a warning why).
    """

    def __init__(self, estimate):
        raw = getattr(estimate, "selections", None) or {}
        self._by_slot: Dict[str, Dict[str, Any]] = (
            {k: v for k, v in raw.items() if isinstance(v, dict)}
            if getattr(estimate, "kind", None) == "option" else {}
        )
        self.used: Set[str] = set()
        self.warnings: List[str] = []

    def get(self, slot: str) -> Optional[Dict[str, Any]]:
        return self._by_slot.get(slot)

    def name(self, slot: str) -> Optional[str]:
        p = self.get(slot)
        return product_name(p) if p else None

    def _price(self, slot: str) -> Optional[float]:
        p = self.get(slot)
        if not p:
            return None
        if p.get("price") in (None, ""):
            self._warn(slot, "has no price, so it's priced at the allowance")
            return None
        return float(p["price"])

    def each(self, slot: str, width_in: Optional[float] = None) -> Optional[float]:
        """The price of one (a top sold by the linear foot, for `width_in` of it)."""
        price = self._price(slot)
        if price is None:
            return None
        unit = self.get(slot).get("price_unit") or "each"
        if unit == "lf" and width_in:
            price = price * width_in / 12
        elif unit != "each":
            self._warn(slot, f"is priced per {unit}, not each, so it's priced at the allowance")
            return None
        self.used.add(slot)
        return round(price, 2)

    def per_sf(self, slot: str) -> Optional[float]:
        """The price of a square foot: as sold, from a box's coverage, or from one tile's size."""
        price = self._price(slot)
        if price is None:
            return None
        p = self.get(slot)
        unit = p.get("price_unit") or "each"
        if unit == "sf":
            rate = price
        elif unit == "box" and p.get("box_sf"):
            rate = price / float(p["box_sf"])
        elif unit == "each" and p.get("tile_width_in") and p.get("tile_length_in"):
            rate = price / (float(p["tile_width_in"]) * float(p["tile_length_in"]) / 144)
        else:
            self._warn(slot, "has no price per square foot (a box needs its coverage), so it's priced at the allowance")
            return None
        self.used.add(slot)
        return round(rate, 2)

    def tile_size(self, slot: str) -> Optional[str]:
        p = self.get(slot)
        return tile_size_key(p.get("tile_width_in"), p.get("tile_length_in")) if p else None

    def _material(self, slot: str) -> Optional[str]:
        p = self.get(slot)
        return ((p.get("look") or {}).get("material") or None) if p else None

    def tile_material(self, slot: str, fallback: str) -> str:
        """The rate tables' tile material for a picked tile (stone gets sealed), else `fallback`."""
        return _TILE_MATERIALS.get(self._material(slot) or "", fallback)

    def tub_material(self, fallback: str) -> str:
        """The rate tables' tub material for a picked tub (a cast iron one needs no mortar bed), else `fallback`."""
        return _TUB_MATERIALS.get(self._material("bathtub") or "", fallback)

    def _warn(self, slot: str, why: str):
        message = f"{SLOTS[slot]['label']}: {self.name(slot)} {why}"
        if message not in self.warnings:
            self.warnings.append(message)

    def unused_warnings(self) -> List[str]:
        """Picked products no line of the estimate prices (the scope doesn't replace what they're for)."""
        return [
            f"{SLOTS[slot]['label']}: {product_name(p)} is picked, but the estimate "
            "doesn't replace that, so it isn't priced"
            for slot, p in self._by_slot.items()
            if slot in SLOTS and slot not in self.used
            and not any(w.startswith(f"{SLOTS[slot]['label']}: ") for w in self.warnings)
        ]
