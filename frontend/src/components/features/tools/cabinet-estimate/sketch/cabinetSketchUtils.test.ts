import { describe, expect, it } from 'vitest';
import { snapToWall } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchUtils';

// A 200px wall along y = 100, and one standing up from its right end.
const back = { id: 'back', start_x: 0, start_y: 100, end_x: 200, end_y: 100 };
const side = { id: 'side', start_x: 200, start_y: 100, end_x: 200, end_y: 0 };

describe('snapToWall', () => {
  it('lands on a wall end first', () => {
    expect(snapToWall({ x: 195, y: 104 }, [back, side], 15)).toEqual({ point: { x: 200, y: 100 }, snapped: true });
  });

  it('lands partway along a wall, straight across from the pointer', () => {
    expect(snapToWall({ x: 80, y: 109 }, [back], 15)).toEqual({ point: { x: 80, y: 100 }, snapped: true });
  });

  it('leaves the point alone away from every wall, and past a wall end', () => {
    expect(snapToWall({ x: 80, y: 130 }, [back], 15)).toEqual({ point: { x: 80, y: 130 }, snapped: false });
    expect(snapToWall({ x: 230, y: 105 }, [back], 15).snapped).toBe(false);
  });

  it('with Shift, slides along the locked line to where it meets the wall', () => {
    // Drawn straight down from (60, 20) on an angled wall, the end stays plumb.
    const angled = { start_x: 0, start_y: 100, end_x: 200, end_y: 140 };
    const snap = snapToWall({ x: 60, y: 105 }, [angled], 15, { along: { x: 60, y: 20 } });
    expect(snap.snapped).toBe(true);
    expect(snap.point.x).toBeCloseTo(60);
    expect(snap.point.y).toBeCloseTo(112);
  });

  it('with Shift, a line running alongside a wall never joins it', () => {
    expect(snapToWall({ x: 150, y: 105 }, [back], 15, { along: { x: 20, y: 105 } }).snapped).toBe(false);
  });

  it('a dragged wall end never snaps to its own wall', () => {
    expect(snapToWall({ x: 80, y: 102 }, [back], 15, { excludeId: 'back' }).snapped).toBe(false);
  });
});
