"""
Price tables that can be read through a price book.

The bathroom and cabinet calculators read their prices from module-level
tables in pricing.py, and those tables hold the default prices. A company
may change any price, its material and labor apart, and an estimate is
pinned to the prices in force when it was first priced (a price book), so
neither a later default update nor a company edit moves it.

The calculators don't take prices as an argument; they read the tables as
they always have. While `use_prices(values)` is active, every read of a
price in a wrapped table returns that price book's figure instead of the
default. Outside it a table reads as its defaults, so nothing that only
wants the defaults (the option lists, the tests) has to know about books.

A price book maps a price's path ("DEMO_RATES.floor_tile_per_sf",
"VANITY_PRICES.stock_rta.24", or a bare constant name such as
"VANITY_INSTALL") to its [material, labor]. The calculator reads their sum;
`material_share` gives the material side's share for a line priced from
one mixed price.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Iterator, Mapping, Optional, Sequence, Tuple

# path -> (material, labor), or None outside a calculation
_ACTIVE: ContextVar[Optional[Dict[str, Tuple[float, float]]]] = ContextVar(
    "unit_prices_active", default=None,
)


def join(path: str, key: Any) -> str:
    """A price's path: its table's path and its key, dot-separated."""
    key = str(key)
    if "." in key:
        raise ValueError(f"A price key can't contain '.': {key!r}")
    return f"{path}.{key}" if path else key


def is_price_value(value: Any) -> bool:
    """A number a price book can replace (bools are flags, not prices)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def total(pair: Sequence[float]) -> float:
    """Material plus labor, rounded clear of float noise so a default split
    back together is the default figure exactly."""
    return round(float(pair[0]) + float(pair[1]), 6)


class PriceDict(dict):
    """A price table that answers from the active price book.

    A dict subclass so code that checks for a dict, or iterates one, keeps
    working. Reads through [], get(), items() and values() see the book;
    nested tables are PriceDicts too, each knowing its path.
    """

    __slots__ = ("path",)

    def __init__(self, path: str, data: Mapping[Any, Any]):
        super().__init__()
        self.path = path
        for key, value in data.items():
            if isinstance(value, Mapping) and not isinstance(value, PriceDict):
                value = PriceDict(join(path, key), value)
            dict.__setitem__(self, key, value)

    def _read(self, key: Any, value: Any) -> Any:
        if not is_price_value(value):
            return value
        active = _ACTIVE.get()
        if active:
            pair = active.get(join(self.path, key))
            if pair is not None:
                return total(pair)
        return value

    def __getitem__(self, key: Any) -> Any:
        return self._read(key, dict.__getitem__(self, key))

    def get(self, key: Any, default: Any = None) -> Any:
        if dict.__contains__(self, key):
            return self[key]
        return default

    def items(self):  # type: ignore[override]
        return [(key, self[key]) for key in dict.keys(self)]

    def values(self):  # type: ignore[override]
        return [self[key] for key in dict.keys(self)]

    def default(self, key: Any) -> Any:
        """The default figure, whatever book is active."""
        return dict.__getitem__(self, key)

    def __reduce__(self):
        # Copies (deepcopy, pickle) are plain dicts of the defaults: a copy is
        # data, not a live view of a book.
        return (dict, (dict(dict.items(self)),))


def price_leaves(table: PriceDict) -> Iterator[Tuple[str, Tuple[Any, ...], float]]:
    """Every number in a table: (path, keys below the table, default)."""

    def walk(node: PriceDict, keys: Tuple[Any, ...]):
        for key in dict.keys(node):
            value = dict.__getitem__(node, key)
            if isinstance(value, PriceDict):
                yield from walk(value, keys + (key,))
            elif is_price_value(value):
                yield join(node.path, key), keys + (key,), value

    yield from walk(table, ())


@contextmanager
def use_prices(values: Optional[Mapping[str, Sequence[float]]]):
    """Read every wrapped table through `values` (path -> [material, labor])
    until the block ends. None or empty reads the defaults."""
    book = {path: (float(pair[0]), float(pair[1])) for path, pair in (values or {}).items()}
    token = _ACTIVE.set(book or None)
    try:
        yield
    finally:
        _ACTIVE.reset(token)


def material_share(path: str, default: float) -> float:
    """The material side's share of one price, from the active book.

    For a line priced from that price alone, so its material/labor split
    follows what the company entered. Falls back to `default` (what the
    calculator used before price books) when no book is active, the book
    doesn't have the price, or the price is zero.
    """
    active = _ACTIVE.get()
    if not active:
        return default
    pair = active.get(path)
    if pair is None:
        return default
    whole = total(pair)
    if whole <= 0:
        return default
    return round(pair[0] / whole, 4)


def resolved(value: Any) -> Any:
    """A copy with every PriceDict turned into a plain dict of the figures
    the active book gives, for a response serialized after the block ends."""
    if isinstance(value, Mapping):  # a PriceDict's items() read the book
        return {key: resolved(item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolved(item) for item in value]
    return value
