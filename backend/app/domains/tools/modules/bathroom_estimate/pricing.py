"""
Bathroom Remodel Estimate pricing constants for DMV area.
All rates based on 2025-2026 web research:
- Fixr.com, Angi, HomeAdvisor, HomeGuide, HomeWyse, This Old House
- Boss Design Center (DC Metro specific)
- DMV Fix Remodeling (Columbia MD area)
- Modernize, InchCalculator, CountBricks

Rates are mid-range for the DMV region (DC/MD/VA).
Includes material + labor unless otherwise noted.

2026-08 price update (research: FloorDaily Ceramic Tile Report 2026,
CountBricks labor rates Feb 2026, Depo Homes "Bathroom Remodel Costs
Increase 15-20% in 2026", felixdeco tariff tracker):
- Import tariffs are pushing tile and vanity/cabinet costs up sharply
  (tile ceramic ~+15%, vanity tariff exposure ~20-28%) — categories most
  exposed to tariffs capped at the top of our 1-5% adjustment range.
  TARIFF BASIS CORRECTED 2026-09-18: the original note cited "Section
  301+122". IEEPA-based tariffs were struck down by the Supreme Court in
  Feb 2026, so that basis is partly void. Still in force: Section 232
  (vanity/kitchen cabinets 25%, effective 2025-10-14; a 50% increase is
  deferred to at least 2027) and Section 301 (Chinese furniture +25%,
  unaffected by the ruling). Ceramic tile: India countervailing 3.0-3.5%,
  China anti-dumping 104-400%.
- Skilled trade labor (plumber/electrician) up ~8-10% YoY on tight
  labor supply — plumbing/electrical nudged up accordingly.
- Fixtures (toilets, sinks, tub/shower units) showed milder +2-3%
  supplier increases.
- Paint, trim, demo/disposal remained comparatively stable (+1-2%).
Applied per-category: tile/substrate/vanity +5%, plumbing/electrical
+3-4%, fixtures/tub/shower +2-3%, paint/trim/accessories/demo +1-2%,
rounded to natural price points.

2026-08-26 follow-up increase (user feedback: base prices still low vs.
market after the 2026-08-25 pass). Fresh research: HomeWyse May 2026 —
bathroom ceramic tile install $17.22-$21.37/SF all-in (already matched
by our porcelain floor combo ~$18.35/SF); DC toilet-install labor
benchmark $200-$300 (already matched/exceeded by our $365); bathroom
vanity install labor $576-$871 (our $499 was well below range).
Applied tiered: pure labor/install line items +15-20% (vanity install,
electrical fixture installs, bathtub/shower/sink/mirror install labor,
Detach & Reset costs), items already near market +5-8% (tile combo
rates, plumbing fixture-connection labor, demo, paint/trim, materials).
"""

# ──────────────────────────────────────────────
# Phase 1: Demo & Disposal
# ──────────────────────────────────────────────
# Sources: Angi avg $1,445, Modernize $8-$20/SF, This Old House $658-$2,469
DEMO_RATES = {
    # Per-SF demo rates (labor only — unskilled labor, straightforward removal)
    # 2026-08-26: +6-7% (Tier B — near-market category, follow-up pass)
    "floor_tile_per_sf": 3.25,        # tile removal + haul ($2-$4/SF avg)
    "wall_tile_per_sf": 4.05,         # wall tile removal ($3-$5/SF)
    "deck_tile_per_sf": 3.75,         # tub deck/rim tile removal — horizontal, easier access than
                                       # a wall, but bonded to a mortar bed/bullnose edge like a floor
    "ceiling_per_sf": 2.20,           # ceiling demo

    # Per-fixture demo (labor, disconnect + remove + haul)
    "bathtub_standard": 217,          # standard acrylic/fiberglass ($200-$500, HomeGuide 2026)
    "bathtub_cast_iron": 350,         # cast iron (heavy, needs crew)
    "shower_surround": 164,           # prefab surround removal
    "shower_custom_tile": 270,        # custom tile shower tear-out
    "vanity": 164,                    # vanity + top removal + haul ($150-$500, Angi 2026)
    "pedestal_sink": 60,              # pedestal sink disconnect + remove
    "wall_mount_sink": 55,            # wall-mount sink disconnect + remove
    "toilet": 65,                     # toilet disconnect + remove
    "mirror": 39,                     # mirror removal

    # Substrate demo
    "durock_per_sf": 2.20,            # cement board tear-out
    "drywall_per_sf": 1.95,           # drywall tear-out
    "subfloor_per_sf": 4.35,          # subfloor removal/repair

    # Dumpster (DMV area, Angi DC avg $442, range $370-$900)
    "dumpster_10yard": 420,
    "dumpster_15yard": 505,
    "dumpster_20yard": 590,
    "dump_tip_fee": 80,               # tip/disposal fee
    "debris_bag": 27.00,               # per bag: heavy-duty bag + haul-away labor
}

# ──────────────────────────────────────────────
# Phase 2: Plumbing Rough
# ──────────────────────────────────────────────
# Sources: Angi rough-in avg $6,500 (full new), Fixr $75-$150/hr plumber
# For like-for-like replacement, much less than full rough-in
PLUMBING_RATES = {
    # Per-unit costs (material + labor)
    # 2026-08-26: +5-7% (Tier B — fixture-connection labor already at/above
    # DC toilet-install benchmark $200-$300; nudged up modestly, not 15-20%)
    "shutoff_valve_each": 204,        # quarter-turn ball valve replacement ($150-$335, HomeWyse 2026)
    "supply_line_each": 72,           # braided stainless flex line
    "p_trap_each": 193,               # P-trap replacement ($200-$325, HomeAdvisor 2026; on-site discount)
    "drain_modification": 386,        # drain line modification
    "pressure_balance_valve": 466,    # code-required shower valve ($300-$550)
    "rough_inspection_fee": 163,      # county inspection fee

    # Fixture connection labor (licensed plumber, per fixture)
    "toilet_set": 387,                # toilet install (set, wax ring, bolt, connect, test; already at/above $200-$300 DC labor benchmark)
    "vanity_faucet_install": 249,     # faucet install ($200-$250; simplest plumbing task)
    "tub_faucet_install": 440,        # tub faucet/valve install (access panel, connect, test)
    "shower_valve_trim": 358,         # shower trim kit install (existing valve)
}

# ──────────────────────────────────────────────
# Phase 3: Electrical
# ──────────────────────────────────────────────
# Sources: Angi GFCI $130-$300 avg $210, Exhaust fan $250-$950
# Layout changes: what an option's sketch moves, adds or takes out compared
# with the bathroom as it is (layout_changes.py). Wood-framed floors and
# non-load-bearing walls; a slab or a bearing wall costs more and is flagged.
# Researched 2026-10-26, national figures before the zip labor multiplier:
LAYOUT_CHANGE_RATES = {
    # Toilet drain, vent tie-in and flange moved, supply extended: a 6"-5' move
    # runs $860-$3,190, typically $1,000-$1,800 (HomeWyse; 2026 cost guides)
    "toilet_relocation": 1100,
    # Per sink: supply pair and drain moved along the same wall, $500-$1,200
    # (Block Renovation); the move alone $240-$600 per Fixr
    "sink_relocation": 650,
    # A sink added where there was none: new supply pair, drain and vent tie-in
    "sink_new_rough_in": 850,
    # Shower or tub drain ($300-$1,000 on wood) plus valve and supply ($700-$1,200)
    "shower_relocation": 1400,
    "tub_relocation": 1400,
    # Only the drain, or only the valve, moved where the tub or shower stays (a
    # tub's drain end swapped, a valve put on another wall): the two halves of
    # the relocation above, so both together cost what moving the fixture does
    "drain_relocation": 600,
    "valve_relocation": 800,
    # Tub out, shower in at the same spot: drain rework and the valve swap
    "tub_to_shower": 1250,
    # Shower out, tub in: tub drain with overflow, spout supply
    "shower_to_tub": 1350,
    # A fixture where there was none
    "toilet_new_rough_in": 1300,
    "shower_new_rough_in": 1600,
    "tub_new_rough_in": 1500,
    # Supply capped and drain plugged where a fixture is taken out
    "cap_abandoned": 225,
    # New 2x4 partition, drywall both sides taped and finished (paint is priced with the walls)
    "partition_wall_per_lf": 90,
    # Non-load-bearing partition taken out, floor/ceiling/abutting walls patched
    "wall_removal_per_lf": 45,
    # Doors: moving one $600-$2,000+ (HomeAdvisor); cutting a new opening $250-$400 plus trim and patch
    "door_relocation": 1200,
    "door_new_opening": 650,
    "door_infill": 550,
    # Ceiling light box moved nearby $150-$250; a new box with its wiring run
    "light_relocation": 225,
    "light_new_box": 180,
}

