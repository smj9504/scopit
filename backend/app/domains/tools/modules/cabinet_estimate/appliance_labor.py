"""Appliance detach/reset pricing, generated from crew hours.

Why this is not a price table
=============================
The hand-maintained price table drifted into physically impossible
orderings - a dishwasher reset ($449) priced 2.7x a wall oven ($167),
and a garbage disposer ($305) level with a gas range ($307). Nobody
introduced those on purpose; they accumulated because each row was
edited independently and nothing tied them together.

Prices can be edited into any order. Crew hours cannot: a disposer
genuinely takes less time than a built-in oven, in every kitchen, and
no amount of editing changes that. So hours are the single source of
truth here and the money is derived.

Two bases, generated from the same hours
========================================
RETAIL_INSTALL  - what an installer charges a homeowner. Carries a trip
                  minimum, because a one-appliance visit still costs a
                  truck roll.
INSURANCE_DR    - what a carrier pays on a claim. Crew time against the
                  published detach & reset line items; no per-unit trip
                  charge, because the crew is already on site.

The same appliance has different prices under the two, by design. They
are different products, not a better and worse estimate of one product.
Never mix them in one estimate - see `test_basis_consistency`.
"""

from __future__ import annotations

from datetime import date
from typing import Dict

from .rate_meta import Basis, Includes, Rate, Unit

# ── Retail install model ──
# Calibrated against a DMV appliance-installer price list; reproduces its
# published anchors to a mean absolute error of ~5%.
BASE_CALL = 120.0      # show-up cost before any wrench time
CREW_RATE = 95.0       # $/hr, one installer plus helper time amortized
TRIP_MIN = 245.0       # minimum for any single-appliance visit

# ── Insurance D&R: mapped, NOT generated ──
# The retail hours below do NOT transfer to this basis. Solving the
# published D&R line items back into crew hours gives a different
# vector entirely:
#
#     appliance        retail h    implied D&R h
#     dishwasher          1.7          2.36
#     wall oven           1.8          2.06
#     range (gas)         1.4          1.50
#     OTR microwave       1.6          1.05
#     range hood          2.2          0.69
#     wood hood 42"       4.4          2.48
#
# Xactimate weights a range hood at roughly a third of what the retail
# trade charges, and a dishwasher well above it. That is a difference in
# how the two worlds bill, not an error in either. Generating insurance
# prices from retail hours produced a 0.89x-2.87x spread against the
# published figures and priced a wood hood ABOVE its own retail price.
#
# So carrier pricing is MAPPED from the published list, not derived.
# A self-invented insurance number gets challenged in claim review; the
# carrier's own price list is the authority. DMV_UPLIFT is the only
# adjustment, and it is applied uniformly so the relative weighting of
# the published book is preserved exactly.
DMV_UPLIFT = 1.18

#: Published D&R figures (NJ 2021 book, the version available to us).
#: Replace wholesale when a DC-metro list is licensed - do not edit
#: individual rows, or the book's internal consistency is lost.
XACTIMATE_DR_PUBLISHED: Dict[str, float] = {
    "dishwasher": 271.88,      # DWRS
    "wall_oven": 242.00,       # OVBIRS
    "range_gas": 186.00,       # RGGRS
    "microwave_otr": 141.00,   # MWSRS
    "hood_vent": 104.60,       # HDRS
    "hood_wood_42": 284.00,    # RHRS
    "refrigerator": 120.00,    # RFR, incl. water line
    "garbage_disposal": 95.00,  # APPGDR
}

#: Items with no published D&R line item. Priced by proportion to the
#: nearest published sibling rather than invented outright, and flagged
#: "assumed" so they show up in the unverified list.
XACTIMATE_DR_PROXY: Dict[str, tuple] = {
    # (sibling key, ratio, why)
    "range_electric": ("range_gas", 0.80, "no gas line to break and remake"),
    "range_gas_slide": ("range_gas", 1.15, "scribed to the countertop"),
    "range_electric_slide": ("range_gas", 0.92, "scribed, no gas"),
    "range_dropin": ("range_gas", 1.25, "sits in a cut cabinet"),
    "cooktop_gas": ("range_gas", 0.95, "counter cutout, gas connection"),
    "cooktop_electric": ("range_gas", 0.78, "counter cutout, no gas"),
    "refrigerator_builtin": (
        "refrigerator", 2.60, "panel removal, half-day job",
    ),
}


#: Crew hours to detach and reset one unit. THIS IS THE SOURCE OF TRUTH.
#: Edit hours, never the generated prices. Ordering here is physical and
#: is locked by tests - see tests/test_cabinet_appliance_model.py.
APPLIANCE_HOURS: Dict[str, float] = {
    # Unhook, twist off the mount, reverse. Fastest job on the list.
    "garbage_disposal": 1.3,
    # Slide out, plug in, level. No plumbing, no gas.
    "range_electric": 1.0,
    # Roll out, reconnect water line for the icemaker, level.
    "refrigerator": 1.4,
    # As electric plus a gas disconnect, leak test and reconnect.
    "range_gas": 1.4,
    # Drop-in cooktops are fastened into the counter cutout.
    "cooktop_electric": 1.5,
    # Overhead work, two people, vent and cabinet screws.
    "microwave_otr": 1.6,
    # Slide-ins are scribed to the counter, so slower than freestanding.
    "range_gas_slide": 1.6,
    "range_electric_slide": 1.2,
    "cooktop_gas": 1.7,
    # Pull, disconnect supply and drain, reverse, re-level to the door.
    "dishwasher": 1.7,
    # Heaviest lift in the kitchen, out of a cabinet opening, hardwired.
    "wall_oven": 1.8,
    # Sits in a cut cabinet; more trim and fitting work on reset.
    "range_dropin": 1.9,
    "hood_vent": 2.2,
    # Large wood hoods need trim and scribe work on reset.
    "hood_wood_42": 4.4,
    # Panel-ready built-ins are a half-day job with the panels off.
    "refrigerator_builtin": 4.5,
}

