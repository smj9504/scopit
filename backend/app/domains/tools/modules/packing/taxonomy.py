"""
Item Taxonomy & Normalization Service

Master list of canonical packing item names with fuzzy matching.
Used as a post-processing layer after AI vision analysis to ensure
consistent, packing-focused item names.

Architecture:
  AI Vision (free-form names) -> normalize_item_name() -> canonical name

The taxonomy is organized by packing category, not by room type,
because packing requirements drive the estimation logic.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

# ============================================
# TAXONOMY DEFINITION
# ============================================

@dataclass
class CanonicalItem:
    """A canonical packing item with aliases for fuzzy matching."""
    name: str
    category: str
    aliases: list = field(default_factory=list)
    is_fragile: bool = False
    is_high_value_default: bool = False


# Master taxonomy: ~170 items covering typical household contents.
# Each entry defines the canonical packing name, category,
# and common AI-generated variations (aliases).
PACKING_TAXONOMY: list[CanonicalItem] = [
    # ── Furniture: Bedroom ──────────────────────────────────────────
    CanonicalItem("King Bed Frame", "Furniture",
                  ["king bed", "king size bed", "king bed frame", "california king"]),
    CanonicalItem("Queen Bed Frame", "Furniture",
                  ["queen bed", "queen size bed", "queen bed frame"]),
    CanonicalItem("Full Bed Frame", "Furniture",
                  ["full bed", "full size bed", "double bed", "double bed frame"]),
    CanonicalItem("Twin Bed Frame", "Furniture",
                  ["twin bed", "single bed", "twin bed frame", "single bed frame"]),
    CanonicalItem("Bunk Bed Frame", "Furniture",
                  ["bunk bed", "bunk beds", "loft bed"]),
    CanonicalItem("Toddler Bed", "Furniture",
                  ["toddler bed frame", "child bed", "kids bed"]),
    CanonicalItem("Crib", "Furniture",
                  ["baby crib", "infant crib", "convertible crib"]),
    # Unsized fallbacks. The AI is asked to size beds (and to size a frame and
    # its mattress identically), but when it reports a bare "bed frame" or
    # "mattress" these must NOT be silently promoted to a specific size —
    # doing so previously produced mismatched pairs like a Queen Bed Frame
    # next to a King Mattress from a single photo. An unsized name in, an
    # unsized name out; pricing treats these as the standard double size.
    CanonicalItem("Bed Frame", "Furniture",
                  ["bed frame", "platform bed", "bed base", "bedframe"]),
    CanonicalItem("Mattress", "Furniture",
                  ["mattress and box spring", "box spring"]),
    CanonicalItem("King Mattress", "Furniture",
                  ["king size mattress", "california king mattress"]),
    CanonicalItem("Queen Mattress", "Furniture",
                  ["queen size mattress"]),
    CanonicalItem("Full Mattress", "Furniture",
                  ["full size mattress", "double mattress"]),
    CanonicalItem("Twin Mattress", "Furniture",
                  ["twin size mattress", "single mattress"]),
    CanonicalItem("Nightstand", "Furniture",
                  ["bedside table", "night table", "night stand", "bedside cabinet"]),
    CanonicalItem("Dresser", "Furniture",
                  ["chest of drawers", "bureau", "drawer chest", "bedroom dresser",
                   "4-drawer dresser", "6-drawer dresser", "tall dresser",
                   "wooden dresser", "drawer dresser"]),
    CanonicalItem("Wardrobe", "Furniture",
                  ["armoire", "clothes cabinet", "standing wardrobe", "wardrobe cabinet"]),
    CanonicalItem("Vanity Table", "Furniture",
                  ["vanity", "makeup table", "dressing table", "vanity desk"]),

    # ── Furniture: Living Room ──────────────────────────────────────
    CanonicalItem("Sofa", "Furniture",
                  ["couch", "loveseat", "settee", "upholstered sofa", "fabric sofa",
                   "leather sofa", "leather couch", "2-seat sofa", "3-seat sofa"]),
    CanonicalItem("Sectional Sofa", "Furniture",
                  ["sectional", "l-shaped sofa", "l-shaped couch", "modular sofa"]),
    CanonicalItem("Sleeper Sofa", "Furniture",
                  ["sofa bed", "pull-out couch", "convertible sofa", "futon"]),
    CanonicalItem("Recliner Chair", "Furniture",
                  ["recliner", "upholstered recliner", "lazy boy", "reclining chair"]),
    CanonicalItem("Accent Chair", "Furniture",
                  ["armchair", "occasional chair", "side chair", "reading chair",
                   "upholstered chair", "wingback chair", "club chair"]),
    CanonicalItem("Ottoman", "Furniture",
                  ["footstool", "foot rest", "pouf", "hassock"]),
    CanonicalItem("Coffee Table", "Furniture",
                  ["center table", "cocktail table"]),
    CanonicalItem("End Table", "Furniture",
                  ["side table", "lamp table", "accent table", "occasional table"]),
    CanonicalItem("Console Table", "Furniture",
                  ["hallway table", "entryway table", "sofa table", "hall table"]),
    CanonicalItem("TV Stand", "Furniture",
                  ["media console", "entertainment center", "media center",
                   "tv cabinet", "tv console", "media stand"]),
    CanonicalItem("Bookshelf", "Furniture",
                  ["bookcase", "shelving unit", "book shelf", "wooden bookshelf",
                   "display shelf", "wall shelf unit", "shelf unit"]),
    CanonicalItem("Display Cabinet", "Furniture",
                  ["curio cabinet", "china cabinet", "glass cabinet",
                   "display case", "hutch"]),

    # ── Furniture: Dining ───────────────────────────────────────────
    CanonicalItem("Dining Table", "Furniture",
                  ["kitchen table", "eating table", "breakfast table"]),
    CanonicalItem("Dining Chair", "Furniture",
                  ["kitchen chair", "eating chair"]),
    CanonicalItem("Bar Stool", "Furniture",
                  ["counter stool", "high chair", "barstool"]),
    CanonicalItem("Buffet Table", "Furniture",
                  ["sideboard", "credenza", "buffet", "server table"]),

    # ── Furniture: Office ───────────────────────────────────────────
    CanonicalItem("Desk", "Furniture",
                  ["writing desk", "computer desk", "office desk", "work desk",
                   "standing desk", "study desk"]),
    CanonicalItem("Office Chair", "Furniture",
                  ["desk chair", "swivel chair", "task chair", "computer chair"]),
    CanonicalItem("Filing Cabinet", "Furniture",
                  ["file cabinet", "lateral file", "file drawer"]),

    # ── Furniture: Storage ──────────────────────────────────────────
    CanonicalItem("Storage Cabinet", "Furniture",
                  ["utility cabinet", "storage unit", "cabinet"]),
    CanonicalItem("Chest", "Furniture",
                  ["storage chest", "trunk", "hope chest", "wooden chest",
                   "toy chest"]),
    CanonicalItem("Coat Rack", "Furniture",
                  ["hat rack", "standing coat rack", "coat stand", "hall tree"]),
    CanonicalItem("Shoe Rack", "Furniture",
                  ["shoe shelf", "shoe organizer", "shoe stand"]),

    # ── Bedding & Linens ───────────────────────────────────────────
    CanonicalItem("Quilt Blanket", "Other",
                  ["quilt", "comforter", "bedspread", "duvet", "blanket",
                   "throw blanket", "bed cover", "coverlet", "patchwork quilt"]),
    CanonicalItem("Pillow", "Other",
                  ["bed pillow", "throw pillow", "decorative pillow",
                   "accent pillow", "cushion", "bolster pillow"]),
    CanonicalItem("Bed Sheet Set", "Other",
                  ["sheets", "bed linens", "fitted sheet", "flat sheet",
                   "sheet set", "bed linen set"]),
    CanonicalItem("Towel Set", "Other",
                  ["towels", "bath towels", "hand towels"]),

    # ── Electronics ─────────────────────────────────────────────────
    CanonicalItem("Flat Screen TV", "Electronics",
                  ["tv", "television", "led tv", "lcd tv", "oled tv",
                   "smart tv", "flat panel tv", "wall mounted tv",
                   "55 inch tv", "65 inch tv", "50 inch tv", "43 inch tv",
                   "75 inch tv", "large tv", "small tv"],
                  is_fragile=True),
    CanonicalItem("Desktop Computer", "Electronics",
                  ["pc", "computer tower", "desktop", "desktop pc",
                   "gaming pc", "computer"],
                  is_high_value_default=True),
    CanonicalItem("Laptop Computer", "Electronics",
                  ["laptop", "notebook", "notebook computer", "macbook"],
                  is_high_value_default=True),
    CanonicalItem("Computer Monitor", "Electronics",
                  ["monitor", "display", "computer display", "pc monitor"],
                  is_fragile=True),
    CanonicalItem("Computer Keyboard and Mouse", "Electronics",
                  ["keyboard", "computer keyboard", "keyboard and mouse",
                   "mouse", "computer mouse", "mechanical keyboard"]),
    CanonicalItem("Gaming Console", "Electronics",
                  ["playstation", "xbox", "nintendo", "game console",
                   "nintendo switch", "ps5", "ps4", "game system"]),
    CanonicalItem("Sound System", "Electronics",
                  ["speakers", "stereo", "soundbar", "home theater",
                   "speaker set", "subwoofer", "receiver", "amplifier"]),
    CanonicalItem("Printer", "Electronics",
                  ["printer scanner", "all-in-one printer", "laser printer",
                   "inkjet printer"]),
    CanonicalItem("Router/Modem", "Electronics",
                  ["router", "modem", "wifi router", "network equipment"]),
    CanonicalItem("Record Player", "Electronics",
                  ["turntable", "vinyl player", "phonograph"],
                  is_fragile=True),

    # ── Lighting ────────────────────────────────────────────────────
    CanonicalItem("Table Lamp", "Fragile",
                  ["desk lamp", "bedside lamp", "accent lamp", "small lamp"],
                  is_fragile=True),
    CanonicalItem("Floor Lamp", "Fragile",
                  ["standing lamp", "tall lamp", "arc lamp", "torchiere"],
                  is_fragile=True),
    CanonicalItem("Chandelier", "Fragile",
                  ["hanging light", "pendant light"],
                  is_fragile=True),

    # ── Artwork & Decor ────────────────────────────────────────────
    CanonicalItem("Framed Picture", "Artwork",
                  ["picture frame", "photo frame", "wall art", "framed photo",
                   "framed print", "framed artwork", "wall picture",
                   "framed family photo", "framed picture frame"],
                  is_fragile=True),
    CanonicalItem("Canvas Painting", "Artwork",
                  ["painting", "oil painting", "canvas art", "acrylic painting",
                   "watercolor painting", "art piece"],
                  is_fragile=True),
    CanonicalItem("Wall Mirror", "Artwork",
                  ["mirror", "decorative mirror", "full length mirror",
                   "standing mirror", "vanity mirror", "wall-mounted mirror"],
                  is_fragile=True),
    CanonicalItem("Wall Clock", "Fragile",
                  ["clock", "decorative clock", "mantel clock"],
                  is_fragile=True),
    CanonicalItem("Sculpture", "Artwork",
                  ["statue", "figurine", "bust", "art sculpture"],
                  is_fragile=True, is_high_value_default=True),

    # ── Fragile / Decorative ───────────────────────────────────────
    CanonicalItem("Ceramic Vase", "Fragile",
                  ["vase", "flower vase", "decorative vase", "glass vase"],
                  is_fragile=True),
    CanonicalItem("Glass Figurine", "Fragile",
                  ["figurine", "statuette", "ceramic figurine", "porcelain figurine"],
                  is_fragile=True),
    CanonicalItem("Decorative Bowl", "Fragile",
                  ["bowl", "centerpiece bowl", "decorative dish"],
                  is_fragile=True),
    CanonicalItem("Candle Holder", "Fragile",
                  ["candlestick", "candelabra", "candle set"],
                  is_fragile=True),
    CanonicalItem("Photo Album", "Other",
                  ["photo book", "scrapbook"]),

    # ── Kitchenware ─────────────────────────────────────────────────
    CanonicalItem("Dish Set", "Kitchenware",
                  ["dishes", "plates", "dinnerware", "dinner set",
                   "plate set", "china set"],
                  is_fragile=True),
    CanonicalItem("Glassware Set", "Kitchenware",
                  ["glasses", "drinking glasses", "wine glasses",
                   "glass set", "stemware", "crystal glasses"],
                  is_fragile=True),
    CanonicalItem("Mug Set", "Kitchenware",
                  ["mugs", "coffee mugs", "tea cups", "cup set"],
                  is_fragile=True),
    CanonicalItem("Pot and Pan Set", "Kitchenware",
                  ["pots", "pans", "cookware", "cooking set",
                   "pot set", "pan set", "cookware set"]),
    CanonicalItem("Utensil Set", "Kitchenware",
                  ["utensils", "kitchen utensils", "silverware", "flatware",
                   "cutlery", "knife set"]),
    CanonicalItem("Mixing Bowl Set", "Kitchenware",
                  ["mixing bowls", "kitchen bowls", "bowl set"]),
    CanonicalItem("Bakeware Set", "Kitchenware",
                  ["baking pans", "baking sheets", "cookie sheets"]),
    CanonicalItem("Food Storage Containers", "Kitchenware",
                  ["tupperware", "food containers", "storage containers",
                   "plastic containers"]),

    # ── Small Appliances ───────────────────────────────────────────
    CanonicalItem("Small Kitchen Appliance", "Appliances",
                  ["small appliance", "kitchen appliance",
                   "countertop appliance"]),
    CanonicalItem("Microwave", "Appliances",
                  ["microwave oven", "countertop microwave"]),
    CanonicalItem("Coffee Maker", "Appliances",
                  ["coffee machine", "espresso machine", "keurig",
                   "drip coffee maker"]),
    CanonicalItem("Toaster", "Appliances",
                  ["toaster oven", "bread toaster"]),
    CanonicalItem("Blender", "Appliances",
                  ["food processor", "smoothie maker", "kitchen blender"]),
    CanonicalItem("Stand Mixer", "Appliances",
                  ["kitchen mixer", "kitchenaid", "hand mixer"]),
    CanonicalItem("Air Fryer", "Appliances",
                  ["air fryer oven"]),
    CanonicalItem("Instant Pot", "Appliances",
                  ["pressure cooker", "slow cooker", "crock pot"]),
    CanonicalItem("Rice Cooker", "Appliances", []),

    # ── Large Appliances ───────────────────────────────────────────
    CanonicalItem("Refrigerator", "Appliances",
                  ["fridge", "mini fridge", "french door refrigerator"]),
    CanonicalItem("Washing Machine", "Appliances",
                  ["washer", "front load washer", "top load washer"]),
    CanonicalItem("Dryer", "Appliances",
                  ["clothes dryer", "front load dryer"]),
    CanonicalItem("Dishwasher", "Appliances",
                  ["portable dishwasher"]),
    CanonicalItem("Vacuum Cleaner", "Appliances",
                  ["vacuum", "upright vacuum", "stick vacuum", "robot vacuum"]),
    CanonicalItem("Iron and Ironing Board", "Appliances",
                  ["ironing board", "iron", "steam iron", "ironing set"]),
    CanonicalItem("Space Heater", "Appliances",
                  ["portable heater", "electric heater", "radiator heater"]),
    CanonicalItem("Dehumidifier", "Appliances",
                  ["humidifier", "air purifier"]),
    CanonicalItem("Window AC Unit", "Appliances",
                  ["air conditioner", "portable ac", "window unit"]),

    # ── Clothing ────────────────────────────────────────────────────
    CanonicalItem("Clothing Items", "Clothing",
                  ["clothes", "garments", "clothing", "apparel",
                   "clothing pile", "folded clothes", "clothing on chair",
                   "dark clothing items"]),
    CanonicalItem("Hanging Garments", "Clothing",
                  ["hanging clothes", "closet clothes", "wardrobe contents",
                   "hanging clothing"]),
    CanonicalItem("Shoes", "Clothing",
                  ["shoe collection", "footwear", "shoe pairs", "boots"]),
    CanonicalItem("Coats and Jackets", "Clothing",
                  ["coats", "jackets", "winter coats", "outerwear"]),
    CanonicalItem("Hat Collection", "Clothing",
                  ["hats", "caps", "baseball caps"]),

    # ── Books & Media ──────────────────────────────────────────────
    CanonicalItem("Book Collection", "Books",
                  ["books", "book stack", "book set", "hardcover books",
                   "paperback books", "textbooks", "library"]),
    CanonicalItem("Magazine Collection", "Books",
                  ["magazines", "periodicals"]),
    CanonicalItem("DVD/Blu-ray Collection", "Books",
                  ["dvds", "blu-rays", "movie collection", "cd collection",
                   "media collection"]),
    CanonicalItem("Vinyl Record Collection", "Books",
                  ["records", "vinyl records", "lp collection"],
                  is_fragile=True),

    # ── Sports & Recreation ────────────────────────────────────────
    CanonicalItem("Treadmill", "Sports",
                  ["running machine"],
                  is_high_value_default=True),
    CanonicalItem("Exercise Bike", "Sports",
                  ["stationary bike", "spin bike", "peloton"],
                  is_high_value_default=True),
    CanonicalItem("Elliptical Machine", "Sports",
                  ["elliptical trainer"],
                  is_high_value_default=True),
    CanonicalItem("Weight Bench", "Sports",
                  ["workout bench", "exercise bench"]),
    CanonicalItem("Free Weights", "Sports",
                  ["dumbbells", "dumbbell set", "weight set", "barbells", "kettlebells"]),
    CanonicalItem("Yoga Mat", "Sports",
                  ["exercise mat", "fitness mat"]),
    CanonicalItem("Bicycle", "Sports",
                  ["bike", "road bike", "mountain bike", "hybrid bike"]),
    CanonicalItem("Golf Club Set", "Sports",
                  ["golf clubs", "golf bag", "golf set"]),
    CanonicalItem("Ski Equipment", "Sports",
                  ["skis", "ski set", "snowboard"]),
    CanonicalItem("Sports Equipment Bag", "Sports",
                  ["sports bag", "gear bag", "equipment bag", "duffel bag"]),

    # ── Musical Instruments ────────────────────────────────────────
    CanonicalItem("Acoustic Guitar", "Collectibles",
                  ["guitar", "classical guitar"],
                  is_fragile=True, is_high_value_default=True),
    CanonicalItem("Electric Guitar", "Collectibles",
                  ["bass guitar", "electric bass"],
                  is_fragile=True, is_high_value_default=True),
    CanonicalItem("Keyboard/Piano", "Collectibles",
                  ["piano", "electric piano", "digital piano",
                   "upright piano", "electric keyboard", "music keyboard",
                   "musical keyboard", "keyboard piano", "piano keyboard",
                   "synthesizer"],
                  is_fragile=True, is_high_value_default=True),
    CanonicalItem("Drum Set", "Collectibles",
                  ["drums", "drum kit"],
                  is_high_value_default=True),
    CanonicalItem("Violin", "Collectibles",
                  ["viola", "cello", "string instrument"],
                  is_fragile=True, is_high_value_default=True),
    CanonicalItem("Guitar Amplifier", "Electronics",
                  ["amp", "amplifier", "guitar amp"]),

    # ── Tools ──────────────────────────────────────────────────────
    CanonicalItem("Power Tool", "Tools",
                  ["drill", "circular saw", "jigsaw", "impact driver",
                   "power drill", "sander"]),
    CanonicalItem("Hand Tool Set", "Tools",
                  ["hand tools", "tool set", "wrench set", "screwdriver set"]),
    CanonicalItem("Tool Box", "Tools",
                  ["tool chest", "tool cabinet", "tool bag"]),
    CanonicalItem("Lawn Mower", "Tools",
                  ["push mower", "riding mower"]),
    CanonicalItem("Leaf Blower", "Tools",
                  ["blower", "yard blower"]),
    CanonicalItem("Ladder", "Tools",
                  ["step ladder", "extension ladder", "folding ladder"]),
    CanonicalItem("Workbench", "Tools",
                  ["work bench", "garage bench"]),

    # ── Kids & Toys ────────────────────────────────────────────────
    CanonicalItem("Toy Collection", "Other",
                  ["toys", "toy box", "toy bin", "children's toys",
                   "kids toys", "toy set"]),
    CanonicalItem("Stuffed Animals", "Other",
                  ["plush toys", "stuffed toys", "teddy bear", "plushies"]),
    CanonicalItem("Board Game Collection", "Other",
                  ["board games", "games", "game collection", "puzzles"]),
    CanonicalItem("Play Set", "Other",
                  ["play kitchen", "play table", "activity table"]),
    CanonicalItem("Stroller", "Other",
                  ["baby stroller", "jogging stroller"]),
    CanonicalItem("High Chair", "Other",
                  ["baby high chair", "feeding chair"]),
    CanonicalItem("Baby Swing", "Other",
                  ["infant swing", "baby bouncer"]),

    # ── Outdoor ────────────────────────────────────────────────────
    CanonicalItem("Patio Chair", "Furniture",
                  ["outdoor chair", "adirondack chair", "lawn chair",
                   "garden chair"]),
    CanonicalItem("Patio Table", "Furniture",
                  ["outdoor table", "garden table"]),
    CanonicalItem("Grill", "Appliances",
                  ["bbq grill", "barbecue", "gas grill", "charcoal grill"]),
    CanonicalItem("Patio Umbrella", "Other",
                  ["umbrella", "outdoor umbrella", "sun umbrella"]),
    CanonicalItem("Garden Hose", "Other",
                  ["hose", "hose reel"]),
    CanonicalItem("Planter Pot", "Fragile",
                  ["flower pot", "garden pot", "ceramic planter"],
                  is_fragile=True),
    CanonicalItem("Potted Plant", "Fragile",
                  ["plant", "houseplant", "indoor plant", "house plant"],
                  is_fragile=True),

    # ── Miscellaneous ──────────────────────────────────────────────
    CanonicalItem("Area Rug", "Other",
                  ["rug", "carpet", "floor rug", "throw rug", "runner rug"]),
    CanonicalItem("Curtains", "Other",
                  ["drapes", "window curtains", "curtain panels",
                   "window treatments"]),
    CanonicalItem("Storage Bin", "Other",
                  ["plastic bin", "storage container", "tote", "storage tote",
                   "clear bin"]),
    CanonicalItem("Cardboard Box", "Other",
                  ["box", "moving box", "stored box", "packed box"]),
    CanonicalItem("Basket", "Other",
                  ["wicker basket", "storage basket", "laundry basket",
                   "decorative basket"]),
    CanonicalItem("Fan", "Other",
                  ["standing fan", "box fan", "tower fan", "ceiling fan",
                   "desk fan", "pedestal fan"]),
    CanonicalItem("Trash Can", "Other",
                  ["waste bin", "garbage can", "recycling bin"]),
    CanonicalItem("Pet Crate", "Other",
                  ["dog crate", "pet kennel", "pet carrier"]),
    CanonicalItem("Suitcase", "Other",
                  ["luggage", "travel bag", "rolling suitcase"]),
    CanonicalItem("Safe", "Other",
                  ["fire safe", "lockbox", "security safe"],
                  is_high_value_default=True),
    CanonicalItem("Fireplace Tools", "Other",
                  ["fireplace set", "fire tools"]),
    CanonicalItem("Wine Rack", "Fragile",
                  ["wine holder", "wine shelf", "wine storage"],
                  is_fragile=True),
]


# ============================================
# LOOKUP STRUCTURES (built once at import)
# ============================================

_ALIAS_MAP: dict[str, CanonicalItem] = {}
_CANONICAL_NAMES: list[str] = []
_ALL_SEARCHABLE: list[str] = []

def _build_lookups():
    """Build the reverse-lookup structures from PACKING_TAXONOMY."""
    global _ALIAS_MAP, _CANONICAL_NAMES, _ALL_SEARCHABLE
    _ALIAS_MAP.clear()
    _CANONICAL_NAMES.clear()
    _ALL_SEARCHABLE.clear()

    for item in PACKING_TAXONOMY:
        lower_name = item.name.lower()
        _ALIAS_MAP[lower_name] = item
        _CANONICAL_NAMES.append(item.name)
        _ALL_SEARCHABLE.append(lower_name)
        for alias in item.aliases:
            alias_lower = alias.lower()
            _ALIAS_MAP[alias_lower] = item
            _ALL_SEARCHABLE.append(alias_lower)

_build_lookups()


# ============================================
# REGEX PATTERNS for stripping decorative text
# ============================================

_STRIP_PATTERNS = [
    # Colors
    r'\b(?:colorful|multicolored|multi-colored)\b',
    r'\b(?:red|blue|green|yellow|purple|orange|pink|brown|black|white|gray|grey'
    r'|beige|cream|navy|teal|maroon|burgundy|olive|tan|ivory|charcoal|silver'
    r'|gold|bronze|copper|turquoise|coral|peach|lavender|mint|sage)\b',
    # Patterns & textures
    r'\b(?:striped|plaid|floral|patchwork|checkered|polka[- ]?dot|geometric'
    r'|paisley|herringbone|chevron|damask|toile|ikat|abstract|embroidered'
    r'|quilted|tufted|woven|knitted|crocheted)\b',
    # Style descriptors
    r'\b(?:antique[- ]?style|modern[- ]?style|vintage[- ]?style|rustic[- ]?style'
    r'|contemporary|traditional|farmhouse|industrial|mid[- ]?century'
    r'|bohemian|boho|shabby[- ]?chic|minimalist|ornate|elegant)\b',
    # Brand / character references
    r'\bwith\s+[\w\s]+(?:characters?|designs?|prints?|motifs?|patterns?)\b',
    r'\b(?:winnie the pooh|disney|ikea|pottery barn|west elm|cb2|wayfair'
    r'|restoration hardware|crate and barrel|pier\s*1|ashley)\b',
    # Subjective adjectives
    r'\b(?:beautiful|gorgeous|lovely|pretty|cute|nice|attractive|stylish'
    r'|fancy|decorative|ornamental)\b',
    # Condition descriptors (not packing-relevant)
    r'\b(?:old|new|brand[- ]?new|well[- ]?used|worn|pristine|shiny|dusty|faded)\b',
]

# Location references in names (remove)
_LOCATION_PATTERNS = [
    r'\s+on\s+(?:the\s+)?(?:nightstand|table|desk|dresser|shelf|floor|wall|bed|chair|sofa|couch)\s*$',
    r'\s+next\s+to\s+(?:the\s+)?\w+\s*$',
    r'\s+in\s+(?:the\s+)?(?:corner|closet|cabinet)\s*$',
    r'\s+against\s+(?:the\s+)?wall\s*$',
    r'\s+near\s+(?:the\s+)?\w+\s*$',
    r'\s+by\s+(?:the\s+)?\w+\s*$',
    r'\s+under\s+(?:the\s+)?\w+\s*$',
    r'\s+above\s+(?:the\s+)?\w+\s*$',
    r'\s+behind\s+(?:the\s+)?\w+\s*$',
]

_COMPILED_STRIP = [re.compile(p, re.IGNORECASE) for p in _STRIP_PATTERNS]
_COMPILED_LOCATION = [re.compile(p, re.IGNORECASE) for p in _LOCATION_PATTERNS]


# ============================================
# CORE MATCHING FUNCTIONS
# ============================================

FUZZY_THRESHOLD = 68  # minimum score to accept a fuzzy match


def _strip_decorative(name: str) -> str:
    """Remove colors, patterns, brand names, and location references."""
    result = name
    for pat in _COMPILED_STRIP:
        result = pat.sub('', result)
    for pat in _COMPILED_LOCATION:
        result = pat.sub('', result)
    # Collapse whitespace
    result = re.sub(r'\s+', ' ', result).strip(' -,')
    return result if result else name


def _try_exact_match(name_lower: str) -> Optional[CanonicalItem]:
    """Try exact match against canonical names and aliases."""
    return _ALIAS_MAP.get(name_lower)


# Words that distinguish one canonical item from another. If an alias adds any
# of these on top of the input, matching the two together would be asserting a
# detail the input never carried (e.g. "mattress" -> "king size mattress").
_DISTINGUISHING_WORDS = frozenset({
    "twin", "single", "full", "double", "queen", "king", "california",
    "toddler", "crib", "bunk", "loft", "baby", "infant",
    "small", "large", "mini", "compact", "oversized",
})


def _alias_only_adds_noise(name_lower: str, alias: str) -> bool:
    """True when `alias` is `name_lower` plus only non-distinguishing words.

    Used to decide whether a shorter input may match a longer alias. Extra
    filler ("size", "set") is harmless; an extra size or type word is not,
    because it would attach a specific size to an item reported without one.
    """
    extra = set(re.findall(r"[a-z]+", alias)) - set(re.findall(r"[a-z]+", name_lower))
    return not (extra & _DISTINGUISHING_WORDS)


def _try_substring_match(name_lower: str) -> Optional[tuple[CanonicalItem, float]]:
    """Check if any alias is a substring of the input (or vice versa).

    Only matches when the alias forms complete words within the input
    (word-boundary check) to avoid false positives like
    "Items on Nightstand" matching "clothing items" via "items".
    """
    best_match = None
    best_len = 0
    for alias, item in _ALIAS_MAP.items():
        # Require alias to be at least 5 chars to avoid short false matches
        if len(alias) < 5:
            continue
        # Check alias is a substring of input
        if alias in name_lower:
            # Verify word boundaries to prevent partial-word matches
            idx = name_lower.index(alias)
            end_idx = idx + len(alias)
            left_ok = (idx == 0 or not name_lower[idx - 1].isalnum())
            right_ok = (
                end_idx == len(name_lower)
                or not name_lower[end_idx].isalnum()
            )
            if left_ok and right_ok and len(alias) > best_len:
                best_match = item
                best_len = len(alias)
        # Check input is a substring of alias (input is shorter form).
        # Guarded against size promotion: a bare "mattress" is a substring of
        # "king size mattress", and picking the longest alias used to resolve
        # it to King — inventing a size the photo never established. When the
        # input omits a qualifier the alias adds, the two are not the same
        # item, so require the extra words to be non-distinguishing.
        elif name_lower in alias and len(name_lower) >= 5:
            if _alias_only_adds_noise(name_lower, alias) and len(alias) > best_len:
                best_match = item
                best_len = len(alias)
    if best_match:
        return best_match, 0.88
    return None


def _try_fuzzy_match(name_lower: str) -> Optional[tuple[CanonicalItem, float]]:
    """Fuzzy match against all canonical names and aliases."""
    try:
        from rapidfuzz import fuzz, process
    except ImportError:
        # Fallback: no fuzzy matching available
        return None

    result = process.extractOne(
        name_lower,
        _ALL_SEARCHABLE,
        scorer=fuzz.token_sort_ratio,
        score_cutoff=FUZZY_THRESHOLD,
    )
    if result:
        matched_key = result[0]
        score = result[1]
        item = _ALIAS_MAP.get(matched_key)
        if item:
            return item, score / 100.0
    return None


def normalize_item_name(
    raw_name: str,
    raw_category: str = "Other",
) -> tuple[str, str, float, Optional[CanonicalItem]]:
    """Normalize an AI-generated item name to a canonical packing name.

    Args:
        raw_name: The name as returned by the AI vision model.
        raw_category: The category as returned by the AI (used as fallback).

    Returns:
        (canonical_name, category, confidence, matched_item)
        - matched_item: the CanonicalItem if matched, None otherwise
        - confidence 1.0 = exact match
        - confidence 0.85-0.95 = substring/near match
        - confidence 0.65-0.85 = fuzzy match
        - confidence 0.4 = no match (returns cleaned original name)
    """
    if not raw_name or not raw_name.strip():
        return raw_name or "Unknown Item", raw_category, 0.0, None

    # Step 1: Strip decorative details
    cleaned = _strip_decorative(raw_name)
    cleaned_lower = cleaned.lower().strip()

    # Step 2: Exact match on cleaned name
    exact = _try_exact_match(cleaned_lower)
    if exact:
        return exact.name, exact.category, 1.0, exact

    # Step 3: Exact match on original (in case stripping removed too much)
    raw_lower = raw_name.lower().strip()
    exact_raw = _try_exact_match(raw_lower)
    if exact_raw:
        return exact_raw.name, exact_raw.category, 1.0, exact_raw

    # Step 4: Substring match
    sub = _try_substring_match(cleaned_lower)
    if sub:
        return sub[0].name, sub[0].category, sub[1], sub[0]

    # Step 5: Fuzzy match
    fuzzy = _try_fuzzy_match(cleaned_lower)
    if fuzzy:
        return fuzzy[0].name, fuzzy[0].category, fuzzy[1], fuzzy[0]

    # Step 6: No match -- return the cleaned name with original category
    return cleaned if cleaned else raw_name, raw_category, 0.4, None


def normalize_items_list(items: list[dict]) -> list[dict]:
    """Normalize a list of item dicts in place.

    Each dict should have at least 'name' and 'category' keys.
    Adds '_original_name' to track what the AI originally said.
    Adds '_match_confidence' to indicate match quality.

    When a taxonomy match is found, overrides AI's is_high_value
    and is_fragile with the taxonomy's ground-truth defaults.
    This prevents the AI from marking ordinary items as high-value
    (e.g., Bed Frame) or missing fragility on glass items.
    """
    for item in items:
        original = item.get("name", "")
        category = item.get("category", "Other")
        canonical_name, canonical_cat, confidence, matched = (
            normalize_item_name(original, category)
        )
        item["_original_name"] = original
        item["_match_confidence"] = round(confidence, 2)
        item["name"] = canonical_name
        # Only override category if we had a confident match
        if confidence >= 0.65:
            item["category"] = canonical_cat
        # Override high-value and fragile flags from taxonomy
        # when we have a confident match. Taxonomy knows that
        # a Bed Frame is NOT high-value and a Glass Vase IS fragile.
        if matched and confidence >= 0.65:
            item["is_high_value"] = matched.is_high_value_default
            item["is_fragile"] = matched.is_fragile

    _reconcile_bed_sizes(items)
    return items


# Bed size names ordered from smallest to largest, used to reconcile a frame
# and mattress that were reported at different sizes.
_BED_SIZES = ("Twin", "Full", "Queen", "King")


def _bed_size_of(name: str) -> Optional[str]:
    """Return the bed size prefix of a bed-frame or mattress name, if any."""
    if not name:
        return None
    lowered = name.lower()
    if "bed frame" not in lowered and "mattress" not in lowered:
        return None
    for size in _BED_SIZES:
        if re.search(rf"\b{size.lower()}\b", lowered):
            return size
    return None


def _reconcile_bed_sizes(items: list[dict]) -> None:
    """Force bed frames and mattresses in one room to a single size.

    A frame and the mattress on it are the same bed, so reporting a "Queen Bed
    Frame" beside a "Full Mattress" is always wrong — but both are plausible
    readings of one photo, and the vision model does sometimes disagree with
    itself across the two lines. The prompt asks for a single size; this makes
    it true regardless.

    The largest reported size wins: mattress bag and moving-blanket quantities
    scale with size, so erring large under-charges nobody and avoids sending a
    crew with packaging too small for the item in front of them.

    Rooms that legitimately hold differently-sized beds (a bunk room, a guest
    room with two twins) are unaffected, because those report bunk beds or a
    matching pair rather than one frame and one mismatched mattress. Only
    rooms with a genuine size disagreement are touched, and unsized names are
    left alone rather than being promoted to a size nobody observed.
    """
    sized = [(i, _bed_size_of(i.get("name", ""))) for i in items]
    present = {size for _, size in sized if size}
    if len(present) < 2:
        return  # nothing to reconcile — one size, or no sized beds at all

    target = max(present, key=_BED_SIZES.index)
    for item, size in sized:
        if not size or size == target:
            continue
        name = item["name"]
        item.setdefault("_original_name", name)
        item["name"] = re.sub(
            rf"\b{size}\b", target, name, count=1,
        )
        item["_bed_size_reconciled"] = True


def get_taxonomy_names() -> list[str]:
    """Return all canonical item names (for tool schema hints)."""
    return list(_CANONICAL_NAMES)


def get_taxonomy_by_category() -> dict[str, list[str]]:
    """Return canonical names grouped by category."""
    grouped: dict[str, list[str]] = {}
    for item in PACKING_TAXONOMY:
        grouped.setdefault(item.category, []).append(item.name)
    return grouped
