import { describe, it, expect } from 'vitest';
import {
  cabinetSolids,
  islandFillerSolids,
  islandTopSlabs,
  mainFacing,
  modelBounds,
  toPlan,
  wallSolids,
  type CabinetSolid,
  type FrontRun,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import { reconcileCabinets, snapCabinetToNeighbors, type PresetCatalog, type SketchBoxSource } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';

const SCALE = 20; // px per foot
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  W3030: { width: 30, height: 30 },
  T2484: { width: 24, height: 84 },
  RB30S: { width: 30, height: 34.5, specialty: 'range_base_slide_in' },
  LS36: { width: 36, height: 34.5, specialty: 'lazy_susan' },
  DCB36: { width: 36, height: 34.5, specialty: 'diagonal_corner_base' },
  WDC24: { width: 24, height: 30, specialty: 'diagonal_corner_wall' },
  BEC24: { width: 24, height: 34.5, specialty: 'angle_end_base' },
  WEA1230: { width: 12, height: 30, specialty: 'angle_end_wall' },
  WEA3D1230: { width: 12, height: 30, specialty: 'three_door_angle_end_wall' },
  WEA2D1230: { width: 12, height: 30, specialty: 'two_door_angle_end_wall' },
  BBC42: { width: 42, height: 34.5, specialty: 'blind_corner' },
  WTD3642: { width: 36, height: 42, specialty: 'three_door_corner_wall' },
  W4830: { width: 48, height: 30 },
  B48: { width: 48, height: 34.5 },
};

const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => {
  const p = PRESETS[code];
  return {
    code,
    cab_type: code.startsWith('W') ? 'wall' : code.startsWith('T') ? 'tall' : 'base',
    location: 'perimeter',
    width_inches: p.width,
    height_inches: p.height,
    specialty_type: p.specialty ?? null,
    qty: 1,
    ...over,
  };
};

/** Each code as a sketch shape, laid out the way the sync lays out the Edit tab. */
const shapes = (...codes: string[]): CabinetSketchCabinet[] =>
  reconcileCabinets([], codes.map((c) => box(c)), [], PRESETS, SCALE)!;

const solidsOf = (cabinets: CabinetSketchCabinet[]) => cabinetSolids(cabinets, PRESETS, SCALE);

const centroid = (s: CabinetSolid) => {
  const n = s.outline.length;
  return s.outline.reduce(([x, z], [px, pz]) => [x + px / n, z + pz / n], [0, 0]);
};
const runLength = (run: FrontRun) => Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
const outward = (run: FrontRun) => {
  const len = runLength(run);
  return [-(run.b[1] - run.a[1]) / len, (run.b[0] - run.a[0]) / len];
};