ELECTRICAL_RATES = {
    # 2026-08-26 follow-up: install-LABOR items (Tier A +16-18%, structurally
    # same underpriced gap as vanity install labor); fixture/material items
    # (gfci/exhaust fan/heated floor mat/inspection) stay Tier B +5-6%
    # 1st outlet ~$210 incl. service call; add'l same visit ~$100
    "gfci_outlet_each": 181,          # blended avg (1-3 outlets per bath) — Tier B
    "vanity_light_install": 227,      # light fixture install (labor) — Tier A
    "ceiling_fixture_install": 236,   # standard ceiling light install — Tier A
    "recessed_light_install": 275,    # recessed can light (cut hole + housing + trim + wire) — Tier A
    "recessed_light_multi": 214,      # per-can when installing multiple (reduced per-unit) — Tier A
    "exhaust_fan": {                  # fan + install by CFM ($250-$950, Angi/HomeGuide) — Tier B
        50: 357,
        80: 466,
        110: 599,
        150: 756,
    },
    "exhaust_fan_switch": {           # switch upgrade — Tier B
        "standard": 39,
        "timer": 83,
        "humidity": 138,
    },
    "heated_floor_per_sf": 13.25,     # mat + install ($8-$15/SF, Greenwave 2025) — Tier B
    "heated_floor_thermostat": 211,   # programmable thermostat — Tier A (install labor)
    "heated_floor_circuit": 421,      # dedicated 20A circuit — Tier A (install labor)
    "electrical_inspection_fee": 137, # county inspection — Tier B
    "megohmmeter_check": 163,         # insulation resistance test on circuits — Tier B
}

# ──────────────────────────────────────────────
# Phase 4: Substrate (Durock / Waterproofing)
# ──────────────────────────────────────────────
# Sources: CountBricks $4-$6/SF labor, PRG Contractors, TillerStead
SUBSTRATE_RATES = {
    # 2026-08-26: +6-7% (Tier B, follow-up pass)
    "durock_per_sf": 7.20,            # 1/2" cement board material + install ($5-$8/SF)
    "durock_floor_per_sf": 6.15,      # 1/4" cement board for floor
    "greenboard_per_sf": 5.00,        # moisture-resistant drywall
    "mold_resistant_drywall_per_sf": 5.85,  # mold-resistant ceiling drywall

    # Waterproofing membrane
    "paint_on_per_sf": 2.50,          # paint-on membrane: RedGard, HydroBan ($1-$3/SF)
    # Sheet membrane: Schluter Kerdi — material ~$2.25/SF + thinset + labor → $7-$12/SF
    "sheet_per_sf": 10.00,

    # Subfloor repair
    "subfloor_repair_per_sf": 9.45,   # plywood + install ($6-$12/SF)
    "self_leveling_per_sf": 5.30,     # self-leveling compound + pour ($3-$7/SF, Angi 2026)

    # Drywall repair (full replacement: hang + tape + mud + sand + prime)
    "drywall_replace_per_sf": 6.40,   # standard 1/2" drywall ($4-$7/SF installed)
    "drywall_replace_moisture_per_sf": 7.20,  # greenboard/moisture-resistant ($5-$8/SF)

    # Insulation (demo + install)
    "insulation_demo_per_sf": 1.65,             # tear-out existing insulation ($1-$2/SF)
    "insulation_fiberglass_batt_per_sf": 2.75,  # R-13 fiberglass batt supply + install ($1.50-$3.50/SF)
    "insulation_blown_in_per_sf": 3.35,         # blown-in cellulose/fiberglass ($2-$4/SF)
    "insulation_spray_foam_per_sf": 6.10,       # closed-cell spray foam ($4-$7/SF)
    "insulation_rigid_board_per_sf": 4.45,      # rigid foam board supply + install ($3-$5/SF)
}

# ──────────────────────────────────────────────
# Phase 5: Tile & Flooring
# ──────────────────────────────────────────────
# Sources: HomeWyse $17-$21/SF installed, Angi $10-$50/SF, RUBI $12-$35/SF
TILE_MATERIAL_RATES = {
    # Material cost per SF
    # 2026-08-26: +5-6% (Tier B — combo already near HomeWyse May 2026
    # ceramic tile install benchmark $17.22-$21.37/SF all-in; modest nudge only)
    "ceramic": 4.45,                  # $2-$5/SF (Angi, HomeAdvisor)
    "porcelain": 8.25,                # $4-$10/SF (Angi)
    "natural_stone": 19.85,           # $10-$30/SF
    "glass_mosaic": 24.25,            # $16-$30/SF
    "lvt_spc": 5.00,                  # $3-$7/SF LVT/SPC plank
}

TILE_LABOR_RATES = {
    # Labor per SF by application.
    # SUPPLY-INCLUSIVE (§5-5): thinset, grout and setting supplies are part of
    # the installer's rate — do NOT add a separate supplies line on top.
    # Verification: porcelain floor = material 8.25 + labor 11.00 = $19.25/SF,
    # inside the $17.22-$21.37/SF HomeWyse May 2026 benchmark range.
    "floor_per_sf": 11.00,            # $8-$14/SF (Fixr tile installer)
    "wall_per_sf": 13.25,             # $10-$15/SF (vertical work premium)
    "shower_wall_per_sf": 14.50,      # $10-$15/SF (wet area, precision)
    # slope + drain cuts + mosaic → more labor than shower wall
    "shower_floor_per_sf": 19.85,     # $16-$22/SF
}

# Labor complexity by lay pattern (LABOR portion only — see §0-3).
# Combined with TILE_SIZE_MULTIPLIER via get_tile_complexity_multiplier(),
# NOT by plain multiplication.
TILE_PATTERN_MULTIPLIER = {
    "straight": 1.00,
    "diagonal": 1.15,        # trade norm +10-20%
    "herringbone": 1.40,     # Tile Club +30-60%
    "versailles": 1.50,
    "chevron": 1.55,         # Tile Club +40-80%, mitred cuts
}

# Tile size labor multiplier
# Standard (12x12, 12x24) = 1.0 baseline
# Mosaic = more cuts, more grout lines → +30-40% labor
# Large format = leveling systems, 2-person handling → +20-30% labor
# Sources: HomeGuide 2026, Apollo Tile, Fixr
TILE_SIZE_MULTIPLIER = {
    "1x1_mosaic": 1.40,       # mosaic sheets, $12-14/SF labor
    "2x2_mosaic": 1.35,       # mosaic sheets
    "4x4": 1.15,              # small format, more grout lines
    "6x6": 1.10,              # small format
    "12x12": 1.00,            # standard baseline
    "12x24": 1.00,            # standard, most common
    "6x24": 1.05,             # plank style, slightly more cuts
    "24x24": 1.15,            # large, needs leveling system
    "24x48": 1.30,            # large format, 2-person install
    "4x12_subway": 1.05,      # subway tile, many joints
    "3x6_subway": 1.10,       # classic subway, more joints
}

TILE_SIZES = list(TILE_SIZE_MULTIPLIER.keys())

# Cap on the combined pattern × size complexity multiplier.
TILE_COMPLEXITY_CAP = 1.75

# Waste factor by pattern (MATERIAL portion only — labor is billed on the
# finished surface area, so waste must never touch the labor side).
# Diagonal/herringbone/chevron produce far more offcuts than a straight lay,
# and mosaic sheets waste the most.
TILE_WASTE_BY_PATTERN = {
    "straight": 0.10,
    "diagonal": 0.15,
    "brick": 0.15,
    "herringbone": 0.18,
    "versailles": 0.18,
    "chevron": 0.18,
}
# Large-format and mosaic sizes override the pattern-based waste when higher.
TILE_WASTE_BY_SIZE = {
    "1x1_mosaic": 0.20,
    "2x2_mosaic": 0.20,
    "24x48": 0.15,
}
DEFAULT_TILE_WASTE = 0.10

TILE_EXTRAS = {
    "waste_factor": 0.10,             # legacy default — see get_tile_waste()
    "sealer_per_sf": 0.85,            # sealant for natural stone
    # REMOVED (§5-5):
    # - "grout_per_sf" / "thinset_per_sf": setting supplies are part of the
    #   tile installer's rate, not a separate charge. Billing them on top of
    #   TILE_LABOR_RATES double-counted ~$2.37/SF and pushed porcelain floor
    #   to $21.62/SF, above the HomeWyse $17.22-$21.37 benchmark. The v2
    #   verification (material 8.25 + labor 11.00 = $19.25/SF) treats the
    #   labor rate as supply-inclusive.
    # - "tile_demo_per_sf": duplicated DEMO_RATES["floor_tile_per_sf"] /
    #   ["wall_tile_per_sf"] (§1-1 owns all tile removal).
}

