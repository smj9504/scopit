import { describe, it, expect } from 'vitest';
import { lineItemChanges, phaseTotals } from './groupCompare';

const li = (phase: number, description: string, total: number) => ({
  id: `${phase}-${description}`,
  estimate_id: 'e',
  phase,
  description,
  quantity: 1,
  unit: 'LS',
  unit_price: total,
  total,
  display_order: 0,
});

const restoration = {
  line_items: [
    li(1, 'Demo floor tile', 180),
    li(4, 'Floor tile 12x12 porcelain', 900),
    li(5, 'Vanity 36in', 1200),
  ],
};

describe('lineItemChanges', () => {
  it('lists what an option adds, drops and reprices, and leaves out what is the same', () => {
    const option = {
      line_items: [
        li(1, 'Demo floor tile', 180),
        li(4, 'Floor tile 12x24 marble', 1500),
        li(5, 'Vanity 36in', 1450),
      ],
    };
    expect(lineItemChanges(restoration, option)).toEqual([
      { phase: 4, description: 'Floor tile 12x12 porcelain', base: 900, option: 0, difference: -900 },
      { phase: 4, description: 'Floor tile 12x24 marble', base: 0, option: 1500, difference: 1500 },
      { phase: 5, description: 'Vanity 36in', base: 1200, option: 1450, difference: 250 },
    ]);
  });

  it('adds up an item listed twice, and finds nothing between identical estimates', () => {
    const split = { line_items: [li(1, 'Demo floor tile', 100), li(1, 'Demo floor tile', 80), ...restoration.line_items.slice(1)] };
    expect(lineItemChanges(restoration, split)).toEqual([]);
  });
});

describe('phaseTotals', () => {
  it('sums each phase', () => {
    expect(phaseTotals({ line_items: [...restoration.line_items, li(4, 'Grout', 60.5)] })).toEqual({
      1: 180, 4: 960.5, 5: 1200,
    });
  });
});
