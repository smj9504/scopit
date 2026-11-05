"""
Roof model from LiDAR points: synthetic roofs with known geometry (no network).

Each roof is sampled like an airborne survey (jittered ~0.2 m grid, 2 cm noise) and the model must
recover the sloped area, the pitch and the edge types/lengths a roofer would order material from.
"""
import math

import numpy as np
import pytest

from app.domains.tools.modules.roof_analyzer.lidar.roofmodel import build_roof

M2_FT2 = 10.7639
M_FT = 3.28084
F_6_12 = math.sqrt(1 + 0.5 ** 2)


def sample(inside, z_fn, bounds, spacing=0.2, noise=0.02, seed=1):
    rng = np.random.default_rng(seed)
    x0, x1, y0, y1 = bounds
    X, Y = np.meshgrid(np.arange(x0, x1, spacing), np.arange(y0, y1, spacing))
    X = X + rng.uniform(-spacing / 3, spacing / 3, X.shape)
    Y = Y + rng.uniform(-spacing / 3, spacing / 3, Y.shape)
    x, y = X.ravel(), Y.ravel()
    m = inside(x, y)
    x, y = x[m], y[m]
    return np.c_[x, y, z_fn(x, y) + rng.normal(0, noise, x.shape)]


def totals(result):
    return result["summary"]["line_totals_ft"]


def test_gable_roof_area_pitch_and_edges():
    # 12 m x 8 m, ridge along x at y = 0, 6/12
    P = sample(lambda x, y: (x >= 0) & (x <= 12) & (np.abs(y) <= 4),
               lambda x, y: 10 + 0.5 * (4 - np.abs(y)), (0, 12, -4, 4))
    r = build_roof(P, ground_z=5.0)
    s = r["summary"]
    assert s["predominant_pitch"] == 6
    assert s["facets"] == 2
    assert s["total_area_sqft"] == pytest.approx(12 * 8 * F_6_12 * M2_FT2, rel=0.04)
    t = totals(r)
    assert t["RIDGE"] == pytest.approx(12 * M_FT, rel=0.08)
    assert t["EAVE"] == pytest.approx(24 * M_FT, rel=0.08)
    assert t["RAKE"] == pytest.approx(4 * math.hypot(4, 2) * M_FT, rel=0.12)
    assert "HIP" not in t and "VALLEY" not in t


def test_hip_roof_has_hips_and_short_ridge_no_rakes():
    # 14 m x 10 m, 6/12 on all four sides: ridge 4 m, four hips
    P = sample(lambda x, y: (x >= 0) & (x <= 14) & (np.abs(y) <= 5),
               lambda x, y: 10 + 0.5 * np.minimum(np.minimum(x, 14 - x), 5 - np.abs(y)), (0, 14, -5, 5))
    r = build_roof(P, ground_z=5.0)
    s = r["summary"]
    assert s["facets"] == 4
    assert s["predominant_pitch"] == 6
    assert s["total_area_sqft"] == pytest.approx(140 * F_6_12 * M2_FT2, rel=0.04)
    t = totals(r)
    hip_3d = math.sqrt(5 ** 2 + 5 ** 2 + 2.5 ** 2)
    assert t["HIP"] == pytest.approx(4 * hip_3d * M_FT, rel=0.10)
    assert t["RIDGE"] == pytest.approx(4 * M_FT, abs=4)
    assert t["EAVE"] == pytest.approx(48 * M_FT, rel=0.08)
    assert "RAKE" not in t


def test_l_shaped_roof_finds_valley():
    # main gable 14 x 8 (ridge along x) plus a wing 8 x 6 to the south (ridge along y)
    def inside(x, y):
        return ((x >= 0) & (x <= 14) & (y >= 0) & (y <= 8)) | ((x >= 0) & (x <= 8) & (y >= -6) & (y <= 8))

    def z(x, y):
        za = np.where((x <= 14) & (y >= 0), 10 + 0.5 * (4 - np.abs(y - 4)), -np.inf)
        zb = np.where((x <= 8), 10 + 0.5 * (4 - np.abs(x - 4)), -np.inf)
        return np.maximum(za, zb)

    P = sample(inside, z, (0, 14, -6, 8))
    r = build_roof(P, ground_z=5.0)
    t = totals(r)
    assert "VALLEY" in t and t["VALLEY"] > 3 * M_FT
    assert "RIDGE" in t
    assert r["summary"]["total_area_sqft"] == pytest.approx((14 * 8 + 8 * 6) * F_6_12 * M2_FT2, rel=0.05)


