"""
Tests that material quantities are expressed in the unit the catalog prices.

Several materials are issued by the roll, the box-of-100 or the bundle, but
the hint maps describe PHYSICAL WRAPS: a sofa is wrapped once, an instrument
is bubble-wrapped once.  Counting wraps and pricing rolls billed a whole
1000-ft roll of stretch film per piece of furniture and a whole 100-count
carton of corner protectors for a handful of picture frames.

The photo-AI path already amortised correctly via ITEMS_PER_BOX; the hint path
did not, so the same contents produced very different material bills depending
on which tab the estimator used.  These tests pin the conversion, keep the two
paths' roll divisors identical, and hold the consumable rules to arithmetic
that matches their own stated basis.
"""


import pytest

from app.core.database import SessionLocal
from app.domains.tools.modules.packing.service import (
    HINT_MATERIAL_MAP,
    MATERIAL_CODES,
    MATERIAL_UNIT_COVERAGE,
    PAPER_BOXES_PER_BUNDLE,
    TAPE_BOXES_PER_ROLL,
    UNIT_HINT_MATERIAL_MAP,
    EstimateCalculator,
    _to_catalog_units,
    exclusion_notes_for,
    material_load_note,
)


@pytest.fixture
def calc():
    session = SessionLocal()
    try:
        yield EstimateCalculator(session, company_id=None)
    finally:
        session.close()


# ── The conversion itself ────────────────────────────────────────────────

def test_roll_materials_are_divided_by_their_coverage():
    # One sofa needs wrapping once, but a roll wraps ~8 pieces.
    assert _to_catalog_units("shrink_wrap", 1) == pytest.approx(1 / 8)
    assert _to_catalog_units("bubble_12", 1) == pytest.approx(1 / 20)
    assert _to_catalog_units("corner_protector", 4) == pytest.approx(4 / 100)


def test_per_piece_materials_pass_through_unchanged():
    # A blanket, a box and a mattress bag are already one catalog unit each.
    for key in ("blanket", "box_medium", "mattress_queen", "sofa_cover"):
        assert _to_catalog_units(key, 3) == 3


def test_roll_coverage_matches_the_photo_ai_path(calc):
    """Both paths must amortise a roll across the same number of articles, or
    the same contents bill differently depending on which tab was used.

    Corner protectors are excluded: the two paths count different things --
    MATERIAL_UNIT_COVERAGE counts protectors per carton (100), while
    ITEMS_PER_BOX counts furniture items per carton (~16, i.e. ~6 protectors
    each). Both land on the same cartons; only the denominator differs.
    """
    for key in ("shrink_wrap", "bubble_12", "bubble_24"):
        assert calc.ITEMS_PER_BOX[key] == MATERIAL_UNIT_COVERAGE[key], (
            f"{key}: hint path divides by {MATERIAL_UNIT_COVERAGE[key]}, "
            f"photo-AI path by {calc.ITEMS_PER_BOX[key]}"
        )


def test_every_covered_material_is_a_real_catalog_key():
    for key in MATERIAL_UNIT_COVERAGE:
        assert key in MATERIAL_CODES


# ── The maps the conversion is applied to ────────────────────────────────

def test_unit_hint_map_expresses_whole_physical_wraps():
    """The unit map counts articles, so its roll entries stay whole numbers --
    the divisor lives in _to_catalog_units, not smeared through the map."""
    for hint, mats in UNIT_HINT_MATERIAL_MAP.items():
        for key, qty in mats.items():
            if key in MATERIAL_UNIT_COVERAGE:
                assert qty == int(qty) and qty >= 1, (
                    f"{hint}.{key} = {qty}: express physical wraps here and "
                    "let MATERIAL_UNIT_COVERAGE convert to catalog units"
                )


def test_volume_hint_map_is_not_double_divided():
    """HINT_MATERIAL_MAP factors are already per catalog unit of volume, so
    they must stay small -- a whole 1 here would mean a roll per volume unit."""
    for hint, mats in HINT_MATERIAL_MAP.items():
        for key, factor in mats.items():
            if key in MATERIAL_UNIT_COVERAGE:
                assert factor < 0.05, f"{hint}.{key} = {factor} is not a rate"


