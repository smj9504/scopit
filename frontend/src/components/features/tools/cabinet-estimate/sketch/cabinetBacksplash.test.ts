import { describe, it, expect } from 'vitest';
import { applianceSolids, cabinetSolids, wallSolids } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import { backsplashLayout, faceKeeps, splashFaceKey, splashOnRun, splashPieces, type SplashChoices } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import { buildCabinetScene } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dScene';
import { buildElevations, pxToIn, type PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';

// 12 px per foot: one pixel is one inch.
const SCALE = 12;
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  RB30S: { width: 30, height: 34.5, specialty: 'range_base_slide_in' },
  W3030: { width: 30, height: 30 },
  T2484: { width: 24, height: 84 },
};

const cab = (id: string, code: string, x: number, y: number, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => {
  const p = PRESETS[code];
  const cabType = code.startsWith('W') ? 'wall' : code.startsWith('T') ? 'tall' : 'base';
  const depth = cabType === 'wall' ? 12 : 24;
  return {
    id,
    preset_code: code,
    cab_type: cabType,
    x,
    y,
    width: p.width,
    height: depth,
    rotation: 0,
    label: code,
    location: 'perimeter',
    width_in: p.width,
    depth_in: depth,
    height_in: p.height,
    ...over,
  };
};

const wall = (id: string, sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
  id,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  color: '#333',
  length_ft: 0,
});

const appliance = (id: string, type: string, x: number, y: number, width: number, over: Partial<CabinetSketchAppliance> = {}): CabinetSketchAppliance => ({
  id,
  type,
  x,
  y,
  width,
  height: 24,
  rotation: 0,
  ...over,
});

// The back wall's face on y = 0, the left side wall's on x = 0.
const BACK = wall('back', -4, -2, 250, -2);
const SIDE = wall('side', -2, -4, -2, 120);

/** B30 · RB30S (range opening) · B30 · B30 from the side wall along the back wall. */
const RUN = [cab('a', 'B30', 0, 0), cab('r', 'RB30S', 30, 0), cab('b', 'B30', 60, 0), cab('c', 'B30', 90, 0)];

const layoutOf = (
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  appliances: CabinetSketchAppliance[] = [],
  choices: SplashChoices = {}
) => {
  const wallModels = wallSolids(walls, SCALE);
  const pieces = splashPieces(
    cabinetSolids(cabinets, PRESETS, SCALE),
    applianceSolids(appliances, cabinets, PRESETS, SCALE),
    wallModels
  );
  return backsplashLayout(pieces, wallModels, choices);
};

/** The face on the left side wall, at the run's end, and the back wall's. */
const SIDE_KEY = () => layoutOf(RUN, [BACK, SIDE]).faces.find((f) => f.key.startsWith('side'))!.key;
const BACK_KEY = () => layoutOf(RUN, [BACK, SIDE]).faces.find((f) => f.key.startsWith('back'))!.key;

describe('backsplashLayout', () => {
  it('runs the tile along the whole run, the 4" splash only where there is a counter, and lists the side wall at its end without', () => {
    const layout = layoutOf(RUN, [BACK, SIDE]);
    // Back wall 120" (range included); the side wall starts without.
    expect(layout.tileIn).toBeCloseTo(120, 6);
    // Not behind the range opening: 30 + 60.
    expect(layout.counterIn).toBeCloseTo(90, 6);
    const back = layout.faces.find((f) => f.key.startsWith('back'))!;
    expect(back.tile).toHaveLength(1);
    expect(back.counter.map((s) => Math.round(s.lengthIn))).toEqual([30, 60]);
    expect(back).toMatchObject({ back: true, off: false });
    const side = layout.faces.find((f) => f.key.startsWith('side'))!;
    // Measured all the same (the end base's 24" depth), so ticking it on adds that.
    expect(side).toMatchObject({ back: false, off: true, ownerIds: ['a'] });
    expect(side.tileIn).toBeCloseTo(24, 6);
    // Laid on the wall's face, turned to the counter.
    expect(back.tile[0].a[1]).toBeCloseTo(0, 6);
    expect(back.tile[0].normal[1]).toBeCloseTo(1, 6);
  });

  it('counts a range in its range base once, and a dishwasher at the wall with both splashes', () => {
    const appliances = [
      appliance('range', 'range_gas_slide', 30, 0, 30, { host_id: 'r' }),
      appliance('dw', 'dishwasher', 120, 0, 24),
    ];
    const layout = layoutOf(RUN, [BACK, SIDE], appliances);
    expect(layout.tileIn).toBeCloseTo(120 + 24, 6);
    expect(layout.counterIn).toBeCloseTo(90 + 24, 6);
  });

  it('gives an island, a base off the wall, an upper and a tall none', () => {
    const cabinets = [
      cab('i', 'B30', 40, 80, { location: 'island' }),
      cab('p', 'B30', 150, 60),
      cab('u', 'W3030', 0, 0),
      cab('t', 'T2484', 200, 0),
    ];
    const layout = layoutOf(cabinets, [BACK, SIDE]);
    expect(layout.tileIn).toBe(0);
    expect(layout.faces).toHaveLength(0);
  });

  it('with no walls drawn, takes each base\'s back as on its wall', () => {
    const layout = layoutOf(RUN, []);
    expect(layout.tileIn).toBeCloseTo(120, 6);
    expect(layout.counterIn).toBeCloseTo(90, 6);
  });

  it('runs a turned run along its own wall', () => {
    // A run backed onto a right-hand wall (face x = 200), turned a quarter.
    const right = wall('right', 202, -4, 202, 200);
    const turned = [cab('q', 'B30', 200, 40, { rotation: 90 }), cab('s', 'B30', 200, 70, { rotation: 90 })];
    const layout = layoutOf(turned, [right]);
    expect(layout.tileIn).toBeCloseTo(60, 6);
    expect(layout.faces).toHaveLength(1);
    expect(layout.faces[0].tile[0].normal[0]).toBeCloseTo(-1, 6);
  });
});

