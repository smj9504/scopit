"""
Cabinet Estimate pricing constants for DMV area.
All rates are baseline values that get adjusted by material, finish,
and labor multipliers.
"""

from datetime import date
from typing import Optional

from .appliance_labor import appliance_pricing_dict
from .rate_meta import Basis, Includes, Rate, Unit

#: Date the rate declarations at the bottom of this file were attached.
_DECL_DATE = date(2026, 9, 18)

# Per-LF base rates by tier (supply only, before labor multiplier)
# Validated against real DMV contractor quotes (2025-2026)
# 2026-08 update: tiered increase reflecting Section 232 cabinet tariffs
# (25% on imports, effective 2025-10-14) plus manufacturer list-price
# increases (2.7%-5.5% avg, effective Feb-Mar 2026). Stock/RTA lines have
# the highest import exposure (Vietnam/China), Custom is mostly
# domestic-built and only sees lumber-tariff/labor pass-through.
# Stock +5%, Semi-Custom +3%, Custom +1%.
#
# 2026-08-26 follow-up increase (user feedback: base prices still low vs.
# market even after the 2026-08-25 tariff-exposure pass). Fresh research:
# Section 232 cabinet tariffs stable at 25% through 2026/2027 (planned
# escalation delayed — no new tariff spike). But DMV market comparison
# shows real gaps: Stock $284/LF already near top of $100-300 market
# range (small bump only); Semi-Custom $414/LF sits mid a wide $150-650
# range (meaningful room); Custom $676/LF sits low-mid its $500-1200+
# range (biggest gap, plus mild lumber-tariff pressure on domestic-built
# tier). Tier-differentiated: Stock +5-8%, Semi-Custom +12-16%,
# Custom +15-20%, applied across BASE_RATES/TALL_CABINET_TYPES/
# GLASS_DOOR_PREMIUM/island & prefab pricing/crown molding. Ancillary
# SCOPE_ITEMS/backsplash/appliance R&R (never adjusted before) get a
# flat +8-12% catch-up. Countertop pricing left untouched — already
# matches 2026 market ($50-150/SF quartz, $40-175/SF granite).
#
# 2026-09-18 (v1): wall_lf ratios trimmed to ~0.80-0.82 of base.
#
# 2026-09-18 (v2): REVISED against a 403-SKU real price matrix (Kitchen
# Cabinet Depot, White Painted Shaker RTA, single door style/finish so
# the ratios are clean). Two of the v1 calls were wrong:
#
#  * wall:base measured 0.706 (W3030 $395.77 / B30S $560.42) and 0.72 at
#    24". v1 set 0.80-0.82 reasoning from a published 0.70-0.85 band and
#    picking the top "because DMV runs high" - but DMV affects LABOR, not
#    the factory box ratio (see the BLS check in the v2 report: DMV trade
#    wages are only +3-12% over national). Moved to the measured 0.71.
#
#  * tall_each was LEFT ALONE in v1 on the reasoning that a pantry is one
#    tall box, not a base+wall stack. The measured data says the box is
#    far more expensive than either model assumed:
#        U248424 (24x84 pantry) $1,080.85 = 2.34x B24 ($462.22)
#        ... and 1.36x a B24 + W2430 stack.
#    v1's $539 implies only 1.35x the Stock B24 equivalent ($400), i.e.
#    the rate was ~74% below the measured ratio.
#    Raised to the MIDPOINT of current-vs-measured (+39%) rather than
#    straight to 2.34x: the SKU matrix is RTA catalog list pricing, which
#    sits above what a contractor actually pays, so going all the way to
#    the measured ratio would over-correct. Revisit against a real
#    supplier quote - see the v2 report Â§F.
BASE_RATES = {
    "Stock": {
        "base_lf": 200,      # $/LF for base cabinets (market $180-$280)
        "wall_lf": 142,      # 0.71 of base (measured 0.706)
        "tall_each": 750,    # was 539; measured ratio implies ~935
    },
    "Semi-Custom": {
        "base_lf": 364,      # market $280-$400
        "wall_lf": 258,      # 0.71 of base
        "tall_each": 1235,   # was 889; measured ratio implies ~1543
    },
    "Custom": {
        "base_lf": 686,      # market $500-$700
        "wall_lf": 487,      # 0.71 of base
        "tall_each": 2275,   # was 1637; measured ratio implies ~2841
    },
}

# Wall cabinet height multiplier (applied to wall_lf rate)
# 30"H is the baseline (1.0); shorter/taller scale proportionally
#
# 2026-09-18 (v1): the old table had a single "short" bucket at 0.55
# covering everything from 12" to 27", which badly under-priced 24"/27".
# Split into bands.
#
# 2026-09-18 (v2): band VALUES replaced with the measured ratios from the
# KCD SKU matrix, all against W3030 ($395.77) at the same width:
#     W3012 (12"H) $223.47 -> 0.565
#     W3018 (18"H) $271.69 -> 0.686
#     W3024 (24"H) $324.61 -> 0.820
#     W3030 (30"H) $395.77 -> 1.000  (baseline)
#     W3036 (36"H) $457.51 -> 1.156
#     W3042 (42"H) $522.19 -> 1.319
# v1's bands were close (0.50/0.60/0.80/1.15/1.25) but guessed; these are
# read straight off single-style SKUs, so the guesswork is gone. 42" was
# the furthest off (1.25 vs 1.319).
WALL_HEIGHT_MULTIPLIER = {
    "bridge": 0.565,      # 12"-15"H — over-fridge/over-range bridge
    "short": 0.686,       # 18"-21"H — above a microwave or fridge
    "mid": 0.820,         # 24"H
    "near_standard": 0.91,  # 27"H — interpolated 24"/30"
    "standard": 1.00,     # 30"H — baseline
    "tall": 1.156,        # 36"H
    "extra_tall": 1.319,  # 42"H
}

# A wall cabinet at reduced height still takes a full hang: same lift, same
# leveling, same screws into studs. Install labor therefore does NOT scale
# with the height multiplier above — it is charged per LF at the full rate
# regardless of box height. (Previously install inherited nothing from
# height either; this constant just makes the rule explicit.)
WALL_INSTALL_SCALES_WITH_HEIGHT = False

# Tall cabinet size multipliers (applied to the per-EA tall supply rate).
# Tall cabinets are quoted per unit, but a 36"W pantry carries twice the
# material of an 18"W one, so the per-EA rate scales with the box size.
# Baseline is the common 24"W x 84"H unit (1.00). The curve is
# 0.4 + 0.6 x (size / baseline) — proportional to material, with a floor for
# the fixed cost every box carries (doors, hardware, top/bottom/back).
TALL_WIDTH_MULTIPLIER = {
    18: 0.85,
    24: 1.00,        # baseline
    30: 1.15,
    33: 1.22,
    36: 1.30,
}

TALL_HEIGHT_MULTIPLIER = {
    84: 1.00,        # baseline
    90: 1.05,
    96: 1.10,
}

# Stock cabinets are built on a 3" grid running 9"-48"; this lineup has been
# the industry standard since the 1950s and is consistent across manufacturers.
# Anything between those steps is a custom order or a factory modification.
STANDARD_WIDTHS = {9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48}

# Supply-cost multiplier for a box whose width is off the 3" grid.
#
# 2026-09-18 (v2): lowered 1.6 -> 1.30 on manufacturer documentation.
# The v1 review flagged 1.6 as above published ranges but kept it,
# reasoning that field experience beats a national range. The v2 pass
# then found the actual schedule a manufacturer publishes - Wolf Home
# Products "Order Upcharge % Guide" (eff. 2023-01-03):
#     CW  (width change)                      +30%
#     RD/ID (depth change) / CH (height)      +30%
#     two dimensions changed together         +40%
#     three dimensions changed together       +50%
# That is a specific published upcharge for exactly this modification,
# not a national average, so it outranks the earlier estimate. A single
# width change is +30%.
#
# Note the alternative model: Conestoga and Barker build to 1/16"-1/4"
# increments and charge NO size upcharge at all ("Custom Sizing is
# Free"), pricing off the size itself. If this estimator ever moves to a
# true custom-shop basis, that is the more accurate structure.
NON_STANDARD_WIDTH_MULTIPLIER = 1.30

# Multi-dimension modifications, per the same Wolf schedule. Not wired
# into the calculator yet - the box model only varies width - but kept
# here so the basis is documented if depth/height changes are added.
MULTI_DIMENSION_UPCHARGE = {
    1: 1.30,
    2: 1.40,
    3: 1.50,
}


def is_standard_width(width_inches: float) -> bool:
    """True when a box width sits on the standard 3" cabinet grid."""
    return width_inches in STANDARD_WIDTHS


# ── Narrow-box efficiency multiplier (applied to base/wall SUPPLY) ──
#
# 2026-09-18 (v2). Straight $/LF pricing assumes a cabinet's cost scales
# with its width. It does not: every box carries the same two doors'
# worth of hardware, the same deck, the same back and the same assembly
# labor regardless of how narrow it is. Measured on the KCD matrix:
#
#     width   price      $/LF     vs 36"
#      12"   $322.85   $322.85    1.45x
#      18"   $389.30   $259.53    1.17x
#      24"   $462.22   $231.11    1.04x
#      30"   $560.42   $224.17    1.01x
#      36"   $667.45   $222.48    1.00x  (baseline)
#
# So a kitchen full of 12"/18" fillers-and-spice-pulls was being quoted
# from a $/LF rate calibrated on wide boxes, under-charging by up to 45%
# on those boxes. This matters most on DMV rowhouse galley kitchens,
# which are exactly the narrow-cabinet case.
#
# Applied to SUPPLY only. Install labor genuinely is close to per-LF -
# a narrow box is faster to hang - so it is left alone.
WIDTH_EFFICIENCY_MULTIPLIER = {
    12: 1.45,
    15: 1.30,
    18: 1.17,
    21: 1.09,
    24: 1.04,
    27: 1.01,
    30: 1.01,
    # 33"+ is flat at the baseline.
}

