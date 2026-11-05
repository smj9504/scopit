"""
Point-cloud window around a location: local metric frame, ground model, building points,
building candidates (for the "which house is it?" step) and a shaded-relief preview image.
"""
from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
from pyproj import Transformer
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

from .ept import read_box
from .geometry import M2_TO_FT2, M_TO_FT, local_normals

# ASPRS LAS classes
GROUND, BUILDING = 2, 6
NON_BUILDING = {2, 3, 4, 5, 7, 9, 17, 18}


def utm_epsg(lon: float, lat: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


@dataclass
class Window:
    """All points within `half` metres of (lat, lon), in a local east/north/up frame (metres)."""
    lat: float
    lon: float
    half: float
    xyz: np.ndarray            # (N, 3): x east, y north from the centre; z = elevation (m)
    cls: np.ndarray
    nret: np.ndarray
    density: float             # all returns per m^2
    ground_grid: np.ndarray    # 1 m grid of ground elevation covering the window
    building_xyz: np.ndarray   # points considered roof/building
    building_source: str       # "lidar_class" | "derived"

    def ground_at(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        n = self.ground_grid.shape[0]
        i = np.clip(((x + self.half) / 1.0).astype(int), 0, n - 1)
        j = np.clip(((y + self.half) / 1.0).astype(int), 0, n - 1)
        return self.ground_grid[i, j]

    def to_lonlat(self, x, y):
        utm = utm_epsg(self.lon, self.lat)
        fwd = Transformer.from_crs(4326, utm, always_xy=True)
        cx, cy = fwd.transform(self.lon, self.lat)
        inv = Transformer.from_crs(utm, 4326, always_xy=True)
        return inv.transform(np.asarray(x) + cx, np.asarray(y) + cy)


def _ground_grid(P: np.ndarray, cls: np.ndarray, half: float) -> np.ndarray:
    n = int(2 * half) + 1
    G = P[cls == GROUND]
    if len(G) < 20:  # no ground class: fall back to the lowest returns
        G = P[P[:, 2] <= np.percentile(P[:, 2], 10)] if len(P) else P
    grid = np.full((n, n), np.inf)
    if len(G):
        gi = np.clip(((G[:, :2] + half) / 1.0).astype(int), 0, n - 1)
        np.minimum.at(grid, (gi[:, 0], gi[:, 1]), G[:, 2])
    have = np.isfinite(grid)
    if not have.any():
        return np.zeros((n, n))
    idx = ndimage.distance_transform_edt(~have, return_distances=False, return_indices=True)
    return grid[idx[0], idx[1]]


def _derived_building_points(win_xyz, cls, nret, ground_at, half) -> np.ndarray:
    """Surveys without a building class: planar, single-return points more than 2 m above ground."""
    cand = ~np.isin(cls, list(NON_BUILDING)) & (nret <= 1)
    C = win_xyz[cand]
    if len(C) < 50:
        return C
    C = C[C[:, 2] - ground_at(C[:, 0], C[:, 1]) > 2.0]
    if len(C) < 50:
        return C
    _, curv, _ = local_normals(C)
    C = C[curv < 0.02]
    # drop small isolated blobs (tree crowns that happened to look planar)
    cell = 0.5
    n = int(2 * half / cell) + 1
    ci = np.clip(((C[:, :2] + half) / cell).astype(int), 0, n - 1)
    occ = np.zeros((n, n), bool)
    occ[ci[:, 0], ci[:, 1]] = True
    occ = ndimage.binary_opening(ndimage.binary_closing(occ, iterations=2), iterations=2)
    return C[occ[ci[:, 0], ci[:, 1]]]


def load_window(ept_url: str, lat: float, lon: float, half: float = 55.0) -> Window:
    to_merc = Transformer.from_crs(4326, 3857, always_xy=True)
    mx, my = to_merc.transform(lon, lat)
    k = 1 / math.cos(math.radians(lat))  # web-mercator scale factor at this latitude
    pw = read_box(ept_url, mx - half * k, my - half * k, mx + half * k, my + half * k)
    utm = utm_epsg(lon, lat)
    tr = Transformer.from_crs(3857, utm, always_xy=True)
    ux, uy = tr.transform(pw.x, pw.y)
    cx, cy = tr.transform(mx, my)
    xyz = np.c_[np.asarray(ux) - cx, np.asarray(uy) - cy, pw.z] if len(pw.x) else np.zeros((0, 3))
    cls = pw.classification.astype(int)
    nret = pw.number_of_returns.astype(int)
    density = len(xyz) / (2 * half) ** 2
    grid = _ground_grid(xyz, cls, half)
    win = Window(lat, lon, half, xyz, cls, nret, density, grid, np.zeros((0, 3)), "none")
    B = xyz[cls == BUILDING]
    if len(B) >= 50:
        win.building_xyz, win.building_source = B, "lidar_class"
    else:
        win.building_xyz = _derived_building_points(xyz, cls, nret, win.ground_at, half)
        win.building_source = "derived"
    return win


@dataclass
class Candidate:
    id: int
    outline: Polygon            # local metres
    inside_point: tuple         # local metres, guaranteed inside the outline
    plan_sqft: float
    height_ft: float
    distance_m: float           # from the window centre (the geocoded address)


def building_candidates(win: Window, min_area_m2: float = 20.0) -> tuple[list[Candidate], np.ndarray, float]:
    """Connected building footprints in the window. Returns (candidates, label grid, cell size)."""
    B = win.building_xyz
    cell = 0.5
    n = int(2 * win.half / cell) + 1
    lab = np.zeros((n, n), int)
    if len(B) < 50:
        return [], lab, cell
    gi = np.clip(((B[:, :2] + win.half) / cell).astype(int), 0, n - 1)
    occ = np.zeros((n, n), bool)
    occ[gi[:, 0], gi[:, 1]] = True
    occ = ndimage.binary_fill_holes(ndimage.binary_closing(occ, iterations=2))
    lab, nl = ndimage.label(occ, structure=np.ones((3, 3)))
    out = []
    for L in range(1, nl + 1):
        ii, jj = np.nonzero(lab == L)
        area = len(ii) * cell * cell
        if area < min_area_m2:
            continue
        cells = [box(i * cell - win.half, j * cell - win.half, (i + 1) * cell - win.half, (j + 1) * cell - win.half)
                 for i, j in zip(ii, jj)]
        poly = unary_union(cells)
        if poly.geom_type != "Polygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        poly = Polygon(poly.exterior).simplify(0.4)
        pts = B[lab[gi[:, 0], gi[:, 1]] == L]
        top = float(np.percentile(pts[:, 2], 95)) if len(pts) else 0.0
        h = top - float(np.median(win.ground_at(pts[:, 0], pts[:, 1]))) if len(pts) else 0.0
        rp = poly.representative_point()
        out.append(Candidate(L, poly, (rp.x, rp.y), area * M2_TO_FT2, h * M_TO_FT, float(poly.distance(Point(0, 0)))))
    out.sort(key=lambda c: c.distance_m)
    return out, lab, cell


def shaded_relief_png(win: Window, px_per_m: float = 4.0) -> tuple[str, int]:
    """Hillshaded surface of the window (top-down, north up) as a PNG data URL; returns (url, size)."""
    from PIL import Image

    size = int(2 * win.half * px_per_m)
    P = win.xyz
    surf = np.full((size, size), -np.inf)
    if len(P):
        col = np.clip(((P[:, 0] + win.half) * px_per_m).astype(int), 0, size - 1)
        row = np.clip(((win.half - P[:, 1]) * px_per_m).astype(int), 0, size - 1)
        np.maximum.at(surf, (row, col), P[:, 2])
    have = np.isfinite(surf)
    if have.any():
        idx = ndimage.distance_transform_edt(~have, return_distances=False, return_indices=True)
        surf = surf[idx[0], idx[1]]
    else:
        surf = np.zeros((size, size))
    surf = ndimage.median_filter(surf, size=3)
    dzdy, dzdx = np.gradient(surf, 1 / px_per_m)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, dzdy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    # tint by height above ground so roofs stand out from yards and trees
    rows, cols = np.mgrid[0:size, 0:size]
    gx = cols / px_per_m - win.half
    gy = win.half - rows / px_per_m
    hag = np.clip(surf - win.ground_at(gx.ravel(), gy.ravel()).reshape(size, size), 0, 15) / 15
    base = np.stack([0.80 + 0.15 * hag, 0.82 - 0.10 * hag, 0.78 - 0.30 * hag], axis=-1)
    rgb = np.clip(base * (0.35 + 0.65 * shade[..., None]), 0, 1)
    img = Image.fromarray((rgb * 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), size


def candidate_at(cands: list[Candidate], x: float, y: float) -> Optional[Candidate]:
    p = Point(x, y)
    inside = [c for c in cands if c.outline.buffer(0.5).contains(p)]
    if inside:
        return inside[0]
    near = [c for c in cands if c.outline.distance(p) < 25]
    return min(near, key=lambda c: c.outline.distance(p)) if near else None