APPLIANCE_LABELS: Dict[str, str] = {
    "garbage_disposal": "Garbage Disposal",
    "range_electric": "Range (Electric) - Freestanding",
    "refrigerator": "Refrigerator",
    "range_gas": "Range (Gas) - Freestanding",
    "cooktop_electric": "Cooktop (Electric)",
    "microwave_otr": "Microwave (Over-the-Range)",
    "range_gas_slide": "Range (Gas) - Slide-in",
    "range_electric_slide": "Range (Electric) - Slide-in",
    "cooktop_gas": "Cooktop (Gas)",
    "dishwasher": "Dishwasher",
    "wall_oven": "Wall Oven",
    "range_dropin": "Range - Drop-in",
    "hood_vent": "Range Hood",
    "hood_wood_42": "Wood Range Hood (42\"+)",
    "refrigerator_builtin": "Refrigerator - Built-in / Panel-ready",
}

#: Published Xactimate codes, for claim work. Stored rather than
#: reverse-engineered: a carrier's own price list is the authority on a
#: claim, and a self-derived figure gets challenged in review. Import the
#: regional list and match on these codes when one is available.
XACTIMATE_CODES: Dict[str, str] = {
    "dishwasher": "DWRS",
    "wall_oven": "OVBIRS",
    "range_gas": "RGGRS",
    "microwave_otr": "MWSRS",
    "hood_vent": "HDRS",
    "hood_wood_42": "RHRS",
    "refrigerator": "RFR",
    "garbage_disposal": "APPGDR",
}

_SOURCE_RETAIL = "DJC Appliance Installation Price List (DMV), hours model"
_SOURCE_DR = "Xactimate D&R line items (NJ 2021 book) + DMV labor uplift"
_CALIBRATED = date(2026, 9, 18)


def retail_price(hours: float) -> float:
    """Retail installer price for a single-appliance visit."""
    return round(max(TRIP_MIN, BASE_CALL + hours * CREW_RATE), 2)


def insurance_dr_price(key: str) -> tuple:
    """Insurance D&R price for an appliance.

    Returns (value, confidence, note). Published line items are mapped
    straight through with the regional uplift; the rest are proportioned
    off a published sibling and marked assumed.
    """
    published = XACTIMATE_DR_PUBLISHED.get(key)
    if published is not None:
        code = XACTIMATE_CODES.get(key, "")
        return (
            round(published * DMV_UPLIFT, 2),
            "measured",
            f"Xactimate {code} ${published:,.2f} x{DMV_UPLIFT} DMV",
        )
    proxy = XACTIMATE_DR_PROXY.get(key)
    if proxy is None:
        raise KeyError(
            f"{key} has neither a published D&R line item nor a proxy; "
            f"add one to XACTIMATE_DR_PUBLISHED or XACTIMATE_DR_PROXY"
        )
    sibling, ratio, why = proxy
    base = XACTIMATE_DR_PUBLISHED[sibling]
    return (
        round(base * ratio * DMV_UPLIFT, 2),
        "assumed",
        f"no published line item; {ratio:g}x {sibling} ({why})",
    )


def _build(basis: Basis) -> Dict[str, Rate]:
    table: Dict[str, Rate] = {}
    for key, hours in APPLIANCE_HOURS.items():
        if basis is Basis.RETAIL_INSTALL:
            value = retail_price(hours)
            confidence = "derived"
            source = _SOURCE_RETAIL
            includes = frozenset({Includes.TRIP})
            note = f"{hours}h crew time"
        elif basis is Basis.INSURANCE_DR:
            value, confidence, note = insurance_dr_price(key)
            source = _SOURCE_DR
            # No per-unit trip: the crew is on site for the whole job.
            includes = frozenset()
        else:
            raise ValueError(f"no appliance model for basis {basis}")

        table[key] = Rate(
            value=value,
            unit=Unit.EA,
            basis=basis,
            source=source,
            source_date=_CALIBRATED,
            confidence=confidence,
            includes=includes,
            # D&R reuses the customer's unit: no new appliance, and the
            # old one is not hauled away.
            excludes=frozenset({Includes.DISPOSAL}),
            note=note,
        )
    return table


#: Retail remodel basis. Use when the homeowner is paying.
APPLIANCE_RATES_RETAIL: Dict[str, Rate] = _build(Basis.RETAIL_INSTALL)

#: Insurance claim basis. Use when a carrier is paying.
APPLIANCE_RATES_INSURANCE: Dict[str, Rate] = _build(Basis.INSURANCE_DR)

APPLIANCE_TABLES: Dict[Basis, Dict[str, Rate]] = {
    Basis.RETAIL_INSTALL: APPLIANCE_RATES_RETAIL,
    Basis.INSURANCE_DR: APPLIANCE_RATES_INSURANCE,
}


def appliance_table(basis: Basis) -> Dict[str, Rate]:
    """The appliance rate table for a pricing basis."""
    try:
        return APPLIANCE_TABLES[basis]
    except KeyError:
        raise ValueError(
            f"appliance pricing is defined for "
            f"{sorted(b.value for b in APPLIANCE_TABLES)}, not {basis}"
        ) from None


def appliance_pricing_dict(basis: Basis) -> Dict[str, Dict[str, object]]:
    """{key: {label, cost}} — the shape the API and frontend consume."""
    return {
        key: {
            "label": APPLIANCE_LABELS[key],
            "cost": rate.value,
            "hours": APPLIANCE_HOURS[key],
        }
        for key, rate in appliance_table(basis).items()
    }
