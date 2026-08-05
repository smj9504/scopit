"""
ScopeIt - Packing Tool Calculator Service

Core calculation logic for pack-out estimates.
Ported from moving_estimate standalone application.
"""

from typing import Dict, List, Tuple, Any
from app.domains.tools.modules.packing.schemas import (
    RoomInput, QuickEstimateRequest, EstimateResponse,
    RoomsEstimateRequest, DetectedContentItem, RoomItemSummary, StagingType,
    SupplementItem,
)
from sqlalchemy.orm import Session
from app.domains.line_item.models import LineItem
from app.domains.tools.modules.packing.presets import ROOM_PRESETS
import math


def _fmt_money(amount: float) -> str:
    """Format a dollar amount with thousands comma separator."""
    return f"${amount:,.2f}"


def _crew_detail(desc: str, hrs: float, crew: int, per_rate: float, amt: float) -> str:
    """Canonical detail text for a crew-labor HR line.

    qty=hrs is ELAPSED (wall-clock) hours; rate=per_rate*crew (crew_labor_rate)
    is what actually prices the line, so amount = hrs * (per_rate*crew). The
    "crew" substring here is also what the frontend regexes on to detect a
    crew line and render the ×N badge — keep it present in every crew line.
    """
    return f"{crew}-person crew ({desc}) · {hrs} hr × {crew} crew × {_fmt_money(per_rate)}/hr = {_fmt_money(amt)}"


def _solo_detail(desc: str, hrs: float, rate: float, amt: float) -> str:
    """Canonical detail text for a single-person (non-crew) HR line."""
    return f"1 person ({desc}) · {hrs} hr × {_fmt_money(rate)}/hr = {_fmt_money(amt)}"


# ============================================
# CONSTANTS
# ============================================

DENSITY_MULTIPLIERS = {
    "light": 0.7,
    "normal": 1.0,
    "dense": 1.3,
    "heavy": 1.6,
    "extreme": 2.5,   # Hoarding / absolute maximum
}

FLOOR_MULTIPLIERS = {
    "basement": 1.1,
    "1st": 1.0,
    "2nd": 1.15,
    "3rd": 1.25,
    "4th+": 1.40,     # 3+ stair flights — eastern US brownstones/walkups
}

# Regional labor cost multipliers (applied to labor sections only, not materials/storage)
REGION_MULTIPLIERS = {
    "mid_atlantic": 1.00,  # Baseline — Northern Virginia / DC metro (price calibration origin)
    "northeast":    1.15,  # +15% — NY/NJ/MA/CT metro premium over NOVA
    "west":         1.05,  # +5%  — CA/WA/OR (similar to NOVA, slightly higher in SF/Seattle)
    "midwest":      0.90,  # -10% — IL/OH/MI/WI: lower COL than DC metro
    "southwest":    0.85,  # -15% — TX/AZ/NV: competitive labor market
    "southeast":    0.80,  # -20% — FL/GA/NC/SC/TN: lowest union density, lowest COL
}

# Contamination multipliers — Category per IICRC S500 standard
# Applied per-room to both labor and item count
CONTAMINATION_MULTIPLIERS = {
    "clean": 1.0,          # Category 1 — dry / no contamination
    "gray_water": 1.4,     # Category 2 — washing machine, dishwasher, toilet overflow
    "black_water": 1.8,    # Category 3 — sewage, flood, fire suppression
}

# Special items: fixed-cost line items (not affected by density/floor/region)
SPECIAL_ITEM_COSTS = {
    "piano":      {"name": "Piano — Specialty Handling & Crating",       "unit": "EA", "price": 450.00},
    "pool_table": {"name": "Pool Table — Disassembly, Felt Wrap & Crate", "unit": "EA", "price": 385.00},
    "gun_safe":   {"name": "Gun Safe — Crane/Dolly Service",             "unit": "EA", "price": 275.00},
}

SIZE_TO_PRICE_CODE = {
    "small": "2833",
    "large": "2834",
    "xlarge": "2835",
}

# ============================================
# DEFAULT PRICES FALLBACK TABLE
# Used when DB prices are not seeded — ensures calculations always
# produce meaningful results independent of database state.
# ============================================
DEFAULT_PRICES = {
    # Labor
    "2825": {"price": 57.31, "name": "Pack-Out Labor", "unit": "HR"},
    "2826": {"price": 52.18, "name": "Pack-Back Labor", "unit": "HR"},
    "2911": {"price": 87.00, "name": "Supervisor / Fragile Specialist", "unit": "HR"},
    "2912": {"price": 125.00, "name": "Specialty Item Handler", "unit": "HR"},
    # Transport (adjusted +15% for 2025 fuel costs)
    "2932": {"price": 198.00, "name": "Transport - Small Van", "unit": "EA"},
    "2933": {"price": 206.00, "name": "Transport - Medium Van", "unit": "EA"},
    "2934": {"price": 227.00, "name": "Transport - Large Van", "unit": "EA"},
    # Storage
    "2840": {"price": 2.18, "name": "Storage (per SF/month)", "unit": "SF"},
    "2841": {"price": 42.00, "name": "Storage Setup Fee", "unit": "EA"},
    # Room-size base rates (used by calculate_room_base via SIZE_TO_PRICE_CODE)
    "2833": {"price": 185.00, "name": "Room Rate - Small", "unit": "EA"},
    "2834": {"price": 285.00, "name": "Room Rate - Standard", "unit": "EA"},
    "2835": {"price": 415.00, "name": "Room Rate - Large", "unit": "EA"},
    # Materials - Boxes
    # Code assignments aligned with MATERIAL_CODES mapping.
    "3026": {"price": 4.82, "name": "Small Box (1.5 cu ft)", "unit": "EA"},
    "3025": {"price": 5.96, "name": "Medium Box (3.0 cu ft)", "unit": "EA"},
    "3027": {"price": 7.14, "name": "Large Box (4.5 cu ft)", "unit": "EA"},
    "3028": {"price": 8.93, "name": "XL Box (6.0 cu ft)", "unit": "EA"},
    "3029": {"price": 4.82, "name": "Book Box (1.5 cu ft)", "unit": "EA"},
    "3030": {"price": 9.64, "name": "Dish Pack Box", "unit": "EA"},
    "3031": {"price": 5.36, "name": "Lamp Box", "unit": "EA"},
    "3033": {"price": 9.64, "name": "Mirror/Picture Box", "unit": "EA"},
    "3039": {"price": 12.86, "name": "Wardrobe Box", "unit": "EA"},
    "3032": {"price": 3.57, "name": "File Box", "unit": "EA"},
    # Materials - Protective
    "2915": {"price": 14.29, "name": "Moving Blanket", "unit": "EA"},
    "3023": {"price": 8.93, "name": "Bubble Wrap Roll 12in", "unit": "EA"},
    "3018": {"price": 12.50, "name": "Bubble Wrap Roll 24in", "unit": "EA"},
    "3089": {"price": 32.14, "name": "Packing Paper (50-lb bundle)", "unit": "EA"},
    "3035": {"price": 4.46, "name": "Packing Tape Roll", "unit": "EA"},
    "2936": {"price": 8.93, "name": "Stretch/Shrink Wrap Roll", "unit": "EA"},
    "2916": {"price": 8.57, "name": "Furniture Pad", "unit": "EA"},
    "3022": {"price": 2.68, "name": "Corner Protector Set", "unit": "EA"},
    "2917": {"price": 5.36, "name": "Chair Cover", "unit": "EA"},
    "2918": {"price": 8.93, "name": "Sofa Cover", "unit": "EA"},
    "3041": {"price": 1.79, "name": "Foam Sheet", "unit": "EA"},
    "3043": {"price": 3.21, "name": "Dust Cover", "unit": "EA"},
    # Materials - Specialty
    "3050": {"price": 4.46, "name": "Anti-Static Wrap", "unit": "EA"},
    "3051": {"price": 5.36, "name": "Acid-Free Tissue", "unit": "EA"},
    "3052": {"price": 17.86, "name": "Wine Cell Box (12-cell)", "unit": "EA"},
    "3053": {"price": 8.93, "name": "Electronics Box", "unit": "EA"},
    "3054": {"price": 12.50, "name": "TV Box", "unit": "EA"},
    "3055": {"price": 3.57, "name": "Lamp Box", "unit": "EA"},
    "3056": {"price": 5.36, "name": "Rug Wrap", "unit": "EA"},
    "3057": {"price": 7.14, "name": "Piano Board", "unit": "EA"},
    "3058": {"price": 0.71, "name": "Marker/Label Set", "unit": "EA"},
    "3059": {"price": 2.14, "name": "Hazmat Label", "unit": "EA"},
    "3060": {"price": 16.07, "name": "Instrument Case Wrap", "unit": "EA"},
    "3061": {"price": 1.43, "name": "Silica Gel Pack", "unit": "EA"},
    "3062": {"price": 7.14, "name": "Gun Sleeve", "unit": "EA"},
    "3063": {"price": 2.50, "name": "Tool Roll", "unit": "EA"},
    "3064": {"price": 3.57, "name": "Bike Box/Bag", "unit": "EA"},
    "3065": {"price": 7.14, "name": "Plant Pot Wrap", "unit": "EA"},
    # Debris / Cleaning
    "3080": {"price": 250.00, "name": "Debris Hauling", "unit": "EA"},
    "3081": {"price": 45.00, "name": "Cleaning Fee", "unit": "HR"},
    # Materials - Additional size variants and mattress bags
    "3039S": {"price": 7.14, "name": "Wardrobe Box - Small", "unit": "EA"},
    "3039L": {"price": 10.71, "name": "Wardrobe Box - Large", "unit": "EA"},
    "3899": {"price": 14.29, "name": "TV Box", "unit": "EA"},
    "3876": {"price": 8.93, "name": "Mattress Bag - Twin", "unit": "EA"},
    "3905": {"price": 10.71, "name": "Mattress Bag - Full", "unit": "EA"},
    "3877": {"price": 12.50, "name": "Mattress Bag - Queen", "unit": "EA"},
    "3878": {"price": 14.29, "name": "Mattress Bag - King", "unit": "EA"},
}

# Content hints -> material mapping
# Format: {material_key: factor_per_item}
# SF of storage space per item by category
# Based on industry averages for packed/crated household goods
SF_PER_ITEM = {
    "Furniture": 12.0,       # Sofas, tables, dressers — bulky
    "Electronics": 4.0,      # TVs, monitors, gaming systems
    "Books": 0.5,            # Dense, small footprint per item
    "Kitchenware": 1.0,      # Dishes, pots boxed up
    "Clothing": 0.4,         # Wardrobe boxes / medium boxes
    "Fragile": 2.0,          # Extra padding = more volume
    "Artwork": 3.0,          # Flat but needs spacing
    "Collectibles": 1.5,     # Small but padded
    "Appliances": 10.0,      # Washers, fridges, microwaves
    "Tools": 1.5,            # Boxed tools
    "Sports": 4.0,           # Bikes, gear bags
    "Other": 1.5,
}

# SF per room size for hint-based (quick) estimates
# Values reflect stacked storage (items packed floor-to-ceiling ~7 ft),
# not flat floor area. Industry rule: 3BR house fits ~150-200 SF unit.
SF_PER_ROOM_SIZE = {
    "small": 8,     # bathroom, closet → ~5×5 portion of unit
    "large": 25,    # standard bedroom, kitchen → ~quarter of 10×10
    "xlarge": 45,   # master, basement, garage → ~half of 10×10
}

# Room-size-based material volume scale (replaces item count for material calculations).
# Represents relative content volume per room size — density multiplier is applied on top.
# Calibrated to match historical material quantities without depending on preset.base_items.
MAT_SCALE_PER_SIZE = {
    "small": 30,    # bathroom, closet
    "large": 80,    # standard bedroom, living room, kitchen
    "xlarge": 120,  # master bedroom, basement, garage
}

# Base materials per room — covers miscellaneous contents not captured
# by hints (drawer contents, shelf items, small decor, toiletries).
# Values are per-room BEFORE density multiplier.  Calibrated so a
# typical 3BR house (11 rooms) lands within industry norms when
# combined with hint-based materials.
BASE_ROOM_MATERIALS = {
    "small":  {"box_small": 1},
    "large":  {"box_small": 1, "box_medium": 2, "box_large": 1},
    "xlarge": {"box_small": 2, "box_medium": 2, "box_large": 1},
}

# Per-hint volume level multipliers: index 0=S, 1=M (default), 2=L, 3=XL
# Mirrors HINT_VOLUME_LEVELS.mult values in the frontend.
HINT_VOLUME_MULTS = [0.4, 1.0, 1.8, 3.0]

# Standard self-storage unit sizes (width × depth = SF)
# Industry-standard sizes used by Public Storage, Extra Space Storage,
# CubeSmart, StorageMart, Life Storage, etc.
STANDARD_UNIT_SIZES = [25, 50, 75, 100, 150, 200, 250, 300]
# 5×5=25  | 5×10=50  | 5×15=75  | 10×10=100
# 10×15=150 | 10×20=200 | 10×25=250 | 10×30=300

# Human-readable labels for each unit size (shown in section_details)
STORAGE_UNIT_LABELS = {
    25:  "5×5",
    50:  "5×10",
    75:  "5×15",
    100: "10×10",
    150: "10×15",
    200: "10×20",
    250: "10×25",
    300: "10×30",
}

# Storage setup fee by unit size (scales with unit size)
# Covers: inventory placement, shelving, padlock, first-access coordination
# Based on: base $85 for 10×10 (Xactimate reference), power-law scaling (^0.65)
STORAGE_SETUP_BY_SIZE = {
    25:  42.00,   # 5×5   — ~0.5 hr setup
    50:  54.00,   # 5×10  — ~0.75 hr setup
    75:  68.00,   # 5×15  — ~0.75-1.0 hr setup
    100: 85.00,   # 10×10 — ~1.0-1.5 hr setup (Xactimate reference)
    150: 109.00,  # 10×15 — ~1.5-2.0 hr setup
    200: 131.00,  # 10×20 — ~2.0-2.5 hr setup
    250: 152.00,  # 10×25 — ~2.5-3.0 hr setup
    300: 172.00,  # 10×30 — ~3.0-4.0 hr setup
}


# Human-readable labels for content hints
HINT_LABELS = {
    "clothing_hanging":  "hanging garments",
    "clothing_folded":   "folded clothing",
    "bedding":           "bedding & linens",
    "books":             "books & media",
    "documents":         "documents & files",
    "electronics":       "electronics",
    "kitchenware":       "kitchenware & dishes",
    "fragile":           "fragile items",
    "artwork":           "artwork & frames",
    "collectibles":      "collectibles",
    "valuables":         "jewelry & valuables",
    "wine_collection":   "wine collection",
    "furniture":         "furniture",
    "rugs":              "rugs & carpets",
    "lamps_lighting":    "lamps & lighting",
    "appliances_small":  "small appliances",
    "appliances_large":  "large appliances",
    "toys":              "toys & games",
    "sports":            "sports equipment",
    "bicycles":          "bicycles & scooters",
    "tools":             "tools & hardware",
    "equipment_heavy":   "heavy equipment",
    "boxes_stored":      "stored boxes",
    "holiday_decor":     "holiday & seasonal decor",
    "instruments":       "musical instruments",
    "baby_items":        "baby & nursery items",
    "outdoor_furniture": "outdoor furniture",
    "plants":            "plants & pots",
    "chemicals":         "cleaning & chemicals",
}

# Labor multipliers for specialty content hints.
# Applied as max() across all hints in a room — NOT cumulative.
# Having fragile + artwork uses only the higher value (1.15), not 1.12 × 1.15.
# These are modest adjustments reflecting that specialty content is one category
# among many in a mixed room, not the entire room's contents.
# Plants and chemicals = 0.0 (non-packable: disposal/exclusion only).
HINT_LABOR_MULTIPLIERS = {
    "fragile":          1.12,  # +12%
    "artwork":          1.15,  # +15%
    "instruments":      1.15,  # +15%
    "valuables":        1.08,  # +8%
    "wine_collection":  1.12,  # +12%
    "lamps_lighting":   1.08,  # +8%
    "bicycles":         1.08,  # +8%
    "holiday_decor":    1.08,  # +8%
    "collectibles":     1.10,  # +10%
    "equipment_heavy":  1.08,  # +8%
    "plants":           0.0,   # excluded — not packable per insurance policy
    "chemicals":        0.0,   # excluded — hazmat disposal only (OSHA/EPA)
}

# Categories considered notable for description building
NOTABLE_CATEGORIES = {
    "Furniture", "Appliances", "Electronics", "Artwork",
}


def snap_to_storage_unit(raw_sf: float) -> int:
    """Snap raw SF to the nearest standard self-storage unit size.
    Always rounds UP to the next available unit. Returns 0 if no storage needed."""
    if raw_sf <= 0:
        return 0
    for size in STANDARD_UNIT_SIZES:
        if raw_sf <= size:
            return size
    return STANDARD_UNIT_SIZES[-1]  # cap at largest


def get_storage_setup_fee(unit_sf: int) -> float:
    """Get storage setup fee for a given unit size."""
    return STORAGE_SETUP_BY_SIZE.get(unit_sf, 85.00)


def build_storage_section_detail(
    storage_sf: int,
    sf_rate: float,
    storage_months: int,
    setup_fee: float,
    storage_cost: float,
) -> dict:
    """Build a section_detail dict for the Storage line item.

    Shows the unit dimensions, per-SF rate, and month breakdown so the
    adjuster can see exactly how the charge was computed.
    """
    unit_label = STORAGE_UNIT_LABELS.get(storage_sf, f"{storage_sf} SF")
    monthly_sf_cost = round(storage_sf * sf_rate, 2)
    lines = [
        {
            "name": f"Climate-Controlled Storage — {unit_label} unit ({storage_sf} SF)",
            "qty": storage_months,
            "unit": "MO",
            "rate": monthly_sf_cost,
            "detail": (
                f"{storage_sf} SF × ${sf_rate:.2f}/SF/mo = ${monthly_sf_cost:.2f}/mo"
            ),
            "amount": round(storage_sf * sf_rate * storage_months, 2),
        },
        {
            "name": "Storage Setup & Inventory Placement",
            "qty": 1,
            "unit": "EA",
            "rate": round(setup_fee, 2),
            "detail": (
                f"Shelving, padlock, item placement & first-access coordination  "
                f"({unit_label} unit)"
            ),
            "amount": round(setup_fee, 2),
        },
    ]
    return {"lines": lines}


