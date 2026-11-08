/**
 * Unsaved edits on the company prices page, and the save they make.
 *
 * A draft holds the sides someone has typed over: a side present replaces
 * the saved value, and null there is "follow the default". The PUT sends
 * only the sides that differ from what is saved.
 */

import type { PriceKind, PriceSide, UnitPriceChange, UnitPriceItem } from '@/types/unitPrices';

export type Drafts = Record<string, UnitPriceChange>;

const SIDES: PriceSide[] = ['material', 'labor'];

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Whether a side can be priced on an item of this kind. */
export const takes = (kind: PriceKind, side: PriceSide) => kind === 'mixed' || kind === side;

/** The company's figure for a side as it stands with the drafts: null follows the default. */
export function valueOf(item: UnitPriceItem, drafts: Drafts, side: PriceSide): number | null {
  const draft = drafts[item.key];
  if (draft && side in draft) return draft[side] ?? null;
  return item[side];
}

const defaultOf = (item: UnitPriceItem, side: PriceSide) =>
  side === 'material' ? item.default_material : item.default_labor;

/** The price the calculator would use: each side the company's figure, else the default. */
export function effectiveTotal(item: UnitPriceItem, drafts: Drafts): number {
  return SIDES.reduce((sum, side) => sum + (valueOf(item, drafts, side) ?? defaultOf(item, side)), 0);
}

export const defaultTotal = (item: UnitPriceItem) => item.default_material + item.default_labor;

/** A side of the draft that differs from what is saved. */
const differs = (item: UnitPriceItem, draft: UnitPriceChange | undefined, side: PriceSide) =>
  !!draft && side in draft && (draft[side] ?? null) !== item[side];

export const isChanged = (item: UnitPriceItem, drafts: Drafts) =>
  SIDES.some((side) => differs(item, drafts[item.key], side));

/** The company has (or is about to have) its own figure for the item. */
export const hasOwn = (item: UnitPriceItem, drafts: Drafts) =>
  valueOf(item, drafts, 'material') != null || valueOf(item, drafts, 'labor') != null;

/** The PUT body: for each changed item, only the sides that changed. */
export function buildChanges(items: UnitPriceItem[], drafts: Drafts): Record<string, UnitPriceChange> {
  const body: Record<string, UnitPriceChange> = {};
  items.forEach((item) => {
    const draft = drafts[item.key];
    const change: UnitPriceChange = {};
    SIDES.forEach((side) => {
      if (differs(item, draft, side)) change[side] = draft[side] ?? null;
    });
    if (Object.keys(change).length) body[item.key] = change;
  });
  return body;
}

/**
 * Raise or lower one side of `items` by a percentage, from each item's
 * current figure (its draft, its company figure, else the default). Items
 * that don't take the side, or whose figure is zero, are left alone.
 */
export function applyPercent(items: UnitPriceItem[], drafts: Drafts, side: PriceSide, pct: number): Drafts {
  if (!pct) return drafts;
  const factor = 1 + pct / 100;
  const next = { ...drafts };
  items.forEach((item) => {
    if (!takes(item.kind, side)) return;
    const current = valueOf(item, drafts, side) ?? defaultOf(item, side);
    if (!current) return;
    next[item.key] = { ...next[item.key], [side]: round2(current * factor) };
  });
  return next;
}