describe('cabinetSolids', () => {
  it('stands a base on the floor under a countertop, and hangs an upper at 54"', () => {
    const [base, upper] = solidsOf(shapes('B30', 'W3030'));
    expect(base).toMatchObject({ bottom: 0, height: 34.5, toeKick: 4, appliance: false });
    expect(base.counter).toEqual([[0, 0], [30, 0], [30, 25], [0, 25]]); // 1" past the doors
    expect(base.fronts).toHaveLength(1);
    expect(base.fronts[0]).toMatchObject({ a: [0, 24], b: [30, 24] });
    expect(upper).toMatchObject({ bottom: 54, height: 30, toeKick: 0, counter: null });
    expect(upper.fronts[0]).toMatchObject({ a: [0, 12], b: [30, 12] });
  });

  it('places the cabinet at its plan position in inches', () => {
    const [b30] = shapes('B30');
    const [solid] = solidsOf([{ ...b30, x: 100, y: 60, rotation: 90 }]);
    expect(solid).toMatchObject({ x: 60, z: 36, rotation: 90 });
    // Turned a quarter clockwise on screen, its run heads down the screen and its doors face left.
    const [ex, ez] = toPlan(solid, [30, 0]);
    expect(ex).toBeCloseTo(60);
    expect(ez).toBeCloseTo(66);
    const [fx, fz] = toPlan(solid, [0, 24]);
    expect(fx).toBeCloseTo(36);
    expect(fz).toBeCloseTo(36);
  });

  it('draws a range as an appliance level with the counters, with no counter or toe kick', () => {
    const [range] = solidsOf(shapes('RB30S'));
    expect(range).toMatchObject({ appliance: true, height: 36, counter: null, toeKick: 0 });
  });

  it('gives a tall no countertop', () => {
    const [tall] = solidsOf(shapes('T2484'));
    expect(tall.counter).toBeNull();
    expect(tall.toeKick).toBe(4);
  });

  it('gives a lazy susan a door on the inside of each leg', () => {
    const [left] = solidsOf(shapes('LS36'));
    expect(left.outline).toHaveLength(6);
    expect(left.fronts.map((r) => [r.a, r.b])).toEqual([
      [[0, 24], [36, 24]],
      [[24, 36], [24, 24]],
    ]);
    // One door on each leg, across its 12" opening.
    for (const run of left.fronts) {
      const doors = run.faces.filter((f) => f.kind === 'door');
      expect(doors).toHaveLength(1);
    }
    expect(left.fronts[1].faces[0].x).toBeGreaterThanOrEqual(0);
    expect(left.fronts[1].faces[0].x + left.fronts[1].faces[0].w).toBeLessThanOrEqual(12);
  });

  it('puts every front on the outside of its cabinet, on either corner side', () => {
    const cabinets = shapes('B30', 'BBC42', 'LS36', 'DCB36', 'WDC24', 'BEC24', 'WEA1230', 'WTD3642');
    const both = [...cabinets, ...cabinets.map((c) => ({ ...c, id: `${c.id}-r`, corner_side: 'right' as const }))];
    for (const solid of solidsOf(both)) {
      const [cx, cz] = centroid(solid);
      for (const run of solid.fronts) {
        const [nx, nz] = outward(run);
        const mid = [(run.a[0] + run.b[0]) / 2, (run.a[1] + run.b[1]) / 2];
        expect(nx * (mid[0] - cx) + nz * (mid[1] - cz)).toBeGreaterThan(0);
        // And its faces fit on it.
        const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
        for (const f of run.faces) {
          expect(f.x).toBeGreaterThanOrEqual(-1e-9);
          expect(f.x + f.w).toBeLessThanOrEqual(len + 1e-9);
        }
      }
    }
  });

  it('stretches a diagonal corner\'s door across its angled face', () => {
    const [dcb] = solidsOf(shapes('DCB36'));
    expect(dcb.fronts).toHaveLength(1);
    const run = dcb.fronts[0];
    const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
    expect(len).toBeCloseTo(12 * Math.SQRT2);
    const door = run.faces.find((f) => f.kind === 'door')!;
    expect(door.w).toBeGreaterThan(12); // wider than the 12" it covers on the Front view
  });

  it('marks a corner unit\'s side leg as a back, like its own back, on either corner side', () => {
    const [plain] = solidsOf(shapes('W3030'));
    expect(plain.backs).toEqual([true, false, false, false]);
    const [wdc] = solidsOf(shapes('WDC24'));
    // back, run end, angled face, leg end, leg back
    expect(wdc.backs).toEqual([true, false, false, false, true]);
    const [wdcRight] = solidsOf(shapes('WDC24').map((c) => ({ ...c, corner_side: 'right' as const })));
    const legBack = wdcRight.outline.findIndex((a, i) => {
      const b = wdcRight.outline[(i + 1) % wdcRight.outline.length];
      return a[0] === 24 && b[0] === 24;
    });
    expect(wdcRight.backs.filter(Boolean)).toHaveLength(2);
    expect(wdcRight.backs[legBack]).toBe(true);
    const [ls] = solidsOf(shapes('LS36'));
    expect(ls.backs).toEqual([true, false, false, false, false, true]);
    // An angle end's full-depth end joins the run; it is no back.
    const [wea] = solidsOf(shapes('WEA1230'));
    expect(wea.backs).toEqual([true, false, false]);
  });

  it('hangs a 12" angle end upper as a triangle with one door across its 45° cut', () => {
    const [left] = solidsOf(shapes('WEA1230'));
    expect(left).toMatchObject({ bottom: 54, height: 30, toeKick: 0, counter: null });
    // Full 12" deep at the end that joins the run, cut back to a point at the open end.
    expect(left.outline).toEqual([[0, 0], [12, 0], [0, 12]]);
    expect(left.fronts).toHaveLength(1);
    expect(left.fronts[0]).toMatchObject({ a: [0, 12], b: [12, 0] });
    expect(runLength(left.fronts[0])).toBeCloseTo(12 * Math.SQRT2); // a 17" face
    expect(left.fronts[0].faces.filter((f) => f.kind === 'door')).toHaveLength(1);
    // Flipped, the full-depth end is on the right.
    const [right] = solidsOf(shapes('WEA1230').map((c) => ({ ...c, corner_side: 'right' as const })));
    expect(right.outline).toEqual([[12, 0], [0, 0], [12, 12]]);
  });

  it('gives a three-door angle end the same 12" x 12" run end, a door on its front, its 45° cut and its end', () => {
    const [left] = solidsOf(shapes('WEA3D1230'));
    const [right] = solidsOf(shapes('WEA3D1230').map((c) => ({ ...c, corner_side: 'right' as const })));
    // The cut sized so all three faces come out the same, about 7".
    const face = 12 - 12 / (1 + Math.SQRT2);
    for (const solid of [left, right]) {
      expect(solid).toMatchObject({ bottom: 54, height: 30, toeKick: 0, counter: null });
      expect(solid.fronts).toHaveLength(3);
      for (const run of solid.fronts) {
        expect(runLength(run)).toBeCloseTo(face, 6);
        expect(run.faces.map((f) => f.kind)).toEqual(['door']);
      }
      expect(solid.fronts[0].b).toEqual(solid.fronts[1].a);
      expect(solid.fronts[1].b).toEqual(solid.fronts[2].a);
      for (const [x, z] of solid.outline) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(12 + 1e-9);
        expect(z).toBeGreaterThanOrEqual(-1e-9);
        expect(z).toBeLessThanOrEqual(12 + 1e-9);
      }
    }
    // The one-door angle end beside it keeps its single door on the cut.
    expect(solidsOf(shapes('WEA1230'))[0].fronts).toHaveLength(1);
  });

  it('hangs a two-door angle end with its front bent once, a door on each face, their pulls at the bend', () => {
    const [left] = solidsOf(shapes('WEA2D1230'));
    const [right] = solidsOf(shapes('WEA2D1230').map((c) => ({ ...c, corner_side: 'right' as const })));
    const s = 12 * Math.SQRT1_2;
    expect(left.outline).toEqual([[0, 0], [12, 0], [s, s], [0, 12]]);
    expect(right.outline).toEqual([[12, 0], [0, 0], [12 - s, s], [12, 12]]);
    for (const solid of [left, right]) {
      expect(solid).toMatchObject({ bottom: 54, height: 30, toeKick: 0, counter: null });
      expect(solid.backs).toEqual([true, false, false, false]);
      expect(solid.fronts).toHaveLength(2);
      expect(solid.fronts[0].b).toEqual(solid.fronts[1].a);
      expect(solid.fronts.map((r) => r.faces.map((f) => [f.kind, f.pull]))).toEqual([
        [['door', 'right']],
        [['door', 'left']],
      ]);
      for (const run of solid.fronts) expect(runLength(run)).toBeCloseTo(12 / (Math.sin((67.5 * Math.PI) / 180) + Math.cos((67.5 * Math.PI) / 180)), 6);
    }
  });

  it('marks a glass-door cabinet', () => {
    const [upper] = solidsOf(shapes('W3030').map((c) => ({ ...c, has_glass_door: true })));
    expect(upper.glass).toBe(true);
  });

  it('gives a three-door corner an upper\'s 12" depth, a door on its front, its 45° cut and its end', () => {
    const cut = 12 / (1 + Math.SQRT2);
    const [left] = solidsOf(shapes('WTD3642'));
    const [right] = solidsOf(shapes('WTD3642').map((c) => ({ ...c, corner_side: 'right' as const })));
    for (const solid of [left, right]) {
      expect(solid.fronts).toHaveLength(3);
      for (const run of solid.fronts) {
        expect(run.faces).toHaveLength(1);
        expect(run.faces[0].kind).toBe('door');
        expect(run.faces[0].w).toBeCloseTo(runLength(run) - 1.5, 2);
        expect(run.faces[0].h).toBeCloseTo(42 - 1.5, 2);
      }
      // One run into the next: the wrap has no gaps.
      expect(solid.fronts[0].b).toEqual(solid.fronts[1].a);
      expect(solid.fronts[1].b).toEqual(solid.fronts[2].a);
      // No deeper than any other upper, and 36" along the wall.
      expect(solid.outline).toHaveLength(5);
      for (const [x, z] of solid.outline) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(36 + 1e-9);
        expect(z).toBeGreaterThanOrEqual(-1e-9);
        expect(z).toBeLessThanOrEqual(12 + 1e-9);
      }
    }
    // Left: front, cut, end, the wrap at the right end; right: mirrored.
    const [front, cutRun, end] = left.fronts;
    expect(front.a).toEqual([0, 12]);
    expect(runLength(front)).toBeCloseTo(36 - cut);
    expect(outward(front)).toEqual([-0, 1]);
    const [cx, cz] = outward(cutRun);
    expect(cx).toBeCloseTo(Math.SQRT1_2);
    expect(cz).toBeCloseTo(Math.SQRT1_2);
    expect(runLength(cutRun)).toBeCloseTo(runLength(end));
    expect(end.b).toEqual([36, 0]);
    expect(outward(end)[0]).toBeCloseTo(1);
    expect(right.fronts[0].a).toEqual([0, 0]);
    expect(outward(right.fronts[0])[0]).toBeCloseTo(-1);
    expect(right.fronts[2].b).toEqual([36, 12]);
    // Pulls: the front and cut doors meet at their joint, the end door's toward them.
    expect(left.fronts.map((r) => r.faces[0].pull)).toEqual(['right', 'left', 'left']);
    expect(right.fronts.map((r) => r.faces[0].pull)).toEqual(['right', 'right', 'left']);
  });

  it('carries the door pattern, and draws a wide box with its doors at a sensible width', () => {
    const [wide] = solidsOf(shapes('W4830'));
    expect(wide.doorPattern).toBeNull();
    expect(wide.fronts[0].faces.filter((f) => f.kind === 'door')).toHaveLength(2);
    const [base] = solidsOf(shapes('B48'));
    expect(base.fronts[0].faces.filter((f) => f.kind === 'door')).toHaveLength(2);
    expect(base.fronts[0].faces.filter((f) => f.kind === 'drawer')).toHaveLength(2);
    expect(base.outline[1][0]).toBe(48);
    const [band] = solidsOf(shapes('W4830').map((c) => ({ ...c, door_pattern: 'lattice_band' as const })));
    expect(band.doorPattern).toBe('lattice_band');
    expect(band.fronts[0].faces.filter((f) => f.kind === 'door')).toHaveLength(1);
  });
});