# Unit-based hints: materials per single piece (mirrors frontend HINT_UNIT_MATERIALS)
# Used when hint_qty is provided — qty × per-unit materials (no volume scaling)
#
# Furniture items (sofa, bed, etc.) are truly per-piece: qty=1 = 1 physical item.
# Category hints (clothing, appliances) represent a "collection": qty=1 = one
# closet section / dresser load / set of appliances — per-unit values are calibrated
# to match the volume-based HINT_MATERIAL_MAP output for a standard "large" room
# (MAT_SCALE=80) so results are consistent regardless of calculation path.
UNIT_HINT_MATERIAL_MAP = {
    "sofa":          {"sofa_cover": 1, "blanket": 2, "shrink_wrap": 1},
    "loveseat":      {"sofa_cover": 1, "blanket": 1},
    "armchair":      {"chair_cover": 1, "blanket": 1},
    "bed_large":     {"blanket": 2, "shrink_wrap": 1, "furniture_pad": 1},
    "bed_small":     {"blanket": 1, "shrink_wrap": 1},
    "dresser":       {"blanket": 2, "shrink_wrap": 1, "furniture_pad": 1},
    "wardrobe":      {"blanket": 3, "shrink_wrap": 1, "furniture_pad": 2},
    "dining_table":  {"blanket": 2, "furniture_pad": 2},
    "dining_chair":  {"chair_cover": 1},
    "coffee_table":  {"blanket": 1, "furniture_pad": 1},
    "bookcase":      {"blanket": 1, "furniture_pad": 1},
    "desk":          {"blanket": 2, "furniture_pad": 1},
    "bicycles":      {"blanket": 1, "shrink_wrap": 1},
    "instruments":   {"blanket": 2, "bubble_12": 1},
    # Category hints — per-unit = one closet section / dresser / appliance set.
    # Values are calibrated for a "large" room (MAT_SCALE=80).
    # Room-size scaling is applied in calculate_materials for these hints.
    "clothing_hanging": {"box_wardrobe": 2},                  # closet section ≈ 48 garments → 2 wardrobe boxes
    "clothing_folded":  {"box_medium": 2, "box_large": 1},    # dresser load ≈ 2 medium + 1 large
    "appliances_large": {"blanket": 2, "shrink_wrap": 1},
    "appliances_small": {"box_medium": 2, "bubble_12": 1},    # kitchen counter set ≈ 2 medium + 1 bubble roll
}

# Category-type unit hints that should scale with room size.
# These represent collections (not individual items), so per-unit values
# should be adjusted by room size ratio (room_scale / 80).
CATEGORY_UNIT_HINTS = {
    "clothing_hanging", "clothing_folded", "appliances_small",
}

HINT_MATERIAL_MAP = {
    # ── Clothing & Textiles ──────────────────────────────────────────────
    # Factors are per vol_scale unit. Large room scale=80, xlarge=120.
    # Target: bedroom → 2 wardrobe boxes, 2-3 medium boxes for clothes.
    "clothing_hanging":  {"box_wardrobe": 0.025},                         # 80×0.025=2 wardrobe boxes
    "clothing_folded":   {"box_medium": 0.03},                            # 80×0.03=2.4 → 3 medium boxes
    "bedding":           {"box_large": 0.025, "box_xlarge": 0.012},       # 80×0.025=2 large + 1 xlarge

    # ── Books & Media ────────────────────────────────────────────────────
    # Target: office → 4 book boxes, 1-2 small boxes
    "books":             {"box_book": 0.05, "box_small": 0.015},          # 80×0.05=4 book + 1-2 small
    "documents":         {"box_small": 0.03, "box_medium": 0.012},        # 80×0.03=2-3 small + 1 med

    # ── Electronics ──────────────────────────────────────────────────────
    # Most rooms have 1 TV at most; other electronics (consoles, routers) use medium boxes
    # Target: 0-1 TV box, 2 medium boxes, 1 bubble roll per room
    "electronics":       {"box_tv": 0.006, "box_medium": 0.025, "bubble_12": 0.008},

    # ── Kitchen ──────────────────────────────────────────────────────────
    # Target: 3-4 dish boxes, 2-3 medium, 1-2 bundles packing paper
    "kitchenware":       {"box_dish": 0.04, "box_medium": 0.025, "packing_paper": 0.006},
    # Fragile & Valuables
    "fragile":           {"box_dish": 0.04, "packing_paper": 0.008, "bubble_12": 0.004},
    "artwork":           {"box_mirror": 0.018, "corner_protector": 0.004, "bubble_24": 0.003},
    "collectibles":      {"box_small": 0.04, "bubble_12": 0.006, "packing_paper": 0.004},
    "valuables":         {"box_small": 0.015, "bubble_24": 0.008, "packing_paper": 0.006},
    "wine_collection":   {"box_small": 0.06, "bubble_12": 0.015, "packing_paper": 0.015},

    # ── Furniture ────────────────────────────────────────────────────────
    # Typical bedroom: bed frame(2 blankets) + dresser(1) + nightstands(0) = 2-3 blankets, 1 pad
    # Typical living: sofa(2) + coffee table(1) + TV stand(1) = 3-4 blankets, 1 pad
    # Target large(80): blanket=2-3, pad=1, chair_cover=0, sofa_cover=0, shrink=1
    # sofa/chair covers only meaningful at scale ≥120 (living rooms with multiple seating)
    "furniture":         {"blanket": 0.035, "shrink_wrap": 0.01, "furniture_pad": 0.012, "chair_cover": 0.004, "sofa_cover": 0.003},
    "rugs":              {"shrink_wrap": 0.012, "blanket": 0.008},
    "lamps_lighting":    {"box_lamp": 0.025, "box_medium": 0.012, "bubble_12": 0.008},

    # ── Appliances ───────────────────────────────────────────────────────
    "appliances_small":  {"box_medium": 0.03, "bubble_12": 0.004},
    "appliances_large":  {"blanket": 0.08, "shrink_wrap": 0.025},         # 80×0.08=6.4 → only for heavy appliance rooms

    # ── Recreation ───────────────────────────────────────────────────────
    "toys":              {"box_large": 0.03, "box_medium": 0.02},         # 80×0.03=2-3 large + 2 med
    "sports":            {"box_xlarge": 0.02, "blanket": 0.025},
    "bicycles":          {"blanket": 0.015, "shrink_wrap": 0.008},

    # ── Tools & Equipment ────────────────────────────────────────────────
    "tools":             {"box_small": 0.03, "blanket": 0.025},
    "equipment_heavy":   {"blanket": 0.08, "shrink_wrap": 0.02},

    # ── Storage ──────────────────────────────────────────────────────────
    "boxes_stored":      {"shrink_wrap": 0.008},
    "holiday_decor":     {"box_medium": 0.025, "box_large": 0.012, "packing_paper": 0.006, "bubble_12": 0.006},

    # ── Music & Arts ─────────────────────────────────────────────────────
    "instruments":       {"blanket": 0.06, "bubble_24": 0.012},

    # ── Specialty ────────────────────────────────────────────────────────
    "baby_items":        {"box_medium": 0.03, "box_large": 0.015, "blanket": 0.008},
    "outdoor_furniture": {"blanket": 0.04, "shrink_wrap": 0.012, "furniture_pad": 0.012},
    "plants":            {},  # not packable — excluded from insurance contents claims
    "chemicals":         {},  # hazmat — disposal only per OSHA/EPA; not transported
}

# Material code mapping
MATERIAL_CODES = {
    "box_small": "3026",
    "box_medium": "3025",
    "box_large": "3027",
    "box_xlarge": "3028",
    "box_book": "3029",
    "box_dish": "3030",
    "box_wardrobe": "3039",
    "box_wardrobe_small": "3039S",
    "box_wardrobe_large": "3039L",
    "box_mirror": "3033",
    "box_tv": "3899",
    "box_lamp": "3031",
    "mattress_twin": "3876",
    "mattress_full": "3905",
    "mattress_queen": "3877",
    "mattress_king": "3878",
    "blanket": "2915",
    "furniture_pad": "2916",
    "chair_cover": "2917",
    "sofa_cover": "2918",
    "bubble_12": "3023",
    "bubble_24": "3018",
    "packing_paper": "3089",
    "packing_tape": "3035",
    "shrink_wrap": "2936",
    "corner_protector": "3022",
}

# Human-readable descriptions for each material (shown in estimate detail)
MATERIAL_DETAIL = {
    "box_small": "Small/heavy items: books, cans, tools",
    "box_medium": "General packing: folded clothes, appliances, kitchenware",
    "box_large": "Bulky/light items: bedding, linens, toys",
    "box_xlarge": "Oversized light items: pillows, comforters, cushions",
    "box_book": "Dense items: hardcovers, binders, records",
    "box_dish": "Fragile dishware with cell dividers",
    "box_wardrobe": "Hanging garments transferred on-hanger",
    "box_wardrobe_small": "Short hanging garments (shirts, jackets)",
    "box_wardrobe_large": "Long hanging garments (dresses, coats)",
    "box_mirror": "Framed artwork, mirrors, glass panels",
    "box_tv": "Flat-screen TV with foam corners",
    "box_lamp": "Table/floor lamps with shade protection",
    "mattress_twin": "Mattress protection — Twin size",
    "mattress_full": "Mattress protection — Full size",
    "mattress_queen": "Mattress protection — Queen size",
    "mattress_king": "Mattress protection — King size",
    "blanket": "Furniture wrapping and surface protection",
    "furniture_pad": "Heavy-duty padding for large furniture",
    "chair_cover": "Fitted cover for dining/accent chairs",
    "sofa_cover": "Fitted cover for sofas and sectionals",
    "bubble_12": "Fragile item wrap: electronics, glassware, ceramics",
    "bubble_24": "Wide wrap for large fragile items, artwork",
    "packing_paper": "Void fill, wrapping, and interleaving",
    "packing_tape": "Box sealing and reinforcement",
    "shrink_wrap": "Securing blankets, bundling drawers and doors",
    "corner_protector": "Edge protection for furniture and frames",
}


# ============================================
# CALCULATOR CLASS
# ============================================

