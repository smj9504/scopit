"""
How an option's layout differs from the bathroom as it is, and what that costs

An option's sketch is compared with its job's baseline: the restoration
(the bathroom put back as it was) on an insurance job, the current-layout
sketch on a remodel. Fixtures are paired by id — an option starts as a copy
of the estimate it came from, so they keep their ids — and a fixture drawn
again from scratch is paired with the nearest one of its type. Walls are
compared as lines, so a wall drawn again over an old one, split or extended
only counts for the length that is really new or really gone.

Each change has a stable key, so the estimator can leave one out (a toilet
nudged 7" that needs no plumbing work) and it stays out on recalculation.
"""

import math
from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .lights import is_wall_light
from .plumbing_points import drain_of, faucet_of, in_room
from .pricing import LAYOUT_CHANGE_RATES

# A fixture that moved less than this hasn't moved (inches)
MOVE_IN = 6.0
LIGHT_MOVE_IN = 12.0
# A tub and a shower this close are the same spot, converted
SAME_SPOT_IN = 36.0
# How far off a wall's line still counts as on it, and the least wall change worth pricing
ON_WALL_IN = 3.0
MIN_WALL_IN = 12.0

PLUMBING = ("toilet", "vanity", "bathtub", "shower")
NAMES = {"toilet": "Toilet", "vanity": "Vanity", "bathtub": "Tub", "shower": "Shower",
         "door": "Door", "light": "Light", "wall_light": "Wall light"}
LIGHTS = ("light", "wall_light")

Point = Tuple[float, float]


@dataclass
class LayoutChange:
    key: str
    # moved | added | removed | converted | sinks_added | wall_added | wall_removed
    # | drain_moved | valve_moved (a tub's or shower's, the fixture itself staying put)
    kind: str
    # toilet | vanity | bathtub | shower | door | light | wall_light | wall | tub_to_shower | shower_to_tub
    item: str
    label: str
    distance_in: float = 0.0
    length_ft: float = 0.0
    count: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _ppf(sketch: Dict[str, Any]) -> float:
    return float(((sketch or {}).get("settings") or {}).get("pixelsPerFoot") or 40)


def _center(f: Dict[str, Any], ppf: float) -> Point:
    p = f.get("position") or {}
    return (float(p.get("x", 0)) / ppf * 12, float(p.get("y", 0)) / ppf * 12)


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _kind(f: Dict[str, Any]) -> Optional[str]:
    """A fixture's type, a light on a wall (vanity bar, sconce) kept apart from one on the ceiling."""
    t = f.get("type")
    if t == "light" and is_wall_light((f.get("properties") or {}).get("lightType")):
        return "wall_light"
    return t


def _sinks(f: Dict[str, Any]) -> int:
    props = f.get("properties") or {}
    return max(1, int(props.get("sinkCount") or 1))


def _pair(base: List[Dict], option: List[Dict], bppf: float, oppf: float):
    """Pair fixtures by id, then what's left by type and distance."""
    by_id = {f.get("id"): f for f in base}
    pairs: List[Tuple[Dict, Dict]] = []
    used = set()
    left: List[Dict] = []
    for f in option:
        b = by_id.get(f.get("id"))
        if b is not None and _kind(b) == _kind(f):
            pairs.append((b, f))
            used.add(id(b))
        else:
            left.append(f)
    base_left = [b for b in base if id(b) not in used]
    for f in list(left):
        same = [b for b in base_left if _kind(b) == _kind(f)]
        if not same:
            continue
        b = min(same, key=lambda c: _dist(_center(c, bppf), _center(f, oppf)))
        pairs.append((b, f))
        base_left.remove(b)
        left.remove(f)
    return pairs, base_left, left


def _segments(sketch: Dict[str, Any]) -> List[Tuple[str, Point, Point]]:
    ppf = _ppf(sketch)
    out = []
    for w in (sketch or {}).get("walls") or []:
        s, e = w.get("start") or {}, w.get("end") or {}
        a = (float(s.get("x", 0)) / ppf * 12, float(s.get("y", 0)) / ppf * 12)
        b = (float(e.get("x", 0)) / ppf * 12, float(e.get("y", 0)) / ppf * 12)
        if _dist(a, b) > 0.5:
            out.append((w.get("id") or "", a, b))
    return out


def _uncovered_length(seg: Tuple[str, Point, Point], others: Sequence[Tuple[str, Point, Point]]) -> float:
    """Inches of `seg` that no wall in `others` lies along."""
    _, a, b = seg
    length = _dist(a, b)
    ux, uz = (b[0] - a[0]) / length, (b[1] - a[1]) / length

    def off_line(p: Point) -> float:
        return abs((p[0] - a[0]) * uz - (p[1] - a[1]) * ux)

    covered: List[Tuple[float, float]] = []
    for _, p, q in others:
        if off_line(p) > ON_WALL_IN or off_line(q) > ON_WALL_IN:
            continue
        t1 = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz
        t2 = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz
        lo, hi = max(0.0, min(t1, t2)), min(length, max(t1, t2))
        if hi > lo:
            covered.append((lo, hi))
    covered.sort()
    total = 0.0
    end = 0.0
    for lo, hi in covered:
        if hi <= end:
            continue
        total += hi - max(lo, end)
        end = hi
    return max(0.0, length - total)


