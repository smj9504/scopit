/**
 * Cabinet Estimate types
 */

import type { ProductSnapshot } from '@/types/productLibrary';

// ── Enums ──

export type CabinetTier = 'Stock' | 'Semi-Custom' | 'Custom';
export type BoxMaterial = 'Plywood' | 'MDF' | 'Particle';
export type FinishType = 'Stained' | 'Painted' | 'Glazed' | 'Laminate';
export type CabType = 'base' | 'wall' | 'tall' | 'specialty';
export type CabinetLocation = 'perimeter' | 'island';
export type EstimateStatus = 'draft' | 'calculated' | 'approved' | 'exported';
export type SpecialtyType =
  | 'sink_base' | 'lazy_susan' | 'blind_corner' | 'drawer_base'
  | 'angle_end_base' | 'diagonal_corner_base'
  | 'diagonal_corner_wall' | 'blind_corner_wall' | 'easy_reach_corner_wall'
  | 'three_door_corner_wall' | 'angle_end_wall' | 'two_door_angle_end_wall' | 'three_door_angle_end_wall'
  | 'trash_pullout' | 'farmhouse_sink_base' | 'microwave_drawer_base'
  | 'refrigerator_wall_deep' | 'otr_microwave_wall'
  | 'oven_cabinet' | 'refrigerator_cabinet'
  | 'pantry_rollout' | 'double_oven_cabinet'
  | 'range_base_slide_in' | 'range_base_drop_in';
/**
 * A pattern in a cabinet's doors instead of a plain panel: a diamond lattice,
 * a lattice over a carved oval band with the whole front as one panel, or
 * mullions — a square grid of bars over glass.
 */
export type DoorPattern = 'lattice' | 'lattice_band' | 'mullion';
/**
 * Which pricing world an estimate is quoted in. An insurance claim and a
 * retail remodel price the same physical work differently — most visibly
 * on appliance detach & reset, where a carrier pays crew time and a
 * homeowner also pays a trip minimum. Never mix the two in one estimate.
 */
export type PricingBasis = 'INSURANCE_DR' | 'RETAIL_INSTALL';
/** Full Overlay / Partial Overlay / Inset — inset runs +15-25%. */
export type OverlayStyle = 'Full Overlay' | 'Partial Overlay' | 'Inset';
/** Finished end panel positions, priced per panel by cabinet type. */
export type EndPanelType = 'wall' | 'base' | 'tall' | 'refrigerator';
export type BacksplashType = 'ceramic_tile' | 'subway_tile' | 'glass_tile' | 'stone_marble';

// ── Box ──

export interface CabinetBox {
  id: string;
  estimate_id: string;
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  has_glass_door: boolean;
  /** Finished end panels flanking a slide-in range opening (0-2). */
  range_panel_count?: number | null;
  door_pattern?: DoorPattern | null;
  qty: number;
  display_order: number;
  created_at?: string;
}

export interface CabinetBoxCreate {
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type?: SpecialtyType | null;
  has_glass_door: boolean;
  /** Finished end panels flanking a slide-in range opening (0-2). */
  range_panel_count?: number | null;
  door_pattern?: DoorPattern | null;
  qty: number;
  display_order?: number;
}

// ── Line Item ──

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  // Breakdown of unit_price / total. The estimate PDF quotes the combined
  // figures; these are the internal material vs labor split.
  material_unit_price?: number;
  labor_unit_price?: number;
  material_total?: number;
  labor_total?: number;
  category?: string;
  location?: string;
  notes?: string;
  display_order: number;
  created_at?: string;
}

// ── Estimate ──

