import { describe, expect, it } from 'vitest';
import { snapToWalls } from './wallSnap';

const north = { id: 'north', start: { x: 0, y: 0 }, end: { x: 240, y: 0 } };
const east = { id: 'east', start: { x: 240, y: 0 }, end: { x: 240, y: 180 } };

describe('snapToWalls', () => {
  it('lands on a wall end first', () => {
    expect(snapToWalls({ x: 236, y: 5 }, [north, east], 12, { alongWalls: true })).toEqual({ x: 240, y: 0 });
  });

  it('lands partway along a wall when drawing walls', () => {
    expect(snapToWalls({ x: 100, y: 8 }, [north], 12, { alongWalls: true })).toEqual({ x: 100, y: 0 });
  });

  it('keeps to wall ends otherwise, handing back the same point when nothing is near', () => {
    const p = { x: 100, y: 8 };
    expect(snapToWalls(p, [north], 12)).toBe(p);
  });

  it('a dragged wall end never snaps to its own wall', () => {
    const p = { x: 100, y: 8 };
    expect(snapToWalls(p, [north], 12, { alongWalls: true, excludeId: 'north' })).toBe(p);
  });
});
