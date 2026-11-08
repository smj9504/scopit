import { describe, expect, it } from 'vitest';
import type { UnitPriceItem } from '@/types/unitPrices';
import {
  applyPercent,
  buildChanges,
  effectiveTotal,
  hasOwn,
  isChanged,
  takes,
  valueOf,
} from './unitPriceDrafts';

const item = (over: Partial<UnitPriceItem>): UnitPriceItem => ({
  key: 'PLUMBING_RATES.shutoff_valve_each',
  group: 'Plumbing',
  label: 'Shutoff valve each',
  unit: 'EA',
  kind: 'mixed',
  note: '',
  default_material: 30,
  default_labor: 70,
  material: null,
  labor: null,
  updated_at: null,
  updated_by: null,
  ...over,
});

describe('company price drafts', () => {
  it('reads a side from the draft, then the saved figure', () => {
    const saved = item({ material: 40 });
    expect(valueOf(saved, {}, 'material')).toBe(40);
    expect(valueOf(saved, { [saved.key]: { material: 55 } }, 'material')).toBe(55);
    // null in a draft is "back to the default"
    expect(valueOf(saved, { [saved.key]: { material: null } }, 'material')).toBeNull();
    expect(valueOf(saved, {}, 'labor')).toBeNull();
  });

  it('prices each side at the company figure, else the default', () => {
    const saved = item({ material: 40 });
    expect(effectiveTotal(saved, {})).toBe(110);
    expect(effectiveTotal(saved, { [saved.key]: { labor: 100, material: null } })).toBe(130);
  });

  it('sends only the sides that differ from what is saved', () => {
    const a = item({ key: 'A', material: 40 });
    const b = item({ key: 'B' });
    const c = item({ key: 'C', labor: 90 });
    const drafts = {
      A: { material: 40, labor: 80 }, // material unchanged
      B: { material: null }, // already following the default
      C: { labor: null },
    };
    expect(buildChanges([a, b, c], drafts)).toEqual({ A: { labor: 80 }, C: { labor: null } });
    expect(isChanged(a, drafts)).toBe(true);
    expect(isChanged(b, drafts)).toBe(false);
    expect(hasOwn(c, drafts)).toBe(false);
    expect(hasOwn(a, {})).toBe(true);
  });

  it('only prices the sides an item takes', () => {
    expect(takes('material', 'labor')).toBe(false);
    expect(takes('labor', 'labor')).toBe(true);
    expect(takes('mixed', 'material')).toBe(true);
  });

  it('adjusts one side of every item by a percentage from its current figure', () => {
    const mixed = item({ key: 'M', labor: 100 });
    const material = item({ key: 'P', kind: 'material', default_material: 19.99, default_labor: 0 });
    const free = item({ key: 'Z', kind: 'labor', default_material: 0, default_labor: 0 });
    const next = applyPercent([mixed, material, free], {}, 'labor', 5);
    expect(next).toEqual({ M: { labor: 105 } });
    const up = applyPercent([mixed, material], { M: { material: 10 } }, 'material', 10);
    expect(up).toEqual({ M: { material: 11 }, P: { material: 21.99 } });
    expect(applyPercent([mixed], {}, 'labor', 0)).toEqual({});
  });
});