describe('island top and fillers', () => {
  // Plan shapes at 20 px/ft: a 30" x 24" base is 50 x 40 px.
  const isle = (id: string, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => ({
    id,
    preset_code: 'B30',
    cab_type: 'base',
    x: 40,
    y: 40,
    width: 50,
    height: 40,
    rotation: 0,
    label: id,
    location: 'island',
    ...over,
  });
  const span = (pts: [number, number][], i: 0 | 1) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]));

  it('lays one top over the island, 1.5" past every edge, instead of a counter per cabinet', () => {
    const solids = solidsOf([isle('a'), isle('b', { x: 90 })]);
    expect(solids.every((s) => s.counter === null)).toBe(true);
    const [top, ...rest] = islandTopSlabs(solids, SCALE);
    expect(rest).toHaveLength(0);
    expect(top.outline).toHaveLength(4);
    expect(span(top.outline, 0)).toBeCloseTo(63);
    expect(span(top.outline, 1)).toBeCloseTo(27);
    expect(top).toMatchObject({ bottom: 34.5, holes: [] });
    // With a 12" seating overhang behind the backs.
    expect(span(islandTopSlabs(solids, SCALE, 12)[0].outline, 1)).toBeCloseTo(37.5);
    // Perimeter cabinets keep their own counters and have no island top.
    const perimeter = solidsOf([isle('p', { location: 'perimeter' })]);
    expect(perimeter[0].counter).not.toBeNull();
    expect(islandTopSlabs(perimeter, SCALE)).toEqual([]);
  });

  it('cuts a range in the island out of the top', () => {
    const solids = solidsOf([isle('a'), isle('range', { x: 90, preset_code: 'RB30S' }), isle('b', { x: 140 })]);
    const [top] = islandTopSlabs(solids, SCALE);
    expect(top.holes).toHaveLength(1);
    expect(span(top.holes[0], 0)).toBeCloseTo(30);
    expect(span(top.holes[0], 1)).toBeCloseTo(24);
  });

  it('closes each angled joint with a filler over a set-back toe kick', () => {
    const a = isle('a');
    const side = isle('side', { rotation: -45 });
    const joined = { ...side, ...snapCabinetToNeighbors({ ...side, x: 93, y: 42 }, [a], SCALE)! };
    const solids = solidsOf([a, joined]);
    const [filler, ...rest] = islandFillerSolids(solids, SCALE);
    expect(rest).toHaveLength(0);
    expect(filler).toMatchObject({ height: 34.5, toeKick: 4 });
    // Hinged at the backs' shared corner, out to the two front corners 24" away; the toe kick 3" short of them.
    const [hinge, ...outer] = filler.outline;
    for (const [x, z] of outer) expect(Math.hypot(x - hinge[0], z - hinge[1])).toBeCloseTo(24);
    for (const [x, z] of filler.toeOutline!.slice(1)) expect(Math.hypot(x - hinge[0], z - hinge[1])).toBeCloseTo(21);
    // The top covers the joint in one piece.
    expect(islandTopSlabs(solids, SCALE)).toHaveLength(1);
  });
});