# Widths from here up to WIDE_BOX_FROM are priced straight off the $/LF rate.
WIDTH_EFFICIENCY_FLAT_ABOVE = 33

# Past 36" the curve turns the other way: a wider box is the same two doors
# and two drawers over more run, so its $/LF falls. Measured against the same
# line's 36" box (US Cabinet Depot Capital Collection, Shaker White, V1.2026):
#     base  B36 $1,135 / B39 $1,165 / B42 $1,203 -> 0.947, 0.909
#           (KCD agrees: B42 $707.43 / B36 $667.45 -> 0.908)
#     wall  30"H W36 $777 / W39 $830 / W42 $888  -> 0.986, 0.980
#           36"H W36 $891 / W39 $944 / W42 $1,000 -> 0.978, 0.962
#           42"H W36 $1,028 / W39 $1,089 / W42 $1,154 -> 0.978, 0.962
# That line stops at 42". 45" and 48" base carry on its last step (+$38);
# 48" wall takes Dream Cabinets' W4830 $445 / W4230 $401.95 -> 0.969 on top
# of 42", and 45" wall sits halfway.
# Without this a B42 billed at the full rate came out about 10% high, and so
# did every BBC42 / SB42, whose own ratios are against the standard box of
# their width.
WIDE_BOX_FROM = 36
WIDE_BOX_EFFICIENCY = {
    "base": {39: 0.95, 42: 0.91, 45: 0.875, 48: 0.845},
    "wall": {39: 0.98, 42: 0.97, 45: 0.955, 48: 0.94},
}


def width_efficiency(width_inches: float, cab_type: str = "base") -> float:
    """Per-LF cost factor for a box's width.

    Above 1.0 for a narrow box, 1.0 from 33" to 36", below 1.0 for a wide one.
    """
    if width_inches > WIDE_BOX_FROM:
        wide = WIDE_BOX_EFFICIENCY.get(cab_type, WIDE_BOX_EFFICIENCY["base"])
        return wide[min(wide, key=lambda k: (abs(k - width_inches), k))]
    if width_inches >= WIDTH_EFFICIENCY_FLAT_ABOVE:
        return 1.0
    if width_inches in WIDTH_EFFICIENCY_MULTIPLIER:
        return WIDTH_EFFICIENCY_MULTIPLIER[width_inches]
    # Between listed sizes, take the nearest rather than interpolating -
    # the curve is shallow and cabinet widths are discrete anyway.
    nearest = min(
        WIDTH_EFFICIENCY_MULTIPLIER,
        key=lambda k: (abs(k - width_inches), k),
    )
    return WIDTH_EFFICIENCY_MULTIPLIER[nearest]


# Sink sized off its base cabinet: the trade rule is sink = cabinet width
# minus ~3" for the rim, rails and clips. A 30" base therefore tops out at
# a 27" sink, and a 42" base takes 39-40" (40" workstation sinks are sold
# as "fits a standard 42-inch sink base"), NOT 36" - quoting 36" there
# under-sizes the sink by 3-4".
# Prices are supply-only and derived from the two figures this table was
# already calibrated on - $305 for a 30" single (Kraus KHU100-30) and $458
# for a 33" double (KHU102-33), which sit at ~76-81% of those models'
# retail ($399.95 / $564.95), i.e. a contractor-supply basis. The other
# widths are scaled from those two anchors on the same basis.
# A 42" CORNER sink base behaves like a 30" cabinet (~27" max), but the
# catalog has no corner sink base, so it is not represented here.
SINK_BY_BASE = {
    #  base:  (sink width, single $, double $)
    30: (27, 265, 395),
    33: (30, 305, 458),
    36: (33, 350, 520),
    42: (39, 430, 640),
}

# Base widths below the smallest entry fall back to the 30" row; anything
# wider than the largest falls back to the 42" row.
SINK_BASE_FALLBACK = (30, 42)


# The prices above as a table a company can price: {base: {single, double}}.
# sink_for_base reads them from here, the widths from SINK_BY_BASE.
SINK_PRICES = {
    base: {"single": single, "double": double}
    for base, (_sink_w, single, double) in SINK_BY_BASE.items()
}


def sink_for_base(base_width: int) -> tuple:
    """Pick (sink_width, single_price, double_price) for a sink base.

    Snaps to the nearest listed base width rather than interpolating -
    sinks are sold in discrete sizes, so an odd base still takes a
    stock sink.
    """
    if not SINK_BY_BASE:
        return 30, 305, 458
    lo, hi = SINK_BASE_FALLBACK
    if base_width in SINK_BY_BASE:
        base = base_width
    elif base_width < lo:
        base = lo
    elif base_width > hi:
        base = hi
    else:
        base = min(SINK_BY_BASE, key=lambda k: (abs(k - base_width), k))
    prices = SINK_PRICES[base]
    return SINK_BY_BASE[base][0], prices["single"], prices["double"]


# A double bowl needs roughly 30" of sink to be usable; below that the two
# bowls are too narrow to be practical. Warn, never block - the user may
# have a specific model in mind.
DOUBLE_BOWL_MIN_SINK_WIDTH = 30


# Width each TALL_CABINET_TYPES price is calibrated for. Appliance cabinets are
# wide by nature, so their size scaling is applied relative to this rather than
# to the 24" generic baseline - a cabinet at its typical width keeps the quoted
# price instead of picking up a second width premium.
TALL_TYPE_BASE_WIDTH = {
    "oven_cabinet": 33,
    "refrigerator_cabinet": 36,
}

# Box material multiplier (applied to cabinet supply cost).
# This axis is about the BOX construction only - what the sides, deck and
# shelves are made of. Door/finish material is the FINISH_MULTIPLIER axis.
# 2026-09-18: particleboard was 0.75, implying a 25% saving for dropping
# to the cheapest substrate. Manufacturers charge roughly +5-20% to
# UPGRADE to plywood, which puts particleboard nearer 0.88, not 0.75.
MATERIAL_MULTIPLIER = {
    "Plywood": 1.00,
    "MDF": 0.92,      # stable, heavy; mid-tier box material
    "Particle": 0.88,
}

# Finish multiplier.
# 2026-09-18: Painted moved 1.10 -> 1.15. Multiple sources converge on a
# 10-20% premium for paint over stain (extra prep, more coats, and any
# touch-up shows), so mid-range is the better default.
# Glazed is left at 1.25 but is genuinely volatile - manufacturers charge
# anywhere from 0% to 50% for a glaze - so it carries a warning rather
# than a number the estimator should trust blindly.
FINISH_MULTIPLIER = {
    "Stained": 1.00,
    "Painted": 1.15,
    "Glazed": 1.25,
    "Laminate": 0.85,
}

# Finishes whose real cost varies too much between manufacturers to quote
# from a table. The calculator emits a warning so the estimator confirms
# the actual upcharge with the supplier.
VOLATILE_FINISHES = {"Glazed"}

# Finishes whose toe kick and quarter round are painted on site. A stained
# or laminate line ships that trim prefinished to match, so it is
# installed, not painted.
PAINTED_FINISHES = {"Painted", "Glazed"}

