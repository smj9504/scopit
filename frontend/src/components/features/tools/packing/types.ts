// ── Enums ────────────────────────────────────────────────────────────────────

export type RoomSize = 'small' | 'large' | 'xlarge';
export type Density = 'light' | 'normal' | 'dense' | 'heavy' | 'extreme';
export type Floor = 'basement' | '1st' | '2nd' | '3rd' | '4th+';
export type Region = 'mid_atlantic' | 'northeast' | 'west' | 'midwest' | 'southwest' | 'southeast';
export type ContaminationLevel = 'clean' | 'gray_water' | 'black_water';
export type StagingType = 'off_site' | 'on_site';
export type PackingMode = 'quick' | 'content' | 'packout';
export type SessionStatus = 'draft' | 'completed';

// Content hint type (28 possible values)
export type ContentHint =
  | 'clothing_hanging'
  | 'clothing_folded'
  | 'bedding'
  | 'books'
  | 'documents'
  | 'electronics'
  | 'kitchenware'
  | 'fragile'
  | 'artwork'
  | 'collectibles'
  | 'valuables'
  | 'wine_collection'
  | 'furniture'
  | 'rugs'
  | 'lamps_lighting'
  | 'appliances_small'
  | 'appliances_large'
  | 'toys'
  | 'sports'
  | 'bicycles'
  | 'tools'
  | 'equipment_heavy'
  | 'boxes_stored'
  | 'holiday_decor'
  | 'instruments'
  | 'baby_items'
  | 'outdoor_furniture'
  | 'plants'
  | 'chemicals';

