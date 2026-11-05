"""
Locate (address -> which building?) and measure (building -> roof model) for free-LiDAR roof reports.

Points come either from the public USGS cloud copy (read directly), or - where a survey is only on
USGS's download site - from a tile the user downloads and drops in (see upload.py).
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from . import upload
from .pointcloud import (
    Window,
    build_window,
    building_candidates,
    candidate_at,
    load_window,
    shaded_relief_png,
)
from .roofmodel import build_roof
from .sources import LidarProject, geocode, projects_at, usgs_surveys_at, usgs_tiles_at


class LidarError(Exception):
    """A user-facing reason the roof could not be measured (no data, no match, ...)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


LOCATE_HALF_M = 60.0
MEASURE_HALF_M = 60.0


def _no_coverage(lat: float, lon: float) -> LidarError:
    surveys = usgs_surveys_at(lat, lon)
    if surveys:
        s = surveys[0]
        return LidarError(
            "no_coverage",
            f"USGS has LiDAR for this address ({s.name}{f', {s.year}' if s.year else ''}), but it is not in "
            "the free cloud copy Scopit reads yet.",
        )
    return LidarError("no_coverage", "No free USGS LiDAR is available for this location yet.")


def _open_window(lat: float, lon: float, half: float) -> tuple[Window, LidarProject]:
    projects = projects_at(lat, lon)
    if not projects:
        raise _no_coverage(lat, lon)
    for project in projects[:3]:  # newest first; fall back to an older survey if the newest is empty here
        win = load_window(project.url, lat, lon, half)
        if len(win.building_xyz) >= 50:
            return win, project
    raise LidarError("no_buildings", "The LiDAR survey here has no building points near this location.")


def _upload_window(owner: str, upload_id: str, lat: float, lon: float, half: float) -> tuple[Window, LidarProject]:
    try:
        xyz, cls, ret, nret, meta = upload.load_upload(owner, upload_id, lat, lon)
    except upload.TileError as e:
        raise LidarError("bad_upload", str(e))
    win = build_window(lat, lon, half, xyz, cls, ret, nret)
    if len(win.building_xyz) < 50:
        raise LidarError("no_buildings", "The tile has no building points near this address. Is it the right tile?")
    return win, LidarProject(meta.get("project") or "USGS tile (uploaded)", "", meta.get("year"))


def _source_info(win: Window, project: LidarProject) -> dict:
    return {
        "provider": "USGS 3D Elevation Program (3DEP) LiDAR",
        "project": project.name,
        "year": project.year,
        "density_pts_m2": round(win.density, 1),
        "building_points": "classified by USGS" if win.building_source == "lidar_class" else "derived by Scopit (no building class in this survey)",
    }


def _geocode(address: Optional[str]) -> tuple[float, float, str]:
    if not address or not address.strip():
        raise LidarError("bad_request", "Enter an address.")
    g = geocode(address.strip())
    if g is None:
        raise LidarError("no_match", "That address was not found. Check the street, city and ZIP.")
    return g.lat, g.lon, g.matched_address


def _candidates_payload(win: Window, project: LidarProject, address: str, lat: float, lon: float) -> dict:
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
        })
    return {
        "address": address,
        "lat": lat,
        "lon": lon,
        "image": {"src": image, "size_px": size, "meters": 2 * win.half},
        "center_px": [size / 2, size / 2],
        "candidates": out,
        "suggested_id": suggested.id if suggested else None,
        "source": _source_info(win, project),
    }


def locate(address: Optional[str] = None, lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    """Buildings around the address, or - if only USGS's download site has the survey - the tiles
    the user has to download (`needs_tile`)."""
    matched = address
    if lat is None or lon is None:
        lat, lon, matched = _geocode(address)
    if not projects_at(lat, lon):
        tiles = usgs_tiles_at(lat, lon)
        if not tiles:
            raise _no_coverage(lat, lon)
        return {
            "needs_tile": True,
            "address": matched,
            "lat": lat,
            "lon": lon,
            "survey": {"project": tiles[0]["project"], "year": tiles[0]["year"]},
            "tiles": tiles,
        }
    win, project = _open_window(lat, lon, LOCATE_HALF_M)
    return _candidates_payload(win, project, matched, lat, lon)


def locate_upload(owner: str, upload_id: str, address: str, lat: float, lon: float,
                  project: Optional[str], year: Optional[int]) -> dict:
    """Like locate(), on the points of tiles the user dropped in."""
    try:
        upload.set_upload_source(owner, upload_id, project, year)
    except upload.TileError as e:
        raise LidarError("bad_upload", str(e))
    win, proj = _upload_window(owner, upload_id, lat, lon, LOCATE_HALF_M)
    payload = _candidates_payload(win, proj, address, lat, lon)
    payload["upload_id"] = upload_id
    return payload


def _measure_window(win: Window, project: LidarProject) -> dict:
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


def measure(lat: float, lon: float, owner: Optional[str] = None, upload_id: Optional[str] = None) -> dict:
    """Measure the building that contains (or is nearest to) the given point."""
    if upload_id:
        win, project = _upload_window(owner or "", upload_id, lat, lon, MEASURE_HALF_M)
    else:
        win, project = _open_window(lat, lon, MEASURE_HALF_M)
    return _measure_window(win, project)
