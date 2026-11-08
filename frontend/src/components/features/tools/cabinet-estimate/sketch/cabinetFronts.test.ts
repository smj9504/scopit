import { describe, it, expect } from 'vitest';
import { ARCH_MIN_DOOR_IN, GLASS_STILE_IN, LATTICE_BAR_IN, REVEAL_IN, archOutline, archRiseIn, doorDesign, facesFor } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import {
  bayFront,
  boxKey,
  cornerKind,
  footprintDepthIn,
  reconcileCabinets,
  wrapFront,
  type PresetCatalog,
  type SketchBoxSource,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';

const doors = (faces: ReturnType<typeof facesFor>) => faces.filter((f) => f.kind === 'door');
const drawers = (faces: ReturnType<typeof facesFor>) => faces.filter((f) => f.kind === 'drawer');

describe('facesFor', () => {
  it('keeps two doors up to 48" wide, each under 24", then adds one', () => {
    for (const w of [24, 30, 36, 39, 42, 45, 48]) {
      const faces = doors(facesFor('wall', undefined, w, 30));
      expect(faces).toHaveLength(2);
      for (const f of faces) expect(f.w).toBeLessThan(24);
    }
    expect(doors(facesFor('wall', undefined, 18, 30))).toHaveLength(1);
    const custom = doors(facesFor('wall', undefined, 60, 30));
    expect(custom).toHaveLength(3);
    for (const f of custom) expect(f.w).toBeLessThan(24);
  });

  it('puts a drawer over each door on a wide base', () => {
    const b48 = facesFor('base', undefined, 48, 34.5);
    expect(doors(b48)).toHaveLength(2);
    expect(drawers(b48)).toHaveLength(2);
    const custom = facesFor('base', undefined, 60, 34.5);
    expect(doors(custom)).toHaveLength(3);
    expect(drawers(custom)).toHaveLength(3);
    expect(drawers(facesFor('base', undefined, 24, 34.5))).toHaveLength(1);
  });

  it('keeps every face inside a wide box', () => {
    for (const faces of [facesFor('wall', undefined, 48, 30), facesFor('base', undefined, 48, 34.5)]) {
      for (const f of faces) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w).toBeLessThanOrEqual(48 + 1e-9);
      }
    }
  });

  it('shows a three-door corner\'s front door and its foreshortened cut door, the cut at the open end', () => {
    const cut = 12 / (1 + Math.SQRT2);
    const left = doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'left'));
    expect(left).toHaveLength(2);
    expect(left[0].x).toBeCloseTo(REVEAL_IN);
    expect(left[0].x + left[0].w).toBeCloseTo(36 - cut - REVEAL_IN / 2);
    expect(left[1].x).toBeCloseTo(36 - cut + REVEAL_IN / 2);
    expect(left[1].x + left[1].w).toBeCloseTo(36 - REVEAL_IN);
    const right = doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'right'));
    expect(right).toHaveLength(2);
    // Mirrored: the narrow cut door on the left.
    expect(Math.min(...right.map((f) => f.w))).toBeCloseTo(left[1].w);
    expect(right.find((f) => f.w < 10)!.x).toBeCloseTo(REVEAL_IN);
    expect(right.every((f) => f.x >= 0 && f.x + f.w <= 36 + 1e-9)).toBe(true);
  });

  it('makes the front one panel for a lattice over a band, but keeps the doors for a plain lattice', () => {
    expect(doors(facesFor('wall', undefined, 36, 18, 'left', 'lattice_band'))).toHaveLength(1);
    expect(doors(facesFor('wall', undefined, 36, 18, 'left', 'lattice'))).toHaveLength(2);
    expect(doors(facesFor('base', undefined, 36, 34.5, 'left', 'lattice_band'))).toHaveLength(1);
    expect(doors(facesFor('base', 'sink_base', 36, 34.5, 'left', 'lattice_band'))).toHaveLength(1);
    // A corner's doors stay as they are.
    expect(doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'left', 'lattice_band'))).toHaveLength(2);
    // No door, nothing to change.
    expect(doors(facesFor('base', 'drawer_base', 24, 34.5, 'left', 'lattice_band'))).toHaveLength(0);
  });

  it('gives a tall cabinet\'s door rows a pattern, a lattice over a band making each row one panel', () => {
    // Pantry: the same doors with a lattice as plain, the count the estimate bills.
    expect(doors(facesFor('tall', undefined, 24, 84, 'left', 'lattice'))).toHaveLength(4);
    expect(doors(facesFor('tall', undefined, 18, 84, 'left', 'lattice'))).toHaveLength(2);
    const band = doors(facesFor('tall', undefined, 24, 84, 'left', 'lattice_band'));
    expect(band).toHaveLength(2);
    expect(band[0].y).toBeLessThan(band[1].y);
    // Fridge and oven cabinets: only the row over the opening; the oven's drawer and both openings stay.
    const fridge = facesFor('tall', 'refrigerator_cabinet', 36, 84, 'left', 'lattice_band');
    expect(doors(fridge)).toHaveLength(1);
    expect(fridge.some((f) => f.kind === 'opening')).toBe(true);
    const oven = facesFor('tall', 'oven_cabinet', 30, 84, 'left', 'lattice_band');
    expect(doors(oven)).toHaveLength(1);
    expect(drawers(oven)).toHaveLength(1);
    expect(oven.some((f) => f.kind === 'opening')).toBe(true);
  });
});