# Specialty cabinet premiums ($ per box, on top of LF pricing).
#
# 2026-09-18: these are the STOCK-tier premiums. They used to be applied
# flat across every tier, which badly under-charged Custom - a lazy susan
# premium of $100 is not credible on a box whose 2 LF of cabinet alone is
# $1,372, and the hardware by itself is $139-$338. Scaled per tier via
# SPECIALTY_PREMIUM_TIER_SCALE below.
#
# 2026-09-18 (v2): the size-keyed values below are re-based on measured
# SKU deltas (same catalog, same style, so the delta is the feature):
#     3DB24 $625.11 - B24  $462.22 = +$162.89   (drawer base)
#     LSB36 $841.51 - B36  $667.45 = +$174.06   (lazy susan)
#     DCW2430 $429.87 - W2430 $332.84 = +$97.03 (diagonal corner wall)
#     BBC42 $530.43 - B42  $707.43 = -$177.00   (blind corner)
#     SB36  $501.61 - B36  $667.45 = -$165.84   (sink base)
# The last two came out NEGATIVE: a blind corner and a sink base carry
# fewer doors and no drawer box, so the carcass really is cheaper. They
# carry no premium; the saving is billed through
# SPECIALTY_SUPPLY_MULTIPLIER below instead (a lower LF rate on their own
# supply line), so no negative line reaches the customer.
#
# 2026-10-23: they were previously held at $0 on the theory that the
# saving was offset by a harder install. Nothing billed that install -
# cabinet install is a flat per-LF rate for every base - so the "offset"
# was really a ~25% overcharge on the box, about $150-$175 per sink base
# or blind corner at Stock and 3x that at Custom.
SPECIALTY_PREMIUM = {
    # Measured -$166 vs a standard base: see SPECIALTY_SUPPLY_MULTIPLIER.
    "sink_base": 0,
    "lazy_susan": {33: 160, 36: 174},  # measured +$174.06 at 36"
    # Measured -$177 vs a standard base: see SPECIALTY_SUPPLY_MULTIPLIER.
    "blind_corner": {36: 0, 39: 0, 42: 0, 45: 0},
    # Measured +$162.89 at 24"; scaled by width off that anchor.
    "drawer_base": {
        12: 115, 15: 128, 18: 140, 21: 152,
        24: 163, 27: 172, 30: 182, 36: 200,
    },
    # Measured +$97.03 at 24"x30". Flat across heights: the same catalog
    # gives DCW2436 +$94.68 vs W2436 and DCW2442 +$106.44 vs W2442 (the
    # height itself is already in the LF rate via WALL_HEIGHT_MULTIPLIER).
    "diagonal_corner_wall": {24: 97, 27: 110},
    # Easy-reach (pie-cut) corner wall, 24" along each wall with bi-fold
    # doors. Measured WER2430 $468.09 - W2430 $332.84 = +$135.25, and
    # +$134.66 at 36"H. 42"H measured +$158.78; held at the 30/36" figure
    # to stay flat across heights like the diagonal corner.
    "easy_reach_corner_wall": {24: 135},
    # Three-door corner wall, first built as a bay front in an inside corner,
    # one door on each of three angled faces. NOT measured: none of the
    # stock lines read (KCD, Capital, Arcadia, JSI) carries one past the 27"
    # single-door diagonal, so it is a semi-custom build. Derived from
    # DCW2430 instead, 1.29x W2430 in both KCD and Capital: the 36" unit has
    # about twice its shelf and door area, so about 2 x $392 at Stock here,
    # less the 3 LF x $142 its supply line already bills. The calculator warns
    # to confirm it (UNMEASURED_SPECIALTIES). On 2026-11-06 the cabinet was
    # reshaped to what it really is: a 12"-deep upper at the open end of a
    # run, its doors wrapping that end (front, a 45° cut, the end). Its old
    # $275 / $325 / $375 (30 / 33 / 36") was worked out for the inside-corner
    # shape. On 2026-11-06 the user had it set to the three-door angle end's
    # flat $200 (see three_door_angle_end_wall, Wolf's same-line steps): the
    # same wrap, so the same two extra doors, and the price no longer jumps
    # from a 27" WEA3D to a 30" WTD.
    "three_door_corner_wall": 200,
    # Blind corner in the WALL run. The $45-$75 that used to sit here was
    # never measured; KCD White Shaker WBC27 comes in UNDER the two-door
    # W27 at every height (-$49 / -$65 / -$67 at 30/36/42"H), so it is a
    # cheaper box: see SPECIALTY_SUPPLY_MULTIPLIER.
    "blind_corner_wall": 0,
    # Trash / recycle pull-out. Standard issue in a new kitchen; the
    # hardware alone is $100-$250.
    "trash_pullout": {15: 195, 18: 215, 21: 235, 24: 255},
    # Farmhouse / apron sink base - the front is cut away for the apron,
    # which is a different box from a standard sink base ($0 premium).
    "farmhouse_sink_base": {30: 215, 33: 240, 36: 275, 42: 330},
    # Angle end base: a run end cut back at 45° (open or doored). KCD White
    # Shaker BEC24 $414.00 vs B24 $462.22 = -$48.22: a cheaper box, see
    # SPECIALTY_SUPPLY_MULTIPLIER.
    "angle_end_base": 0,
    # Angle end upper (WEA1230/36/42): 12" along the wall, cut back at 45°
    # with one door on the cut. Billed as a plain 12" wall box: Kunal
    # Westport White at Home Depot lists WEA1230 $146.99 vs W1230 $156.01,
    # about 6% cheaper, too little (and one line only) to give it its own
    # cheaper supply line the way angle_end_base has.
    "angle_end_wall": 0,
    # Two-door angle end upper (WEA2D1230/36/42), added 2026-11-06 at the
    # user's ask: Wolf's WEC1230D, the 12" x 12" angle end with its front
    # bent once into two faces at 135°, a door on each. Measured on Wolf's
    # Designer price list (March 2025): WEC1230D $753 vs the one-door WEC1230
    # $480 vs W1230 $429 in column 1 ($1205 / $846 / $775 in column 12). The
    # second door is +$273 / +$359, 0.64 / 0.46 of a W1230: $66-$90 at our
    # Stock $142 for a 12" box, which already pays for the first door (the
    # one-door angle end bills as a plain 12" box). $90, the column-1 end,
    # as for the three-door angle end below.
    "two_door_angle_end_wall": 90,
    # Three-door angle end upper (WEA3D, 12"-27" wide), added 2026-11-06 at
    # the user's ask: a 12"-deep run end with a door on each face it shows -
    # the front, the 45° cut and the end (the three-door corner's wrap below
    # its 30" sizes). No stock line carries it (Home Depot, Kitchen Cabinet
    # Kings, RTA and custom makers searched: angle ends come with one door,
    # Wolf's WEC1230D with two), so it is priced from Wolf's same-line steps
    # (Designer price list, March 2025, 12" x 30"H, column 1 / column 12):
    #     W1230 plain                      $429 / $775
    #     WEC1230 angle end, one door      $480 / $846
    #     WEC1230D angle end, two doors    $753 / $1205  -> a facet door +$273 / +$359
    #     FFDL/FFDR door on the end, wall  +$390 flat
    # The LF line bills the box with its front door, so the premium is the cut
    # door and the end door: ($273 + $390) / $429 to ($359 + $390) / $775 of a
    # W1230, which at our Stock $142 a 12" box is $137-$219. $200 sits near
    # the top (Stock is the cheaper door-style columns) and is flat: the two
    # doors cost the same on a wider box, and a flat premium keeps the price
    # rising with the width. Still a derived figure, so the calculator warns
    # to confirm it (UNMEASURED_SPECIALTIES).
    "three_door_angle_end_wall": 200,
    # Diagonal corner base (diagonal lazy susan): KCD has none in the line,
    # so measured at Fourless ATL White Shaker CBD36 $581.04 vs B36 $470.88
    # = +$110.16. Shape-wise the base twin of diagonal_corner_wall.
    "diagonal_corner_base": {36: 110},
    # Microwave drawer base - cut opening + reinforced support.
    "microwave_drawer_base": {24: 185, 27: 200, 30: 220},
    # Deep upper over a fridge (24" deep rather than 12"). Nearly twice
    # the box of a normal wall cabinet at the same face width.
    "refrigerator_wall_deep": {30: 165, 33: 180, 36: 200, 42: 235},
    # OTR microwave cabinet: 18"H upper with a cut-out and venting
    # provisions. Without this it was billed as a plain short wall box.
    "otr_microwave_wall": {30: 145, 33: 158, 36: 172},
    "oven_cabinet": 0,       # priced via TALL_CABINET_TYPES
    "refrigerator_cabinet": 0,  # priced via TALL_CABINET_TYPES
    # Pantry with roll-out trays - priced per tray, not per box, so the
    # premium here covers the cabinet prep only.
    "pantry_rollout": {24: 240, 30: 290, 33: 320, 36: 350},
    # Double oven / oven + microwave stack. Taller cut-out, more
    # structure than a single-oven cabinet.
    "double_oven_cabinet": {30: 420, 33: 460, 36: 505},
    # Range bases. A slide-in needs finished end panels on the cabinets
    # flanking the range opening, so its premium is per-panel rather than
    # flat - see RANGE_END_PANEL_EACH and the range_panel_count box field.
    # A drop-in needs the cabinet itself built/cut to carry the unit, which
    # is a one-off carpentry cost that does not scale with panel count.
    "range_base_slide_in": 0,   # priced via RANGE_END_PANEL_EACH x panels
    "range_base_drop_in": 420,  # custom cabinet build + cutout
}

# Specialty boxes that measure CHEAPER than the standard box of the same
# width (fewer doors, no drawer box, a blind or cut-back end). They are
# billed on their own LF supply line at this fraction of the standard
# rate, which keeps every line positive. Ratios are same-line KCD White
# Shaker prices, specialty / standard of the same width:
#     SB36  $501.61 / B36  $667.45 = 0.752
#     BBC42 $530.43 / B42  $707.43 = 0.750
#     WBC27 / W27 at 30, 36, 42"H  = 0.867, 0.846, 0.862
#     BEC24 $414.00 / B24  $462.22 = 0.896
# Install stays at the full per-LF rate: the box is set like any other.
SPECIALTY_SUPPLY_MULTIPLIER = {
    "sink_base": 0.75,
    "blind_corner": 0.75,
    "blind_corner_wall": 0.86,
    "angle_end_base": 0.90,
}

# Specialties whose premium is derived rather than read off a price list. The
# calculator tells the estimator to confirm the figure with the supplier.
UNMEASURED_SPECIALTIES = {"three_door_corner_wall", "three_door_angle_end_wall"}

# Specialty premiums above are quoted at Stock tier. The same feature
# costs more in a better box: the hardware is upgraded (a Custom lazy
# susan uses $139-$338 hardware, not the $100 the flat table implied) and
# the joinery around the mechanism is built to the same standard as the
# rest of the run.
SPECIALTY_PREMIUM_TIER_SCALE = {
    "Stock": 1.00,
    "Semi-Custom": 1.60,
    "Custom": 2.40,
}

# SPECIALTY_TALL_TYPES is defined just below TALL_CABINET_TYPES, which
# it is derived from.

# Finished end panel for a slide-in range opening, per panel.
# Market: Hampton Bay BEP1.5 (24"W x 34.5"H base end panel) $75-$105
# depending on finish; $95 sits mid-range and covers install handling.
# A typical opening is flanked on both sides (2 panels); an opening at a
# wall end exposes only one.
RANGE_END_PANEL_EACH = 95

