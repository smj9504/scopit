"""
Item Recommender - Search Engine

Handles query → vector search → keyword filtering → group classification.
Groups: pre_work, main_work, related_materials, trim_finish, post_work
"""
import re

from .indexer import ItemIndex

# ── Group Classification Rules ──────────────────────────────────────────
# Each group has keyword patterns matched against category, description, includes, note

GROUP_RULES = {
    "pre_work": {
        "category_prefixes": ["DMO", "CNT", "CON", "TMP"],
        "keywords": [
            "demolition", "demo", "remove", "removal", "tear", "rip",
            "content manipulation", "move contents", "protect", "protection",
            "containment", "barrier", "dust control", "plastic", "mask",
            "prep", "preparation", "debris", "detach", "disconnect",
            "furniture", "appliance", "cover", "covering",
        ],
    },
    "main_work": {
        "category_prefixes": [
            "FLR", "FCW", "FCL", "FCV", "FCT", "FCC",
            "RFG", "SID", "DRW", "PLT", "WDW", "PLM",
            "ELC", "HVC", "INS", "CTR", "CAB", "CPS",
            "CEL", "PNT", "WTR", "FNC", "PNL", "MTL",
            "DOR", "WDR", "ACT",
        ],
        "keywords": [
            "install", "replace", "lay", "apply", "hang", "set",
            "floor", "hardwood", "laminate", "vinyl", "tile", "carpet",
            "roof", "shingle", "siding", "drywall", "paint", "plumb",
            "electric", "hvac", "insulation", "countertop", "cabinet",
        ],
    },
    "related_materials": {
        "category_prefixes": ["MAT", "ADH"],
        "keywords": [
            "underlayment", "adhesive", "glue", "moisture barrier",
            "vapor barrier", "substrate", "backer", "membrane",
            "primer", "sealer", "caulk", "grout", "mortar", "thinset",
            "nail", "screw", "fastener", "staple", "pad", "foam",
            "felt", "paper", "wrap",
        ],
    },
    "trim_finish": {
        "category_prefixes": ["TRM", "MLG", "BSE", "CAS"],
        "keywords": [
            "trim", "molding", "moulding", "baseboard", "base board",
            "quarter round", "shoe", "transition", "threshold",
            "casing", "crown", "chair rail", "wainscot",
            "finish", "stain", "varnish", "polyurethane", "lacquer",
        ],
    },
    "post_work": {
        "category_prefixes": ["CLN", "HUL"],
        "keywords": [
            "clean", "cleaning", "final clean", "sweep",
            "haul", "hauling", "dump", "disposal", "trash",
            "debris removal", "load", "dumpster",
        ],
    },
}


def _text_for_matching(item: dict) -> str:
    """Build a lowercase text blob from item for keyword matching."""
    parts = [
        item.get("description", ""),
        item.get("category", ""),
        item.get("item_code", ""),
    ]
    defn = item.get("definition") or {}
    for key in ("includes", "excludes", "note"):
        val = defn.get(key)
        if val:
            parts.append(val)
    return " ".join(parts).lower()


def classify_group(item: dict) -> str:
    """Classify an item into one of the 5 groups."""
    cat = (item.get("category") or "").upper()
    text = _text_for_matching(item)
    desc = (item.get("description") or "").lower()

    # Override: tear-out / removal items → always pre_work
    pre_signals = [
        "tear out", "tear off", "remove ", "removal",
        "detach", "demolition", "rip out", "rip up",
    ]
    if any(s in desc for s in pre_signals):
        return "pre_work"

    # Override: cleaning items → always post_work
    if "clean" in desc and "pre-clean" not in desc:
        return "post_work"

    # Override: haul / disposal → always post_work
    if any(s in desc for s in ["haul", "dump", "disposal"]):
        return "post_work"

    # Check category prefix (strong signal)
    for group, rules in GROUP_RULES.items():
        for prefix in rules.get("category_prefixes", []):
            if cat.startswith(prefix):
                return group

    # Fall back to keyword matching
    scores = {}
    for group, rules in GROUP_RULES.items():
        score = 0
        for kw in rules["keywords"]:
            if kw in text:
                score += 1
        scores[group] = score

    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best

    return "main_work"  # default


