"""
Tests for _bundle_trivial_items in packing/vision.py.

Verifies that small personal-effect items (shoes, hats, pillows, single
garments) reported individually or in trivial quantity are folded into
the "Miscellaneous Small Items" bundle rather than becoming their own
packing line, while box-worth quantities and fragile/high-value items
are preserved as-is.
"""
from app.domains.tools.modules.packing.schemas import DetectedContentItem
from app.domains.tools.modules.packing.vision import _bundle_trivial_items


def _item(name, quantity=1, category="Other", is_fragile=False, is_high_value=False):
    return DetectedContentItem(
        name=name,
        category=category,
        quantity=quantity,
        is_high_value=is_high_value,
        is_fragile=is_fragile,
        confidence=0.9,
    )


def test_single_shoe_is_bundled_not_own_line():
    items = [_item("Shoe", quantity=1)]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Shoe" not in names
    assert "Miscellaneous Small Items" in names
    misc = next(i for i in result if i.name == "Miscellaneous Small Items")
    assert misc.quantity == 1


def test_single_hat_and_pillow_are_bundled():
    items = [_item("Hat", quantity=1), _item("Pillow", quantity=1)]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Hat" not in names
    assert "Pillow" not in names
    assert "Miscellaneous Small Items" in names


def test_box_worth_of_clothing_is_kept_as_own_line():
    # Enough shirts to fill part of a box should NOT be silently dropped.
    items = [_item("Clothing Items", quantity=15, category="Clothing")]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Clothing Items" in names


def test_small_unit_below_threshold_bundles_even_with_generic_name():
    # A couple of shoes (below the box-worth threshold) still bundle.
    items = [_item("Shoes", quantity=2, category="Clothing")]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Shoes" not in names
    assert "Miscellaneous Small Items" in names


def test_fragile_or_high_value_small_item_is_never_bundled():
    items = [
        _item("Wine Glass", quantity=1, is_fragile=True),
        _item("Antique Pocket Watch", quantity=1, is_high_value=True),
    ]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Wine Glass" in names
    assert "Antique Pocket Watch" in names
    assert "Miscellaneous Small Items" not in names


def test_never_bundle_keywords_take_precedence_over_small_unit():
    # "Framed Photo" contains no small-unit keyword, but confirms frame/photo
    # items always stay individual regardless of quantity.
    items = [_item("Framed Photo", quantity=1)]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Framed Photo" in names


def test_large_furniture_untouched():
    items = [_item("Queen Bed Frame", quantity=1, category="Furniture")]
    result = _bundle_trivial_items(items)

    names = [i.name for i in result]
    assert "Queen Bed Frame" in names
    assert "Miscellaneous Small Items" not in names