describe('splashOnRun', () => {
  it('puts the back wall\'s stretches into the Front view\'s run, the side wall\'s not', () => {
    const walls = [BACK, SIDE];
    const layout = layoutOf(RUN, walls);
    const [run] = buildElevations(RUN, walls, PRESETS, SCALE);
    const onRun = splashOnRun(run, layout, (px) => pxToIn(px, SCALE));
    const left = run.items[0].left_in;
    expect(onRun.tile).toHaveLength(1);
    expect(onRun.tile[0][0]).toBeCloseTo(left, 6);
    expect(onRun.tile[0][1]).toBeCloseTo(left + 120, 6);
    expect(onRun.counter.map(([l, r]) => [Math.round(l - left), Math.round(r - left)])).toEqual([
      [0, 30],
      [60, 120],
    ]);
  });

  it('gives an island run none', () => {
    const island = [cab('i', 'B30', 40, 80, { location: 'island' })];
    const layout = layoutOf([...RUN, ...island], [BACK, SIDE]);
    const islandRun = buildElevations([...RUN, ...island], [BACK, SIDE], PRESETS, SCALE).find((r) => r.island)!;
    expect(splashOnRun(islandRun, layout, (px) => pxToIn(px, SCALE))).toEqual({ tile: [], counter: [] });
  });
});

describe('a face with or without backsplash', () => {
  const walls = [BACK, SIDE];
  const sideKey = SIDE_KEY;

  it('names a face by its wall and which side of it, as splashFaceKey does', () => {
    const layout = layoutOf(RUN, walls);
    expect(layout.faces.map((f) => f.key).sort()).toEqual([expect.stringMatching(/^back:-?1$/), expect.stringMatching(/^side:-?1$/)]);
    // The end base's side against the side wall, the counter toward the run.
    expect(splashFaceKey([0, 0], [0, 24], [15, 12], wallSolids(walls, SCALE))).toBe(sideKey());
    expect(splashFaceKey([0, 0], [0, 0.2], [15, 12], wallSolids(walls, SCALE))).toBeNull();
  });

  it("counts the side wall at the run's end once it is ticked on", () => {
    const layout = layoutOf(RUN, walls, [], { on: [sideKey()] });
    expect(layout.faces.find((f) => f.key === sideKey())).toMatchObject({ off: false, back: false });
    expect(layout.tileIn).toBeCloseTo(144, 6);
    expect(layout.counterIn).toBeCloseTo(114, 6);
    // Left off again, it is off again (and a key for no face changes nothing).
    expect(layoutOf(RUN, walls, [], { off: [sideKey()], on: ['gone:1'] }).tileIn).toBeCloseTo(120, 6);
  });

  it("leaves the Front view's run without it when the back wall is left off", () => {
    const layout = layoutOf(RUN, walls, [], { off: [BACK_KEY()], on: [sideKey()] });
    const [run] = buildElevations(RUN, walls, PRESETS, SCALE);
    const onRun = splashOnRun(run, layout, (px) => pxToIn(px, SCALE));
    expect(onRun).toEqual({ tile: [], counter: [] });
    expect(layout.tileIn).toBeCloseTo(24, 6);
  });

  it('is built in 3D only where it is', () => {
    const wallModels = wallSolids(walls, SCALE);
    const solids = cabinetSolids(RUN, PRESETS, SCALE);
    const meshesOfA = (choices: SplashChoices) => {
      const root = buildCabinetScene(solids, wallModels, new Set(), {
        backsplash: { tileIn: 18, counter: true, faces: faceKeeps(layoutOf(RUN, walls, [], choices)) },
      });
      const group = root.children.find((c) => c.userData.cabinetId === 'a')!;
      let n = 0;
      group.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) n += 1;
      });
      return n;
    };
    // The end base: tile and 4" strip on its back, and on its end once that is ticked on.
    const backOnly = meshesOfA({});
    expect(meshesOfA({ on: [sideKey()] })).toBe(backOnly + 2);
    expect(meshesOfA({ off: [BACK_KEY()] })).toBe(backOnly - 2);
  });
});