def layout_changes(base_sketch: Optional[Dict[str, Any]], option_sketch: Optional[Dict[str, Any]]) -> List[LayoutChange]:
    """What the option's sketch moves, adds and takes out compared with the baseline's."""
    base_sketch = base_sketch or {}
    option_sketch = option_sketch or {}
    bppf, oppf = _ppf(base_sketch), _ppf(option_sketch)
    kinds = PLUMBING + ("door",) + LIGHTS
    base = [f for f in base_sketch.get("fixtures") or [] if _kind(f) in kinds]
    option = [f for f in option_sketch.get("fixtures") or [] if _kind(f) in kinds]
    pairs, removed, added = _pair(base, option, bppf, oppf)
    changes: List[LayoutChange] = []

    # A tub taken out where a shower went in (or the other way round) is a conversion
    for old_type, new_type, item in (("bathtub", "shower", "tub_to_shower"), ("shower", "bathtub", "shower_to_tub")):
        for b in [f for f in removed if _kind(f) == old_type]:
            near = [f for f in added if _kind(f) == new_type
                    and _dist(_center(b, bppf), _center(f, oppf)) <= SAME_SPOT_IN]
            if not near:
                continue
            f = min(near, key=lambda c: _dist(_center(b, bppf), _center(c, oppf)))
            removed.remove(b)
            added.remove(f)
            label = "Tub converted to a shower" if item == "tub_to_shower" else "Shower converted to a tub"
            changes.append(LayoutChange(f"converted:{b.get('id')}", "converted", item, label))

    for b, f in pairs:
        kind = _kind(f)
        moved = _dist(_center(b, bppf), _center(f, oppf))
        threshold = LIGHT_MOVE_IN if kind in LIGHTS else MOVE_IN
        if moved > threshold:
            changes.append(LayoutChange(
                f"moved:{f.get('id')}", "moved", kind,
                f"{NAMES[kind]} moved {moved:.0f} in", distance_in=round(moved, 1),
                count=_sinks(b) if kind == "vanity" else 1,
            ))
        if kind in ("bathtub", "shower") and moved <= MOVE_IN:
            # The fixture stayed; its drain or faucet may not have (a tub's drain end
            # swapped, a shower's valve put on another wall)
            name = NAMES[kind]
            faucet = "faucet" if kind == "bathtub" else "valve"
            for change, point_of, what in (("drain_moved", drain_of, "drain"), ("valve_moved", faucet_of, faucet)):
                d = _dist(in_room(b, point_of(b), bppf), in_room(f, point_of(f), oppf))
                if d > MOVE_IN:
                    changes.append(LayoutChange(
                        f"{change}:{f.get('id')}", change, kind,
                        f"{name} {what} moved {d:.0f} in", distance_in=round(d, 1),
                    ))
        if kind == "vanity" and _sinks(f) > _sinks(b):
            extra = _sinks(f) - _sinks(b)
            changes.append(LayoutChange(
                f"sinks_added:{f.get('id')}", "sinks_added", "vanity",
                f"{extra} sink{'s' if extra > 1 else ''} added to the vanity", count=extra,
            ))

    for f in added:
        kind = _kind(f)
        changes.append(LayoutChange(
            f"added:{f.get('id')}", "added", kind, f"New {NAMES[kind].lower()}",
            count=_sinks(f) if kind == "vanity" else 1,
        ))
    for b in removed:
        kind = _kind(b)
        if kind in LIGHTS:
            continue  # a light taken down needs no more than its fixture removal
        changes.append(LayoutChange(f"removed:{b.get('id')}", "removed", kind, f"{NAMES[kind]} taken out"))

    base_walls, option_walls = _segments(base_sketch), _segments(option_sketch)
    for seg in option_walls:
        new_in = _uncovered_length(seg, base_walls)
        if new_in >= MIN_WALL_IN:
            changes.append(LayoutChange(
                f"wall_added:{seg[0]}", "wall_added", "wall",
                f"New wall {new_in / 12:.1f} ft", length_ft=round(new_in / 12, 1),
            ))
    for seg in base_walls:
        gone_in = _uncovered_length(seg, option_walls)
        if gone_in >= MIN_WALL_IN:
            changes.append(LayoutChange(
                f"wall_removed:{seg[0]}", "wall_removed", "wall",
                f"Wall taken out {gone_in / 12:.1f} ft", length_ft=round(gone_in / 12, 1),
            ))
    return changes


# ── Pricing ──

def _item(phase: int, description: str, quantity: float, unit: str, rate: float, category: str, notes: str) -> Dict[str, Any]:
    return {
        "phase": phase,
        "description": description,
        "quantity": round(quantity, 2),
        "unit": unit,
        "unit_price": round(rate, 2),
        "total": round(quantity * rate, 2),
        "category": category,
        "notes": notes,
    }


