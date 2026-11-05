"""
Tiles the user downloads from USGS and drops in: header parsing (WKT and GeoTIFF keys, metres and
US survey feet), the keep-box the browser filters with, and locate -> measure on the uploaded points.

The tiles are written here with laspy (like USGS's): a 6/12 gable house with ground around it,
centred on a real lat/lon, in the tile's projected coordinate system.
"""
import io
import math
import struct

import laspy
import numpy as np
import pytest
from pyproj import CRS, Transformer

from app.domains.tools.modules.roof_analyzer.lidar import service, upload

LAT, LON = 38.861628, -77.321635          # Fairfax, VA (UTM 18N)
M2_FT2 = 10.7639
HOUSE_PLAN_M2 = 12 * 8                     # 12 m x 8 m, ridge along x
F_6_12 = math.sqrt(1 + 0.25)


def _scene_utm():
    rng = np.random.default_rng(7)
    gx, gy = np.meshgrid(np.arange(-80, 80, 0.7), np.arange(-80, 80, 0.7))
    gx, gy = gx.ravel(), gy.ravel()
    off_house = ~((np.abs(gx) <= 6) & (np.abs(gy) <= 4))
    ground = np.c_[gx[off_house], gy[off_house], np.full(off_house.sum(), 100.0)]
    hx, hy = np.meshgrid(np.arange(-6, 6, 0.2), np.arange(-4, 4, 0.2))
    hx = hx.ravel() + rng.uniform(-0.06, 0.06, hx.size)
    hy = hy.ravel() + rng.uniform(-0.06, 0.06, hy.size)
    house = np.c_[hx, hy, 106 + 0.5 * (4 - np.abs(hy)) + rng.normal(0, 0.02, hx.size)]
    xyz = np.vstack([ground, house])
    cls = np.r_[np.full(len(ground), 2), np.full(len(house), 6)].astype(np.uint8)
    utm = CRS.from_epsg(32618)
    cx, cy = Transformer.from_crs(4326, utm, always_xy=True).transform(LON, LAT)
    return xyz + [cx, cy, 0], cls, utm


def _write_tile(target: CRS, version: str, point_format: int, z_unit_m: float, crs_vlr) -> bytes:
    xyz, cls, utm = _scene_utm()
    x, y = Transformer.from_crs(utm, target, always_xy=True).transform(xyz[:, 0], xyz[:, 1])
    h_unit = target.axis_info[0].unit_conversion_factor
    header = laspy.LasHeader(point_format=point_format, version=version)
    header.scales = np.array([0.01, 0.01, 0.01])
    header.offsets = np.array([np.floor(np.min(x)), np.floor(np.min(y)), 0.0])
    crs_vlr(header)
    las = laspy.LasData(header)
    las.x, las.y, las.z = x, y, xyz[:, 2] / z_unit_m
    las.classification = cls
    las.return_number = np.ones(len(x), np.uint8)
    las.number_of_returns = np.ones(len(x), np.uint8)
    buf = io.BytesIO()
    las.write(buf, do_compress=True)
    assert h_unit > 0
    return buf.getvalue()


def _wkt_tile():
    crs = CRS.from_user_input("EPSG:6347+5703")       # NAD83(2011) / UTM 18N + NAVD88 height (m)

    def add(h):
        h.vlrs.append(laspy.VLR("LASF_Projection", 2112, "OGC WKT", crs.to_wkt().encode() + b"\0"))
    return _write_tile(CRS.from_epsg(6347), "1.4", 6, 1.0, add)


def _geokey_tile():
    # NAD83 / Virginia North (ftUS), heights in ftUS, the way older LAS 1.2 tiles carry it
    keys = [1, 1, 0, 5, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 2283, 3076, 0, 1, 9003, 4099, 0, 1, 9003]

    def add(h):
        h.vlrs.append(laspy.VLR("LASF_Projection", 34735, "GeoKeyDirectoryTag", struct.pack(f"<{len(keys)}H", *keys)))
    return _write_tile(CRS.from_epsg(2283), "1.2", 1, 1200 / 3937, add)


