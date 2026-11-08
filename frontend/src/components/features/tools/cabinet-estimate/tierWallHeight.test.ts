import { describe, it, expect } from 'vitest';
import {
  CABINET_PRESETS,
  boxesAtWallHeight,
  getOptionsForType,
  mainWallHeight,
  wallHeightForTier,
  wallPresetAtHeight,
} from '@/components/features/tools/cabinet-estimate/CabinetBoxEditor';
import type { CabinetBoxCreate } from '@/types/cabinetEstimate';

const box = (code: string, over: Partial<CabinetBoxCreate> = {}): CabinetBoxCreate => {
  const p = CABINET_PRESETS[code];
  return {
    code,
    cab_type: p?.cab_type ?? 'wall',
    location: 'perimeter',
    width_inches: p?.width ?? 24,
    height_inches: p?.height ?? 30,
    is_specialty: !!p?.specialty,
    specialty_type: p?.specialty ?? null,
    has_glass_door: false,
    qty: 1,
    display_order: 0,
    ...over,
  };
};

const listedCodes = (wallHeight: ReturnType<typeof wallHeightForTier>) =>
  getOptionsForType('wall', wallHeight).flatMap((g) => g.options.map((o) => o.value));

describe('Tier sets the upper height', () => {
  it('hangs 30" uppers for Stock, 36" for Semi-Custom, 42" for Custom, and all until a Tier is picked', () => {
    expect(wallHeightForTier('Stock')).toBe(30);
    expect(wallHeightForTier('Semi-Custom')).toBe(36);
    expect(wallHeightForTier('Custom')).toBe(42);
    expect(wallHeightForTier(undefined)).toBe('all');
    expect(wallHeightForTier('')).toBe('all');
  });

  it("lists the Tier's full height and every short upper, no other full height", () => {
    const codes = listedCodes(36);
    expect(codes).toEqual(expect.arrayContaining(['W3036', 'WBC2436', 'WEA1236', 'W3015', 'W3624', 'WMW30', 'WRD36']));
    expect(codes).not.toContain('W3030');
    expect(codes).not.toContain('W3042');
    expect(codes).not.toContain('WBC24');
    expect(listedCodes('all')).toEqual(expect.arrayContaining(['W3030', 'W3036', 'W3042']));
  });
});

describe('mainWallHeight', () => {
  it('is the full height most uppers are, counted by qty, custom sizes included', () => {
    expect(mainWallHeight([box('W3036'), box('W2430'), box('W1230')])).toBe(30);
    expect(mainWallHeight([box('W3036', { qty: 3 }), box('W2430'), box('W1230')])).toBe(36);
    expect(mainWallHeight([box('CUSTOM', { width_inches: 20, height_inches: 42 }), box('W3015', { qty: 4 })])).toBe(42);
  });

  it('goes to the shorter on a tie, and is null with no full-height upper', () => {
    expect(mainWallHeight([box('W3042'), box('W3036')])).toBe(36);
    expect(mainWallHeight([box('W3015'), box('WMW30'), box('B30')])).toBeNull();
    expect(mainWallHeight([])).toBeNull();
  });
});

describe('wallPresetAtHeight', () => {
  it('finds the same upper at another full height, specialties included', () => {
    expect(wallPresetAtHeight('W3030', 36)).toBe('W3036');
    expect(wallPresetAtHeight('W0942', 30)).toBe('W0930');
    expect(wallPresetAtHeight('WBC24', 42)).toBe('WBC2442');
    expect(wallPresetAtHeight('WDC2736', 30)).toBe('WDC27');
    expect(wallPresetAtHeight('WTD3330', 36)).toBe('WTD3336');
    expect(wallPresetAtHeight('WEA1230', 42)).toBe('WEA1242');
  });

  it('leaves short uppers, ones already that tall, bases and custom sizes', () => {
    expect(wallPresetAtHeight('W3015', 36)).toBeNull();
    expect(wallPresetAtHeight('WMW30', 36)).toBeNull();
    expect(wallPresetAtHeight('W3036', 36)).toBeNull();
    expect(wallPresetAtHeight('B30', 36)).toBeNull();
    expect(wallPresetAtHeight('CUSTOM', 36)).toBeNull();
  });
});

describe('boxesAtWallHeight', () => {
  it('switches full-height uppers, keeps their glass and door, and counts them by qty', () => {
    const boxes = [
      box('B30'),
      box('W3030', { qty: 2, has_glass_door: true, door_pattern: 'mullion' }),
      box('W3015'),
      box('CUSTOM', { width_inches: 20, height_inches: 30 }),
      box('WBC24'),
    ];
    const { boxes: next, moved } = boxesAtWallHeight(boxes, 42);
    expect(moved).toBe(3);
    expect(next.map((b) => b.code)).toEqual(['B30', 'W3042', 'W3015', 'CUSTOM', 'WBC2442']);
    expect(next[1]).toMatchObject({ height_inches: 42, qty: 2, has_glass_door: true, door_pattern: 'mullion' });
    expect(next[3]).toBe(boxes[3]);
    expect(boxesAtWallHeight(next, 42).moved).toBe(0);
  });
});
