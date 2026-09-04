"""
Tests that the packing tool's two price tables agree.

Prices reach an estimate by one of two paths:

  1. seed.DEFAULT_MOVING_PRICES is written into the LineItem table by
     seed_moving_line_items(), and EstimateCalculator._load_prices()
     reads it back from the database.
  2. For any code NOT in the database, _load_prices() falls back to
     service.DEFAULT_PRICES.

The fallback means an estimate is produced even when the seeder has
never run for a company — which is why the Moving Prices tab can be
empty while estimates still come out with real numbers.

The two tables had drifted badly: 32 of 34 shared codes disagreed, with
room rates differing by more than 2x (small room $74.52 vs $185.00).  So
the same rooms and the same inputs produced two different totals purely
depending on whether the seeder had been run.  These tests pin the tables
together so that stops being possible.
"""
from app.domains.tools.modules.packing.seed import (
    CATEGORY_MAP,
    DEFAULT_MOVING_PRICES,
)
from app.domains.tools.modules.packing.service import (
    DEFAULT_PRICES,
    MATERIAL_CODES,
)

# Codes the calculator reads at runtime: every material key, plus the
# labor/storage rates fetched by get_price(), the room rates reached
# through SIZE_TO_PRICE_CODE, the transport codes chosen by van size,
# and the storage-setup code exported by get_prices_dict().
LIVE_CODES = set(MATERIAL_CODES.values()) | {
    "2825",  # Content Manipulation (base labor)
    "2911",  # Supervisor/Admin
    "2912",  # Specialty Item Handler
    "2840",  # Climate-Controlled Storage (per SF)
    "2844",  # Padlock / storage setup
    "2833",  # Small room rate
    "2834",  # Large room rate
    "2835",  # Extra large room rate
    "2932",  # Moving Van 14'-15'
    "2933",  # Moving Van 16'-20'
    "2934",  # Moving Van 26'
}


def _seed_by_code():
    return {row["code"]: row for row in DEFAULT_MOVING_PRICES}


def test_seed_codes_are_unique():
    codes = [row["code"] for row in DEFAULT_MOVING_PRICES]
    assert len(codes) == len(set(codes)), "duplicate code in DEFAULT_MOVING_PRICES"


def test_tables_cover_the_same_codes():
    seed_codes = set(_seed_by_code())
    fallback_codes = set(DEFAULT_PRICES)

    assert not seed_codes - fallback_codes, (
        "seeded codes with no fallback entry: %s"
        % sorted(seed_codes - fallback_codes)
    )
    assert not fallback_codes - seed_codes, (
        "fallback codes that the seeder never writes, so they can never "
        "be edited from the Moving Prices tab: %s"
        % sorted(fallback_codes - seed_codes)
    )


def test_prices_match_between_tables():
    """The same code must cost the same whether or not the seeder has run."""
    seed = _seed_by_code()
    mismatched = {
        code: (row["price"], DEFAULT_PRICES[code]["price"])
        for code, row in seed.items()
        if code in DEFAULT_PRICES
        and abs(float(row["price"]) - float(DEFAULT_PRICES[code]["price"])) > 0.005
    }
    assert not mismatched, "price drift (seed, fallback): %s" % mismatched


def test_names_and_units_match_between_tables():
    seed = _seed_by_code()
    for code, row in seed.items():
        if code not in DEFAULT_PRICES:
            continue
        fallback = DEFAULT_PRICES[code]
        assert row["unit"] == fallback["unit"], (
            "unit drift on %s: %s vs %s" % (code, row["unit"], fallback["unit"])
        )
        assert row["name"] == fallback["name"], (
            "name drift on %s: %r vs %r" % (code, row["name"], fallback["name"])
        )


def test_every_live_code_is_priced():
    """A code the calculator reads must exist, or that line silently costs $0."""
    seed_codes = set(_seed_by_code())
    assert not LIVE_CODES - set(DEFAULT_PRICES), (
        "live codes missing from the fallback table: %s"
        % sorted(LIVE_CODES - set(DEFAULT_PRICES))
    )
    assert not LIVE_CODES - seed_codes, (
        "live codes the seeder never writes: %s" % sorted(LIVE_CODES - seed_codes)
    )


def test_no_zero_or_negative_prices():
    for row in DEFAULT_MOVING_PRICES:
        assert float(row["price"]) > 0, "non-positive price on %s" % row["code"]
    for code, row in DEFAULT_PRICES.items():
        assert float(row["price"]) > 0, "non-positive price on %s" % code


def test_seed_categories_are_known():
    for row in DEFAULT_MOVING_PRICES:
        assert row["category"] in CATEGORY_MAP, (
            "unknown category %r on %s" % (row["category"], row["code"])
        )


class TestSeededAndUnseededAgree:
    """An estimate must cost the same whether or not the seeder has run.

    _load_prices() reads the company's LineItem rows and then fills any
    missing code from DEFAULT_PRICES.  This drives the effective price of
    every code down both paths and asserts they land on the same number.
    """

    def _effective_prices(self, seeded: bool):
        from decimal import Decimal

        class FakeItem:
            def __init__(self, code, name, unit, price):
                self.code = code
                self.name = name
                self.unit = unit
                self.unit_price = Decimal(str(price))

        rows = []
        if seeded:
            rows = [
                FakeItem(r["code"], r["name"], r["unit"], r["price"])
                for r in DEFAULT_MOVING_PRICES
            ]

        # Mirror _load_prices(): DB rows first, then fallback fill.
        prices = {i.code: float(i.unit_price) for i in rows}
        for code, info in DEFAULT_PRICES.items():
            prices.setdefault(code, info["price"])
        return prices

    def test_same_prices_either_way(self):
        seeded = self._effective_prices(seeded=True)
        unseeded = self._effective_prices(seeded=False)

        assert set(seeded) == set(unseeded)
        differing = {
            code: (seeded[code], unseeded[code])
            for code in seeded
            if abs(seeded[code] - unseeded[code]) > 0.005
        }
        assert not differing, (
            "seeded vs unseeded price differences (this is the bug where an "
            "empty Moving Prices tab still produced a differently-priced "
            "estimate): %s" % differing
        )

    def test_every_live_code_resolves_without_seed(self):
        """With an empty Prices tab, no live code may fall through to $0."""
        unseeded = self._effective_prices(seeded=False)
        for code in sorted(LIVE_CODES):
            assert unseeded.get(code, 0) > 0, "code %s resolves to $0" % code