def test_porch_roof_against_wall_gets_flashing():
    # house gable (eave at 10 m) with a low 3/12 porch roof tucked against its south wall
    def inside(x, y):
        return (x >= 0) & (x <= 12) & (y >= -6) & (y <= 4)

    def z(x, y):
        house = 10 + 0.5 * (4 - np.abs(y))
        porch = 6 + 0.25 * (y + 6)
        return np.where(y >= -4, house, porch)

    P = sample(inside, z, (0, 12, -6, 4))
    r = build_roof(P, ground_z=5.0)
    t = totals(r)
    assert t.get("FLASHING", 0) == pytest.approx(12 * M_FT, rel=0.12)
    assert r["summary"]["facets"] == 3


def test_rounded_ridge_does_not_become_extra_faces():
    # LiDAR sees a ridge cap as a narrow flat band; it must not add facets or fake ridges
    P = sample(lambda x, y: (x >= 0) & (x <= 12) & (np.abs(y) <= 4),
               lambda x, y: 10 + 0.5 * (4 - np.maximum(np.abs(y), 0.4)), (0, 12, -4, 4))
    r = build_roof(P, ground_z=5.0)
    assert r["summary"]["facets"] == 2
    assert totals(r)["RIDGE"] == pytest.approx(12 * M_FT, rel=0.12)


def test_steep_wing_meeting_main_roof_is_a_valley_not_a_step():
    # main gable 12/12 (ridge along x); a steeper 18/12 front wing runs south into it
    def inside(x, y):
        return ((x >= 0) & (x <= 16) & (y >= 0) & (y <= 8)) | ((x >= 5) & (x <= 11) & (y >= -6) & (y <= 4))

    def z(x, y):
        main = np.where(y >= 0, 10 + 1.0 * (4 - np.abs(y - 4)), -np.inf)
        wing = np.where((x >= 5) & (x <= 11), 10 + 1.5 * (3 - np.abs(x - 8)), -np.inf)
        return np.maximum(main, wing)

    r = build_roof(sample(inside, z, (0, 16, -6, 8)), ground_z=5.0)
    t = totals(r)
    assert t.get("VALLEY", 0) > 2 * 3 * M_FT        # two valleys, each well over 3 m
    assert t.get("STEPFLASH", 0) < 2 * M_FT


def test_mansard_faces_are_roof_not_wall():
    # 22/12 lower faces (61 deg) around a 4/12 top: all of it is roofing
    def z(x, y):
        d = np.minimum(np.minimum(x, 12 - x), np.minimum(y, 10 - y))   # distance in from the eave
        return np.where(d < 1.2, 6 + d * 22 / 12, 6 + 1.2 * 22 / 12 + (d - 1.2) * 4 / 12)

    r = build_roof(sample(lambda x, y: (x >= 0) & (x <= 12) & (y >= 0) & (y <= 10), z, (0, 12, 0, 10)), ground_z=0.0)
    steep = sum(v for k, v in r["summary"]["area_by_pitch"].items() if int(k) >= 20)
    assert steep > 0.25 * r["summary"]["total_area_sqft"]


def test_output_is_consistent_roofdata():
    P = sample(lambda x, y: (x >= 0) & (x <= 12) & (np.abs(y) <= 4),
               lambda x, y: 10 + 0.5 * (4 - np.abs(y)), (0, 12, -4, 4))
    roof = build_roof(P, ground_z=5.0)["roof"]
    for line in roof["lines"].values():
        assert len(line["ptIds"]) >= 2 and all(p in roof["points"] for p in line["ptIds"])
        assert line["length"] > 0
    for face in roof["faces"]:
        assert len(face["vertices"]) >= 3
        assert face["lineIds"] and all(l in roof["lines"] for l in face["lineIds"])
        assert face["area"] > 0 and face["pitch"] == "6"
    # ridge points sit 2 m (6.56 ft) above the eave points
    zs = sorted(p["z"] for p in roof["points"].values())
    assert zs[-1] - zs[0] == pytest.approx(2 * M_FT, abs=0.5)
