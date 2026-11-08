/**
 * Comparing two estimates of one kitchen job, as the Compare drawer and
 * the customer's proposal PDF (proposal_pdf.line_item_changes) both do:
 * line items are matched by location and description.
 */

import type { CabinetEstimate } from '@/types/cabinetEstimate';

export interface LineItemChange {
  /** 'perimeter' | 'island' | 'shared'; an item without one is on the perimeter. */
  location: string;
  description: string;
  /** Total on the estimate compared against; 0 when it doesn't have the item. */
  base: number;
  /** Total on the estimate being looked at; 0 when it doesn't have the item. */
  option: number;
  difference: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// Plain code-point order, as Python's sorted() puts them in the PDF
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const totalsByItem = (estimate: Pick<CabinetEstimate, 'line_items'>) => {
  const totals = new Map<string, { location: string; description: string; total: number }>();
  for (const li of estimate.line_items || []) {
    const location = li.location || 'perimeter';
    const description = li.description || '';
    const key = `${location}\u0000${description}`;
    const prev = totals.get(key);
    totals.set(key, {
      location,
      description,
      total: (prev?.total || 0) + (li.total || 0),
    });
  }
  return totals;
};

/** The line items whose totals differ, in location then description order. */
export function lineItemChanges(
  base: Pick<CabinetEstimate, 'line_items'>,
  option: Pick<CabinetEstimate, 'line_items'>,
): LineItemChange[] {
  const before = totalsByItem(base);
  const after = totalsByItem(option);
  const keys = Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]));
  return keys
    .map((key) => {
      const item = (before.get(key) || after.get(key))!;
      const was = before.get(key)?.total || 0;
      const now = after.get(key)?.total || 0;
      return { location: item.location, description: item.description, base: was, option: now, difference: round2(now - was) };
    })
    .filter((c) => c.difference !== 0)
    .sort((a, b) => byCodePoint(a.location, b.location) || byCodePoint(a.description, b.description));
}

/** Each category's total (supply, install, countertop, …); an item without one counts as misc. */
export function categoryTotals(estimate: Pick<CabinetEstimate, 'line_items'>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const li of estimate.line_items || []) {
    const category = li.category || 'misc';
    totals[category] = round2((totals[category] || 0) + (li.total || 0));
  }
  return totals;
}
