"""
Scopit - Roof Analyzer Tool API

EagleView files are parsed in the browser. The endpoints here measure a roof from free USGS LiDAR:
  POST /lidar/locate   address -> nearby buildings (outline + shaded LiDAR preview) to pick from
  POST /lidar/measure  picked point -> roof faces, typed edges and totals (RoofData shape)
"""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access

from .lidar.service import LidarError, locate, measure

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


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LidarError as e:
        raise HTTPException(status_code=422, detail=e.message)
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
    """Build the roof model for the building at (lat, lon)."""
    return _run(measure, body.lat, body.lon)


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
