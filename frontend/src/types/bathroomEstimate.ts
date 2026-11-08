/**
 * Bathroom Estimator types (ported from MJ Estimate). There an estimate hung
 * off a claim; in Scopit it belongs to the signed-in user's company, links a
 * customer and keeps the claim number itself.
 */

import type { ProductLook } from './productLibrary';
import type { PriceBookSummary } from './unitPrices';

// ── Shower type helpers ──

/**
 * Every curbless variant, including the legacy bare 'curbless' value that
 * older estimates still carry. Curbless is split by substrate because
 * recessing a wood subfloor and core-cutting a slab differ in cost.
 */
export const CURBLESS_SHOWER_TYPES = [
  'curbless', 'curbless_wood', 'curbless_slab',
] as const;

/** Site-built tiled showers (vs. prefab units) — these need backer board. */
export const CUSTOM_TILE_SHOWER_TYPES = [
  'custom_tile', 'neo_angle_custom', ...CURBLESS_SHOWER_TYPES,
] as const;

export const isCurblessShower = (t?: string): boolean =>
  !!t && (CURBLESS_SHOWER_TYPES as readonly string[]).includes(t);

export const isCustomTileShower = (t?: string): boolean =>
  !!t && (CUSTOM_TILE_SHOWER_TYPES as readonly string[]).includes(t);

// ── Component Spec interfaces ──

export interface ShowerSpec {
  /** tub_combo, one_piece, multi_piece_kit, custom_tile, curbless_wood, curbless_slab, neo_angle_kit, neo_angle_custom */
  type?: string;
  /** Linear drain grade for curbless showers: standard | premium */
  linear_drain_grade?: string;
  size?: { width: number; depth: number; height: number };
  enclosure?: string;     // curtain, sliding, pivot, frameless, half_wall_glass
  /** Door type from sketch: sliding, swing, frameless_swing, bi_fold, curtain, none, neo_angle_pivot */
  door_type?: string;
  /** Door opening width in inches */
  door_width?: number;
  /** Fixed glass panel config: none, left, right, both */
  fixed_panel_config?: string;
  /** Where the glass door sits across the front: left, center, right */
  door_position?: string;
  /** Enclosure layout: alcove, corner, corner_right, neo_angle, neo_angle_right */
  layout?: string;
  /** Curb height in inches (0 = curbless) */
  curb_height?: number;
  niches?: number;
  bench?: boolean;
  /** Bench position: left, right, back */
  bench_position?: 'left' | 'right' | 'back';
  /** Bench length along the wall in inches (width is fixed at 16″) */
  bench_length?: number;
  showerhead_type?: string;
  /** Showerhead action: 'replace' (buy new, default), 'detach_reset' (reuse existing, labor only), 'none' */
  showerhead_action?: 'replace' | 'detach_reset' | 'none';
  valve_replace?: boolean;
  trim_grade?: string;
  tile_spec?: {
    material?: string;
    size?: string;
    pattern?: string;
    sf?: number;
  };
  /** Wall material: tile (default), prefab_acrylic, prefab_fiberglass, solid_surface */
  wall_material?: string;
  /** Neo-angle kit grade: basic_fiberglass, mid_acrylic */
  neo_angle_kit_grade?: string;
  /** Neo-angle door frame style: framed_neo_angle, semi_frameless_neo_angle, frameless_neo_angle */
  neo_angle_door_type?: string;
}

export interface BathtubSpec {
  type?: string;          // alcove, drop_in, freestanding, walk_in, none
  material?: string;      // acrylic, porcelain_steel, cast_iron, fiberglass
  size?: { length: number; width: number };
  jetted?: boolean;
  curtain_rod?: boolean;           // curtain rod + rings (supply + mount)
  spout_type?: string;
  surround_tile?: boolean;         // drop_in tub surround tile
  surround_tile_sf?: number;       // surround tile area SF
  surround_tile_material?: string; // porcelain, ceramic, etc.
  surround_tile_pattern?: string;  // straight, diagonal, herringbone
  // Whether the surround wall has a tub faucet/valve on it (default true).
  // Set false when the faucet is elsewhere (different wall, deck-mount) so
  // opening the surround tile doesn't auto-add a valve replacement line item.
  has_faucet?: boolean;
  // The tub's faucet is always R&R. A shower head and a hand shower on a
  // hose, when the tub has them, are detached and reset or replaced.
  showerhead_action?: 'none' | 'detach_reset' | 'replace';
  handheld_action?: 'none' | 'detach_reset' | 'replace';
}

export interface VanityItemSpec {
  /** Sink type: cabinet (default), pedestal_sink, wall_mount_sink */
  sink_type?: string;
  width?: number;
  sinks?: number;
  source?: string;        // stock_rta, semi_custom, custom
  top_material?: string;
  mounting?: string;      // freestanding, wall_mount
  faucet_type?: string;
  mirror_type?: string;
}

