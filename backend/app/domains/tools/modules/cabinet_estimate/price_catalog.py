"""
The kitchen cabinet prices a company can change: which tables in
pricing.py are prices, grouped for the price screen, and whether each is
material, labor or both. pricing.py wraps exactly these
(unit_prices.catalog.install).

A price that is both is split by the material share the calculator gives
its line (pricing.MATERIAL_SHARE, or the share written on the line), and
the calculator reads the share back from the price book, so a company's
split carries through to the estimate's material/labor columns.
Multipliers, sizes, zip factors and permit rules aren't here: they stay
code.
"""

from app.domains.unit_prices.catalog import LABOR, MATERIAL, MIXED, TableSpec

from .appliance_labor import APPLIANCE_LABELS

_TIER_NOTE = "Before the box material, finish, door style and zip multipliers."

_SCOPE_GROUPS = {
    "demo_per_lf": "Demo & Disposal", "demo_min": "Demo & Disposal",
    "dumpster_10yard": "Demo & Disposal", "dumpster_15yard": "Demo & Disposal",
    "dumpster_20yard": "Demo & Disposal", "dumpster_30yard": "Demo & Disposal",
    "dc_dumpster_public_space_permit": "Demo & Disposal",
    "install_base_per_lf": "Cabinet Install", "install_wall_per_lf": "Cabinet Install",
    "install_tall_per_each": "Cabinet Install",
    "hardware_per_opening": "Cabinet Install", "hardware_install_per_opening": "Cabinet Install",
    "toe_kick_per_lf": "Panels & Trim", "quarter_round_per_lf": "Panels & Trim",
    "delivery_base": "Delivery", "delivery_per_lf": "Delivery", "delivery_min": "Delivery",
    "delivery_floor_surcharge": "Delivery",
    "countertop_reset_per_lf": "Countertop", "countertop_reset_min": "Countertop",
    "backsplash_misc_per_sf": "Backsplash",
    "drywall_patch_per_sf": "Drywall & Paint", "drywall_rr_per_sf": "Drywall & Paint",
    "paint_prep_per_sf": "Drywall & Paint", "paint_primer_paint_per_sf": "Drywall & Paint",
    "site_protection_base": "Site & Permit", "site_protection_per_lf": "Site & Permit",
    "cleanup_base": "Site & Permit", "cleanup_per_lf": "Site & Permit",
    "permit_allowance": "Site & Permit",
    "electrical_disconnect_reconnect": "Electrical", "outlet_relocation_each": "Electrical",
}

