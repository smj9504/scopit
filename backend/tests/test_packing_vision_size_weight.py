"""Regression tests for AI-analyzed item size/weight classes.

The vision tool read `size`/`weight` off each analyzed item, but the LIVE tool
schema never declared them, so Claude never returned them. Every analyzed item
came back size=None/weight=None and the UI showed its hardcoded "M"/"medium"
fallback for a grand piano and a lampshade alike.

PASS1_TOOL is the only schema actually sent to the API (see the single
`tools=[...]` call site in vision.py); PASS2_TOOL is currently unused, so
asserting on it would not protect the real behavior.
"""

import inspect

from app.domains.tools.modules.packing.service import EstimateCalculator
from app.domains.tools.modules.packing.vision import (
    ITEM_SIZE_VALUES,
    ITEM_WEIGHT_VALUES,
    PASS1_TOOL,
    _build_room_analysis_response,
    _clean_class,
    _merge_duplicate_items,
)
from app.domains.tools.modules.packing import vision as vision_module

PASS1_ITEM = PASS1_TOOL["input_schema"]["properties"]["items"]["items"]


class TestLiveSchemaExposesSizeAndWeight:
    """The model can only return fields the tool schema it is sent declares."""

    def test_size_and_weight_are_declared_on_pass1(self):
        props = PASS1_ITEM["properties"]
        assert "size" in props, "size missing from PASS1 -> AI never returns it"
        assert "weight" in props, "weight missing from PASS1 -> AI never returns it"

    def test_enums_match_the_canonical_constants(self):
        props = PASS1_ITEM["properties"]
        assert props["size"]["enum"] == ITEM_SIZE_VALUES
        assert props["weight"]["enum"] == ITEM_WEIGHT_VALUES

    def test_both_fields_are_required_on_pass1(self):
        required = PASS1_ITEM["required"]
        assert "size" in required
        assert "weight" in required

    def test_the_schema_under_test_is_the_one_actually_sent(self):
        """Guard against the fix drifting onto an unused schema.

        If the live call ever stops using PASS1_TOOL, these assertions are
        protecting dead code and must be repointed.
        """
        src = inspect.getsource(vision_module)
        assert "tools=[PASS1_TOOL]" in src, (
            "PASS1_TOOL is no longer the schema sent to the API; "
            "repoint these tests at the live schema."
        )


class TestCleanClass:
    """Normalization salvages case variants and rejects out-of-enum values."""

    def test_exact_values_pass_through(self):
        assert _clean_class("XL", ITEM_SIZE_VALUES) == "XL"
        assert _clean_class("extra_heavy", ITEM_WEIGHT_VALUES) == "extra_heavy"

    def test_case_and_whitespace_variants_are_salvaged(self):
        assert _clean_class("xl", ITEM_SIZE_VALUES) == "XL"
        assert _clean_class("  XXL  ", ITEM_SIZE_VALUES) == "XXL"
        assert _clean_class("Extra_Heavy", ITEM_WEIGHT_VALUES) == "extra_heavy"

    def test_out_of_enum_values_become_none(self):
        # None (not a bogus class) so rule-based inference can backfill.
        assert _clean_class("huge", ITEM_SIZE_VALUES) is None
        assert _clean_class("very heavy", ITEM_WEIGHT_VALUES) is None

    def test_non_string_input_becomes_none(self):
        assert _clean_class(None, ITEM_SIZE_VALUES) is None
        assert _clean_class(5, ITEM_SIZE_VALUES) is None


class TestParsePathPreservesClasses:
    """End-to-end: a raw AI result must reach the response with classes intact."""

    @staticmethod
    def _raw(**overrides):
        item = {
            "name": "Sectional Sofa", "category": "Furniture", "quantity": 1,
            "is_high_value": False, "is_fragile": False, "confidence": 0.95,
            "size": "XL", "weight": "heavy",
        }
        item.update(overrides)
        return {"items": [item], "density": "normal",
                "room_size": "large", "confidence": 0.9}

    def _first_item(self, raw):
        resp = _build_room_analysis_response(raw, "Living Room")
        items = list(resp.items) + list(getattr(resp, "uncertain_items", []) or [])
        assert items, "item was dropped during parsing"
        return items[0]

    def test_valid_classes_survive_parsing(self):
        item = self._first_item(self._raw())
        assert item.size == "XL"
        assert item.weight == "heavy"

    def test_case_variants_are_normalized_during_parsing(self):
        item = self._first_item(self._raw(size="xl", weight="HEAVY"))
        assert item.size == "XL"
        assert item.weight == "heavy"

    def test_garbage_classes_become_none_not_bogus_values(self):
        item = self._first_item(self._raw(size="enormous", weight="very heavy"))
        assert item.size is None
        assert item.weight is None

    def test_merge_preserves_size_and_weight(self):
        merged = _merge_duplicate_items([
            {"name": "Sofa", "quantity": 1, "size": "XL",
             "weight": "heavy", "confidence": 0.9},
            {"name": "sofa", "quantity": 2, "size": "XL",
             "weight": "heavy", "confidence": 0.8},
        ])
        assert merged[0]["size"] == "XL"
        assert merged[0]["weight"] == "heavy"
        assert merged[0]["quantity"] == 3


class TestInferenceBackstop:
    """If the AI omits size/weight, inference must still differentiate items."""

    @staticmethod
    def _infer(category, name):
        return EstimateCalculator._infer_size_weight(
            EstimateCalculator, category, name
        )

    def test_heavy_specialty_items_are_not_flattened_to_medium(self):
        assert self._infer("Furniture", "Grand Piano") == ("XXL", "extra_heavy")
        assert self._infer("Sports", "Treadmill") == ("L", "extra_heavy")
        assert self._infer("Appliances", "Refrigerator") == ("L", "extra_heavy")

    def test_small_light_items_are_not_flattened_to_medium(self):
        assert self._infer("Furniture", "Table Lamp") == ("S", "light")
        assert self._infer("Fragile", "Wine Glasses") == ("S", "light")

    def test_bundled_misc_items_infer_a_sane_default(self):
        # _bundle_trivial_items synthesizes this item without size/weight, so
        # inference must supply them. The "miscellaneous" override gives light
        # rather than the Other-category default of medium, which is right for
        # a box of small odds and ends.
        assert self._infer("Other", "Miscellaneous Small Items") == ("M", "light")

    def test_inferred_classes_are_always_valid_enum_members(self):
        for category, name in [
            ("Furniture", "Grand Piano"),
            ("Furniture", "3-Section Sectional Sofa"),
            ("Books", "Hardcover Books"),
            ("Other", "Unlabeled Box"),
        ]:
            size, weight = self._infer(category, name)
            assert size in ITEM_SIZE_VALUES
            assert weight in ITEM_WEIGHT_VALUES
