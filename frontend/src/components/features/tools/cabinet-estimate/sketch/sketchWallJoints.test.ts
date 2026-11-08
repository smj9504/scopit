import { describe, it, expect } from 'vitest';
import type { CabinetSketchWall } from '@/types/cabinetSketch';
import { keepWallsJoined, moveWallEndJoined, moveWallsJoined, wallsMeetingEnd } from '@/components/features/tools/cabinet-estimate/sketch/sketchWallJoints';

const SCALE = 20; // px per foot
const wall = (id: string, sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
  id,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  color: '#333',
  length_ft: Math.hypot(ex - sx, ey - sy) / SCALE,
});
const byId = (walls: CabinetSketchWall[], id: string) => walls.find((w) => w.id === id)!;
const pts = (w: CabinetSketchWall) => [w.start_x, w.start_y, w.end_x, w.end_y].map((v) => Math.round(v * 1e6) / 1e6 + 0);
/** A wall's direction, degrees from start to end. */
const angle = (w: CabinetSketchWall) => (Math.atan2(w.end_y - w.start_y, w.end_x - w.start_x) * 180) / Math.PI;
const turnOf = (a: CabinetSketchWall, b: CabinetSketchWall) => ((((angle(b) - angle(a) + 180) % 360) + 360) % 360) - 180;

// An L: a back wall along the top and a side wall down from its right end, and a stub T-ing into the back wall.
const back = wall('back', 0, 0, 200, 0);
const side = wall('side', 200, 0, 200, 120);
const stub = wall('stub', 80, 0, 80, 60);
const loose = wall('loose', 0, 300, 100, 300);
const plan = [back, side, stub, loose];

describe('moveWallsJoined', () => {
  it('stretches a wall joined at a corner, keeping its far end', () => {
    const out = moveWallsJoined(plan, new Set(['back']), 0, 30, SCALE);
    expect(byId(out, 'back')).toMatchObject({ start_y: 30, end_y: 30 });
    // The side wall's top end goes with the corner; its bottom end stays.
    expect(byId(out, 'side')).toMatchObject({ start_x: 200, start_y: 30, end_x: 200, end_y: 120 });
    expect(byId(out, 'side').length_ft).toBeCloseTo(90 / SCALE);
  });

  it('keeps a wall that Ts into the moved one square to it, on it', () => {
    // Moved a little sideways as well: the stub stays upright instead of leaning after the T.
    const out = moveWallsJoined(plan, new Set(['back']), 10, 30, SCALE);
    expect(pts(byId(out, 'stub'))).toEqual([80, 30, 80, 60]);
  });

  it('keeps 90° at a T when the wall it ends on moves a little — never 98°', () => {
    // The screenshot: a wall along the top, another coming down from partway along it.
    const top = wall('top', 0, 0, 300, 0);
    const stem = wall('stem', 150, 0, 150, 200);
    for (const [dx, dy] of [[12, 4], [-25, -10], [28, 0]]) {
      const out = moveWallsJoined([top, stem], new Set(['top']), dx, dy, SCALE);
      expect(turnOf(stem, byId(out, 'stem'))).toBeCloseTo(0, 9);
      expect(pts(byId(out, 'stem'))).toEqual([150, dy, 150, 200]);
    }
  });

  it('keeps the angle at a T when the wall it ends on slides along, the T moving along it', () => {
    const top = wall('top', 0, 0, 300, 0);
    const stem = wall('stem', 150, 0, 150, 200);
    const out = moveWallsJoined([top, stem], new Set(['top']), 120, 0, SCALE);
    expect(byId(out, 'stem')).toBe(stem);
  });

  it('turns a T wall in whole 15° steps only once the wall it ends on has slid past it', () => {
    const top = wall('top', 0, 0, 300, 0);
    const stem = wall('stem', 150, 0, 150, 200);
    // Slid 200 right, the top wall no longer reaches x = 150: the stem leans after it, 45°, onto it.
    const out = moveWallsJoined([top, stem], new Set(['top']), 200, 0, SCALE);
    const s = byId(out, 'stem');
    expect(turnOf(stem, s)).toBeCloseTo(45, 9);
    expect([s.end_x, s.end_y]).toEqual([150, 200]);
    expect(s.start_y).toBeCloseTo(0, 9);
    expect(s.start_x).toBeGreaterThanOrEqual(200);
    expect(s.start_x).toBeLessThanOrEqual(500);
  });

  it('turns a corner wall in whole steps when the moved wall has passed it, the corner kept', () => {
    // The back wall dragged along itself past the side wall: the side leans after it.
    const out = moveWallsJoined(plan, new Set(['back']), 250, 0, SCALE);
    const s = byId(out, 'side');
    const b = byId(out, 'back');
    expect(turnOf(side, s)).toBeCloseTo(60, 9);
    expect([s.end_x, s.end_y]).toEqual([200, 120]);
    // The corner stays closed: the back wall's end is the side wall's top.
    expect(s.start_x).toBeCloseTo(b.end_x, 9);
    expect(s.start_y).toBeCloseTo(b.end_y, 9);
    expect(b.start_x).toBe(250);
    expect(angle(b)).toBeCloseTo(0, 9);
  });

  it('closes the corner on the moved wall\'s line: it stretches or shortens instead of the other wall leaning', () => {
    const out = moveWallsJoined(plan, new Set(['back']), 6, 20, SCALE);
    expect(pts(byId(out, 'side'))).toEqual([200, 20, 200, 120]);
    expect(pts(byId(out, 'back'))).toEqual([6, 20, 200, 20]);
  });

  it('slides the moved wall\'s T end along the wall it stops on', () => {
    // Moving the stub sideways: its top end stays on the back wall.
    const out = moveWallsJoined(plan, new Set(['stub']), 25, 15, SCALE);
    expect(pts(byId(out, 'stub'))).toEqual([105, 0, 105, 75]);
    expect(byId(out, 'back')).toBe(back);
  });

  it('leaves walls that touch nothing moved alone, and moves several as a block', () => {
    const out = moveWallsJoined(plan, new Set(['back', 'side']), 5, 5, SCALE);
    expect(byId(out, 'loose')).toBe(loose);
    expect(byId(out, 'back')).toMatchObject({ start_x: 5, start_y: 5, end_x: 205, end_y: 5 });
    expect(byId(out, 'side')).toMatchObject({ start_x: 205, start_y: 5, end_x: 205, end_y: 125 });
    // The stub's top stays on the back wall, the stub upright; its free end stays.
    expect(pts(byId(out, 'stub'))).toEqual([80, 5, 80, 60]);
  });

  it('is a no-op for nothing moved', () => {
    expect(moveWallsJoined(plan, new Set(), 10, 10, SCALE)).toBe(plan);
    expect(moveWallsJoined(plan, new Set(['back']), 0, 0, SCALE)).toBe(plan);
  });
});