# Tall cabinet type-specific pricing (replaces generic tall_each when specified)
# These are per-EA prices by tier, reflecting actual appliance cabinet costs
#
# 2026-09-18 (v1) correction. These prices were BELOW a plain pantry of
# the same size, which inverts how the boxes are actually built. An oven
# cabinet is a pantry box PLUS a cut appliance opening, reinforced
# support rails and trim around the cutout - it cannot cost less.
#
# 2026-09-18 (v2) re-derivation. Two things changed:
#
#  1. The generic tall rate they are derived from moved (see BASE_RATES),
#     so these had to be recomputed regardless.
#
#  2. v1's "oven = generic x 1.25" DOUBLE-COUNTED WIDTH. Both entries are
#     priced at their TALL_TYPE_BASE_WIDTH (oven 33", fridge 36") and the
#     calculator applies TALL_WIDTH_MULTIPLIER relative to that, so the
#     multiplier here must be the cutout/structure premium ALONE.
#     The measured SKU pair is O338424 $1,335.49 / U248424 $1,080.85 =
#     1.236 - but that ratio still carries the 33"-vs-24" width. Strip it
#     (/1.22) and the pure oven premium is only 1.013.
#     Wolf's published schedule puts the oven cutout (COS) at +20-30%.
#     The two sources disagree, so the midpoint is used: x1.132.
#
# Fridge cabinet stays at x0.80 of the generic tall at 36": it is a short
# bridge box with deep returns, carrying less material than a full-height
# pantry but far more than a 12"-deep wall unit.
TALL_CABINET_TYPES = {
    "oven_cabinet": {
        # 33" generic: Stock 915 / Semi 1507 / Custom 2776, x1.132
        "Stock": 1036,
        "Semi-Custom": 1706,
        "Custom": 3142,
    },
    "refrigerator_cabinet": {
        # 36" generic: Stock 975 / Semi 1606 / Custom 2958, x0.80
        "Stock": 780,
        "Semi-Custom": 1284,
        "Custom": 2366,
    },
}

# Types whose per-EA price already comes from TALL_CABINET_TYPES, which
# is tier-keyed, so their specialty premium must not be tier-scaled on
# top of that.
# IMPORTANT: only types with a TALL_CABINET_TYPES entry belong here.
# double_oven_cabinet and pantry_rollout are billed as a generic tall box
# PLUS a specialty premium, so that premium DOES need the tier scale —
# listing them here would quote the same upcharge on a Custom kitchen as
# on a Stock one.
SPECIALTY_TALL_TYPES = set(TALL_CABINET_TYPES.keys())

# Glass door upgrade premium (per door, added on top of standard door
# pricing).
#
# 2026-09-18 (v2): the measured SKUs show these are really two different
# products, and this table was sitting between them:
#   * GLASS-READY door (W3030GD $407.53 vs W3030 $395.77 = +$11.76):
#     the frame is built with a rabbet and no center panel. The glass
#     itself is NOT included — a glazier or the installer fits it.
#   * FINISHED glass door (mullion frame + tempered glass installed):
#     $150-$300 at market.
# These values represent the FINISHED door, which is what a customer
# means by "glass doors", so Stock is raised to the bottom of that band.
# If the shop is only supplying glass-ready frames and the glass is
# billed separately, use GLASS_READY_DOOR_PREMIUM instead.
GLASS_DOOR_PREMIUM = {
    "Stock": 160,        # finished tempered glass door
    "Semi-Custom": 225,  # mullion frame + tempered glass
    "Custom": 322,       # custom glass panel with detailed mullion
}

# Frame only, prepped for glass — glass supplied and fitted separately.
# Measured +$11.76 on a stock door; tiers scaled off that.
GLASS_READY_DOOR_PREMIUM = {
    "Stock": 12,
    "Semi-Custom": 18,
    "Custom": 30,
}

# A door with a pattern in its frame instead of a plain panel, per door on top
# of the box. The glass is NOT in this: tick Glass on the box for that.
#
# "lattice" is a diamond-lattice frame. Three reads of what the frame costs
# over a plain door:
#   * Arcadia White Shaker mullion doors: $89 (15x30), $112 (18x30), $128
#     (18x36) each, on a line whose W3030 is $271 against $358 at Stock here,
#     so about $135 for a typical door at our level.
#   * CabinetNow diamond "specialty lite" $62.30/SF vs plain $33.20/SF: +$29/SF,
#     or $90-$150 on a 15x30 to 18x42 door.
#   * QuikDrawers mullions, $6.30 a lite: $75-$100 for 12-16 lites.
# Tiers follow GLASS_DOOR_PREMIUM's ratios (1 : 1.41 : 2.01).
#
# "lattice_band" adds a carved band with oval cut-outs under the lattice, the
# whole cabinet front as one panel. Billed by the doors the box would have
# had, since that one panel covers them. The band's +$50 is an allowance: no
# price list carries it separately.
#
# "mullion" is a square grid of bars over glass (added 2026-11-06 from the
# user's photo: two lites across, four down). The Arcadia mullion doors and
# QuikDrawers' per-lite price above are this door, so it takes the lattice's
# $135. The glass is billed by the box's Glass tick, which the Edit tab sets
# with it.
DOOR_PATTERN_PREMIUM = {
    "lattice": {"Stock": 135, "Semi-Custom": 190, "Custom": 270},
    "lattice_band": {"Stock": 185, "Semi-Custom": 260, "Custom": 370},
    "mullion": {"Stock": 135, "Semi-Custom": 190, "Custom": 270},
}

DOOR_PATTERN_LABELS = {
    "lattice": "Diamond Lattice",
    "lattice_band": "Lattice + Oval Band",
    "mullion": "Glass Mullion",
}

# Island end panel / back panel pricing (per SF, finished to match cabinets)
# Typical sizes: base end panel ~5.75 SF (24"x34.5"), tall ~14 SF (24"x84")
# Back panel varies by island length: e.g. 60"x34.5" = ~14.4 SF
ISLAND_PANEL_PRICING = {
    "end_panel_per_sf": {
        "Stock": 19,         # 3/4" matching laminate/veneer, +6%
        "Semi-Custom": 36,   # 3/4" plywood with finish match, +14%
        "Custom": 65,        # solid wood or premium veneer, +18%
    },
    "back_panel_per_sf": {
        "Stock": 16,         # +7%
        "Semi-Custom": 32,   # +13%
        "Custom": 56,        # +16%
    },
    # 2026-09-18 (v2): raised 9 -> 13. Installers quote finished panels
    # at a flat ~$100/panel, which on a typical 5-8 SF panel works out to
    # $12.50-$20/SF. $9/SF was below the bottom of that. The v2 review
    # confirmed the SUPPLY rates above against ABCabinetry ($19.20/SF
    # measured vs $19 here), so only the labor line needed moving.
    "install_per_sf": 13,
}

# Prefab island pricing (EA, supply only — by size x tier)
# Based on market data: Home Depot, Lowe's, Wayfair (2025-2026)
PREFAB_ISLAND_PRICING = {
    "small": {   # ≤40" length
        "label": "Small (≤40\")",
        "Stock": 636,         # +6%
        "Semi-Custom": 1368,  # +14%
        "Custom": 2950,       # +18%
    },
    "medium": {  # 41"-54"
        "label": "Medium (41\"-54\")",
        "Stock": 963,         # +7%
        "Semi-Custom": 2070,  # +15%
        "Custom": 4165,       # +19%
    },
    "large": {   # 55"-72"
        "label": "Large (55\"-72\")",
        "Stock": 1484,        # +6%
        "Semi-Custom": 3164,  # +13%
        "Custom": 5850,       # +17%
    },
    "xl": {      # 73"+
        "label": "X-Large (73\"+)",
        "Stock": 2160,        # +8%
        "Semi-Custom": 4408,  # +16%
        "Custom": 8400,       # +20%
    },
}

PREFAB_ISLAND_INSTALL = {
    "small": 324,   # +8%
    "medium": 385,  # +10%
    "large": 436,   # +9%
    "xl": 560,      # +12%
}

# Crown molding for wall cabinets (per LF, material + install)
CROWN_MOLDING_PRICING = {
    "Stock": 13,         # basic MDF crown, per LF material, +8%
    "Semi-Custom": 25,   # solid wood crown, per LF material, +14%
    "Custom": 45,        # decorative multi-piece crown, per LF material, +18%
    "install_per_lf": 11,  # labor per LF (market $6-$12), +10%
}

# Backsplash pricing (per SF, material + install)
BACKSPLASH_TYPES = {
    "ceramic_tile": {
        "label": "Ceramic Tile",
        "material_per_sf": 9,    # +9%
        "install_per_sf": 13,    # +10%
    },
    "subway_tile": {
        "label": "Subway Tile",
        "material_per_sf": 11,   # +9%
        "install_per_sf": 15,    # +10%
    },
    "glass_tile": {
        "label": "Glass Tile",
        "material_per_sf": 28,   # +10%
        "install_per_sf": 19,    # +8%
    },
    "stone_marble": {
        "label": "Stone / Marble",
        "material_per_sf": 39,   # +11%
        "install_per_sf": 24,    # +9%
    },
}

# Zip3-based labor multipliers for DMV area
DMV_ZIP3_MULTIPLIERS = {
    # DC
    "200": 1.05,
    "202": 1.00,
    # Maryland
    "206": 1.00,
    "207": 0.95,
    "208": 1.05,  # Montgomery County (Bethesda etc.)
    "209": 1.00,
    "210": 0.95,
    "211": 0.95,
    "212": 0.95,
    "216": 0.95,
    # Northern Virginia
    "220": 1.00,
    "221": 1.05,  # Fairfax, Arlington (McLean etc.)
    "222": 1.00,
    "223": 1.00,
}

# Premium zip code overrides (Bethesda, McLean, Great Falls, Georgetown etc.)
PREMIUM_ZIP_OVERRIDES = {
    "20815", "20816", "20817", "20854",  # Bethesda/Potomac
    "22101", "22102", "22066",           # McLean/Great Falls
    "20007", "20008", "20015",           # Georgetown/NW DC
}

