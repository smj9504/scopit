"""
LiDAR tiles the user downloads from USGS themselves.

Some surveys are only on USGS's download site, which does not allow automated access, so the user
downloads the tile in their browser and drops it into Scopit. The browser decompresses it and sends
only the points around the address. This module:
  - reads the LAS/LAZ header and VLRs (scale, offset, coordinate system) the browser sends first,
  - tells the browser which raw-coordinate box to keep,
  - turns the uploaded points into the same local metric frame the public-bucket path uses,
  - keeps them for a short while so locate -> measure can run on the same upload.
"""
from __future__ import annotations

import json
import math
import os
import re
import struct
import time
import uuid
from dataclasses import dataclass
from typing import Optional

import numpy as np
from pyproj import CRS, Transformer

from .ept import CACHE_DIR
from .pointcloud import utm_epsg

UPLOAD_DIR = os.path.join(CACHE_DIR, "uploads")
UPLOAD_TTL_S = 2 * 3600
KEEP_HALF_M = 125.0                # browser keeps points this far around the address (covers a pick 60 m off + its 60 m window)
MAX_UPLOAD_POINTS = 4_000_000
POINT_BYTES = 15                   # int32 x, y, z + uint8 class, return number, number of returns
_ID = re.compile(r"^[0-9a-f]{32}$")

# GeoTIFF linear unit codes -> metres
_GEOTIFF_UNITS = {9001: 1.0, 9002: 0.3048, 9003: 1200 / 3937}


class TileError(ValueError):
    """The dropped file cannot be used (not LAS/LAZ, unknown coordinate system, wrong area...)."""


@dataclass
class LasInfo:
    version: tuple[int, int]
    point_format: int
    point_length: int
    point_count: int
    scale: tuple[float, float, float]
    offset: tuple[float, float, float]
    bounds: tuple[float, float, float, float]       # min x, min y, max x, max y (file units)
    horizontal_wkt: str
    horizontal_unit_m: float
    vertical_unit_m: float
    crs_name: str


def _vlrs(blob: bytes, start: int, count: int, extended: bool):
    pos = start
    for _ in range(count):
        if extended:
            if pos + 60 > len(blob):
                return
            user_id = blob[pos + 2:pos + 18].rstrip(b"\0").decode("ascii", "ignore")
            record_id, length = struct.unpack_from("<HQ", blob, pos + 18)
            data_at = pos + 60
        else:
            if pos + 54 > len(blob):
                return
            user_id = blob[pos + 2:pos + 18].rstrip(b"\0").decode("ascii", "ignore")
            record_id, length = struct.unpack_from("<HH", blob, pos + 18)
            data_at = pos + 54
        yield user_id, record_id, blob[data_at:data_at + length]
        pos = data_at + length


