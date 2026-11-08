"""
Mirrors over the vanity, counted and sized on their own.

A double vanity can have one wide mirror or a small one over each sink, so a
mirror isn't one per vanity. The mirrors are kept in accessories_spec.mirrors
as [{width, count}] (width in inches), filled from the sketch (each mirror
drawn on the plan) or typed on the estimate page.

Detach & reset is priced per mirror by its width (DETACH_RESET_COSTS
"mirror"): a wider mirror is heavier and past 48" takes two people to lift
off and hang back level.
"""

from typing import Any, Dict, List, Optional


def _num(v: Any) -> Optional[float]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _count(v: Any) -> int:
    try:
        return max(int(v), 0)
    except (TypeError, ValueError):
        return 1


def mirror_groups(estimate) -> List[Dict[str, Any]]:
    """The estimate's mirrors as [{width, count}], one per width, in the order they first appear.

    width is None when it isn't known. An estimate saved before mirrors were
    listed has one mirror per vanity, at the width the sketch gave that
    vanity's mirror if it gave one, as it was priced before.
    """
    acc = getattr(estimate, "accessories_spec", None) or {}
    rows = acc.get("mirrors")
    widths: List[Optional[float]] = []
    if isinstance(rows, list) and rows:
        for row in rows:
            if not isinstance(row, dict):
                continue
            widths.extend([_num(row.get("width"))] * _count(row.get("count", 1)))
    else:
        van = getattr(estimate, "vanity_spec", None) or {}
        items = [it for it in (van.get("items") or [van]) if isinstance(it, dict)]
        widths = [_num(it.get("mirror_width")) for it in items] or [None]

    merged: Dict[Optional[float], Dict[str, Any]] = {}
    for w in widths:
        key = round(w) if w else None
        if key in merged:
            merged[key]["count"] += 1
        else:
            merged[key] = {"width": key, "count": 1}
    return list(merged.values())


def mirror_count(estimate) -> int:
    return sum(g["count"] for g in mirror_groups(estimate))


def price_by_width(table: Dict[int, float], width: Optional[float], unknown_width: int) -> float:
    """The rate of the smallest size at or over width; past the widest, per inch more at the
    rate between the two widest sizes. A width not known is priced as unknown_width."""
    w = width or unknown_width
    sizes = sorted(table)
    for size in sizes:
        if size >= w:
            return float(table[size])
    top, prev = sizes[-1], sizes[-2]
    per_inch = (table[top] - table[prev]) / (top - prev)
    return round(table[top] + (w - top) * per_inch, 2)
