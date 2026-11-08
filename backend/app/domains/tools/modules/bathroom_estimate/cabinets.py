"""
Cabinets hung on a bathroom wall: a medicine cabinet (its door a mirror),
surface-mounted or set into the wall, and a wall cabinet (the one over the
toilet). Each kind is its own line, new or detached and reset.

They're kept in accessories_spec.cabinets as [{type, count, action}],
filled from the sketch (each cabinet drawn on the plan) or typed in on the
estimate page.
"""

from typing import Any, Dict, List

# type -> its name on the estimate, its material allowance and its D&R rate
# (pricing.WALL_CABINET_PRICES / DETACH_RESET_COSTS)
CABINET_TYPES: Dict[str, Dict[str, str]] = {
    "medicine_cabinet": {"label": "Medicine cabinet, mirrored (surface mount)"},
    "medicine_cabinet_recessed": {"label": "Medicine cabinet, mirrored (recessed)"},
    "wall_cabinet": {"label": "Wall cabinet"},
}

ACTIONS = ("replace", "detach_reset")


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def cabinet_groups(estimate) -> List[Dict[str, Any]]:
    """The estimate's cabinets as [{type, count, action}], one per kind, in the order they first appear."""
    acc = getattr(estimate, "accessories_spec", None) or {}
    rows = acc.get("cabinets")
    if not isinstance(rows, list):
        return []
    merged: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("type") not in CABINET_TYPES:
            continue
        count = _int(row.get("count"), 1)
        if count <= 0:
            continue
        action = row.get("action") if row.get("action") in ACTIONS else "replace"
        key = (row["type"], action)
        if key in merged:
            merged[key]["count"] += count
        else:
            merged[key] = {"type": row["type"], "count": count, "action": action}
    return list(merged.values())