# ──────────────────────────────────────────────
# Phase 6: Fixtures
# ──────────────────────────────────────────────
# Sources: Angi, HomeGuide, Fixr, Boss Design Center DC

# Bathtub (material only, install separate under plumbing)
# 2026-08-26: +6-7% (Tier B — material, follow-up pass)
BATHTUB_PRICES = {
    "alcove": {
        "acrylic": 488,               # most common, $300-$600
        "porcelain_steel": 380,       # cheap but chips, $200-$500
        "cast_iron": 1028,            # heavy, premium, $700-$1,200
        "fiberglass": 356,            # budget, $200-$450
    },
    "drop_in": {
        "acrylic": 705,
        "porcelain_steel": 597,
        "cast_iron": 1300,
        "fiberglass": 547,
    },
    "freestanding": {
        "acrylic": 1300,              # $800-$2,000
        "cast_iron": 2710,            # $1,500-$4,000
        "fiberglass": 875,
    },
    "walk_in": {
        "acrylic": 3785,              # ADA/senior, $2,500-$5,000+
    },
}

# 2026-08-26: +16-18% (Tier A — pure install labor, structurally underpriced
# like vanity install; HomeWyse May 2026 vanity-install benchmark $576-$871
# exposed the same gap likely applies to other install-labor line items)
BATHTUB_INSTALL = {
    "alcove": 807,                    # standard install (set, level, seal, connect; $500-$1,500 HomeGuide 2026)
    "drop_in": 1135,                  # deck mount, more plumber time + framing
    "freestanding": 1328,             # floor mount, filler, drain alignment
    "walk_in": 1988,                  # complex install + electrical + ADA compliance
}

BATHTUB_EXTRAS = {
    # 2026-08-26: whirlpool/air-jet upgrade + surround tile labor = Tier B
    # (+5-6%, material/tile-adjacent); D&R-style install-labor items below
    # = Tier A (+16-18%, same underpriced-install-labor gap as vanity)
    "whirlpool_upgrade": 869,         # jets + pump + dedicated circuit
    "air_jet_upgrade": 652,
    "surround_tile_labor_per_sf": 14.35,  # surround tile install ($10-$16/SF) — tile labor category
    # Drain/overflow assembly — new tub needs new drain kit
    # Includes: drain body, overflow plate, linkage, gaskets, plumber's putty
    # Sources: Angi 2025-2026, HomeWyse ($80-$200 installed)
    "drain_overflow_kit": 161,        # drain + overflow assembly supply + install
    # Mortar bed / setting material — level base for tub
    # Acrylic/fiberglass tubs REQUIRE full support underneath (flex = crack)
    # Sources: Angi 2025, TerryLove forum, HomeGuide ($50-$150)
    "mortar_bed": 115,                # mortar mix + pour + level ($75-$125)
    # Tub/shower valve replacement (when tub has surround tile / combo unit)
    # Valve body + trim kit, Moen/Delta mid-grade ($250-$450 parts + $150-$250 labor)
    "shower_valve_body_trim": 568,    # pressure-balance valve body + trim kit installed
    "shower_valve_trim_only": 271,    # trim kit only (retain existing valve body)
    "showerhead_install": 104,        # shower head + arm install labor
    "curtain_rod": 79,                # curtain rod + rings + mount (supply + install)
}

# Shower door / enclosure
# Material price by type × opening width (inches)
# Sources: Angi 2026, HomeGuide 2026, ThisOldHouse 2026
# 2026-08-26 2nd follow-up (user feedback: door pricing still low even after
# the +5-6% Tier B bump). Fresh research: framed $400-900 installed, semi-
# frameless $500-1550, frameless $600-1900 (or $1000-2500/$1000-3000+ per
# other sources) — "frameless runs 40-60% above framed" is the market norm,
# but our combined (material+install) framed-vs-frameless gap had already
# grown wider than that, so weighted the increase toward framed/semi-
# frameless (still below top of their ranges) and kept frameless's bump
# smaller (already relatively ahead) to avoid stretching the ratio further:
# framed +12%, semi-frameless +10%, frameless +8%, fixed_panel +10%.
SHOWER_DOOR_PRICES = {
    # Curtain - flat rate
    "curtain": {"any": 49},
    # Framed sliding/bypass - budget ($400-$900 installed)
    "framed_sliding": {
        48: 342, 60: 428, 72: 514,
    },
    # Semi-frameless sliding ($700-$1,500 installed)
    "semi_frameless_sliding": {
        48: 541, 60: 655, 72: 774,
    },
    # Frameless sliding ($1,000-$2,500 installed, Angi 2026)
    "frameless_sliding": {
        48: 1051, 60: 1227, 72: 1460,
    },
    # Framed pivot ($400-$1,100 installed)
    "framed_pivot": {
        28: 307, 32: 367, 36: 429,
    },
    # Semi-frameless pivot
    "semi_frameless_pivot": {
        28: 481, 32: 570, 36: 655,
    },
    # Frameless pivot ($1,000-$3,500 installed, Angi 2026)
    "frameless_pivot": {
        28: 1051, 32: 1285, 36: 1578,
    },
    # Fixed panel / half wall glass
    "fixed_panel": {
        24: 481, 30: 655, 36: 833,
    },
}

# Installation labor by door category (precision leveling, drilling, sealing)
# 2026-08-26: +16-18% (Tier A — pure install labor, same underpriced gap as
# vanity install; curtain install stays $0, no labor line for a curtain rod hang)
SHOWER_DOOR_INSTALL = {
    "curtain": 0,
    "framed_sliding": 331,
    "semi_frameless_sliding": 452,
    "frameless_sliding": 577,
    "framed_pivot": 331,
    "semi_frameless_pivot": 452,
    "frameless_pivot": 577,
    "fixed_panel": 419,
}

SHOWER_DOOR_TYPES = [
    "curtain",
    "framed_sliding", "semi_frameless_sliding",
    "frameless_sliding",
    "framed_pivot", "semi_frameless_pivot",
    "frameless_pivot",
    "fixed_panel",
    "framed_neo_angle", "semi_frameless_neo_angle",
    "frameless_neo_angle",
]

# REMOVED (§7-3): SHOWER_ENCLOSURE_PRICES was a legacy second price list for
# the same selections SHOWER_DOOR_PRICES covers, with stale values (frameless
# $1,928 vs the door table's $985 material), so an estimate priced differently
# depending on which field the caller happened to set. The legacy `enclosure`
# field is now mapped onto door_type via _LEGACY_ENCLOSURE_MAP in
# calculator.py, leaving a single canonical door pricing path.

SHOWER_INSERT_PRICES = {
    # Prefab shower units (material only), Tier B +5-6%
    "one_piece": 707,                 # fiberglass one-piece ($400-$1,000)
    "multi_piece_kit": 1026,          # multi-piece kit ($600-$1,500)
}

# prefab shower unit install (set, level, seal, connect)
# 2026-08-26: +17% (Tier A — pure install labor)
SHOWER_INSERT_INSTALL = 690

# Neo-angle (corner) shower components
# Sources: Home Depot, Lowe's, Amazon 2025-2026
# Neo-angle base pan: acrylic/fiberglass, center drain
NEO_ANGLE_BASE_PRICES = {
    # By size (inches), material only. 2026-08-26: +5-6% (Tier B)
    32: 196,   # 32x32 ($150-$230)
    36: 241,   # 36x36 ($170-$280)
    38: 383,   # 38x38 ($270-$490)
    42: 460,   # 42x42 ($350-$500)
    48: 595,   # 48x48 ($450-$650)
}

# pan install: set, level, seal, connect drain
# 2026-08-26: +17% (Tier A — pure install labor)
NEO_ANGLE_BASE_INSTALL = 572

# Neo-angle shower door (3-panel enclosure)
# door + 2 fixed side panels
# Higher than regular: precision angles, custom glass
# 2026-08-26 2nd follow-up: same +12%/+10%/+8% weighting as SHOWER_DOOR_PRICES
# (still low even after the earlier +5-6% Tier B pass)
NEO_ANGLE_DOOR_PRICES = {
    # Framed (most common, budget) — by size
    "framed_neo_angle": {
        32: 429, 36: 515, 38: 606,
        42: 727, 48: 909,
    },
    # Semi-frameless
    "semi_frameless_neo_angle": {
        32: 655, 36: 774, 38: 893,
        42: 1070, 48: 1309,
    },
    # Frameless ($1,200-$3,500+ installed, Angi 2026)
    "frameless_neo_angle": {
        32: 1227, 36: 1460, 38: 1695,
        42: 2044, 48: 2453,
    },
}

# 2026-08-26: +17-18% (Tier A — pure install labor)
NEO_ANGLE_DOOR_INSTALL = {
    "framed_neo_angle": 452,
    "semi_frameless_neo_angle": 572,
    "frameless_neo_angle": 699,
}

