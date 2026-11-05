"""
Minimal Entwine Point Tile (EPT) reader for the public USGS 3DEP bucket.

EPT stores a project as an octree of LAZ files. To read every point inside a small XY box we walk
the hierarchy, download only the nodes whose cube overlaps the box (every depth holds part of the
points), and keep the points that fall inside. Downloads are cached on disk, so a second request for
the same neighbourhood (locate -> measure) does not hit the network again.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
import laspy
import numpy as np

CACHE_DIR = os.environ.get("ROOF_LIDAR_CACHE_DIR") or os.path.join(tempfile.gettempdir(), "scopit-lidar")
USER_AGENT = "Scopit roof analyzer (USGS 3DEP reader)"
_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


def cached_get(url: str, *, binary: bool = False):
    """GET with a simple content-addressed disk cache (public, immutable data only)."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, hashlib.sha1(url.encode()).hexdigest())
    if not os.path.exists(path):
        with httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.content
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    with open(path, "rb") as f:
        data = f.read()
    return data if binary else json.loads(data)


@dataclass
class PointWindow:
    """Points inside an XY box, in the EPT's native CRS (EPSG:3857 for USGS)."""
    x: np.ndarray
    y: np.ndarray
    z: np.ndarray
    classification: np.ndarray
    return_number: np.ndarray
    number_of_returns: np.ndarray
    nodes_read: int


def read_box(ept_url: str, xmin: float, ymin: float, xmax: float, ymax: float, workers: int = 8) -> PointWindow:
    base = ept_url.rsplit("/", 1)[0]
    meta = cached_get(ept_url)
    b = meta["bounds"]
    size = b[3] - b[0]
    hierarchy_files: dict[str, dict] = {}

    def hierarchy(key: str) -> dict:
        if key not in hierarchy_files:
            hierarchy_files[key] = cached_get(f"{base}/ept-hierarchy/{key}.json")
        return hierarchy_files[key]

    keys: list[str] = []

    def walk(d: int, x: int, y: int, z: int, h: dict) -> None:
        key = f"{d}-{x}-{y}-{z}"
        if key not in h:
            return
        s = size / (2 ** d)
        nx0, ny0 = b[0] + x * s, b[1] + y * s
        if nx0 + s < xmin or nx0 > xmax or ny0 + s < ymin or ny0 > ymax:
            return
        count = h[key]
        if count == -1:  # this subtree lives in its own hierarchy file
            h = hierarchy(key)
            count = h.get(key, 0)
        if count > 0:
            keys.append(key)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    walk(d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz, h)

    walk(0, 0, 0, 0, hierarchy("0-0-0-0"))

    def load(key: str):
        las = laspy.read(io.BytesIO(cached_get(f"{base}/ept-data/{key}.laz", binary=True)))
        x, y = np.asarray(las.x), np.asarray(las.y)
        m = (x >= xmin) & (x <= xmax) & (y >= ymin) & (y <= ymax)
        return (x[m], y[m], np.asarray(las.z)[m], np.asarray(las.classification)[m],
                np.asarray(las.return_number)[m], np.asarray(las.number_of_returns)[m])

    with ThreadPoolExecutor(workers) as ex:
        parts = [p for p in ex.map(load, keys) if len(p[0])]
    if not parts:
        empty = np.zeros(0)
        e8 = empty.astype(np.uint8)
        return PointWindow(empty, empty, empty, e8, e8, e8, len(keys))
    cols = [np.concatenate([p[i] for p in parts]) for i in range(6)]
    return PointWindow(*cols, nodes_read=len(keys))
