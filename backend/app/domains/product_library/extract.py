"""
Reading a product's details off a listing with Claude: from a fetched
page's text (fetch.py), or from a screenshot when the retailer turns the
server away. What the page states outright as data wins over what Claude
reads (merge_fields); Claude fills in the rest — real dimensions, tile
size, coverage per box, and how the product looks, for the drawings.

The cheapest current model (Claude Haiku 5.5) at low effort: a listing is
a few thousand tokens, so a read costs well under a cent.
"""

import base64
import json
import logging
from typing import Any, Dict, List, Optional

from app.core.config import settings

from .catalog import CATEGORIES, LOOK_OPTIONS, PRICE_UNITS
from .fetch import Page

logger = logging.getLogger(__name__)

# Room for adaptive thinking on top of the JSON, which is a few hundred tokens.
MAX_TOKENS = 4096



def _nullable(schema: Dict[str, Any]) -> Dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


def _string_enum(values: List[str]) -> Dict[str, Any]:
    return _nullable({"type": "string", "enum": values})


NUMBER = _nullable({"type": "number"})
STRING = _nullable({"type": "string"})

LOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "color": STRING,
        "material": _string_enum(LOOK_OPTIONS["material"]),
        "door_style": _string_enum(LOOK_OPTIONS["door_style"]),
        "hardware_style": _string_enum(LOOK_OPTIONS["hardware_style"]),
        "sink_type": _string_enum(LOOK_OPTIONS["sink_type"]),
        "bowls": _nullable({"type": "integer"}),
        "faucet_style": _string_enum(LOOK_OPTIONS["faucet_style"]),
        "pattern": _string_enum(LOOK_OPTIONS["pattern"]),
    },
    "required": ["color", "material", "door_style", "hardware_style", "sink_type", "bowls", "faucet_style", "pattern"],
    "additionalProperties": False,
}

SCHEMA = {
    "type": "object",
    "properties": {
        "category": _string_enum(list(CATEGORIES)),
        "title": STRING,
        "brand": STRING,
        "model_number": STRING,
        "sku": STRING,
        "finish": STRING,
        "description": STRING,
        "price": NUMBER,
        "price_unit": _string_enum(list(PRICE_UNITS)),
        "box_sf": NUMBER,
        "width_in": NUMBER,
        "depth_in": NUMBER,
        "height_in": NUMBER,
        "tile_width_in": NUMBER,
        "tile_length_in": NUMBER,
        "look": LOOK_SCHEMA,
    },
    "required": [
        "category", "title", "brand", "model_number", "sku", "finish", "description", "price", "price_unit",
        "box_sf", "width_in", "depth_in", "height_in", "tile_width_in", "tile_length_in", "look",
    ],
    "additionalProperties": False,
}

CATEGORY_LINES = "\n".join(f"- {key}: {info['label']}" for key, info in CATEGORIES.items())

SYSTEM = f"""You read a home-improvement retailer's product listing for a renovation contractor, who will use the product in an estimate and in 2D/3D drawings of a kitchen or bathroom. Answer with the JSON the schema asks for.

Use only what the listing shows; give null for anything it doesn't say. Never guess a price or a size.

- category, one of:
{CATEGORY_LINES}
- title: the product's name as listed, without the retailer's name. brand, model_number (the manufacturer's model), sku (the retailer's item / internet number), finish (colour or finish as sold).
- description: one or two plain sentences on what it is; null if the listing says nothing useful.
- price: the current selling price in US dollars, as a number. price_unit: "each" for one item, "sf" when priced per square foot, "box" per box or carton (then box_sf is the square feet one box covers), "lf" per linear foot.
- width_in, depth_in, height_in: the product's real overall size in inches, as installed: width left to right, depth front to back, height bottom to top. Convert from feet, centimetres or millimetres. For a sink, the outer size; for a countertop slab or tile, leave these null and use the tile fields or nothing.
- tile_width_in, tile_length_in: for tile, planks or slabs, one piece's face size in inches (a 3 x 6 subway tile is 3 and 6).
- look, for drawing it: color = the main visible colour of its surface as #rrggbb; material; door_style for cabinets or vanities; hardware_style for pulls and knobs (bar pulls, knobs, cup pulls, edge pulls); sink_type and bowls for sinks; faucet_style for faucets; pattern for tile. Null where it doesn't apply."""


def _call(content: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("Reading listings is not set up: ANTHROPIC_API_KEY is missing")
    output_config: Dict[str, Any] = {"format": {"type": "json_schema", "schema": SCHEMA}}
    if settings.PRODUCT_EXTRACT_EFFORT:
        output_config["effort"] = settings.PRODUCT_EXTRACT_EFFORT
    import anthropic  # 30MB+ once loaded, and only reading a listing needs it
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=90.0, max_retries=1)
    response = client.messages.create(
        model=settings.PRODUCT_EXTRACT_MODEL,
        max_tokens=MAX_TOKENS,
        output_config=output_config,
        # The instructions are the same every time; cache them.
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": content}],
    )
    usage = response.usage
    logger.info(
        "Product read: model=%s input=%s cache_read=%s output=%s",
        response.model, usage.input_tokens, usage.cache_read_input_tokens, usage.output_tokens,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined to read this listing")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The read was cut off")
    for block in response.content:
        if block.type == "text":
            return json.loads(block.text)
    raise RuntimeError(f"No answer in the read (stop_reason={response.stop_reason})")


def read_page(page: Page, stated: Dict[str, Any]) -> Dict[str, Any]:
    """Claude's read of a fetched page: its text, with what the page already states as data for a lead."""
    lead = json.dumps({k: v for k, v in stated.items() if k != "description"}, default=str)
    text = f"Listing: {page.url}\nPage title: {page.title}\nStated as data: {lead}\n\nPage text:\n{page.text}"
    return _call([{"type": "text", "text": text}])


def read_screenshot(image: bytes, media_type: str, url: Optional[str] = None) -> Dict[str, Any]:
    """Claude's read of a screenshot of a listing (or a photo of a product's label or spec sheet)."""
    note = f"A screenshot of the listing at {url}." if url else "A screenshot of a product listing."
    return _call([
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(image).decode("ascii")}},
        {"type": "text", "text": note},
    ])


def merge_fields(stated: Dict[str, Any], read: Dict[str, Any]) -> Dict[str, Any]:
    """One draft: what the page states as data wins for the facts it has; Claude's read fills the rest."""
    fields = {k: v for k, v in read.items() if v not in (None, "") and k != "look"}
    look = {k: v for k, v in (read.get("look") or {}).items() if v not in (None, "")}
    fields.update({k: v for k, v in stated.items() if v not in (None, "")})
    if look:
        fields["look"] = look
    if fields.get("category") not in CATEGORIES:
        fields["category"] = "other"
    if fields.get("price_unit") not in PRICE_UNITS:
        fields["price_unit"] = "each"
    return fields
