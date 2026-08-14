"""
Item Recommender - Data Indexer

Loads JSON files from parsed_json, creates sentence embeddings,
and stores a FAISS index + metadata for fast similarity search.
Tracks file metadata (mtime, size) to detect when re-indexing is needed.

faiss and numpy are heavy imports (a C extension plus its numeric stack) that
add noticeable latency to process startup. They are only needed when the item
recommender actually indexes or searches — a feature that is disabled on the
free plan — so they are imported lazily inside the methods that use them
instead of at module load. `from __future__ import annotations` keeps the
`faiss.IndexFlatIP` type hint from forcing an import at class-definition time.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import time
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import faiss

logger = logging.getLogger(__name__)

# Model is loaded lazily on first use
_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading sentence-transformers model (all-MiniLM-L6-v2)...")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Model loaded.")
    return _model


def _build_embedding_text(item: dict) -> str:
    """Combine description + includes + excludes into a single text for embedding."""
    parts = []
    desc = item.get("description", "")
    if desc:
        parts.append(desc)

    defn = item.get("definition") or {}
    includes = defn.get("includes")
    if includes:
        parts.append(includes)
    excludes = defn.get("excludes")
    if excludes:
        parts.append(excludes)
    note = defn.get("note")
    if note:
        parts.append(note)

    return " | ".join(parts) if parts else desc


def _scan_json_files(data_dir: str) -> dict:
    """Return {filename: {"mtime": ..., "size": ...}} for all .json files."""
    meta = {}
    for fname in os.listdir(data_dir):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(data_dir, fname)
        stat = os.stat(fpath)
        meta[fname] = {"mtime": stat.st_mtime, "size": stat.st_size}
    return meta


def _load_all_items(data_dir: str) -> list[dict]:
    """Load all items from all JSON files in data_dir."""
    all_items = []
    for fname in sorted(os.listdir(data_dir)):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(data_dir, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            items = json.load(f)
        if isinstance(items, list):
            all_items.extend(items)
        elif isinstance(items, dict):
            all_items.append(items)
    return all_items


class ItemIndex:
    """FAISS-backed vector index for line item search."""

    def __init__(self, data_dir: str, index_dir: Optional[str] = None):
        self.data_dir = os.path.abspath(data_dir)
        if index_dir is None:
            index_dir = os.path.join(os.path.dirname(self.data_dir), ".index")
        self.index_dir = index_dir

        self.faiss_index: Optional[faiss.IndexFlatIP] = None
        self.items: list[dict] = []
        self.texts: list[str] = []
        self._file_meta: dict = {}

    @property
    def _faiss_path(self) -> str:
        return os.path.join(self.index_dir, "faiss.index")

    @property
    def _meta_path(self) -> str:
        return os.path.join(self.index_dir, "metadata.pkl")

    def needs_reindex(self) -> bool:
        """Check if index is stale by comparing file metadata."""
        if not os.path.exists(self._faiss_path) or not os.path.exists(self._meta_path):
            return True
        try:
            with open(self._meta_path, "rb") as f:
                saved = pickle.load(f)
            saved_files = saved.get("file_meta", {})
        except Exception:
            return True

        current_files = _scan_json_files(self.data_dir)
        return current_files != saved_files

    def load_or_build(self) -> None:
        """Load existing index or build a new one if needed."""
        if not self.needs_reindex():
            self._load_index()
            logger.info(f"Loaded existing index: {len(self.items)} items")
        else:
            logger.info("Index is stale or missing — rebuilding...")
            self.build_index()

    def build_index(self) -> None:
        """Build FAISS index from all JSON files."""
        import faiss
        import numpy as np

        start = time.time()
        self.items = _load_all_items(self.data_dir)
        self.texts = [_build_embedding_text(item) for item in self.items]

        model = _get_model()
        embeddings = model.encode(self.texts, show_progress_bar=True, normalize_embeddings=True, batch_size=64)
        embeddings = np.array(embeddings, dtype=np.float32)

        dim = embeddings.shape[1]
        self.faiss_index = faiss.IndexFlatIP(dim)  # inner product = cosine on normalized
        self.faiss_index.add(embeddings)

        self._file_meta = _scan_json_files(self.data_dir)
        self._save_index()
        elapsed = time.time() - start
        logger.info(f"Index built: {len(self.items)} items in {elapsed:.1f}s")

    def _save_index(self) -> None:
        import faiss

        os.makedirs(self.index_dir, exist_ok=True)
        faiss.write_index(self.faiss_index, self._faiss_path)
        with open(self._meta_path, "wb") as f:
            pickle.dump({
                "items": self.items,
                "texts": self.texts,
                "file_meta": self._file_meta,
            }, f)

    def _load_index(self) -> None:
        import faiss

        self.faiss_index = faiss.read_index(self._faiss_path)
        with open(self._meta_path, "rb") as f:
            saved = pickle.load(f)
        self.items = saved["items"]
        self.texts = saved["texts"]
        self._file_meta = saved.get("file_meta", {})

    def search(self, query: str, top_k: int = 30) -> list[tuple[dict, float]]:
        """Return top_k items with cosine similarity scores."""
        if self.faiss_index is None or len(self.items) == 0:
            return []

        import numpy as np

        model = _get_model()
        q_vec = model.encode([query], normalize_embeddings=True)
        q_vec = np.array(q_vec, dtype=np.float32)

        scores, indices = self.faiss_index.search(q_vec, min(top_k, len(self.items)))
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            results.append((self.items[idx], float(score)))
        return results

    @property
    def item_count(self) -> int:
        return len(self.items)
