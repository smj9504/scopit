/**
 * Company prices for the Bathroom and Cabinet Estimators, and the price book
 * an estimate is priced with (backend app/domains/unit_prices; ported from
 * MJ Estimate).
 */

export type PriceDomain = 'bathroom' | 'cabinet';
export type PriceKind = 'material' | 'labor' | 'mixed';
export type PriceSide = 'material' | 'labor';

export interface UnitPriceDomain {
  key: PriceDomain;
  label: string;
  /** How many prices it has */
  count: number;
}

export interface UnitPriceItem {
  /** The price's path in the calculator's tables, e.g. "DEMO_RATES.floor_tile_per_sf" */
  key: string;
  group: string;
  label: string;
  unit: string;
  kind: PriceKind;
  note: string;
  default_material: number;
  default_labor: number;
  /** The company's figure, or null to follow the default */
  material: number | null;
  labor: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface UnitPriceList {
  domain: PriceDomain;
  label: string;
  /** A manager or admin may change the company's prices */
  can_edit: boolean;
  items: UnitPriceItem[];
}

/** A side left out is kept; null puts it back to the default. */
export interface UnitPriceChange {
  material?: number | null;
  labor?: number | null;
}

export interface UnitPriceHistoryEntry {
  key: string;
  label: string;
  group: string | null;
  old_material: number | null;
  old_labor: number | null;
  new_material: number | null;
  new_labor: number | null;
  changed_by: string | null;
  changed_at: string;
}

export interface PriceBookSummary {
  id: string;
  /** When this set of prices first appeared */
  priced_at: string | null;
  /** Today's prices for the estimate's company are the same */
  is_current: boolean;
}