describe('doorDesign', () => {
  const inRect = (o: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
    px >= o.x - 1e-9 && px <= o.x + o.w + 1e-9 && py >= o.y - 1e-9 && py <= o.y + o.h + 1e-9;

  it('frames the lattice, its bars at 45° and cut off at the opening', () => {
    const { opening, bars, band } = doorDesign({ w: 15, h: 30 }, 'lattice');
    expect(band).toBeNull();
    expect(opening).toEqual({ x: GLASS_STILE_IN, y: GLASS_STILE_IN, w: 15 - 2 * GLASS_STILE_IN, h: 30 - 2 * GLASS_STILE_IN });
    expect(bars.length).toBeGreaterThan(3);
    for (const [x0, y0, x1, y1] of bars) {
      expect(inRect(opening, x0, y0)).toBe(true);
      expect(inRect(opening, x1, y1)).toBe(true);
      expect(Math.abs(y1 - y0)).toBeCloseTo(Math.abs(x1 - x0));
    }
  });

  it('crosses bars at the opening\'s middle', () => {
    const { opening, bars } = doorDesign({ w: 30, h: 30 }, 'lattice');
    const [cx, cy] = [opening.x + opening.w / 2, opening.y + opening.h / 2];
    const through = bars.filter(([x0, y0, x1, y1]) => Math.abs((y1 - y0) * (cx - x0) - (x1 - x0) * (cy - y0)) < 1e-6);
    expect(through).toHaveLength(2);
  });

  it('keeps diamonds a sensible size: about 7" on a wide panel, never under 3.5"', () => {
    const across = (w: number, h: number) => {
      const { bars } = doorDesign({ w, h }, 'lattice');
      const ups = bars.filter(([x0, y0, x1, y1]) => (y1 - y0) * (x1 - x0) > 0).map(([x0, y0]) => x0 - y0);
      const sorted = [...ups].sort((a, b) => a - b);
      return sorted[1] - sorted[0];
    };
    expect(across(40, 24)).toBeCloseTo(7);
    expect(across(10, 30)).toBeCloseTo(3.5);
    // Wider than the bars, so a diamond is really open.
    expect(across(10, 30) / Math.SQRT2).toBeGreaterThan(LATTICE_BAR_IN);
  });

  it('sets a band of ovals under the lattice, with a diamond between each two', () => {
    const { opening, band } = doorDesign({ w: 34.5, h: 22.5 }, 'lattice_band');
    expect(band).not.toBeNull();
    expect(band!.ovals).toHaveLength(3); // as in the photo: three ovals across a wide panel
    expect(band!.diamonds).toHaveLength(2);
    for (const o of band!.ovals) {
      expect(o.cy + o.ry).toBeLessThan(opening.y);
      expect(o.cy - o.ry).toBeGreaterThan(GLASS_STILE_IN - 1e-9);
      expect(o.cx - o.rx).toBeGreaterThan(GLASS_STILE_IN);
      expect(o.cx + o.rx).toBeLessThan(34.5 - GLASS_STILE_IN);
    }
    // No two cut-outs touch, or the band would fall apart.
    for (const d of band!.diamonds) {
      for (const o of band!.ovals) expect(Math.abs(d.cx - o.cx)).toBeGreaterThan(d.r + o.rx);
    }
    expect(opening.y + opening.h).toBeCloseTo(22.5 - GLASS_STILE_IN);
  });

  it('still fits on a small door', () => {
    const { opening, band, bars } = doorDesign({ w: 7, h: 11 }, 'lattice_band');
    expect(opening.h).toBeGreaterThan(0);
    expect(band!.ovals.length).toBeGreaterThanOrEqual(1);
    expect(band!.diamonds).toHaveLength(band!.ovals.length - 1);
    expect(bars.length).toBeGreaterThan(0);
  });

  it('splits a mullion door\'s opening into a grid of equal panes, two across and four down on a W3042', () => {
    const [door] = doors(facesFor('wall', undefined, 30, 42, 'left', 'mullion'));
    const { opening, bars, band } = doorDesign(door, 'mullion');
    expect(band).toBeNull();
    expect(opening).toEqual({ x: GLASS_STILE_IN, y: GLASS_STILE_IN, w: door.w - 2 * GLASS_STILE_IN, h: door.h - 2 * GLASS_STILE_IN });
    const upright = bars.filter(([x0, , x1]) => x0 === x1);
    const level = bars.filter(([, y0, , y1]) => y0 === y1);
    expect(upright).toHaveLength(1);
    expect(level).toHaveLength(3);
    expect(upright.length + level.length).toBe(bars.length);
    // Each bar runs edge to edge of the opening, and splits it evenly.
    expect(upright[0]).toEqual([opening.x + opening.w / 2, opening.y, opening.x + opening.w / 2, opening.y + opening.h]);
    level.forEach(([x0, y, x1], i) => {
      expect([x0, x1]).toEqual([opening.x, opening.x + opening.w]);
      expect(y).toBeCloseTo(opening.y + (opening.h * (i + 1)) / 4);
    });
    // A 30"-tall upper's door: three down. A narrow door: one across.
    const [short] = doors(facesFor('wall', undefined, 30, 30, 'left', 'mullion'));
    expect(doorDesign(short, 'mullion').bars.filter(([, y0, , y1]) => y0 === y1)).toHaveLength(2);
    const [narrow] = doors(facesFor('wall', undefined, 12, 30, 'left', 'mullion'));
    expect(doorDesign(narrow, 'mullion').bars.filter(([x0, , x1]) => x0 === x1)).toHaveLength(0);
  });

  it('keeps a mullion box\'s doors as they are, unlike a lattice over a band', () => {
    expect(doors(facesFor('wall', undefined, 36, 18, 'left', 'mullion'))).toHaveLength(2);
    expect(doors(facesFor('base', undefined, 36, 34.5, 'left', 'mullion'))).toHaveLength(2);
  });
});

describe('archOutline', () => {
  it('runs across the bottom and over an arched top, staying in its box', () => {
    const pts = archOutline(8, 30);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([8, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(30);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(8 + 1e-9);
      expect(y).toBeLessThanOrEqual(30 + 1e-9);
    }
    // Its top is highest in the middle, and the shoulders start down by the rise.
    const rise = archRiseIn(8, 30);
    expect(rise).toBeCloseTo(1.76);
    expect(pts[2]).toEqual([8, 30 - rise]);
    expect(pts[pts.length - 1][1]).toBeCloseTo(30 - rise);
  });

  it('winds counter-clockwise, as a solid shape expects', () => {
    const pts = archOutline(8, 30);
    let area = 0;
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length];
      area += x * ny - nx * y;
    });
    expect(area).toBeGreaterThan(0);
  });

  it('has a smallest door that still leaves room for its panel, and takes a 30" three-door corner\'s doors on the Front view', () => {
    const inner = ARCH_MIN_DOOR_IN - 2 * Math.min(GLASS_STILE_IN, ARCH_MIN_DOOR_IN / 4);
    expect(inner).toBeGreaterThan(0);
    for (const door of doors(facesFor('wall', 'three_door_corner_wall', 30, 30))) {
      expect(door.w).toBeGreaterThanOrEqual(ARCH_MIN_DOOR_IN);
    }
  });
});