# Neo-angle prefab wall surround
# (acrylic/fiberglass, replaces tile)
# Sources: MAAX, American Standard, Aquatic 2025-2026
# 2026-08-26: +5-6% (Tier B — material)
NEO_ANGLE_WALL_SURROUND_PRICES = {
    # By base size (inches), material only
    "prefab_acrylic": {
        32: 274, 36: 352, 38: 437,
        42: 541, 48: 704,
    },
    "prefab_fiberglass": {
        32: 191, 36: 246, 38: 300,
        42: 383, 48: 487,
    },
    "solid_surface": {
        32: 649, 36: 812, 38: 973,
        42: 1190, 48: 1514,
    },
}

# surround panel install ($350-$500)
# 2026-08-26: +16% (Tier A — pure install labor)
NEO_ANGLE_WALL_SURROUND_INSTALL = 508

# Complete neo-angle kits (base + walls + door)
# Budget: MAAX Warren, Aqua Glass, American Std
# 2026-08-26: +5% (Tier B — material)
NEO_ANGLE_KIT_PRICES = {
    # base + wall surround + door (material only)
    "basic_fiberglass": {
        36: 812, 38: 973, 42: 1244,
    },
    "mid_acrylic": {
        36: 1298, 38: 1514, 42: 1947,
    },
}

# full kit install ($650-$850)
# 2026-08-26: +17% (Tier A — pure install labor)
NEO_ANGLE_KIT_INSTALL = 904

# tile-adjacent labor items, Tier B +5-6%
SHOWER_CUSTOM_EXTRAS = {
    "niche_each": 206,                # recessed niche (material + labor)
    "niche_waterproof_prefab": 285,   # Schluter/Kerdi one-piece preform niche
    "bench": 495,                     # tiled bench (material + labor)
    "curb": 250,                      # standard curb build

    # ── Curbless floor system (§9-1) ──
    # FLOOR SYSTEM WORK ONLY — the linear drain is billed separately below.
    # The earlier single 715 rate covered neither the subfloor recess nor the
    # extended waterproofing, and a later 3,150 figure double-counted the
    # drain. Both are corrected here.
    #   wood:  subfloor recess / joist notching 1,450 + extended
    #          waterproofing & full-floor slope 550
    #   slab:  concrete core cut + re-pour / floor build-up
    # Cross-checked: FinHome 2026 (linear drain +$400-900, extended
    # waterproofing +$300-800 -> floor work alone $800-1,800), Bay Area
    # retrofit subfloor framing $1,000-3,000, Tampa curbed-vs-curbless delta
    # +$2,000-8,000, contractor forums $1,000-7,000.
    "curbless_floor_wood": 2000,
    "curbless_floor_slab": 3000,

    # Linear drain assembly — ALWAYS a separate line from the floor system.
    "linear_drain_standard": 285,
    "linear_drain_premium": 585,      # premium / point-inset
}

# Shower head/valve — fixtures, Tier B +5-6%
SHOWERHEAD_PRICES = {
    "standard": 71,
    "rain": 189,
    "handheld": 104,
    "combo": 244,                     # rain + handheld
    "body_spray": 378,                # per set
}

# Tub faucet MATERIAL only; the labor is PLUMBING_RATES["tub_faucet_install"].
# A tub's faucet is always removed and replaced, never detached and reset.
# Mid-grade Moen/Delta allowances, 2026-11-05 retail: tub spout + handle trim
# on the wall valve ~$100-$200, deck-mount (Roman tub) faucet ~$200-$400,
# freestanding floor-mount tub filler ~$350-$900. Defaults, not company
# rates: adjust when real jobs show they're off.
TUB_FAUCET_PRICES = {
    "wall": 150,                      # spout + handle trim on the wall valve
    "deck": 280,                      # deck-mount faucet on the tub rim/deck
    "freestanding": 520,              # floor-mount tub filler
}

SHOWER_VALVE_PRICES = {
    "pressure_balance": 300,          # code-required basic
    "thermostatic": 594,              # premium
}

TRIM_GRADE_MULTIPLIER = {
    "builder": 0.80,
    "mid": 1.00,
    "premium": 1.45,
}

# Vanity
# 2026-08-26: +5-6% (Tier B — material; the Tier A gap found in research was
# specific to vanity INSTALL LABOR, not the vanity unit material cost itself)
VANITY_PRICES = {
    # By width (material only, mid-range stock)
    "stock_rta": {24: 390, 30: 468, 36: 551, 48: 772, 60: 1048, 72: 1323},
    "semi_custom": {24: 724, 30: 882, 36: 1048, 48: 1489, 60: 1985, 72: 2646},
    # truly custom (local shop/craftsman); DMV min ~$2,500 for 36"
    "custom": {
        24: 1820, 30: 2315, 36: 2756,
        48: 3969, 60: 5292, 72: 6836,
    },
}

VANITY_TOP_PRICES = {
    # Per linear inch of width, Tier B +5%
    "cultured_marble": 8.85,          # integrated bowl, cheapest
    "quartz": 15.45,                  # most popular (36"=$556)
    "granite": 14.35,                 # (36"=$517)
    "marble": 24.25,                  # premium, sealing required
    "laminate": 5.55,
}

# 2026-08-26: +18% (Tier A — HomeWyse May 2026 vanity-install benchmark
# $576-$871 (mid ~$724); our prior $499 was well below even the low end)
VANITY_INSTALL = 589                  # labor to install vanity (set, level, secure, cutouts; $576-$871 HomeWyse 2026)

VANITY_EXTRAS = {
    # 2026-08-26: faucet/blocking install labor = Tier A +15-17% (same
    # underpriced-install-labor gap as vanity install); toe kick = Tier B
    # +6% (material, not labor)
    "wall_mount_blocking": 271,       # wood blocking for floating vanity (framing work)
    # REMOVED (§10-4): faucet_* were material+install BUNDLES that were then
    # charged alongside PLUMBING_RATES["vanity_faucet_install"], billing the
    # installation twice. Faucets now price through the single canonical path:
    # FAUCET_PRICES (material) + PLUMBING_RATES["vanity_faucet_install"].
    "toe_kick_per_lf": 13.35,         # toe kick board (supply + install, freestanding vanity)
}

# Faucet MATERIAL only — install labor is PLUMBING_RATES["vanity_faucet_install"]
# regardless of sink type (cabinet vanity, pedestal or wall-mount). §10-4
# consolidated three overlapping price paths into this one table.
FAUCET_PRICES = {
    "single_hole": 175,
    "centerset": 189,                 # 4" centerset
    "widespread": 268,
    "wall_mount": 395,                # + rough valve/access, see FAUCET_EXTRAS
}

# Wall-mount faucets need a rough valve + access panel beyond the standard
# fixture connection.
FAUCET_WALL_MOUNT_ROUGH = 235

# Pedestal Sink / Wall-Mount Sink (non-vanity options)
# 2026-08-26: material Tier B +5%
SINK_PRICES = {
    # Supply (fixture + faucet)
    "pedestal_sink": 378,             # pedestal sink unit ($250-$500)
    "wall_mount_sink": 324,           # wall-mount basin ($200-$450)
}
# 2026-08-26: +16-17% (Tier A — pure install labor)
SINK_INSTALL = {
    "pedestal_sink": 448,             # set pedestal, connect plumbing ($300-$450)
    "wall_mount_sink": 513,           # blocking + bracket + connect ($350-$500)
}
# REMOVED (§11-1): SINK_FAUCET / SINK_FAUCET_INSTALL were a third faucet price
# path that disagreed with both VANITY_EXTRAS["faucet_*"] and FAUCET_PRICES for
# the same fixture. Pedestal/wall-mount sinks now use the same canonical
# FAUCET_PRICES + PLUMBING_RATES["vanity_faucet_install"] as cabinet vanities.

# Mirror / Medicine Cabinet
# 2026-08-26: material Tier B +5-6%
MIRROR_PRICES = {
    "plain": 93,
    "framed": 189,
    "medicine_cabinet": 297,          # surface mount
    "medicine_cabinet_recessed": 405, # recessed (requires wall work)
    "led_backlit": 460,               # + electrical
}

# 2026-08-26: +17% (Tier A — pure install labor)
MIRROR_INSTALL = 151                  # labor to hang (anchoring, leveling)

# Wall cabinet (the one over the toilet; cabinets.py). A medicine cabinet is
# priced from MIRROR_PRICES + MIRROR_INSTALL like a mirror of that type.
# Researched 2026-11-05: over-toilet wood wall cabinets retail ~$100-$250;
# no reliable install figure, so its labor sits a little over hanging a
# mirror (anchored into studs, leveled). Defaults, not company rates: adjust
# when real jobs show they're off.
WALL_CABINET_PRICE = 185              # material allowance, ~24"W x 30"H wood cabinet
WALL_CABINET_INSTALL = 175            # anchor to studs, level, doors adjusted