# Scope items (labor and ancillary charges)
SCOPE_ITEMS = {
    # Cabinet tear-out, per LF of cabinet run. Xactimate puts straight
    # removal at $7-$16/LF and Homewyse at $28-$59/LF; the spread is
    # whether hauling is in the number. Here it is NOT - disposal is
    # billed separately through the dumpster line - so this sits at the
    # lower-middle of the range rather than the $31 it was.
    # 2026-09-18: trimmed from $31 to avoid overlapping the dumpster.
    "demo_per_lf": 24,
    "demo_min": 440,
    # Install labor — tier-keyed (2026-08-26): custom installs take
    # meaningfully more skilled labor time than stock RTA installs.
    # Stock anchored to the prior flat value (+5-8%), Semi-Custom/Custom
    # scaled up from the new Stock value (+20-30% / +45-60%) to reflect
    # real labor-hour differences, not just a market-comparison nudge.
    "install_base_per_lf": {         # market $90-$150/LF
        "Stock": 100,
        "Semi-Custom": 125,
        "Custom": 150,
    },
    "install_wall_per_lf": {         # market $75-$120/LF
        "Stock": 86,
        "Semi-Custom": 105,
        "Custom": 131,
    },
    "install_tall_per_each": {       # market $145-$225/EA
        "Stock": 189,
        "Semi-Custom": 242,
        "Custom": 299,
    },
    # Delivery: base fee + per-LF surcharge for larger kitchens
    "delivery_base": 162,            # +8%
    "delivery_per_lf": 3.3,          # additional per total LF, +10%
    "delivery_min": 162,             # +8%
    # Floor surcharge: $75/floor above ground level
    "delivery_floor_surcharge": 82,  # +9%
    # Plumbing
    "plumbing_disconnect": 248,      # +10%
    # Reconnect = trip/setup + the core sink hookup (drain + supply).
    # Market: a simple drop-in reconnect at the same hole/drain runs
    # $150-$250, and the minimum service fee ($100-$175) already covers
    # 1-2 hours. Everything else that happens under that same sink is
    # itemized below at MARGINAL labor - the crew is already on site, so
    # a part is not re-charged the standalone installed rate (a P-trap is
    # $313-$393 installed alone but only $25-$65 in parts).
    # Was a $500 catch-all covering P-trap/disposal/DW/faucet; those are
    # now their own lines, so this was re-based to avoid double-charging.
    "plumbing_reconnect": 225,
    # Each sink beyond the first. The trip is already paid on the first
    # one, so this is the hookup alone: a simple reconnect at an existing
    # hole/drain is $150-$250 all-in, less the trip portion it no longer
    # carries. (The $400-$1,500 island rough-in figures do NOT apply -
    # that is running new supply/drain to a new fixture location, not
    # reconnecting plumbing that is already there.)
    "plumbing_reconnect_additional_sink": 110,
    # ── Under-sink components (material + marginal labor, 1 sink) ──
    # No published figure exists for marginal add-on labor, so it is
    # derived: residential plumbers run $80-$130/hr, and these parts take
    # 15-25 min each for a crew already under the sink -> ~$25-$45.
    "p_trap_assembly": 80,           # $45 part + $35 labor; 1 per sink
    "supply_line_each": 43,          # $18 braided riser + $25; 2 per sink
    "angle_stop_each": 65,           # $25 valve + $40; 2 per sink
    # AAV / air gap: both were below even the low end of their installed
    # market ($150-$350 AAV, $80-$300 air gap) because the labor side was
    # priced as a pure marginal add-on. It is marginal, but it still
    # involves cutting into the drain line and testing, so it is not the
    # 20-minute figure the other under-sink parts carry.
    "aav_vent": 155,                 # $45 AAV + $110 (cut-in + test)
    "air_gap": 95,                   # $25 fitting + $70 (deck drill + hook-up)
    "soap_dispenser": 65,            # $30 + $35 (market $25-$50 install)
    # Instant hot: unit $286-$1,178 (mid ~$340); install is a 2-3 hr job
    # at $45-$200/hr, so ~$200 at a mid-market rate.
    "instant_hot_dispenser": 540,    # $340 unit + $200 labor
    # DW hookup parts. The dishwasher's own detach/reset is NOT here -
    # it lives in APPLIANCE_RR_PRICING["dishwasher"], and so does the
    # disposer, so plumbing must not re-charge either one.
    "dw_supply_line": 43,            # $18 line + $25
    "dw_angle_stop": 65,             # $25 valve + $40
    # Sink (supply only — install included in reconnect).
    # Kept as the 30" single / 33" double baseline for compatibility;
    # the actual sink is sized off the sink base width via SINK_BY_BASE.
    # Single 30": Kraus KHU100-30
    "sink_single_supply": 305,       # +9%
    # Double 33": Kraus KHU102-33
    "sink_double_supply": 458,       # +9%
    # Faucet: Moen/Delta pull-down (supply only)
    "faucet_supply": 231,            # +10%
    # Garbage Disposal: InSinkErator 3/4HP (supply only).
    # 2026-09-18: $178 is a 1/2HP Badger price, not a 3/4HP unit - the
    # Evolution 1300 (3/4HP) retails $316.99. Re-based to a contractor
    # basis on the unit the label actually names.
    "disposal_supply": 265,
    # Countertop detach & reset. Was a flat $610 regardless of run length,
    # which over-charges a small galley and under-charges a big U-shape.
    # Xactimate D&R runs $18-$22/LF, so this is now per-LF against the
    # base-cabinet run, with a minimum that covers the trip and the two-
    # person lift on even a short counter.
    "countertop_reset_per_lf": 22,
    "countertop_reset_min": 385,
    # Toe kick (runs along base cabinets, market $3-$10/LF material+labor;
    # base molding installed runs $9-$14/LF). Was $13 — top of range for
    # what is a simple ripped-and-fitted strip. Trimmed to mid-range.
    "toe_kick_per_lf": 10,
    # Quarter round (shoe molding) along the base cabinets where the toe
    # kick meets the floor. Market $3-$7/LF installed (Angi 2026); the
    # bathroom quotes paint-grade pine at $4.90 before paint. One rate
    # whether it is painted on site or prefinished to match.
    "quarter_round_per_lf": 6,
    # Countertop supply+install rates live in COUNTERTOP_MATERIALS,
    # the only table the calculator reads - do not duplicate them here.
    # Drywall - Patch & Repair (nail holes, screw holes, minor damage)
    "drywall_patch_per_sf": 2.75,    # +10%
    # Drywall - R&R (remove & replace sheetrock behind cabinets)
    "drywall_rr_per_sf": 5.00,       # +11%
    # Painting (prep + prime + paint), per SF of WALL area.
    # 2026-09-18 correction: these were $2.73 + $4.35 = $7.08/SF, against a
    # market of $1.29-$2.78/SF for wall prep + primer + two finish coats.
    # The old numbers look like cabinet-refinishing rates applied to a wall
    # SF quantity - the UI feeds this the drywall repair area, which is
    # wall, not cabinet face. Re-based to the wall-painting market at the
    # upper end (DMV labor, small patch areas, cut-in around cabinets).
    # Cabinet REFINISHING is a different scope priced per LF, not here.
    # v2 re-check: the old $7.08/SF was NOT simply "2.5-5x too high" as
    # v1 concluded - it matches Homewyse's CABINET painting rate of
    # $5.40-$10.79/SF almost exactly. So the old number was a correct
    # cabinet-refinishing rate sitting on a field that is fed WALL area.
    # It was a misclassification, not a bad number. These wall rates are
    # the right ones for what this field measures; if cabinet refinishing
    # is ever added it needs its own line (and is quoted per LF, not SF).
    "paint_prep_per_sf": 0.95,
    "paint_primer_paint_per_sf": 1.75,
    # Backsplash misc materials (grout, thinset, tape), per SF.
    # 2026-09-18 correction: was $4.91/SF, which is roughly what the tile
    # itself costs and 2-5x the actual consumable cost. Thinset and grout
    # run $1.00-$2.50/SF in materials, and the setting labor is already
    # carried by BACKSPLASH_TYPES[...]["install_per_sf"], so the old rate
    # was partly double-charging labor that the install line already bills.
    "backsplash_misc_per_sf": 1.60,
    # Appliance detach & reset costs live in APPLIANCE_RR_PRICING.
    # Dumpster / trash disposal (by size)
    "dumpster_10yard": 382,          # +9%
    "dumpster_15yard": 468,          # +10%
    "dumpster_20yard": 544,          # +10%
    "dumpster_30yard": 660,          # +11%
    # DC only: a dumpster placed on a street, alley, or sidewalk needs a
    # DDOT Public Space Occupancy Permit. DCMR 5/24 §225 puts it at
    # $50/week plus a 10% technology fee (~$55/week all-in), with $25 per
    # additional 6ft over 12ft. Working without one starts at a $300
    # fine. Billed as a 2-week allowance, the usual kitchen duration.
    # MD/VA are separate regimes and are not covered by this line.
    "dc_dumpster_public_space_permit": 110,
    # Site protection & cleanup: scale with kitchen size (total LF)
    "site_protection_base": 82,      # +9%
    "site_protection_per_lf": 3.3,   # +10%
    "cleanup_base": 82,              # +9%
    "cleanup_per_lf": 3.3,           # +10%
    # Cabinet hardware (knobs/pulls) — supply + install per opening
    "hardware_per_opening": 16,      # mid-grade knob/pull supply, +7%
    "hardware_install_per_opening": 9,  # +12%
    # Electrical disconnect/reconnect (disposal, DW, under-cab light, range)
    "electrical_disconnect_reconnect": 358,  # market $200-$400, +10%
    # Permit allowance. Kept as the fallback when the jurisdiction cannot
    # be determined from the zip; the real figure is computed by
    # permit_fee() below, which scales with project cost the way the
    # jurisdictions actually bill.
    "permit_allowance": 270,
    # Outlet relocation (cabinet layout change often misaligns outlets)
    "outlet_relocation_each": 245,           # market $150-$300 per outlet, +9%
}

