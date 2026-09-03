"""
Tests for bed frame / mattress size consistency in packing/taxonomy.py.

A bed frame and the mattress on it are the same bed, so a room can never
legitimately contain e.g. a "Queen Bed Frame" beside a "Full Mattress".
Two separate defects used to produce exactly that from a single photo:

  1. "bed frame" was an alias of Queen Bed Frame, and a bare "mattress"
     substring-matched the longer alias "king size mattress" — so an
     unsized pair became Queen + King with nothing in the photo saying so.
  2. Even when the vision model did report sizes, it could disagree with
     itself across the two lines.

These tests pin both the "don't invent a size" rule and the reconciliation
that makes any surviving disagreement consistent.
"""
from app.domains.tools.modules.packing.taxonomy import (
    normalize_item_name,
    normalize_items_list,
)


def _items(*names):
    return [{"name": n, "category": "Furniture"} for n in names]


def _names(items):
    return [i["name"] for i in items]


# ── Unsized names must stay unsized ──────────────────────────────────────

def test_bare_bed_frame_does_not_become_queen():
    name, _, _, _ = normalize_item_name("bed frame", "Furniture")
    assert name == "Bed Frame"


def test_bare_mattress_does_not_become_king():
    name, _, _, _ = normalize_item_name("mattress", "Furniture")
    assert name == "Mattress"


def test_unsized_pair_stays_unsized_and_consistent():
    out = normalize_items_list(_items("bed frame", "mattress"))
    assert _names(out) == ["Bed Frame", "Mattress"]
    assert not any(i.get("_bed_size_reconciled") for i in out)


def test_descriptive_unsized_frame_still_normalizes():
    for raw in ("wooden bed frame", "upholstered bed frame", "platform bed"):
        name, _, _, _ = normalize_item_name(raw, "Furniture")
        assert name == "Bed Frame", raw


# ── Explicit sizes must still be honored ─────────────────────────────────

def test_explicit_sizes_are_preserved():
    cases = {
        "queen bed frame": "Queen Bed Frame",
        "king bed": "King Bed Frame",
        "twin bed": "Twin Bed Frame",
        "full mattress": "Full Mattress",
        "queen mattress": "Queen Mattress",
    }
    for raw, expected in cases.items():
        name, _, _, _ = normalize_item_name(raw, "Furniture")
        assert name == expected, raw


# ── Mismatched sizes get reconciled to the largest ───────────────────────

def test_mismatched_pair_is_reconciled_to_larger():
    out = normalize_items_list(_items("Queen Bed Frame", "Full Mattress"))
    assert set(_names(out)) == {"Queen Bed Frame", "Queen Mattress"}


def test_reconciliation_works_in_either_direction():
    out = normalize_items_list(_items("Full Bed Frame", "Queen Mattress"))
    assert set(_names(out)) == {"Queen Bed Frame", "Queen Mattress"}


def test_reconciled_item_records_its_original_name():
    out = normalize_items_list(_items("Queen Bed Frame", "Full Mattress"))
    changed = [i for i in out if i.get("_bed_size_reconciled")]
    assert len(changed) == 1
    assert changed[0]["_original_name"] == "Full Mattress"


def test_three_way_disagreement_settles_on_largest():
    out = normalize_items_list(
        _items("Twin Bed Frame", "Full Mattress", "King Mattress")
    )
    assert all("King" in n for n in _names(out)), _names(out)


# ── Reconciliation must not touch what it shouldn't ──────────────────────

def test_matching_pair_is_left_alone():
    out = normalize_items_list(_items("Queen Bed Frame", "Queen Mattress"))
    assert not any(i.get("_bed_size_reconciled") for i in out)


def test_matching_twin_pair_is_left_alone():
    out = normalize_items_list(_items("Twin Bed Frame", "Twin Mattress"))
    assert _names(out) == ["Twin Bed Frame", "Twin Mattress"]
    assert not any(i.get("_bed_size_reconciled") for i in out)


def test_lone_sized_bed_is_not_altered():
    out = normalize_items_list(_items("King Bed Frame"))
    assert _names(out) == ["King Bed Frame"]
    assert not any(i.get("_bed_size_reconciled") for i in out)


def test_non_bed_items_are_untouched():
    out = normalize_items_list(
        _items("Queen Bed Frame", "Full Mattress", "Nightstand", "Dresser")
    )
    assert _names(out)[2:] == ["Nightstand", "Dresser"]
