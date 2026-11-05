"""
Which public 3DEP project covers a location, and the free Census geocoder.

The project index (boundary polygons of every EPT dataset in the public usgs-lidar-public bucket) is
maintained by Hobu, who publishes the bucket. It is downloaded once and cached.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Optional

import httpx
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from .ept import USER_AGENT, cached_get

PROJECT_INDEX_URL = "https://raw.githubusercontent.com/hobu/usgs-lidar/master/boundaries/resources.geojson"
CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
TNM_PRODUCTS_URL = "https://tnmaccess.nationalmap.gov/api/v1/products"
TNM_TITLE_PREFIX = "USGS Lidar Point Cloud "

_index_lock = threading.Lock()
_index: Optional[tuple[STRtree, list]] = None


@dataclass
class LidarProject:
    name: str
    url: str
    year: Optional[int]


def project_year(name: str) -> Optional[int]:
    """Collection year from a USGS project name: 'VA_Fairfax_County_2018' or 'VA_NorthernVA_1_B22'."""
    years = [int(y) for y in re.findall(r"(?<!\d)(20\d\d)(?!\d)", name)]
    if years:
        return max(years)
    m = re.search(r"_[A-Z](\d\d)$", name)
    return 2000 + int(m.group(1)) if m else None


def _load_index() -> tuple[STRtree, list]:
    global _index
    with _index_lock:
        if _index is None:
            feats = cached_get(PROJECT_INDEX_URL)["features"]
            geoms = [shape(f["geometry"]) for f in feats]
            _index = (STRtree(geoms), [(f["properties"], g) for f, g in zip(feats, geoms)])
        return _index


def projects_at(lat: float, lon: float) -> list[LidarProject]:
    """Public 3DEP projects covering the point: newest first, denser survey first within a year."""
    tree, items = _load_index()
    pt = Point(lon, lat)
    hits = []
    for i in tree.query(pt):
        props, geom = items[int(i)]
        if geom.contains(pt):
            density = props.get("count", 0) / max(geom.area, 1e-9)  # relative points per area
            hits.append((LidarProject(props["name"], props["url"], project_year(props["name"])), density))
    hits.sort(key=lambda h: (-(h[0].year or 0), -h[1]))
    return [h[0] for h in hits]


def tnm_project_names(items: list[dict]) -> list[LidarProject]:
    """Survey names from TNM product titles ('USGS Lidar Point Cloud <project> <tile>'), newest first."""
    seen: dict[str, LidarProject] = {}
    for it in items:
        title = it.get("title") or ""
        if not title.startswith(TNM_TITLE_PREFIX):
            continue
        name = title[len(TNM_TITLE_PREFIX):].split(" ")[0]
        if name and name not in seen:
            seen[name] = LidarProject(name, it.get("downloadURL") or "", project_year(name))
    return sorted(seen.values(), key=lambda p: -(p.year or 0))


def _tnm_items(lat: float, lon: float, d: float) -> list[dict]:
    params = {"datasets": "Lidar Point Cloud (LPC)", "bbox": f"{lon - d},{lat - d},{lon + d},{lat + d}",
              "max": 40, "outputFormat": "JSON"}
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0), headers={"User-Agent": USER_AGENT}) as client:
            resp = client.get(TNM_PRODUCTS_URL, params=params)
            resp.raise_for_status()
            return resp.json().get("items", [])
    except (httpx.HTTPError, ValueError):
        return []


def usgs_surveys_at(lat: float, lon: float) -> list[LidarProject]:
    """Every USGS LiDAR survey covering the point, from the National Map catalogue (best effort)."""
    return tnm_project_names(_tnm_items(lat, lon, 0.0005))


def tnm_tiles(items: list[dict], lat: float, lon: float) -> list[dict]:
    """Download tiles of the newest survey around the point, the one containing it first."""
    projects = tnm_project_names(items)
    if not projects:
        return []
    newest = projects[0].name
    tiles = []
    for it in items:
        title = it.get("title") or ""
        url = it.get("downloadLazURL") or it.get("downloadURL") or ""
        if not title.startswith(TNM_TITLE_PREFIX + newest + " ") or not url.lower().endswith((".laz", ".las")):
            continue
        bb = it.get("boundingBox") or {}
        contains = bool(bb) and bb.get("minX", 0) <= lon <= bb.get("maxX", 0) and bb.get("minY", 0) <= lat <= bb.get("maxY", 0)
        tiles.append({
            "file": url.rsplit("/", 1)[-1],
            "url": url,
            "size_mb": round((it.get("sizeInBytes") or 0) / 1e6),
            "project": newest,
            "year": projects[0].year,
            "contains_address": contains,
        })
    tiles.sort(key=lambda t: not t["contains_address"])
    return tiles[:4]


def usgs_tiles_at(lat: float, lon: float) -> list[dict]:
    """Tiles the user can download for a point (the area Scopit needs reaches ~100 m around it).

    The tiles are on USGS's download site, which does not allow automated access, so Scopit links
    to them and the user downloads them in the browser.
    """
    return tnm_tiles(_tnm_items(lat, lon, 0.0009), lat, lon)


@dataclass
class GeocodeResult:
    lat: float
    lon: float
    matched_address: str


def geocode(address: str) -> Optional[GeocodeResult]:
    """US Census geocoder (free, no key). Returns None when the address does not match."""
    params = {"address": address, "benchmark": "Public_AR_Current", "format": "json"}
    with httpx.Client(timeout=httpx.Timeout(20.0), headers={"User-Agent": USER_AGENT}) as client:
        resp = client.get(CENSUS_GEOCODER_URL, params=params)
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    m = matches[0]
    return GeocodeResult(lat=float(m["coordinates"]["y"]), lon=float(m["coordinates"]["x"]),
                         matched_address=m.get("matchedAddress", address))