# Appliance detach & reset pricing (per unit)
#
# 2026-09-18 rebuild. The old table was labelled "Xactimate RCV" but had
# drifted badly out of line with the D&R line items it claimed to follow,
# and the internal ordering had inverted: a dishwasher ($449) priced 2.7x a
# wall oven ($167), and a disposer ($305) matched a gas range ($307).
# Neither is defensible on any price list — a wall oven is a two-person
# lift out of a cabinet opening with a hardwired connection, a disposer is
# a 20-minute twist-off.
#
# Rebuilt against Xactimate D&R line items (detach and reset the EXISTING
# unit - crew time only, no new appliance, no haul-off):
#   DWRS   Dishwasher - Detach & reset          $271.88 (NJ 2021)
#   OVBIRS Oven, built-in - Detach & reset      ~$242
#   RGGRS  Range, gas - Detach & reset          ~$186
#   MWSRS  Microwave, built-in - Detach & reset ~$141
#   HDRS   Range hood - Detach & reset          ~$105
#   RHRS   Range hood, wood - Detach & reset    ~$284
#   Remove Garbage disposer                     $42.33
# DMV labor sits above the NJ 2021 book, so these carry a regional uplift
# rather than copying the published figures outright. What matters is that
# the ORDER is now right: oven > dishwasher > range > microwave > hood,
# and the disposer is the cheapest line on the table.
#
# NOTE: this is Detach & Reset — reusing the customer's own appliance.
# Replacing a unit (new appliance + haul-off) is a different scope and is
# not priced here; quote the appliance separately if that is the job.
#
# ── Which basis this table uses (settled 2026-09-18, v2) ──
# The v2 review compared this table against two different bases and found
# it "too high on one, too low on the other". The basis is deliberately
# Xactimate D&R, because this estimator is claim-linked and the UI calls
# the scope "Detach & Reset" throughout.
#
# Two cautions when re-checking these numbers against a price list:
#
#  * Xactimate publishes DETACH-ONLY line items (e.g. "Dishwasher -
#    Detach" $96.78) alongside DETACH & RESET ones (DWRS $271.88).
#    Detach-only is half the job. Comparing this table to a detach-only
#    figure will always make it look 2-4x "too expensive" - that is the
#    comparison being wrong, not the price.
#
#  * Retail appliance-installer price lists carry a MINIMUM TRIP CHARGE
#    (~$245) on every unit. That is right for a homeowner installing one
#    appliance, but a kitchen reset moves 4-6 appliances on a single
#    visit, so applying a per-unit trip charge would bill the same trip
#    five times. If this estimator ever needs the retail basis, the trip
#    has to be pulled out into one shared line.
#
# Against the D&R benchmark the table now runs a consistent 1.16-1.28x
# (DMV labor uplift over the NJ-2021 published book).
# The table itself is GENERATED, not hand-written. See
# appliance_labor.py: retail pricing is derived from crew hours, and
# carrier pricing is mapped from the published Xactimate line items.
# Hand-editing individual prices is what produced the inversions this
# replaced (a dishwasher reset at 2.7x a wall oven), so edit the hours
# or the published figures instead.
#
# This name is kept, and defaults to the insurance basis, so existing
# callers keep working. Prefer appliance_table(basis) in new code.
APPLIANCE_RR_PRICING = appliance_pricing_dict(Basis.INSURANCE_DR)

# Each basis's detach & reset price per appliance, as a table a company can
# price. The hours model makes the defaults; the calculator reads the price
# from here.
APPLIANCE_RESET_PRICES = {
    basis.value: {
        key: info["cost"] for key, info in appliance_pricing_dict(basis).items()
    }
    for basis in (Basis.INSURANCE_DR, Basis.RETAIL_INSTALL)
}

# ── Material / labor split ──
# Share of a line item that is NON-LABOR cost - material, equipment, and hard
# fees. The remainder is crew time. Lines whose rate table already separates
# supply from install (hardware, crown molding, island panels, backsplash,
# plumbing) derive their own share from the real components and ignore this
# table; the values here are for rates quoted as a single supply-and-install
# number, so they are working assumptions. Adjust them here if they do not
# match how you bid - nothing else needs to change.
MATERIAL_SHARE = {
    "cabinet_supply": 1.00,      # boxes, doors, panels, prefab island
    "cabinet_install": 0.00,     # install labor only
    "demo": 0.00,
    "dumpster": 1.00,            # haul-off/disposal fee, no crew time in it
    "delivery": 0.00,            # freight/handling, billed as labor time
    "toe_kick": 0.35,            # trim stock vs. cut, fit and paint
    "quarter_round": 0.30,       # molding vs. cut, cope, nail and finish
    "countertop": 0.55,          # slab + fabrication vs. template and install
    "countertop_reset": 0.00,
    "drywall_patch": 0.20,       # compound and tape vs. labor
    "drywall_rr": 0.30,          # sheetrock + compound vs. labor
    "paint_prep": 0.15,
    "paint_finish": 0.30,        # primer and paint vs. labor
    "site_protection": 0.40,     # ram board, plastic, tape vs. labor
    "cleanup": 0.05,
    "appliance_rr": 0.00,        # detach and reset is crew time
    "electrical": 0.20,
    "outlet_relocation": 0.25,
    "permit": 1.00,              # a fee, not crew time
}

# Default O&P percentages (mixed material+labor project standard: 25-35%)
DEFAULT_OVERHEAD_PCT = 0.15
DEFAULT_PROFIT_PCT = 0.15

# ── Sales tax: deliberately NOT implemented ──
# The 2026-09-18 pricing review recommended adding a sales-tax line
# (DC 6% -> 7% on 2026-10-01; MD/VA tax the contractor at purchase, so it
# is already inside the material rates). It is intentionally NOT added:
# sales tax must never appear on the customer-facing cabinet PDF.
#
# The MD/VA half of that recommendation is already satisfied — BASE_RATES
# and the other material rates are quoted on a contractor-supply basis,
# which has the tax baked in. Do not add a separate tax line, a tax_rate
# field, or a tax row in export_service.py. If the DC rate change ever
# needs to be reflected, raise the material rates rather than itemizing
# tax as its own line.

# Layout type options
LAYOUT_TYPES = [
    "L-shape",
    "U-shape",
    "Galley",
    "Single Wall",
    "Island",
    "Peninsula",
    "Other",
]

# Door style options
DOOR_STYLES = [
    "Shaker",
    "Raised Panel",
    "Arched Raised Panel",
    "Slab",
    "Glass",
]

# Backsplash type labels for frontend dropdown
BACKSPLASH_TYPE_OPTIONS = list(BACKSPLASH_TYPES.keys())

# Countertop material options with per-SF installed rates (DMV mid-range)
# Sources: TruVine Renovations, GraniteASAP, Angi (2025-2026)
# 2026-09-18 (v1): Solid Surface and Marble corrected. Corian was priced
# level with granite ($95) despite selling well below it.
#
# 2026-09-18 (v2): Quartz and Quartzite lowered. v1 left them alone as
# "inside the 2026 national range", but DMV-local mid-range pricing
# (Fixr Bethesda, Boss Design Center Bethesda/McLean) puts quartz at
# $50-$75/SF and quartzite at $60-$100/SF installed - both were above
# the top of the local band, not inside it. Set just above the local
# ceiling, since these rates include fabrication, template, edge and
# removal of the old top.
# Granite and Marble verified in range and left alone.
COUNTERTOP_MATERIALS = {
    "Laminate": {"rate": 35, "label": "Laminate"},
    "Solid Surface": {"rate": 72, "label": "Solid Surface (Corian)"},
    "Butcher Block": {"rate": 70, "label": "Butcher Block"},
    "Granite": {"rate": 95, "label": "Granite"},
    "Quartz": {"rate": 90, "label": "Quartz"},
    "Quartzite": {"rate": 112, "label": "Quartzite"},
    "Marble": {"rate": 140, "label": "Marble"},
}

# 4" countertop backsplash (matching piece, per LF installed)
# Cut from same material as countertop, silicone adhesive
COUNTERTOP_BACKSPLASH_PER_LF = {
    "Laminate": 12,
    "Solid Surface": 22,
    "Butcher Block": 18,
    "Granite": 28,
    "Quartz": 32,
    "Quartzite": 38,
    "Marble": 45,
}

# ── Permit fees by jurisdiction ──
# Kitchen remodel permits are billed off the declared value of the work,
# not as a flat fee. The three DMV jurisdictions each do it differently:
#
#   DC          $30 base + 2% of construction value, +10% surcharge.
#               A $50k kitchen runs ~$1,111 in DC; a trade-only permit
#               (plumbing + electrical, no structural) is far less.
#   Montgomery  Tiered by value, roughly $400-$1,800 for a kitchen.
#   Fairfax/VA  Tiered by value, roughly $200-$1,500.
#
# Modeled as base + rate x project cost, clamped to the jurisdiction's
# observed floor and ceiling. These are allowances for estimating, not
# quoted fees - the permit office is the authority on the real number.
PERMIT_RULES = {
    "DC": {
        "label": "Washington DC",
        "base": 30,
        "pct": 0.02,
        "surcharge_pct": 0.10,   # applied to (base + pct x cost)
        "min": 330,
        "max": 5000,
    },
    "MD": {
        "label": "Montgomery County, MD",
        "base": 180,
        "pct": 0.009,
        "surcharge_pct": 0.0,
        "min": 400,
        "max": 1800,
    },
    "VA": {
        "label": "Fairfax County, VA",
        "base": 120,
        "pct": 0.007,
        "surcharge_pct": 0.0,
        "min": 200,
        "max": 1500,
    },
}