# Toilet, Tier B +5% (fixture material — toilet SET labor is in PLUMBING_RATES)
TOILET_PRICES = {
    # Material only (install under plumbing)
    "two_piece_standard": 244,        # basic two-piece ($130-$250)
    "two_piece_comfort": 319,         # comfort height
    "one_piece_standard": 405,        # one-piece ($250-$450)
    "one_piece_comfort": 460,
    "bidet_seat": 378,                # bidet seat add-on (needs GFCI)
    "smart_toilet": 1298,             # integrated bidet ($800-$2,000)
}

TOILET_EXTRAS = {
    "wax_ring": 16.45,
    "flange_repair": 104,             # if slab condition requires
    "soft_close_seat": 49,            # if not included
}

# ──────────────────────────────────────────────
# Phase 7: Finish (Paint, Trim, Accessories)
# ──────────────────────────────────────────────
# Sources: Fixr painter $2-$7/SF, HomeGuide baseboard $1-$3.50/LF
# 2026-08-26: +6% (Tier B, follow-up pass)
PAINT_RATES = {
    "seal_prime_per_sf": 1.65,        # seal & prime repaired drywall only
    "wall_per_sf": 4.90,              # paint walls (prep + 2 coats; $4-$9/SF HomeWyse 2026)
    "ceiling_per_sf": 5.15,           # ceiling paint (overhead premium)
    "trim_per_lf": 4.10,              # baseboard/trim paint ($2.30-$4.88/LF)
}

PAINT_PREP = {
    # 2026-08-26: +7-8% (Tier B)
    "masking_per_sf": 0.80,               # tape, plastic sheeting on fixtures/trim ($0.50-$1.00/SF)
    "floor_protection_per_sf": 0.55,      # drop cloth / ram board for paint work ($0.35-$0.65/SF)
}

PAINT_GRADE_MULTIPLIER = {
    "builder": 0.85,
    "mid": 1.00,
    "premium": 1.30,                  # Sherwin Cashmere, BM Aura
}

# Bathroom walls and ceilings always take moisture-resistant (mildew-resistant
# bath) paint: this premium goes on top of the chosen grade
MOISTURE_RESISTANT_PAINT_MULT = 1.20

# 2026-08-26: +6% (Tier B)
BASEBOARD_PRICES = {
    # Material + install per LF
    "pvc": 7.00,                      # PVC (recommended for bath)
    "mdf": 5.45,
    "wood": 9.15,
    # "tile" REMOVED (§12-2): tile base is priced per tile material via
    # TILE_BASEBOARD_PRICES; keeping a flat 13.00 here was a second rate for
    # the same item that disagreed with the porcelain rate (13.25).
}

# Tile baseboard pricing by tile material (material + labor per LF)
# Sources: HomeAdvisor 2025, Angi 2026, FlooringClarity
# 2026-08-26: +5% (Tier B — tile category, already near market)
TILE_BASEBOARD_PRICES = {
    "ceramic": 9.95,                  # $8-$12/LF installed
    "porcelain": 13.25,               # $10-$15/LF installed
    "natural_stone": 19.85,           # $15-$25/LF installed
    "glass_mosaic": 22.00,            # $16-$25/LF installed
}

# Quarter round molding pricing (material + labor per LF)
# Add-on to standard baseboard install; matches baseboard material
# Sources: Angi 2026 ($3-$7/LF installed), HomeGuide 2026, CountBricks 2026
# DMV mid-range: thin pin-nailer install, slightly faster than baseboard
# 2026-08-26: +6-7% (Tier B)
QUARTER_ROUND_PRICES = {
    "pvc": 4.05,                      # PVC quarter round (moisture-resistant, bath)
    "mdf": 3.55,                      # MDF quarter round (budget, paintable)
    "wood": 4.90,                     # Paint-grade pine quarter round
}

# Accessories (material + install per piece)
# Sources: HomeWyse towel bar $61-$134, grab bar $100-$350
# 2026-08-26: +6-8% (Tier B)
ACCESSORY_PRICES = {
    "towel_bar": 104,                 # supply + install ($61-$134)
    "hand_towel_ring": 81,
    "tp_holder": 60,
    "robe_hook": 55,
    "corner_shelf": 71,
    "grab_bar": 243,                  # + blocking ($100-$350, HomeGuide)
    "toilet_brush_holder": 50,
    "soap_dispenser": 71,
}

ACCESSORY_FINISH_MULTIPLIER = {
    "chrome": 1.00,
    "brushed_nickel": 1.10,
    "matte_black": 1.15,
    "brass": 1.25,
    "mixed": 1.10,
}

ACCESSORY_GRADE_MULTIPLIER = {
    "builder": 0.75,
    "mid": 1.00,
    "premium": 1.50,
}

# ──────────────────────────────────────────────
# Detach & Reset (D&R) - Labor Only
# ──────────────────────────────────────────────
# For water mitigation / restoration work: fixture is carefully removed,
# stored, then reinstalled after wall/floor work is completed.
# All costs are LABOR ONLY (no new material).
#
# ⚠ SOURCE CORRECTED 2026-09-18: these are NOT Xactimate D&R codes, despite
# the earlier attribution. Actual Xactimate lines are far lower (toilet detach
# $86.53, base cabinet detach $54.23, vanity tear-out $16.05/LF) — this table
# runs roughly 2.5-4x those. These are RETAIL GC rates.
# Do NOT submit these figures on an insurance claim as if they were Xactimate
# pricing; they will be adjusted down. For insurance work, apply a ~0.40
# factor (see DR_MODE / XACTIMATE_MODE in the v2 reference, not yet built).
# Sources: Angi, CountBricks, HomeWyse 2025-2026 (retail GC market rates)
# 2026-08-26: +16-18% (Tier A — this is 100% install/removal labor, same
# underpriced-install-labor gap the vanity-install research exposed)
DETACH_RESET_COSTS = {
    # Toilet: disconnect water, remove wax ring, store, reinstall w/ new wax ring
    "toilet": 225,                    # ~1.5 hrs plumber ($125-$250)
    # Vanity + sink: disconnect plumbing, remove, store, reinstall & reconnect
    # Larger vanities need 2-person crew, more time, bigger storage footprint
    # Sources: Xactimate D&R, Angi 2025-2026, HomeGuide
    "vanity": {
        24: 241,                      # small single vanity, ~1.5 hrs ($150-$250)
        30: 274,                      # standard single, ~1.75 hrs ($175-$275)
        36: 335,                      # standard single, ~2.5 hrs ($200-$350)
        48: 422,                      # large single, ~3 hrs, may need 2 ppl ($275-$425)
        60: 517,                      # double vanity, 2-person crew, ~3.5 hrs ($350-$500)
        72: 614,                      # large double, 2-person crew, ~4 hrs ($400-$600)
    },
    # Bathtub: disconnect plumbing, remove, store, reinstall
    "bathtub_standard": 548,          # ~4 hrs ($350-$550)
    "bathtub_cast_iron": 791,         # ~6 hrs, heavy ($500-$800)
    # Shower door/enclosure: careful glass removal, store, reinstall
    "shower_door": 335,               # ~2.5 hrs ($200-$350)
    # Shower surround (prefab): remove panels, store, reinstall
    "shower_surround": 422,           # ~3 hrs ($275-$425)
    # Mirror: careful removal, store, reinstall. Per mirror by its width
    # (inches): the smallest size at or over it, past 72" per inch more
    # (mirrors.price_by_width). A mirror of unknown width is priced as 36".
    # 2026-11-06: was $116 any size. Set against carrier Xactimate lines in
    # the AccuLynx archive: mirror D&R $7.56/SF (VAAR 2025) to $11.63/SF
    # (MDRO 2026) with a $105-$120 mirror labor minimum; at ~36" tall that
    # is ~$105 for 36" wide, ~$140 for 48", ~$175 for 60", ~$245 for 72"x42".
    # Defaults, not company rates: adjust when real jobs show they're off.
    "mirror": {
        24: 95,                       # small, one person, ~0.5 hr
        36: 116,                      # standard, ~0.75 hr
        48: 145,                      # ~1 hr
        60: 185,                      # two people to lift and hang level
        72: 230,                      # wide plate mirror, two people
    },
    # Vanity light: disconnect, remove, store, reinstall
    "vanity_light": 104,              # ~0.5-0.75 hrs ($65-$110)
    # Cabinets on the wall: empty, unscrew from the studs, store, rehang level.
    # Researched 2026-11-05 (surface medicine cabinet 1-2 hrs to install,
    # recessed 3-5 hrs, CountBricks/HomeWyse 2026); D&R taken as a fraction
    # of that. Defaults, not company rates: adjust when real jobs show they're off.
    "medicine_cabinet": 135,          # ~1 hr
    "medicine_cabinet_recessed": 165, # ~1.25 hrs: screws inside the box, re-caulk the flange
    "wall_cabinet": 150,              # ~1-1.25 hrs, two hands to rehang
    # Accessories (towel bars, tp holders, etc.): remove all, store, reinstall
    # Per-piece: unscrew/pull anchors, label, bag, reinstall w/ new anchors
    # Sources: Xactimate D&R, Angi 2025-2026
    "accessory_per_piece": 42,       # ~15-20 min each ($25-$45)
}

