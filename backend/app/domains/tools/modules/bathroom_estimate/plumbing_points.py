"""
Where a tub's or shower's faucet and drain are on a sketch.

The same rules as the sketch's utils/plumbingPoints.ts: each is a point in
the fixture's box, x and y from 0 to 1 across its width and depth from its
back-left corner, kept in properties.faucetPos / drainPos. Unset, they're
where the sketch has always drawn them: a tub's drain under its faucet, a
shower's in the middle. layout_changes prices a drain or a faucet an option
moves.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

Pt01 = Tuple[float, float]

FAUCET_MARGIN = 0.1
DRAIN_MARGIN = 0.08
DRAIN_IN_FROM_FAUCET = 6.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _props(f: Dict[str, Any]) -> Dict[str, Any]:
    return f.get("properties") or {}


def _dims(f: Dict[str, Any]) -> Tuple[float, float]:
    d = f.get("dimensions") or {}
    return float(d.get("width") or 0), float(d.get("height") or 0)


def faucet_edges(f: Dict[str, Any]) -> Optional[List[str]]:
    """The walls a faucet can be on, or None when it can be anywhere (a deck, the floor)."""
    p = _props(f)
    if f.get("type") == "bathtub":
        return ["north", "west", "east"] if (p.get("bathtubSubType") or "standard_alcove") == "standard_alcove" else None
    layout = p.get("showerLayout") or "alcove"
    if layout in ("corner", "neo_angle"):
        return ["north", "west"]
    if layout in ("corner_right", "neo_angle_right"):
        return ["north", "east"]
    return ["north", "west", "east"]


def default_faucet(f: Dict[str, Any]) -> Pt01:
    p = _props(f)
    if f.get("type") == "bathtub":
        sub = p.get("bathtubSubType") or "standard_alcove"
        return {"drop_in": (0.5, 0.05), "corner_garden": (0.72, 0.52), "corner_drop_in": (0.72, 0.52),
                "freestanding": (0.5, 1.0)}.get(sub, (0.5, 0.0))
    layout = p.get("showerLayout") or "alcove"
    return (0.45 if layout == "neo_angle" else 0.55 if layout == "neo_angle_right" else 0.5, 0.0)


def snap_faucet(f: Dict[str, Any], pt: Pt01) -> Pt01:
    edges = faucet_edges(f)
    x, y = pt
    if not edges:
        return _clamp(x, 0, 1), _clamp(y, 0, 1)
    off = {"north": abs(y), "south": abs(1 - y), "west": abs(x), "east": abs(1 - x)}
    edge = edges[0]
    for e in edges[1:]:
        if off[e] < off[edge]:
            edge = e

    def along(v: float) -> float:
        return _clamp(v, FAUCET_MARGIN, 1 - FAUCET_MARGIN)

    return {"north": (along(x), 0.0), "south": (along(x), 1.0), "west": (0.0, along(y))}.get(edge, (1.0, along(y)))


def _pt(v: Any) -> Optional[Pt01]:
    if isinstance(v, dict) and v.get("x") is not None and v.get("y") is not None:
        return float(v["x"]), float(v["y"])
    return None


def faucet_of(f: Dict[str, Any]) -> Pt01:
    set_ = _pt(_props(f).get("faucetPos"))
    return snap_faucet(f, set_) if set_ else default_faucet(f)


def clamp_drain(pt: Pt01) -> Pt01:
    return _clamp(pt[0], DRAIN_MARGIN, 1 - DRAIN_MARGIN), _clamp(pt[1], DRAIN_MARGIN, 1 - DRAIN_MARGIN)


def default_drain(f: Dict[str, Any]) -> Pt01:
    if f.get("type") == "shower":
        layout = _props(f).get("showerLayout") or "alcove"
        return {"neo_angle": (0.4, 0.4), "neo_angle_right": (0.6, 0.4)}.get(layout, (0.5, 0.5))
    fx, fy = faucet_of(f)
    w, d = _dims(f)
    if not w or not d:
        return 0.5, 0.5
    dx, dy = (0.5 - fx) * w, (0.5 - fy) * d
    length = math.hypot(dx, dy)
    if length < 0.5:
        return 0.5, 0.5
    step = min(DRAIN_IN_FROM_FAUCET, length)
    return clamp_drain((fx + dx / length * step / w, fy + dy / length * step / d))


def drain_of(f: Dict[str, Any]) -> Pt01:
    set_ = _pt(_props(f).get("drainPos"))
    return clamp_drain(set_) if set_ else default_drain(f)


def in_room(f: Dict[str, Any], pt: Pt01, ppf: float) -> Tuple[float, float]:
    """A point of the fixture's box in the room, inches, turned as the fixture is."""
    w, d = _dims(f)
    pos = f.get("position") or {}
    cx, cy = float(pos.get("x", 0)) / ppf * 12, float(pos.get("y", 0)) / ppf * 12
    lx, ly = (pt[0] - 0.5) * w, (pt[1] - 0.5) * d
    r = math.radians(float(f.get("rotation") or 0))
    return cx + lx * math.cos(r) - ly * math.sin(r), cy + lx * math.sin(r) + ly * math.cos(r)
