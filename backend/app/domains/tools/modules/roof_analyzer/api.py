"""
Scopit - Roof Analyzer Tool API
Placeholder endpoints - full EagleView parsing + SVG visualization TBD.
"""
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.domains.tools.dependencies import require_tool_access

router = APIRouter()
_gate = require_tool_access("roof_analyzer")


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