describe('a face that stops short of an end', () => {
  const walls = [BACK, SIDE];

  it('cuts the back wall\'s tile and 4" splash from its left and right ends as you face it', () => {
    // Facing the back wall, its left end is at the side wall's corner (x = 0).
    const layout = layoutOf(RUN, walls, [], { trim: { [BACK_KEY()]: [10, 20] } });
    const back = layout.faces.find((f) => f.key === BACK_KEY())!;
    expect(back.trim).toEqual([10, 20]);
    expect(back.wholeIn).toBeCloseTo(120, 6);
    expect(back.tileIn).toBeCloseTo(90, 6);
    expect(back.tile[0].a[0]).toBeCloseTo(10, 6);
    expect(back.tile[0].b[0]).toBeCloseTo(100, 6);
    // The 4" one: 10..30 and 60..100.
    expect(back.counter.map((s) => [Math.round(s.a[0]), Math.round(s.b[0])])).toEqual([
      [10, 30],
      [60, 100],
    ]);
    expect(layout.tileIn).toBeCloseTo(90, 6);
    expect(layout.counterIn).toBeCloseTo(60, 6);
    // The uncut stretches stay, for the plan to show what was left out.
    expect(back.uncut.tile[0].lengthIn).toBeCloseTo(120, 6);
  });

  it('takes left and right as you face a side wall too', () => {
    // Facing the left side wall from the counter, its left end is toward the room (y = 24), its right at the back wall.
    const layout = layoutOf(RUN, walls, [], { on: [SIDE_KEY()], trim: { [SIDE_KEY()]: [0, 6] } });
    const side = layout.faces.find((f) => f.key === SIDE_KEY())!;
    expect(side.tileIn).toBeCloseTo(18, 6);
    const ys = [side.tile[0].a[1], side.tile[0].b[1]].sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(6, 6);
    expect(ys[1]).toBeCloseTo(24, 6);
  });

  it('ignores a trim it cannot read, and drops a face cut back to nothing', () => {
    const odd = layoutOf(RUN, walls, [], { trim: { [BACK_KEY()]: [-5, Number.NaN] } });
    expect(odd.tileIn).toBeCloseTo(120, 6);
    const gone = layoutOf(RUN, walls, [], { trim: { [BACK_KEY()]: [70, 60] } });
    expect(gone.tileIn).toBe(0);
    expect(gone.faces.find((f) => f.key === BACK_KEY())!.tile).toEqual([]);
  });

  it('stops short in the Front view and in 3D', () => {
    const layout = layoutOf(RUN, walls, [], { trim: { [BACK_KEY()]: [10, 0] } });
    const [run] = buildElevations(RUN, walls, PRESETS, SCALE);
    const onRun = splashOnRun(run, layout, (px) => pxToIn(px, SCALE));
    const left = run.items[0].left_in;
    expect(onRun.tile[0][0] - left).toBeCloseTo(10, 6);
    expect(onRun.tile[0][1] - left).toBeCloseTo(120, 6);

    const wallModels = wallSolids(walls, SCALE);
    const solids = cabinetSolids(RUN, PRESETS, SCALE);
    const widthsOfA = (choices: SplashChoices) => {
      const root = buildCabinetScene(solids, wallModels, new Set(), {
        backsplash: { tileIn: 18, counter: true, faces: faceKeeps(layoutOf(RUN, walls, [], choices)) },
      });
      const group = root.children.find((c) => c.userData.cabinetId === 'a')!;
      const widths: number[] = [];
      group.traverse((o) => {
        const g = (o as { geometry?: { type?: string; parameters?: { width: number } } }).geometry;
        if (g?.type === 'BoxGeometry' && g.parameters) widths.push(Math.round(g.parameters.width));
      });
      return widths;
    };
    const count = (list: number[], w: number) => list.filter((x) => x === w).length;
    // The end base's tile and 4" strip run 20" of its 30" back; cut past it, it has none.
    expect(count(widthsOfA({ trim: { [BACK_KEY()]: [10, 0] } }), 20) - count(widthsOfA({}), 20)).toBe(2);
    expect(widthsOfA({ trim: { [BACK_KEY()]: [30, 0] } }).length).toBe(widthsOfA({}).length - 2);
  });
});