# Zip3 -> jurisdiction. Mirrors the DMV_ZIP3_MULTIPLIERS coverage above.
PERMIT_ZIP3_JURISDICTION = {
    "200": "DC", "202": "DC",
    "206": "MD", "207": "MD", "208": "MD", "209": "MD",
    "210": "MD", "211": "MD", "212": "MD", "216": "MD",
    "220": "VA", "221": "VA", "222": "VA", "223": "VA",
}


def permit_jurisdiction(zip_code: str) -> Optional[str]:
    """Map a zip to DC / MD / VA, or None when it is outside the DMV."""
    if not zip_code:
        return None
    return PERMIT_ZIP3_JURISDICTION.get(zip_code[:3])


def permit_fee(zip_code: str, project_cost: float) -> tuple:
    """Permit allowance for a project, by jurisdiction and declared value.

    Returns (fee, label). Falls back to the flat SCOPE_ITEMS allowance
    when the zip is outside the DMV, so an out-of-area estimate still
    carries a permit line rather than silently dropping it.
    """
    juris = permit_jurisdiction(zip_code)
    if not juris:
        return (
            SCOPE_ITEMS["permit_allowance"],
            "DMV allowance (jurisdiction undetermined)",
        )
    rule = PERMIT_RULES[juris]
    fee = rule["base"] + (project_cost or 0) * rule["pct"]
    fee *= 1 + rule["surcharge_pct"]
    fee = max(rule["min"], min(rule["max"], fee))
    return round(fee, 2), rule["label"]


# ── Door style multiplier (applied to cabinet supply) ──
# The door is the most visible and most machined part of the box, and the
# style drives real cost: a raised panel runs "roughly 10 to 20 percent
# higher because of the added machining" than a flat shaker, while a slab
# is a single flat piece with no frame at all. Glass is NOT here - it is
# priced per door via GLASS_DOOR_PREMIUM, since only some doors get it.
DOOR_STYLE_MULTIPLIER = {
    "Shaker": 1.00,        # baseline - the default in this market
    "Slab": 0.96,          # flat panel, no rails/stiles to machine
    "Raised Panel": 1.15,  # profiled center panel + shaped frame
    # The arched top rail is more machining on the same door, so the top of
    # the raised panel's 10-20% band. No published figure found: CabinetNow
    # sells arched and square at the same $/SF, other lines list it without a
    # percentage, so the calculator warns to confirm (VOLATILE_DOOR_STYLES).
    "Arched Raised Panel": 1.20,
    "Glass": 1.00,         # frame same as shaker; glass billed separately
}

VOLATILE_DOOR_STYLES = {"Arched Raised Panel"}

# ── Overlay / frame style multiplier (applied to cabinet supply) ──
# Inset doors sit flush INSIDE the face frame, which demands much tighter
# tolerances and more hardware - the trade puts it at +15-25% over a
# standard full-overlay door. Partial overlay is the cheap builder default.
OVERLAY_STYLE_MULTIPLIER = {
    "Full Overlay": 1.00,     # baseline
    "Partial Overlay": 0.95,
    "Inset": 1.20,
}

OVERLAY_STYLES = list(OVERLAY_STYLE_MULTIPLIER.keys())

# ── Filler / scribe molding ──
# Present on essentially every kitchen: the gap between the last cabinet
# and the wall is never exactly zero, and cabinet runs need a scribe strip
# to die into an out-of-plumb wall. Xactimate carries this as its own line
# item; this estimator had no way to bill it at all.
# Material $15-$42/EA depending on tier and length, plus cutting/fitting.
# 2026-09-18 (v2): measured filler stock is length-dependent —
# 3"x42" $27.05 vs 3"x96" $83.50 — so a single per-EA price cannot be
# right for both. Stock is set at the short (base-height) figure, which
# is the common case; a tall/pantry-height filler should be billed as
# FILLER_TALL_PRICING below.
FILLER_PRICING = {
    "Stock": 27,
    "Semi-Custom": 39,
    "Custom": 66,
    "install_each": 38,   # rip, scribe to the wall, fasten
}

# ── Angled (non-90°) joint ──
# Where a run or island turns at an angle other than 90°, the boxes stay
# square and the angle is taken up at the joint: a 45° angled filler,
# extra fitting to set the boxes at the angle, and (with a countertop) an
# angled cut in the top. Billed per joint (angled_joint_count).
#
# 2026-10-23 research:
#  * Angled filler: CabinetSelect Bay Shaker White AF342F 45° 3"x42" $63
#    vs the flat WF342 $46 in the same line = 1.37x. Applied to the flat
#    filler table above (27/39/66) -> 37/53/90. Retail angled fillers only
#    come in 45°; another angle is ripped from flat stock at similar cost.
#  * Fitting: no published "angled joint" line item exists (Xactimate is
#    not public). The nearest is a scribed filler panel, $75-$150 labor
#    each (handymaninstall.com 2026); angled runs add 20-30% install time
#    (Suparate). Set at $95, low in that band, since the filler's own fit
#    is in it and the run's LF install is billed separately.
#  * Angled countertop cut, per corner: stone $50-$155 (Accent Countertops
#    THD sheet "45° angle/inside corner" $155; Stonify and SlabWise
#    $50-$150) -> $110; laminate $40-$53 (CNC Cabinetry 2025) -> $46.
#    Solid surface and butcher block were not quoted: solid surface is
#    CNC-cut like stone, butcher block cut like laminate, so they take
#    those rates. Angled pieces also waste 20-35% more slab - that belongs
#    in the countertop SF, not here.
ANGLED_JOINT_PRICING = {
    "Stock": 37,
    "Semi-Custom": 53,
    "Custom": 90,
    "install_each": 95,
}
COUNTERTOP_ANGLED_CUT_EACH = {
    "Laminate": 46,
    "Butcher Block": 46,
    "Solid Surface": 110,
    "Granite": 110,
    "Quartz": 110,
    "Quartzite": 110,
    "Marble": 110,
}

# ── Island top overhang supports ──
# A seating overhang past what the top carries on its own needs steel
# brackets (or corbels) under it, set before the top is templated.
#
# 2026-10-24 research. Unsupported overhang limits, assuming the 3cm stone
# that US kitchens default to (the estimate does not record thickness):
#   Quartz 3cm   15" (Cambria guideline v23A; Caesarstone v0622 and MSI say
#                16" - the most conservative is used). 2cm: 12".
#   Granite 3cm  10" (CTaSC citing the NSI Dimension Stone Design Manual;
#                never over 1/3 of the top's width). 2cm: 6".
#   Marble, quartzite: no figure of their own found - natural stone, so
#                granite's 10".
#   Solid surface 6" for the usual 1/2" sheet (DuPont Corian K-25291).
#   Laminate     12" (MW Tops guideline; no Wilsonart/Formica document).
#   Butcher block 8" across the grain (Vermont Butcher Block; allen+roth).
# Spacing: 24" on center (Caesarstone, MSI, Corian, butcher block makers;
# Cambria allows 36"), the first within 3-6" of each end (Original Granite
# Bracket install guide) - 6" here.
# Price: hidden steel island bar $68.35-$70.25 (Original Granite Bracket,
# read live), Federal Brace Freedom $61.88-$78.60 list -> $70. Install:
# the bar sits in a pocket cut in the cabinet back and is screwed through
# the front wall, before the top goes on. Homewyse hardware install runs
# $26-$71 per item; fabricators charge $45 (Any Top Shop, bracket included)
# to $100-$300 installed (Blackburn's) -> $45 labor per bracket.
COUNTERTOP_SUPPORT_PRICING = {
    "bracket_each": 70,
    "install_each": 45,
}
COUNTERTOP_SUPPORT_RULE = {
    "max_unsupported_in": {
        "Laminate": 12,
        "Butcher Block": 8,
        "Solid Surface": 6,
        "Granite": 10,
        "Quartz": 15,
        "Quartzite": 10,
        "Marble": 10,
    },
    "spacing_in": 24,
    "end_inset_in": 6,
}

# Full-height (84-96") filler for a tall/pantry run. Measured $83.50.
FILLER_TALL_PRICING = {
    "Stock": 84,
    "Semi-Custom": 122,
    "Custom": 194,
    "install_each": 48,
}

# ── Finished end / skin panels ──
# Any cabinet run that ends in open space shows a raw box side unless it
# gets a finished panel. Charged per panel by cabinet type, since the
# panel is sized to the box.
#
# 2026-09-18 (v2): Stock column replaced with measured SKU prices. v1
# worked from a national $20-$200 range and got three of the four wrong,
# the tall panel badly:
#     wall panel        measured $72.34   (v1 had $46  — low)
#     base skin panel   measured $40.58   (v1 had $88  — high)
#     tall panel        measured $421.05  (v1 had $155 — 2.7x low)
#     fridge deep panel measured $244.05  (v1 had $235 — good)
# The tall figure is not an outlier: a tall end panel is a single 84-96"
# finished sheet, the largest flat piece in the kitchen, and it has to
# match the door finish across its whole face.
# Semi-Custom / Custom keep the v1 tier spread (~1.45x / ~2.3x Stock),
# which the v2 review verified against ABCabinetry $/SF.
END_PANEL_PRICING = {
    "wall": {"Stock": 72, "Semi-Custom": 104, "Custom": 166},
    "base": {"Stock": 41, "Semi-Custom": 59, "Custom": 94},
    "tall": {"Stock": 421, "Semi-Custom": 610, "Custom": 970},
    "refrigerator": {"Stock": 244, "Semi-Custom": 354, "Custom": 561},
    # v2: $9/SF install was below the trade norm — installers quote a
    # flat ~$100/panel, which on a 5-8 SF panel is $12.50-$20/SF.
    "install_each": 100,
}