export interface VanitySpec {
  items?: VanityItemSpec[];
  // Legacy single-vanity fields (backward compat)
  width?: number;
  sinks?: number;
  source?: string;
  top_material?: string;
  mounting?: string;
  faucet_type?: string;
  mirror_type?: string;
}

export interface ToiletSpec {
  type?: string;
  bidet_seat?: boolean;
  wax_ring?: boolean;
  flange_repair?: boolean;
}

export interface FloorSpec {
  material?: string;
  size?: string;
  pattern?: string;
  heated_floor?: boolean;
}

export interface WallsSpec {
  /** Wall finish: paint, tile, or paint_and_tile (partial each) */
  wall_finish?: 'paint' | 'tile' | 'paint_and_tile';
  paint_walls?: boolean;
  paint_ceiling?: boolean;
  paint_grade?: string;
  /** Paint area SF (for paint_and_tile mode) */
  paint_wall_sf?: number;
  /** Tile the remaining (paintable) wall area */
  tile_walls?: boolean;
  tile_wall_sf?: number;
  tile_material?: string;
  tile_pattern?: string;
  tile_size?: string;
  baseboard_material?: string;
  quarter_round?: boolean;
  door_trim_count?: number;
  window_trim_count?: number;
  colors?: number;
  /** Seal & prime area SF (drywall repair areas only) */
  seal_prime_wall_sf?: number;
  seal_prime_ceiling_sf?: number;
  /** Full paint area SF (entire wall/ceiling minus tub/shower) — auto-set when any drywall repair exists */
  full_paint_wall_sf?: number;
  full_paint_ceiling_sf?: number;
  /** Insulation install */
  insulation_walls?: boolean;
  insulation_walls_sf?: number;
  insulation_ceiling?: boolean;
  insulation_ceiling_sf?: number;
  insulation_type?: string;
  insulation_r_value?: number;
  /** SF of wall marked as already tiled in the sketch — needs demo before any new finish */
  existing_tile_wall_sf?: number;
}

export interface AccessoriesSpec {
  towel_bars?: number;
  hand_towel_rings?: number;
  tp_holders?: number;
  robe_hooks?: number;
  grab_bars?: number;
  corner_shelves?: number;
  toilet_brush_holders?: number;
  soap_dispensers?: number;
  finish?: string;
  grade?: string;
  /** Mirrors by width in inches (components/bathroom-estimate/mirrorRows.ts) */
  mirrors?: { width: number; count: number; from_sketch?: boolean }[];
}

export interface PlumbingSpec {
  valve_replace_count?: number;
  supply_line_count?: number;
  drain_modification?: boolean;
  pressure_balance_valve?: boolean;
  rough_inspection?: boolean;
}

export interface ElectricalSpec {
  gfci_count?: number;
  vanity_lights?: number;
  /** Ceiling light type: none, standard, recessed, recessed_multi */
  ceiling_fixture?: string | boolean;
  exhaust_fan_cfm?: number;
  exhaust_fan_switch?: string;
  heated_floor?: boolean;
  inspection?: boolean;
  megohmmeter_check?: boolean;
}

export interface SubstrateSpec {
  durock_sf?: number;
  greenboard_sf?: number;
  waterproof_type?: string;
  waterproof_sf?: number;
  subfloor_repair?: boolean;
  subfloor_repair_sf?: number;
}

export interface HiddenCostFlags {
  dumpster?: boolean;
  floor_protection?: boolean;
  caulk?: boolean;
  final_clean?: boolean;
  punch_list?: boolean;
  mobilization?: boolean;
  drywall_patch?: boolean;
  drywall_patch_sf?: number;
  trim_paint?: boolean;
  trim_paint_lf?: number;
  permit?: boolean;
  // Auto-include toggles (default true — set false to disable)
  drywall_skim_coat?: boolean;
  subfloor_allowance?: boolean;
  auto_gfci?: boolean;
  auto_exhaust_fan?: boolean;
  auto_tub_valve?: boolean;
  auto_shower_valve?: boolean;
  exclude_trim_kit?: boolean;
  auto_vanity_light?: boolean;
  auto_ceiling_paint?: boolean;
  mold_resistant_drywall?: boolean;
  // Permit triggers (check if scope includes these)
  valve_body_replace?: boolean;
  fixture_relocation?: boolean;
  new_plumbing_line?: boolean;
  new_electrical_circuit?: boolean;
}

// ── Line Item ──

export interface BathroomEstimateLineItem {
  id: string;
  estimate_id: string;
  phase: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  category?: string;
  notes?: string;
  display_order: number;
  created_at?: string;
}

// ── Main Estimate ──