describe('wallSolids / modelBounds / mainFacing', () => {
  const wall = (sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
    id: `w${sx}${sy}${ex}${ey}`,
    start_x: sx,
    start_y: sy,
    end_x: ex,
    end_y: ey,
    thickness: 4,
    color: '#333',
    length_ft: 0,
  });

  it('converts walls to inches and skips zero-length ones', () => {
    const out = wallSolids([wall(0, 0, 200, 0), wall(10, 10, 10, 10)], SCALE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: [0, 0], b: [120, 0] });
    expect(out[0].thickness).toBeCloseTo(2.4);
  });

  it('spans the cabinets and walls', () => {
    const solids = solidsOf(shapes('B30'));
    expect(modelBounds(solids, wallSolids([wall(0, 0, 200, 0)], SCALE))).toEqual({
      minX: 0,
      maxX: 120,
      minZ: 0,
      maxZ: 48, // the B30 at (2 ft, 2 ft), 24" deep
    });
    expect(modelBounds([], [])).toBeNull();
  });

  it('faces the way most of the doors do', () => {
    const cabinets = shapes('B30', 'B30', 'W3030');
    expect(mainFacing(solidsOf(cabinets))).toEqual([0, 1]);
    const turned = cabinets.map((c) => ({ ...c, rotation: 180 }));
    const [fx, fz] = mainFacing(solidsOf(turned));
    expect(fx).toBeCloseTo(0);
    expect(fz).toBeCloseTo(-1);
  });
});
