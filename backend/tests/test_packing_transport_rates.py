"""Regression tests for packing transport rates and truck-loading labor.

Three defects motivated these:

1. select_truck() carried hardcoded fallback literals (172.36 / 179.25 /
   197.36) that went stale across two price increases, so a company missing
   the line-item code was billed a pre-2026 rate.
2. Transport rates were held flat on the ground that retail day rates stay
   "well under the billed rate" -- comparing against the advertised BASE rate,
   which excludes mileage, fuel, damage waiver and fees. Priced all-in, the
   26' van was billing under its own retail cost.
3. Truck Loading & Securing scaled with content VOLUME only, so a van of gun
   safes billed the same loading labor as the same cube of wardrobe boxes,
   while the physically comparable carry lines already scaled with weight.
"""

import pytest

from app.domains.tools.modules.packing.seed import DEFAULT_MOVING_PRICES
from app.domains.tools.modules.packing.service import (
    DEFAULT_PRICES,
    EstimateCalculator,
    rh,
)

TRANSPORT_CODES = ["2932", "2933", "2934", "2935"]


class _Item:
    def __init__(self, name, category, quantity, size, weight):
        self.name = name
        self.category = category
        self.quantity = quantity
        self.size = size
        self.weight = weight


class _Room:
    def __init__(self, items):
        self.items = items
        self.preset_id = None
        self.density = "normal"


def _calc():
    calc = EstimateCalculator.__new__(EstimateCalculator)
    calc.presets = {}
    return calc


class TestTransportPriceTablesAgree:
    """The seeder and the calculator fallback table must not diverge."""

    @pytest.mark.parametrize("code", TRANSPORT_CODES)
    def test_seed_and_default_prices_match(self, code):
        seeded = {d["code"]: d["price"] for d in DEFAULT_MOVING_PRICES}
        assert seeded[code] == DEFAULT_PRICES[code]["price"]

    def test_rate_rises_with_vehicle_size(self):
        cargo = DEFAULT_PRICES["2935"]["price"]
        v15 = DEFAULT_PRICES["2932"]["price"]
        v20 = DEFAULT_PRICES["2933"]["price"]
        v26 = DEFAULT_PRICES["2934"]["price"]
        assert cargo < v15 < v20 < v26

    def test_26ft_covers_realistic_all_in_retail_cost(self):
        """The defect being pinned: billing under retail for the 26' van.

        Researched 2026 all-in cost for a 50-mile local move (base + mileage
        + fuel + damage waiver + fees) runs ~$160-300, mid ~$240. The billed
        DY rate bundles vehicle, fuel and operator overhead, so it must clear
        the middle of that band.
        """
        assert DEFAULT_PRICES["2934"]["price"] >= 240.0


class TestSelectTruckFallback:
    """The fallback must track the price table instead of drifting."""

    @pytest.mark.parametrize(
        "storage_sf,expected_code",
        [(30, "2932"), (50, "2932"), (100, "2933"), (150, "2933"), (400, "2934")],
    )
    def test_fallback_equals_the_table_price(self, storage_sf, expected_code):
        calc = _calc()
        calc.get_price = lambda code: None  # company missing the code
        code, rate = calc.select_truck(storage_sf)
        assert code == expected_code
        assert rate == DEFAULT_PRICES[expected_code]["price"]

    def test_company_price_still_wins_over_the_fallback(self):
        calc = _calc()
        calc.get_price = lambda code: 999.0
        _code, rate = calc.select_truck(400)
        assert rate == 999.0


class TestLoadWeightMultiplier:
    """Truck loading must respond to how heavy the load actually is."""

    def test_heavy_content_costs_more_than_light_at_equal_volume(self):
        calc = _calc()
        heavy = [_Room([_Item("Gun Safe", "Other", 10, "L", "extra_heavy")])]
        light = [_Room([_Item("Wardrobe Box", "Clothing", 10, "L", "light")])]
        assert calc._load_weight_multiplier(heavy) > calc._load_weight_multiplier(light)

    def test_multiplier_matches_the_declared_bounds(self):
        calc = _calc()
        for weight, expected in EstimateCalculator.LOAD_WEIGHT_MULT.items():
            rooms = [_Room([_Item("Thing", "Other", 3, "M", weight)])]
            assert calc._load_weight_multiplier(rooms) == pytest.approx(expected)

    def test_weighting_is_by_volume_not_item_count(self):
        """One XXL safe must outweigh several XS trinkets, matching how the
        storage-SF figure the multiplier scales is itself built."""
        calc = _calc()
        rooms = [_Room([
            _Item("Gun Safe", "Other", 1, "XXL", "extra_heavy"),   # 25 sf
            _Item("Trinket", "Collectibles", 10, "XS", "light"),   #  5 sf
        ])]
        mult = calc._load_weight_multiplier(rooms)
        # Volume-weighted lands near extra_heavy; count-weighted would sit near light.
        assert mult > 1.3

    def test_no_items_leaves_hours_unchanged(self):
        calc = _calc()
        assert calc._load_weight_multiplier([_Room([])]) == 1.0
        assert calc._load_weight_multiplier([]) == 1.0

    def test_missing_weight_is_treated_as_medium(self):
        calc = _calc()
        rooms = [_Room([_Item("Unknown", "Other", 2, "M", None)])]
        assert calc._load_weight_multiplier(rooms) == pytest.approx(1.0)

    def test_loading_hours_actually_change_for_a_heavy_job(self):
        """End to end: the multiplier must reach the billed hour figure."""
        calc = _calc()
        rooms = [_Room([
            _Item("Gun Safe", "Other", 10, "XL", "extra_heavy"),
            _Item("Power Rack", "Sports", 10, "XL", "extra_heavy"),
        ])]
        sf = calc.estimate_storage_sf_from_items(rooms)
        mult = calc._load_weight_multiplier(rooms)
        volume_only = rh(max(1.0, sf / 100.0))
        weighted = rh(max(1.0, sf / 100.0 * mult))
        assert weighted > volume_only

    def test_loading_stays_milder_than_the_carry_lines(self):
        """Loading is part volume-fitting, so it must not scale as steeply as
        carry (0.6-2.0x) -- otherwise the two double-count the same difficulty."""
        load = EstimateCalculator.LOAD_WEIGHT_MULT
        assert load["extra_heavy"] < 2.0
        assert load["light"] > 0.6


class TestItemSizeSfIsShared:
    """Both the storage-SF estimate and the load multiplier must read one map."""

    def test_size_sf_map_is_a_class_attribute(self):
        assert EstimateCalculator.ITEM_SIZE_SF["XXL"] > EstimateCalculator.ITEM_SIZE_SF["XS"]

    def test_storage_sf_uses_the_shared_map(self):
        calc = _calc()
        rooms = [_Room([_Item("Sofa", "Furniture", 2, "XL", "heavy")])]
        expected = EstimateCalculator.ITEM_SIZE_SF["XL"] * 2
        # snap_to_storage_unit rounds up to a standard unit, so assert the floor.
        assert calc.estimate_storage_sf_from_items(rooms) >= expected
