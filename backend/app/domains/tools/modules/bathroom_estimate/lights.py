"""
A bathroom's light fixtures, kind by kind.

A bathroom often has more than one kind of light: a 3-light bar over the
vanity, a few recessed cans, a sconce either side of the mirror. Each kind
is its own line on the estimate. They're kept in electrical_spec.lights as
[{type, count, bulbs, action}], filled from the sketch (each light drawn on
the plan) or typed in on the estimate page.

Estimates saved before that list existed had one vanity light (the
replace/D&R flags and vanity_lights) and one ceiling light
(electrical_spec.ceiling_fixture); light_groups() reads those the same way,
so they price as they always did.
"""

from typing import Any, Dict, List, Optional

# type -> its name on the estimate, where it hangs, and its install rate
# (pricing.ELECTRICAL_RATES). A sconce goes on a wall box like a vanity bar,
# a pendant on a ceiling box like a ceiling fixture, so they share those rates.
LIGHT_TYPES: Dict[str, Dict[str, str]] = {
    "vanity_bar": {"label": "Vanity light fixture", "mount": "wall", "rate": "vanity_light_install"},
    "sconce": {"label": "Wall sconce", "mount": "wall", "rate": "vanity_light_install"},
    "ceiling": {"label": "Ceiling light fixture", "mount": "ceiling", "rate": "ceiling_fixture_install"},
    "pendant": {"label": "Pendant light", "mount": "ceiling", "rate": "ceiling_fixture_install"},
    "recessed": {"label": "Recessed light", "mount": "ceiling", "rate": "recessed_light_install"},
}

ACTIONS = ("replace", "detach_reset")

# The sketch's lightType for each kind (older sketches call a ceiling fixture "standard")
SKETCH_TYPES = {
    "standard": "ceiling",
    "recessed_multi": "recessed",
}


def sketch_light_type(light_type: Optional[str]) -> str:
    """The kind of light a sketch fixture is, from its properties.lightType."""
    t = light_type or "standard"
    t = SKETCH_TYPES.get(t, t)
    return t if t in LIGHT_TYPES else "ceiling"


def is_wall_light(light_type: Optional[str]) -> bool:
    return LIGHT_TYPES[sketch_light_type(light_type)]["mount"] == "wall"


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _legacy_groups(estimate) -> List[Dict[str, Any]]:
    elec = getattr(estimate, "electrical_spec", None) or {}
    groups: List[Dict[str, Any]] = []
    vanity_count = _int(elec.get("vanity_lights"))
    if getattr(estimate, "replace_vanity_light", False):
        groups.append({"type": "vanity_bar", "count": vanity_count or 1, "action": "replace"})
    elif getattr(estimate, "detach_reset_vanity_light", False):
        groups.append({"type": "vanity_bar", "count": vanity_count or 1, "action": "detach_reset"})
    elif vanity_count > 0:
        groups.append({"type": "vanity_bar", "count": vanity_count, "action": "replace"})

    ceiling = elec.get("ceiling_fixture")
    if ceiling == "recessed_multi":
        groups.append({"type": "recessed", "count": _int(elec.get("recessed_can_count"), 4) or 4, "action": "replace"})
    elif ceiling == "recessed":
        groups.append({"type": "recessed", "count": 1, "action": "replace"})
    elif ceiling:
        groups.append({"type": "ceiling", "count": 1, "action": "replace"})
    return groups


def light_groups(estimate) -> List[Dict[str, Any]]:
    """The estimate's lights as [{type, count, bulbs, action}], one per kind.

    Rows of the same kind (type, bulbs and action alike) are added together,
    in the order they first appear; rows with no count are dropped.
    """
    elec = getattr(estimate, "electrical_spec", None) or {}
    raw = elec.get("lights")
    rows = raw if isinstance(raw, list) else _legacy_groups(estimate)

    merged: Dict[tuple, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        t = row.get("type")
        t = SKETCH_TYPES.get(t, t)
        if t not in LIGHT_TYPES:
            continue
        count = _int(row.get("count"), 1)
        if count <= 0:
            continue
        bulbs = _int(row.get("bulbs")) if t == "vanity_bar" else 0
        bulbs = bulbs if bulbs > 0 else None
        action = row.get("action") if row.get("action") in ACTIONS else "replace"
        key = (t, bulbs, action)
        if key in merged:
            merged[key]["count"] += count
        else:
            merged[key] = {"type": t, "count": count, "bulbs": bulbs, "action": action}
    return list(merged.values())


def light_name(group: Dict[str, Any]) -> str:
    """"Vanity light fixture (3-light)", "Wall sconce"…"""
    name = LIGHT_TYPES[group["type"]]["label"]
    if group.get("bulbs"):
        name += f" ({group['bulbs']}-light)"
    return name
