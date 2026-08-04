"""
Tests for packout_classifier — item classification logic.

Verifies:
1. Large furniture/appliances → non-boxable (correct type, volume, weight)
2. Small/medium items → correct box type and count
3. Lump sum mode returns counts only, no itemized list
4. Custom items (unknown category) get 'custom' type
5. Floor coverage estimation scales with item count
6. Protection materials assigned by type
7. Disassembly/crating flags propagate
"""

import pytest
from app.domains.tools.modules.packing.schemas import DetectedContentItem
from app.domains.tools.modules.packing.packout_classifier import (
    classify_items_for_packout,
    _is_non_boxable,
    _to_non_boxable_item,
    PROTECTION_MAP,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _item(
    name="Test Item",
    category="Other",
    size="M",
    weight="medium",
    quantity=1,
    is_fragile=False,
    is_high_value=False,
    needs_disassembly=False,
):
    return DetectedContentItem(
        name=name,
        category=category,
        size=size,
        weight=weight,
        quantity=quantity,
        is_fragile=is_fragile,
        is_high_value=is_high_value,
        needs_disassembly=needs_disassembly,
    )


# ── Non-boxable detection ────────────────────────────────────────────────────

class TestIsNonBoxable:
    def test_large_furniture_is_non_boxable(self):
        item = _item(name="Sofa", category="Furniture", size="XL")
        assert _is_non_boxable(item) is True

    def test_medium_furniture_is_boxable(self):
        item = _item(name="Small Shelf", category="Furniture", size="M")
        assert _is_non_boxable(item) is False

    def test_large_appliance_is_non_boxable(self):
        item = _item(name="Refrigerator", category="Appliances", size="XXL")
        assert _is_non_boxable(item) is True

    def test_small_appliance_is_boxable(self):
        item = _item(name="Toaster", category="Appliances", size="S")
        assert _is_non_boxable(item) is False

    def test_disassembly_makes_non_boxable(self):
        item = _item(name="Bed Frame", category="Furniture", size="M", needs_disassembly=True)
        assert _is_non_boxable(item) is True

    def test_heavy_large_is_non_boxable(self):
        item = _item(name="Safe", category="Other", size="L", weight="extra_heavy")
        assert _is_non_boxable(item) is True

    def test_light_small_is_boxable(self):
        item = _item(name="Pen", category="Other", size="XS", weight="light")
        assert _is_non_boxable(item) is False

    def test_large_sports_is_non_boxable(self):
        item = _item(name="Treadmill", category="Sports", size="XL")
        assert _is_non_boxable(item) is True

    def test_small_sports_is_boxable(self):
        item = _item(name="Baseball Glove", category="Sports", size="S")
        assert _is_non_boxable(item) is False


# ── Non-boxable item conversion ──────────────────────────────────────────────

class TestToNonBoxableItem:
    def test_large_furniture_type(self):
        item = _item(name="Dining Table", category="Furniture", size="XL", weight="heavy")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "furniture_large"
        assert nb.volume.value == "large"  # XL → large
        assert nb.weight.value == "heavy"
        assert nb.name == "Dining Table"

    def test_medium_furniture_type(self):
        item = _item(name="Dresser", category="Furniture", size="L")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "furniture_large"  # L furniture = large
        assert nb.volume.value == "large"

    def test_large_appliance_type(self):
        item = _item(name="Washer", category="Appliances", size="L")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "appliance_large"

    def test_piano_detected_as_instrument(self):
        item = _item(name="Grand Piano", category="Furniture", size="XXL", weight="extra_heavy")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "instruments"
        assert nb.volume.value == "xlarge"

    def test_pool_table_detected_as_specialty(self):
        item = _item(name="Pool Table", category="Furniture", size="XXL")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "specialty"

    def test_grill_detected_as_outdoor(self):
        item = _item(name="Gas Grill", category="Other", size="L", weight="heavy")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "outdoor"

    def test_unknown_category_becomes_custom(self):
        # Use a name that doesn't match any specialty keyword patterns
        item = _item(name="Industrial Pump", category="Other", size="L", weight="heavy")
        nb = _to_non_boxable_item(item)
        assert nb.type.value == "custom"
        assert nb.custom_type_name == "Industrial Pump"

    def test_disassembly_flag_propagated(self):
        item = _item(name="Bed Frame", category="Furniture", size="L", needs_disassembly=True)
        nb = _to_non_boxable_item(item)
        assert nb.needs_disassembly is True

    def test_high_value_large_gets_crating(self):
        item = _item(name="Antique Armoire", category="Furniture", size="XL", is_high_value=True)
        nb = _to_non_boxable_item(item)
        assert nb.needs_crating is True

    def test_protection_materials_assigned(self):
        item = _item(name="Sofa", category="Furniture", size="XL")
        nb = _to_non_boxable_item(item)
        assert len(nb.protection) > 0
        assert "blanket" in nb.protection

    def test_quantity_preserved(self):
        item = _item(name="Dining Chair", category="Furniture", size="L", quantity=6)
        nb = _to_non_boxable_item(item)
        assert nb.quantity == 6


# ── Box classification ───────────────────────────────────────────────────────

class TestBoxClassification:
    def test_books_go_to_small_boxes(self):
        items = [_item(name="Books", category="Books", size="S", quantity=30)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["small"] == 2  # 30 / 15 = 2

    def test_fragile_kitchenware_to_dish_pack(self):
        items = [_item(name="Dishes", category="Kitchenware", size="S",
                       quantity=24, is_fragile=True)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["dish_pack"] == 2  # 24 / 12 = 2

    def test_clothing_to_wardrobe(self):
        items = [_item(name="Suits", category="Clothing", size="M", quantity=40)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["wardrobe"] == 2  # 40 / 20 = 2

    def test_artwork_to_picture_box(self):
        items = [_item(name="Painting", category="Artwork", size="M", quantity=3)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["picture"] == 2  # 3 / 2 = 1.5 → 2

    def test_general_medium_to_medium_box(self):
        items = [_item(name="Toys", category="Other", size="M", quantity=8)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["medium"] >= 1

    def test_general_small_to_small_box(self):
        items = [_item(name="Small Items", category="Other", size="XS", quantity=5)]
        result = classify_items_for_packout(items, "detailed")
        assert result["box_counts"]["small"] >= 1


# ── Full classification ──────────────────────────────────────────────────────

class TestClassifyItemsForPackout:
    def test_mixed_items_split_correctly(self):
        items = [
            _item(name="Sofa", category="Furniture", size="XL"),
            _item(name="Refrigerator", category="Appliances", size="XXL"),
            _item(name="Books", category="Books", size="S", quantity=15),
            _item(name="Dishes", category="Kitchenware", size="S", quantity=12, is_fragile=True),
        ]
        result = classify_items_for_packout(items, "detailed")

        # 2 non-boxable items (sofa + fridge)
        assert len(result["non_boxable_items"]) == 2
        assert result["lump_large_item_count"] == 2

        # Books → 1 small box, Dishes → 1 dish_pack
        assert result["box_counts"]["small"] == 1
        assert result["box_counts"]["dish_pack"] == 1

        # Blankets from non-boxable protection
        assert result["blanket_count"] >= 2

    def test_lump_sum_mode_no_itemized(self):
        items = [
            _item(name="Sofa", category="Furniture", size="XL"),
            _item(name="Table", category="Furniture", size="L"),
        ]
        result = classify_items_for_packout(items, "lump_sum")

        # Lump sum: no itemized list
        assert result["non_boxable_items"] == []
        assert result["lump_large_item_count"] == 2

    def test_floor_coverage_scales(self):
        # Single small item → low coverage
        items_small = [_item(name="Stool", category="Furniture", size="S")]
        result_small = classify_items_for_packout(items_small, "detailed", room_size="large")

        # Many large items → high coverage
        items_large = [
            _item(name="Sofa", category="Furniture", size="XXL", quantity=3),
            _item(name="Table", category="Furniture", size="XL", quantity=2),
            _item(name="Bookcase", category="Furniture", size="XL", quantity=2),
        ]
        result_large = classify_items_for_packout(items_large, "detailed", room_size="large")

        assert result_large["estimated_floor_coverage_pct"] > result_small["estimated_floor_coverage_pct"]

    def test_empty_items_returns_zeros(self):
        result = classify_items_for_packout([], "detailed")
        assert result["lump_large_item_count"] == 0
        assert all(v == 0 for v in result["box_counts"].values())
        assert result["blanket_count"] == 0
        assert result["estimated_floor_coverage_pct"] == 0

    def test_floor_coverage_capped_at_100(self):
        # Tons of huge items in a small room
        items = [_item(name="Sofa", category="Furniture", size="XXL", quantity=20)]
        result = classify_items_for_packout(items, "detailed", room_size="small")
        assert result["estimated_floor_coverage_pct"] <= 100.0


# ── Protection materials ─────────────────────────────────────────────────────

class TestProtectionMaterials:
    def test_all_types_have_protection_map(self):
        for type_key in [
            "furniture_large", "furniture_medium", "appliance_large",
            "appliance_small", "outdoor", "garage", "specialty",
            "sports", "instruments", "rugs_art", "custom",
        ]:
            assert type_key in PROTECTION_MAP
            assert "blanket" in PROTECTION_MAP[type_key]

    def test_specialty_has_extra_protection(self):
        spec = PROTECTION_MAP["specialty"]
        assert spec["blanket"] >= 2
        assert "corner_protector" in spec