END_PANEL_TYPES = {
    "wall": "Wall Cabinet End Panel",
    "base": "Base Cabinet End Panel",
    "tall": "Tall Cabinet End Panel",
    "refrigerator": "Refrigerator Deep End Panel",
}

# ── Dishwasher return panel ──
# The finished filler between the dishwasher opening and the adjacent
# cabinet or wall. v2 measured $95.27 (v1 estimate $88 — close).
DISHWASHER_RETURN_PANEL = 95

# ── Light rail molding ──
# Trim under the wall cabinets that hides under-cabinet lighting.
# v2: measured stock is sold by the piece, $125.84-$143.48 for an 8-10ft
# length, i.e. $13-$18/LF material — above the $8-$12/LF national figure
# v1 used. Material raised to the bottom of the measured band.
LIGHT_RAIL_PRICING = {
    "material_per_lf": 14,
    "install_per_lf": 9,
}

# Default overview text for PDF
DEFAULT_OVERVIEW = (
    "All cabinets will feature matching industrial-grade "
    "cabinet board surfaces on exposed fronts and sides, "
    "wall cabinet tops and bottoms (in most cases), "
    "toe-kick boards, and cabinet interiors. Unless "
    "otherwise specified, new drawer boxes will be "
    "provided with soft-closing undermount drawer tracks "
    "and hinges."
)


def size_tier_value(table: dict, size: float) -> tuple:
    """Look up a size-keyed price/multiplier table.

    Returns (value, matched_size). matched_size is None on an exact hit;
    otherwise it is the nearest size actually present, so the caller can warn
    that the quote is an approximation. Falling back to the nearest tier keeps
    an odd size close to its real cost - taking the table maximum, as this
    used to, overcharged every size below the largest one.
    """
    if not table:
        return 0, None
    if size in table:
        return table[size], None
    # On an exact tie, round up to the larger size rather than under-quote.
    nearest = min(table, key=lambda k: (abs(k - size), -k))
    return table[nearest], nearest


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return DMV_ZIP3_MULTIPLIERS.get(zip_code[:3], 1.00)


# ══════════════════════════════════════════════════════════════════
# Declared rates
# ══════════════════════════════════════════════════════════════════
# The plain numbers above are what the calculator reads today. This
# registry attaches the missing declaration - unit, basis, and what each
# rate already covers - to the ones whose ambiguity has actually caused
# a bug. It is the reference the tests check against, so a future edit
# that reintroduces a double count or a unit mismatch fails loudly.
#
# Adding a rate here does not change its value. See
# tests/test_cabinet_rate_declarations.py.

SCOPE_ITEM_DECLARATIONS = {
    # ── The painting unit mix-up ──
    # $7.08/SF was not a wrong number; it was a CABINET_FACE_SF rate
    # sitting on a field the UI feeds WALL_SF (it defaults to the drywall
    # repair area). Homewyse prices cabinet painting at $5.40-$10.79/SF
    # of cabinet face - the old value was close to correct for that
    # surface. Declaring the surface is what stops the substitution.
    "paint_prep_per_sf": Rate(
        value=SCOPE_ITEMS["paint_prep_per_sf"],
        unit=Unit.WALL_SF,
        basis=Basis.SUPPLY_AND_INSTALL,
        source="Homewyse interior wall prep, DMV",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset({Includes.SMALL_PARTS}),
        note="wall area, NOT cabinet face",
    ),
    "paint_primer_paint_per_sf": Rate(
        value=SCOPE_ITEMS["paint_primer_paint_per_sf"],
        unit=Unit.WALL_SF,
        basis=Basis.SUPPLY_AND_INSTALL,
        source="Homewyse wall prime + 2 coats $1.29-$2.78/SF",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset({Includes.FINISH, Includes.SMALL_PARTS}),
        note="wall area, NOT cabinet face",
    ),

    # ── The demo / dumpster double count ──
    # Xactimate carries tear-out both with and without haul-off
    # (WTRCABLOW $7/LF includes disposal; tear-out alone is $16.05/LF).
    # This rate is the EXCLUDING-disposal variant, because the dumpster
    # is billed as its own line. If that ever flips, the dumpster line
    # has to go - the test enforces exactly one of the two.
    "demo_per_lf": Rate(
        value=SCOPE_ITEMS["demo_per_lf"],
        unit=Unit.LF,
        basis=Basis.LABOR_ONLY,
        source="Xactimate tear-out cabinetry, disposal billed separately",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset(),
        excludes=frozenset({Includes.DISPOSAL}),
        note="haul-off is the dumpster line; do not add it here",
    ),
    "dumpster_10yard": Rate(
        value=SCOPE_ITEMS["dumpster_10yard"],
        unit=Unit.EA,
        basis=Basis.SUPPLY_AND_INSTALL,
        source="DMV container rental, 1-week haul",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset({Includes.DISPOSAL}),
        note="this is where haul-off is billed",
    ),

    # ── The backsplash setting-material double count ──
    # BACKSPLASH_TYPES[...]["install_per_sf"] is a tile-setting labor
    # rate, which in the trade normally already carries thinset and
    # grout. The old $4.91/SF adder billed them again at roughly the
    # price of the tile itself. Kept as a small explicit adder with the
    # install rate declared as NOT including them, so exactly one line
    # carries the cost.
    "backsplash_misc_per_sf": Rate(
        value=SCOPE_ITEMS["backsplash_misc_per_sf"],
        unit=Unit.BACKSPLASH_SF,
        basis=Basis.SUPPLY_ONLY,
        source="thinset + grout consumables $1.00-$2.50/SF",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset({Includes.SETTING_MATERIALS}),
        note="the ONLY line carrying setting materials",
    ),

    # ── The countertop reset unit change ──
    # Was a flat per-job fee, which over-charged a galley and
    # under-charged a U-shape. Xactimate D&R is per LF.
    "countertop_reset_per_lf": Rate(
        value=SCOPE_ITEMS["countertop_reset_per_lf"],
        unit=Unit.LF,
        basis=Basis.LABOR_ONLY,
        source="Xactimate countertop D&R $18-$22/LF",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset(),
        excludes=frozenset({Includes.DISPOSAL}),
        note="reuses the existing top; replacement is a different scope",
    ),

    # ── Pass-through fees: never marked up, never taxed ──
    "permit_allowance": Rate(
        value=SCOPE_ITEMS["permit_allowance"],
        unit=Unit.LS,
        basis=Basis.PASS_THROUGH_FEE,
        source="fallback when the jurisdiction cannot be determined",
        source_date=_DECL_DATE,
        confidence="assumed",
        includes=frozenset({Includes.PERMIT}),
        note="real figure comes from permit_fee(); this is the fallback",
    ),
    "dc_dumpster_public_space_permit": Rate(
        value=SCOPE_ITEMS["dc_dumpster_public_space_permit"],
        unit=Unit.LS,
        basis=Basis.PASS_THROUGH_FEE,
        source="DCMR 5/24 Sec.225 public space occupancy, 2-week allowance",
        source_date=_DECL_DATE,
        confidence="derived",
        includes=frozenset({Includes.PERMIT}),
        note="DC only; MD/VA are separate regimes",
    ),
}


# Cabinet REFINISHING, the scope the old $7.08/SF paint rate actually
# belonged to. Quoted per LF of cabinet run, which is how the trade
# bids it - not per SF.
#
# NOT A FEATURE. There is no refinishing scope in the estimator and no
# plan to add one; nothing reads this value. It exists as the named
# counterexample to the wall-painting rate - the thing that makes
# "which surface does this SF measure?" a question with two concrete
# answers instead of one, and it is what
# test_wall_painting_and_cabinet_refinishing_are_different_scopes
# checks the painting rate against.
#
# So: do not wire it up just because it is here. If a refinishing scope
# is ever actually requested, price it from a real quote - the value
# below is an unverified trade-range midpoint (hence confidence
# "assumed") and was never meant to be billed.
CABINET_REFINISH_PER_LF = Rate(
    value=45.0,
    unit=Unit.CABINET_RUN_LF,
    basis=Basis.SUPPLY_AND_INSTALL,
    source="trade practice $25-$65/LF of cabinet run",
    source_date=_DECL_DATE,
    confidence="assumed",
    includes=frozenset({Includes.FINISH, Includes.SMALL_PARTS}),
    note="refinish existing boxes; NOT new cabinets, NOT wall paint",
)


# ══════════════════════════════════════════════════════════════════
# Company prices
# ══════════════════════════════════════════════════════════════════
# The tables listed in price_catalog.py are wrapped in place, so a company's
# own prices and an estimate's pinned price book answer for them while it is
# calculated (app/domains/unit_prices). Outside a calculation they read as
# the defaults above. The constants it lists (RANGE_END_PANEL_EACH, ...) are
# read through FLAT_PRICES["RANGE_END_PANEL_EACH"].
from app.domains.unit_prices.catalog import install as _install_price_tables  # noqa: E402

from .price_catalog import PRICE_TABLES as _PRICE_TABLES  # noqa: E402

_install_price_tables("cabinet", "Kitchen Cabinet", globals(), _PRICE_TABLES)