# ── What that produces on a real job ─────────────────────────────────────

def _room(calc, preset, density="normal"):
    from app.domains.tools.modules.packing.schemas import RoomInput

    return RoomInput(preset=preset, density=density, floor="1st", quantity=1)


def test_a_furnished_living_room_does_not_bill_a_roll_per_piece(calc):
    mats = calc.calculate_materials([_room(calc, "living_standard")])
    # A single room cannot consume more than one roll of stretch film.
    assert mats.get("shrink_wrap", 0) <= 1
    assert mats.get("bubble_12", 0) <= 1


def test_corner_protectors_are_not_ordered_by_the_hundred_box(calc):
    """A room with artwork draws a couple of dozen protectors out of a carton
    that lasts across jobs -- it does not consume a whole 100-count box."""
    mats = calc.calculate_materials([_room(calc, "bedroom_master")])
    assert mats.get("corner_protector", 0) == 0


# ── Consumables match their own stated arithmetic ────────────────────────

def test_tape_divisor_matches_a_real_roll(calc):
    """A 55 yd / 165 ft roll at ~4 ft per box seals ~41 boxes. The divisor
    derates that for waste but must not drop to a per-few-boxes rule."""
    assert 20 <= TAPE_BOXES_PER_ROLL <= 41


def test_paper_divisor_matches_a_real_bundle():
    """A 25-lb bundle is ~235 sheets; a mixed job averages ~15 sheets/box."""
    assert 12 <= PAPER_BOXES_PER_BUNDLE <= 20


def test_a_tiny_job_is_not_charged_a_whole_paper_bundle(calc):
    """A 3-box bathroom used to draw a full bundle -- 75% of its material
    cost -- because the bundle count was floored at 1."""
    mats = calc.calculate_materials([_room(calc, "bathroom")])
    total_boxes = sum(q for k, q in mats.items() if k.startswith("box_"))
    assert total_boxes < 6
    assert mats.get("packing_paper", 0) == 0


def test_a_real_job_still_gets_paper(calc):
    mats = calc.calculate_materials(
        [_room(calc, "kitchen_standard"), _room(calc, "bedroom_master")]
    )
    assert mats.get("packing_paper", 0) >= 1


# ── Density and box springs ──────────────────────────────────────────────

def test_density_reaches_per_piece_unit_hints(calc):
    """Density was applied to category hints but skipped for per-piece ones,
    so a hoarding room got the same wrapping as a sparse one."""
    light = calc.calculate_materials([_room(calc, "living_standard", "light")])
    heavy = calc.calculate_materials([_room(calc, "living_standard", "extreme")])
    assert sum(heavy.values()) > sum(light.values())


def test_each_bed_is_bagged_twice(calc):
    """A bed is a mattress plus the box spring beneath it; both are bagged."""
    mats = calc.calculate_materials([_room(calc, "bedroom_standard")])
    bags = sum(q for k, q in mats.items() if k.startswith("mattress_"))
    assert bags == 2


def test_a_king_foundation_takes_two_split_bags(calc):
    """A king box spring is normally two split units, so it takes two twin
    bags rather than a second king bag."""
    mats = calc.calculate_materials([_room(calc, "bedroom_master")])
    assert mats.get("mattress_king", 0) == 1
    assert mats.get("mattress_twin", 0) == 2


# ── Normalization no longer silently drops materials ─────────────────────

def test_every_catalog_key_survives_normalization(calc):
    """A key the estimator itself emits must round-trip, or the material is
    dropped and the estimate silently shrinks."""
    for key in MATERIAL_CODES:
        assert calc._normalize_material_key(key) is not None, (
            f"{key} normalizes to None and would be dropped"
        )


def test_mattress_bag_resolves_to_the_bed_size(calc):
    class _Item:
        def __init__(self, name):
            self.name = name

    assert calc._mattress_bag_for(_Item("King Mattress"), "mattress_full") == "mattress_king"
    assert calc._mattress_bag_for(_Item("Twin Mattress"), "mattress_full") == "mattress_twin"
    assert calc._mattress_bag_for(_Item("California King Mattress"), "mattress_full") == "mattress_king"
    # taxonomy.py deliberately leaves an unsized bed unsized; don't invent one.
    assert calc._mattress_bag_for(_Item("Mattress"), "mattress_full") == "mattress_full"