# ──────────────────────────────────────────────
# Hidden / Commonly Missed Costs
# ──────────────────────────────────────────────
# 2026-08-26: +5-6% (Tier B, follow-up pass)
HIDDEN_COSTS = {
    "floor_protection": 136,          # Ram board, plastic, tape
    "mobilization": 190,              # tool/equipment transport
    "final_clean": 244,               # move-in ready cleaning
    # ⚠ MODELED ALLOWANCE — NOT a researched market rate.
    # This is the one figure in this file with no published benchmark. The
    # industry treats punch list as a *process*, not a priced visit: trade
    # sources quote rework as a share of project value (4-10%), never a
    # per-visit rate. The only adjacent published number is a home-warranty
    # service-call fee ($75-$125), which is a different line of business.
    # $216 is back-solved from ~2-3h x $75-100/h + travel. Treat it as a
    # placeholder and replace it with the shop's own callback history
    # (visit count x average duration) as soon as that data exists.
    # See PUNCH_LIST_BASIS below for the derivation shown to the user.
    "punch_list": 216,
    "caulk_day": 298,                 # silicone/latex caulking (1 day labor)
    "drywall_patch_per_sf": 6.10,     # patching around tile edges
    "drywall_skim_coat_per_sf": 4.70, # skim coat after tile removal ($3-$6/SF)
    "trim_paint_per_lf": 4.90,        # post-install trim paint
    "lead_rrp": 402,                  # EPA RRP surcharge (pre-1978)
    "cast_iron_disposal": 190,        # weight surcharge for CI tub
    "permit_fee": 268,                # building permit (varies by county, $150-$400)
}

# Punch list derivation — exposed so the assumption is visible and tunable
# instead of hiding behind a single rounded number. HIDDEN_COSTS["punch_list"]
# should equal round(VISITS x HOURS x RATE + TRAVEL).
# There is no market rate to validate this against (see the warning above);
# it is an internal labor-time model only.
# NOTE: the legacy $216 was a round number, not the output of any model — no
# 2-visit combination reproduces it, so the old "1-2 follow-up visits" label
# was wrong as well. These parameters are fitted to hold the existing price
# steady (1 x 2.75h x $75 + $10 travel = $216.25 -> $216) while making the
# assumption inspectable. Adjust visits/hours here, not the raw dollar figure.
PUNCH_LIST_BASIS = {
    "visits": 1,          # one return trip after substantial completion
    "hours_per_visit": 2.75,
    "hourly_rate": 75,    # finish-carpenter/handyman blended rate
    "travel_per_visit": 10,
}


def get_punch_list_cost() -> float:
    """Modeled punch-list allowance (no published market rate exists)."""
    b = PUNCH_LIST_BASIS
    labor = b["visits"] * b["hours_per_visit"] * b["hourly_rate"]
    travel = b["visits"] * b["travel_per_visit"]
    return float(round(labor + travel))


def get_punch_list_note() -> str:
    """User-facing explanation of how the punch-list figure was derived."""
    b = PUNCH_LIST_BASIS
    visit_word = "visit" if b["visits"] == 1 else "visits"
    return (
        f"Final adjustments, minor touch-ups, hardware tightening. "
        f"Allowance based on estimated labor time "
        f"({b['visits']} follow-up {visit_word} x "
        f"{b['hours_per_visit']:g}h @ ${b['hourly_rate']}/h + "
        f"${b['travel_per_visit']} travel), not a published rate."
    )


# ──────────────────────────────────────────────
# Shower Pan / Pre-slope (custom tile showers)
# ──────────────────────────────────────────────
# Sources: HomeGuide 2025, Angi 2026, Fixr
# 2026-08-26: +6% (Tier B — tile/waterproofing category, already near market)
SHOWER_PAN_COSTS = {
    "mortar_preslope_per_sf": 9.45,   # mud bed pre-slope ($6-$12/SF)
    "pan_liner": 206,                 # PVC liner + drain assembly
    "curb_waterproof": 83.25,         # curb membrane wrap
}

# ──────────────────────────────────────────────
# Regional: Zip-based labor multipliers
# ──────────────────────────────────────────────
# Base pricing is calibrated to national mid-range.
# Multipliers adjust for regional labor cost differences.
ZIP3_LABOR_MULTIPLIERS = {
    # DC Metro (DMV)
    "200": 1.05,
    "202": 1.00,
    # Maryland
    "206": 1.00,
    "207": 0.95,
    "208": 1.05,  # Montgomery County
    "209": 1.00,
    "210": 0.95,
    "211": 0.95,
    "212": 0.95,
    "216": 0.95,
    # Northern Virginia
    "220": 1.00,
    "221": 1.05,  # Fairfax, Arlington
    "222": 1.00,
    "223": 1.00,
    # Florida — Central/East Coast
    "320": 0.90,  # Jacksonville area
    "321": 0.88,  # Daytona Beach / New Smyrna Beach / Volusia County
    "322": 0.88,  # Gainesville area
    "323": 0.90,  # Tallahassee area
    "324": 0.88,  # Panama City area
    "325": 0.88,  # Pensacola area
    "326": 0.88,  # Ocala / Gainesville
    "327": 0.92,  # Orlando area
    "328": 0.92,  # Orlando metro
    "329": 0.90,  # Melbourne / Space Coast
    "330": 0.95,  # Miami
    "331": 0.95,  # Miami / Coral Gables
    "332": 0.95,  # Ft. Lauderdale
    "333": 0.95,  # Ft. Lauderdale / Hollywood
    "334": 0.92,  # West Palm Beach
    "335": 0.92,  # Tampa area
    "336": 0.92,  # Tampa / St. Petersburg
    "337": 0.90,  # St. Petersburg
    "338": 0.90,  # Lakeland
    "339": 0.92,  # Fort Myers
    "340": 0.90,  # Naples (seasonal premium)
    "341": 0.90,  # Naples / Marco Island
    "342": 0.88,  # Sarasota / Bradenton
    "344": 0.88,  # Sarasota
    "346": 0.92,  # Tampa metro
}

PREMIUM_ZIP_OVERRIDES = {
    # DMV premium zips
    "20815", "20816", "20817", "20854",  # Bethesda/Potomac
    "22101", "22102", "22066",           # McLean/Great Falls
    "20007", "20008", "20015",           # Georgetown/NW DC
    # Florida premium zips
    "33139", "33140", "33141",           # Miami Beach
    "34102", "34103", "34108",           # Naples
}

# ──────────────────────────────────────────────
# Material Tax Loading (internal cost loading — NEVER billed as a line)
# ──────────────────────────────────────────────
# In MD/VA/DC/FL the contractor is the final consumer on a lump-sum real
# property improvement contract: sales tax is paid at material purchase and
# absorbed into cost. It is never passed through to the homeowner as a tax
# line.  Refs: Va. Code §58.1-610(A) / 23VAC10-210-410 (+ Tax Commissioner
# Ruling 24-149), Fla. Admin. Code R. 12A-1.051 / DOR GT-800007,
# COMAR 03.06.01.19, DC capital-improvement exclusion.
#
# These rates therefore load the MATERIAL portion of each line item's cost
# (see MATERIAL_SHARE_BY_CATEGORY) and are invisible on the estimate.
MATERIAL_TAX_LOADING = {
    "MD": 0.06,
    "VA": 0.053,     # NOVA can be 0.06
    "DC": 0.06,      # 7.0% from 2026-10-01
    "FL": 0.06,      # FL base 6%, some counties add 0.5-1.5% discretionary
}

# Backwards-compatible alias (older imports)
SALES_TAX_RATES = MATERIAL_TAX_LOADING