export interface CabinetEstimate {
  id: string;
  /** The Scopit customer the kitchen belongs to */
  customer_id?: string | null;
  company_id?: string | null;
  /** The Scopit estimate this one was last sent to */
  scopit_estimate_id?: string | null;
  created_by_id?: string | null;
  status: EstimateStatus;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  overlay_style?: OverlayStyle;
  pricing_basis?: PricingBasis;
  include_demo: boolean;
  include_install: boolean;
  include_delivery: boolean;
  include_plumbing: boolean;
  sink_type?: 'single' | 'double';
  /** Under-sink components, quoted for a single sink. */
  include_aav?: boolean;
  include_air_gap?: boolean;
  include_soap_dispenser?: boolean;
  include_instant_hot?: boolean;
  include_dw_hookup?: boolean;
  include_countertop_reset: boolean;
  include_hardware: boolean;
  include_crown_molding: boolean;
  include_backsplash: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick: boolean;
  include_quarter_round?: boolean;
  include_countertop: boolean;
  include_drywall_repair: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting: boolean;
  painting_sqft?: number;
  include_appliance_rr: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster: boolean;
  include_electrical: boolean;
  include_permit: boolean;
  filler_count: number;
  /** Places a run or island turns at an angle other than 90°. */
  angled_joint_count?: number;
  /** How far the island top overhangs for seating, inches (null/0 = the 1.5" edge only). */
  island_seating_overhang_in?: number | null;
  /** Brackets / corbels under that overhang. */
  countertop_support_count?: number;
  end_panel_counts?: Partial<Record<EndPanelType, number>> | null;
  dishwasher_return_panel_count: number;
  include_light_rail: boolean;
  light_rail_lf?: number | null;
  outlet_relocation_count: number;
  delivery_floor?: number;
  island_type: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft: number;
  island_back_panel_sqft: number;
  /** Cabinets on both long sides, back to back: no back panel, no seating side; the Sketch lays the island in two rows. */
  island_two_sided?: boolean | null;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
  subtotal: number;
  overhead_pct: number;
  overhead_amount: number;
  profit_pct: number;
  profit_amount: number;
  adjustment_factor?: number | null;
  total: number;
  methodology_notes?: string;
  warning_flags?: string[];
  notes?: string;
  boxes: CabinetBox[];
  line_items: EstimateLineItem[];

  // Estimate group: one kitchen job. An insurance job is its restoration
  // (the estimate the carrier sees) plus any upgrade options; a remodel job
  // is options only.
  group_id?: string;
  project_type?: KitchenProjectType;
  kind?: KitchenEstimateKind;
  option_label?: string | null;
  option_order?: number;
  group_members?: KitchenGroupMember[];
  /** An option's products from the library, by slot (PricingInfo.selection_slots). Copies. */
  selections?: Record<string, ProductSnapshot> | null;

