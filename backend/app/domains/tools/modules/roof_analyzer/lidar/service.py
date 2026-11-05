"""
Locate (address -> which building?) and measure (building -> roof model) for free-LiDAR roof reports.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

from .pointcloud import (
    M2_TO_FT2,
    Window,
    building_candidates,
    candidate_at,
    load_window,
    shaded_relief_png,
)
from .roofmodel import build_roof
from .sources import LidarProject, geocode, projects_at


class LidarError(Exception):
    """A user-facing reason the roof could not be measured (no data, no match, ...)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


LOCATE_HALF_M = 45.0
MEASURE_HALF_M = 60.0


def _open_window(lat: float, lon: float, half: float) -> tuple[Window, LidarProject]:
    projects = projects_at(lat, lon)
    if not projects:
        raise LidarError("no_coverage", "No free USGS LiDAR is available for this location yet.")
    last: Optional[Window] = None
    for project in projects[:3]:  # newest first; fall back to an older survey if the newest is empty here
        win = load_window(project.url, lat, lon, half)
        if len(win.building_xyz) >= 50:
            return win, project
        last = last or win
    raise LidarError("no_buildings", "The LiDAR survey here has no building points near this location.")


def _source_info(win: Window, project: LidarProject) -> dict:
    return {
        "provider": "USGS 3D Elevation Program (3DEP) LiDAR",
        "project": project.name,
        "year": project.year,
        "density_pts_m2": round(win.density, 1),
        "building_points": "classified by USGS" if win.building_source == "lidar_class" else "derived by Scopit (no building class in this survey)",
    }


def _to_lonlat_ring(win: Window, poly) -> list[list[float]]:
    xs, ys = poly.exterior.xy
    lon, lat = win.to_lonlat(np.asarray(xs), np.asarray(ys))
    return [[round(float(a), 7), round(float(b), 7)] for a, b in zip(lat, lon)]


def locate(address: Optional[str] = None, lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    matched = None
    if lat is None or lon is None:
        if not address or not address.strip():
            raise LidarError("bad_request", "Enter an address.")
        g = geocode(address.strip())
        if g is None:
            raise LidarError("no_match", "That address was not found. Check the street, city and ZIP.")
        lat, lon, matched = g.lat, g.lon, g.matched_address
    win, project = _open_window(lat, lon, LOCATE_HALF_M)
    cands, _, _ = building_candidates(win)
    if not cands:
        raise LidarError("no_buildings", "No buildings were found in the LiDAR near this address.")
    image, size = shaded_relief_png(win)
    px = size / (2 * win.half)
    suggested = candidate_at(cands, 0.0, 0.0)
    out = []
    for c in cands:
        xs, ys = c.outline.exterior.xy
        ilon, ilat = win.to_lonlat(c.inside_point[0], c.inside_point[1])
        out.append({
            "id": c.id,
            "plan_sqft": round(c.plan_sqft),
            "height_ft": round(c.height_ft, 1),
            "distance_ft": round(c.distance_m * 3.28084),
            "pick": {"lat": round(float(ilat), 7), "lon": round(float(ilon), 7)},
            "outline_px": [[round((x + win.half) * px, 1), round((win.half - y) * px, 1)] for x, y in zip(xs, ys)],
            "outline_latlon": _to_lonlat_ring(win, c.outline),
        })
    return {
        "address": matched or address,
        "lat": lat,
        "lon": lon,
        "image": {"src": image, "size_px": size, "meters": 2 * win.half},
        "center_px": [size / 2, size / 2],
        "candidates": out,
        "suggested_id": suggested.id if suggested else None,
        "source": _source_info(win, project),
    }


def measure(lat: float, lon: float) -> dict:
    """Measure the building that contains (or is nearest to) the given point."""
    win, project = _open_window(lat, lon, MEASURE_HALF_M)
    cands, lab, cell = building_candidates(win)
    target = candidate_at(cands, 0.0, 0.0)
    if target is None:
        raise LidarError("no_buildings", "No building was found at the selected spot.")
    B = win.building_xyz
    n = lab.shape[0]
    gi = np.clip(((B[:, :2] + win.half) / cell).astype(int), 0, n - 1)
    pts = B[lab[gi[:, 0], gi[:, 1]] == target.id]
    ground = float(np.median(win.ground_at(pts[:, 0], pts[:, 1])))
    try:
        result = build_roof(pts, ground)
    except ValueError as e:
        raise LidarError("no_roof", f"Could not build a roof model here ({e}).")

    warnings = []
    year = project.year
    if year and year <= 2016:
        warnings.append(f"The LiDAR here was flown around {year}; additions or new roofs since then are missing.")
    if win.building_source != "lidar_class":
        warnings.append("This survey does not mark buildings, so roof points were picked out automatically. Check the outline.")
    if win.density < 4:
        warnings.append("Low point density here; small facets and dormers may be merged or missed.")
    s = result["summary"]
    if target.plan_sqft and abs(s["plan_area_sqft"] - target.plan_sqft) / target.plan_sqft > 0.25:
        warnings.append("Part of the outline could not be modelled; compare the total with the footprint.")
    result["source"] = _source_info(win, project)
    result["warnings"] = warnings
    result["footprint_sqft"] = round(target.plan_sqft)
    result["height_ft"] = round(target.height_ft, 1)
    return result