# ──────────────────────────────────────────────
# Cost basis classes (§0-1-1) — what handling applies to
# ──────────────────────────────────────────────
# Rates in this file come from three different KINDS of source. Handling is
# decided by the SOURCE KIND, not by which section a rate happens to live in:
#
#   SKU  — retail listing price (Home Depot, DreamLine, Aquatic, Fab Glass…).
#          Over-the-counter, so it carries NO sourcing, pickup/delivery,
#          storage, staging or return/damage-risk allowance.
#          -> x MATERIAL_HANDLING, then x O&P  (total ≈ 1.39)
#   INST — installed benchmark (HomeWyse, Angi…). The installing trade's
#          burden and handling are already inside the number.
#          -> O&P only  (total ≈ 1.21)
#   PASS — pass-through (dumpster, permit, inspection). No markup at all.
#
# Sanity check: SKU material at 1.39 sits inside the 25-50% material markup
# range trade sources quote for residential remodeling; INST at 1.21 is the
# top of HomeWyse's own 13-22% GC markup guidance. Both are defensible.
#
# NOTE: an earlier revision listed the SKU scope as five section numbers
# ("§7 · §8 · §6-1 · §10-1 · §11-3"). That shorthand silently dropped §5-1
# tile material, §8-1 prefab shower units, §9-1/9-3/9-4 shower components,
# §10-4 faucets and §11-1/11-2 sink & mirror material. The authoritative
# scope is the source kind — see SKU_PRICED_TABLES below.
MATERIAL_HANDLING = 1.15

# Documentation of which tables are SKU-priced (handling applies) vs.
# installed-price (it must not). Kept as data so the scope is auditable.
SKU_PRICED_TABLES = frozenset({
    "TILE_MATERIAL_RATES",              # §5-1
    "BATHTUB_PRICES",                   # §6-1
    "SHOWER_DOOR_PRICES",               # §7-1 (except the curtain rod)
    "SHOWER_INSERT_PRICES",             # §8-1
    "NEO_ANGLE_BASE_PRICES",            # §8-2
    "NEO_ANGLE_DOOR_PRICES",            # §8-3
    "NEO_ANGLE_WALL_SURROUND_PRICES",   # §8-4
    "NEO_ANGLE_KIT_PRICES",             # §8-5
    "SHOWER_CUSTOM_EXTRAS.linear_drain",  # §9-1 drain material only
    "SHOWERHEAD_PRICES",                # §9-3
    "SHOWER_VALVE_PRICES",              # §9-4
    "TUB_FAUCET_PRICES",
    "VANITY_PRICES",                    # §10-1
    "FAUCET_PRICES",                    # §10-4
    "SINK_PRICES",                      # §11-1 material only (install = INST)
    "MIRROR_PRICES",                    # §11-2
    "TOILET_PRICES",                    # §11-3
})

# Installed-price tables — NEVER apply handling (it is already in the rate).
INSTALLED_PRICE_TABLES = frozenset({
    "PLUMBING_RATES", "ELECTRICAL_RATES", "SUBSTRATE_RATES",
    "TILE_LABOR_RATES", "BATHTUB_INSTALL", "BATHTUB_EXTRAS",
    "SHOWER_DOOR_INSTALL", "SHOWER_PAN_COSTS", "VANITY_TOP_PRICES",
    "VANITY_INSTALL", "VANITY_EXTRAS", "SINK_INSTALL", "MIRROR_INSTALL",
    "PAINT_RATES", "BASEBOARD_PRICES", "TILE_BASEBOARD_PRICES",
    "QUARTER_ROUND_PRICES", "ACCESSORY_PRICES", "DETACH_RESET_COSTS",
    "GENERAL_CONDITIONS", "DEMO_RATES",
})

# Material share of each line item category (rest is labor / equipment).
# Only the material share carries the tax loading — labor is not taxed.
MATERIAL_SHARE_BY_CATEGORY = {
    "demo": 0.00,        # teardown = labor only
    "plumbing": 0.30,    # rough parts / fixture connection
    "electrical": 0.20,  # devices + circuits, labor heavy
    "substrate": 0.35,   # backer board, waterproofing, framing
    "tile": 0.45,        # tile material vs. setting labor
    "fixture": 0.70,     # tubs, vanities, toilets, doors — material heavy
    "finish": 0.35,      # paint, trim, accessories
    "misc": 0.00,        # permits, dumpsters, pass-through — not taxed
    # Sub-category shares used when a bundled price must be split into its
    # material and labor halves (not line item categories themselves).
    "accessory": 0.60,   # towel bars, hooks, grab bars — material heavy
}
DEFAULT_MATERIAL_SHARE = 0.35

NOVA_ZIP3 = {"220", "221", "222", "223"}  # NOVA region → 6%
# Florida counties with surtax (6% + 1% = 7%)
FL_SURTAX_ZIP3 = {
    "321",           # Volusia County (New Smyrna Beach) +0.5%
    "327", "328",    # Orange County (Orlando) +0.5%
    "330", "331",    # Miami-Dade +1%
    "332", "333",    # Broward +1%
}

# ──────────────────────────────────────────────
# County / State Permit Matrix
# ──────────────────────────────────────────────
# Group A: Like-for-like exempt (VA USBC)
# Group B: Stricter — trade permits for fixture replacement (MD)
# Group C: Always recommend permit (DC, FL varies by county)
PERMIT_MATRIX = {
    # Virginia — Group A (VA USBC)
    # 13VAC5-63-80 (USBC §108.2) exempts "ordinary repairs" ONLY — paint/
    # wallpaper, cabinet and trim replacement, and work a building official
    # deems minor. Touching plumbing/electrical, or new drywall/wall changes,
    # still requires a permit. The blanket "like-for-like is exempt" reading
    # was an overstatement.
    "VA": {
        "group": "A",
        "like_for_like_exempt": True,
        "label": "VA USBC",
        "note_exempt": (
            "Cosmetic, like-for-like work may qualify as an "
            "\"ordinary repair\" exempt from permit per VA USBC "
            "(13VAC5-63-80, §108.2) — this covers finishes, cabinet "
            "and trim replacement only. Any plumbing/electrical "
            "alteration or new drywall/wall work still requires a "
            "permit; confirm scope with the local Building Official."
        ),
        "note_required": (
            "Permit required: scope includes plumbing/electrical "
            "rough-in changes per VA USBC. Contact local Building "
            "Official for application."
        ),
    },
    # Maryland — Group B (more strict, trade permits common)
    "MD": {
        "group": "B",
        "like_for_like_exempt": False,
        "label": "MD Code",
        "note_exempt": (
            "Cosmetic remodel — plumbing/electrical trade permits "
            "may still be required per county code. Verify with "
            "local Department of Permitting Services."
        ),
        "note_required": (
            "Permit required: plumbing/electrical rough-in changes "
            "in scope. Montgomery/PG County requires trade permits "
            "for fixture replacement in some cases."
        ),
    },
    # DC — Group C (always recommend)
    # NOTE: DCRA was dissolved 2022-10-01 and split into DOB (Department of
    # Buildings — permits/inspections) and DLCP (licensing). Permits are DOB.
    "DC": {
        "group": "C",
        "like_for_like_exempt": False,
        "label": "DC DOB",
        "note_exempt": (
            "DC recommends permits for most bathroom work. "
            "Contact the DC Department of Buildings (DOB) to confirm "
            "requirements."
        ),
        "note_required": (
            "Permit required per DC Department of Buildings (DOB). "
            "Plumbing/electrical work requires licensed trade "
            "contractors with active DC permits."
        ),
    },
    # Florida — varies by county, generally stricter
    "FL": {
        "group": "C",
        "like_for_like_exempt": False,
        "label": "FL Statute",
        "note_exempt": (
            "Florida counties vary on permit requirements for "
            "cosmetic remodels. Verify with local Building "
            "Department."
        ),
        "note_required": (
            "Permit required: plumbing/electrical changes in scope. "
            "Florida requires licensed contractors for permitted "
            "work (FL Statute 489)."
        ),
    },
}


def get_permit_info(state: str, has_rough_change: bool) -> dict:
    """Return permit note and whether permit is required.

    Returns dict with keys: required (bool), note (str), group (str).
    """
    matrix = PERMIT_MATRIX.get(state)
    if not matrix:
        # Default: conservative — recommend permit
        return {
            "required": has_rough_change,
            "note": (
                "Verify local permit requirements with county/city "
                "building department."
            ),
            "group": "?",
        }

    if has_rough_change:
        return {
            "required": True,
            "note": matrix["note_required"],
            "group": matrix["group"],
        }

    if matrix["like_for_like_exempt"]:
        return {
            "required": False,
            "note": matrix["note_exempt"],
            "group": matrix["group"],
        }

    # Group B/C: even like-for-like may need permit
    return {
        "required": False,
        "note": matrix["note_exempt"],
        "group": matrix["group"],
    }