class EstimateCalculator:
    def __init__(self, db: Session, company_id=None):
        self.db = db
        self.company_id = company_id
        self._load_prices()
        self._load_presets()

    def _load_prices(self):
        """Load prices from LineItem table for this company, falling back to defaults."""
        if self.company_id:
            items = self.db.query(LineItem).filter(
                LineItem.company_id == self.company_id,
                LineItem.tool_id == "packing",
                LineItem.is_active.is_(True),
            ).all()
        else:
            items = []

        # Build price dict compatible with original calculator (expects .price, .code, .name, .unit)
        self.prices = {}
        for item in items:
            if item.code:
                self.prices[item.code] = type('Price', (), {
                    'price': float(item.unit_price),
                    'code': item.code,
                    'name': item.name,
                    'unit': item.unit,
                })()

        # Merge DEFAULT_PRICES for any codes not found in the database.
        # This ensures calculations always produce meaningful results even
        # when the moving line-item seed data has not been applied.
        for code, info in DEFAULT_PRICES.items():
            if code not in self.prices:
                self.prices[code] = type('Price', (), {
                    'price': info['price'],
                    'code': code,
                    'name': info['name'],
                    'unit': info['unit'],
                })()

        # Create reverse lookup by material key
        self.price_by_key = {}
        for key, code in MATERIAL_CODES.items():
            if code in self.prices:
                self.price_by_key[key] = self.prices[code]

    def _load_presets(self):
        """Load room presets from constants."""
        self.presets = {}
        for key, data in ROOM_PRESETS.items():
            self.presets[key] = type('Preset', (), {
                'key': key,
                'name': data['name'],
                'category': data['category'],
                'size': data['size'],
                'base_items': data['base_items'],
                'default_hints': data['default_hints'],
                'mattress': data.get('mattress'),
            })()

    def get_price(self, code: str) -> float:
        """Get price by code, with fallback to DEFAULT_PRICES."""
        p = self.prices.get(code)
        if p:
            return p.price
        default = DEFAULT_PRICES.get(code)
        return default["price"] if default else 0

    # ============================================
    # CONDITIONAL SUPPLEMENTS
    # ============================================

    SUPPLEMENT_DEFINITIONS = [
        {
            "key": "hidden_damage",
            "name": "Unforeseen Conditions — Concealed Contamination",
            "description": "Per IICRC S500 §12.3 — additional handling for concealed water/mold damage",
            "flat_amount": 150.00,
            "trigger": "contamination",
        },
        {
            "key": "high_value_documentation",
            "name": "High-Value Contents Documentation",
            "description": "Serial number recording, appraisal photo, condition report — flat fee per job",
            "flat_amount": 85.00,
            "trigger": "high_value",
            "min_items": 3,
        },
        {
            "key": "difficult_access",
            "name": "Difficult Access Supplement",
            "description": "Narrow stairwell / no elevator — additional carry time",
            "flat_amount": 120.00,
            "trigger": "upper_floor",
        },
        {
            "key": "heavy_contents",
            "name": "Heavy Contents Supplement",
            "description": "Above-average contents volume requiring additional sort/stage time",
            "flat_amount": 95.00,
            "trigger": "heavy_density",
        },
    ]

    def evaluate_supplements(self, rooms, subtotal, overrides=None) -> List[SupplementItem]:
        """Evaluate conditional supplements based on room conditions.

        Supplements use fixed amounts — not percentages or per-item rates —
        so they stay reasonable regardless of estimate size.
        Users can toggle each supplement and edit the amount in the frontend.
        """
        overrides = overrides or {}

        has_contamination = any(
            getattr(r, "contamination", "clean") not in ("clean", "Clean")
            for r in rooms
        )
        # Count unique item LINES, not quantity
        hv_count = 0
        for r in rooms:
            for item in getattr(r, "items", []):
                if getattr(item, "is_high_value", False):
                    hv_count += 1
        has_upper_floor = any(
            str(getattr(r, "floor", "1st")) in {"3rd", "4th+"}
            for r in rooms
        )
        has_heavy_density = any(
            str(getattr(r, "density", "normal")) in {"heavy", "extreme"}
            for r in rooms
        )

        supplements: List[SupplementItem] = []

        for defn in self.SUPPLEMENT_DEFINITIONS:
            key = defn["key"]
            triggered = False

            if defn["trigger"] == "contamination":
                triggered = has_contamination
            elif defn["trigger"] == "high_value":
                triggered = hv_count >= defn.get("min_items", 3)
            elif defn["trigger"] == "upper_floor":
                triggered = has_upper_floor
            elif defn["trigger"] == "heavy_density":
                triggered = has_heavy_density

            if not triggered:
                continue

            amount = defn.get("flat_amount", 0)
            enabled = overrides.get(key, False)
            supplements.append(SupplementItem(
                key=key,
                name=defn["name"],
                description=defn["description"],
                amount=amount,
                triggered=True,
                enabled=enabled,
            ))

        return supplements

    def select_truck(self, storage_sf: int) -> tuple:
        """Select appropriate truck size based on storage SF.
        Returns (code, rate) tuple."""
        if storage_sf <= 50:
            # Small job: 14'-15' van
            code = "2932"
            fallback = 172.36
        elif storage_sf <= 150:
            # Medium job: 16'-20' van
            code = "2933"
            fallback = 179.25
        else:
            # Large job: 21'-27' van
            code = "2934"
            fallback = 197.36
        return code, self.get_price(code) or fallback

    def estimate_storage_sf_from_rooms(
        self, rooms: List[RoomInput]
    ) -> int:
        """Estimate required storage SF from room presets.
        Returns a standard storage unit size (25, 50, 100, etc.)."""
        total_sf = 0.0
        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue
            density_mult = DENSITY_MULTIPLIERS.get(
                room.density.value, 1.0
            )
            base_sf = SF_PER_ROOM_SIZE.get(preset.size, 40)
            total_sf += base_sf * density_mult
        return snap_to_storage_unit(total_sf)

    def estimate_storage_sf_from_items(
        self, rooms: List[Any]
    ) -> int:
        """Estimate required storage SF from AI-detected rooms.

        Priority: preset_id → SF_PER_ROOM_SIZE (most accurate).
        Fallback: item count, with conservative thresholds and smaller SF values
        to avoid over-sizing the storage unit.

        AI detects items as grouped objects (e.g. "Plates" qty=20 = 1 dish-pack),
        so the raw item count inflates easily. Thresholds are raised accordingly.

        Returns a standard storage unit size (25, 50, 100, etc.).
        """
        # Conservative SF per room for item-based fallback
        # (smaller than quick-estimate values — AI grouping inflates item counts)
        ITEM_SF_MAP = {"small": 7, "large": 20, "xlarge": 35}

        total_sf = 0.0
        for room in rooms:
            # Prefer preset-based SF (most reliable)
            preset_id = getattr(room, 'preset_id', None)
            if preset_id and preset_id in self.presets:
                preset = self.presets[preset_id]
                density_mult = DENSITY_MULTIPLIERS.get(
                    getattr(room, 'density', 'normal'), 1.0
                )
                base_sf = SF_PER_ROOM_SIZE.get(preset.size, 30)
                total_sf += base_sf * density_mult
            else:
                # Size-based SF: use item size class for more accurate volume
                # Each item contributes SF based on its physical size
                ITEM_SIZE_SF = {
                    "XS": 0.5, "S": 1.0, "M": 3.0,
                    "L": 8.0, "XL": 15.0, "XXL": 25.0,
                }
                room_sf = 0.0
                for item in room.items:
                    item_size = getattr(item, 'size', None)
                    if item_size and item_size in ITEM_SIZE_SF:
                        room_sf += ITEM_SIZE_SF[item_size] * (item.quantity or 1)
                    else:
                        # Fallback: category-based estimate
                        cat = getattr(item, 'category', 'Other')
                        cat_sf = {"Furniture": 8.0, "Appliances": 8.0,
                                  "Sports": 5.0, "Artwork": 3.0}.get(cat, 1.0)
                        room_sf += cat_sf * (item.quantity or 1)
                # Apply minimum per room
                room_sf = max(room_sf, ITEM_SF_MAP.get("small", 7))
                total_sf += room_sf

        return snap_to_storage_unit(total_sf)

    def _build_room_summaries(
        self, rooms: List[Any]
    ) -> List[RoomItemSummary]:
        """Build room summaries from AI-detected items."""
        summaries = []
        for room in rooms:
            notable = []
            high_value = []
            categories = set()
            packing_notes = []

            for item in room.items:
                categories.add(item.category)
                if item.is_high_value:
                    high_value.append(item.name)
                    notable.append(item.name)
                elif item.category in NOTABLE_CATEGORIES:
                    notable.append(item.name)

                if (item.packing_method
                        and (item.is_high_value
                             or item.category in NOTABLE_CATEGORIES)):
                    packing_notes.append(
                        f"{item.name}: {item.packing_method}"
                    )

            summaries.append(RoomItemSummary(
                room_name=room.room_name,
                notable_items=notable[:8],
                categories_present=sorted(categories),
                high_value_items=high_value[:5],
                packing_notes=packing_notes[:5],
                item_count=sum(i.quantity for i in room.items),
            ))
        return summaries

    def _build_room_summaries_from_hints(
        self, rooms: List[RoomInput]
    ) -> List[RoomItemSummary]:
        """Build room summaries from preset hints (quick estimate)."""
        summaries = []
        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue
            hints = room.hints or preset.default_hints or []
            cats = []
            for h in hints:
                h_str = h.value if hasattr(h, 'value') else str(h)
                cats.append(HINT_LABELS.get(h_str, h_str))
            density_mult = DENSITY_MULTIPLIERS.get(
                room.density.value, 1.0
            )
            summaries.append(RoomItemSummary(
                room_name=preset.name,
                notable_items=[],
                categories_present=cats,
                high_value_items=[],
                packing_notes=[],
                item_count=int(
                    preset.base_items * density_mult
                ),
            ))
        return summaries

    def calculate_room_base(self, room: RoomInput) -> Tuple[float, int]:
        """Calculate base price and item count for a room"""
        preset = self.presets.get(room.preset)
        if not preset:
            return 0, 0

        # Get room rate based on size
        rate_code = SIZE_TO_PRICE_CODE.get(preset.size, "2834")
        base_rate = self.get_price(rate_code)

        # Apply multipliers
        density_mult = DENSITY_MULTIPLIERS.get(room.density.value, 1.0)
        floor_mult = FLOOR_MULTIPLIERS.get(room.floor.value, 1.0)
        contamination_str = room.contamination.value if hasattr(room.contamination, 'value') else str(getattr(room, 'contamination', 'clean'))
        contamination_mult = CONTAMINATION_MULTIPLIERS.get(contamination_str, 1.0)

        # Hint-based labor multiplier: specialty content (fragile, artwork, instruments,
        # valuables, wine) reduces packing production from 4-5 boxes/hr to 2-3 boxes/hr.
        # Use max() across all hints — not cumulative — the dominant content type drives
        # the rate. Plants/chemicals = 0.0 flag (non-packable items excluded from labor).
        hints = room.hints or preset.default_hints or []
        hint_labor_mult = 1.0
        for hint in hints:
            hint_str = hint.value if hasattr(hint, 'value') else str(hint)
            mult = HINT_LABOR_MULTIPLIERS.get(hint_str, 1.0)
            if mult == 0.0:
                continue  # plants/chemicals don't suppress labor for the whole room
            hint_labor_mult = max(hint_labor_mult, mult)

        adjusted_price = base_rate * density_mult * floor_mult * contamination_mult * hint_labor_mult
        # Volume index for display only — room-size based, not item-count based
        vol_index = int(MAT_SCALE_PER_SIZE.get(preset.size, 80) * density_mult * contamination_mult)

        return adjusted_price, vol_index

    def calculate_materials(self, rooms: List[RoomInput]) -> Dict[str, int]:
        """Calculate required materials based on rooms and content hints.

        All continuous materials are accumulated as floats across all rooms and hints,
        then converted to integers once at the end — avoiding spurious per-room minimums
        from ceil() that cause over-counting on small rooms.
        Mattresses are integer items added directly (1 per applicable room).
        """
        mat_floats: Dict[str, float] = {}  # accumulate raw fractions across all rooms/hints
        mattresses: Dict[str, int] = {}    # integer items, not subject to float accumulation

        for room in rooms:
            preset = self.presets.get(room.preset)
            if not preset:
                continue

            density_mult = DENSITY_MULTIPLIERS.get(room.density.value, 1.0)
            # Base room-size volume scale (density applied per-hint below)
            base_vol_scale = MAT_SCALE_PER_SIZE.get(preset.size, 80) * density_mult

            # Add mattress if applicable (always 1 per room, not fraction-based)
            if preset.mattress:
                mat_key = f"mattress_{preset.mattress}"
                mattresses[mat_key] = mattresses.get(mat_key, 0) + 1

            # Base materials per room — misc drawer/shelf/decor contents
            base_mats = BASE_ROOM_MATERIALS.get(preset.size, BASE_ROOM_MATERIALS["large"])
            for mat_key, base_qty in base_mats.items():
                mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + base_qty * density_mult

            # Accumulate hint-based materials as floats across all rooms
            hints = room.hints or preset.default_hints or []
            hint_volume = room.hint_volume if hasattr(room, 'hint_volume') and room.hint_volume else {}
            hint_qty = room.hint_qty if hasattr(room, 'hint_qty') and room.hint_qty else {}
            for hint in hints:
                hint_str = hint.value if hasattr(hint, 'value') else str(hint)
                # Unit-based hint: qty × per-piece materials (no volume scaling)
                if hint_str in UNIT_HINT_MATERIAL_MAP:
                    qty = hint_qty.get(hint_str, 1)
                    # Category hints scale with room size (calibrated for large=80)
                    if hint_str in CATEGORY_UNIT_HINTS:
                        size_ratio = MAT_SCALE_PER_SIZE.get(preset.size, 80) / 80.0
                        for mat_key, per_unit in UNIT_HINT_MATERIAL_MAP[hint_str].items():
                            mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + qty * per_unit * size_ratio * density_mult
                    else:
                        for mat_key, per_unit in UNIT_HINT_MATERIAL_MAP[hint_str].items():
                            mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + qty * per_unit
                    continue
                # Volume-based hint: vol_scale × factor
                vol_level_idx = hint_volume.get(hint_str, 1)
                hint_vol_mult = HINT_VOLUME_MULTS[vol_level_idx] if 0 <= vol_level_idx < len(HINT_VOLUME_MULTS) else 1.0
                vol_scale = base_vol_scale * hint_vol_mult
                hint_materials = HINT_MATERIAL_MAP.get(hint_str, {})
                for mat_key, factor in hint_materials.items():
                    mat_floats[mat_key] = mat_floats.get(mat_key, 0.0) + vol_scale * factor

        # Convert accumulated floats to integers (ceil once per material, not per room).
        # Skip materials below threshold — avoids inflating near-zero fractions to 1
        # (e.g. sofa_cover in a bedroom where there is no sofa).
        # Threshold 0.25 balances filtering noise vs including legitimate materials
        # for small rooms or single-room estimates.
        materials: Dict[str, int] = dict(mattresses)
        for mat_key, raw in mat_floats.items():
            if mat_key == "packing_paper":
                continue  # handled separately below
            if raw < 0.25:
                continue  # too small to warrant inclusion
            materials[mat_key] = materials.get(mat_key, 0) + math.ceil(raw)

        # Count total boxes for packing paper and tape calculation
        box_keys = {k for k in materials if k.startswith("box_")}
        total_boxes = sum(materials.get(k, 0) for k in box_keys)

        # Packing paper: 1 bundle per ~15 boxes (50-lb bundle covers wrapping
        # and void fill for ~15 packed boxes), minimum 1 per 3 rooms.
        num_rooms = len(rooms)
        paper_from_hints = mat_floats.get("packing_paper", 0.0)
        paper_from_boxes = total_boxes / 15.0
        paper_from_rooms = num_rooms / 3.0
        materials["packing_paper"] = max(1, math.ceil(
            max(paper_from_hints, paper_from_boxes, paper_from_rooms)
        ))

        # Packing tape: 1 roll per ~10 boxes (each box needs ~4ft of tape,
        # standard roll is 55yd/165ft), minimum 1 per job.
        materials["packing_tape"] = max(1, math.ceil(total_boxes / 10.0))

        return materials

    def calculate_material_cost(self, materials: Dict[str, int]) -> float:
        """Calculate total material cost"""
        total = 0
        for mat_key, qty in materials.items():
            code = MATERIAL_CODES.get(mat_key)
            if code:
                total += self.get_price(code) * qty
        return total

    # ── Hybrid material categories ─────────────────────────────────────
    # Used to split the labor-based material total into 2-3 line items.
    _SUPPLY_KEYS = {
        "box_small", "box_medium", "box_large", "box_xlarge",
        "box_book", "box_dish", "box_wardrobe",
        "box_wardrobe_small", "box_wardrobe_large",
        "packing_paper", "packing_tape",
    }
    _SPECIALTY_KEYS = {
        "box_tv", "box_mirror", "box_lamp",
        "mattress_twin", "mattress_full",
        "mattress_queen", "mattress_king",
    }
    # Everything else (blanket, furniture_pad, chair_cover, sofa_cover,
    # bubble_12, bubble_24, shrink_wrap, corner_protector) → protective

    def build_hybrid_materials(
        self,
        pack_out_labor_cost: float,
        material_rate_pct: int,
        materials: Dict[str, int],
    ) -> Tuple[float, List[dict], List[dict]]:
        """Compute material cost as % of labor, split into 2-3 categories.

        Uses the itemised material breakdown only for determining the
        *ratio* between categories.  The total is anchored to labor cost.

        Returns (total_cost, section_detail_lines, material_details_legacy).
        """
        mat_total = pack_out_labor_cost * material_rate_pct / 100.0

        # Compute category costs from itemised breakdown for ratio
        supply_cost = 0.0
        protective_cost = 0.0
        specialty_cost = 0.0
        for mat_key, qty in materials.items():
            code = MATERIAL_CODES.get(mat_key)
            if not code or qty <= 0:
                continue
            cost = self.get_price(code) * qty
            if mat_key in self._SUPPLY_KEYS:
                supply_cost += cost
            elif mat_key in self._SPECIALTY_KEYS:
                specialty_cost += cost
            else:
                protective_cost += cost

        raw_total = supply_cost + protective_cost + specialty_cost
        if raw_total <= 0:
            supply_cost = 0.6
            protective_cost = 0.4
            specialty_cost = 0.0
            raw_total = 1.0

        # Distribute labor-based total proportionally
        supply_amt = round(mat_total * supply_cost / raw_total, 2)
        protective_amt = round(mat_total * protective_cost / raw_total, 2)
        specialty_amt = round(mat_total * specialty_cost / raw_total, 2)

        # Adjust rounding so they sum exactly to mat_total
        rounded_total = round(mat_total, 2)
        diff = rounded_total - (supply_amt + protective_amt + specialty_amt)
        supply_amt = round(supply_amt + diff, 2)

        # Build per-category item notes from actual materials present
        supply_names = []
        protective_names = []
        specialty_names = []
        for mk, mq in materials.items():
            if mq <= 0:
                continue
            code = MATERIAL_CODES.get(mk)
            if not code:
                continue
            p = self.prices.get(code)
            label = (
                p.name if p
                else DEFAULT_PRICES.get(code, {}).get("name", mk)
            )
            # Append qty for context: "Medium Box ×12"
            entry = f"{label} ×{mq}" if mq > 1 else label
            if mk in self._SUPPLY_KEYS:
                supply_names.append(entry)
            elif mk in self._SPECIALTY_KEYS:
                specialty_names.append(entry)
            else:
                protective_names.append(entry)

        supply_detail = ", ".join(supply_names) if supply_names else "Boxes, packing paper, tape"
        protective_detail = ", ".join(protective_names) if protective_names else "Moving blankets, pads, covers, wrap"
        specialty_detail = ", ".join(specialty_names) if specialty_names else "TV/mirror boxes, mattress bags"

        lines = [
            {
                "name": "Packing Supplies",
                "qty": 1, "unit": "LS",
                "rate": supply_amt,
                "detail": supply_detail,
                "amount": supply_amt,
            },
            {
                "name": "Protective Wrapping",
                "qty": 1, "unit": "LS",
                "rate": protective_amt,
                "detail": protective_detail,
                "amount": protective_amt,
            },
        ]
        if specialty_amt > 0:
            lines.append({
                "name": "Specialty Packaging",
                "qty": 1, "unit": "LS",
                "rate": specialty_amt,
                "detail": specialty_detail,
                "amount": specialty_amt,
            })

        # Legacy material_details (for export compatibility)
        material_details = [
            {"code": "MAT-SUP", "name": "Packing Supplies",
             "quantity": 1, "unit": "LS",
             "unit_price": supply_amt, "total": supply_amt,
             "detail": supply_detail},
            {"code": "MAT-PRO", "name": "Protective Wrapping",
             "quantity": 1, "unit": "LS",
             "unit_price": protective_amt, "total": protective_amt,
             "detail": protective_detail},
        ]
        if specialty_amt > 0:
            material_details.append({
                "code": "MAT-SPE", "name": "Specialty Packaging",
                "quantity": 1, "unit": "LS",
                "unit_price": specialty_amt, "total": specialty_amt,
                "detail": specialty_detail,
            })

        return rounded_total, lines, material_details

    def calculate_estimate(self, request: QuickEstimateRequest) -> EstimateResponse:
        """Main calculation method"""

        # Calculate room bases
        total_room_base = 0
        total_items = 0

        for room in request.rooms:
            room_price, items = self.calculate_room_base(room)
            total_room_base += room_price
            total_items += items

        # Region labor premium (applied to labor only, not materials/storage)
        region_str = request.region.value if hasattr(request.region, 'value') else str(getattr(request, 'region', 'midwest'))
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)

        # Room base rates represent the TOTAL COST to pack each room.
        # Labor cost = room_base × region_mult.
        # Person-hours = cost / rate. Elapsed = person-hours / crew.
        labor_base = total_room_base * region_mult

        # Calculate hours
        labor_rate = self.get_price("2825")  # Content manipulation
        person_hours_total = labor_base / labor_rate if labor_rate > 0 else 0
        # total_hours = ELAPSED time (what the client actually experiences on-site)
        total_hours = person_hours_total / request.crew_size if request.crew_size > 0 else person_hours_total

        # Pack-out/pack-back split (elapsed hours)
        pack_out_hours = round(total_hours * 0.62, 1)
        pack_back_hours = round(total_hours * 0.38, 1) if request.include_packback else 0

        # Supervision hours (1 person, not full crew)
        supervisor_hours = max(1, round(total_hours * 0.1))
        supervisor_rate = self.get_price("2911")

        crew = request.crew_size

        # Calculate materials: hybrid approach
        # Itemised breakdown used only for category ratios;
        # total is anchored to pack-out labor × material_rate%.
        materials = self.calculate_materials(request.rooms)
        # Pack-out labor cost = elapsed hours × crew × rate (all crew members working)
        pack_out_labor_cost = pack_out_hours * crew * labor_rate
        material_rate_pct = getattr(request, 'material_rate', 25)
        material_cost, mat_section_lines, mat_details_legacy = (
            self.build_hybrid_materials(
                pack_out_labor_cost, material_rate_pct, materials,
            )
        )

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE
        quick_num_rooms = len(request.rooms)
        quick_loading_hours = max(2.0, quick_num_rooms * 0.5)
        loading_cost = request.crew_size * quick_loading_hours * labor_rate

        # On-site: no truck, just crew moving contents within the property
        quick_on_site_hours = max(1.5, quick_num_rooms * 0.35)
        on_site_moving_fee = request.crew_size * quick_on_site_hours * labor_rate

        # Storage costs (per SF) - always calculate SF for display
        storage_sf = self.estimate_storage_sf_from_rooms(
            request.rooms
        )
        storage_cost = 0
        if not is_on_site and request.storage_months > 0:
            setup_fee = get_storage_setup_fee(storage_sf)
            sf_rate = self.get_price("2840") or 2.18
            storage_cost = (
                storage_sf * sf_rate * request.storage_months
                + setup_fee
            )

        # Smart truck selection based on job size
        _, truck_rate = self.select_truck(storage_sf)
        # Truck trips: large van holds ~500 SF
        quick_truck_trips = max(
            1, math.ceil(storage_sf / 500)
        ) if storage_sf > 0 else 1

        # Special items (fixed cost, not affected by region/density/floor)
        # Merge request-level + per-room special items
        all_special = set(getattr(request, 'special_items', []))
        all_custom_special = list(getattr(request, 'custom_special_items', []))
        for room_input in request.rooms:
            all_special.update(getattr(room_input, 'special_items', []))
            all_custom_special.extend(getattr(room_input, 'custom_special_items', []))

        special_item_cost = 0.0
        special_item_lines = []
        for item_key in all_special:
            spec = SPECIAL_ITEM_COSTS.get(item_key)
            if spec:
                special_item_cost += spec["price"]
                special_item_lines.append(spec)
        for custom in all_custom_special:
            special_item_cost += custom.price
            special_item_lines.append({"name": custom.name, "unit": "EA", "price": custom.price})

        # Build sections (Pack-Out Labor total is recalculated after section_details)
        # Note: hours are ELAPSED, cost = elapsed × crew × rate
        sections = {
            "Pack-Out Labor": pack_out_hours * crew * labor_rate,
            "Materials": material_cost,
        }

        if is_on_site:
            sections["On-Site Relocation"] = on_site_moving_fee
        else:
            sections["Transport Out"] = (truck_rate + loading_cost) * quick_truck_trips
            if storage_cost > 0:
                sections["Storage"] = storage_cost

        if request.include_packback:
            if is_on_site:
                sections["On-Site Pack-Back Move"] = on_site_moving_fee
            else:
                sections["Transport Back"] = (truck_rate + loading_cost) * quick_truck_trips
            sections["Pack-Back Labor"] = pack_back_hours * crew * labor_rate

        if special_item_cost > 0:
            sections["Special Items"] = round(special_item_cost, 2)

        # Initial totals (recalculated after section_details adjust sections)
        subtotal = sum(sections.values())
        op_amount = subtotal * (request.op_rate / 100) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = subtotal * (request.contingency_rate / 100) if request.include_contingency else 0
        grand_total = subtotal + op_amount + supplements_total + contingency_amount

        room_summaries = self._build_room_summaries_from_hints(
            request.rooms
        )

        # Build section_details for notes/audit trail
        section_details: Dict[str, Any] = {}
        crew = request.crew_size

        # Split Pack-Out Labor into sub-lines matching PDF format.
        # Line items show ELAPSED hours (wall-clock time on site);
        # rate = per-person rate × crew size, so amount = elapsed × crew_rate.
        _po_elapsed_std = max(1, round(pack_out_hours * 0.6, 1))
        _po_elapsed_fragile = round(pack_out_hours * 0.15, 1)
        _po_elapsed_specialty = round(pack_out_hours * 0.08, 1)
        _po_elapsed_furniture = round(pack_out_hours * 0.1, 1)
        _po_elapsed_appliance = round(pack_out_hours * 0.08, 1)
        _po_inventory_hours = max(1, round(total_hours * 0.06))  # 1 person, not crew

        crew_labor_rate = round(labor_rate * crew, 2)
        _specialty_rate = self.get_price("2912") or 125.00
        _specialty_crew_rate = round(_specialty_rate * crew, 2)

        _po_crew_elapsed = round(_po_elapsed_std + _po_elapsed_furniture + _po_elapsed_appliance, 1)
        _po_crew_amt = round(_po_crew_elapsed * crew_labor_rate, 2)
        _sv_amt = round(supervisor_hours * supervisor_rate, 2)
        po_detail_lines = [
            {"name": "Pack-Out Crew Labor", "qty": _po_crew_elapsed, "unit": "HR",
             "rate": crew_labor_rate,
             "detail": _crew_detail("wrap, box, label, load", _po_crew_elapsed, crew, labor_rate, _po_crew_amt),
             "amount": _po_crew_amt},
            {"name": "Supervisor/Foreman", "qty": supervisor_hours, "unit": "HR",
             "rate": round(supervisor_rate, 2),
             "detail": f"On-site supervision across {len(request.rooms)} rooms · {supervisor_hours} hr × {_fmt_money(supervisor_rate)}/hr = {_fmt_money(_sv_amt)}",
             "amount": _sv_amt},
        ]
        _po_specialized_elapsed = round(_po_elapsed_fragile + _po_elapsed_specialty, 1)
        if _po_specialized_elapsed > 0:
            _spec_amt = round(_po_specialized_elapsed * _specialty_crew_rate, 2)
            po_detail_lines.append(
                {"name": "Specialized Handling", "qty": _po_specialized_elapsed, "unit": "HR",
                 "rate": _specialty_crew_rate,
                 "detail": _crew_detail(
                     "electronics, fragile items, artwork — extra care",
                     _po_specialized_elapsed, crew, _specialty_rate, _spec_amt,
                 ),
                 "amount": _spec_amt},
            )
        section_details["Pack-Out Labor"] = {"lines": po_detail_lines}
        # Recalculate Pack-Out Labor section total to match sub-lines
        sections["Pack-Out Labor"] = sum(l["amount"] for l in po_detail_lines)

        if not is_on_site:
            _loading_amt = round(quick_loading_hours * crew_labor_rate, 2)
            _t_out_lines = [
                {"name": "26' Moving Van", "qty": quick_truck_trips, "unit": "DY",
                 "rate": round(truck_rate, 2),
                 "detail": f"{quick_truck_trips} trip{'s' if quick_truck_trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(truck_rate * quick_truck_trips, 2)},
                {"name": "Loading Labor", "qty": quick_loading_hours, "unit": "HR",
                 "rate": crew_labor_rate,
                 "detail": _crew_detail("stage, load, secure", quick_loading_hours, crew, labor_rate, _loading_amt),
                 "amount": _loading_amt},
            ]
            _t_back_lines = [
                {"name": "26' Moving Van", "qty": quick_truck_trips, "unit": "DY",
                 "rate": round(truck_rate, 2),
                 "detail": f"{quick_truck_trips} trip{'s' if quick_truck_trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(truck_rate * quick_truck_trips, 2)},
                {"name": "Unloading Labor", "qty": quick_loading_hours, "unit": "HR",
                 "rate": crew_labor_rate,
                 "detail": _crew_detail(
                     "unload, stage at entry, distribute", quick_loading_hours, crew, labor_rate, _loading_amt,
                 ),
                 "amount": _loading_amt},
            ]
            section_details["Transport Out"] = {"lines": _t_out_lines}
            # Recalculate Transport section totals to match sub-lines
            sections["Transport Out"] = sum(l["amount"] for l in _t_out_lines)
            if request.include_packback:
                section_details["Transport Back"] = {"lines": _t_back_lines}
                sections["Transport Back"] = sum(l["amount"] for l in _t_back_lines)
            if storage_cost > 0:
                _sf_rate = self.get_price("2840") or 2.18
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months,
                    _setup_fee, storage_cost,
                )
        if request.include_packback:
            # Split Pack-Back into sub-lines (elapsed hours; rate = crew_labor_rate)
            _pb_elapsed_base = max(1, round(pack_back_hours * 0.70, 1))
            _pb_elapsed_reassembly = round(pack_back_hours * 0.15, 1)
            _pb_elapsed_appliance = round(pack_back_hours * 0.08, 1)
            _pb_supervisor = max(1, round(pack_back_hours * 0.12))  # 1 person

            _pb_crew_elapsed = round(_pb_elapsed_base + _pb_elapsed_reassembly + _pb_elapsed_appliance, 1)
            _pb_crew_amt = round(_pb_crew_elapsed * crew_labor_rate, 2)
            _pb_sv_amt = round(_pb_supervisor * supervisor_rate, 2)

            pb_lines = [
                {"name": "Pack-Back Crew Labor", "qty": _pb_crew_elapsed, "unit": "HR",
                 "rate": crew_labor_rate,
                 "detail": _crew_detail("unpack, place, reassemble", _pb_crew_elapsed, crew, labor_rate, _pb_crew_amt),
                 "amount": _pb_crew_amt},
                {"name": "Supervisor/Foreman", "qty": _pb_supervisor, "unit": "HR",
                 "rate": round(supervisor_rate, 2),
                 "detail": f"Pack-back oversight, quality control, client walkthrough · {_pb_supervisor} hr × {_fmt_money(supervisor_rate)}/hr = {_fmt_money(_pb_sv_amt)}",
                 "amount": _pb_sv_amt},
            ]
            section_details["Pack-Back Labor"] = {"lines": pb_lines}
            # Recalculate Pack-Back Labor section total to match sub-lines
            sections["Pack-Back Labor"] = sum(l["amount"] for l in pb_lines)

        if special_item_lines:
            section_details["Special Items"] = {"lines": [
                {"name": s["name"], "qty": 1, "unit": s["unit"],
                 "rate": s["price"],
                 "detail": "Fixed-cost specialty item — independent of density/floor/region",
                 "amount": s["price"]}
                for s in special_item_lines
            ]}

        # Build Materials section_details from hybrid category lines
        section_details["Materials"] = {"lines": mat_section_lines}
        material_details = mat_details_legacy

        # Build Storage section_details when storage is included but cost is 0
        if "Storage" not in section_details:
            if not is_on_site and storage_sf > 0:
                _sf_rate = self.get_price("2840") or 2.18
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months or 0,
                    _setup_fee, storage_cost,
                )
            else:
                section_details["Storage"] = {"lines": []}

        # Reconcile ALL section totals from their detail lines so there is
        # no rounding drift between independent calculations.
        for sec_name, sec_detail in section_details.items():
            lines = sec_detail.get("lines", [])
            if lines and sec_name in sections:
                sections[sec_name] = round(sum(l.get("amount", 0) for l in lines), 2)

        # Recalculate totals after section_details adjusted section amounts
        subtotal = round(sum(sections.values()), 2)
        op_amount = round(subtotal * (request.op_rate / 100), 2) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = round(subtotal * (request.contingency_rate / 100), 2) if request.include_contingency else 0
        grand_total = round(subtotal + op_amount + supplements_total + contingency_amount, 2)

        # Workday scheduling notes
        WORKDAY_HOURS = 8
        quick_notes: list[str] = []
        if total_hours > WORKDAY_HOURS:
            work_days = math.ceil(total_hours / WORKDAY_HOURS)
            quick_notes.append(
                f"Estimated on-site time is {round(total_hours, 1)} hrs "
                f"({request.crew_size}-person crew), exceeding a standard {WORKDAY_HOURS}-hr workday. "
                f"Recommend scheduling {work_days} days."
            )

        return EstimateResponse(
            total_rooms=len(request.rooms),
            total_items=total_items,
            total_hours=round(total_hours, 1),
            crew_size=request.crew_size,
            sections=sections,
            section_details=section_details,
            materials=materials,
            material_details=material_details,
            storage_sf=storage_sf if not is_on_site else 0,
            staging_type=request.staging_type,
            room_summaries=room_summaries,
            subtotal=round(subtotal, 2),
            include_op=request.include_op,
            op_rate=request.op_rate,
            op_amount=round(op_amount, 2),
            include_contingency=request.include_contingency,
            contingency_rate=request.contingency_rate,
            contingency_amount=round(contingency_amount, 2),
            supplements=supplements,
            supplements_total=round(supplements_total, 2),
            grand_total=round(grand_total, 2),
            notes=quick_notes,
        )

    # ============================================
    # ITEM-BASED CALCULATION (from room content lists)
    # ============================================

    # Categories that use fragile labor rate
    FRAGILE_CATEGORIES = {"Fragile", "Artwork", "Collectibles"}
    # Categories that use specialty labor rate
    SPECIALTY_CATEGORIES = {"Electronics"}

    # ── Room-based labor estimation ──────────────────────────────────
    # Labor is driven by room characteristics, NOT individual item counts.
    # Item analysis exists for packing MATERIALS — labor is about how long
    # a crew spends in a room based on density, content type, and room size.
    #
    # Base = PERSON-HOURS (single-worker equivalent).
    # A 4-person crew in a standard bedroom at normal density: 4.0 ph ÷ 4 = 1.0 elapsed hr.
    # Reference: industry average 1-2 elapsed hours per standard room with 3-4 crew.
    ROOM_BASE_PERSON_HOURS = {
        "small": 2.0,    # bathroom, closet, pantry — ~30 min elapsed with 4 crew
        "large": 5.5,    # standard bedroom, living room, kitchen — ~1.4 hr elapsed
        "xlarge": 9.0,   # master bedroom, basement, garage — ~2.25 hr elapsed
    }

    CONTENT_TYPE_MODIFIERS = {
        "fragile_heavy":    0.40,   # dishes, glass → careful wrapping adds ~40%
        "furniture_heavy":  0.30,   # large furniture → disassembly, blanket wrap
        "appliance_heavy":  0.25,   # appliances → disconnect, dolly
        "electronics_heavy": 0.15,  # electronics → serial#, careful boxing
        "clothing_dominant": -0.10, # mostly clothing → faster wardrobe-box packing
    }

    def _classify_room_content(self, items: List[Any]) -> Dict[str, bool]:
        """Determine dominant content types in a room from its items."""
        if not items:
            return {}
        total_lines = len(items)
        cats: Dict[str, int] = {}
        fragile_lines = 0
        for item in items:
            cat = getattr(item, "category", "Other")
            cats[cat] = cats.get(cat, 0) + 1
            if getattr(item, "is_fragile", False):
                fragile_lines += 1

        flags: Dict[str, bool] = {}
        threshold = max(2, total_lines * 0.30)

        if fragile_lines >= threshold or cats.get("Kitchenware", 0) + cats.get("Fragile", 0) >= threshold:
            flags["fragile_heavy"] = True
        if cats.get("Furniture", 0) >= threshold:
            flags["furniture_heavy"] = True
        if cats.get("Appliances", 0) >= threshold:
            flags["appliance_heavy"] = True
        if cats.get("Electronics", 0) >= threshold:
            flags["electronics_heavy"] = True
        if cats.get("Clothing", 0) >= total_lines * 0.50:
            flags["clothing_dominant"] = True

        return flags

    def _get_room_size(self, room) -> str:
        """Resolve room size from preset_id or fallback to 'large'."""
        preset_id = getattr(room, 'preset_id', None)
        if preset_id and preset_id in self.presets:
            return self.presets[preset_id].size
        name = getattr(room, 'room_name', '').lower()
        if any(k in name for k in ('bath', 'closet', 'pantry', 'laundry', 'half')):
            return "small"
        if any(k in name for k in ('master', 'basement', 'garage', 'attic', 'family')):
            return "xlarge"
        return "large"

    # ---- Rule-based Packing Enrichment ----
    # Assigns packing method, materials, and labor to items at calculate time.
    # Runs on the CURRENT item list (after user edits), not the AI analysis snapshot.

    # Per-category defaults: (base_labor_h, per_unit_labor_h, needs_disassembly, materials, method)
    CATEGORY_PACKING_RULES: Dict[str, dict] = {
        "Furniture": {
            "base": 0.10, "per_unit": 0.28, "disassembly": False,
            "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
            "method": "Wrap in moving blankets; secure with stretch wrap; protect corners.",
        },
        "Appliances": {
            "base": 0.15, "per_unit": 0.30, "disassembly": False,
            "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
            "method": "Disconnect; secure loose parts; wrap in blankets; dolly to staging.",
        },
        "Electronics": {
            "base": 0.08, "per_unit": 0.18, "disassembly": False,
            "materials": ["medium_box", "bubble_wrap_12"],
            "method": "Wrap in bubble wrap; place in box with padding; label FRAGILE.",
        },
        "Books": {
            "base": 0.15, "per_unit": 0.01, "disassembly": False,
            "materials": ["book_box"],
            "method": "Pack flat in book boxes (15-20 per box); do not overfill.",
        },
        "Fragile": {
            "base": 0.15, "per_unit": 0.04, "disassembly": False,
            "materials": ["dish_pack_box", "packing_paper", "packing_paper"],
            "method": "Wrap each piece individually in packing paper; pack in dish-pack box with padding.",
        },
        "Artwork": {
            "base": 0.10, "per_unit": 0.25, "disassembly": False,
            "materials": ["mirror_box", "bubble_wrap_12"],
            "method": "Wrap in bubble wrap; place in mirror/picture box; mark FRAGILE.",
        },
        "Kitchenware": {
            "base": 0.15, "per_unit": 0.03, "disassembly": False,
            "materials": ["dish_pack_box", "packing_paper"],
            "method": "Wrap each item in packing paper; pack in dish-pack box; fill voids.",
        },
        "Clothing": {
            "base": 0.10, "per_unit": 0.005, "disassembly": False,
            "materials": ["wardrobe_box"],
            "method": "Hanging garments in wardrobe box; fold remaining into medium box.",
        },
        "Collectibles": {
            "base": 0.10, "per_unit": 0.05, "disassembly": False,
            "materials": ["small_box", "bubble_wrap_12", "packing_paper"],
            "method": "Wrap individually in bubble wrap; cushion with paper; label HIGH CARE.",
        },
        "Tools": {
            "base": 0.10, "per_unit": 0.02, "disassembly": False,
            "materials": ["medium_box"],
            "method": "Group in medium boxes; wrap sharp edges; label HEAVY.",
        },
        "Sports": {
            "base": 0.08, "per_unit": 0.20, "disassembly": False,
            "materials": ["moving_blanket", "stretch_wrap"],
            "method": "Wrap in blanket or pad; secure loose parts with stretch wrap.",
        },
        "Other": {
            "base": 0.08, "per_unit": 0.10, "disassembly": False,
            "materials": ["medium_box", "packing_paper"],
            "method": "Wrap in packing paper; place in box; fill voids.",
        },
    }

    # Name-based overrides for specific item types
    ITEM_NAME_OVERRIDES: Dict[str, dict] = {
        "bed frame": {"disassembly": True, "per_unit": 0.40,
                      "materials": ["moving_blanket", "moving_blanket", "moving_blanket", "stretch_wrap"],
                      "method": "Disassemble; bag hardware; wrap rails and headboard in blankets."},
        "sectional": {"per_unit": 0.30,
                      "materials": ["sofa_cover", "moving_blanket", "moving_blanket", "stretch_wrap"],
                      "method": "Separate sections; wrap each in sofa cover + blankets; stretch wrap."},
        "sofa": {"per_unit": 0.35,
                 "materials": ["sofa_cover", "moving_blanket", "moving_blanket", "stretch_wrap"],
                 "method": "Cover with sofa cover; wrap in blankets; secure with stretch wrap."},
        "wardrobe": {"disassembly": True, "per_unit": 0.50,
                     "materials": ["moving_blanket", "moving_blanket", "moving_blanket", "stretch_wrap"],
                     "method": "Remove shelves/drawers; disassemble if needed; wrap body in blankets."},
        "dresser": {"per_unit": 0.25,
                    "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
                    "method": "Tape drawers shut; wrap in blankets; stretch wrap to secure."},
        "dining table": {"disassembly": True, "per_unit": 0.30,
                         "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
                         "method": "Remove legs if possible; wrap top in blankets; bag hardware."},
        "bookshelf": {"per_unit": 0.20,
                      "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
                      "method": "Remove contents; wrap unit in blankets; stretch wrap shelves shut."},
        "bookcase": {"per_unit": 0.20,
                     "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
                     "method": "Remove contents; wrap unit in blankets; stretch wrap shelves shut."},
        "tv": {"per_unit": 0.20,
               "materials": ["tv_box", "bubble_wrap_12", "bubble_wrap_12"],
               "method": "Wrap screen in bubble wrap; place in TV box; pad all sides."},
        "monitor": {"per_unit": 0.20,
                    "materials": ["tv_box", "bubble_wrap_12"],
                    "method": "Wrap in bubble wrap; place in TV box with foam padding."},
        "chair": {"per_unit": 0.15,
                  "materials": ["chair_cover", "stretch_wrap"],
                  "method": "Apply chair cover; wrap legs with stretch wrap."},
        "armchair": {"per_unit": 0.25,
                     "materials": ["chair_cover", "moving_blanket", "stretch_wrap"],
                     "method": "Apply chair cover; pad with blanket; stretch wrap."},
        "recliner": {"per_unit": 0.28,
                     "materials": ["chair_cover", "moving_blanket", "stretch_wrap"],
                     "method": "Lock recliner mechanism; chair cover; blanket wrap; stretch wrap."},
        "mattress": {"per_unit": 0.12,
                     "materials": ["mattress_bag"],
                     "method": "Slide into mattress bag; seal with tape."},
        "lamp": {"per_unit": 0.10,
                 "materials": ["lamp_box", "packing_paper"],
                 "method": "Remove shade and bulb; wrap base; place in lamp box."},
        "rug": {"per_unit": 0.15,
                "materials": ["stretch_wrap"],
                "method": "Roll tightly; secure with stretch wrap."},
        "mirror": {"per_unit": 0.20,
                   "materials": ["mirror_box", "bubble_wrap_12"],
                   "method": "Wrap in bubble wrap; place in mirror box; mark FRAGILE."},
        "refrigerator": {"per_unit": 0.35,
                         "materials": ["moving_blanket", "moving_blanket", "stretch_wrap"],
                         "method": "Empty; clean; secure doors with tape; wrap in blankets."},
        "washer": {"per_unit": 0.28,
                   "materials": ["moving_blanket", "stretch_wrap"],
                   "method": "Disconnect hoses; secure drum; wrap in blanket."},
        "dryer": {"per_unit": 0.25,
                  "materials": ["moving_blanket", "stretch_wrap"],
                  "method": "Disconnect; wrap in blanket; secure with stretch wrap."},
    }

    # ── Size/Weight inference ─────────────────────────────────────
    # Category defaults cover ~80% of items correctly.
    # Name overrides only for cases where category default is WRONG.

    CATEGORY_SIZE_WEIGHT: Dict[str, tuple] = {
        # (size, weight) — reasonable midpoint for each category
        "Furniture":    ("L", "heavy"),      # most furniture is large & heavy
        "Appliances":   ("L", "heavy"),      # most appliances are large & heavy
        "Electronics":  ("M", "medium"),     # TVs, computers, etc.
        "Books":        ("S", "medium"),     # per-book is small, boxes are heavy
        "Kitchenware":  ("S", "light"),      # dishes, pots, utensils
        "Clothing":     ("S", "light"),      # fabric items
        "Fragile":      ("S", "light"),      # glassware, ceramics
        "Artwork":      ("M", "light"),      # frames, canvases
        "Collectibles": ("S", "light"),      # small items
        "Tools":        ("S", "medium"),     # hand tools
        "Sports":       ("M", "medium"),     # varies widely; overrides handle heavy items
        "Other":        ("M", "medium"),     # catch-all
    }

    # Only override when category default is clearly WRONG.
    # Broad keywords — first match wins.
    # Format: (keyword, size, weight)
    ITEM_SIZE_WEIGHT_OVERRIDES = [
        # ── XXL: specialty items requiring special handling ──
        ("piano",       "XXL", "extra_heavy"),
        ("pool table",  "XXL", "extra_heavy"),
        ("hot tub",     "XXL", "extra_heavy"),
        ("jacuzzi",     "XXL", "extra_heavy"),

        # ── XL + extra_heavy: oversized + very heavy ──
        ("safe",        "XL", "extra_heavy"),  # gun safe, fire safe
        ("rack",        "XL", "extra_heavy"),  # power rack, squat rack, server rack
        ("smith",       "XL", "extra_heavy"),  # smith machine
        ("multi-gym",   "XL", "extra_heavy"),
        ("home gym",    "XL", "extra_heavy"),
        ("cable machine", "XL", "extra_heavy"),

        # ── L + extra_heavy: large appliances ──
        ("fridge",      "L", "extra_heavy"),
        ("refrigerator", "L", "extra_heavy"),
        ("freezer",     "L", "extra_heavy"),
        ("washer",      "L", "extra_heavy"),
        ("washing",     "L", "extra_heavy"),
        ("treadmill",   "L", "extra_heavy"),
        ("stove",       "L", "extra_heavy"),
        ("range",       "L", "extra_heavy"),
        ("oven",        "L", "heavy"),
        ("dishwasher",  "L", "heavy"),

        # ── XL + heavy: oversized furniture ──
        ("sectional",   "XL", "heavy"),
        ("wardrobe",    "XL", "heavy"),
        ("armoire",     "XL", "heavy"),
        ("hutch",       "XL", "heavy"),
        ("entertainment center", "XL", "heavy"),
        ("wall unit",   "XL", "heavy"),
        ("king",        "XL", "heavy"),  # king bed, king mattress
        ("queen",       "XL", "heavy"),  # queen bed

        # ── XL + medium: large but lighter ──
        ("mattress",    "XL", "medium"),
        ("trampoline",  "XL", "medium"),

        # ── L + medium: large but manageable ──
        ("rug",         "L", "medium"),
        ("carpet",      "L", "medium"),
        ("curtain",     "L", "light"),
        ("drape",       "L", "light"),

        # ── M furniture (smaller than default L) ──
        ("nightstand",  "M", "medium"),
        ("end table",   "M", "medium"),
        ("side table",  "M", "medium"),
        ("coffee table", "M", "heavy"),
        ("ottoman",     "M", "medium"),
        ("bench",       "M", "heavy"),   # weight bench, entryway bench
        ("stool",       "S", "light"),
        ("folding",     "M", "medium"),  # folding chair, folding table
        ("tv stand",    "M", "heavy"),
        ("console",     "M", "heavy"),   # console table, media console
        ("credenza",    "L", "heavy"),

        # ── S furniture (much smaller than default L) ──
        ("lamp",        "S", "light"),
        ("shade",       "S", "light"),   # lamp shade
        ("pillow",      "S", "light"),
        ("cushion",     "S", "light"),
        ("throw",       "S", "light"),   # throw blanket
        ("basket",      "S", "light"),
        ("bin",         "S", "light"),
        ("hamper",      "M", "light"),
        ("plant",       "S", "medium"),  # potted plant
        ("vase",        "S", "medium"),
        ("clock",       "S", "light"),
        ("fan",         "M", "medium"),  # standing fan

        # ── Appliances: smaller ones (default is L/heavy) ──
        ("microwave",   "M", "medium"),
        ("toaster",     "S", "light"),
        ("blender",     "S", "light"),
        ("coffee",      "S", "medium"),  # coffee maker, coffee machine
        ("instant pot", "M", "medium"),
        ("air fryer",   "M", "medium"),
        ("vacuum",      "M", "medium"),
        ("iron",        "S", "light"),
        ("sewing",      "M", "medium"),  # sewing machine
        ("printer",     "M", "medium"),

        # ── Electronics: smaller (default is M/medium) ──
        ("phone",       "XS", "light"),
        ("remote",      "XS", "light"),
        ("tablet",      "S", "light"),
        ("laptop",      "S", "light"),
        ("router",      "S", "light"),
        ("modem",       "S", "light"),
        ("charger",     "XS", "light"),
        ("speaker",     "S", "medium"),
        ("soundbar",    "M", "medium"),
        ("monitor",     "M", "medium"),
        ("desktop",     "M", "heavy"),   # desktop computer
        ("tower",       "M", "heavy"),   # PC tower
        ("projector",   "M", "medium"),
        ("game",        "S", "medium"),  # game console

        # ── Sports: gym equipment (heavy) ──
        ("elliptical",  "L", "extra_heavy"),
        ("rowing",      "L", "heavy"),       # rowing machine
        ("stair climb", "L", "heavy"),
        ("exercise bike", "L", "heavy"),
        ("stationary bike", "L", "heavy"),
        ("dumbbell",    "S", "heavy"),
        ("kettlebell",  "S", "heavy"),
        ("weight plate", "S", "heavy"),
        ("barbell",     "M", "heavy"),
        ("mat",         "M", "light"),   # yoga mat, exercise mat
        ("resistance",  "S", "light"),
        ("jump rope",   "S", "light"),
        ("ball",        "M", "light"),   # exercise ball, basketball
        ("helmet",      "S", "light"),
        ("skis",        "L", "medium"),
        ("snowboard",   "L", "medium"),
        ("golf",        "L", "medium"),  # golf bag, golf clubs
        ("bicycle",     "L", "medium"),
        ("bike",        "L", "medium"),
        ("scooter",     "M", "medium"),
        ("skateboard",  "M", "light"),
        ("surfboard",   "XL", "medium"),

        # ── Kitchenware: heavier items (default is S/light) ──
        ("pot",         "M", "medium"),  # large cooking pot
        ("pan",         "S", "medium"),
        ("cast iron",   "S", "heavy"),
        ("mixer",       "M", "heavy"),   # stand mixer
        ("food processor", "M", "medium"),
        ("wok",         "M", "medium"),

        # ── Artwork: larger pieces (default is M/light) ──
        ("painting",    "L", "medium"),  # large framed painting
        ("sculpture",   "M", "heavy"),
        ("statue",      "M", "heavy"),
        ("canvas",      "L", "light"),

        # ── Books: heavier (default is S/medium) ──
        ("encyclopedia", "M", "heavy"),
        ("textbook",    "S", "heavy"),
        ("collection",  "M", "heavy"),   # book collection

        # ── Tools: larger ones (default is S/medium) ──
        ("workbench",   "L", "extra_heavy"),
        ("tool chest",  "L", "extra_heavy"),
        ("tool box",    "M", "heavy"),
        ("mower",       "L", "heavy"),   # lawn mower
        ("saw",         "M", "heavy"),   # table saw, miter saw
        ("drill press", "L", "heavy"),
        ("compressor",  "M", "heavy"),
        ("generator",   "L", "extra_heavy"),
        ("ladder",      "L", "medium"),
        ("wheelbarrow", "L", "medium"),

        # ── Bundled/grouped items ──
        ("bedding",     "M", "light"),
        ("linen",       "M", "light"),
        ("towel",       "S", "light"),
        ("sundries",    "S", "light"),
        ("utensil",     "S", "light"),
        ("supplies",    "S", "light"),
        ("accessories", "S", "light"),
        ("miscellaneous", "M", "light"),
        ("assorted",    "M", "light"),
        ("set",         "M", "medium"),  # dish set, tool set, etc.
        ("collection",  "M", "medium"),
    ]

    def _infer_size_weight(self, cat: str, name: str) -> tuple:
        """Infer (size, weight) from category and item name.

        1. Check name keywords (first match wins) — only for exceptions.
        2. Fall back to category defaults — covers most items correctly.
        """
        name_lower = name.lower()
        for keyword, size, weight in self.ITEM_SIZE_WEIGHT_OVERRIDES:
            if keyword in name_lower:
                return (size, weight)
        return self.CATEGORY_SIZE_WEIGHT.get(cat, ("M", "medium"))

    def enrich_items_for_estimate(self, items: List[Any]) -> List[Any]:
        """Assign packing method, materials, labor, size, and weight to items.

        Called at calculate time on the user's current item list (may have been
        edited after AI analysis). Existing packing details from AI are overwritten
        to ensure consistency with the item's current name/category.

        Size/weight are inferred from category + item name if not already set.
        """
        for item in items:
            cat = getattr(item, 'category', 'Other') or 'Other'
            name_lower = (getattr(item, 'name', '') or '').lower()

            # Infer size/weight if not already set by user
            if not getattr(item, 'size', None) or not getattr(item, 'weight', None):
                inferred_size, inferred_weight = self._infer_size_weight(
                    cat, getattr(item, 'name', '') or ''
                )
                if not getattr(item, 'size', None):
                    item.size = inferred_size
                if not getattr(item, 'weight', None):
                    item.weight = inferred_weight

            # Start with category defaults
            rule = self.CATEGORY_PACKING_RULES.get(cat, self.CATEGORY_PACKING_RULES["Other"])

            base_h = rule["base"]
            per_unit_h = rule["per_unit"]
            disassembly = rule["disassembly"]
            materials = list(rule["materials"])
            method = rule["method"]

            # Apply name-based overrides (most specific match wins)
            for keyword, override in self.ITEM_NAME_OVERRIDES.items():
                if keyword in name_lower:
                    if "base" in override:
                        base_h = override["base"]
                    if "per_unit" in override:
                        per_unit_h = override["per_unit"]
                    if "disassembly" in override:
                        disassembly = override["disassembly"]
                    if "materials" in override:
                        materials = list(override["materials"])
                    if "method" in override:
                        method = override["method"]
                    break  # first match

            # High-value items get extra care
            if getattr(item, 'is_high_value', False):
                per_unit_h *= 1.2
                if "bubble_wrap_12" not in materials:
                    materials.append("bubble_wrap_12")

            # Fragile items get extra wrapping
            if getattr(item, 'is_fragile', False) and cat not in ("Fragile", "Kitchenware"):
                per_unit_h *= 1.15
                if "packing_paper" not in materials:
                    materials.append("packing_paper")

            # Size + Weight labor adjustment
            # Size and weight are correlated (large items tend to be heavy),
            # so using max() instead of multiplication avoids double-counting
            # the physical handling difficulty.
            item_size = getattr(item, 'size', None)
            SIZE_LABOR_MULT = {
                "XS": 0.5, "S": 0.7, "M": 1.0,
                "L": 1.2, "XL": 1.4, "XXL": 1.7,
            }
            item_weight = getattr(item, 'weight', None)
            WEIGHT_LABOR_MULT = {
                "light": 0.8, "medium": 1.0,
                "heavy": 1.2, "extra_heavy": 1.5,
            }
            size_mult = SIZE_LABOR_MULT.get(item_size, 1.0) if item_size else 1.0
            weight_mult = WEIGHT_LABOR_MULT.get(item_weight, 1.0) if item_weight else 1.0
            # Use the dominant factor, not both — they measure the same difficulty
            physical_mult = max(size_mult, weight_mult)
            per_unit_h *= physical_mult

            # Extra blankets for XL/XXL items
            if item_size in ("XL", "XXL"):
                extra_blankets = 1 if item_size == "XL" else 2
                for _ in range(extra_blankets):
                    if "moving_blanket" not in materials or materials.count("moving_blanket") < 3:
                        materials.append("moving_blanket")

            # Heavy/extra_heavy → flag for 2-man lift
            if item_weight in ("heavy", "extra_heavy"):
                if "HEAVY" not in (getattr(item, 'estimator_flags', None) or []):
                    pass  # will be set below after flags init

            qty = getattr(item, 'quantity', 1) or 1
            total_labor = base_h + per_unit_h * qty

            # Set attributes
            item.base_labor_hours = round(base_h, 3)
            item.per_unit_labor_hours = round(per_unit_h, 3)
            item.estimated_labor_hours = round(total_labor, 2)
            item.needs_disassembly = disassembly
            item.required_materials = materials
            item.packing_method = method
            item.estimator_flags = []
            if disassembly:
                item.estimator_flags.append("DISASSEMBLY")
            if getattr(item, 'is_high_value', False):
                item.estimator_flags.append("HIGH_VALUE")
            if getattr(item, 'is_fragile', False):
                item.estimator_flags.append("FRAGILE")
            if item_weight in ("heavy", "extra_heavy"):
                item.estimator_flags.append("HEAVY")

        return items

    @staticmethod
    def generate_field_notes(items: List[Any]) -> List[str]:
        """Generate field notes for items needing special handling.

        Only creates notes for genuinely special situations — not for every
        item with a fragile/HV flag (those are already shown in inventory).
        """
        # Keywords that indicate truly fragile material (glass/ceramic/screen)
        BREAKABLE_KEYWORDS = {
            "mirror", "chandelier", "crystal", "porcelain", "china",
            "aquarium", "stained glass", "marble", "sculpture",
        }
        # Keywords that trigger "keep upright" — only actual screens
        UPRIGHT_KEYWORDS = {"tv", "television", "flat screen"}

        notes: List[str] = []
        for item in items:
            name = getattr(item, 'name', '') or 'Unknown'
            cat = getattr(item, 'category', '')
            name_lower = name.lower()
            flags: list = []

            # 1. Disassembly — actionable for crew
            if getattr(item, 'needs_disassembly', False):
                flags.append("Disassembly required")

            # 2. High value — document condition (skip standard appliances)
            if getattr(item, 'is_high_value', False) and cat != "Appliances":
                flags.append("Document condition before packing")

            # 3. Heavy — 2-person lift (based on actual weight attribute)
            item_weight = getattr(item, 'weight', '') or ''
            if item_weight in ("heavy", "extra_heavy"):
                flags.append("2-person lift")

            # 4. Specific handling (actionable instructions, not generic warnings)
            if any(k in name_lower for k in UPRIGHT_KEYWORDS):
                flags.append("Keep upright during transport")
            elif any(k in name_lower for k in BREAKABLE_KEYWORDS):
                flags.append("Custom padding / crating recommended")

            if any(k in name_lower for k in ("plant", "potted")):
                flags.append("Needs ventilation — do not seal")

            if flags:
                notes.append(f"{name}: {'. '.join(flags)}")

        return notes[:8]

    def compute_room_labor_and_notes(
        self,
        items: List[Any],
        crew_size: int = 4,
        include_field_notes: bool = True,
    ) -> Dict[str, Any]:
        """Enrich a room's items and derive labor hours, a labor summary, and field notes.

        Shared by the real `/export/report` endpoint and the public packing demo
        so both compute per-room labor/notes the same way instead of duplicating
        this logic. Accepts dicts or objects; returns plain data only.
        """
        if not items:
            return {"labor_hours": 0.0, "labor_notes": "", "field_notes": []}

        class _Obj:
            pass

        item_objs = []
        for it in items:
            obj = _Obj()
            if isinstance(it, dict):
                for k, v in it.items():
                    setattr(obj, k, v)
            else:
                obj = it
            item_objs.append(obj)

        self.enrich_items_for_estimate(item_objs)

        total_labor = 0.0
        fragile_count = 0
        high_value_count = 0
        heavy_count = 0
        disassembly_count = 0
        for obj in item_objs:
            labor = getattr(obj, 'estimated_labor_hours', None) or 0
            total_labor += labor
            qty = getattr(obj, 'quantity', 1) or 1
            if getattr(obj, 'is_fragile', False):
                fragile_count += qty
            if getattr(obj, 'is_high_value', False):
                high_value_count += qty
            if getattr(obj, 'weight', '') in ('heavy', 'extra_heavy'):
                heavy_count += qty
            if getattr(obj, 'needs_disassembly', False):
                disassembly_count += qty

        elapsed = round(total_labor / max(1, crew_size), 1)

        total_items = sum(getattr(o, 'quantity', 1) or 1 for o in item_objs)
        parts = [f"{total_items} items"]
        if fragile_count:
            parts.append(f"{fragile_count} fragile")
        if high_value_count:
            parts.append(f"{high_value_count} high-value")
        if heavy_count:
            parts.append(f"{heavy_count} heavy (2-person lift)")
        if disassembly_count:
            parts.append(f"{disassembly_count} require disassembly")
        labor_notes = ", ".join(parts)

        field_notes = self.generate_field_notes(item_objs) if include_field_notes else []

        return {
            "labor_hours": elapsed,
            "labor_notes": labor_notes,
            "field_notes": field_notes,
        }

    # ---- Content Relocation (carry packed items from room to truck / staging area) ----
    # Multiplier applied to base carry time by floor.
    # Higher floors add stair travel with heavy/bulky boxes and furniture.
    # CARRY-OUT: items go DOWN from upper floors (gravity-assisted but slower due to control)
    FLOOR_CARRY_MULT: Dict[str, float] = {
        "basement": 1.30,  # carry UP: one stair flight with loaded boxes/dolly
        "1st":      1.00,  # baseline — level exit or short ramp
        "2nd":      1.50,  # carry DOWN one flight
        "3rd":      1.90,  # carry DOWN two flights
        "4th+":     2.40,  # carry DOWN three+ flights — eastern US brownstones/walkups
    }

    # CARRY-IN (pack-back): items go UP to upper floors (against gravity, harder)
    # Carrying heavy furniture/boxes upstairs is ~15-20% harder than carrying down.
    FLOOR_CARRY_IN_MULT: Dict[str, float] = {
        "basement": 1.15,  # carry DOWN: one flight, gravity-assisted
        "1st":      1.00,  # baseline — level entrance
        "2nd":      1.70,  # carry UP one flight (harder than down)
        "3rd":      2.20,  # carry UP two flights
        "4th+":     2.80,  # carry UP three+ flights — significantly harder
    }

    # Base person-minutes to carry ONE AI-reported item-unit from its room to truck/staging.
    # Covers: pick up → navigate hallway → stairs (if any) → place at loading position.
    #
    # IMPORTANT: AI reports item COUNTS, not box counts.
    # e.g. "Books qty=30" = 30 individual books → packed into ~2 boxes → ~3 person-min total.
    # Values are calibrated accordingly: boxes_per_item × 1.5 min/box.
    #
    # Large discrete items (Furniture, Appliances, Artwork) are 1 item ≈ 1 carry trip —
    # values for those are kept higher to reflect dolly setup, 2-person lift, or careful carry.
    # Base person-minutes to carry ONE AI-reported item-unit from room to truck/staging.
    # Includes: pick up from staging position → navigate hallway/doors → stairs if any →
    #           walk to truck → position/place → return walk for next item.
    # Round trip walk + handling is the major factor. Average residential hallway
    # run is 30-60 ft; with 2-person carry, doorway navigation, and careful placement
    # the real per-trip time is significantly higher than pure "pick up and walk" time.
    BASE_CARRY_MINS: Dict[str, float] = {
        "Furniture":    4.0,   # dolly + 2-person lift, doorway maneuver
        "Appliances":   5.0,   # dolly, 2-person, appliance cart
        "Electronics":  1.5,   # fragile but lighter; careful carry
        "Books":        0.12,  # ~15 books/box × 1.8 min/box → 0.12 min/book
        "Fragile":      0.30,  # ~8 items/dish-pack × 2.5 min/box → 0.30 min/item
        "Artwork":      2.5,   # mirror/frame; flat carry, doorway tilt
        "Kitchenware":  0.20,  # ~8 items/box × 1.5 min/box → 0.20 min/item
        "Clothing":     0.10,  # ~15 items/wardrobe-box × 1.5 min/box → 0.10 min/item
        "Collectibles": 0.30,  # ~6 items/box, careful handling × 1.8 min/box
        "Tools":        0.20,  # ~10 items/toolbox × 2 min/box → 0.20 min/item
        "Sports":       1.5,   # bulky/awkward; ~1.5 min each
        "Toys":         0.15,  # ~10 items/box × 1.5 min/box → 0.15 min/item
        "Other":        0.20,  # ~8 items/box × 1.5 min/box → 0.20 min/item
    }

    # Per-job carry overhead: door propping, dolly staging, final walkthrough.
    JOB_CARRY_OVERHEAD_MINS: float = 10.0

    # Packing method → material inference when required_materials is empty
    PACKING_METHOD_MATERIALS = {
        "bubble": ["bubble_12"],
        "bubble wrap": ["bubble_12"],
        "double box": ["box_medium", "box_large"],
        "dish pack": ["box_dish", "packing_paper"],
        "dish-pack": ["box_dish", "packing_paper"],
        "wardrobe": ["box_wardrobe"],
        "mirror box": ["box_mirror"],
        "picture box": ["box_mirror"],
        "tv box": ["box_tv"],
        "blanket wrap": ["blanket", "shrink_wrap"],
        "pad wrap": ["furniture_pad", "shrink_wrap"],
        "chair cover": ["chair_cover"],
        "sofa cover": ["sofa_cover"],
        "couch cover": ["sofa_cover"],
        "furniture cover": ["chair_cover", "sofa_cover"],
        "plastic cover": ["chair_cover"],
        "shrink wrap": ["shrink_wrap"],
        "stretch wrap": ["shrink_wrap"],
        "crate": ["box_xlarge", "bubble_24"],
        "custom crate": ["box_xlarge", "bubble_24", "corner_protector"],
    }

    def _infer_materials_from_packing_method(self, packing_method: str) -> List[str]:
        """Infer materials from packing_method description string."""
        if not packing_method:
            return []
        method_lower = packing_method.lower()
        inferred = []
        for keyword, mats in self.PACKING_METHOD_MATERIALS.items():
            if keyword in method_lower:
                inferred.extend(mats)
        # Deduplicate while preserving order
        return list(dict.fromkeys(inferred))

    # How many items fit per box/material unit (packing ratio)
    ITEMS_PER_BOX = {
        "box_small": 12, "box_medium": 12, "box_large": 6,
        "box_xlarge": 4, "box_book": 20, "box_dish": 12,
        "box_wardrobe": 24,       # standard wardrobe box holds 24 hanging garments
        "box_wardrobe_small": 18,
        "box_wardrobe_large": 30,
        # Specialty boxes: 1 item per box
        "box_tv": 1, "box_mirror": 1, "box_lamp": 1,
        # Bubble wrap rolls: NOT 1:1 per item — 1 roll covers multiple items.
        # 12" × 60ft roll: covers ~20 medium fragile items
        # 24" × 30ft roll: covers ~8 large fragile items
        "bubble_12": 20,
        "bubble_24": 8,
        # Corner protectors: sold in box of 100; ~16 furniture items use 1 box
        "corner_protector": 16,
        # Stretch wrap roll (20" × 1500ft): 1 roll wraps ~8 furniture pieces.
        # AI encodes as "1 per item" but the Xactimate code 2936 is per ROLL.
        "shrink_wrap": 8,
        # Furniture pad (72" × 80"): large heavy-duty pad shared across ~2 items.
        # 1:1 would over-count when qty > 1 per item entry.
        "furniture_pad": 2,
    }
    # Wrapping materials: 1 unit per item.quantity (covers, mattress bags, blankets).
    # shrink_wrap and furniture_pad excluded — they use ITEMS_PER_BOX ratio to avoid
    # over-counting when item.quantity > 1 (e.g. 8 chairs → 1 roll, not 8 rolls).
    WRAP_MATERIALS = {
        "blanket",
        "mattress_twin", "mattress_full", "mattress_queen", "mattress_king",
        "chair_cover", "sofa_cover",
    }

    # Keywords indicating large furniture that needs extra wrapping materials
    _LARGE_FURNITURE_KEYWORDS = {
        "sectional", "l-shaped", "l shaped", "chaise", "sofa bed", "sleeper sofa",
        "king", "armoire", "wardrobe", "large wardrobe", "3-door", "4-door",
        "large bookcase", "tall bookcase", "6-shelf", "7-shelf", "8-shelf",
        "entertainment center", "china cabinet", "hutch",
    }
    # Minimum blankets to assign for large furniture when AI under-specifies
    _LARGE_FURNITURE_MIN_BLANKETS = 2

    def _supplement_furniture_materials(
        self, item: Any, mat_counts: Dict[str, int]
    ) -> None:
        """Ensure large furniture gets adequate wrapping materials.

        When the AI returns required_materials, duplicates already encode
        quantity. This method adds a safety-net floor for large furniture
        that may have been under-specified — it will NOT reduce existing counts.
        """
        if item.category != "Furniture":
            return
        name_lower = (item.name or "").lower()
        is_large = any(kw in name_lower for kw in self._LARGE_FURNITURE_KEYWORDS)
        if not is_large:
            return
        # Ensure at least 2 blankets for large furniture
        current_blankets = mat_counts.get("blanket", 0)
        needed = self._LARGE_FURNITURE_MIN_BLANKETS * item.quantity
        if current_blankets < needed:
            mat_counts["blanket"] = needed

    def _calculate_relocation_hours(
        self, rooms: List[Any]
    ) -> Tuple[float, str]:
        """Person-hours to physically carry packed items from rooms to truck / staging area.

        Content-driven: carry time is based on item count/category × floor multiplier.
        Overhead is per-job (not per-room) to prevent room count from inflating costs
        when the same content is spread across more rooms.
        Returns (total_person_hours_rounded_to_0.5, floor_detail_note).
        """
        FLOOR_LABEL = {"basement": "Basement", "1st": "1st fl", "2nd": "2nd fl", "3rd": "3rd fl"}
        total_mins = self.JOB_CARRY_OVERHEAD_MINS  # one-time job overhead
        floor_stats: Dict[str, Dict[str, Any]] = {}  # floor → {rooms, raw_mins}

        for room in rooms:
            floor = (getattr(room, "floor", None) or "1st").lower()
            # Normalise "2nd floor" → "2nd" etc.
            for key in self.FLOOR_CARRY_MULT:
                if floor.startswith(key.rstrip("st").rstrip("nd").rstrip("rd")):
                    floor = key
                    break
            mult = self.FLOOR_CARRY_MULT.get(floor, 1.0)

            if floor not in floor_stats:
                floor_stats[floor] = {"rooms": 0, "raw_mins": 0.0}
            floor_stats[floor]["rooms"] += 1

            # Weight multipliers for carry time:
            # heavier items take longer to move safely
            WEIGHT_CARRY_MULT = {
                "light": 0.6, "medium": 1.0,
                "heavy": 1.5, "extra_heavy": 2.0,
            }

            room_mins = 0.0
            room_raw_mins = 0.0
            for item in room.items:
                qty = item.quantity or 1
                base = self.BASE_CARRY_MINS.get(item.category, 2.0)
                w_mult = WEIGHT_CARRY_MULT.get(
                    getattr(item, 'weight', None) or 'medium', 1.0
                )
                room_mins += base * qty * mult * w_mult
                room_raw_mins += base * qty * w_mult
            floor_stats[floor]["raw_mins"] += room_raw_mins

            total_mins += room_mins

        person_hours = round(total_mins / 60.0 * 2) / 2  # round to 0.5
        person_hours = max(1.0, person_hours)

        # Build readable floor breakdown note
        # Shows base carry time (without floor multiplier) so adjusters can see
        # raw volume per floor independent of stair difficulty.
        order = ["basement", "1st", "2nd", "3rd", "4th+"]
        parts = []
        for fl in order:
            if fl in floor_stats:
                s = floor_stats[fl]
                mult = self.FLOOR_CARRY_MULT.get(fl, 1.0)
                base_hrs = s["raw_mins"] / 60.0
                # Format as e.g. "0.5 hr" or "2.0 hrs"
                hrs_str = f"{base_hrs:.1f} hr" if base_hrs < 2 else f"{base_hrs:.1f} hrs"
                parts.append(
                    f"{FLOOR_LABEL.get(fl, fl)}: {s['rooms']} room(s), "
                    f"~{hrs_str} base carry (×{mult:.2f})"
                )
        note = "  ·  ".join(parts)
        return person_hours, note

    def _calculate_carry_in_hours(
        self, rooms: List[Any]
    ) -> Tuple[float, str]:
        """Person-hours to carry items FROM truck back INTO rooms (pack-back).

        Uses FLOOR_CARRY_IN_MULT: carrying items UP stairs is harder than carrying down.
        Same item-based calculation as carry-out but with carry-in multipliers.
        Returns (total_person_hours_rounded_to_0.5, floor_detail_note).
        """
        FLOOR_LABEL = {"basement": "Basement", "1st": "1st fl", "2nd": "2nd fl", "3rd": "3rd fl"}
        total_mins = self.JOB_CARRY_OVERHEAD_MINS  # one-time job overhead
        floor_stats: Dict[str, Dict[str, Any]] = {}

        for room in rooms:
            floor = (getattr(room, "floor", None) or "1st").lower()
            for key in self.FLOOR_CARRY_IN_MULT:
                if floor.startswith(key.rstrip("st").rstrip("nd").rstrip("rd")):
                    floor = key
                    break
            mult = self.FLOOR_CARRY_IN_MULT.get(floor, 1.0)

            if floor not in floor_stats:
                floor_stats[floor] = {"rooms": 0, "raw_mins": 0.0}
            floor_stats[floor]["rooms"] += 1

            WEIGHT_CARRY_MULT = {
                "light": 0.6, "medium": 1.0,
                "heavy": 1.5, "extra_heavy": 2.0,
            }

            room_mins = 0.0
            room_raw_mins = 0.0
            for item in room.items:
                qty = item.quantity or 1
                base = self.BASE_CARRY_MINS.get(item.category, 2.0)
                w_mult = WEIGHT_CARRY_MULT.get(
                    getattr(item, 'weight', None) or 'medium', 1.0
                )
                room_mins += base * qty * mult * w_mult
                room_raw_mins += base * qty * w_mult
            floor_stats[floor]["raw_mins"] += room_raw_mins
            total_mins += room_mins

        person_hours = round(total_mins / 60.0 * 2) / 2  # round to 0.5
        person_hours = max(1.0, person_hours)

        order = ["basement", "1st", "2nd", "3rd", "4th+"]
        parts = []
        for fl in order:
            if fl in floor_stats:
                s = floor_stats[fl]
                mult = self.FLOOR_CARRY_IN_MULT.get(fl, 1.0)
                base_hrs = s["raw_mins"] / 60.0
                hrs_str = f"{base_hrs:.1f} hr" if base_hrs < 2 else f"{base_hrs:.1f} hrs"
                parts.append(
                    f"{FLOOR_LABEL.get(fl, fl)}: {s['rooms']} room(s), "
                    f"~{hrs_str} base carry (×{mult:.2f})"
                )
        note = "  ·  ".join(parts)
        return person_hours, note

    def aggregate_item_materials(self, rooms: List[Any]) -> Dict[str, int]:
        """Aggregate required_materials from all items across all rooms.

        Boxes use a packing ratio (multiple items per box).
        Wrapping materials scale 1:1 — the AI encodes quantity via duplicate
        keys in the required_materials list (e.g. two "moving_blanket" entries
        = 2 blankets for that item).
        Packing paper is accumulated as a raw item count across ALL items,
        then converted to 50-lb bundles once at the end.
        """
        materials: Dict[str, int] = {}
        packing_paper_raw = 0  # accumulate raw item count across all items

        # Keywords that identify actual TVs/large monitors (32"+) vs other electronics
        _TV_KEYWORDS = {"tv", "television", "flat screen", "flatscreen", "oled", "qled"}

        for room in rooms:
            for item in room.items:
                item_mats = []
                if item.required_materials:
                    item_mats = list(item.required_materials)
                elif hasattr(item, 'packing_method') and item.packing_method:
                    item_mats = self._infer_materials_from_packing_method(item.packing_method)

                # Guard: tv_box only for actual TVs/large monitors.
                # Downgrade to medium_box for other electronics (consoles, routers, etc.)
                if item.category == "Electronics" and item_mats:
                    name_lower = (item.name or "").lower()
                    is_actual_tv = any(kw in name_lower for kw in _TV_KEYWORDS) or "monitor" in name_lower
                    if not is_actual_tv:
                        item_mats = [("medium_box" if m in ("tv_box", "box_tv") else m) for m in item_mats]

                # Track per-item material counts before merging into global dict
                # so _supplement_furniture_materials can reason about this item's share.
                item_mat_counts: Dict[str, int] = {}

                # When AI lists multiple box types for one item (e.g. wardrobe_box + medium_box
                # for clothing), each type should receive a proportional share of the item qty
                # rather than the full qty — otherwise box counts inflate ~Nx.
                item_box_types: set = set()
                for mk in item_mats:
                    n = self._normalize_material_key(mk)
                    if n and n in self.ITEMS_PER_BOX and n.startswith("box_") and n not in ("box_tv", "box_mirror", "box_lamp"):
                        item_box_types.add(n)
                qty_per_box_type = (item.quantity / len(item_box_types)) if len(item_box_types) > 1 else item.quantity

                for mat_key in item_mats:
                    norm = self._normalize_material_key(mat_key)
                    if not norm:
                        continue
                    if norm == "packing_paper":
                        # Accumulate raw item count; convert to bundles after loop.
                        packing_paper_raw += item.quantity
                    elif norm in self.WRAP_MATERIALS:
                        # Wrap materials: each occurrence = 1 unit per item.
                        # AI uses duplicate keys to represent quantity
                        # (e.g., 2× "moving_blanket" = 2 blankets per unit).
                        # Multiply occurrence count by item.quantity (number of units).
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + item.quantity
                    elif norm in self.ITEMS_PER_BOX:
                        # Boxes: ceil(effective_qty / items_per_box) per occurrence.
                        # For regular box types, use split qty when multiple box types are
                        # listed for the same item (avoids Nx inflation).
                        # Specialty single-item boxes (tv/mirror/lamp) always use full qty.
                        per_box = self.ITEMS_PER_BOX[norm]
                        is_specialty = norm in ("box_tv", "box_mirror", "box_lamp")
                        eff_qty = item.quantity if is_specialty else qty_per_box_type
                        boxes = math.ceil(eff_qty / per_box)
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + max(1, boxes)
                    else:
                        # Unknown material: 1 per occurrence
                        item_mat_counts[norm] = item_mat_counts.get(norm, 0) + 1

                # Safety floor for large furniture
                self._supplement_furniture_materials(item, item_mat_counts)

                # Merge item-level counts into global totals
                for norm, cnt in item_mat_counts.items():
                    materials[norm] = materials.get(norm, 0) + cnt

        # Ensure base box materials per room.
        # AI assigns wrapping materials (blankets, covers) to specific items but
        # often omits boxes for miscellaneous contents (drawer items, shelf items,
        # toiletries, decor).  Add per-room base boxes so every room contributes
        # a realistic minimum of general-purpose packing boxes.
        for room in rooms:
            room_size = self._get_room_size(room)
            base_mats = BASE_ROOM_MATERIALS.get(room_size, BASE_ROOM_MATERIALS["large"])
            density_mult = DENSITY_MULTIPLIERS.get(
                getattr(room, 'density', 'normal'), 1.0
            )
            for mat_key, base_qty in base_mats.items():
                materials[mat_key] = materials.get(mat_key, 0) + max(1, round(base_qty * density_mult))

        # Count total boxes for paper and tape calculation
        box_keys = {k for k in materials if k.startswith("box_")}
        total_boxes = sum(materials.get(k, 0) for k in box_keys)
        num_rooms = len(rooms)

        # Packing paper: max of (item-based, box-based, room-based)
        paper_from_items = packing_paper_raw / 150.0
        paper_from_boxes = total_boxes / 15.0
        paper_from_rooms = num_rooms / 3.0
        materials["packing_paper"] = max(1, math.ceil(
            max(paper_from_items, paper_from_boxes, paper_from_rooms)
        ))

        # Packing tape: 1 roll per ~10 boxes
        materials["packing_tape"] = max(
            1, math.ceil(total_boxes / 10.0)
        )

        return materials

    def build_material_detail_strings(
        self, rooms: List[Any], materials: Dict[str, int]
    ) -> Dict[str, str]:
        """Build a human-readable basis description for each material key.

        Explains *why* a quantity was generated without showing raw formulas
        or mentioning specific item names — only broad categories (Furniture,
        Electronics, Clothing, etc.) and room count.

        Returns {mat_key: description_string}.
        """
        _BOX_KEYS = {
            "box_small", "box_medium", "box_large", "box_xlarge",
            "box_book", "box_dish", "box_wardrobe", "box_wardrobe_small",
            "box_wardrobe_large", "box_tv", "box_mirror", "box_lamp",
        }
        _MATTRESS_LABELS = {
            "mattress_twin": "Twin", "mattress_full": "Full",
            "mattress_queen": "Queen", "mattress_king": "King",
        }
        _ACTION = {
            "blanket":          "Furniture padding",
            "furniture_pad":    "Large furniture padding",
            "shrink_wrap":      "Furniture securing",
            "chair_cover":      "Seating protection",
            "sofa_cover":       "Sofa protection",
            "bubble_12":        "Fragile item cushioning",
            "bubble_24":        "Oversized fragile item cushioning",
            "corner_protector": "Edge and corner protection",
            "packing_paper":    "Cushioning and void fill",
        }

        def _join(cats: list) -> str:
            cats = sorted(cats)
            if not cats:
                return ""
            if len(cats) == 1:
                return cats[0]
            return ", ".join(cats[:-1]) + ", and " + cats[-1]

        # Collect contributing categories per material key
        mat_cats: Dict[str, set] = {k: set() for k in materials}

        for room in rooms:
            for item in room.items:
                item_mats = []
                if item.required_materials:
                    item_mats = item.required_materials
                elif hasattr(item, "packing_method") and item.packing_method:
                    item_mats = self._infer_materials_from_packing_method(
                        item.packing_method
                    )
                seen = set()
                for mk in item_mats:
                    norm = self._normalize_material_key(mk)
                    if not norm or norm not in materials or norm in seen:
                        continue
                    seen.add(norm)
                    cat = getattr(item, "category", None) or "General"
                    mat_cats[norm].add(cat)

        results: Dict[str, str] = {}
        for mat_key in materials:
            cats = sorted(mat_cats.get(mat_key, set()))[:3]

            if mat_key in _MATTRESS_LABELS:
                size = _MATTRESS_LABELS[mat_key]
                results[mat_key] = f"{size} mattress protection"

            elif mat_key in _BOX_KEYS:
                results[mat_key] = _join(cats) if cats else ""

            elif mat_key in _ACTION:
                action = _ACTION[mat_key]
                if cats:
                    results[mat_key] = f"{action} — {_join(cats)}"
                else:
                    results[mat_key] = action

            else:
                results[mat_key] = ""

        return results

    @staticmethod
    def _normalize_material_key(key: str) -> str | None:
        """Map AI-returned material names to our internal keys."""
        ALIASES = {
            "moving_blanket": "blanket", "furniture_pad": "furniture_pad",
            "stretch_wrap": "shrink_wrap", "wardrobe_box": "box_wardrobe",
            "small_box": "box_small", "medium_box": "box_medium",
            "large_box": "box_large", "dish_pack_box": "box_dish",
            "book_box": "box_book", "tv_box": "box_tv", "mirror_box": "box_mirror",
            "lamp_box": "box_lamp", "bubble_wrap_12": "bubble_12",
            "bubble_wrap_24": "bubble_24", "packing_paper": "packing_paper",
            "corner_protector": "corner_protector", "mattress_bag": "mattress_queen",
            # New item aliases
            "chair_cover": "chair_cover", "plastic_chair_cover": "chair_cover",
            "sofa_cover": "sofa_cover", "couch_cover": "sofa_cover",
            "plastic_sofa_cover": "sofa_cover", "plastic_couch_cover": "sofa_cover",
            "wardrobe_box_small": "box_wardrobe_small",
            "small_wardrobe_box": "box_wardrobe_small",
            "wardrobe_box_large": "box_wardrobe_large",
            "large_wardrobe_box": "box_wardrobe_large",
            "box_wardrobe_small": "box_wardrobe_small",
            "box_wardrobe_large": "box_wardrobe_large",
            # Direct matches
            "blanket": "blanket", "shrink_wrap": "shrink_wrap",
            "box_small": "box_small", "box_medium": "box_medium",
            "box_large": "box_large", "box_xlarge": "box_xlarge",
            "box_dish": "box_dish", "box_wardrobe": "box_wardrobe",
            "box_mirror": "box_mirror", "box_tv": "box_tv", "box_lamp": "box_lamp",
            "box_book": "box_book", "bubble_12": "bubble_12", "bubble_24": "bubble_24",
            "furniture_pad": "furniture_pad",
        }
        return ALIASES.get(key)

    def classify_labor_hours(
        self, rooms: List[Any]
    ) -> Dict[str, float]:
        """Estimate labor hours based on AI item-level data with room-based floor.

        Primary: sum of AI-computed estimated_labor_hours across all items.
        Floor: room-based minimum ensures a baseline even when AI under-estimates.
        This prevents room count from dominating — same content across 1 or 5 rooms
        produces similar totals because item labor is content-driven, not room-driven.
        """
        standard_mins = 0.0
        fragile_mins = 0.0
        specialty_mins = 0.0
        furniture_disassembly_mins = 0.0
        appliance_mins = 0.0

        for room in rooms:
            density_mult = DENSITY_MULTIPLIERS.get(
                getattr(room, 'density', 'normal'), 1.0
            )
            floor_mult = FLOOR_MULTIPLIERS.get(room.floor, 1.0)
            contamination_mult = CONTAMINATION_MULTIPLIERS.get(
                getattr(room, 'contamination', 'clean'), 1.0
            )

            items = getattr(room, 'items', [])

            # Primary: aggregate AI item-level labor (already accounts for
            # quantity via packing complexity — content-driven).
            item_labor_ph = 0.0
            item_fragile_ph = 0.0
            item_specialty_ph = 0.0
            item_furniture_ph = 0.0
            item_appliance_ph = 0.0

            # AI returns wrapping/boxing time. base_labor_hours already includes
            # setup/teardown overhead per item. Carry time is calculated
            # separately in _calculate_relocation_hours, so no overhead needed here.
            LABOR_OVERHEAD_MULT = 1.0

            for item in items:
                labor_h = getattr(item, 'estimated_labor_hours', None)
                if labor_h is None:
                    base_h = getattr(item, 'base_labor_hours', None)
                    per_h = getattr(item, 'per_unit_labor_hours', None)
                    qty = getattr(item, 'quantity', 1) or 1
                    if base_h is not None and per_h is not None:
                        labor_h = base_h + per_h * qty
                if labor_h is None or labor_h <= 0:
                    continue
                labor_h *= LABOR_OVERHEAD_MULT

                cat = getattr(item, 'category', 'Other')
                needs_disassembly = getattr(item, 'needs_disassembly', False)

                if cat in self.FRAGILE_CATEGORIES or getattr(item, 'is_fragile', False):
                    item_fragile_ph += labor_h
                elif cat in self.SPECIALTY_CATEGORIES:
                    item_specialty_ph += labor_h
                elif cat == "Appliances":
                    item_appliance_ph += labor_h
                elif cat == "Furniture" and needs_disassembly:
                    item_furniture_ph += labor_h
                else:
                    item_labor_ph += labor_h

            item_total_ph = (item_labor_ph + item_fragile_ph + item_specialty_ph
                             + item_furniture_ph + item_appliance_ph)

            # Density affects movement/access overhead, NOT core packing time.
            # Wrapping a sofa takes the same time regardless of room clutter,
            # but navigating a cluttered room adds ~10-30% access overhead.
            # Apply density as partial modifier: only the EXCESS over normal
            # contributes (e.g., heavy=1.6 → excess=0.6, 40% of excess applied).
            if density_mult > 1.0:
                density_overhead = 1.0 + (density_mult - 1.0) * 0.4
            else:
                density_overhead = density_mult  # light density = faster access
            item_total_ph *= density_overhead
            if item_total_ph > 0:
                item_labor_ph *= density_overhead
                item_fragile_ph *= density_overhead
                item_specialty_ph *= density_overhead
                item_furniture_ph *= density_overhead
                item_appliance_ph *= density_overhead

            # Content-type classification — used for tier distribution only.
            # NOTE: content_modifier surcharge REMOVED. Per-item labor already
            # accounts for category difficulty (fragile items have higher per_unit,
            # furniture has disassembly time, etc.). Applying room-level modifiers
            # on top of per-item labor double-counts the difficulty and inflates
            # estimates by 25-40%.
            content_flags = self._classify_room_content(items)

            # Safety-net minimum: only kicks in when AI returns zero or
            # near-zero labor (e.g. no items detected, all items lack labor data).
            # Intentionally small — should NOT dominate when AI has real data.
            room_size = self._get_room_size(room)
            ROOM_MIN_PH = {"small": 0.5, "large": 1.5, "xlarge": 2.5}
            min_ph = ROOM_MIN_PH.get(room_size, 1.5) * density_mult

            room_ph = max(item_total_ph, min_ph)

            # Apply floor and contamination multipliers (stairs slow you down,
            # contamination requires extra PPE/procedures)
            room_ph *= floor_mult * contamination_mult

            # Distribute into tiers proportionally based on item-level breakdown
            if item_total_ph > 0:
                ratio = room_ph / item_total_ph
                standard_mins += item_labor_ph * ratio * 60
                fragile_mins += item_fragile_ph * ratio * 60
                specialty_mins += item_specialty_ph * ratio * 60
                furniture_disassembly_mins += item_furniture_ph * ratio * 60
                appliance_mins += item_appliance_ph * ratio * 60
            else:
                # No item data — split based on content flags
                if content_flags.get("fragile_heavy"):
                    fragile_mins += room_ph * 0.30 * 60
                    standard_mins += room_ph * 0.70 * 60
                elif content_flags.get("furniture_heavy"):
                    furniture_disassembly_mins += room_ph * 0.25 * 60
                    standard_mins += room_ph * 0.75 * 60
                elif content_flags.get("appliance_heavy"):
                    appliance_mins += room_ph * 0.30 * 60
                    standard_mins += room_ph * 0.70 * 60
                else:
                    standard_mins += room_ph * 60

            # High-value items → small specialty surcharge
            hv_count = sum(1 for i in items if getattr(i, 'is_high_value', False))
            if hv_count > 0:
                specialty_mins += min(hv_count * 10, room_ph * 60 * 0.20)

        return {
            "standard": round(standard_mins / 60, 1),
            "fragile": round(fragile_mins / 60, 1),
            "specialty": round(specialty_mins / 60, 1),
            "furniture_disassembly": round(
                furniture_disassembly_mins / 60, 1
            ),
            "appliance": round(appliance_mins / 60, 1),
        }

    @staticmethod
    def recommend_crew_size(
        num_rooms: int,
        total_hours: float,
        heavy_item_count: int = 0,
    ) -> int:
        """Recommend crew size based on room count, labor hours, and heavy items.

        Heavy/extra_heavy items require 2+ person lifts, so jobs with many
        heavy items need a larger minimum crew even if room count is small.
        """
        base_crew = 2
        if num_rooms <= 2 and total_hours < 5:
            base_crew = 2
        elif num_rooms <= 4 and total_hours < 12:
            base_crew = 3
        elif num_rooms <= 7 and total_hours < 20:
            base_crew = 4
        elif num_rooms <= 10:
            base_crew = 5
        else:
            base_crew = 6

        # Heavy items need minimum 3 crew (2 lifters + 1 spotter/guide)
        if heavy_item_count >= 5:
            base_crew = max(base_crew, 4)
        elif heavy_item_count >= 2:
            base_crew = max(base_crew, 3)

        return base_crew

    def calculate_estimate_from_content(self, request: RoomsEstimateRequest) -> EstimateResponse:
        """Calculate estimate using per-item content data.

        Packing method, materials, and labor are assigned here (rule-based),
        NOT during AI photo analysis. This ensures user edits to the item list
        are always reflected in the estimate.
        """
        # Enrich all items with packing details (method, materials, labor)
        for room in request.rooms:
            if not getattr(room, 'use_preset', False) and hasattr(room, 'items'):
                self.enrich_items_for_estimate(room.items)

        # Separate AI rooms from preset-based rooms
        ai_rooms = [r for r in request.rooms if not getattr(r, 'use_preset', False)]
        preset_rooms = [r for r in request.rooms if getattr(r, 'use_preset', False)]

        # Convert preset rooms to RoomInput for preset-based calculation
        preset_room_inputs: list[RoomInput] = []
        preset_room_base_total = 0.0
        preset_total_items = 0
        for room in preset_rooms:
            preset_key = room.preset or room.preset_id or "living_standard"
            # Ensure preset_id is set for _get_room_size lookup
            room.preset_id = preset_key
            room_input = RoomInput(
                preset=preset_key,
                floor=room.floor,
                density=room.density,
                hints=room.hints or [],
                contamination=room.contamination,
                hint_volume=room.hint_volume or {},
                hint_qty=room.hint_qty or {},
                special_items=room.special_items or [],
                custom_special_items=room.custom_special_items or [],
            )
            preset_room_inputs.append(room_input)
            room_price, items = self.calculate_room_base(room_input)
            preset_room_base_total += room_price
            preset_total_items += items

        total_items = sum(item.quantity for room in ai_rooms for item in room.items) + preset_total_items

        # --- Materials: aggregate from per-item required_materials (AI rooms) ---
        materials = self.aggregate_item_materials(ai_rooms)

        # Fallback: if only packing_paper was produced (no actual item materials),
        # use hint-based calculation which considers room presets and content types.
        has_real_materials = any(
            k != "packing_paper" for k in materials
        )
        if not has_real_materials and ai_rooms:
            hint_rooms = []
            for room in ai_rooms:
                preset_key = room.preset_id or "living_standard"
                hints = self._derive_hints(room.items)
                hint_rooms.append(RoomInput(
                    preset=preset_key,
                    floor=room.floor,
                    density=room.density,
                    hints=hints,
                ))
            materials = self.calculate_materials(hint_rooms)

        # Add materials from preset-based rooms
        if preset_room_inputs:
            preset_materials = self.calculate_materials(preset_room_inputs)
            for mat_key, qty in preset_materials.items():
                materials[mat_key] = materials.get(mat_key, 0) + qty

        # material_cost computed after pack-out labor (hybrid % approach)

        # --- Labor tiers ---
        # classify_labor_hours returns PERSON-HOURS (single-worker equivalent).
        # Divide by crew_size to get ELAPSED hours (crew works in parallel).
        person_hours = self.classify_labor_hours(request.rooms)
        crew = request.crew_size
        labor_hours = {k: round(v / crew, 1) for k, v in person_hours.items()}
        total_labor_hours = sum(labor_hours.values())

        labor_rate = self.get_price("2825") or 57.31      # Standard (per person/hr)
        fragile_rate = self.get_price("2911") or 87.14     # Fragile / Supervisor
        specialty_rate = self.get_price("2912") or 124.02  # Specialty (fallback)

        # Regional labor premium (Northeast +30%, West +20%, etc.)
        region_str = request.region.value if hasattr(request.region, 'value') else str(getattr(request, 'region', 'midwest'))
        region_mult = REGION_MULTIPLIERS.get(region_str, 1.0)
        labor_rate_adj = labor_rate * region_mult
        fragile_rate_adj = fragile_rate * region_mult
        specialty_rate_adj = specialty_rate * region_mult

        # Cost multiplier: elapsed hours × crew members × rate = person-hours × rate
        crew_cost = crew  # each elapsed hour costs crew × rate

        # Special items (fixed cost — not affected by region/contamination/density)
        # Merge request-level + per-room special items
        all_special = set(getattr(request, 'special_items', []))
        all_custom_special = list(getattr(request, 'custom_special_items', []))
        for room_input in request.rooms:
            all_special.update(getattr(room_input, 'special_items', []))
            all_custom_special.extend(getattr(room_input, 'custom_special_items', []))

        special_item_cost = 0.0
        special_item_lines = []
        for item_key in all_special:
            spec = SPECIAL_ITEM_COSTS.get(item_key)
            if spec:
                special_item_cost += spec["price"]
                special_item_lines.append(spec)
        for custom in all_custom_special:
            special_item_cost += custom.price
            special_item_lines.append({"name": custom.name, "unit": "EA", "price": custom.price})

        # Pack-out / pack-back split
        # Pack-out is more labor-intensive: inventory, assessment, wrapping, packing, documenting
        # Pack-back is simpler: unload, place, unpack (no inventory/wrapping needed)
        packout_fraction = 0.62 if request.include_packback else 0.85
        packback_fraction = 0.38 if request.include_packback else 0.0

        po_standard = labor_hours["standard"] * packout_fraction
        po_fragile = labor_hours["fragile"] * packout_fraction
        po_specialty = labor_hours["specialty"] * packout_fraction
        po_furniture = labor_hours["furniture_disassembly"] * packout_fraction
        po_appliance = labor_hours["appliance"] * packout_fraction

        def rh(x):
            """Round to nearest 0.5."""
            return round(x * 2) / 2

        # Inventory & documentation: 1 person does this, not full crew
        inventory_hours = rh(total_labor_hours * 0.05) if total_labor_hours > 2 else 0.5
        # Supervisor: 1 person, not full crew
        supervisor_hours = rh(total_labor_hours * 0.10) if total_labor_hours > 2 else 0.5

        # Pack-out elapsed hours — no artificial minimums that inflate small jobs
        po_standard_hrs = max(0.5, rh(po_standard))
        po_fragile_hrs = rh(po_fragile) if labor_hours["fragile"] > 0 else 0
        po_specialty_hrs = rh(po_specialty) if labor_hours["specialty"] > 0 else 0
        po_furniture_hrs = rh(po_furniture) if labor_hours["furniture_disassembly"] > 0 else 0
        po_appliance_hrs = rh(po_appliance) if labor_hours["appliance"] > 0 else 0

        # Cost = elapsed hours × crew × rate (for crew tasks)
        # Inventory & supervisor are single-person tasks (× 1, not × crew)
        # Region multiplier applied via adjusted rates
        pack_out_labor = (
            po_standard_hrs * crew_cost * labor_rate_adj
            + po_fragile_hrs * crew_cost * fragile_rate_adj
            + po_specialty_hrs * crew_cost * specialty_rate_adj
            + po_furniture_hrs * crew_cost * labor_rate_adj
            + po_appliance_hrs * crew_cost * labor_rate_adj
            + inventory_hours * labor_rate_adj          # 1 person
            + supervisor_hours * fragile_rate_adj       # 1 person
        )

        # Hybrid materials: total anchored to pack-out labor × rate%,
        # split into 2-3 categories based on itemised breakdown ratios.
        material_rate_pct = getattr(request, 'material_rate', 25)
        material_cost, mat_section_lines, mat_details_legacy = (
            self.build_hybrid_materials(
                pack_out_labor, material_rate_pct, materials,
            )
        )

        # Transport & Storage costs depend on staging type
        is_on_site = request.staging_type == StagingType.ON_SITE

        # Floor-weighted carry labor: physically moving packed items from rooms to truck/staging
        carry_person_hours, carry_floor_note = self._calculate_relocation_hours(request.rooms)
        # Carry-in (pack-back): items go UP to upper floors — uses different multipliers
        carry_in_person_hours, carry_in_floor_note = self._calculate_carry_in_hours(request.rooms)
        # Truck loading/securing: based on content volume (storage_sf), not room count.
        # ~1 person-hour per 100 SF of content (position items, strap, fill gaps).
        storage_sf = self.estimate_storage_sf_from_items(request.rooms)
        truck_load_person_hours = rh(max(1.0, storage_sf / 100.0))
        # Total person-hours for the full relocation operation
        loading_person_hours = carry_person_hours + truck_load_person_hours
        loading_cost = loading_person_hours * labor_rate_adj  # region-adjusted rate
        # Pack-back transport: carry-in + truck unloading (same truck load hours)
        unloading_person_hours = carry_in_person_hours + truck_load_person_hours
        unloading_cost = unloading_person_hours * labor_rate_adj

        # On-site staging: same carry labor (no truck loading overhead)
        on_site_person_hours = carry_person_hours
        on_site_moving_fee = on_site_person_hours * labor_rate_adj

        # Storage (per SF based on content volume — storage_sf computed above)
        storage_cost = 0
        if not is_on_site and request.storage_months > 0:
            setup_fee = get_storage_setup_fee(storage_sf)
            sf_rate = self.get_price("2840") or 2.18
            storage_cost = (
                storage_sf * sf_rate * request.storage_months
                + setup_fee
            )

        # Smart truck selection based on job size
        _, truck_rate = self.select_truck(storage_sf)

        # Debris hauling — count DISPOSABLE materials only.
        # Reusable materials (blankets, bubble wrap rolls, shrink wrap, corner protectors)
        # are returned to the company and should NOT inflate this charge.
        # Rate: ~75 boxes/hr (industry standard: crews can flatten and haul 60-90 boxes/hr).
        # Covers: flattening boxes, bundling paper, bagging debris, hauling to truck/dumpster.
        #
        # IMPORTANT: Use the SAME materials dict as supply section to avoid count mismatch.
        DISPOSABLE_BOX_KEYS = {"box_small", "box_medium", "box_large", "box_xlarge",
                    "box_book", "box_dish", "box_wardrobe",
                    "box_wardrobe_small", "box_wardrobe_large",
                    "box_mirror", "box_tv", "box_lamp"}
        disposable_box_qty = sum(qty for k, qty in materials.items() if k in DISPOSABLE_BOX_KEYS)
        packing_paper_qty = materials.get("packing_paper", 0)
        packing_tape_qty = materials.get("packing_tape", 0)
        # Boxes dominate volume; each packing paper bundle ≈ 3 boxes of debris volume
        debris_unit_equiv = disposable_box_qty + packing_paper_qty * 3 + packing_tape_qty
        debris_hours = max(0.5, round(debris_unit_equiv / 75 * 2) / 2)  # round to 0.5
        debris_cost = debris_hours * labor_rate_adj
        # Build description — always show exact supply box count for consistency
        _debris_desc_parts = []
        if disposable_box_qty:
            _debris_desc_parts.append(f"{disposable_box_qty} boxes")
        if packing_paper_qty:
            _debris_desc_parts.append(f"{packing_paper_qty} paper bundle(s)")
        if packing_tape_qty:
            _debris_desc_parts.append(f"{packing_tape_qty} tape roll(s)")
        _debris_desc = (
            (", ".join(_debris_desc_parts) + "  ·  ") if _debris_desc_parts else ""
        ) + "flatten, bundle & haul spent packing materials post-pack-out"

        # Build sections
        sections = {
            "Pack-Out Labor": round(pack_out_labor, 2),
            "Materials": round(material_cost, 2),
        }

        # Truck trips: 26' van holds ~500 SF worth of contents
        truck_trips = max(1, math.ceil(storage_sf / 500)) if storage_sf > 0 else 1

        if is_on_site:
            sections["On-Site Relocation"] = round(on_site_moving_fee, 2)
        else:
            sections["Transport Out"] = round((truck_rate + loading_cost) * truck_trips, 2)
            if storage_cost > 0:
                sections["Storage"] = round(storage_cost, 2)

        sections["Debris Hauling"] = round(debris_cost, 2)

        if request.include_packback:
            pb_standard = labor_hours["standard"] * packback_fraction
            pb_furniture = labor_hours["furniture_disassembly"] * packback_fraction
            pb_appliance = labor_hours["appliance"] * packback_fraction
            # Fragile/specialty unpacking: simpler than packing (no wrapping) but still careful
            # ~60% of pack-out fragile/specialty time for careful unwrapping and placement
            pb_fragile = labor_hours["fragile"] * packback_fraction * 0.6
            pb_specialty = labor_hours["specialty"] * packback_fraction * 0.6
            pb_supervisor = rh(total_labor_hours * packback_fraction * 0.10) if total_labor_hours > 2 else 0.5
            # Inventory verification: check items against pack-out inventory list
            pb_inventory = rh(inventory_hours * 0.5) if inventory_hours > 0 else 0

            # Pack-back is simpler but still needs care for fragile/specialty items
            pb_standard_hrs = max(0.5, rh(pb_standard))
            pb_fragile_hrs = rh(pb_fragile) if labor_hours["fragile"] > 0 else 0
            pb_specialty_hrs = rh(pb_specialty) if labor_hours["specialty"] > 0 else 0
            pb_appliance_hrs = rh(pb_appliance) if labor_hours["appliance"] > 0 else 0
            # Furniture assembly is separate from standard pack-back
            pb_furniture_hrs = rh(pb_furniture) if labor_hours["furniture_disassembly"] > 0 else 0

            pack_back_labor = (
                pb_standard_hrs * crew_cost * labor_rate_adj
                + pb_fragile_hrs * crew_cost * fragile_rate_adj
                + pb_specialty_hrs * crew_cost * specialty_rate_adj
                + pb_appliance_hrs * crew_cost * labor_rate_adj
                + pb_inventory * labor_rate_adj             # 1 person
                + pb_supervisor * fragile_rate_adj          # 1 person
                # Note: debris/waste removal is covered by the dedicated Debris Hauling section
            )
            # Furniture assembly as separate cost (crew task)
            furniture_assembly_cost = pb_furniture_hrs * crew_cost * labor_rate_adj

            if is_on_site:
                sections["On-Site Pack-Back Move"] = round(on_site_moving_fee, 2)
            else:
                sections["Transport Back"] = round((truck_rate + unloading_cost) * truck_trips, 2)
            sections["Pack-Back Labor"] = round(pack_back_labor, 2)
            if furniture_assembly_cost > 0:
                sections["Furniture Assembly"] = round(furniture_assembly_cost, 2)

        if special_item_cost > 0:
            sections["Special Items"] = round(special_item_cost, 2)

        subtotal = sum(sections.values())
        op_amount = subtotal * (request.op_rate / 100) if request.include_op else 0

        # Evaluate conditional supplements
        supplements = self.evaluate_supplements(
            request.rooms, subtotal,
            overrides=getattr(request, 'supplement_overrides', None),
        )
        supplements_total = sum(s.amount for s in supplements if s.enabled)

        # Legacy contingency (backwards compat, defaults off)
        contingency_amount = subtotal * (request.contingency_rate / 100) if request.include_contingency else 0
        grand_total = subtotal + op_amount + supplements_total + contingency_amount

        # total_hours = elapsed time the crew actually spends on site.
        # Supervisor & inventory work concurrently with packing crew,
        # so they do NOT add to elapsed time — only debris hauling is sequential.
        total_hours_calc = total_labor_hours + debris_hours

        # material_details uses hybrid category lines (computed above)
        material_details = mat_details_legacy

        room_summaries = self._build_room_summaries(request.rooms)

        # Build section_details: per-line breakdown for Pack-Out Labor and Transport
        section_details = {}
        # Materials section: hybrid category lines
        section_details["Materials"] = {"lines": mat_section_lines}

        # Line items show ELAPSED hours (wall-clock time on site).
        # Rate = per-person rate × crew size, so amount = elapsed × crew_rate.
        crew_labor_rate = round(labor_rate * crew, 2)
        crew_fragile_rate = round(fragile_rate * crew, 2)
        crew_specialty_rate = round(specialty_rate * crew, 2)

        po_lines = []
        if po_standard_hrs > 0:
            _amt = round(po_standard_hrs * crew_labor_rate, 2)
            po_lines.append({
                "name": "Standard Pack-Out", "qty": po_standard_hrs, "unit": "HR",
                "rate": crew_labor_rate,
                "detail": _crew_detail("wrap, box, label, stage", po_standard_hrs, crew, labor_rate, _amt),
                "amount": _amt,
            })
        if po_fragile_hrs > 0:
            _amt = round(po_fragile_hrs * crew_fragile_rate, 2)
            po_lines.append({
                "name": "Fragile / High-Care Items", "qty": po_fragile_hrs, "unit": "HR",
                "rate": crew_fragile_rate,
                "detail": _crew_detail("individual wrap, double-box, condition photo", po_fragile_hrs, crew, fragile_rate, _amt),
                "amount": _amt,
            })
        if po_specialty_hrs > 0:
            _amt = round(po_specialty_hrs * crew_specialty_rate, 2)
            po_lines.append({
                "name": "Specialty / High-Value Items", "qty": po_specialty_hrs, "unit": "HR",
                "rate": crew_specialty_rate,
                "detail": _crew_detail("serial# record, custom pack, high-value documentation", po_specialty_hrs, crew, specialty_rate, _amt),
                "amount": _amt,
            })
        if po_furniture_hrs > 0:
            _amt = round(po_furniture_hrs * crew_labor_rate, 2)
            po_lines.append({
                "name": "Furniture Disassembly", "qty": po_furniture_hrs, "unit": "HR",
                "rate": crew_labor_rate,
                "detail": _crew_detail("disassemble, blanket-wrap, shrink-wrap", po_furniture_hrs, crew, labor_rate, _amt),
                "amount": _amt,
            })
        if po_appliance_hrs > 0:
            _amt = round(po_appliance_hrs * crew_labor_rate, 2)
            po_lines.append({
                "name": "Appliance Handling", "qty": po_appliance_hrs, "unit": "HR",
                "rate": crew_labor_rate,
                "detail": _crew_detail("disconnect, secure internals, dolly", po_appliance_hrs, crew, labor_rate, _amt),
                "amount": _amt,
            })
        if inventory_hours > 0:
            _amt = round(inventory_hours * labor_rate, 2)
            po_lines.append({
                "name": "Inventory & Documentation", "qty": float(inventory_hours), "unit": "HR",
                "rate": round(labor_rate, 2),
                "detail": _solo_detail("photo log, written inventory per item", inventory_hours, labor_rate, _amt),
                "amount": _amt,
            })
        if supervisor_hours > 0:
            _amt = round(supervisor_hours * fragile_rate, 2)
            po_lines.append({
                "name": "Supervision", "qty": float(supervisor_hours), "unit": "HR",
                "rate": round(fragile_rate, 2),
                "detail": f"1 supervisor (quality control, crew coordination) · {supervisor_hours} hr × {_fmt_money(fragile_rate)}/hr = {_fmt_money(_amt)}",
                "amount": _amt,
            })
        if po_lines:
            section_details["Pack-Out Labor"] = {"lines": po_lines}

        # Carry-labor lines show ELAPSED hours (person-hours ÷ crew). Amount stays
        # pinned to the original person-hours figure (carry_person_hours * labor_rate)
        # so the elapsed-hour display rounding never shifts the dollar amount — the
        # DB-side estimate creation recomputes total = quantity * unit_price, so rate
        # is back-derived from amount/elapsed rather than assumed as crew_labor_rate.
        # The per-person rate shown inside the detail breakdown is likewise
        # back-derived (rate / crew) so "elapsed × crew × per_rate = amount" holds
        # for the numbers actually printed — this is exactly the note/qty
        # reproducibility bug being fixed elsewhere in this refactor.
        _carry_out_elapsed = round(carry_person_hours / crew, 1) if crew > 0 else carry_person_hours
        _carry_in_elapsed = round(carry_in_person_hours / crew, 1) if crew > 0 else carry_in_person_hours
        _carry_out_amt = round(carry_person_hours * labor_rate, 2)
        _carry_in_amt = round(carry_in_person_hours * labor_rate, 2)
        _carry_out_rate = round(_carry_out_amt / _carry_out_elapsed, 2) if _carry_out_elapsed > 0 else crew_labor_rate
        _carry_in_rate = round(_carry_in_amt / _carry_in_elapsed, 2) if _carry_in_elapsed > 0 else crew_labor_rate
        _carry_out_per_person = round(_carry_out_rate / crew, 2) if crew > 0 else _carry_out_rate
        _carry_in_per_person = round(_carry_in_rate / crew, 2) if crew > 0 else _carry_in_rate

        # Truck Loading & Securing / Unloading are NOT crew-multiplied today
        # (a flat SF-derived figure despite the "person_hours" name) — left as
        # plain elapsed hours at the per-person rate, unchanged by this refactor.
        def _transport_out_lines(trips, t_rate):
            return [
                {"name": "26' Moving Van", "qty": trips, "unit": "DY",
                 "rate": round(t_rate, 2),
                 "detail": f"{trips} trip{'s' if trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(t_rate * trips, 2)},
                {"name": "Content Carry-Out (floor-weighted)", "qty": _carry_out_elapsed, "unit": "HR",
                 "rate": _carry_out_rate,
                 "detail": _crew_detail(carry_floor_note, _carry_out_elapsed, crew, _carry_out_per_person, _carry_out_amt),
                 "amount": _carry_out_amt},
                {"name": "Truck Loading & Securing", "qty": truck_load_person_hours, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{truck_load_person_hours:.1f} person-hrs  (position items, strap, fill gaps)",
                 "amount": round(truck_load_person_hours * labor_rate, 2)},
            ]

        def _transport_back_lines(trips, t_rate):
            return [
                {"name": "26' Moving Van", "qty": trips, "unit": "DY",
                 "rate": round(t_rate, 2),
                 "detail": f"{trips} trip{'s' if trips > 1 else ''}  (~500 SF capacity per trip)",
                 "amount": round(t_rate * trips, 2)},
                {"name": "Content Carry-In (floor-weighted)", "qty": _carry_in_elapsed, "unit": "HR",
                 "rate": _carry_in_rate,
                 "detail": _crew_detail(carry_in_floor_note, _carry_in_elapsed, crew, _carry_in_per_person, _carry_in_amt),
                 "amount": _carry_in_amt},
                {"name": "Truck Unloading", "qty": truck_load_person_hours, "unit": "HR",
                 "rate": round(labor_rate, 2),
                 "detail": f"{truck_load_person_hours:.1f} person-hrs  (unload, stage at entry, distribute)",
                 "amount": round(truck_load_person_hours * labor_rate, 2)},
            ]

        if not is_on_site:
            section_details["Transport Out"] = {"lines": _transport_out_lines(truck_trips, truck_rate)}
            if "Transport Back" in sections:
                section_details["Transport Back"] = {"lines": _transport_back_lines(truck_trips, truck_rate)}
            if storage_cost > 0:
                _sf_rate = self.get_price("2840") or 2.18
                _setup_fee = get_storage_setup_fee(storage_sf)
                section_details["Storage"] = build_storage_section_detail(
                    storage_sf, _sf_rate, request.storage_months,
                    _setup_fee, storage_cost,
                )

        if is_on_site:
            # on_site_person_hours == carry_person_hours (same underlying value,
            # see assignment above) — reuse the elapsed/rate/amount already derived.
            section_details["On-Site Relocation"] = {"lines": [
                {"name": "Content Carry to Staging Area (floor-weighted)", "qty": _carry_out_elapsed, "unit": "HR",
                 "rate": _carry_out_rate,
                 "detail": _crew_detail(carry_floor_note, _carry_out_elapsed, crew, _carry_out_per_person, _carry_out_amt),
                 "amount": _carry_out_amt},
            ]}

        if request.include_packback:
            pb_lines = []
            if pb_standard_hrs > 0:
                _amt = round(pb_standard_hrs * crew_labor_rate, 2)
                pb_lines.append({
                    "name": "Standard Pack-Back", "qty": pb_standard_hrs, "unit": "HR",
                    "rate": crew_labor_rate,
                    "detail": _crew_detail("unpack, place, remove packing material", pb_standard_hrs, crew, labor_rate, _amt),
                    "amount": _amt,
                })
            if pb_fragile_hrs > 0:
                _amt = round(pb_fragile_hrs * crew_fragile_rate, 2)
                pb_lines.append({
                    "name": "Fragile / High-Care Unpacking", "qty": pb_fragile_hrs, "unit": "HR",
                    "rate": crew_fragile_rate,
                    "detail": _crew_detail("careful unwrap, condition check, placement", pb_fragile_hrs, crew, fragile_rate, _amt),
                    "amount": _amt,
                })
            if pb_specialty_hrs > 0:
                _amt = round(pb_specialty_hrs * crew_specialty_rate, 2)
                pb_lines.append({
                    "name": "Specialty / High-Value Unpacking", "qty": pb_specialty_hrs, "unit": "HR",
                    "rate": crew_specialty_rate,
                    "detail": _crew_detail("unwrap, verify serial#, place per owner instruction", pb_specialty_hrs, crew, specialty_rate, _amt),
                    "amount": _amt,
                })
            if pb_appliance_hrs > 0:
                _amt = round(pb_appliance_hrs * crew_labor_rate, 2)
                pb_lines.append({
                    "name": "Appliance Reconnection", "qty": pb_appliance_hrs, "unit": "HR",
                    "rate": crew_labor_rate,
                    "detail": _crew_detail("reconnect utilities, test operation", pb_appliance_hrs, crew, labor_rate, _amt),
                    "amount": _amt,
                })
            if pb_inventory > 0:
                _amt = round(pb_inventory * labor_rate, 2)
                pb_lines.append({
                    "name": "Inventory Verification", "qty": float(pb_inventory), "unit": "HR",
                    "rate": round(labor_rate, 2),
                    "detail": _solo_detail("check items against pack-out inventory, note discrepancies", pb_inventory, labor_rate, _amt),
                    "amount": _amt,
                })
            if pb_supervisor > 0:
                _amt = round(pb_supervisor * fragile_rate, 2)
                pb_lines.append({
                    "name": "Supervision", "qty": float(pb_supervisor), "unit": "HR",
                    "rate": round(fragile_rate, 2),
                    "detail": f"1 supervisor (placement verification, damage check) · {pb_supervisor} hr × {_fmt_money(fragile_rate)}/hr = {_fmt_money(_amt)}",
                    "amount": _amt,
                })
            if pb_lines:
                section_details["Pack-Back Labor"] = {"lines": pb_lines}
            if furniture_assembly_cost > 0:
                _amt = round(pb_furniture_hrs * crew_labor_rate, 2)
                section_details["Furniture Assembly"] = {"lines": [
                    {"name": "Furniture Reassembly", "qty": pb_furniture_hrs, "unit": "HR",
                     "rate": crew_labor_rate,
                     "detail": _crew_detail("reassemble disassembled pieces", pb_furniture_hrs, crew, labor_rate, _amt),
                     "amount": _amt},
                ]}

        # Debris Hauling section_details — show exactly what drove the charge
        section_details["Debris Hauling"] = {"lines": [
            {"name": "Debris Hauling", "qty": debris_hours, "unit": "HR",
             "rate": round(labor_rate_adj, 2),
             "detail": _debris_desc,
             "amount": round(debris_cost, 2)},
        ]}

        # Reconcile ALL section totals from their detail lines so there is
        # no rounding drift between independent calculations.
        for sec_name, sec_detail in section_details.items():
            lines = sec_detail.get("lines", [])
            if lines and sec_name in sections:
                sections[sec_name] = round(sum(l.get("amount", 0) for l in lines), 2)
        subtotal = round(sum(sections.values()), 2)
        op_amount = round(subtotal * (request.op_rate / 100), 2) if request.include_op else 0
        contingency_amount = round(subtotal * (request.contingency_rate / 100), 2) if request.include_contingency else 0
        grand_total = round(subtotal + op_amount + supplements_total + contingency_amount, 2)

        # Workday scheduling notes
        WORKDAY_HOURS = 8
        notes: list[str] = []
        if total_hours_calc > WORKDAY_HOURS:
            work_days = math.ceil(total_hours_calc / WORKDAY_HOURS)
            notes.append(
                f"Estimated on-site time is {round(total_hours_calc, 1)} hrs "
                f"({crew}-person crew), exceeding a standard {WORKDAY_HOURS}-hr workday. "
                f"Recommend scheduling {work_days} days."
            )

        return EstimateResponse(
            total_rooms=len(request.rooms),
            total_items=total_items,
            total_hours=round(total_hours_calc, 1),
            crew_size=request.crew_size,
            sections=sections,
            section_details=section_details,
            materials=materials,
            material_details=material_details,
            storage_sf=storage_sf if not is_on_site else 0,
            staging_type=request.staging_type,
            room_summaries=room_summaries,
            subtotal=round(subtotal, 2),
            include_op=request.include_op,
            op_rate=request.op_rate,
            op_amount=round(op_amount, 2),
            include_contingency=request.include_contingency,
            contingency_rate=request.contingency_rate,
            contingency_amount=round(contingency_amount, 2),
            supplements=supplements,
            supplements_total=round(supplements_total, 2),
            grand_total=round(grand_total, 2),
            notes=notes,
        )

    @staticmethod
    def _derive_hints(items: List[DetectedContentItem]) -> list:
        """Fallback: derive content hints from item categories."""
        category_to_hint = {
            "Furniture": "furniture", "Electronics": "electronics", "Books": "books",
            "Kitchenware": "kitchenware", "Clothing": "clothing_hanging",
            "Fragile": "fragile", "Artwork": "artwork", "Collectibles": "collectibles",
            "Appliances": "appliances_small", "Tools": "tools", "Sports": "sports",
        }
        return list({category_to_hint[i.category] for i in items if i.category in category_to_hint})

    def get_prices_dict(self) -> Dict[str, float]:
        """Export all prices as a flat dict for use by export service."""
        result = {}
        for code, p in self.prices.items():
            result[code] = p.price
        # Also add named lookups used by export.py
        CODE_TO_NAME = {
            "2825": "labor", "2911": "labor_fragile", "2912": "labor_specialty",
            "2934": "truck_26", "2840": "storage_sf", "2844": "storage_setup",
        }
        for code, name in CODE_TO_NAME.items():
            price = self.get_price(code)
            if price > 0:
                result[name] = price
        # Material key-based prices
        for key, code in MATERIAL_CODES.items():
            price = self.get_price(code)
            if price > 0:
                result[key] = price
        return result


def validate_estimate_output(section_details: Dict[str, Any]) -> List[str]:
    """Validate estimate output for issues that could raise client/adjuster concerns.

    Checks:
    - Duplicate line names across different sections
    - Box count consistency between Supply and Debris sections
    - Internal calculation fields that shouldn't be exposed

    Returns list of warning strings (empty = clean).
    """
    warnings: List[str] = []

    # Check for duplicate line names across different sections
    section_lines: Dict[str, List[str]] = {}  # line_name → [section_names]
    for section_name, detail in section_details.items():
        if not isinstance(detail, dict):
            continue
        for line in detail.get("lines", []):
            line_name = line.get("name", "")
            if line_name:
                if line_name not in section_lines:
                    section_lines[line_name] = []
                section_lines[line_name].append(section_name)

    for line_name, sections in section_lines.items():
        if len(sections) > 1:
            # Skip generic names that legitimately appear in multiple sections
            generic_names = {"26' Moving Van", "Supervision", "Supervisor/Foreman"}
            if line_name not in generic_names:
                warnings.append(
                    f"Line '{line_name}' appears in multiple sections: {sections}"
                )

    return warnings


def get_calculator(db: Session, company_id=None) -> EstimateCalculator:
    """Factory function to create calculator instance."""
    return EstimateCalculator(db, company_id)
