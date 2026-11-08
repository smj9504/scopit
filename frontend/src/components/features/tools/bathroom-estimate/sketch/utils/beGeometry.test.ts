import { describe, it, expect } from 'vitest';
import { outlineMeasures, resizeRoomEdge, showerDoorPosition, showerDoorSpan, showerFrontPanels, wallAreaSF } from './beGeometry';

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

describe('outlineMeasures', () => {
  it('measures a room that is not a rectangle by its outline, not its bounding box', () => {
    // A master bath drawn at 40 px a foot: 10'6" x 7'7.5" with the toilet alcove
    // out to the left and the door wall cut across a corner. Its box is 13' x 7'8".
    const room = [
      { x: 280, y: -560 }, { x: 700, y: -560 }, { x: 700, y: -255 }, { x: 460, y: -255 },
      { x: 385, y: -330 }, { x: 185, y: -330 }, { x: 185, y: -435 }, { x: 280, y: -435 },
    ];
    const { floorSF, perimeterLF } = outlineMeasures(room, 40);
    expect(floorSF).toBeCloseTo(79.62, 2);
    expect(perimeterLF).toBeCloseTo(39.9, 1);
  });

  it('gives a rectangle its length times width, whichever way it was drawn', () => {
    const cw = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 320 }, { x: 0, y: 320 }];
    expect(outlineMeasures(cw, 40)).toEqual({ floorSF: 40, perimeterLF: 26 });
    expect(outlineMeasures([...cw].reverse(), 40)).toEqual({ floorSF: 40, perimeterLF: 26 });
  });
});

describe('wallAreaSF', () => {
  it('is the length round in feet times the ceiling height in feet', () => {
    // 39.9 LF at an 8' ceiling. Worked out over 144 it came to 26.6, 12x too small.
    expect(wallAreaSF(39.9, 96)).toBeCloseTo(319.2, 1);
    expect(wallAreaSF(26, 108)).toBe(234);
  });
});
