"""
Pins every packing price migration's target values to the price table.

A migration whose targets have fallen behind the table is worse than no
migration: it runs once, writes stale prices into every seeded company, and
alembic will never re-run it to correct them.  That is exactly how the 2026
increase failed to reach the deployed environment -- the resync migration
shipped with the pre-increase prices, ran, and stamped itself done.
"""
import re
from pathlib import Path

import pytest

from app.domains.tools.modules.packing.seed import DEFAULT_MOVING_PRICES
from app.domains.tools.modules.packing.service import DEFAULT_PRICES

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
PRICE_MIGRATIONS = [
    "resync_moving_line_item_prices.py",
    "apply_2026_packing_price_increase.py",
]
# (code, from, to) rows in the migrations' correction tables.
ROW_RE = re.compile(r'^    \("(\d+[A-Z]?)", ([\d.]+), ([\d.]+)\),', re.M)


def _table() -> dict:
    return {d["code"]: d["price"] for d in DEFAULT_MOVING_PRICES}


def _rows(filename: str):
    return [
        (m.group(1), float(m.group(2)), float(m.group(3)))
        for m in ROW_RE.finditer((VERSIONS_DIR / filename).read_text(encoding="utf-8"))
    ]


@pytest.mark.parametrize("filename", PRICE_MIGRATIONS)
def test_migration_targets_match_price_table(filename):
    """Every migration target must equal the current seeded price."""
    table = _table()
    for code, _old, new in _rows(filename):
        assert code in table, f"{filename}: code {code} is not in the price table"
        assert new == pytest.approx(table[code], abs=0.005), (
            f"{filename}: {code} targets {new} but the price table says "
            f"{table[code]} — a company migrated by this would hold a stale price"
        )


@pytest.mark.parametrize("filename", PRICE_MIGRATIONS)
def test_migration_rows_are_not_noops(filename):
    """A row whose from == to silently does nothing; drop it instead."""
    for code, old, new in _rows(filename):
        assert abs(old - new) > 0.005, f"{filename}: {code} is a no-op row"


@pytest.mark.parametrize("filename", PRICE_MIGRATIONS)
def test_migration_addresses_each_code_once(filename):
    codes = [c for c, _, _ in _rows(filename)]
    assert len(codes) == len(set(codes)), f"{filename}: duplicate code rows"


def test_increase_migration_covers_every_repriced_code():
    """Any code whose price moved must be carried to existing companies."""
    table = _table()
    resync = {c: n for c, _o, n in _rows("resync_moving_line_item_prices.py")}
    covered = {c for c, _o, _n in _rows("apply_2026_packing_price_increase.py")}
    # Codes the resync migration wrote at a value the table has since moved past.
    stale = {
        code for code, written in resync.items()
        if abs(written - table[code]) > 0.005
    }
    assert not (stale - covered), (
        "codes left at a stale price in already-migrated companies: "
        f"{sorted(stale - covered)}"
    )


def test_price_tables_agree():
    """Guards the invariant both migrations are written against."""
    table = _table()
    for code, price in table.items():
        assert DEFAULT_PRICES[code]["price"] == pytest.approx(price, abs=0.0001)
