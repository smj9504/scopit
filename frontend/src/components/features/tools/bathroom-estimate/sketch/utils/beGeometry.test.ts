import { describe, it, expect } from 'vitest';
import { resizeRoomEdge, showerDoorPosition, showerDoorSpan, showerFrontPanels } from './beGeometry';

describe('showerDoorPosition', () => {
  it('puts a glass door where it is set, and in the middle when it is not', () => {
    expect(showerDoorPosition({ showerDoorType: 'swing', showerDoorPosition: 'left' })).toBe('left');
    expect(showerDoorPosition({ showerDoorType: 'sliding', showerDoorPosition: 'right', showerLayout: 'corner' })).toBe('right');
    expect(showerDoorPosition({ showerDoorType: 'frameless_swing' })).toBe('center');
  });

  it('keeps an open front, a curtain and a neo-angle door in the middle', () => {
    expect(showerDoorPosition({ showerDoorType: 'none', showerDoorPosition: 'left' })).toBe('center');
    expect(showerDoorPosition({ showerDoorType: 'curtain', showerDoorPosition: 'right' })).toBe('center');
    expect(showerDoorPosition({ showerDoorType: 'neo_angle_pivot', showerDoorPosition: 'left', showerLayout: 'neo_angle' })).toBe('center');
  });
});

describe('showerDoorSpan', () => {
  it('centres the door, or puts it against the left or right side', () => {
    expect(showerDoorSpan('center', 0.5)).toEqual([0.25, 0.75]);
    expect(showerDoorSpan('left', 0.5)).toEqual([0, 0.5]);
    expect(showerDoorSpan('right', 0.4)).toEqual([0.6, 1]);
  });
});

describe('showerFrontPanels', () => {
  it('fills each panel side up to the door', () => {
    expect(showerFrontPanels('both', [0.25, 0.75])).toEqual([[0, 0.25], [0.75, 1]]);
    expect(showerFrontPanels('right', [0, 0.5])).toEqual([[0.5, 1]]);
  });

  it('has no panel on a side the door is against', () => {
    expect(showerFrontPanels('left', [0, 0.5])).toEqual([]);
    expect(showerFrontPanels('both', [0.6, 1])).toEqual([[0, 0.6]]);
  });
});

// 40 px to the foot: a 5 ft × 8 ft room, corners listed top-left, clockwise
const room = [{ x: 60, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 360 }, { x: 60, y: 360 }];
const FT = 40;

describe('resizeRoomEdge', () => {
  it('widens a rectangle from its top edge: the right side moves out with the corner', () => {
    expect(resizeRoomEdge(room, 0, 6 * FT)).toEqual([
      { x: 60, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 360 }, { x: 60, y: 360 },
    ]);
  });

  it('lengthens a rectangle from its right edge: the bottom moves down', () => {
    expect(resizeRoomEdge(room, 1, 9 * FT)).toEqual([
      { x: 60, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 400 }, { x: 60, y: 400 },
    ]);
  });

  it('moves the far end of an edge drawn right to left (the bottom edge grows to the left)', () => {
    expect(resizeRoomEdge(room, 2, 6 * FT)).toEqual([
      { x: 20, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 360 }, { x: 20, y: 360 },
    ]);
  });

  it('moves only the end corner of a room that is not four-cornered', () => {
    const ell = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    const b = resizeRoomEdge(ell, 0, 240)!;
    expect(b[1]).toEqual({ x: 240, y: 0 });
    expect(b.filter((p, i) => i !== 1)).toEqual(ell.filter((p, i) => i !== 1));
  });

  it('squares up an edge that is nearly level', () => {
    const skewed = [{ x: 0, y: 0 }, { x: 200, y: 6 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
    expect(resizeRoomEdge(skewed, 0, 240)![1]).toEqual({ x: 240, y: 0 });
  });

  it('gives up on an edge with no length', () => {
    expect(resizeRoomEdge([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }], 0, 40)).toBeNull();
  });
});
