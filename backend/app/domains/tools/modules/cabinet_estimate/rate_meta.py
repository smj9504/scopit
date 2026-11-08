"""Declared metadata for cabinet estimate rates.

The problem this solves
=======================
`pricing.py` used to be a plain "name -> number" mapping. A number alone
cannot say what it is, and three separate things were being conflated:

  BASIS  - is $449 an insurance detach-and-reset, a retail install call,
           or a new-appliance replacement? The appliance table had values
           drawn from two different bases sitting next to each other.

  UNIT   - is $7.08/SF wall area, cabinet face area, or cabinet run?
           Painting was quoted at a cabinet-refinishing rate against a
           field that is fed wall area.

  SCOPE  - does Demo at $31/LF already include hauling? Does the
           backsplash install rate already include thinset and grout?
           Both were billed a second time by a separate line.

None of those were wrong numbers. They were undeclared numbers, which is
why two rounds of "research the price again" kept reversing each other.

A `Rate` carries the declaration with the value, so the ambiguity is
impossible to reintroduce silently: a rate with no basis will not
construct, and a table that mixes bases fails its test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import FrozenSet, Literal, Optional


class Unit(str, Enum):
    """What one unit of the rate's quantity measures."""

    EA = "EA"                 # per item
    LS = "LS"                 # lump sum, quantity always 1
    LF = "LF"                 # linear feet
    HR = "HR"                 # crew hours
    OPENING = "OPENING"       # per door/drawer front

    # Area units are deliberately NOT a single "SF". Which surface is
    # being measured changes the rate by 3-5x, and the estimator has
    # historically gotten this wrong, so the surface is part of the unit.
    WALL_SF = "WALL_SF"                   # wall area behind/around cabinets
    CABINET_FACE_SF = "CABINET_FACE_SF"   # exposed cabinet door/frame face
    CABINET_RUN_LF = "CABINET_RUN_LF"     # cabinet run length (refinishing)
    COUNTER_SF = "COUNTER_SF"             # countertop surface
    BACKSPLASH_SF = "BACKSPLASH_SF"       # backsplash surface
    PANEL_SF = "PANEL_SF"                 # finished panel surface


#: Area units that are all "square feet" but measure different surfaces.
#: Kept as a set so a check can say "these are not interchangeable".
AREA_UNITS: FrozenSet[Unit] = frozenset({
    Unit.WALL_SF,
    Unit.CABINET_FACE_SF,
    Unit.COUNTER_SF,
    Unit.BACKSPLASH_SF,
    Unit.PANEL_SF,
})


class Basis(str, Enum):
    """The pricing world a rate was drawn from.

    Rates from different bases are NOT comparable and must not sit in the
    same table. The appliance table is the cautionary example: insurance
    detach-and-reset and retail install pricing differ by 2-3x for the
    same physical work, because they bill different things.
    """

    #: Xactimate-style detach & reset. Reuses the customer's own unit.
    #: Crew time only; no trip minimum per unit, no new equipment.
    #: What a carrier pays on a claim.
    INSURANCE_DR = "INSURANCE_DR"

    #: Retail installer call-out. Carries a per-visit trip minimum and
    #: assumes one appliance per visit unless the trip is pulled out.
    RETAIL_INSTALL = "RETAIL_INSTALL"

    #: Material/product only, no labor.
    SUPPLY_ONLY = "SUPPLY_ONLY"

    #: Supply and install quoted as one number.
    SUPPLY_AND_INSTALL = "SUPPLY_AND_INSTALL"

    #: Crew time only, no material.
    LABOR_ONLY = "LABOR_ONLY"

    #: Remove the old unit and install a NEW one, including haul-off.
    REPLACE_NEW = "REPLACE_NEW"

    #: A government fee passed through at cost. Never marked up.
    PASS_THROUGH_FEE = "PASS_THROUGH_FEE"