export interface BathroomEstimate {
  id: string;
  /** A Scopit customer; shared by every estimate of the job */
  customer_id?: string | null;
  /** An insurance job's claim number, as printed on the PDF; shared by the job */
  claim_number?: string | null;
  /** The Scopit estimate this one was last sent to */
  scopit_estimate_id?: string | null;
  created_by_id?: string | null;
  status: string;

  // Project meta
  property_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  building_type?: string;
  year_built?: number;

  // Bathroom info
  designation?: string;
  bath_function?: string;
  length_ft?: number;
  width_ft?: number;
  height_ft?: number;
  floor_sf?: number;
  wall_sf?: number;

  // Demo flags
  demo_floor?: boolean;
  demo_floor_sf?: number;
  demo_walls?: boolean;
  demo_wall_sf?: number;
  demo_ceiling?: boolean;
  demo_ceiling_sf?: number;
  replace_shower?: boolean;
  replace_tub?: boolean;
  replace_vanity?: boolean;
  replace_toilet?: boolean;
  detach_reset_shower?: boolean;
  detach_reset_tub?: boolean;
  detach_reset_vanity?: boolean;
  detach_reset_toilet?: boolean;
  replace_mirror?: boolean;
  detach_reset_mirror?: boolean;
  replace_vanity_light?: boolean;
  detach_reset_vanity_light?: boolean;
  water_damage?: boolean;
  /** Where the water damage originated — plumber already fixed this source */
  water_damage_source?: 'shower' | 'bathtub' | 'vanity' | 'toilet' | 'supply_line' | 'other' | null;
  mold_suspected?: boolean;
  demo_already_done?: boolean;
  repair_drywall_walls?: boolean;
  repair_drywall_walls_sf?: number;
  repair_drywall_ceiling?: boolean;
  repair_drywall_ceiling_sf?: number;
  repair_subfloor?: boolean;
  repair_subfloor_sf?: number;
  existing_tub_material?: string;
  demo_cement_board?: boolean;
  demo_cement_board_sf?: number;
  /** Insulation demo & install flags */
  demo_insulation_walls?: boolean;
  demo_insulation_walls_sf?: number;
  demo_insulation_ceiling?: boolean;
  demo_insulation_ceiling_sf?: number;
  install_insulation_walls?: boolean;
  install_insulation_walls_sf?: number;
  install_insulation_ceiling?: boolean;
  install_insulation_ceiling_sf?: number;

  // Component specs (JSONB)
  shower_spec?: ShowerSpec;
  bathtub_spec?: BathtubSpec;
  vanity_spec?: VanitySpec;
  toilet_spec?: ToiletSpec;
  floor_spec?: FloorSpec;
  walls_spec?: WallsSpec;
  accessories_spec?: AccessoriesSpec;
  plumbing_spec?: PlumbingSpec;
  electrical_spec?: ElectricalSpec;
  substrate_spec?: SubstrateSpec;
  hidden_costs?: HiddenCostFlags;

  // Sketch data
  sketch_data?: Record<string, any>;

  /** Products picked for an option, by slot (BathroomSelectionSlot.key); never on a restoration. */
  selections?: Record<string, BathroomSelection> | null;

  // Overview & O&P
  overview_text?: string;
  include_overhead_profit?: boolean;
  overhead_pct?: number;
  profit_pct?: number;

  // Target total
  target_total?: number | null;
  adjustment_factor?: number | null;

  // Totals
  subtotal?: number;
  overhead_amount?: number;
  profit_amount?: number;
  tax_amount?: number;
  total?: number;

  // Documentation
  methodology_notes?: string;
  warning_flags?: string[];
  notes?: string;

  // Relations
  line_items: BathroomEstimateLineItem[];

  // Estimate group: one bathroom job. An insurance job is its restoration
  // (the estimate the carrier sees) plus any upgrade options; a remodel job
  // is options only.
  group_id?: string;
  project_type?: BathroomProjectType;
  kind?: BathroomEstimateKind;
  option_label?: string | null;
  option_order?: number;
  group_members?: BathroomGroupMember[];
  /** The prices it is priced with: when they're from, and whether today's differ */
  price_book?: PriceBookSummary | null;

  // Enriched: the linked customer's name
  client_name?: string | null;

  created_at?: string;
  updated_at?: string;
}

export type BathroomProjectType = 'insurance' | 'remodel';
/** existing: a remodel's bathroom as it is today — unpriced, what its options' layout changes are priced against. */
export type BathroomEstimateKind = 'restore' | 'option' | 'existing';

/** A product an option is built from: the estimate's own copy of it (product_library ProductSnapshot). */
export interface BathroomSelection {
  product_id: string;
  category: string;
  title: string;
  brand?: string | null;
  model_number?: string | null;
  sku?: string | null;
  finish?: string | null;
  retailer: string;
  source_url?: string | null;
  price?: number | string | null;
  price_unit: string;
  box_sf?: number | null;
  width_in?: number | null;
  depth_in?: number | null;
  height_in?: number | null;
  tile_width_in?: number | null;
  tile_length_in?: number | null;
  image_file_ids: string[];
  swatch_file_id?: string | null;
  look: ProductLook;
  taken_at: string;
  /** A vanity sold with its top: no separate top is priced. */
  includes_top?: boolean;
}

