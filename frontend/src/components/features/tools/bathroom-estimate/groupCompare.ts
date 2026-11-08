/**
 * Comparing two estimates of one bathroom job, as the Compare drawer and
 * the customer's proposal PDF (export_service._line_item_changes) both do:
 * line items are matched by phase and description.
 */

import type { BathroomEstimate } from '@/types/bathroomEstimate';

export interface LineItemChange {
  phase: number;
  description: string;
  /** Total on the estimate compared against; 0 when it doesn't have the item. */
  base: number;
  /** Total on the estimate being looked at; 0 when it doesn't have the item. */
  option: number;
  difference: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const totalsByItem = (estimate: Pick<BathroomEstimate, 'line_items'>) => {
  const totals = new Map<string, { phase: number; description: string; total: number }>();
  for (const li of estimate.line_items || []) {
    const key = `${li.phase}\u0000${li.description}`;
    const prev = totals.get(key);
    totals.set(key, {
      phase: li.phase,
      description: li.description,
      total: (prev?.total || 0) + (li.total || 0),
    });
  }
  return totals;
};

/** The line items whose totals differ, in phase then description order. */
export function lineItemChanges(
  base: Pick<BathroomEstimate, 'line_items'>,
  option: Pick<BathroomEstimate, 'line_items'>,
): LineItemChange[] {
  const before = totalsByItem(base);
  const after = totalsByItem(option);
  const keys = Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]));
  return keys
    .map((key) => {
      const item = (before.get(key) || after.get(key))!;
      const was = before.get(key)?.total || 0;
      const now = after.get(key)?.total || 0;
      return { phase: item.phase, description: item.description, base: was, option: now, difference: round2(now - was) };
    })
    .filter((c) => c.difference !== 0)
    .sort((a, b) => a.phase - b.phase || a.description.localeCompare(b.description));
}

/** Each phase's total. */
export function phaseTotals(estimate: Pick<BathroomEstimate, 'line_items'>): Record<number, number> {
  const totals: Record<number, number> = {};
  for (const li of estimate.line_items || []) {
    totals[li.phase] = round2((totals[li.phase] || 0) + (li.total || 0));
  }
  return totals;
}
