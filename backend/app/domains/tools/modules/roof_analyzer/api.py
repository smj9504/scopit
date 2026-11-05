"""
Scopit - Roof Analyzer Tool API

EagleView files are parsed in the browser. The endpoints here measure a roof from free USGS LiDAR:
  POST /lidar/locate   address -> nearby buildings (outline + shaded LiDAR preview) to pick from,
                       or the USGS tiles to download when the survey is not in the public cloud copy
  POST /lidar/measure  picked point -> roof faces, typed edges and totals (RoofData shape)
  POST /lidar/tile/*   a tile the user downloaded: header -> keep-box, points, then locate as above
"""
import base64
import binascii
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access

from .lidar import upload
from .lidar.service import LidarError, locate, locate_upload, measure

router = APIRouter()
_gate = require_tool_access("roof_analyzer")
logger = logging.getLogger(__name__)


class LidarLocateRequest(BaseModel):
    address: Optional[str] = Field(None, max_length=300)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)


class LidarMeasureRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    upload_id: Optional[str] = Field(None, max_length=32)


class TilePrepareRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    header_b64: str = Field(..., max_length=1_500_000)      # LAS header + VLRs (start of the file)
    evlr_b64: Optional[str] = Field(None, max_length=6_000_000)


class TileLocateRequest(BaseModel):
    upload_id: str = Field(..., max_length=32)
    address: str = Field(..., max_length=300)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    project: Optional[str] = Field(None, max_length=120)
    year: Optional[int] = Field(None, ge=1990, le=2100)


MAX_POINTS_BODY = upload.MAX_UPLOAD_POINTS * upload.POINT_BYTES


def _owner(user) -> str:
    return str(getattr(user, "id", ""))


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LidarError as e:
        raise HTTPException(status_code=422, detail=e.message)
    except upload.TileError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except httpx.HTTPError as e:
        logger.warning("LiDAR source request failed: %s", e)
        raise HTTPException(status_code=502, detail="The free LiDAR service did not respond. Try again in a minute.")


# Plain `def` on purpose: downloading and fitting the point cloud is blocking work, and FastAPI runs
# sync endpoints in its thread pool instead of the event loop.
@router.post("/lidar/locate")
def lidar_locate(body: LidarLocateRequest, current_user=Depends(_gate)):
    """Geocode the address and list the buildings around it, with a shaded LiDAR preview."""
    return _run(locate, address=body.address, lat=body.lat, lon=body.lon)


@router.post("/lidar/measure")
def lidar_measure(body: LidarMeasureRequest, current_user=Depends(_gate)):
    """Build the roof model for the building at (lat, lon) (from a dropped tile when upload_id is set)."""
    return _run(measure, body.lat, body.lon, owner=_owner(current_user), upload_id=body.upload_id)


# --- tiles the user downloads from USGS and drops in (the browser decompresses them) ---------------

@router.post("/lidar/tile/prepare")
def lidar_tile_prepare(body: TilePrepareRequest, current_user=Depends(_gate)):
    """Read the tile's header: coordinate system, and the raw-coordinate box the browser should keep."""
    try:
        header = base64.b64decode(body.header_b64, validate=True)
        evlrs = base64.b64decode(body.evlr_b64, validate=True) if body.evlr_b64 else b""
    except binascii.Error:
        raise HTTPException(status_code=422, detail="That file is not a LAS/LAZ point cloud.")
    return _run(upload.prepare, _owner(current_user), header, evlrs, body.lat, body.lon)


@router.post("/lidar/tile/points")
async def lidar_tile_points(
    request: Request,
    prep_id: str = Query(..., max_length=32),
    upload_id: Optional[str] = Query(None, max_length=32),
    current_user=Depends(_gate),
):
    """Points around the address from one tile (int32 x/y/z then uint8 class/return/returns arrays)."""
    if int(request.headers.get("content-length") or 0) > MAX_POINTS_BODY:
        raise HTTPException(status_code=413, detail="Too many points around this address.")
    blob = await request.body()
    if len(blob) > MAX_POINTS_BODY:
        raise HTTPException(status_code=413, detail="Too many points around this address.")
    return await run_in_threadpool(_run, upload.add_points, _owner(current_user), prep_id, upload_id, blob)


@router.post("/lidar/tile/locate")
def lidar_tile_locate(body: TileLocateRequest, current_user=Depends(_gate)):
    """Buildings around the address, from the dropped tile(s)."""
    return _run(locate_upload, _owner(current_user), body.upload_id, body.address, body.lat, body.lon,
                body.project, body.year)


@router.post("/upload")
async def upload_eagleview_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(_gate),
):
    """Upload an EagleView measurement file (XML/JSON/PDF). Placeholder."""
    return {
        "message": "File received",
        "filename": file.filename,
        "content_type": file.content_type,
        "status": "pending_implementation",
    }


@router.post("/analyze/{session_id}")
async def analyze_roof(
    session_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(_gate),
):
    """Run slope calculations and face analysis. Placeholder."""
    return {
        "session_id": session_id,
        "faces": [],
        "total_area_sqft": 0,
        "ridge_length_ft": 0,
        "valley_length_ft": 0,
        "status": "pending_implementation",
    }
