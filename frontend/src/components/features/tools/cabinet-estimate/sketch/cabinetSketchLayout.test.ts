import { describe, it, expect } from 'vitest';
import {
  boxKey,
  buildElevations,
  cabinetKey,
  cornerFootprint,
  mountHeightsIn,
  perimeterAnchor,
  reconcileCabinets,
  snapCabinetToNeighbors,
  snapCabinetToWall,
  snapDroppedCabinet,
  turnCabinets,
  countAngledJoints,
  islandJointFillers,
  islandTopAreaSf,
  islandTopPieces,
  layoutIslandSides,
  polygonUnion,
  signedArea2,
  type PresetCatalog,
  type SketchBoxSource,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';

const SCALE = 20; // px per foot
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  B15: { width: 15, height: 34.5 },
  SB36: { width: 36, height: 34.5, specialty: 'sink_base' },
  W3030: { width: 30, height: 30 },
  W3015: { width: 30, height: 15 },
  W3036: { width: 30, height: 36 },
  W2430: { width: 24, height: 30 },
  W2436: { width: 24, height: 36 },
  T2484: { width: 24, height: 84 },
  LS36: { width: 36, height: 34.5, specialty: 'lazy_susan' },
  BBC42: { width: 42, height: 34.5, specialty: 'blind_corner' },
  DCB36: { width: 36, height: 34.5, specialty: 'diagonal_corner_base' },
  BEC24: { width: 24, height: 34.5, specialty: 'angle_end_base' },
};

const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => {
  const p = PRESETS[code];
  const cabType = code.startsWith('W') ? 'wall' : code.startsWith('T') ? 'tall' : 'base';
  return {
    code,
    cab_type: cabType,
    location: 'perimeter',
    width_inches: p?.width ?? 24,
    height_inches: p?.height ?? 34.5,
    specialty_type: p?.specialty ?? null,
    qty: 1,
    ...over,
  };
};

const wall = (sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
  id: `w${sx}${sy}${ex}${ey}`,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  color: '#333',
  length_ft: Math.hypot(ex - sx, ey - sy) / SCALE,
});