class Includes(str, Enum):
    """Cost components a rate already covers.

    Used to catch double counting: if Demo already includes DISPOSAL then
    a separate dumpster line is billing the same haul-off twice.
    """

    TRIP = "TRIP"                             # travel / show-up charge
    DISPOSAL = "DISPOSAL"                     # haul-off and dump fees
    SETTING_MATERIALS = "SETTING_MATERIALS"   # thinset, grout, adhesive
    SMALL_PARTS = "SMALL_PARTS"               # screws, shims, caulk
    FINISH = "FINISH"                         # paint/stain on the item
    HARDWARE = "HARDWARE"                     # knobs, pulls, slides
    TEMPLATE = "TEMPLATE"                     # measure/template visit
    PERMIT = "PERMIT"                         # permit fee inside the rate
    TAX = "TAX"                               # sales tax inside the rate


Confidence = Literal["measured", "derived", "assumed"]


@dataclass(frozen=True)
class Rate:
    """A single priced line with its meaning attached.

    `value` is meaningless without `unit` and `basis`, so both are
    required. `source` is required too - a rate nobody can trace is a
    rate the next reviewer will "correct" from a different source and
    silently change the basis.
    """

    value: float
    unit: Unit
    basis: Basis
    source: str
    source_date: date
    confidence: Confidence = "assumed"
    region: str = "DMV"
    includes: FrozenSet[Includes] = field(default_factory=frozenset)
    excludes: FrozenSet[Includes] = field(default_factory=frozenset)
    note: Optional[str] = None

    def __post_init__(self) -> None:
        if self.value < 0:
            raise ValueError(
                f"negative rate {self.value} from {self.source}; a "
                f"discount belongs in the multiplier that applies it, "
                f"not in a base rate"
            )
        overlap = self.includes & self.excludes
        if overlap:
            raise ValueError(
                f"rate from {self.source} both includes and excludes "
                f"{sorted(c.value for c in overlap)}"
            )
        if not self.source:
            raise ValueError("every rate needs a traceable source")

    @property
    def is_assumed(self) -> bool:
        """True for rates nobody has verified against a real quote."""
        return self.confidence == "assumed"

    def covers(self, component: Includes) -> bool:
        return component in self.includes

    def __float__(self) -> float:
        """Allow a Rate to be used where the bare number is expected.

        This is what lets the metadata be introduced without rewriting
        every call site in calculator.py at the same time.
        """
        return float(self.value)


#: Bases an estimate can be quoted in. The others describe individual
#: rates (a supply-only material, a pass-through fee) and are not whole
#: pricing worlds, so they are not selectable.
ESTIMATE_BASES = (Basis.INSURANCE_DR, Basis.RETAIL_INSTALL)

#: Claim-linked work is the common case for this estimator.
DEFAULT_ESTIMATE_BASIS = Basis.INSURANCE_DR


def resolve_basis(value) -> Basis:
    """Turn a stored string into a Basis, defaulting when unset.

    Rejects a basis that is not a whole pricing world rather than
    silently falling back - quoting an estimate as SUPPLY_ONLY would
    produce a number that means nothing.
    """
    if value is None or value == "":
        return DEFAULT_ESTIMATE_BASIS
    if isinstance(value, Basis):
        basis = value
    else:
        try:
            basis = Basis(str(value).strip().upper())
        except ValueError:
            raise ValueError(
                f"unknown pricing basis {value!r}; expected one of "
                f"{[b.value for b in ESTIMATE_BASES]}"
            ) from None
    if basis not in ESTIMATE_BASES:
        raise ValueError(
            f"{basis.value} describes a single rate, not a whole "
            f"estimate; expected one of "
            f"{[b.value for b in ESTIMATE_BASES]}"
        )
    return basis


def rates_share_basis(rates) -> bool:
    """True when every rate in the collection declares the same basis."""
    return len({r.basis for r in rates}) <= 1


def assumed_rates(table: dict) -> dict:
    """The entries in a rate table that are still unverified guesses.

    Surface this rather than hiding it: an assumed rate is a known
    liability, and the point of the confidence field is that the list is
    visible instead of being rediscovered by the next price review.
    """
    return {
        k: r for k, r in table.items()
        if isinstance(r, Rate) and r.is_assumed
    }