# ── One padding article per piece ────────────────────────────────────────

def test_no_piece_takes_both_a_blanket_and_a_pad():
    """A moving blanket and a furniture pad cover the same surface, so a piece
    that draws both is billed for its wrap twice."""
    both = [
        hint for hint, mats in UNIT_HINT_MATERIAL_MAP.items()
        if "blanket" in mats and "furniture_pad" in mats
    ]
    assert not both, f"these pieces take both padding articles: {both}"


def test_room_level_padding_does_not_exceed_the_pieces_present(calc):
    """The room-level furniture hint covers a mix of pieces, so both articles
    legitimately appear -- but their sum must stay within the padded pieces a
    room actually holds, or the same pieces are covered twice."""
    from app.domains.tools.modules.packing.service import HINT_MATERIAL_MAP

    for hint in ("furniture", "outdoor_furniture"):
        mats = HINT_MATERIAL_MAP[hint]
        padding = mats.get("blanket", 0) + mats.get("furniture_pad", 0)
        # At scale 80 a bedroom or living room holds ~3 padded pieces.
        assert padding * 80 <= 3.5, (
            f"{hint}: {padding * 80:.1f} padding articles at scale 80"
        )


def test_a_packing_method_naming_both_keeps_only_the_pad(calc):
    """Keyword matching is substring-based, so a method mentioning both would
    otherwise emit a blanket and a pad for one surface."""
    mats = calc._infer_materials_from_packing_method("blanket wrap, pad wrap")
    assert "furniture_pad" in mats
    assert "blanket" not in mats


def test_each_padding_article_still_reaches_estimates(calc):
    """Splitting by piece class must not strand either SKU."""
    mats = calc.calculate_materials(
        [_room(calc, "bedroom_master"), _room(calc, "living_standard")]
    )
    assert mats.get("blanket", 0) > 0
    assert mats.get("furniture_pad", 0) > 0


# ── Excluded content is stated, not silently dropped ─────────────────────

def test_excluded_content_produces_an_exclusion_note(calc):
    """plants/chemicals correctly produce no materials and no labor, but the
    customer selected them -- silence is what creates the move-day dispute."""
    rooms = [_room(calc, "garage")]
    rooms[0].hints = ["chemicals", "plants", "tools"]
    notes = exclusion_notes_for(rooms, calc.presets)
    assert len(notes) == 2
    assert any("plants" in n.lower() for n in notes)
    assert any("hazmat" in n.lower() for n in notes)


def test_a_room_without_excluded_content_gets_no_note(calc):
    assert exclusion_notes_for([_room(calc, "bedroom_master")], calc.presets) == []


def test_exclusion_notes_are_deduplicated_across_rooms(calc):
    rooms = [_room(calc, "garage"), _room(calc, "storage_room")]
    for r in rooms:
        r.hints = ["chemicals"]
    assert len(exclusion_notes_for(rooms, calc.presets)) == 1


def test_excluded_hints_still_produce_no_materials(calc):
    """The note is an addition, not a replacement -- these stay unbilled."""
    rooms = [_room(calc, "garage")]
    rooms[0].hints = ["plants", "chemicals"]
    mats = calc.calculate_materials(rooms)
    # Only the per-room base boxes, nothing attributable to the two hints.
    assert mats.get("shrink_wrap", 0) == 0


# ── The real material load is disclosed ──────────────────────────────────

def test_compounding_markup_and_op_is_disclosed():
    note = material_load_note(20, True, 20)
    assert note is not None
    assert "1.44x" in note


def test_no_load_note_when_nothing_compounds():
    assert material_load_note(20, False, 20) is None
    assert material_load_note(0, True, 20) is None


def test_a_zero_priced_row_falls_back_instead_of_billing_free(calc):
    """A cleared price field must not render a real quantity at $0.00."""
    class _Row:
        price = 0.0

    calc.prices["2915"] = _Row()
    try:
        assert calc.get_price("2915") > 0
    finally:
        calc.prices.pop("2915", None)