describe('reconcileCabinets', () => {
  it('creates one shape per box × qty, laid out in a run', () => {
    const out = reconcileCabinets([], [box('B30', { qty: 2 }), box('B15')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(3);
    // 30" = 50 px at 20 px/ft; run starts at (2 ft, 2 ft) = (40, 40)
    expect(out.map((c) => c.x)).toEqual([40, 90, 140]);
    expect(out.every((c) => c.y === 40 && c.rotation === 0)).toBe(true);
    // Footprint depth is the 24" base depth, not the 34.5" height
    expect(out[0].height).toBeCloseTo(40);
    expect(out[0]).toMatchObject({ width_in: 30, depth_in: 24, height_in: 34.5, location: 'perimeter' });
  });

  it('puts talls after the bases and uppers on the same back line', () => {
    const out = reconcileCabinets(
      [],
      [box('T2484'), box('B30'), box('W3030')],
      [],
      PRESETS,
      SCALE
    )!;
    const byCode = Object.fromEntries(out.map((c) => [c.preset_code, c]));
    expect(byCode.B30.x).toBe(40);
    expect(byCode.T2484.x).toBe(90);
    expect(byCode.W3030.x).toBe(40);
    expect(byCode.W3030.y).toBe(40);
    expect(byCode.W3030.height).toBeCloseTo(20); // 12" deep
  });

  it('returns null when the sketch already matches the boxes', () => {
    const boxes = [box('B30'), box('W3030')];
    const first = reconcileCabinets([], boxes, [], PRESETS, SCALE)!;
    expect(reconcileCabinets(first, boxes, [], PRESETS, SCALE)).toBeNull();
  });

  it('keeps moved shapes where they are and drops the ones whose box is gone', () => {
    const first = reconcileCabinets([], [box('B30', { qty: 2 }), box('B15')], [], PRESETS, SCALE)!;
    const moved = first.map((c, i) => (i === 0 ? { ...c, x: 300, y: 300 } : c));
    const out = reconcileCabinets(moved, [box('B30')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: first[0].id, x: 300, y: 300 });
  });

  it('appends a newly added box after the existing run', () => {
    const first = reconcileCabinets([], [box('B30')], [], PRESETS, SCALE)!;
    const out = reconcileCabinets(first, [box('B30'), box('SB36')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ preset_code: 'SB36', x: 90, y: 40 });
  });

  it('places island boxes on a parallel run 66" in front of the perimeter', () => {
    const out = reconcileCabinets([], [box('B30'), box('B30', { location: 'island' })], [], PRESETS, SCALE)!;
    const island = out.find((c) => c.location === 'island')!;
    expect(island.x).toBe(40);
    expect(island.y).toBeCloseTo(40 + 110); // 66" = 5.5 ft = 110 px
  });

  it('upgrades shapes saved before the sync (no inch fields, height-as-depth)', () => {
    const legacy: CabinetSketchCabinet = {
      id: 'old',
      preset_code: 'B30',
      cab_type: 'base',
      x: 10,
      y: 10,
      width: 50,
      height: 57.5, // 34.5" used as depth
      rotation: 0,
      label: 'B30',
    };
    const out = reconcileCabinets([legacy], [box('B30')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'old', x: 10, y: 10, location: 'perimeter', depth_in: 24 });
    expect(out[0].height).toBeCloseTo(40);
  });

  it('keeps a moved cabinet where it is when its box is changed in the Edit tab', () => {
    const first = reconcileCabinets([], [box('B30'), box('B15')], [], PRESETS, SCALE)!;
    const moved = first.map((c, i) => (i === 0 ? { ...c, x: 300, y: 300, rotation: 90 } : c));
    // The B30 row is switched to a sink base.
    const out = reconcileCabinets(moved, [box('SB36'), box('B15')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: first[0].id, preset_code: 'SB36', label: 'SB36', x: 300, y: 300, rotation: 90 });
    expect(out[0].width).toBeCloseTo(60); // resized to 36"
  });

  it("doesn't hand an upper's place to a floor cabinet", () => {
    const first = reconcileCabinets([], [box('B30'), box('W3030')], [], PRESETS, SCALE)!;
    const moved = first.map((c) => (c.preset_code === 'W3030' ? { ...c, x: 300, y: 300 } : c));
    // The upper is removed and a base added at the same time.
    const out = reconcileCabinets(moved, [box('B30'), box('B15')], [], PRESETS, SCALE)!;
    expect(out.map((c) => c.preset_code)).toEqual(['B30', 'B15']);
    expect(out[1]).toMatchObject({ x: 90, y: 40 }); // appended after the B30, not at the upper's spot
  });

  it('shapes a diagonal corner base like its wall twin, and an angle end as a plain-depth box', () => {
    const [dcb] = reconcileCabinets([], [box('DCB36')], [], PRESETS, SCALE)!;
    expect(dcb.depth_in).toBe(36); // 36" along each wall
    expect(cornerFootprint(dcb, PRESETS, SCALE)).toMatchObject({ kind: 'diagonal', leg: 40 });
    const [bec] = reconcileCabinets([], [box('BEC24')], [], PRESETS, SCALE)!;
    expect(bec.depth_in).toBe(24); // full depth at the end that joins the run
    expect(cornerFootprint(bec, PRESETS, SCALE)).toMatchObject({ kind: 'angle_end', side: 'left' });
  });

  it('gives an L corner unit a footprint as deep as it is wide', () => {
    const [ls] = reconcileCabinets([], [box('LS36')], [], PRESETS, SCALE)!;
    expect(ls).toMatchObject({ width_in: 36, depth_in: 36 });
    expect(ls.height).toBeCloseTo(60);
    expect(cornerFootprint(ls, PRESETS, SCALE)).toMatchObject({ kind: 'l', side: 'left', leg: 40 });
    const [bbc] = reconcileCabinets([], [box('BBC42')], [], PRESETS, SCALE)!;
    expect(bbc.depth_in).toBe(24); // a blind corner stays a plain box…
    expect(cornerFootprint({ ...bbc, corner_side: 'right' }, PRESETS, SCALE)).toMatchObject({
      kind: 'blind',
      side: 'right',
      blind: 40, // …with its 24" covered end
    });
  });

  it('treats a custom box of a different size as a different cabinet', () => {
    expect(boxKey(box('CUSTOM', { width_inches: 20 }))).not.toBe(boxKey(box('CUSTOM', { width_inches: 22 })));
  });

  it('leaves a cabinet switched on the sketch, with its box, where it is', () => {
    const first = reconcileCabinets([], [box('B30', { qty: 2 })], [], PRESETS, SCALE)!;
    // As the sketch's picker does it: the second B30 becomes an SB36 in place,
    // and the Edit tab splits one off its B30 × 2 row.
    const switched = first.map((c, i) =>
      i === 1 ? { ...c, preset_code: 'SB36', label: 'SB36', width_in: 36, width: 60, x: 400 } : c
    );
    const boxes = [box('B30'), box('SB36')];
    expect(reconcileCabinets(switched, boxes, [], PRESETS, SCALE)).toBeNull();
  });

  it('marks the shape of a glass-door box, one shape per glass / plain box', () => {
    const boxes = [box('W3030', { has_glass_door: true }), box('W3030')];
    const out = reconcileCabinets([], boxes, [], PRESETS, SCALE)!;
    expect(out.map((c) => !!c.has_glass_door)).toEqual([true, false]);
    expect(out[1].has_glass_door).toBeUndefined();
    expect(reconcileCabinets(out, boxes, [], PRESETS, SCALE)).toBeNull();
    // Deleting the glass shape on the canvas takes the glass box off the Edit tab.
    expect(cabinetKey(out[0], PRESETS, SCALE)).toBe(boxKey(boxes[0]));
    expect(cabinetKey(out[1], PRESETS, SCALE)).toBe(boxKey(boxes[1]));
  });

  it('keeps each cabinet in place when glass is toggled in the Edit tab', () => {
    const first = reconcileCabinets([], [box('W3030'), box('W3015'), box('B30')], [], PRESETS, SCALE)!;
    const idOf = (code: string) => first.find((c) => c.preset_code === code)!.id;
    const moved = first.map((c) => (c.preset_code === 'W3030' ? { ...c, x: 300, y: 300 } : c));
    // Both uppers turned to glass, listed in the other order: each still finds its own shape.
    const glass = { has_glass_door: true };
    const on = reconcileCabinets(
      moved,
      [box('W3015', glass), box('W3030', glass), box('B30')],
      [],
      PRESETS,
      SCALE
    )!;
    expect(on.find((c) => c.preset_code === 'W3030')).toMatchObject({ id: idOf('W3030'), x: 300, y: 300, ...glass });
    expect(on.find((c) => c.preset_code === 'W3015')).toMatchObject({ id: idOf('W3015'), x: 90, ...glass });
    const off = reconcileCabinets(on, [box('W3030'), box('W3015'), box('B30')], [], PRESETS, SCALE)!;
    expect(off.find((c) => c.preset_code === 'W3030')).toMatchObject({ id: idOf('W3030'), x: 300, y: 300 });
    expect(off.every((c) => !c.has_glass_door)).toBe(true);
  });

  it('keeps every upper in place when a new Tier switches their height', () => {
    const first = reconcileCabinets([], [box('W2430'), box('W3030')], [], PRESETS, SCALE)!;
    const idOf = (code: string) => first.find((c) => c.preset_code === code)!.id;
    const moved = first.map((c) => (c.preset_code === 'W3030' ? { ...c, x: 300, y: 300 } : c));
    // Listed in the other order, so a first-come match would swap their places.
    const out = reconcileCabinets(moved, [box('W3036'), box('W2436')], [], PRESETS, SCALE)!;
    expect(out.find((c) => c.preset_code === 'W3036')).toMatchObject({ id: idOf('W3030'), x: 300, y: 300, height_in: 36 });
    expect(out.find((c) => c.preset_code === 'W2436')).toMatchObject({ id: idOf('W2430'), height_in: 36 });
  });
});

describe('perimeterAnchor', () => {
  it('runs along the inside face of the longest wall', () => {
    // A 10 ft × 8 ft room; the top wall (y = 0) is the longest.
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const a = perimeterAnchor(walls, SCALE);
    expect(a.back.y).toBeCloseTo(-1); // backs to the top wall
    expect(a.origin.x).toBeCloseTo(0);
    expect(a.origin.y).toBeCloseTo(2); // inset by half the 4 px thickness
  });
});

describe('snapCabinetToWall', () => {
  it('turns a cabinet dropped by a vertical wall to back onto it', () => {
    const walls = [wall(100, 0, 100, 200)];
    // 30" × 24" cabinet, unrotated, dropped just right of the wall.
    const snapped = snapCabinetToWall({ x: 110, y: 80, width: 50, height: 40, rotation: 0 }, walls, SCALE)!;
    expect(snapped).not.toBeNull();
    // Back must point west, at the wall: back = (sin r, -cos r) = (-1, 0) → r = 270°.
    expect(((snapped.rotation % 360) + 360) % 360).toBeCloseTo(270);
    // Back-left corner sits on the wall's right face (x = 102).
    expect(snapped.x).toBeCloseTo(102);
  });

  it('ignores walls that are far away', () => {
    expect(snapCabinetToWall({ x: 400, y: 400, width: 50, height: 40, rotation: 0 }, [wall(0, 0, 0, 100)], SCALE)).toBeNull();
  });
});

describe('snapCabinetToNeighbors', () => {
  // A B30 backed at y = 40: occupies x 40–90, 40 px (24") deep.
  const b30 = (over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => ({
    id: 'b30',
    preset_code: 'B30',
    cab_type: 'base',
    x: 40,
    y: 40,
    width: 50,
    height: 40,
    rotation: 0,
    label: 'B30',
    ...over,
  });
  // An 18" base (30 px wide).
  const b18 = (x: number, y: number, over: Partial<CabinetSketchCabinet> = {}) => ({
    id: 'b18',
    cab_type: 'base' as const,
    x,
    y,
    width: 30,
    height: 40,
    rotation: 0,
    ...over,
  });

  it('levels a cabinet dropped a little low and butts it against the right side', () => {
    // 4 px (2.4") off the side, 15 px (9") lower than the B30.
    expect(snapCabinetToNeighbors(b18(94, 55), [b30()], SCALE)).toEqual({ x: 90, y: 40, rotation: 0 });
  });

  it('butts against the left side, pushing out of a small overlap', () => {
    expect(snapCabinetToNeighbors(b18(7, 35), [b30()], SCALE)).toMatchObject({ x: 10, y: 40 });
    expect(snapCabinetToNeighbors(b18(85, 40), [b30()], SCALE)).toMatchObject({ x: 90, y: 40 });
  });

  it('squares up a slightly turned cabinet to its neighbour', () => {
    const snapped = snapCabinetToNeighbors(b18(92, 42, { rotation: 5 }), [b30()], SCALE)!;
    expect(snapped.rotation).toBe(0);
    expect(snapped.x).toBeCloseTo(90);
    expect(snapped.y).toBeCloseTo(40);
  });

  it('works along a rotated run', () => {
    // Run along a vertical line, cabinets advancing down the screen (rotation 90).
    const n = b30({ x: 100, y: 40, rotation: 90 });
    const snapped = snapCabinetToNeighbors(b18(103, 95, { rotation: 90 }), [n], SCALE)!;
    expect(snapped.x).toBeCloseTo(100);
    expect(snapped.y).toBeCloseTo(90);
  });

  it('leaves alone a cabinet set in front, a gap away, or of the other row', () => {
    expect(snapCabinetToNeighbors(b18(90, 80), [b30()], SCALE)).toBeNull(); // 24" in front
    expect(snapCabinetToNeighbors(b18(110, 40), [b30()], SCALE)).toBeNull(); // 12" gap
    expect(snapCabinetToNeighbors(b18(92, 40, { cab_type: 'wall' }), [b30()], SCALE)).toBeNull(); // upper by a base
    expect(snapCabinetToNeighbors(b18(92, 40, { rotation: 90 }), [b30()], SCALE)).toBeNull(); // turned 90°
  });

  it('squares an upper over a base: backs level, ends flush', () => {
    // A 30" upper (12" deep) dropped a little off the B30 below it.
    const upper = b18(44, 46, { cab_type: 'wall', width: 50, height: 20 });
    expect(snapCabinetToNeighbors(upper, [b30()], SCALE)).toMatchObject({ x: 40, y: 40 });
    // A narrower 18" upper nearer the B30's right end lines up with that end.
    expect(snapCabinetToNeighbors(b18(62, 43, { cab_type: 'wall', height: 20 }), [b30()], SCALE)).toMatchObject({
      x: 60,
      y: 40,
    });
  });

  it('squares a base under an upper the same way', () => {
    const upper = b30({ id: 'w', cab_type: 'wall', height: 20 });
    expect(snapCabinetToNeighbors(b18(43, 47), [upper], SCALE)).toMatchObject({ x: 40, y: 40 });
  });

  it('butts uppers and bases against a tall, which spans both heights', () => {
    const tall = b30({ id: 't', cab_type: 'tall' });
    expect(snapCabinetToNeighbors(b18(94, 42, { cab_type: 'wall', height: 20 }), [tall], SCALE)).toMatchObject({
      x: 90,
      y: 40,
    });
    expect(snapCabinetToNeighbors(b18(94, 42), [tall], SCALE)).toMatchObject({ x: 90, y: 40 });
  });

  it('closes an L: a cabinet at a right angle sets against the front, flush with the end', () => {
    // Backed west (rotation 270), 18" wide, in front of the B30's left end (x 40-80, y 80-110).
    expect(snapCabinetToNeighbors(b18(43, 113, { rotation: 270 }), [b30()], SCALE)).toMatchObject({
      x: 40,
      y: 110,
      rotation: 270,
    });
  });

  it("butts a cabinet at a right angle against a run's end, outside faces flush", () => {
    // The end of a three-sided island: backed east (rotation 90), past the B30's right end.
    expect(snapCabinetToNeighbors(b18(133, 43, { rotation: 90 }), [b30()], SCALE)).toMatchObject({
      x: 130,
      y: 40,
      rotation: 90,
    });
  });

  it('sets a two-sided island back to back, ends flush', () => {
    const behind = b18(93, 37, { width: 50, rotation: 180 });
    expect(snapCabinetToNeighbors(behind, [b30()], SCALE)).toMatchObject({ x: 90, y: 40, rotation: 180 });
  });

  it('joins an angled run end to end at the inside corner of the turn', () => {
    // Turned 45° toward the B30's front: the front corners meet at (90, 80), the wedge opens at the back.
    const toFront = snapCabinetToNeighbors(b18(121, 54, { rotation: 45 }), [b30()], SCALE)!;
    expect(toFront.rotation).toBe(45);
    expect(toFront.x).toBeCloseTo(90 + 40 * Math.SQRT1_2);
    expect(toFront.y).toBeCloseTo(80 - 40 * Math.SQRT1_2);
    // Turned 45° toward its back: the back corners meet at (90, 40).
    const toBack = snapCabinetToNeighbors(b18(93, 42, { rotation: -45 }), [b30()], SCALE)!;
    expect(toBack.rotation).toBe(-45);
    expect(toBack.x).toBeCloseTo(90);
    expect(toBack.y).toBeCloseTo(40);
    // Too far from either end: left where it was dropped.
    expect(snapCabinetToNeighbors(b18(140, 60, { rotation: 45 }), [b30()], SCALE)).toBeNull();
  });

  it('turns a run by any angle and counts the angled joints it makes', () => {
    const a = b30();
    const [turned] = turnCabinets([b18(0, 0, { id: 'side' })], 45);
    expect(turned.rotation).toBe(45);
    // Joined to the B30's right end at 45°, toward its front: one angled joint.
    const side = { ...b30({ id: 'side', width: 30 }), rotation: 45 };
    const joined = snapCabinetToNeighbors({ ...side, x: 121, y: 54 }, [a], SCALE)!;
    const plan = [a, { ...side, ...joined }];
    expect(countAngledJoints(plan, SCALE)).toBe(1);
    // Pulled a foot away, or squared up, it is no angled joint.
    expect(countAngledJoints([a, { ...side, ...joined, x: joined.x + 20 }], SCALE)).toBe(0);
    expect(countAngledJoints([a, b30({ id: 'next', x: 90 })], SCALE)).toBe(0);
  });

  it('measures an island top with its edge and seating overhangs', () => {
    const isle = (over: Partial<CabinetSketchCabinet> = {}) => b30({ location: 'island', ...over });
    // One B30: (30 + 2 x 1.5) x (24 + 1.5 + 1.5) = 33" x 27" = 6.19 SF.
    expect(islandTopAreaSf(islandTopPieces([isle()], SCALE), SCALE)).toBeCloseTo(6.2, 1);
    // A 12" seating overhang behind it: 33" x 37.5" = 8.59 SF.
    expect(islandTopAreaSf(islandTopPieces([isle()], SCALE, 12), SCALE)).toBeCloseTo(8.6, 1);
    // Back to back: one top 33" x (48 + 2 x 1.5) = 11.69 SF; each row's seating strip lies over the other.
    const pair = [isle(), isle({ id: 'back', x: 90, y: 40, rotation: 180 })];
    expect(islandTopAreaSf(islandTopPieces(pair, SCALE, 12), SCALE)).toBeCloseTo(11.7, 1);
    const pairTop = polygonUnion(islandTopPieces(pair, SCALE, 12));
    expect(pairTop).toHaveLength(1);
    expect(pairTop[0]).toHaveLength(4);
    // Perimeter cabinets have no island top.
    expect(islandTopPieces([b30()], SCALE)).toEqual([]);
  });

  it('fills the wedge an angled island joint leaves, so the top is one piece', () => {
    const a = b30({ location: 'island' });
    const side = { ...b30({ id: 'side', width: 30, location: 'island' }), rotation: 45 };
    const joined = { ...side, ...snapCabinetToNeighbors({ ...side, x: 121, y: 54 }, [a], SCALE)! };
    const pieces = islandTopPieces([a, joined], SCALE);
    expect(pieces).toHaveLength(3); // two cabinets + the wedge
    const withWedge = islandTopAreaSf(pieces, SCALE);
    const without = islandTopAreaSf(pieces.slice(0, 2), SCALE);
    expect(withWedge).toBeGreaterThan(without);
  });

  it('outlines an angled island as one top, with a filler in each joint', () => {
    // B36, a 24" base turned 45° toward its back, and a B36 turned a quarter: backs on the inside of the bend.
    const a = b30({ location: 'island', width: 60 });
    const mid = { ...b30({ id: 'mid', width: 40, location: 'island' }), rotation: -45 };
    const midJoined = { ...mid, ...snapCabinetToNeighbors({ ...mid, x: 93, y: 42 }, [a], SCALE)! };
    const end = { ...b30({ id: 'end', width: 60, location: 'island' }), rotation: -90 };
    const endJoined = { ...end, ...snapCabinetToNeighbors({ ...end, x: 119, y: 12 }, [a, midJoined], SCALE)! };
    const plan = [a, midJoined, endJoined];
    expect(countAngledJoints(plan, SCALE)).toBe(2);

    const pieces = islandTopPieces(plan, SCALE);
    const outline = polygonUnion(pieces);
    expect(outline).toHaveLength(1);
    // The outline encloses what the sampled measure counts.
    const sf = signedArea2(outline[0]) / 2 / (SCALE * SCALE);
    expect(sf).toBeCloseTo(islandTopAreaSf(pieces, SCALE), 0);

    const fillers = islandJointFillers(plan, SCALE);
    expect(fillers).toHaveLength(2);
    for (const { wedge, atFront } of fillers) {
      expect(atFront).toBe(true);
      expect(Math.abs(signedArea2(wedge))).toBeGreaterThan(1);
    }
    // Perimeter runs and square joints get none.
    expect(islandJointFillers(plan.map((c) => ({ ...c, location: 'perimeter' as const })), SCALE)).toEqual([]);
    expect(islandJointFillers([a, b30({ id: 'next', x: 100, location: 'island' })], SCALE)).toEqual([]);
  });

  it('turns a selected run as one piece, so it stays joined', () => {
    const [a, b] = [b30(), b30({ id: 'b2', x: 90 })];
    const [ta, tb] = turnCabinets([a, b], 90);
    expect(ta.rotation).toBe(90);
    // Turned about the middle of the pair (90, 60): now one above the other on x 70-110, backs east.
    expect([ta.x, ta.y, tb.x, tb.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([110, 10, 110, 60]);
  });

  it('picks the closer of two neighbours', () => {
    const right = b30({ id: 'r', x: 130 });
    expect(snapCabinetToNeighbors(b18(92, 40), [b30(), right], SCALE)).toMatchObject({ x: 90 });
    expect(snapCabinetToNeighbors(b18(98, 40), [b30(), right], SCALE)).toMatchObject({ x: 100 });
  });

  it('backs onto a wall first, then butts against the cabinet already on it', () => {
    // Vertical wall at x = 100 (face x = 102); a B30 backed onto it, running up from y = 140.
    const walls = [wall(100, 0, 100, 200)];
    const onWall = b30({ x: 102, y: 140, rotation: 270 });
    const placed = snapDroppedCabinet(b18(110, 50, { width: 25 }), [onWall], walls, SCALE);
    expect(placed.rotation).toBe(270);
    expect(placed.x).toBeCloseTo(102);
    expect(placed.y).toBeCloseTo(90);
  });

  it('keeps the drop as is when nothing is close', () => {
    expect(snapDroppedCabinet(b18(300, 300), [b30()], [], SCALE)).toEqual({ x: 300, y: 300, rotation: 0 });
  });
});

describe('mountHeightsIn', () => {
  it('hangs 30" uppers at 54" and tops short uppers to match', () => {
    const cabs = reconcileCabinets([], [box('B30'), box('W3030'), box('W3015')], [], PRESETS, SCALE)!;
    const m = mountHeightsIn(cabs, PRESETS, SCALE);
    const id = (code: string) => cabs.find((c) => c.preset_code === code)!.id;
    expect(m.get(id('B30'))).toBe(0);
    expect(m.get(id('W3030'))).toBe(54);
    expect(m.get(id('W3015'))).toBe(84 - 15);
  });
});

describe('buildElevations', () => {
  it('draws the perimeter and the island as separate elevations', () => {
    const cabs = reconcileCabinets(
      [],
      [box('B30'), box('SB36'), box('W3030'), box('B30', { location: 'island' })],
      [],
      PRESETS,
      SCALE
    )!;
    const runs = buildElevations(cabs, [], PRESETS, SCALE);
    expect(runs.map((r) => r.label)).toEqual(['North wall', 'Island']);
    const north = runs[0];
    expect(north.length_in).toBeCloseTo(66);
    const sink = north.items.find((i) => i.cabinet.preset_code === 'SB36')!;
    expect(sink.left_in).toBeCloseTo(30);
    const upper = north.items.find((i) => i.cabinet.preset_code === 'W3030')!;
    expect(upper.bottom_in).toBe(54);
  });

  it('names each side of a three-sided island for the way it faces', () => {
    const island = (id: string, x: number, y: number, rotation: number): CabinetSketchCabinet => ({
      id,
      preset_code: 'B30',
      cab_type: 'base',
      x,
      y,
      width: 50,
      height: 40,
      rotation,
      label: 'B30',
      location: 'island',
    });
    const runs = buildElevations(
      [
        island('front', 40, 200, 0), // doors south
        island('left', 0, 150, 90), // backed east: doors west
        island('right', 130, 200, 270), // backed west: doors east
      ],
      [],
      PRESETS,
      SCALE
    );
    expect(runs.map((r) => r.label).sort()).toEqual([
      'Island – East side',
      'Island – South side',
      'Island – West side',
    ]);
  });

  it('calls a run standing in front of another an island, not a second wall', () => {
    // All perimeter in the Edit tab, but the second B30 was dragged 4 ft out into the room.
    const [a, b] = reconcileCabinets([], [box('B30', { qty: 2 })], [], PRESETS, SCALE)!;
    const runs = buildElevations([a, { ...b, x: 40, y: 120 }], [], PRESETS, SCALE);
    expect(runs.map((r) => r.label)).toEqual(['North wall', 'Island']);
    expect(runs.map((r) => r.island)).toEqual([false, true]);
  });

  it('draws no wall behind an island in a walled room', () => {
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const cabs = reconcileCabinets([], [box('B30'), box('B30', { location: 'island' })], walls, PRESETS, SCALE)!;
    const runs = buildElevations(cabs, walls, PRESETS, SCALE);
    const island = runs.find((r) => r.island)!;
    expect(island.label).toBe('Island');
    expect(island.wall).toBeUndefined();
    expect(island.length_in).toBeCloseTo(30);
  });

  it('extends the elevation to the wall the run backs onto', () => {
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const cabs = reconcileCabinets([], [box('B30')], walls, PRESETS, SCALE)!;
    const [run] = buildElevations(cabs, walls, PRESETS, SCALE);
    expect(run.label).toBe('North wall');
    expect(run.length_in).toBeCloseTo(120); // the 10 ft wall
    expect(run.wall).toBeDefined();
  });
});

describe('island with cabinets on both sides', () => {
  // A B30 of the island (50 x 40 px at 20 px/ft), backed north unless turned.
  const isle = (id: string, x: number, y: number, rotation = 0, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => ({
    id,
    preset_code: 'B30',
    cab_type: 'base',
    location: 'island',
    x,
    y,
    width: 50,
    height: 40,
    rotation,
    label: 'B30',
    ...over,
  });
  const poses = (cabs: CabinetSketchCabinet[]) =>
    Object.fromEntries(cabs.map((c) => [c.id, [Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100, c.rotation]]));
  // One row on the usual island line (66" = 110 px in front of the default run at y = 40), x 40 to 240.
  const row = [isle('a', 40, 150), isle('b', 90, 150), isle('c', 140, 150), isle('d', 190, 150)];

  it('places new island cabinets on the shorter of two back-to-back sides', () => {
    const out = reconcileCabinets(
      [],
      [box('B30'), box('B30', { location: 'island', qty: 4 })],
      [],
      PRESETS,
      SCALE,
      { islandTwoSided: true }
    )!;
    const island = out.filter((c) => c.location === 'island');
    // The first goes a depth (24" = 40 px) out from the usual line; the one behind it takes that line,
    // turned half round, its back on the first's; then they alternate, both sides started at x = 40.
    expect(island.map((c) => [c.x, c.y, c.rotation])).toEqual([
      [40, 190, 0],
      [90, 190, 180],
      [90, 190, 0],
      [140, 190, 180],
    ]);
    // Without the setting, the island is still one row on the usual line.
    const oneRow = reconcileCabinets([], [box('B30', { location: 'island', qty: 2 })], [], PRESETS, SCALE)!;
    expect(oneRow.map((c) => [c.x, c.y, c.rotation])).toEqual([
      [40, 150, 0],
      [90, 150, 0],
    ]);
  });

  it('cuts a one-row island into two back-to-back rows and puts it back', () => {
    const perimeter = { ...isle('p', 40, 40), location: 'perimeter' as const };
    const two = layoutIslandSides([perimeter, ...row], [], true, SCALE);
    expect(two.straight).toBe(true);
    // Halves of 60": the first two move a depth forward, facing as before; the last two turn into
    // the row's old place (y 150 to 190), backs on one line, both centred where the row was (x 90 to 190).
    expect(poses(two.cabinets)).toEqual({
      p: [40, 40, 0],
      a: [90, 190, 0],
      b: [140, 190, 0],
      c: [140, 190, 180],
      d: [190, 190, 180],
    });
    const back = layoutIslandSides(two.cabinets, [], false, SCALE);
    expect(poses(back.cabinets)).toEqual(poses([perimeter, ...row]));
  });

  it('cuts an odd row as near halves as its boxes allow', () => {
    const wide = isle('w', 40, 150, 0, { width: 100 });
    const two = layoutIslandSides([wide, isle('x', 140, 150), isle('y', 190, 150)], [], true, SCALE);
    // 100 | 50 + 50: the wide one on its own side.
    expect(two.cabinets.map((c) => c.rotation)).toEqual([0, 180, 180]);
  });

  it('merges two rows facing the way a new island faces', () => {
    // The turned row listed first: the merged row still faces the perimeter run's way (rotation 0).
    const two = [isle('c', 140, 190, 180), isle('d', 190, 190, 180), isle('a', 90, 190), isle('b', 140, 190)];
    const one = layoutIslandSides(two, [], false, SCALE);
    expect(one.cabinets.every((c) => c.rotation === 0 && c.y === 150)).toBe(true);
    // In one row again the way it was cut: the facing half, then the turned one.
    expect([...one.cabinets].sort((p, q) => p.x - q.x).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves an island of another shape, or one already laid that way, as it is', () => {
    // An L: the end cabinet backed east.
    const ell = [...row, isle('e', 0, 150, 90)];
    const out = layoutIslandSides(ell, [], true, SCALE);
    expect(out.straight).toBe(false);
    expect(out.cabinets).toBe(ell);
    // Two rows set apart (not back to back) are another shape too.
    const apart = [isle('a', 40, 150), isle('c', 90, 250, 180)];
    expect(layoutIslandSides(apart, [], false, SCALE).straight).toBe(false);
    // Already one row, or a single cabinet: nothing moves.
    expect(layoutIslandSides(row, [], false, SCALE).cabinets).toBe(row);
    const single = [isle('a', 40, 150)];
    expect(layoutIslandSides(single, [], true, SCALE).cabinets).toBe(single);
    // Uppers over the island stay where they hang.
    const upper = { ...isle('u', 40, 150), cab_type: 'wall' as const, preset_code: 'W3030' };
    const withUpper = layoutIslandSides([...row, upper], [], true, SCALE);
    expect(withUpper.cabinets.find((c) => c.id === 'u')).toBe(upper);
  });
});

describe('polygonUnion', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const area = (loops: { x: number; y: number }[][]) => loops.reduce((s, l) => s + signedArea2(l) / 2, 0);

  it('merges overlapping and edge-sharing pieces into one outline', () => {
    const overlap = polygonUnion([rect(0, 0, 10, 10), rect(5, 5, 15, 15)]);
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toHaveLength(8);
    expect(area(overlap)).toBeCloseTo(175);
    // Side by side, sharing an edge or overlapping along it: one rectangle, no seam.
    for (const right of [rect(10, 0, 20, 10), rect(8, 0, 20, 10)]) {
      const run = polygonUnion([rect(0, 0, 10, 10), right]);
      expect(run).toHaveLength(1);
      expect(run[0]).toHaveLength(4);
      expect(area(run)).toBeCloseTo(200);
    }
  });

  it('keeps apart pieces that do not touch, winds every outside the same way, and finds holes', () => {
    const apart = polygonUnion([rect(0, 0, 10, 10), rect(20, 0, 30, 10).reverse()]);
    expect(apart).toHaveLength(2);
    expect(apart.every((l) => signedArea2(l) > 0)).toBe(true);
    // A ring of four bars: an outside and a hole wound the other way.
    const ring = polygonUnion([rect(0, 0, 30, 10), rect(20, 0, 30, 30), rect(0, 20, 30, 30), rect(0, 0, 10, 30)]);
    expect(ring).toHaveLength(2);
    expect(ring.map((l) => Math.sign(signedArea2(l))).sort()).toEqual([-1, 1]);
    expect(area(ring)).toBeCloseTo(900 - 100);
    expect(polygonUnion([])).toEqual([]);
  });
});