# ──────────────────────────────────────────────
# O&P (optional)
# ──────────────────────────────────────────────
# Applied COMPOUND: cost x 1.10 x 1.10 = x1.21 (see calculator.py).
#
# This is NOT double-counting margin. Construction estimating separates three
# layers and each is charged exactly once:
#   L1 trade unit price  — material + burdened labor (insurance, benefits,
#                          payroll tax). This is what the rates in this file
#                          are, and what HomeWyse publishes.
#   L2 job overhead      — dumpster, portable toilet, protection, permits
#                          (GENERAL_CONDITIONS / permit allowance).
#   L3 general O&P       — the GC's office, management and profit. THIS.
#
# HomeWyse states its unit costs use "base wage + overhead costs (insurance,
# benefits)" — i.e. L1 only — and explicitly instructs adding 13-22% on top
# when a general contractor manages the job. RSMeans likewise treats its
# "Total Incl. O&P" as the *installing subcontractor's* O&P and expects GC
# General Conditions (5-15%, typically 10%) above that. Xactimate separates
# job-personnel, job-related and general overhead the same way.
#
# x1.21 therefore sits at the TOP of HomeWyse's recommended 13-22% band —
# defensible, but do not stack further markup on top of it. Cutting it to
# 6+6 (12.4%) would fall BELOW the recommended floor and under-recover.
DEFAULT_OVERHEAD_PCT = 0.10
DEFAULT_PROFIT_PCT = 0.10

# ──────────────────────────────────────────────
# Dropdown / Enum options
# ──────────────────────────────────────────────
BUILDING_TYPES = ["sfh", "townhouse", "condo"]
BATHROOM_DESIGNATIONS = ["master", "hall", "powder", "three_quarter", "jack_jill"]
BATHROOM_FUNCTIONS = ["full", "three_quarter", "half"]

SHOWER_TYPES = [
    "tub_combo", "one_piece", "multi_piece_kit",
    "custom_tile",
    # Curbless is split by substrate (§16): recessing a wood subfloor and
    # core-cutting a slab are different jobs at different cost.
    "curbless_wood", "curbless_slab",
    "neo_angle_kit", "neo_angle_custom",
]

# Every curbless variant, incl. the legacy bare "curbless" value that older
# estimates still carry. Use this for branch tests, never a == "curbless".
CURBLESS_TYPES = frozenset({"curbless", "curbless_wood", "curbless_slab"})

# Shower types that are a site-built tiled shower (vs. a prefab unit).
CUSTOM_TILE_SHOWER_TYPES = frozenset(
    {"custom_tile", "neo_angle_custom"} | CURBLESS_TYPES
)
ENCLOSURE_TYPES = ["curtain", "sliding", "pivot", "frameless", "half_wall_glass"]
SHOWERHEAD_TYPES = ["standard", "rain", "handheld", "combo", "body_spray"]
TRIM_GRADES = ["builder", "mid", "premium"]

BATHTUB_TYPES = ["alcove", "drop_in", "freestanding", "walk_in", "none"]
BATHTUB_MATERIALS = ["acrylic", "porcelain_steel", "cast_iron", "fiberglass"]

VANITY_SINK_TYPES = ["cabinet", "pedestal_sink", "wall_mount_sink"]
VANITY_WIDTHS = [24, 30, 36, 48, 60, 72]
VANITY_SOURCES = ["stock_rta", "semi_custom", "custom"]
VANITY_TOP_MATERIALS = ["cultured_marble", "quartz", "granite", "marble", "laminate"]
VANITY_MOUNTINGS = ["freestanding", "wall_mount"]
FAUCET_TYPES = ["single_hole", "centerset", "widespread", "wall_mount"]
MIRROR_TYPES = ["plain", "framed", "medicine_cabinet", "medicine_cabinet_recessed", "led_backlit"]

TOILET_TYPES = ["two_piece_standard", "two_piece_comfort", "one_piece_standard", "one_piece_comfort"]

TILE_MATERIALS = ["ceramic", "porcelain", "natural_stone", "glass_mosaic", "lvt_spc"]
TILE_PATTERNS = [
    "straight", "diagonal", "herringbone", "versailles", "chevron",
]

WATERPROOF_TYPES = ["paint_on", "sheet", "none"]

ACCESSORY_FINISHES = ["chrome", "brushed_nickel", "matte_black", "brass", "mixed"]
ACCESSORY_GRADES = ["builder", "mid", "premium"]

EXHAUST_FAN_CFMS = [50, 80, 110, 150]
EXHAUST_FAN_SWITCH_TYPES = ["standard", "timer", "humidity"]

PAINT_GRADES = ["builder", "mid", "premium"]
# "tile" stays a valid selection — it is priced from TILE_BASEBOARD_PRICES
# (by tile material), not from BASEBOARD_PRICES.
BASEBOARD_MATERIALS = ["pvc", "mdf", "wood", "tile"]


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return ZIP3_LABOR_MULTIPLIERS.get(zip_code[:3], 1.00)


def get_material_tax_loading(state: str, zip_code: str = "") -> float:
    """Material cost tax loading for a state/zip.

    This is an INTERNAL cost loading applied to the material portion of a
    line item — not a customer-facing sales tax. The contractor is the final
    consumer on lump-sum improvement contracts in MD/VA/DC/FL, so tax must
    never appear as a separate charge on the estimate or PDF.
    """
    if state == "VA" and zip_code and zip_code[:3] in NOVA_ZIP3:
        return 0.06
    if state == "FL" and zip_code and zip_code[:3] in FL_SURTAX_ZIP3:
        surtax = 0.01 if zip_code[:3] in {"330", "331", "332", "333"} else 0.005
        return 0.06 + surtax
    return MATERIAL_TAX_LOADING.get(state, 0.06)


def get_material_share(category: str) -> float:
    """Material fraction of a line item category (rest is labor/equipment)."""
    return MATERIAL_SHARE_BY_CATEGORY.get(category, DEFAULT_MATERIAL_SHARE)


def get_tile_complexity_multiplier(pattern: str, tile_size: str) -> float:
    """Combined pattern + size labor multiplier for tile work.

    Pattern and size complexity overlap heavily — a herringbone lay of 2x2
    mosaic is not 1.28 x 1.35 = 1.73x the labor. RSMeans/Xactimate/NTCA style
    estimating takes the DOMINANT complexity driver at full weight and counts
    the secondary one at half:

        multiplier = max(P, S) + (min(P, S) - 1.00) x 0.5   [capped]

    Applies to the LABOR portion only; extra material is handled by waste.
    """
    p = TILE_PATTERN_MULTIPLIER.get(pattern, 1.0)
    s = TILE_SIZE_MULTIPLIER.get(tile_size, 1.0)
    combined = max(p, s) + (min(p, s) - 1.00) * 0.5
    return min(combined, TILE_COMPLEXITY_CAP)


def get_tile_waste(pattern: str, tile_size: str) -> float:
    """Waste factor for tile MATERIAL by pattern/size (never applied to labor)."""
    waste = TILE_WASTE_BY_PATTERN.get(pattern, DEFAULT_TILE_WASTE)
    return max(waste, TILE_WASTE_BY_SIZE.get(tile_size, 0.0))


def apply_material_handling(price: float) -> float:
    """Load procurement cost onto an SKU-priced material figure (§0-1).

    Most rates in this file are HomeWyse-style *installed* prices, which
    already carry the installer's procurement. A few tables were instead
    priced from retail SKU listings (Home Depot / DreamLine / Aquatic etc.) —
    those are over-the-counter prices with no allowance for sourcing, pickup
    or delivery, storage, staging, or the return/damage risk the contractor
    carries on a special-order item.

    Apply ONLY to tables listed in SKU_PRICED_TABLES. Never apply it to
    labor, nor to anything in INSTALLED_PRICE_TABLES — doing so double-counts
    handling the installed rate already includes.
    """
    return round(price * MATERIAL_HANDLING, 2)


def is_curbless(shower_type: str) -> bool:
    """True for any curbless variant, including the legacy bare value."""
    return shower_type in CURBLESS_TYPES


def get_curbless_floor_cost(shower_type: str) -> float:
    """Curbless FLOOR SYSTEM cost (linear drain billed separately).

    Legacy "curbless" (no substrate recorded) falls back to the wood rate,
    which is the common case for DMV housing stock.
    """
    if shower_type == "curbless_slab":
        return SHOWER_CUSTOM_EXTRAS["curbless_floor_slab"]
    return SHOWER_CUSTOM_EXTRAS["curbless_floor_wood"]


# Backwards-compatible alias (older imports)
get_sales_tax_rate = get_material_tax_loading


# ──────────────────────────────────────────────
# Company prices
# ──────────────────────────────────────────────
# The tables listed in price_catalog.py are wrapped in place, so a company's
# own prices and an estimate's pinned price book answer for them while it is
# calculated (app/domains/unit_prices). Outside a calculation they read as
# the defaults above. The constants it lists (VANITY_INSTALL, ...) are read
# through FLAT_PRICES["VANITY_INSTALL"].
from app.domains.unit_prices.catalog import install as _install_price_tables  # noqa: E402

from .price_catalog import PRICE_TABLES as _PRICE_TABLES  # noqa: E402

_install_price_tables("bathroom", "Bathroom", globals(), _PRICE_TABLES)
