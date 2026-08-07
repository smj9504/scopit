"""
Item Recommender - FastAPI Endpoints

/search  - Semantic search with grouped results
/reindex - Force re-indexing
/status  - Index status info
"""
import logging
import os
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.config import settings
from app.domains.tools.dependencies import require_tool_access

from .indexer import ItemIndex
from .search import search_and_group

logger = logging.getLogger(__name__)
router = APIRouter()
_gate = require_tool_access("item_recommender")


def _ensure_enabled() -> None:
    """Guard heavy endpoints so a memory-constrained host (e.g. Render free
    plan) returns a clean 503 instead of OOM-crashing the whole process."""
    if not settings.ITEM_RECOMMENDER_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Item recommender is currently disabled on this deployment.",
        )

# ── Index singleton ─────────────────────────────────────────────────────

# parsed_json lives at project root (sibling of backend/)
_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "..", "parsed_json")
_DATA_DIR = os.path.abspath(_DATA_DIR)

_index: Optional[ItemIndex] = None
_index_lock = threading.Lock()
_reindex_in_progress = False


def _get_index() -> ItemIndex:
    global _index
    if _index is None:
        with _index_lock:
            if _index is None:
                _index = ItemIndex(data_dir=_DATA_DIR)
                _index.load_or_build()
    return _index


def _background_reindex():
    """Rebuild index in background, swap when done."""
    global _index, _reindex_in_progress
    try:
        _reindex_in_progress = True
        new_index = ItemIndex(data_dir=_DATA_DIR)
        new_index.build_index()
        with _index_lock:
            _index = new_index
        logger.info("Background reindex complete.")
    except Exception as e:
        logger.error(f"Background reindex failed: {e}")
    finally:
        _reindex_in_progress = False


# ── Schemas ─────────────────────────────────────────────────────────────

class SearchResultItem(BaseModel):
    item_code: str
    category: str
    description: str
    includes: Optional[str] = None
    excludes: Optional[str] = None
    note: Optional[str] = None
    unit_price: float
    labor_cost: float
    material_cost: float
    score: float


class SearchResultGroup(BaseModel):
    key: str
    label: str
    items: list[SearchResultItem]


class SearchResponse(BaseModel):
    query: str
    total: int
    groups: list[SearchResultGroup]


class IndexStatusResponse(BaseModel):
    item_count: int
    data_dir: str
    needs_reindex: bool
    reindex_in_progress: bool


# ── Endpoints ───────────────────────────────────────────────────────────

@router.get("/search", response_model=SearchResponse)
async def search_items(
    q: str = Query(..., min_length=2, description="Search query (e.g. 'Hardwood floor replacement')"),
    top_k: int = Query(50, ge=5, le=100, description="Number of candidates to retrieve"),
    min_score: float = Query(0.35, ge=0.0, le=1.0, description="Minimum combined score"),
    current_user=Depends(_gate),
):
    """Search line items by semantic similarity and return grouped results."""
    _ensure_enabled()
    index = _get_index()

    # Auto-detect stale index → background reindex
    if index.needs_reindex() and not _reindex_in_progress:
        thread = threading.Thread(target=_background_reindex, daemon=True)
        thread.start()

    result = search_and_group(index, query=q, top_k=top_k, min_score=min_score)
    return result


@router.post("/reindex")
async def force_reindex(
    current_user=Depends(_gate),
):
    """Force a full re-index of all JSON data files."""
    _ensure_enabled()
    global _reindex_in_progress
    if _reindex_in_progress:
        return {"status": "already_in_progress"}

    thread = threading.Thread(target=_background_reindex, daemon=True)
    thread.start()
    return {"status": "started"}


@router.get("/status", response_model=IndexStatusResponse)
async def index_status(
    current_user=Depends(_gate),
):
    """Return current index status."""
    _ensure_enabled()
    index = _get_index()
    return IndexStatusResponse(
        item_count=index.item_count,
        data_dir=index.data_dir,
        needs_reindex=index.needs_reindex(),
        reindex_in_progress=_reindex_in_progress,
    )
