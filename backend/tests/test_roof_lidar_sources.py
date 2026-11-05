"""
LiDAR sources and point selection without network: picking roof points from a survey that has no
building class, and reading survey names from the USGS National Map catalogue.
"""
import numpy as np

from app.domains.tools.modules.roof_analyzer.lidar.pointcloud import _derived_building_points
from app.domains.tools.modules.roof_analyzer.lidar.sources import project_year, tnm_project_names, tnm_tiles


def _scene(seed=3):
    """A 6/12 gable house (single returns), a tree (multi-return, irregular) and ground."""
    rng = np.random.default_rng(seed)
    gx, gy = np.meshgrid(np.arange(-20, 20, 0.35), np.arange(-20, 20, 0.35))
    ground = np.c_[gx.ravel(), gy.ravel(), np.zeros(gx.size)]
    hx, hy = np.meshgrid(np.arange(-6, 6, 0.2), np.arange(-4, 4, 0.2))
    hx, hy = hx.ravel(), hy.ravel()
    house = np.c_[hx, hy, 6 + 0.5 * (4 - np.abs(hy)) + rng.normal(0, 0.02, hx.size)]
    n = 2500
    tree = np.c_[rng.normal(12, 1.5, n), rng.normal(10, 1.5, n), rng.uniform(3, 9, n)]
    xyz = np.vstack([ground, house, tree])
    cls = np.r_[np.full(len(ground), 2), np.ones(len(house) + n, int)]
    nret = np.r_[np.ones(len(ground) + len(house), int), np.full(n, 3)]
    ret = np.r_[np.ones(len(ground) + len(house), int), rng.integers(1, 4, n)]
    return xyz, cls, ret, nret, len(house)


def test_derived_points_keep_whole_roof_including_ridge_and_edges():
    xyz, cls, ret, nret, n_house = _scene()
    B = _derived_building_points(xyz, cls, ret, nret, lambda x, y: np.zeros_like(x), 25.0)
    in_house = (np.abs(B[:, 0]) <= 6.01) & (np.abs(B[:, 1]) <= 4.01)
    assert in_house.sum() > 0.95 * n_house             # ridge and eave points are not lost
    assert (np.abs(B[in_house, 1]) < 0.3).sum() > 50     # the ridge line itself is there
    assert (~in_house).sum() < 0.05 * len(B)             # the tree stays out


def test_tnm_titles_give_newest_survey_first():
    items = [
        {"title": "USGS Lidar Point Cloud UT_OGDENVALLEY_2011 000010", "downloadURL": "a"},
        {"title": "USGS Lidar Point Cloud UT_StatewideNCentral_2020_A20 12TVL3170", "downloadURL": "b"},
        {"title": "USGS Lidar Point Cloud UT_StatewideNCentral_2020_A20 12TVL3171", "downloadURL": "c"},
        {"title": "Something else"},
    ]
    names = [(p.name, p.year) for p in tnm_project_names(items)]
    assert names == [("UT_StatewideNCentral_2020_A20", 2020), ("UT_OGDENVALLEY_2011", 2011)]


def test_tiles_of_the_newest_survey_with_the_address_tile_first():
    def item(project, tile, bb):
        return {"title": f"USGS Lidar Point Cloud {project} {tile}", "sizeInBytes": 228_869_420,
                "downloadURL": f"https://rockyweb.usgs.gov/x/{project}/LAZ/USGS_LPC_{project}_{tile}.laz",
                "boundingBox": bb}
    lat, lon = 39.1663, -77.2970
    items = [
        item("MD_Central_Processing_D24", "225NW14", {"minX": -77.32, "maxX": -77.3054, "minY": 39.16, "maxY": 39.18}),
        item("MD_Central_Processing_D24", "226NW14", {"minX": -77.3053, "maxX": -77.2841, "minY": 39.164, "maxY": 39.175}),
        item("MD_STATEWIDE_2004", "001626", {"minX": -77.31, "maxX": -77.28, "minY": 39.16, "maxY": 39.18}),
    ]
    tiles = tnm_tiles(items, lat, lon)
    assert [t["file"] for t in tiles] == ["USGS_LPC_MD_Central_Processing_D24_226NW14.laz",
                                          "USGS_LPC_MD_Central_Processing_D24_225NW14.laz"]
    assert tiles[0]["contains_address"] and not tiles[1]["contains_address"]
    assert tiles[0]["year"] == 2024 and tiles[0]["size_mb"] == 229


def test_project_year_from_usgs_names():
    assert project_year("VA_Fairfax_County_2018") == 2018
    assert project_year("VA_NorthernVA_1_B22") == 2022
    assert project_year("MD_Central_Processing_D24") == 2024
    assert project_year("USGS_LPC_MD_VA_Sandy_NCR_2014_LAS_2015") == 2015
    assert project_year("NoYearHere") is None