describe('moveWallEndJoined', () => {
  it('drags a corner: both walls meeting there follow it', () => {
    const out = moveWallEndJoined(plan, 'back', 'end', { x: 240, y: -20 }, SCALE);
    expect(byId(out, 'back')).toMatchObject({ end_x: 240, end_y: -20 });
    expect(byId(out, 'side')).toMatchObject({ start_x: 240, start_y: -20, end_x: 200, end_y: 120 });
  });

  it('keeps a T on the wall whose end moved, the T wall keeping its angle', () => {
    const out = moveWallEndJoined(plan, 'back', 'start', { x: -50, y: 40 }, SCALE);
    // The back wall now runs (-50, 40) to (200, 0); the stub stays upright and ends on it.
    expect(pts(byId(out, 'stub'))).toEqual([80, 19.2, 80, 60]);
  });

  it('puts the dragged end where it was dropped, even off the wall it was on', () => {
    const out = moveWallEndJoined(plan, 'stub', 'start', { x: 80, y: -40 }, SCALE);
    expect(byId(out, 'stub')).toMatchObject({ start_x: 80, start_y: -40 });
    expect(byId(out, 'back')).toBe(back);
  });
});

describe('wallsMeetingEnd', () => {
  it('names the walls sharing an end, not the ones it Ts into', () => {
    expect(wallsMeetingEnd(plan, 'back', 'end')).toEqual(['side']);
    expect(wallsMeetingEnd(plan, 'stub', 'start')).toEqual([]);
  });
});

describe('keepWallsJoined', () => {
  it('turns a wall joined to a turned wall by a whole number of steps, the corner kept', () => {
    // Back wall turned 90° about its left end: its right end goes to (0, 200).
    const turned = plan.map((w) => (w.id === 'back' ? { ...w, end_x: 0, end_y: 200 } : w));
    const out = keepWallsJoined(plan, turned, new Set(['back']), SCALE);
    const s = byId(out, 'side');
    const b = byId(out, 'back');
    const turn = turnOf(side, s);
    expect(turn - 15 * Math.round(turn / 15)).toBeCloseTo(0, 6);
    expect(Math.abs(turn)).toBeGreaterThan(0);
    expect([s.end_x, s.end_y]).toEqual([200, 120]);
    expect(s.start_x).toBeCloseTo(b.end_x, 9);
    expect(s.start_y).toBeCloseTo(b.end_y, 9);
    expect([b.start_x, b.start_y, b.end_x]).toEqual([0, 0, 0]);
  });

  it('follows a wall held at both ends by moved walls exactly', () => {
    // A U: left and right walls moved down together; the back wall between them goes with both corners.
    const left = wall('left', 0, 0, 0, 100);
    const top = wall('top', 0, 0, 200, 0);
    const right = wall('right', 200, 0, 200, 100);
    const out = moveWallsJoined([left, top, right], new Set(['left', 'right']), 0, 10, SCALE);
    expect(pts(byId(out, 'top'))).toEqual([0, 10, 200, 10]);
  });
});
