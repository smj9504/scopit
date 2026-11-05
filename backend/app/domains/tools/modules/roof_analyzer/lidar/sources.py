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