def _keyword_relevance(item: dict, query_words: list[str]) -> float:
    """Secondary keyword-based relevance score (0-1)."""
    text = _text_for_matching(item)
    if not query_words:
        return 0.0
    matches = sum(1 for w in query_words if w in text)
    return matches / len(query_words)


GROUP_ORDER = ["pre_work", "main_work", "related_materials", "trim_finish", "post_work"]
GROUP_LABELS = {
    "pre_work": "Pre-work",
    "main_work": "Main Work",
    "related_materials": "Related Materials",
    "trim_finish": "Trim & Finish",
    "post_work": "Post-work",
}


def _find_score_cutoff(scores: list[float], min_score: float) -> float:
    """Find adaptive cutoff using top-score relative threshold.

    Items must score at least 60% of the top result to be included.
    This allows related items from different work phases (e.g. install
    items when tear-out scores highest) while still filtering noise.
    Also enforces the absolute min_score floor.
    """
    if not scores:
        return min_score
    top = scores[0]
    relative_cutoff = top * 0.60
    return max(relative_cutoff, min_score)


def search_and_group(
    index: ItemIndex,
    query: str,
    top_k: int = 50,
    min_score: float = 0.35,
) -> dict:
    """
    Search for items and return grouped results.

    Fetches 4x candidates from FAISS to account for duplicate item_codes,
    deduplicates first, then applies adaptive score cutoff on unique items.

    Returns:
        {
            "query": str,
            "total": int,
            "groups": [
                {"key": "pre_work", "label": "Pre-work", "items": [...]},
                ...
            ]
        }
    """
    # Fetch many more candidates than needed — duplicates eat up slots
    internal_k = max(top_k * 4, 200)
    raw_results = index.search(query, top_k=internal_k)

    # Extract query words for keyword filtering
    query_words = [w.lower() for w in re.split(r"\W+", query) if len(w) > 2]

    # Score = vector_similarity * 0.7 + keyword_relevance * 0.3
    # Deduplicate by item_code early, keeping the highest-scoring variant
    seen_codes: dict[str, tuple[dict, float, float]] = {}
    for item, vec_score in raw_results:
        kw_score = _keyword_relevance(item, query_words)
        combined = vec_score * 0.7 + kw_score * 0.3
        code = item.get("item_code", "")
        if code not in seen_codes or combined > seen_codes[code][1]:
            seen_codes[code] = (item, combined, vec_score)

    # Sort unique items by combined score desc
    scored = sorted(seen_codes.values(), key=lambda x: x[1], reverse=True)

    # Take top_k unique items
    scored = scored[:top_k]

    # Adaptive cutoff on unique items
    all_scores = [s[1] for s in scored]
    cutoff = _find_score_cutoff(all_scores, min_score)
    scored = [(it, cs, vs) for it, cs, vs in scored if cs >= cutoff]

    # Classify into groups
    grouped: dict[str, list] = {g: [] for g in GROUP_ORDER}

    for item, combined_score, vec_score in scored:
        code = item.get("item_code", "")
        group = classify_group(item)
        price_data = item.get("price_data") or {}

        grouped[group].append({
            "item_code": code,
            "category": item.get("category", ""),
            "description": item.get("description", ""),
            "includes": (item.get("definition") or {}).get("includes"),
            "excludes": (item.get("definition") or {}).get("excludes"),
            "note": (item.get("definition") or {}).get("note"),
            "unit_price": price_data.get("untaxed_unit_price", 0),
            "labor_cost": price_data.get("labor_cost", 0),
            "material_cost": price_data.get("material_cost", 0),
            "score": round(combined_score, 3),
        })

    # Build response
    groups = []
    total = 0
    for key in GROUP_ORDER:
        items = grouped[key]
        if items:
            groups.append({
                "key": key,
                "label": GROUP_LABELS[key],
                "items": items,
            })
            total += len(items)

    return {
        "query": query,
        "total": total,
        "groups": groups,
    }