export const ITEM_CATEGORIES = [
  'Furniture',
  'Electronics',
  'Books',
  'Kitchenware',
  'Clothing',
  'Fragile',
  'Artwork',
  'Collectibles',
  'Appliances',
  'Tools',
  'Sports',
  'Other',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

// ── Quick Estimate ───────────────────────────────────────────────────────────

export interface RoomInput {
  preset: string;
  floor: Floor;
  density: Density;
  hints: string[];
  contamination: ContaminationLevel;
  hint_volume: Record<string, number>;
  hint_qty: Record<string, number>;
  special_items?: string[];
  custom_special_items?: CustomSpecialItem[];
}

export interface CustomSpecialItem {
  name: string;
  price: number;
}

export interface QuickEstimateRequest {
  rooms: RoomInput[];
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  material_rate: number;
  include_contingency?: boolean;
  contingency_rate?: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Estimate Response ────────────────────────────────────────────────────────

export interface MaterialItem {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  detail?: string;
}

export interface RoomItemSummary {
  room_name: string;
  notable_items: string[];
  categories_present: string[];
  high_value_items: string[];
  packing_notes: string[];
  item_count: number;
}

export interface SectionDetailLine {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  detail: string;
  amount: number;
}

export interface SupplementItem {
  key: string;
  name: string;
  description: string;
  amount: number;
  triggered: boolean;
  enabled: boolean;
  reason?: string;
}

export interface EstimateResponse {
  id?: string;
  created_at?: string;
  total_rooms: number;
  total_items: number;
  total_hours: number;
  crew_size: number;
  /** ceil(total_hours / 8-hr workday). Drives the moving-van DY quantity. */
  work_days?: number;
  /** Moving-van DY quantity = max(capacity trips, work_days). 0 for on-site jobs. */
  truck_trips?: number;
  sections: Record<string, number>;
  section_details?: Record<string, { lines: SectionDetailLine[] }>;
  materials: Record<string, number>;
  material_details?: MaterialItem[];
  materials_detail?: Record<string, string>;
  materials_mode?: MaterialsMode | null;
  storage_sf: number;
  staging_type: StagingType;
  room_summaries?: RoomItemSummary[];
  subtotal: number;
  include_op: boolean;
  op_rate: number;
  op_amount: number;
  include_contingency: boolean;
  contingency_rate: number;
  contingency_amount: number;
  supplements: SupplementItem[];
  supplements_total: number;
  grand_total: number;
  notes?: string[];
  include_packback?: boolean;
}

// ── Room Preset ──────────────────────────────────────────────────────────────

export interface RoomPreset {
  key: string;
  name: string;
  category: string;
  size: RoomSize;
  base_items: number;
  default_hints: string[];
  mattress: string | null;
}

// ── Photo Analysis / Detected Items ──────────────────────────────────────────

export type ItemSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type ItemWeight = 'light' | 'medium' | 'heavy' | 'extra_heavy';

export interface DetectedContentItem {
  name: string;
  description?: string;
  size?: ItemSize;
  weight?: ItemWeight;
  category: string;
  quantity: number;
  is_high_value: boolean;
  estimated_value?: string;
  is_fragile: boolean;
  needs_disassembly: boolean;
  packing_method?: string;
  required_materials?: string[];
  base_labor_hours?: number;
  per_unit_labor_hours?: number;
  estimated_labor_hours?: number;
  special_instructions?: string;
  estimator_flags?: string[];
  match_confidence?: number;
  confidence?: number;
}

export interface RoomAnalysisResponse {
  room_name: string;
  items: DetectedContentItem[];
  /** Items with low AI confidence — shown for user review, not auto-added */
  low_confidence_items: DetectedContentItem[];
  density: string;
  room_size: string;
  confidence_score: number;
  total_labor_hours: number;
  fragile_count: number;
  high_value_count: number;
  field_notes: string[];
}

// ── Content Estimate (Photo AI mode) ─────────────────────────────────────────

export interface ContentRoomInput {
  room_name: string;
  preset_id?: string;
  items: DetectedContentItem[];
  density: Density;
  floor: Floor;
  contamination: ContaminationLevel;
  special_items?: string[];
  custom_special_items?: CustomSpecialItem[];
  // Preset fallback fields
  use_preset?: boolean;
  preset?: string;
  hints?: string[];
  hint_volume?: Record<string, number>;
  hint_qty?: Record<string, number>;
}

export type MaterialsMode = 'pct_of_labor' | 'itemized';

export interface ContentEstimateRequest {
  rooms: ContentRoomInput[];
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  material_rate: number;
  materials_mode?: MaterialsMode;
  include_contingency?: boolean;
  contingency_rate?: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

// ── Master Content List ──────────────────────────────────────────────────────

export interface MasterContentItem {
  name: string;
  category: string;
  total_quantity: number;
  rooms: string[];
  is_high_value: boolean;
  is_fragile: boolean;
  estimator_flags: string[];
  total_labor_hours: number;
}

export interface MasterContentResponse {
  items: MasterContentItem[];
  total_items: number;
  total_labor_hours: number;
  high_value_count: number;
  fragile_count: number;
  flag_summary: Record<string, number>;
}

// ── Corrections ──────────────────────────────────────────────────────────────

export interface CorrectionEntry {
  original_name: string;
  corrected_name?: string;
  original_category?: string;
  corrected_category?: string;
  original_qty?: number;
  corrected_qty?: number;
  action: 'edit' | 'delete' | 'add';
  match_confidence?: number;
}

export interface CorrectionsRequest {
  session_id?: string;
  room_name: string;
  corrections: CorrectionEntry[];
}

// ── Company Info Override ────────────────────────────────────────────────────

export interface CompanyInfoOverride {
  name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  phone?: string;
  email?: string;
  license?: string;
}

export interface SavedCompanyProfile {
  id: string;
  label: string;  // display name for the dropdown
  data: CompanyInfoOverride;
}

// ── Session / State ──────────────────────────────────────────────────────────

export interface PackingSessionData {
  mode: PackingMode;
  rooms: PackingRoom[];
  settings: PackingSettings;
  company_override: CompanyInfoOverride;
  client_info: ClientInfo;
  result?: EstimateResponse;
  /** Lightweight stand-in for result.grand_total in list/summary views, where the full result is stripped server-side. */
  grand_total?: number;
  status?: SessionStatus;
  /** User explicitly marked this estimate as done, independent of any real conversion. */
  manually_completed?: boolean;
  /** Set server-side once this session was actually converted into a Scopit Estimate. */
  linked_estimate_id?: string;
  linked_estimate_number?: string;
  /** Set server-side once this session was actually converted into a Scopit Invoice. */
  linked_invoice_id?: string;
  linked_invoice_number?: string;
  // Photo AI specific
  photo_rooms?: PhotoRoom[];
  // Packout specific — retired; kept only so old saved sessions still
  // type-check when opened read-only (see PackingTool.tsx legacy handling).
  packout_rooms?: PackoutRoom[];
  packout_settings?: PackoutSettings;
}

/** Room for Quick Estimate mode (preset-based) */
export interface PackingRoom {
  id: string;
  preset: string;
  floor: Floor;
  density: Density;
  hints: string[];
  hint_volume: Record<string, number>;
  hint_qty: Record<string, number>;
  contamination: ContaminationLevel;
  items: DetectedContentItem[];
  photos: string[];
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

/** Room for Photo AI mode (item-based) */
export interface PhotoRoom {
  id: string;
  room_name: string;
  preset_id?: string;
  floor: Floor;
  density: Density;
  contamination: ContaminationLevel;
  photos: string[];       // base64 encoded (in-memory for display/analysis)
  photo_keys: string[];   // storage keys (persisted across saves)
  photo_count?: number;   // legacy: preserved for old sessions without photo_keys
  items: DetectedContentItem[];
  /** Items below confidence threshold — pending user review */
  low_confidence_items: DetectedContentItem[];
  /** Items removed by user — can be restored without re-analysis */
  dismissed_items: DetectedContentItem[];
  analyzed: boolean;
  analyzing: boolean;
  confidence_score?: number;
  room_size?: string;
  field_notes: string[];
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
  // Preset fallback (when AI analysis is unusable)
  usePreset: boolean;
  preset?: string;          // preset key (e.g. 'kitchen_standard')
  hints: string[];
  hint_volume: Record<string, number>;
  hint_qty: Record<string, number>;
}

export interface PackingSettings {
  crew_size: number;
  storage_months: number;
  staging_type: StagingType;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  material_rate: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

export interface PackoutSettings {
  detail_level: EstimateDetail;
  storage_mode: StorageMode;
  repair_duration_months: number;
  on_property_pct: number;
  crew_size: number;
  include_packback: boolean;
  include_op: boolean;
  op_rate: number;
  include_contingency: boolean;
  contingency_rate: number;
  region: Region;
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

export interface ClientInfo {
  name: string;
  phone: string;
  email: string;
  property_address_line1: string;
  property_address_line2?: string;
  property_city: string;
  property_state: string;
  property_zipcode: string;
  /** Linked Customer record id, when this client info was loaded from (or saved to) the customer list */
  customer_id?: string;
}

// ── Batch Analysis ───────────────────────────────────────────────────────────

export type BatchRoomStatus = 'success' | 'error';

export interface BatchRoomEvent {
  event: 'room_result';
  batch_id?: string;
  room_index: number;
  total_rooms: number;
  status: BatchRoomStatus;
  room_name: string;
  result?: RoomAnalysisResponse;
  error_code?: string;
  error_message?: string;
}

export interface BatchCompleteEvent {
  event: 'batch_complete';
  batch_id?: string;
  total_rooms: number;
  succeeded: number;
  failed: number;
  failed_rooms: string[];
}

export interface BatchAnalysisState {
  isRunning: boolean;
  currentRoomIndex: number;
  totalRooms: number;
  completedRooms: number;
  failedRooms: { id: string; name: string; error: string }[];
  aborted: boolean;
}

// ── Folder Import ────────────────────────────────────────────────────────────

export interface FolderRoom {
  name: string;
  files: File[];
  selected: boolean;
}

// ── Moving Price (from LineItem) ─────────────────────────────────────────────

export interface MovingPrice {
  id: string;
  code: string;
  name: string;
  unit: string;
  unit_price: number;
  cat: string;
  is_taxable?: boolean;
}

// ── Report Export ────────────────────────────────────────────────────────────

export interface ReportSections {
  inventory_list: boolean;
  damage_photos: boolean;
  labor_log: boolean;
  room_photos: boolean;
  estimate_summary: boolean;
}

export interface ReportRoomPhoto {
  image: string;
  caption?: string;
  is_damage: boolean;
}

export interface ReportRoomData {
  room_name: string;
  photos: ReportRoomPhoto[];
  items?: DetectedContentItem[];
  labor_hours?: number;
  labor_notes?: string;
  field_notes: string[];
}

export interface ReportExportRequest {
  session_id: string;
  sections: ReportSections;
  rooms: ReportRoomData[];
  company_override?: CompanyInfoOverride;
  tax_rate: number;
  notes?: string;
  include_signature_page: boolean;
  include_field_notes: boolean;
  image_quality: number;
  max_image_width: number;
  photos_per_page: number;
}

// ── Saved Estimate (History) ─────────────────────────────────────────────────

export interface SavedEstimateEntry {
  id: string;
  name: string;
  tool_id: string;
  data: PackingSessionData;
  created_at: string;
  updated_at: string;
}

// ── Packout Types (retired) ──────────────────────────────────────────────
// The Packout mode itself has been removed (superseded by Photo AI's
// itemized materials_mode). These types are kept only so old saved
// sessions with mode: 'packout' still type-check when opened read-only.

export type BoxType = 'small' | 'medium' | 'large' | 'wardrobe' | 'picture' | 'dish_pack' | 'specialty';
export type StorageMode = 'on_site' | 'off_site';
export type NonBoxableType =
  | 'furniture_large'
  | 'furniture_medium'
  | 'appliance_large'
  | 'appliance_small'
  | 'outdoor'
  | 'garage'
  | 'specialty'
  | 'sports'
  | 'instruments'
  | 'rugs_art'
  | 'custom';
export type VolumeSize = 'small' | 'medium' | 'large' | 'xlarge';
export type WeightClassType = 'light' | 'moderate' | 'heavy' | 'extra_heavy';
export type EstimateDetail = 'lump_sum' | 'detailed';

export interface NonBoxableItem {
  type: NonBoxableType;
  custom_type_name?: string;
  name: string;
  quantity: number;
  volume: VolumeSize;
  weight: WeightClassType;
  protection: string[];
  labor_hours?: number;
  needs_disassembly: boolean;
  needs_crating: boolean;
  special_instructions?: string;
}

export interface PackoutRoom {
  id: string;
  room_name: string;
  room_size: RoomSize;
  floor: Floor;
  density: Density;
  contamination: ContaminationLevel;
  box_counts: Record<BoxType, number>;
  non_boxable_items: NonBoxableItem[];
  lump_large_item_count?: number;
  floor_coverage_pct: number;
  blanket_override?: number;
  source_items: DetectedContentItem[];
  special_items: string[];
  custom_special_items: CustomSpecialItem[];
}

