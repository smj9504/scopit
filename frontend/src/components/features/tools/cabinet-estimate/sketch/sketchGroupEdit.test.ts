import { describe, it, expect } from 'vitest';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import { boxMeetsPolygon, footprintCorners, pickInBox, turnGroup, withIslandGroup } from '@/components/features/tools/cabinet-estimate/sketch/sketchGroupEdit';

const cab = (id: string, x: number, y: number, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => ({
  id,
  preset_code: 'B30',
  cab_type: 'base',
  x,
  y,
  width: 50,
  height: 40,
  rotation: 0,
  label: 'B30',
  location: 'perimeter',
  ...over,
});
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

describe('footprintCorners', () => {
  it('turns about the back-left corner', () => {
    const [a, b, c, d] = footprintCorners({ id: 'x', x: 10, y: 10, width: 50, height: 40, rotation: 90 });
    expect(a).toEqual({ x: 10, y: 10 });
    expect(b.x).toBeCloseTo(10);
    expect(b.y).toBeCloseTo(60);
    expect(c.x).toBeCloseTo(-30);
    expect(c.y).toBeCloseTo(60);
    expect(d.x).toBeCloseTo(-30);
    expect(d.y).toBeCloseTo(10);
  });
});

describe('boxMeetsPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('takes in overlap and containment, not a near miss', () => {
    expect(boxMeetsPolygon({ x0: 5, y0: 5, x1: 20, y1: 20 }, square)).toBe(true);
    expect(boxMeetsPolygon({ x0: -5, y0: -5, x1: 20, y1: 20 }, square)).toBe(true);
    expect(boxMeetsPolygon({ x0: 11, y0: 0, x1: 20, y1: 10 }, square)).toBe(false);
  });
  it('separates a box from a turned square beside its corner', () => {
    const diamond = [
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 10 },
    ];
    // The box's corner sits in the empty triangle off the diamond's edge.
    expect(boxMeetsPolygon({ x0: 0, y0: 0, x1: 3, y1: 3 }, diamond)).toBe(false);
    expect(boxMeetsPolygon({ x0: 8, y0: 8, x1: 12, y1: 12 }, diamond)).toBe(true);
  });
});

describe('pickInBox', () => {
  const cabinets = [
    cab('a', 0, 0),
    cab('b', 50, 0),
    cab('i1', 0, 200, { location: 'island' }),
    cab('i2', 50, 200, { location: 'island' }),
  ];
  const appliances: CabinetSketchAppliance[] = [
    { id: 'dw', type: 'dishwasher', x: 100, y: 0, width: 40, height: 40, rotation: 0 },
    { id: 'range', type: 'range_gas', x: 0, y: 0, width: 50, height: 40, rotation: 0, host_id: 'a' },
  ];
  const walls = [wall('w1', -10, -5, 300, -5), wall('w2', 400, 0, 400, 300)];

  it('takes what the box touches: cabinets, free-standing appliances, walls', () => {
    const picked = pickInBox({ x0: 40, y0: -10, x1: 110, y1: 10 }, cabinets, appliances, walls);
    expect(picked.cabinets.sort()).toEqual(['a', 'b']);
    // The range in cabinet "a" goes with it, so the box doesn't take it separately.
    expect(picked.appliances).toEqual(['dw']);
    expect(picked.walls).toEqual(['w1']);
  });

  it('takes the whole island for any of its cabinets, and works dragged either way', () => {
    const picked = pickInBox({ x0: 30, y0: 250, x1: 10, y1: 210 }, cabinets, appliances, walls);
    expect(picked.cabinets.sort()).toEqual(['i1', 'i2']);
    expect(picked.walls).toEqual([]);
  });
});

describe('withIslandGroup', () => {
  it('adds the island only when an island cabinet is in', () => {
    const cabinets = [cab('a', 0, 0), cab('i1', 0, 200, { location: 'island' }), cab('i2', 50, 200, { location: 'island' })];
    expect(withIslandGroup(['a'], cabinets)).toEqual(['a']);
    expect(withIslandGroup(['i2'], cabinets)).toEqual(['i2', 'i1']);
  });
});

describe('turnGroup', () => {
  it('turns cabinets and walls together about the middle of their extent', () => {
    const turned = turnGroup([cab('a', 0, 0)], [wall('w', 0, -10, 50, -10)], 90);
    // Extent: x 0..50, y -10..40, so the pivot is (25, 15).
    const [a] = turned.placed;
    expect(a.rotation).toBe(90);
    expect(a.x).toBeCloseTo(40);
    expect(a.y).toBeCloseTo(-10);
    const [w] = turned.walls;
    expect(w.start_x).toBeCloseTo(50);
    expect(w.start_y).toBeCloseTo(-10);
    expect(w.end_x).toBeCloseTo(50);
    expect(w.end_y).toBeCloseTo(40);
  });

  it('keeps angles tidy and does nothing for no turn', () => {
    expect(turnGroup([cab('a', 0, 0, { rotation: 350 })], [], 15).placed[0].rotation).toBe(5);
    expect(turnGroup([cab('a', 0, 0)], [], 0)).toEqual({ placed: [], walls: [] });
  });
});
