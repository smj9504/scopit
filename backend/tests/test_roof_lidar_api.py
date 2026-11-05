"""
Roof Analyzer LiDAR endpoints: request validation and how service failures reach the client.
The LiDAR service itself is mocked (it downloads public data); the router runs for real.
"""
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.domains.tools.modules.roof_analyzer import api as roof_api
from app.domains.tools.modules.roof_analyzer.lidar.service import LidarError


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(roof_api.router, prefix="/api/tools/roof-analyzer")
    app.dependency_overrides[roof_api._gate] = lambda: object()
    return TestClient(app)


def test_locate_passes_address_and_returns_candidates(client):
    fake = {"address": "1 MAIN ST", "candidates": [{"id": 3}], "suggested_id": 3}
    with patch.object(roof_api, "locate", return_value=fake) as m:
        r = client.post("/api/tools/roof-analyzer/lidar/locate", json={"address": "1 Main St, Fairfax VA"})
    assert r.status_code == 200 and r.json() == fake
    m.assert_called_once_with(address="1 Main St, Fairfax VA", lat=None, lon=None)


def test_user_facing_failure_becomes_422_with_message(client):
    with patch.object(roof_api, "locate", side_effect=LidarError("no_coverage", "No free USGS LiDAR is available for this location yet.")):
        r = client.post("/api/tools/roof-analyzer/lidar/locate", json={"address": "somewhere"})
    assert r.status_code == 422
    assert r.json()["detail"] == "No free USGS LiDAR is available for this location yet."


def test_upstream_outage_becomes_502_without_internals(client):
    with patch.object(roof_api, "measure", side_effect=httpx.ConnectTimeout("s3 timed out")):
        r = client.post("/api/tools/roof-analyzer/lidar/measure", json={"lat": 38.86, "lon": -77.32})
    assert r.status_code == 502
    assert "s3" not in r.json()["detail"]


@pytest.mark.parametrize("body", [{"lat": 91, "lon": 0}, {"lat": 10}, {"lat": "x", "lon": 1}])
def test_measure_rejects_bad_coordinates(client, body):
    with patch.object(roof_api, "measure") as m:
        r = client.post("/api/tools/roof-analyzer/lidar/measure", json=body)
    assert r.status_code == 422
    m.assert_not_called()


def test_address_length_is_capped(client):
    with patch.object(roof_api, "locate") as m:
        r = client.post("/api/tools/roof-analyzer/lidar/locate", json={"address": "x" * 301})
    assert r.status_code == 422
    m.assert_not_called()
