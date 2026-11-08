import { describe, it, expect } from 'vitest';
import { takeoffTrim, type TrimCounts } from '@/components/features/tools/cabinet-estimate/sketch/cabinetTrimTakeoff';
import { snapCabinetToNeighbors, type PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import type { CabType } from '@/types/cabinetEstimate';

// 12 px per foot, so a pixel is an inch.
const SCALE = 12;
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  B15: { width: 15, height: 34.5 },
  W3030: { width: 30, height: 30 },
  T2484: { width: 24, height: 84 },
  LS36: { width: 36, height: 34.5, specialty: 'lazy_susan' },
  BBC42: { width: 42, height: 34.5, specialty: 'blind_corner' },
  BEC24: { width: 24, height: 34.5, specialty: 'angle_end_base' },
  WRD36: { width: 36, height: 24, specialty: 'refrigerator_wall_deep' },
};

const TYPE_OF: Record<string, CabType> = { W3030: 'wall', WRD36: 'wall', T2484: 'tall' };
let seq = 0;

/**
 * A cabinet by its back-left corner, in inches. Rotation 0 backs it onto
 * a wall at the top of the plan; -90 onto a wall on the left, its run
 * going up the plan from (x, y).
 */
const cab = (code: string, x: number, y: number, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => {
  const p = PRESETS[code];
  const cabType = TYPE_OF[code] ?? 'base';
  const depth = p.specialty === 'lazy_susan' ? p.width : cabType === 'wall' && code !== 'WRD36' ? 12 : 24;
  return {
    id: `${code}-${seq++}`,
    preset_code: code,
    cab_type: cabType,
    x,
    y,
    width: p.width,
    height: depth,
    rotation: 0,
    label: code,
    location: 'perimeter',
    ...over,
  };
};

/** A wall by the face cabinets stand against: thickness 4, its centreline 2" outside the room. */
const wallH = (y: number, x0: number, x1: number): CabinetSketchWall => ({
  id: `h${y}${x0}${x1}`,
  start_x: x0,
  start_y: y - 2,
  end_x: x1,
  end_y: y - 2,
  thickness: 4,
  color: '#333',
  length_ft: (x1 - x0) / 12,
});
const wallV = (x: number, y0: number, y1: number, outside: 'left' | 'right' = 'left'): CabinetSketchWall => {
  const cx = outside === 'left' ? x - 2 : x + 2;
  return { id: `v${x}${y0}${y1}`, start_x: cx, start_y: y0, end_x: cx, end_y: y1, thickness: 4, color: '#333', length_ft: (y1 - y0) / 12 };
};

const dw = (x: number, y: number, over: Partial<CabinetSketchAppliance> = {}): CabinetSketchAppliance => ({
  id: `dw-${seq++}`,
  type: 'dishwasher',
  x,
  y,
  width: 24,
  height: 24,
  rotation: 0,
  host_id: null,
  ...over,
});

const counts = (
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  appliances: CabinetSketchAppliance[] = []
): TrimCounts => takeoffTrim(cabinets, appliances, walls, PRESETS, SCALE).counts;

const only = (c: Partial<TrimCounts>): TrimCounts => ({
  filler_count: 0,
  end_panel_base: 0,
  end_panel_wall: 0,
  end_panel_tall: 0,
  end_panel_refrigerator: 0,
  dishwasher_return_panel_count: 0,
  ...c,
});

// A north wall along the top and a west wall down the left, meeting at (0, 0).
const corner = [wallH(0, 0, 240), wallV(0, 0, 240)];

describe('takeoffTrim', () => {
  it('takes up a run that fills the wall with one filler, at each height', () => {
    // Wall to wall: one filler takes up the slack, the other end is scribed tight.
    const walls = [wallH(0, 0, 120), wallV(0, 0, 60), wallV(120, 0, 60, 'right')];
    const run = [0, 30, 60, 90].flatMap((x) => [cab('B30', x, 0), cab('W3030', x, 0)]);
    expect(counts(run, walls)).toEqual(only({ filler_count: 2 }));
    // A single cabinet in a niche just wider than it: one filler, base and upper alike.
    const niche = [wallH(0, 0, 32), wallV(0, 0, 60), wallV(32, 0, 60, 'right')];
    expect(counts([cab('B30', 1, 0), cab('W3030', 1, 0)], niche)).toEqual(only({ filler_count: 2 }));
    // Runs that each meet one wall keep their own filler.
    expect(counts([cab('B30', 0, 0), cab('B30', 90, 0)], walls)).toEqual(only({ filler_count: 2, end_panel_base: 2 }));
    // So do the two runs of an L joined by a lazy susan: each ends at its own wall.
    // A wall across the foot of the west leg (which runs y 36-66 off the lazy susan).
    const foot: CabinetSketchWall = { id: 'foot', start_x: -4, start_y: 68, end_x: 30, end_y: 68, thickness: 4, color: '#333', length_ft: 34 / 12 };
    const ell = [wallH(0, 0, 96), wallV(0, 0, 96), wallV(96, 0, 30, 'right'), foot];
    const legs = [cab('LS36', 0, 0), cab('B30', 36, 0), cab('B30', 66, 0), cab('B30', 0, 66, { rotation: -90 })];
    expect(counts(legs, ell).filler_count).toBe(2);
  });

  it('never puts a panel on an end with a wall near it', () => {
    // Drawn 10" short of the east wall: a filler takes up the gap, no panel, base or upper.
    // The bases run wall to wall, so that one filler is theirs; the west end is scribed tight.
    const east = [...corner, wallV(130, 0, 240, 'right')];
    const short = [...[0, 30, 60, 90].map((x) => cab('B30', x, 0)), cab('W3030', 60, 0), cab('W3030', 90, 0)];
    expect(counts(short, east)).toEqual(only({ filler_count: 2, end_panel_wall: 1 }));
    // A side wall that covers only the back 6" of the end still closes it.
    const stub = [wallH(0, 0, 240), wallV(0, 0, 6)];
    expect(counts([cab('B30', 0, 0)], stub)).toEqual(only({ filler_count: 1, end_panel_base: 1 }));
    // Drawn 3" into the side wall: still against it.
    expect(counts([cab('B30', -3, 0), cab('W3030', -3, 0)], corner)).toEqual(only({ filler_count: 2, end_panel_base: 1, end_panel_wall: 1 }));
    // An angled side wall beside the end closes it too.
    const angled = [wallH(0, 0, 240), { ...wallV(0, 0, 60), start_x: -2, start_y: 0, end_x: -40, end_y: 40 }];
    expect(counts([cab('B30', 0, 0)], angled)).toEqual(only({ filler_count: 1, end_panel_base: 1 }));
    // A tall, a fridge opening and a dishwasher against the wall take no panel either.
    expect(counts([cab('T2484', 4, 0)], corner)).toEqual(only({ filler_count: 1, end_panel_tall: 1 }));
    expect(counts([cab('WRD36', 5, 0), cab('B30', 41, 0)], corner).end_panel_refrigerator).toBe(1);
    expect(counts([cab('B30', 32, 0)], corner, [dw(8, 0)]).dishwasher_return_panel_count).toBe(1);
  });

  it('does not take the wall behind the run for one beside its ends', () => {
    // Pushed 2" into the wall behind it, with no side walls: both ends are open.
    expect(counts([cab('B30', 60, -2), cab('W3030', 60, -2)], [wallH(0, 0, 240)])).toEqual(only({ end_panel_base: 2, end_panel_wall: 2 }));
    // An upper 18" short of the side wall shows its side.
    expect(counts([cab('W3030', 18, 0)], corner).end_panel_wall).toBe(2);
  });

  it('finishes a run end that stops in open space', () => {
    const run = [cab('B30', 0, 0), cab('B30', 30, 0), cab('B30', 60, 0), cab('W3030', 0, 0), cab('W3030', 30, 0)];
    const out = takeoffTrim(run, [], corner, PRESETS, SCALE);
    expect(out.counts).toEqual(only({ filler_count: 2, end_panel_base: 1, end_panel_wall: 1 }));
    expect(out.items.find((i) => i.field === 'end_panel_base')).toMatchObject({ where: 'North wall · B30, right end', why: 'open end' });
  });

  it('reads a gap in the run as an appliance opening, but not a doorway', () => {
    // A 30" range opening between two bases: neither side shows.
    expect(counts([cab('B30', 0, 0), cab('B30', 60, 0)], corner)).toEqual(only({ filler_count: 1, end_panel_base: 1 }));
    // A 36" doorway in the wall between them: both sides show.
    const doorway = [wallH(0, 0, 30), wallH(0, 66, 240), wallV(0, 0, 240)];
    expect(counts([cab('B30', 0, 0), cab('B30', 66, 0)], doorway)).toEqual(only({ filler_count: 1, end_panel_base: 3 }));
    // A refrigerator's width between the run's end and the wall it ends at: no panel, no filler.
    expect(counts([cab('B30', 36, 0), cab('B30', 66, 0)], corner)).toEqual(only({ end_panel_base: 1 }));
  });

  it('puts one filler in a dead corner, none at the hidden end against the wall', () => {
    const north = [cab('B30', 0, 0), cab('B30', 30, 0)];
    // Backed onto the west wall, its run going down from y = 24 to 54; its top end meets the north run's doors.
    const west = cab('B30', 0, 54, { rotation: -90 });
    const out = takeoffTrim([...north, west], [], corner, PRESETS, SCALE);
    expect(out.counts).toEqual(only({ filler_count: 1, end_panel_base: 2 }));
    expect(out.items.find((i) => i.field === 'filler_count')?.why).toBe('inside corner');
  });

  it('puts one filler at a blind corner', () => {
    const plan = [cab('BBC42', 0, 0), cab('B30', 42, 0), cab('B30', 0, 54, { rotation: -90 })];
    expect(counts(plan, corner)).toEqual(only({ filler_count: 1, end_panel_base: 2 }));
  });

  it('needs no filler at a lazy susan, whose legs meet the runs end to end', () => {
    const plan = [cab('LS36', 0, 0), cab('B30', 36, 0), cab('B30', 0, 66, { rotation: -90 })];
    expect(counts(plan, corner)).toEqual(only({ end_panel_base: 2 }));
  });

  it('finishes a tall beside the counter, where it shows above it', () => {
    const plan = [cab('T2484', 0, 0), cab('B30', 24, 0)];
    const out = takeoffTrim(plan, [], corner, PRESETS, SCALE);
    expect(out.counts).toEqual(only({ filler_count: 1, end_panel_tall: 1, end_panel_base: 1 }));
    // Two talls side by side hide each other.
    expect(counts([cab('T2484', 0, 0), cab('T2484', 24, 0)], corner)).toEqual(only({ filler_count: 1, end_panel_tall: 1 }));
  });

  it('puts a deep panel on each open side of a refrigerator opening', () => {
    // Fridge against the west wall under its deep upper, the counter run beside it.
    const plan = [cab('WRD36', 0, 0), cab('B30', 36, 0), cab('W3030', 36, 0)];
    expect(counts(plan, corner)).toEqual(only({ end_panel_refrigerator: 1, end_panel_base: 1, end_panel_wall: 1 }));
    // In the middle of a run: one each side. A pantry beside it closes that side.
    const mid = [cab('B30', 0, 0), cab('WRD36', 30, 0), cab('B30', 66, 0)];
    expect(counts(mid, corner).end_panel_refrigerator).toBe(2);
    expect(counts([cab('T2484', 0, 0), cab('WRD36', 24, 0)], corner).end_panel_refrigerator).toBe(1);
  });

  it('puts a return panel on a dishwasher against the wall, and none on one not yet placed', () => {
    const plan = [cab('B30', 24, 0), cab('B30', 54, 0)];
    expect(counts(plan, corner, [dw(0, 0)])).toEqual(only({ dishwasher_return_panel_count: 1, end_panel_base: 1 }));
    // At the open end of the run.
    expect(counts([cab('B30', 0, 0)], corner, [dw(30, 0)])).toEqual(only({ filler_count: 1, dishwasher_return_panel_count: 1 }));
    // Still in the row under the drawing.
    expect(counts(plan, corner, [dw(0, 120)]).dishwasher_return_panel_count).toBe(0);
  });

  it('leaves the island to its own end panels', () => {
    const island = [cab('B30', 60, 90, { location: 'island' }), cab('B30', 90, 90, { location: 'island' })];
    expect(counts(island, corner, [dw(120, 90)])).toEqual(only({}));
  });

  it('leaves an angled joint to Angled Joints', () => {
    const a = cab('B30', 0, 0);
    const side = cab('B30', 0, 0, { rotation: 45 });
    // Dropped by the B30's right end, it joins at its front corner: the wedge opens at the backs.
    const joined = { ...side, ...snapCabinetToNeighbors({ ...side, x: 46, y: 7 }, [a], SCALE)! };
    expect(joined.x).toBeCloseTo(30 + 24 * Math.SQRT1_2);
    // Only the two far ends: the west wall's filler, and the open end of the turned one.
    expect(counts([a, joined], corner)).toEqual(only({ filler_count: 1, end_panel_base: 1 }));
  });

  it('finishes a peninsula end across a walkway from a wall', () => {
    // Backed onto nothing, its end 42" short of the east wall.
    const walls = [...corner, wallV(162, 0, 240, 'right')];
    expect(counts([cab('B30', 60, 100), cab('B30', 90, 100)], walls)).toEqual(only({ end_panel_base: 2 }));
  });
});
