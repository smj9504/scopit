import { describe, it, expect } from 'vitest';
import { nearerWallPoint, snapBehindCabinets, wallLinesBehind } from '@/components/features/tools/cabinet-estimate/sketch/wallBehindCabinets';

const T = 4; // wall thickness, px
const SNAP = 15;
const cab = (x: number, y: number, width: number, height: number, rotation = 0, location?: 'island') => ({
  x, y, width, height, rotation, ...(location ? { location } : {}),
});
const round = (p: { x: number; y: number }) => [Math.round(p.x * 1e6) / 1e6 + 0, Math.round(p.y * 1e6) / 1e6 + 0];

// A run of two bases backed to the top (back edge y = 100), and a base turned 90° backed to the right (x = 400).
const b1 = cab(100, 100, 120, 80);
const b2 = cab(220, 100, 100, 80);
const side = cab(400, 200, 100, 80, 90);
const lines = [b1, b2, side].flatMap((c) => wallLinesBehind(c, null, T));

describe('wallLinesBehind', () => {
  it('runs half a wall behind the back, along the cabinet', () => {
    expect(wallLinesBehind(b1, null, T).map((l) => [round(l.a), round(l.b)])).toEqual([[[100, 98], [220, 98]]]);
    // Turned 90°: the back faces +x.
    expect(wallLinesBehind(side, null, T).map((l) => [round(l.a), round(l.b)])).toEqual([[[402, 200], [402, 300]]]);
  });

  it('leaves island cabinets out', () => {
    expect(wallLinesBehind(cab(0, 0, 100, 80, 0, 'island'), null, T)).toEqual([]);
  });

  it('gives an L corner a line behind its corner end too, the two meeting at the room corner', () => {
    const l = wallLinesBehind(cab(0, 0, 120, 120), { kind: 'l', side: 'left' }, T);
    expect(l.map((x) => [round(x.a), round(x.b)])).toEqual([
      [[-2, -2], [120, -2]],
      [[-2, -2], [-2, 120]],
    ]);
    const r = wallLinesBehind(cab(0, 0, 120, 120), { kind: 'diagonal', side: 'right' }, T);
    expect(r.map((x) => [round(x.a), round(x.b)])).toEqual([
      [[0, -2], [122, -2]],
      [[122, -2], [122, 120]],
    ]);
  });
});

describe('snapBehindCabinets', () => {
  it('takes a point near a cabinet back to the line behind it', () => {
    expect(snapBehindCabinets({ x: 160, y: 105 }, lines, SNAP)).toEqual({ point: { x: 160, y: 98 }, end: false });
  });

  it('takes a point on the cabinet itself behind it, however deep the cabinet', () => {
    const s = snapBehindCabinets({ x: 170, y: 160 }, lines, SNAP)!;
    expect(round(s.point)).toEqual([170, 98]);
  });

  it('takes a point near a run\'s end to the corner behind it', () => {
    expect(snapBehindCabinets({ x: 92, y: 104 }, lines, SNAP)).toEqual({ point: { x: 100, y: 98 }, end: true });
  });

  it('follows the run\'s back line past its end, as far as the reach', () => {
    expect(snapBehindCabinets({ x: 20, y: 93 }, lines, SNAP, { reach: 100 })).toEqual({ point: { x: 20, y: 98 }, end: false });
    expect(snapBehindCabinets({ x: 20, y: 93 }, lines, SNAP, { reach: 50 })).toBeNull();
  });

  it('with Shift, slides along the locked line to the line behind', () => {
    // A level wall drawn from the left toward the turned base: it stops on the line behind that base.
    const s = snapBehindCabinets({ x: 395, y: 250 }, lines, SNAP, { along: { x: 300, y: 250 } })!;
    expect(round(s.point)).toEqual([402, 250]);
  });

  it('is null far from every cabinet', () => {
    expect(snapBehindCabinets({ x: 700, y: 700 }, lines, SNAP, { reach: 400 })).toBeNull();
  });
});

describe('nearerWallPoint', () => {
  const pos = { x: 10, y: 10 };
  it('prefers an end, a wall\'s or a run\'s, to a point along a line', () => {
    expect(nearerWallPoint(pos, { point: { x: 20, y: 10 }, snapped: true, end: true }, { point: { x: 10, y: 12 }, end: false }).point).toEqual({ x: 20, y: 10 });
    expect(nearerWallPoint(pos, { point: { x: 10, y: 11 }, snapped: true, end: false }, { point: { x: 14, y: 10 }, end: true }).point).toEqual({ x: 14, y: 10 });
  });

  it('else takes the nearer, and the cabinet line when no wall is near', () => {
    expect(nearerWallPoint(pos, { point: { x: 10, y: 14 }, snapped: true, end: false }, { point: { x: 10, y: 12 }, end: false }).point).toEqual({ x: 10, y: 12 });
    expect(nearerWallPoint(pos, { point: pos, snapped: false, end: false }, { point: { x: 10, y: 12 }, end: false })).toEqual({ point: { x: 10, y: 12 }, snapped: true });
    expect(nearerWallPoint(pos, { point: pos, snapped: false, end: false }, null)).toEqual({ point: pos, snapped: false });
  });
});
