"""
Which numbers in a pricing module are prices, and what each one is.

A domain's pricing.py lists its price tables (TableSpec) and calls
`install` at the bottom, which wraps those tables so a price book can
answer for them (tables.PriceDict). Everything not listed - multipliers,
waste, tax, zip factors, permit rules, sizes - stays plain code and is not
something a company prices.

Each price is material, labor, or both. A price that is both is split by
the material share the calculator already uses for its line, so the
defaults shown on the price screen add back up to the code's figure.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple

from .tables import PriceDict, is_price_value, price_leaves

MATERIAL = "material"
LABOR = "labor"
MIXED = "mixed"
KINDS = (MATERIAL, LABOR, MIXED)


@dataclass(frozen=True)
class TableSpec:
    """A table (or, with scalar=True, a module constant) of prices."""

    name: str
    group: str
    kind: str = MIXED
    # Put before every label of the table ("Filler · Stock")
    title: str = ""
    # Material share of a mixed price
    share: float = 0.0
    # Blank: read off the key (per_sf -> SF, per_lf -> LF), else EA
    unit: str = ""
    scalar: bool = False
    # Paths below the table ("waste_factor", "small.label") that aren't prices
    skip: Tuple[str, ...] = ()
    # A zero here means "priced elsewhere", not a price
    skip_zero: bool = False
    # Per price, looked up by the path below the table, then its last key,
    # then its first key
    kinds: Mapping[str, str] = field(default_factory=dict)
    shares: Mapping[str, float] = field(default_factory=dict)
    groups: Mapping[str, str] = field(default_factory=dict)
    units: Mapping[str, str] = field(default_factory=dict)
    labels: Mapping[str, str] = field(default_factory=dict)
    # How a number key reads ('{}"' for a width in inches); by parent key
    size_format: str = '{}"'
    size_formats: Mapping[str, str] = field(default_factory=dict)
    note: str = ""


@dataclass(frozen=True)
class PriceItem:
    key: str
    group: str
    table: str
    label: str
    unit: str
    kind: str
    material: float
    labor: float
    note: str = ""

    @property
    def total(self) -> float:
        return round(self.material + self.labor, 6)


@dataclass
class Domain:
    key: str
    label: str
    specs: List[TableSpec]
    tables: Dict[str, PriceDict]
    flat: Optional[PriceDict]
    _items: Optional[List[PriceItem]] = None

    def items(self) -> List[PriceItem]:
        if self._items is None:
            self._items = list(_build_items(self))
        return self._items

    def item_map(self) -> Dict[str, PriceItem]:
        return {item.key: item for item in self.items()}

    def default_values(self) -> Dict[str, Tuple[float, float]]:
        return {item.key: (item.material, item.labor) for item in self.items()}


_DOMAINS: Dict[str, Domain] = {}

# Constants that aren't in a table live together in one, keyed by name
FLAT_TABLE = "FLAT_PRICES"


def install(domain: str, label: str, namespace: MutableMapping[str, Any], specs: Sequence[TableSpec]) -> None:
    """Wrap a pricing module's price tables in place.

    Called at the bottom of pricing.py with globals(): every listed table
    is replaced by a PriceDict of the same data, so whatever imports it
    from pricing.py reads through the active price book. Module constants
    (scalar specs) are gathered into FLAT_PRICES, which the calculator
    reads instead of the bare constant.
    """
    tables: Dict[str, PriceDict] = {}
    flat: Dict[str, Any] = {}
    for spec in specs:
        if spec.kind not in KINDS:
            raise ValueError(f"{domain}.{spec.name}: unknown kind {spec.kind!r}")
        value = namespace[spec.name]
        if spec.scalar:
            if not is_price_value(value):
                raise ValueError(f"{domain}.{spec.name} is not a number")
            flat[spec.name] = value
            continue
        table = value if isinstance(value, PriceDict) else PriceDict(spec.name, value)
        namespace[spec.name] = table
        tables[spec.name] = table
    flat_table = PriceDict("", flat) if flat else None
    if flat_table is not None:
        namespace[FLAT_TABLE] = flat_table
    _DOMAINS[domain] = Domain(domain, label, list(specs), tables, flat_table)


def get_domain(domain: str) -> Domain:
    _load_domains()
    try:
        return _DOMAINS[domain]
    except KeyError:
        raise KeyError(f"No price catalog for {domain!r}") from None


def domains() -> List[Domain]:
    _load_domains()
    return list(_DOMAINS.values())


def _load_domains() -> None:
    # Importing a pricing module installs its tables
    from app.domains.tools.modules.bathroom_estimate import pricing as _bathroom  # noqa: F401
    from app.domains.tools.modules.cabinet_estimate import pricing as _cabinet  # noqa: F401


# ── Items ──

_WORDS = {
    "sf": "SF", "lf": "LF", "rta": "RTA", "otr": "OTR", "aav": "AAV", "dw": "DW",
    "gfci": "GFCI", "lvt": "LVT", "spc": "SPC", "pvc": "PVC", "mdf": "MDF",
    "led": "LED", "ss": "SS", "rr": "R&R", "dc": "DC", "cfm": "CFM", "tp": "TP",
    "rrp": "RRP", "hp": "HP", "ea": "EA", "lvp": "LVP",
}


def humanize(key: str) -> str:
    words = [_WORDS.get(w, w) for w in str(key).split("_") if w]
    if not words:
        return str(key)
    first = words[0]
    words[0] = first if first.isupper() else first[:1].upper() + first[1:]
    return " ".join(words)


def _lookup(table: Mapping[str, Any], keys: Tuple[Any, ...], default: Any) -> Any:
    names = [".".join(str(k) for k in keys), str(keys[-1]), str(keys[0])]
    for name in names:
        if name in table:
            return table[name]
    return default


_UNIT_PATTERNS = (
    (re.compile(r"(^|_)(per_)?sf($|_)"), "SF"),
    (re.compile(r"(^|_)(per_)?lf($|_)"), "LF"),
    (re.compile(r"hourly|(^|_)per_hr($|_)"), "HR"),
)


def _unit(spec: TableSpec, keys: Tuple[Any, ...]) -> str:
    explicit = _lookup(spec.units, keys, None) if keys else None
    if explicit:
        return explicit
    text = "_".join(str(k) for k in keys if isinstance(k, str)) or spec.name.lower()
    for pattern, unit in _UNIT_PATTERNS:
        if pattern.search(text):
            return unit
    return spec.unit or "EA"


def _label(spec: TableSpec, keys: Tuple[Any, ...]) -> str:
    if spec.scalar:
        return spec.labels.get(spec.name) or humanize(spec.name.lower())
    parts = []
    parent = None
    for key in keys:
        if isinstance(key, str):
            parts.append(spec.labels.get(key) or humanize(key))
        else:
            fmt = spec.size_formats.get(str(parent), spec.size_format)
            parts.append(fmt.format(key))
        parent = key
    if spec.title:
        parts.insert(0, spec.title)
    return " · ".join(parts)


def _split(value: float, kind: str, share: float) -> Tuple[float, float]:
    if kind == MATERIAL:
        return float(value), 0.0
    if kind == LABOR:
        return 0.0, float(value)
    # Not rounded to cents: a small price (0.95 at 15%) would come back with
    # another share, and the line split would move with no price changed
    material = value * share
    return material, value - material


def _build_items(domain: Domain) -> Iterable[PriceItem]:
    for spec in domain.specs:
        if spec.scalar:
            value = dict.__getitem__(domain.flat, spec.name)
            mat, lab = _split(value, spec.kind, spec.share)
            yield PriceItem(
                key=spec.name, group=spec.group, table=spec.name,
                label=_label(spec, ()), unit=spec.unit or "EA", kind=spec.kind,
                material=mat, labor=lab, note=spec.note,
            )
            continue
        table = domain.tables[spec.name]
        for path, keys, value in price_leaves(table):
            rel = ".".join(str(k) for k in keys)
            if rel in spec.skip or any(str(k) in spec.skip for k in keys):
                continue
            if spec.skip_zero and not value:
                continue
            kind = _lookup(spec.kinds, keys, spec.kind)
            share = _lookup(spec.shares, keys, spec.share)
            mat, lab = _split(value, kind, share)
            yield PriceItem(
                key=path, group=_lookup(spec.groups, keys, spec.group), table=spec.name,
                label=_label(spec, keys), unit=_unit(spec, keys), kind=kind,
                material=mat, labor=lab, note=spec.note,
            )

