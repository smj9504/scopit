import { describe, it, expect } from 'vitest';
import { categoryTotals, lineItemChanges } from '@/components/features/tools/cabinet-estimate/groupCompare';

const li = (location: string | undefined, category: string | undefined, description: string, total: number) => ({
  id: `${location}-${description}`,
  estimate_id: 'e',
  description,
  quantity: 1,
  unit: 'EA',
  unit_price: total,
  total,
  category,
  location,
  display_order: 0,
});

const restoration = {
  line_items: [
    li('perimeter', 'demo', 'Cabinet Demolition', 600),
    li('perimeter', 'supply', 'Base Cabinets - Stock', 4200),
    li('island', 'supply', 'Base Cabinets - Stock', 1800),
    li('perimeter', 'countertop', 'Countertop - Laminate', 1500),
    li('shared', 'misc', 'Cabinet Delivery', 250),
  ],
};

describe('lineItemChanges', () => {
  it('lists what an option adds, drops and reprices, and leaves out what is the same', () => {
    const option = {
      line_items: [
        li('perimeter', 'demo', 'Cabinet Demolition', 600),
        li('perimeter', 'supply', 'Base Cabinets - Stock', 5100),
        li('island', 'supply', 'Base Cabinets - Stock', 1800),
        li('perimeter', 'countertop', 'Countertop - Quartz', 3900),
        li('shared', 'misc', 'Cabinet Delivery', 250),
      ],
    };
    expect(lineItemChanges(restoration, option)).toEqual([
      { location: 'perimeter', description: 'Base Cabinets - Stock', base: 4200, option: 5100, difference: 900 },
      { location: 'perimeter', description: 'Countertop - Laminate', base: 1500, option: 0, difference: -1500 },
      { location: 'perimeter', description: 'Countertop - Quartz', base: 0, option: 3900, difference: 3900 },
    ]);
  });

  it('tells the island apart from the perimeter, in the order the PDF lists them', () => {
    const option = {
      line_items: restoration.line_items.map((item) =>
        item.location === 'island' ? { ...item, total: 2400 } : item),
    };
    option.line_items.push(li('shared', 'misc', 'Dumpster', 450));
    expect(lineItemChanges(restoration, option)).toEqual([
      { location: 'island', description: 'Base Cabinets - Stock', base: 1800, option: 2400, difference: 600 },
      { location: 'shared', description: 'Dumpster', base: 0, option: 450, difference: 450 },
    ]);
  });

  it('adds up an item listed twice, counts an item without a location as perimeter, and finds nothing between identical estimates', () => {
    const split = {
      line_items: [
        li(undefined, 'demo', 'Cabinet Demolition', 400),
        li('perimeter', 'demo', 'Cabinet Demolition', 200),
        ...restoration.line_items.slice(1),
      ],
    };
    expect(lineItemChanges(restoration, split)).toEqual([]);
  });
});

describe('categoryTotals', () => {
  it('sums each category, perimeter and island together, with an item without one as misc', () => {
    expect(categoryTotals({
      line_items: [...restoration.line_items, li('perimeter', undefined, 'Touch-up', 80.5)],
    })).toEqual({
      demo: 600, supply: 6000, countertop: 1500, misc: 330.5,
    });
  });
});