def layout_change_line_items(
    changes: Iterable[LayoutChange],
    labor_mult: float = 1.0,
    skips: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], bool, List[str]]:
    """Line items for the layout changes not left out, whether any of them is
    rough plumbing (for the permit), and warnings for the estimator."""
    skips = skips or set()
    r = {k: v * labor_mult for k, v in LAYOUT_CHANGE_RATES.items()}
    items: List[Dict[str, Any]] = []
    rough = False
    drains = False
    walls_out = False

    for c in changes:
        if c.key in skips:
            continue
        note = f"Layout change: {c.label.lower()}"
        if c.kind == "moved" and c.item in PLUMBING:
            rough = drains = True
            if c.item == "toilet":
                items.append(_item(2, "Relocate toilet drain & flange", 1, "EA", r["toilet_relocation"], "plumbing",
                                   f"{note} | drain, vent tie-in, flange, supply"))
            elif c.item == "vanity":
                items.append(_item(2, "Relocate vanity supply & drain", c.count, "EA", r["sink_relocation"], "plumbing",
                                   f"{note} | per sink"))
            elif c.item == "shower":
                items.append(_item(2, "Relocate shower drain & valve", 1, "EA", r["shower_relocation"], "plumbing", note))
            else:
                items.append(_item(2, "Relocate tub drain & valve", 1, "EA", r["tub_relocation"], "plumbing", note))
        elif c.kind == "drain_moved":
            rough = drains = True
            what = "tub" if c.item == "bathtub" else "shower"
            items.append(_item(2, f"Relocate {what} drain", 1, "EA", r["drain_relocation"], "plumbing", note))
        elif c.kind == "valve_moved":
            rough = True
            what = "tub faucet" if c.item == "bathtub" else "shower valve"
            items.append(_item(2, f"Relocate {what} & supply", 1, "EA", r["valve_relocation"], "plumbing", note))
        elif c.kind == "sinks_added":
            rough = drains = True
            items.append(_item(2, "Rough-in for added sink (supply & drain)", c.count, "EA", r["sink_new_rough_in"], "plumbing", note))
        elif c.kind == "converted":
            rough = drains = True
            if c.item == "tub_to_shower":
                items.append(_item(2, "Tub-to-shower conversion: drain & valve rework", 1, "EA", r["tub_to_shower"], "plumbing", note))
            else:
                items.append(_item(2, "Shower-to-tub conversion: drain, overflow & spout", 1, "EA", r["shower_to_tub"], "plumbing", note))
        elif c.kind == "added" and c.item in PLUMBING:
            rough = drains = True
            if c.item == "toilet":
                items.append(_item(2, "Rough-in for new toilet (drain, vent, supply)", 1, "EA", r["toilet_new_rough_in"], "plumbing", note))
            elif c.item == "vanity":
                items.append(_item(2, "Rough-in for new vanity sink (supply & drain)", c.count, "EA", r["sink_new_rough_in"], "plumbing", note))
            elif c.item == "shower":
                items.append(_item(2, "Rough-in for new shower (drain & valve)", 1, "EA", r["shower_new_rough_in"], "plumbing", note))
            else:
                items.append(_item(2, "Rough-in for new tub (drain & valve)", 1, "EA", r["tub_new_rough_in"], "plumbing", note))
        elif c.kind == "removed" and c.item in PLUMBING:
            rough = True
            items.append(_item(2, f"Cap abandoned supply & drain ({c.item})", 1, "EA", r["cap_abandoned"], "plumbing", note))
        elif c.item == "door":
            if c.kind == "moved":
                items.append(_item(3, "Relocate door opening (frame new, infill old)", 1, "EA", r["door_relocation"], "substrate", note))
            elif c.kind == "added":
                items.append(_item(3, "Cut & frame new door opening", 1, "EA", r["door_new_opening"], "substrate", note))
            else:
                items.append(_item(3, "Infill old door opening", 1, "EA", r["door_infill"], "substrate", note))
        elif c.item in LIGHTS:
            where = "wall" if c.item == "wall_light" else "ceiling"
            if c.kind == "moved":
                items.append(_item(2, f"Relocate {where} light box", 1, "EA", r["light_relocation"], "electrical", note))
            else:
                items.append(_item(2, f"New {where} light box & wiring", 1, "EA", r["light_new_box"], "electrical", note))
        elif c.kind == "wall_added":
            items.append(_item(3, "Frame new partition wall (2x4, drywall both sides, finished)", c.length_ft, "LF",
                               r["partition_wall_per_lf"], "substrate", note))
        elif c.kind == "wall_removed":
            walls_out = True
            items.append(_item(1, "Remove partition wall & patch", c.length_ft, "LF", r["wall_removal_per_lf"], "demo", note))

    warnings = []
    if drains:
        warnings.append("Moved drains are priced for a wood-framed floor; on a concrete slab, expect 2-3x for cutting, trenching and patching.")
    if walls_out:
        warnings.append("Wall removal is priced as non-load-bearing with no plumbing or wiring inside; confirm before quoting.")
    return items, rough, warnings