def _crs_from_geokeys(keys: bytes) -> tuple[CRS, float, Optional[float]]:
    """GeoTIFF GeoKeyDirectory (older LAS 1.2/1.3 tiles): EPSG code plus linear/vertical units."""
    vals = struct.unpack(f"<{len(keys) // 2}H", keys[: len(keys) // 2 * 2])
    n = vals[3]
    entries = {vals[4 + 4 * i]: (vals[5 + 4 * i], vals[7 + 4 * i]) for i in range(n) if 7 + 4 * i < len(vals)}
    code = entries.get(3072, (0, 0))   # ProjectedCSTypeGeoKey, stored inline (location 0)
    if code[0] != 0 or code[1] in (0, 32767):
        raise TileError("This tile uses a custom coordinate system Scopit can't read yet.")
    crs = CRS.from_epsg(code[1])
    unit = crs.axis_info[0].unit_conversion_factor if crs.axis_info else 1.0
    lin = entries.get(3076)
    if lin and lin[0] == 0 and lin[1] in _GEOTIFF_UNITS:
        unit = _GEOTIFF_UNITS[lin[1]]
    vert = entries.get(4099)
    vunit = _GEOTIFF_UNITS.get(vert[1]) if vert and vert[0] == 0 else None
    return crs, unit, vunit


def parse_las_header(header: bytes, evlrs: bytes = b"") -> LasInfo:
    """Header + VLR bytes (file start up to the point data), and optionally the EVLR bytes."""
    if len(header) < 227 or header[:4] != b"LASF":
        raise TileError("That file is not a LAS/LAZ point cloud.")
    major, minor = header[24], header[25]
    header_size, offset_to_points, n_vlrs = struct.unpack_from("<HII", header, 94)
    point_format = header[104] & 0x3F         # strip the LAZ compression bits
    point_length = struct.unpack_from("<H", header, 105)[0]
    count = struct.unpack_from("<I", header, 107)[0]
    scale = struct.unpack_from("<3d", header, 131)
    offset = struct.unpack_from("<3d", header, 155)
    max_x, min_x, max_y, min_y = struct.unpack_from("<4d", header, 179)
    n_evlrs = 0
    if (major, minor) >= (1, 4) and len(header) >= 375:
        n_evlrs = struct.unpack_from("<I", header, 243)[0]
        count = struct.unpack_from("<Q", header, 247)[0] or count
    if point_format > 10:
        raise TileError("Unsupported LAS point format.")

    wkt = None
    geokeys = None
    records = list(_vlrs(header, header_size, n_vlrs, False))
    if evlrs and n_evlrs:
        records += list(_vlrs(evlrs, 0, n_evlrs, True))
    for user_id, record_id, data in records:
        if user_id == "LASF_Projection" and record_id == 2112:
            wkt = data.rstrip(b"\0").decode("utf-8", "ignore")
        elif user_id == "LASF_Projection" and record_id == 34735:
            geokeys = data

    if wkt:
        crs = CRS.from_wkt(wkt)
        horizontal, vertical = (crs.sub_crs_list[0], crs.sub_crs_list[1]) if crs.is_compound else (crs, None)
        if not horizontal.is_projected:
            raise TileError("This tile is not in a projected coordinate system.")
        h_unit = horizontal.axis_info[0].unit_conversion_factor
        v_unit = vertical.axis_info[0].unit_conversion_factor if vertical is not None and vertical.axis_info else h_unit
    elif geokeys:
        horizontal, h_unit, v_unit = _crs_from_geokeys(geokeys)
        v_unit = v_unit or h_unit     # USGS tiles in feet have feet heights too
    else:
        raise TileError("This tile has no coordinate system information.")
    return LasInfo((major, minor), point_format, point_length, count, scale, offset,
                   (min_x, min_y, max_x, max_y), horizontal.to_wkt(), h_unit, v_unit, horizontal.name)


def raw_box(info: LasInfo, lat: float, lon: float, half_m: float = KEEP_HALF_M) -> tuple[list[int], bool]:
    """Box (in the file's raw integer coordinates) the browser should keep; and whether the tile
    contains the address at all."""
    tr = Transformer.from_crs(4326, CRS.from_wkt(info.horizontal_wkt), always_xy=True)
    x, y = tr.transform(lon, lat)
    h = half_m / info.horizontal_unit_m * 1.05
    sx, sy, _ = info.scale
    ox, oy, _ = info.offset
    box = [math.floor((x - h - ox) / sx), math.floor((y - h - oy) / sy),
           math.ceil((x + h - ox) / sx), math.ceil((y + h - oy) / sy)]
    min_x, min_y, max_x, max_y = info.bounds
    covers = min_x <= x <= max_x and min_y <= y <= max_y
    return box, covers


# --- short-lived storage ---------------------------------------------------------------------------

def _path(kind: str, item_id: str, ext: str) -> str:
    if not _ID.match(item_id or ""):
        raise TileError("Unknown upload. Start again by entering the address.")
    return os.path.join(UPLOAD_DIR, f"{kind}-{item_id}.{ext}")


def _cleanup() -> None:
    now = time.time()
    for name in os.listdir(UPLOAD_DIR):
        p = os.path.join(UPLOAD_DIR, name)
        try:
            if now - os.path.getmtime(p) > UPLOAD_TTL_S:
                os.remove(p)
        except OSError:
            pass


def _write_json(path: str, data: dict) -> None:
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def _read_json(path: str, owner: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise TileError("This upload has expired. Enter the address again.")
    if data.get("owner") != owner:
        raise TileError("Unknown upload. Start again by entering the address.")
    return data


def prepare(owner: str, header: bytes, evlrs: bytes, lat: float, lon: float) -> dict:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    _cleanup()
    info = parse_las_header(header, evlrs)
    box, covers = raw_box(info, lat, lon)
    prep_id = uuid.uuid4().hex
    _write_json(_path("prep", prep_id, "json"), {
        "owner": owner, "lat": lat, "lon": lon, "scale": info.scale, "offset": info.offset,
        "wkt": info.horizontal_wkt, "v_unit": info.vertical_unit_m, "crs": info.crs_name,
    })
    return {"prep_id": prep_id, "raw_box": box, "covers_address": covers, "point_format": info.point_format,
            "point_length": info.point_length, "point_count": info.point_count, "crs": info.crs_name}


def add_points(owner: str, prep_id: str, upload_id: Optional[str], blob: bytes) -> dict:
    """Append one tile's points (struct-of-arrays, little endian) to an upload; returns its id."""
    prep = _read_json(_path("prep", prep_id, "json"), owner)
    if len(blob) % POINT_BYTES:
        raise TileError("The point data was cut off. Try dropping the file again.")
    n = len(blob) // POINT_BYTES
    if n > MAX_UPLOAD_POINTS:
        raise TileError("Too many points around this address.")
    ints = np.frombuffer(blob, dtype="<i4", count=3 * n).reshape(3, n).astype(np.float64)
    attrs = np.frombuffer(blob, dtype=np.uint8, offset=12 * n).reshape(3, n)
    scale, off = np.array(prep["scale"]), np.array(prep["offset"])
    native = ints * scale[:, None] + off[:, None]

    if upload_id:
        meta = _read_json(_path("upload", upload_id, "json"), owner)
    else:
        upload_id = uuid.uuid4().hex
        meta = {"owner": owner, "lat": prep["lat"], "lon": prep["lon"], "count": 0}
    lat0, lon0 = meta["lat"], meta["lon"]
    utm = utm_epsg(lon0, lat0)
    cx, cy = Transformer.from_crs(4326, utm, always_xy=True).transform(lon0, lat0)
    ux, uy = Transformer.from_crs(CRS.from_wkt(prep["wkt"]), utm, always_xy=True).transform(native[0], native[1])
    xyz = np.c_[np.asarray(ux) - cx, np.asarray(uy) - cy, native[2] * prep["v_unit"]].astype(np.float64)
    keep = (np.abs(xyz[:, 0]) <= KEEP_HALF_M * 1.1) & (np.abs(xyz[:, 1]) <= KEEP_HALF_M * 1.1)
    new = {"xyz": xyz[keep], "cls": attrs[0][keep], "ret": attrs[1][keep], "nret": attrs[2][keep]}

    data_path = _path("upload", upload_id, "npz")
    if os.path.exists(data_path):
        with np.load(data_path) as old:
            new = {k: np.concatenate([old[k], new[k]]) for k in new}
    np.savez(data_path.replace(".npz", ""), **new)
    meta["count"] = int(len(new["xyz"]))
    _write_json(_path("upload", upload_id, "json"), meta)
    return {"upload_id": upload_id, "points": meta["count"], "kept_from_tile": int(keep.sum())}


def set_upload_source(owner: str, upload_id: str, project: Optional[str], year: Optional[int]) -> None:
    """Remember which USGS survey the dropped tiles came from (shown with the result)."""
    path = _path("upload", upload_id, "json")
    meta = _read_json(path, owner)
    if project:
        meta["project"] = str(project)[:120]
    if year:
        meta["year"] = int(year)
    _write_json(path, meta)


def load_upload(owner: str, upload_id: str, lat: float, lon: float):
    """Points of an upload re-centred on (lat, lon). Returns (xyz, cls, ret, nret, meta)."""
    meta = _read_json(_path("upload", upload_id, "json"), owner)
    with np.load(_path("upload", upload_id, "npz")) as d:
        xyz, cls, ret, nret = d["xyz"].copy(), d["cls"].astype(int), d["ret"].astype(int), d["nret"].astype(int)
    utm = utm_epsg(meta["lon"], meta["lat"])
    fwd = Transformer.from_crs(4326, utm, always_xy=True)
    x0, y0 = fwd.transform(meta["lon"], meta["lat"])
    x1, y1 = fwd.transform(lon, lat)
    xyz[:, 0] -= x1 - x0
    xyz[:, 1] -= y1 - y0
    return xyz, cls, ret, nret, meta