describe('three-door corner and patterns on the plan', () => {
  const PRESETS: PresetCatalog = {
    WTD3642: { width: 36, height: 42, specialty: 'three_door_corner_wall' },
    W3030: { width: 30, height: 30 },
    W4830: { width: 48, height: 30 },
  };
  const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => ({
    code,
    cab_type: 'wall',
    location: 'perimeter',
    width_inches: PRESETS[code].width,
    height_inches: PRESETS[code].height,
    specialty_type: PRESETS[code].specialty ?? null,
    qty: 1,
    ...over,
  });

  it('draws a three-door angle end like the three-door corner at 12" wide: front and cut doors on the Front view', () => {
    expect(cornerKind('three_door_angle_end_wall')).toBe('end_wrap');
    expect(footprintDepthIn('wall', 'three_door_angle_end_wall', 12)).toBe(12);
    const front = doors(facesFor('wall', 'three_door_angle_end_wall', 12, 30, 'left'));
    expect(front).toHaveLength(2);
    // The front door and the cut seen edge-on; the end's door faces sideways, out of view.
    expect(front[0].x + front[0].w).toBeCloseTo(12 - 12 / (1 + Math.SQRT2) - REVEAL_IN / 2);
    for (const door of front) expect(door.w).toBeGreaterThanOrEqual(ARCH_MIN_DOOR_IN);
  });

  it('bends a two-door angle end\'s front once, as Wolf\'s WEC1230D: two faces at 135°, 67.5° off the sides', () => {
    expect(cornerKind('two_door_angle_end_wall')).toBe('bay_end');
    expect(footprintDepthIn('wall', 'two_door_angle_end_wall', 12)).toBe(12);
    const [a, bend, b] = bayFront(12, 12);
    expect(a).toEqual([0, 12]);
    expect(b).toEqual([12, 0]);
    const deg = (u: number[], v: number[]) =>
      (Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))) * 180) / Math.PI;
    const toA = [a[0] - bend[0], a[1] - bend[1]];
    const toB = [b[0] - bend[0], b[1] - bend[1]];
    expect(deg(toA, toB)).toBeCloseTo(135, 6);
    // Off the end that joins the run (running back up x = 0) and off the wall.
    expect(deg([0, -1], [bend[0] - a[0], bend[1] - a[1]])).toBeCloseTo(67.5, 6);
    expect(deg([-1, 0], [bend[0] - b[0], bend[1] - b[1]])).toBeCloseTo(67.5, 6);
    // Two equal faces, a little over Wolf's 9 5/32" doors (theirs net of the frame).
    expect(Math.hypot(toA[0], toA[1])).toBeCloseTo(Math.hypot(toB[0], toB[1]), 9);
    expect(Math.hypot(toA[0], toA[1])).toBeCloseTo(9.18, 2);
  });

  it('shows a two-door angle end\'s two doors on the Front view, foreshortened', () => {
    const bendX = 12 * Math.SQRT1_2;
    const left = doors(facesFor('wall', 'two_door_angle_end_wall', 12, 30, 'left'));
    expect(left).toHaveLength(2);
    expect(left[0].x + left[0].w).toBeCloseTo(bendX - REVEAL_IN / 2);
    expect(left[1].x).toBeCloseTo(bendX + REVEAL_IN / 2);
    expect(left[1].x + left[1].w).toBeCloseTo(12 - REVEAL_IN);
    // Flipped, the narrow one is on the left.
    const right = doors(facesFor('wall', 'two_door_angle_end_wall', 12, 30, 'right')).sort((p, q) => p.x - q.x);
    expect(right[0].x).toBeCloseTo(REVEAL_IN);
    expect(right[0].w).toBeCloseTo(left[1].w);
    expect(right[1].w).toBeCloseTo(left[0].w);
    expect(right[1].x + right[1].w).toBeCloseTo(12 - REVEAL_IN);
  });

  it('gives a wider three-door angle end its extra width in the front door, the cut door unchanged', () => {
    const cut = 12 / (1 + Math.SQRT2);
    for (const w of [15, 18, 21, 24, 27]) {
      const front = doors(facesFor('wall', 'three_door_angle_end_wall', w, 30, 'left'));
      expect(front).toHaveLength(2);
      expect(front[0].x + front[0].w).toBeCloseTo(w - cut - REVEAL_IN / 2);
      expect(front[1].w).toBeCloseTo(cut - 1.5 * REVEAL_IN);
    }
  });

  it('gives a three-door corner an upper\'s 12" depth, its doors wrapping the run end', () => {
    expect(cornerKind('three_door_corner_wall')).toBe('end_wrap');
    expect(footprintDepthIn('wall', 'three_door_corner_wall', 36)).toBe(12);
    const [shape] = reconcileCabinets([], [box('WTD3642')], [], PRESETS, 20)!;
    expect(shape.depth_in).toBe(12);
    expect(shape.width).toBeCloseTo(60);
    expect(shape.height).toBeCloseTo(20);
  });

  it('shrinks a three-door corner saved at the old square footprint to 12" deep, where it was', () => {
    const [placed] = reconcileCabinets([], [box('WTD3642')], [], PRESETS, 20)!;
    const old = { ...placed, x: 140, y: 30, rotation: 0, depth_in: 36, height: 60 };
    const [shape] = reconcileCabinets([old], [box('WTD3642')], [], PRESETS, 20)!;
    expect(shape.depth_in).toBe(12);
    expect(shape.height).toBeCloseTo(20);
    expect([shape.x, shape.y, shape.rotation]).toEqual([140, 30, 0]);
  });

  it('cuts a 12"-deep three-door corner\'s open end so the cut and end doors match', () => {
    const [front, cutStart, cutEnd, back] = wrapFront(36, 12);
    expect(front).toEqual([0, 12]);
    expect(back).toEqual([36, 0]);
    const cutLen = Math.hypot(cutEnd[0] - cutStart[0], cutEnd[1] - cutStart[1]);
    expect(cutLen).toBeCloseTo(cutEnd[1] - back[1]);
    expect(cutLen).toBeCloseTo(7.03, 2);
    // 45°: as far along the wall as out from it.
    expect(cutEnd[0] - cutStart[0]).toBeCloseTo(cutStart[1] - cutEnd[1]);
  });

  it('treats a patterned box as a different cabinet, without changing plain keys', () => {
    expect(boxKey(box('W3030'))).toBe('perimeter|W3030|wall|30x30');
    expect(boxKey(box('W3030', { door_pattern: null }))).toBe('perimeter|W3030|wall|30x30');
    expect(boxKey(box('W3030', { door_pattern: 'lattice' }))).toBe('perimeter|W3030|wall|30x30|lattice');
    expect(boxKey(box('W3030', { door_pattern: 'lattice', has_glass_door: true }))).toBe('perimeter|W3030|wall|30x30|glass|lattice');
  });

  it('gives each of 1 lattice + 1 plain its own shape, and a plain one no pattern in its JSON', () => {
    const out = reconcileCabinets([], [box('W3030', { door_pattern: 'lattice' }), box('W3030')], [], PRESETS, 20)!;
    expect(out.map((c) => c.door_pattern ?? null)).toEqual(['lattice', null]);
    expect(out[1].door_pattern).toBeUndefined();
  });

  it('keeps a shape where it was dragged when its pattern changes', () => {
    const [placed] = reconcileCabinets([], [box('W3030')], [], PRESETS, 20)!;
    const moved = { ...placed, x: 321, y: 123, rotation: 90 };
    const [changed] = reconcileCabinets([moved], [box('W3030', { door_pattern: 'lattice_band' })], [], PRESETS, 20)!;
    expect(changed).toMatchObject({ id: placed.id, x: 321, y: 123, rotation: 90, door_pattern: 'lattice_band' });
    const [back] = reconcileCabinets([changed], [box('W3030')], [], PRESETS, 20)!;
    expect(back).toMatchObject({ id: placed.id, x: 321, y: 123 });
    expect(back.door_pattern).toBeUndefined();
  });

  it('settles: nothing to change once a patterned shape matches its box', () => {
    const boxes = [box('W3030', { door_pattern: 'lattice' }), box('W4830')];
    const first = reconcileCabinets([], boxes, [], PRESETS, 20)!;
    expect(reconcileCabinets(first, boxes, [], PRESETS, 20)).toBeNull();
  });
});