PRICE_TABLES = [
    # ── Cabinet supply ──
    TableSpec(
        "BASE_RATES", "Cabinet Supply", kind=MATERIAL,
        labels={"base_lf": "Base cabinets", "wall_lf": "Wall cabinets (30\" high)",
                "tall_each": "Tall cabinet (24\" x 84\")"},
        units={"tall_each": "EA"},
        note=_TIER_NOTE,
    ),
    TableSpec("TALL_CABINET_TYPES", "Cabinet Supply", kind=MATERIAL, note=_TIER_NOTE),
    TableSpec(
        "SPECIALTY_PREMIUM", "Specialty Cabinets", kind=MATERIAL, skip_zero=True,
        note="Added to the box at Stock; Semi-Custom x1.6, Custom x2.4.",
    ),
    TableSpec("GLASS_DOOR_PREMIUM", "Doors", kind=MATERIAL, title="Glass door, per cabinet"),
    TableSpec("GLASS_INSERT_PREMIUM", "Doors", kind=MATERIAL,
              title="Glass insert for a lattice or mullion door, per door"),
    TableSpec("DOOR_PATTERN_PREMIUM", "Doors", kind=MATERIAL, title="Door pattern, per door",
              labels={"lattice": "Diamond lattice", "lattice_band": "Lattice + oval band",
                      "mullion": "Glass mullion"}),
    # ── Install ──
    TableSpec(
        "SCOPE_ITEMS", "Plumbing", kind=MIXED, groups=_SCOPE_GROUPS,
        skip=("sink_single_supply", "sink_double_supply"),
        kinds={
            "demo_per_lf": LABOR, "demo_min": LABOR,
            "install_base_per_lf": LABOR, "install_wall_per_lf": LABOR,
            "install_tall_per_each": LABOR,
            "delivery_base": LABOR, "delivery_per_lf": LABOR, "delivery_min": LABOR,
            "delivery_floor_surcharge": LABOR,
            "plumbing_disconnect": LABOR, "plumbing_reconnect": LABOR,
            "plumbing_reconnect_additional_sink": LABOR,
            "faucet_supply": MATERIAL, "disposal_supply": MATERIAL,
            "countertop_reset_per_lf": LABOR, "countertop_reset_min": LABOR,
            "backsplash_misc_per_sf": MATERIAL,
            "dumpster_10yard": MATERIAL, "dumpster_15yard": MATERIAL,
            "dumpster_20yard": MATERIAL, "dumpster_30yard": MATERIAL,
            "dc_dumpster_public_space_permit": MATERIAL,
            "hardware_per_opening": MATERIAL, "hardware_install_per_opening": LABOR,
            "permit_allowance": MATERIAL,
        },
        # The calculator's split for each line priced from these
        shares={
            "p_trap_assembly": 0.56, "supply_line_each": 0.42, "angle_stop_each": 0.38,
            "aav_vent": 0.44, "air_gap": 0.35, "soap_dispenser": 0.46,
            "instant_hot_dispenser": 0.63, "dw_supply_line": 0.42, "dw_angle_stop": 0.38,
            "toe_kick_per_lf": 0.35, "quarter_round_per_lf": 0.30,
            "drywall_patch_per_sf": 0.20, "drywall_rr_per_sf": 0.30,
            "paint_prep_per_sf": 0.15, "paint_primer_paint_per_sf": 0.30,
            "site_protection_base": 0.40, "site_protection_per_lf": 0.40,
            "cleanup_base": 0.05, "cleanup_per_lf": 0.05,
            "electrical_disconnect_reconnect": 0.20, "outlet_relocation_each": 0.25,
        },
        units={
            "install_tall_per_each": "EA", "delivery_per_lf": "LF",
            "site_protection_per_lf": "LF", "cleanup_per_lf": "LF",
            "hardware_per_opening": "OPENING", "hardware_install_per_opening": "OPENING",
            "permit_allowance": "LS", "dc_dumpster_public_space_permit": "LS",
        },
        labels={
            "install_base_per_lf": "Base cabinet install", "install_wall_per_lf": "Wall cabinet install",
            "install_tall_per_each": "Tall cabinet install", "aav_vent": "Air admittance valve",
            "dc_dumpster_public_space_permit": "DC public space permit (dumpster)",
            "demo_min": "Demo minimum", "delivery_min": "Delivery minimum",
            "countertop_reset_min": "Countertop reset minimum",
        },
    ),
    TableSpec("APPLIANCE_RESET_PRICES", "Appliance Detach & Reset", kind=LABOR,
              labels={"INSURANCE_DR": "Insurance D&R", "RETAIL_INSTALL": "Retail install",
                      **APPLIANCE_LABELS},
              note="Insurance D&R is used on a claim, retail install when the homeowner pays."),
    TableSpec("SINK_PRICES", "Plumbing", kind=MATERIAL, title="Undermount SS sink",
              size_format='{}" base', labels={"single": "Single bowl", "double": "Double bowl"}),
    # ── Island ──
    TableSpec("ISLAND_PANEL_PRICING", "Island", kind=MATERIAL, kinds={"install_per_sf": LABOR},
              labels={"end_panel_per_sf": "End panel per SF", "back_panel_per_sf": "Back panel per SF",
                      "install_per_sf": "Panel install per SF"}),
    TableSpec("PREFAB_ISLAND_PRICING", "Island", kind=MATERIAL, title="Prefab island",
              labels={"xl": "X-Large"}),
    TableSpec("PREFAB_ISLAND_INSTALL", "Island", kind=LABOR, title="Prefab island install",
              labels={"xl": "X-Large"}),
    # ── Panels & trim ──
    TableSpec("CROWN_MOLDING_PRICING", "Panels & Trim", kind=MATERIAL, title="Crown molding",
              unit="LF", kinds={"install_per_lf": LABOR}),
    TableSpec("FILLER_PRICING", "Panels & Trim", kind=MATERIAL, title="Filler",
              kinds={"install_each": LABOR}),
    TableSpec("ANGLED_JOINT_PRICING", "Panels & Trim", kind=MATERIAL, title="Angled joint",
              kinds={"install_each": LABOR}),
    TableSpec("END_PANEL_PRICING", "Panels & Trim", kind=MATERIAL, title="End panel",
              kinds={"install_each": LABOR}, labels={"refrigerator": "Refrigerator deep"}),
    TableSpec("RANGE_END_PANEL_EACH", "Panels & Trim", kind=MATERIAL, scalar=True,
              labels={"RANGE_END_PANEL_EACH": "Range end panel (slide-in)"}),
    TableSpec("DISHWASHER_RETURN_PANEL", "Panels & Trim", kind=MIXED, share=0.65, scalar=True,
              labels={"DISHWASHER_RETURN_PANEL": "Dishwasher return panel"}),
    TableSpec("LIGHT_RAIL_PRICING", "Panels & Trim", kind=MATERIAL, title="Light rail",
              kinds={"install_per_lf": LABOR}),
    # ── Backsplash ──
    TableSpec("BACKSPLASH_TYPES", "Backsplash", kind=MATERIAL, kinds={"install_per_sf": LABOR},
              labels={"stone_marble": "Stone / marble"}),
    # ── Countertop ──
    TableSpec("COUNTERTOP_MATERIALS", "Countertop", kind=MIXED, share=0.55, unit="SF",
              labels={"rate": "per SF installed"}),
    TableSpec("COUNTERTOP_BACKSPLASH_PER_LF", "Countertop", kind=MIXED, share=0.55, unit="LF",
              title='4" backsplash'),
    TableSpec("COUNTERTOP_ANGLED_CUT_EACH", "Countertop", kind=LABOR, title="Angled cut"),
    TableSpec("COUNTERTOP_SUPPORT_PRICING", "Countertop", kind=MATERIAL, title="Overhang bracket",
              kinds={"install_each": LABOR}, labels={"bracket_each": "Bracket"}),
]