/** What an option can be built from (selections.SLOTS): a slot, and the library categories that fill it. */
export interface BathroomSelectionSlot {
  key: string;
  label: string;
  categories: string[];
  unit: 'each' | 'sf';
}

/** One way an option's sketch differs from the bathroom as it is (layout_changes.py). */
export interface BathroomLayoutChange {
  key: string;
  kind: 'moved' | 'added' | 'removed' | 'converted' | 'sinks_added' | 'wall_added' | 'wall_removed'
    /** A tub's or shower's drain, or its faucet / valve, moved where the fixture stays */
    | 'drain_moved' | 'valve_moved';
  item: string;
  label: string;
  distance_in: number;
  length_ft: number;
  count: number;
}

export interface BathroomLayoutChangeReport {
  /** What the option is compared with: the restoration, or a remodel's current layout; null if there's none. */
  baseline: { id: string; kind: BathroomEstimateKind; name: string } | null;
  changes: BathroomLayoutChange[];
  /** Keys of the changes left out of the price. */
  skips: string[];
}

/** One estimate of a bathroom job, as the switcher shows it. */
export interface BathroomGroupMember {
  id: string;
  kind: BathroomEstimateKind;
  option_label?: string | null;
  option_order: number;
  status: string;
  total: number;
  updated_at?: string | null;
}

export interface BathroomEstimateGroup {
  group_id: string;
  project_type: BathroomProjectType;
  members: BathroomEstimate[];
}

/** What a job member is called on screen and on the customer's proposal. */
export const memberName = (m: { kind?: string; option_label?: string | null }): string =>
  m.kind === 'restore' ? 'Restoration' : m.kind === 'existing' ? 'Current layout' : m.option_label || 'Option';

// ── Request types ──

export type BathroomEstimateCreate = Omit<BathroomEstimate,
  'id' | 'status' | 'created_by_id' | 'subtotal' | 'overhead_amount' |
  'profit_amount' | 'tax_amount' | 'total' | 'methodology_notes' |
  'warning_flags' | 'line_items' | 'client_name' | 'scopit_estimate_id' |
  'created_at' | 'updated_at' |
  // A job's shape changes through its own endpoints, not a save
  'group_id' | 'kind' | 'option_label' | 'option_order' | 'group_members' |
  // Pinned when priced; moved only by use-current-prices
  'price_book'
>;

export type BathroomEstimateUpdate = Partial<Omit<BathroomEstimateCreate, 'project_type'>>;

// ── List response ──

export interface BathroomEstimateListResponse {
  items: BathroomEstimate[];
  total: number;
  page: number;
  page_size: number;
}

// ── History ──

export interface BathroomEstimateHistory {
  id: string;
  estimate_id: string;
  version_number: number;
  snapshot_data: Record<string, any>;
  changed_by_id?: string;
  change_description?: string;
  created_at?: string;
}

// ── Pricing Info (for dropdowns) ──

export interface BathroomPricingInfo {
  building_types: string[];
  designations: string[];
  bath_functions: string[];
  shower_types: string[];
  enclosure_types: string[];
  shower_door_types: string[];
  showerhead_types: string[];
  trim_grades: string[];
  bathtub_types: string[];
  bathtub_materials: string[];
  vanity_widths: number[];
  vanity_sources: string[];
  vanity_top_materials: string[];
  vanity_mountings: string[];
  faucet_types: string[];
  mirror_types: string[];
  toilet_types: string[];
  tile_materials: string[];
  tile_patterns: string[];
  tile_sizes: string[];
  waterproof_types: string[];
  accessory_finishes: string[];
  accessory_grades: string[];
  exhaust_fan_cfms: number[];
  exhaust_fan_switch_types: string[];
  paint_grades: string[];
  baseboard_materials: string[];
  // Rate tables the Cost Guide quotes. Most entries are a flat rate;
  // exhaust_fan is keyed by CFM and exhaust_fan_switch by switch type.
  plumbing_rates: Record<string, number>;
  electrical_rates: Record<string, number | Record<string, number>>;
}

// Phase labels for display
export const PHASE_LABELS: Record<number, string> = {
  1: 'Demo & Disposal',
  2: 'Rough Trades (Plumbing & Electrical)',
  3: 'Substrate & Waterproofing',
  4: 'Tile & Flooring',
  5: 'Fixtures Install',
  6: 'Finish (Paint & Trim)',
  7: 'Punch / Cleanup / Accessories',
};