  /** An insurance job's claim number, as printed on the PDF */
  claim_number?: string | null;
  /** The linked customer's name */
  client_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type KitchenProjectType = 'insurance' | 'remodel';
export type KitchenEstimateKind = 'restore' | 'option';

/** One estimate of a kitchen job, as the switcher shows it. */
export interface KitchenGroupMember {
  id: string;
  kind: KitchenEstimateKind;
  option_label?: string | null;
  option_order: number;
  status: string;
  total: number;
  updated_at?: string | null;
}

export interface KitchenEstimateGroup {
  group_id: string;
  project_type: KitchenProjectType;
  members: CabinetEstimate[];
}

/** What a job member is called on screen and on the customer's proposal. */
export const memberName = (m: { kind?: string; option_label?: string | null }): string =>
  m.kind === 'restore' ? 'Restoration' : m.option_label || 'Option';

/** A product slot of an option: which library category it takes and what it prices. */
export interface SelectionSlot {
  key: string;
  label: string;
  category: string;
  prices: string;
}

export interface CabinetEstimateCreate {
  /** insurance → the new estimate is the restoration; remodel → Option A. */
  project_type?: KitchenProjectType;
  customer_id?: string | null;
  claim_number?: string | null;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit?: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  overlay_style?: OverlayStyle;
  pricing_basis?: PricingBasis;
  include_demo?: boolean;
  include_install?: boolean;
  include_delivery?: boolean;
  include_plumbing?: boolean;
  sink_type?: 'single' | 'double';
  /** Under-sink components, quoted for a single sink. */
  include_aav?: boolean;
  include_air_gap?: boolean;
  include_soap_dispenser?: boolean;
  include_instant_hot?: boolean;
  include_dw_hookup?: boolean;
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  include_crown_molding?: boolean;
  include_backsplash?: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick?: boolean;
  include_quarter_round?: boolean;
  include_countertop?: boolean;
  include_drywall_repair?: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting?: boolean;
  painting_sqft?: number;
  include_appliance_rr?: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster?: boolean;
  include_electrical?: boolean;
  include_permit?: boolean;
  filler_count?: number;
  angled_joint_count?: number;
  island_seating_overhang_in?: number | null;
  countertop_support_count?: number;
  end_panel_counts?: Partial<Record<EndPanelType, number>> | null;
  dishwasher_return_panel_count?: number;
  include_light_rail?: boolean;
  light_rail_lf?: number | null;
  outlet_relocation_count?: number;
  delivery_floor?: number;
  island_type?: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft?: number;
  island_back_panel_sqft?: number;
  island_two_sided?: boolean;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string;
  boxes: CabinetBoxCreate[];
}

export interface CabinetEstimateUpdate {
  customer_id?: string | null;
  claim_number?: string | null;
  property_address?: string;
  zip_code?: string;
  layout_type?: string;
  kitchen_size_sqft?: number;
  ceiling_height?: number;
  has_soffit?: boolean;
  tier?: CabinetTier;
  box_material?: BoxMaterial;
  finish?: FinishType;
  door_style?: string;
  overlay_style?: OverlayStyle;
  pricing_basis?: PricingBasis;
  include_demo?: boolean;
  include_install?: boolean;
  include_delivery?: boolean;
  include_plumbing?: boolean;
  sink_type?: 'single' | 'double';
  /** Under-sink components, quoted for a single sink. */
  include_aav?: boolean;
  include_air_gap?: boolean;
  include_soap_dispenser?: boolean;
  include_instant_hot?: boolean;
  include_dw_hookup?: boolean;
  include_countertop_reset?: boolean;
  include_hardware?: boolean;
  include_crown_molding?: boolean;
  include_backsplash?: boolean;
  backsplash_type?: BacksplashType | null;
  backsplash_sqft?: number;
  include_toe_kick?: boolean;
  include_quarter_round?: boolean;
  include_countertop?: boolean;
  include_drywall_repair?: boolean;
  drywall_repair_type?: 'patch' | 'rr';
  drywall_repair_sqft?: number;
  include_painting?: boolean;
  painting_sqft?: number;
  include_appliance_rr?: boolean;
  appliance_list?: { type: string; qty: number }[];
  include_dumpster?: boolean;
  include_electrical?: boolean;
  include_permit?: boolean;
  filler_count?: number;
  angled_joint_count?: number;
  island_seating_overhang_in?: number | null;
  countertop_support_count?: number;
  end_panel_counts?: Partial<Record<EndPanelType, number>> | null;
  dishwasher_return_panel_count?: number;
  include_light_rail?: boolean;
  light_rail_lf?: number | null;
  outlet_relocation_count?: number;
  delivery_floor?: number;
  island_type?: string;
  island_prefab_size?: string;
  island_prefab_price?: number;
  island_end_panel_sqft?: number;
  island_back_panel_sqft?: number;
  island_two_sided?: boolean;
  countertop_material?: string;
  countertop_sqft?: number;
  include_countertop_backsplash?: boolean;
  countertop_backsplash_lf?: number;
  island_countertop_material?: string;
  island_countertop_sqft?: number;
  overview_text?: string;
  target_total?: number | null;
  overhead_pct?: number;
  profit_pct?: number;
  notes?: string;
  boxes?: CabinetBoxCreate[];
}

// ── List Response ──

export interface CabinetEstimateListResponse {
  items: CabinetEstimate[];
  total: number;
  page: number;
  page_size: number;
}

// ── History ──

export interface EstimateHistory {
  id: string;
  estimate_id: string;
  version_number: number;
  snapshot_data: Record<string, any>;
  changed_by_id?: string;
  change_description?: string;
  created_at?: string;
}

// ── Purchase Order ──

export interface PurchaseOrderItem {
  code: string;
  description: string;
  cab_type: string;
  width_inches: number;
  height_inches: number;
  qty: number;
}

export interface PurchaseOrderResponse {
  estimate_id: string;
  property_address?: string;
  items: PurchaseOrderItem[];
  total_boxes: number;
}

// ── Pricing Info ──

export interface BacksplashTypeInfo {
  key: string;
  label: string;
  material_per_sf: number;
  install_per_sf: number;
}

export interface PricingInfo {
  tiers: string[];
  materials: string[];
  finishes: string[];
  door_styles: string[];
  overlay_styles: string[];
  /** Selectable pricing bases with their descriptions. */
  pricing_bases: { key: PricingBasis; label: string; description: string }[];
  layout_types: string[];
  cab_types: string[];
  specialty_types: string[];
  /** { type_key: label } — finished end panel options. */
  end_panel_types: Record<string, string>;
  // Install labor keys are tier-keyed ({ Stock, 'Semi-Custom', Custom });
  // every other entry is a flat rate.
  scope_items: Record<string, number | Record<string, number>>;
  backsplash_types: BacksplashTypeInfo[];
  glass_door_premiums: Record<string, number>;
  crown_molding_pricing: Record<string, number>;
  island_panel_pricing: Record<string, any>;
  prefab_island_pricing: Record<string, any>;
  prefab_island_install: Record<string, number>;
  tall_cabinet_types: Record<string, Record<string, number>>;
  appliance_rr_pricing: Record<string, { label: string; cost: number }>;
  countertop_materials: Record<string, { label: string; rate: number }>;
  countertop_backsplash_per_lf: Record<string, number>;
  /** When an island top's seating overhang needs brackets, and how many (see pricing.py). */
  countertop_support_rule?: {
    max_unsupported_in: Record<string, number>;
    spacing_in: number;
    end_inset_in: number;
  };
  /** An option's product slots, in order. */
  selection_slots?: SelectionSlot[];
}