def _browser(tile: bytes):
    """What the browser does: header bytes, then the raw points inside the keep-box, packed."""
    offset = struct.unpack_from("<I", tile, 96)[0]
    header = tile[:offset]
    las = laspy.read(io.BytesIO(tile))
    return header, las


def _pack(las, box):
    X, Y, Z = np.asarray(las.X), np.asarray(las.Y), np.asarray(las.Z)
    m = (X >= box[0]) & (X <= box[2]) & (Y >= box[1]) & (Y <= box[3])
    n = int(m.sum())
    parts = [X[m].astype("<i4"), Y[m].astype("<i4"), Z[m].astype("<i4"),
             np.asarray(las.classification)[m].astype(np.uint8),
             np.asarray(las.return_number)[m].astype(np.uint8),
             np.asarray(las.number_of_returns)[m].astype(np.uint8)]
    return b"".join(p.tobytes() for p in parts), n


@pytest.fixture(autouse=True)
def _tmp_uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(upload, "UPLOAD_DIR", str(tmp_path))


@pytest.mark.parametrize("make, unit", [(_wkt_tile, 1.0), (_geokey_tile, 1200 / 3937)])
def test_header_gives_crs_units_and_keep_box(make, unit):
    header, las = _browser(make())
    info = upload.parse_las_header(header)
    assert info.horizontal_unit_m == pytest.approx(unit)
    assert info.vertical_unit_m == pytest.approx(unit)
    box, covers = upload.raw_box(info, LAT, LON)
    assert covers
    # the keep-box is ~180 m wide whatever the unit
    width_m = (box[2] - box[0]) * info.scale[0] * unit
    assert width_m == pytest.approx(2 * upload.KEEP_HALF_M * 1.05, rel=0.01)


@pytest.mark.parametrize("make", [_wkt_tile, _geokey_tile])
def test_dropped_tile_measures_the_house(make):
    header, las = _browser(make())
    prep = upload.prepare("u1", header, b"", LAT, LON)
    assert prep["covers_address"]
    blob, n = _pack(las, prep["raw_box"])
    added = upload.add_points("u1", prep["prep_id"], None, blob)
    assert added["points"] == n

    found = service.locate_upload("u1", added["upload_id"], "1 Test St", LAT, LON, "VA_Test_2024", 2024)
    assert found["suggested_id"] is not None
    pick = next(c for c in found["candidates"] if c["id"] == found["suggested_id"])["pick"]
    r = service.measure(pick["lat"], pick["lon"], owner="u1", upload_id=added["upload_id"])
    s = r["summary"]
    assert s["predominant_pitch"] == 6
    assert s["total_area_sqft"] == pytest.approx(HOUSE_PLAN_M2 * F_6_12 * M2_FT2, rel=0.05)
    assert r["source"]["project"] == "VA_Test_2024" and r["source"]["year"] == 2024


def test_upload_belongs_to_its_owner():
    header, las = _browser(_wkt_tile())
    prep = upload.prepare("u1", header, b"", LAT, LON)
    blob, _ = _pack(las, prep["raw_box"])
    with pytest.raises(upload.TileError):
        upload.add_points("someone-else", prep["prep_id"], None, blob)
    added = upload.add_points("u1", prep["prep_id"], None, blob)
    with pytest.raises(service.LidarError):
        service.measure(LAT, LON, owner="someone-else", upload_id=added["upload_id"])


def test_rejects_non_las_and_bad_ids():
    with pytest.raises(upload.TileError):
        upload.parse_las_header(b"PK\x03\x04" + b"\0" * 400)
    with pytest.raises(upload.TileError):
        upload.add_points("u1", "../../etc/passwd", None, b"")
    header, _ = _browser(_wkt_tile())
    prep = upload.prepare("u1", header, b"", LAT, LON)
    with pytest.raises(upload.TileError):
        upload.add_points("u1", prep["prep_id"], None, b"\0" * 14)    # not a whole point
