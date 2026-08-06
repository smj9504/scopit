"""
Scopit - Packing Estimator Public Demo Fixtures

Canned "AI analysis" results for the unauthenticated packing demo
(see ../demo_api.py). No real vision AI call is ever made for these rooms —
the item lists below are hand-authored to look like a plausible Claude
Vision result for the accompanying sample photos.

To add or replace a demo room's photos:
  Drop any number of JPEG/PNG files into demo/photos/ named
  "{room_key}_1.jpg", "{room_key}_2.jpg", ... — they're auto-discovered
  by _discover_photos() below, in numeric order, so there's no fixed
  filename list to keep in sync. To add/replace the analyzed items for a
  room, edit the DetectedContentItem list in that room's function below.

Categories must be one of the keys in EstimateCalculator.CATEGORY_PACKING_RULES
(service.py) — Furniture, Appliances, Electronics, Books, Fragile, Artwork,
Kitchenware, Clothing, Collectibles, Tools, Sports, Other — so labor/materials
enrichment behaves the same as it would for a real AI analysis result.
"""
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

from app.domains.tools.modules.packing.schemas import (
    DetectedContentItem,
    RoomAnalysisResponse,
)

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"


def _discover_photos(room_key: str) -> List[str]:
    """Find every "{room_key}_<n>.<ext>" file in demo/photos/, sorted
    numerically (basement_2.jpg before basement_10.jpg)."""
    pattern = re.compile(rf"^{re.escape(room_key)}_(\d+)\.(jpg|jpeg|png)$", re.IGNORECASE)
    matches = []
    if PHOTOS_DIR.is_dir():
        for path in PHOTOS_DIR.iterdir():
            m = pattern.match(path.name)
            if m:
                matches.append((int(m.group(1)), path.name))
    return [name for _, name in sorted(matches)]


@dataclass
class DemoRoomFixture:
    room_key: str
    room_name: str
    photo_filenames: List[str]
    analysis: RoomAnalysisResponse


def _basement() -> DemoRoomFixture:
    items = [
        DetectedContentItem(
            name="Dresser", description="6-drawer, wood", size="L", weight="heavy",
            category="Furniture", quantity=1, confidence=0.91,
        ),
        DetectedContentItem(
            name="China Cabinet", size="L", weight="heavy",
            category="Furniture", quantity=1, needs_disassembly=True, confidence=0.88,
        ),
        DetectedContentItem(
            name="Framed Art / Wall Scrolls", size="M", weight="light",
            category="Artwork", quantity=5, is_fragile=True, confidence=0.86,
        ),
        DetectedContentItem(
            name="Moving Box, Packed", description="labeled 'contents'", size="M", weight="medium",
            category="Other", quantity=4, confidence=0.90,
        ),
        DetectedContentItem(
            name="Quilt / Bedding, Bagged", size="M", weight="light",
            category="Clothing", quantity=3, confidence=0.83,
        ),
        DetectedContentItem(
            name="Decorative Tray/Vanity Set", size="S", weight="light",
            category="Collectibles", quantity=1, is_fragile=True, confidence=0.78,
        ),
        DetectedContentItem(
            name="Exercise Bike", size="L", weight="heavy",
            category="Sports", quantity=1, confidence=0.84,
        ),
    ]
    low_confidence_items = [
        DetectedContentItem(
            name="Ceramic Table Lamp", size="S", weight="light",
            category="Fragile", quantity=1, is_fragile=True, confidence=0.58,
        ),
    ]
    analysis = RoomAnalysisResponse(
        room_name="Basement",
        items=items,
        low_confidence_items=low_confidence_items,
        density="dense",
        room_size="large",
        confidence_score=0.85,
        fragile_count=sum(i.quantity for i in items if i.is_fragile),
        high_value_count=sum(i.quantity for i in items if i.is_high_value),
        field_notes=[],
    )
    return DemoRoomFixture(
        room_key="basement",
        room_name="Basement",
        photo_filenames=_discover_photos("basement"),
        analysis=analysis,
    )


def _dining_room() -> DemoRoomFixture:
    items = [
        DetectedContentItem(
            name="China Cabinet", description="glass-front, illuminated", size="L", weight="heavy",
            category="Furniture", quantity=1, is_high_value=True, confidence=0.93,
        ),
        DetectedContentItem(
            name="China / Fine Dinnerware", size="S", weight="light",
            category="Fragile", quantity=16, is_fragile=True, is_high_value=True,
            estimated_value="$500+", confidence=0.87,
        ),
        DetectedContentItem(
            name="Crystal Glassware", size="S", weight="light",
            category="Fragile", quantity=10, is_fragile=True, confidence=0.85,
        ),
        DetectedContentItem(
            name="Dining Table", description="wood, seats 6-8", size="XL", weight="heavy",
            category="Furniture", quantity=1, needs_disassembly=True, confidence=0.92,
        ),
        DetectedContentItem(
            name="Dining Chair", size="M", weight="medium",
            category="Furniture", quantity=6, confidence=0.90,
        ),
        DetectedContentItem(
            name="Crystal Chandelier", size="M", weight="medium",
            category="Fragile", quantity=1, is_fragile=True, is_high_value=True,
            needs_disassembly=True, confidence=0.80,
        ),
        DetectedContentItem(
            name="Area Rug", size="L", weight="medium",
            category="Furniture", quantity=1, confidence=0.82,
        ),
    ]
    low_confidence_items = [
        DetectedContentItem(
            name="Decorative Bowl", size="S", weight="light",
            category="Collectibles", quantity=2, is_fragile=True, confidence=0.52,
        ),
    ]
    analysis = RoomAnalysisResponse(
        room_name="Dining Room",
        items=items,
        low_confidence_items=low_confidence_items,
        density="normal",
        room_size="large",
        confidence_score=0.86,
        fragile_count=sum(i.quantity for i in items if i.is_fragile),
        high_value_count=sum(i.quantity for i in items if i.is_high_value),
        field_notes=[],
    )
    return DemoRoomFixture(
        room_key="dining_room",
        room_name="Dining Room",
        photo_filenames=_discover_photos("dining_room"),
        analysis=analysis,
    )


DEMO_ROOMS: dict[str, DemoRoomFixture] = {
    fixture.room_key: fixture
    for fixture in (_basement(), _dining_room())
}

# Flat allowlist of every filename any demo room references — the photo-serving
# endpoint only ever serves names in this set, so it can't be used to read
# arbitrary files off disk.
DEMO_PHOTO_FILENAMES: set[str] = {
    filename
    for fixture in DEMO_ROOMS.values()
    for filename in fixture.photo_filenames
}
