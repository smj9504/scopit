import { describe, expect, it } from 'vitest';
import type { CabinetBox } from '@/types/cabinetEstimate';
import type { CabinetSketchCabinet, CabinetSketchOverlayData, CabinetSketchWall } from '@/types/cabinetSketch';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { drawingInput, hasDrawing, planFrame, wallLengthPlace } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawingModel';

const SCALE = 20;
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  B36: { width: 36, height: 34.5 },
};

const cabinet = (id: string, code: string, x: number, widthIn: number): CabinetSketchCabinet => ({
  id,
  preset_code: code,
  cab_type: 'base',
  x,
  y: 0,
  width: (widthIn / 12) * SCALE,
  height: (24 / 12) * SCALE,
  rotation: 0,
  label: code,
  location: 'perimeter',
  width_in: widthIn,
  depth_in: 24,
  height_in: 34.5,
});

const box = (code: string, width: number, qty = 1): CabinetBox => ({
  id: `box-${code}`,
  estimate_id: 'e1',
  code,
  cab_type: 'base',
  location: 'perimeter',
  width_inches: width,
  height_inches: 34.5,
  is_specialty: false,
  has_glass_door: false,
  qty,
  display_order: 0,
});

const wall: CabinetSketchWall = {
  id: 'w1',
  start_x: 0,
  start_y: 0,
  end_x: 200,
  end_y: 0,
  thickness: 4,
  color: '#333333',
  length_ft: 10,
};

const overlay = (over: Partial<CabinetSketchOverlayData> = {}): CabinetSketchOverlayData => ({
  walls: [],
  cabinets: [],
  appliances: [],
  element_order: [],
  ...over,
});

const estimate = (over: Record<string, unknown> = {}) =>
  ({
    boxes: [box('B30', 30)],
    kind: 'restore',
    selections: null,
    sink_type: 'single',
    door_style: 'Shaker',
    include_crown_molding: false,
    include_appliance_rr: false,
    appliance_list: [],
    island_seating_overhang_in: null,
    ...over,
  }) as Parameters<typeof drawingInput>[1];

describe('hasDrawing', () => {
  it('is false for a sketch nobody has laid out', () => {
    expect(hasDrawing(null)).toBe(false);
    expect(hasDrawing(overlay())).toBe(false);
  });

  it('is true once there is a wall or a cabinet', () => {
    expect(hasDrawing(overlay({ walls: [wall] }))).toBe(true);
    expect(hasDrawing(overlay({ cabinets: [cabinet('c1', 'B30', 0, 30)] }))).toBe(true);
  });
});

describe('drawingInput', () => {
  it('draws a box added since the sketch was last open, as the Sketch tab would', () => {
    const sketch = { overlay_data: overlay({ cabinets: [cabinet('c1', 'B30', 0, 30)] }), scale_pixels_per_foot: SCALE };
    const input = drawingInput(sketch, estimate({ boxes: [box('B30', 30), box('B36', 36)] }), PRESETS);
    expect(input.cabinets.map((c) => c.preset_code).sort()).toEqual(['B30', 'B36']);
    // The one already placed stays where it was.
    expect(input.cabinets.find((c) => c.id === 'c1')?.x).toBe(0);
  });

  it('drops a cabinet whose box is gone from the estimate', () => {
    const sketch = {
      overlay_data: overlay({ cabinets: [cabinet('c1', 'B30', 0, 30), cabinet('c2', 'B36', 50, 36)] }),
      scale_pixels_per_foot: SCALE,
    };
    const input = drawingInput(sketch, estimate(), PRESETS);
    expect(input.cabinets.map((c) => c.id)).toEqual(['c1']);
  });

  it("leaves out an appliance list that isn't in the estimate's scope", () => {
    const sketch = { overlay_data: overlay({ cabinets: [cabinet('c1', 'B30', 0, 30)] }), scale_pixels_per_foot: SCALE };
    const list = [{ type: 'refrigerator', qty: 1 }];
    expect(drawingInput(sketch, estimate({ appliance_list: list }), PRESETS).appliances).toEqual([]);
    expect(drawingInput(sketch, estimate({ appliance_list: list, include_appliance_rr: true }), PRESETS).appliances).toHaveLength(1);
  });

  it('takes arched doors from the door style, unless an option has a cabinet product', () => {
    const sketch = { overlay_data: overlay({ cabinets: [cabinet('c1', 'B30', 0, 30)] }), scale_pixels_per_foot: SCALE };
    expect(drawingInput(sketch, estimate({ door_style: 'Arched Raised Panel' }), PRESETS).archedDoors).toBe(true);
    const slab = { cabinets: { title: 'Slab Euro Base', look: { door_style: 'slab' } } };
    const option = estimate({ door_style: 'Arched Raised Panel', kind: 'option', selections: slab });
    expect(drawingInput(sketch, option, PRESETS).archedDoors).toBe(false);
  });

  it("ignores products on a restoration: it never draws them", () => {
    const sketch = { overlay_data: overlay({ cabinets: [cabinet('c1', 'B30', 0, 30)] }), scale_pixels_per_foot: SCALE };
    const sink = { kitchen_sink: { title: 'Double bowl', look: { bowls: 2 } } };
    expect(drawingInput(sketch, estimate({ selections: sink }), PRESETS).sinkBowls).toBe(1);
    expect(drawingInput(sketch, estimate({ selections: sink, kind: 'option' }), PRESETS).sinkBowls).toBe(2);
  });

  it('draws an island two-sided as the Sketch tab would lay it out, with no seating overhang', () => {
    const isle = (id: string, x: number): CabinetSketchCabinet => ({ ...cabinet(id, 'B30', x, 30), y: 150, location: 'island' });
    const boxes = [{ ...box('B30', 30, 2), location: 'island' as const }];
    const sketch = { overlay_data: overlay({ cabinets: [isle('a', 40), isle('b', 90)] }), scale_pixels_per_foot: SCALE };
    const twoSided = drawingInput(sketch, estimate({ boxes, island_two_sided: true, island_seating_overhang_in: 12 }), PRESETS);
    expect(twoSided.cabinets.map((c) => c.rotation)).toEqual([0, 180]);
    expect(twoSided.islandSeatingIn).toBe(0);
    // Laid out for it already (the Sketch tab noted so): drawn as it is.
    const laid = { ...sketch, overlay_data: { ...sketch.overlay_data, island_two_sided: true } };
    expect(drawingInput(laid, estimate({ boxes, island_two_sided: true }), PRESETS).cabinets.map((c) => c.rotation)).toEqual([0, 0]);
    // One-sided, the seating overhang counts.
    expect(drawingInput(sketch, estimate({ boxes, island_seating_overhang_in: 12 }), PRESETS).islandSeatingIn).toBe(12);
  });
});

describe('wallLengthPlace', () => {
  const below = [{ x: 100, y: 80 }];

  it('writes it on the far side of the wall from the cabinets', () => {
    const north = { start_x: 0, start_y: 0, end_x: 200, end_y: 0 };
    expect(wallLengthPlace(north, below, 10)).toEqual({ x: 100, y: -10, rotation: 0 });

    const east = { start_x: 200, start_y: 0, end_x: 200, end_y: 100 };
    expect(wallLengthPlace(east, below, 10)).toMatchObject({ x: 210, y: 50 });
  });

  it('gives the same place whichever way the wall was drawn', () => {
    const drawnBack = { start_x: 200, start_y: 0, end_x: 0, end_y: 0 };
    const place = wallLengthPlace(drawnBack, below, 10);
    expect(place.x).toBeCloseTo(100);
    expect(place.y).toBeCloseTo(-10);
  });

  it('never reads upside down', () => {
    const drawnBack = { start_x: 200, start_y: 0, end_x: 0, end_y: 0 };
    expect(wallLengthPlace(drawnBack, below, 10).rotation).toBe(360);
    const up = { start_x: 0, start_y: 100, end_x: 0, end_y: 0 };
    expect(wallLengthPlace(up, below, 10).rotation).toBe(90);
    const down = { start_x: 0, start_y: 0, end_x: 0, end_y: 100 };
    expect(wallLengthPlace(down, below, 10).rotation).toBe(90);
  });

  it('copes with walls and no cabinets', () => {
    const north = { start_x: 0, start_y: 0, end_x: 200, end_y: 0 };
    expect(wallLengthPlace(north, [], 10).x).toBe(100);
  });
});

describe('planFrame', () => {
  const plan = { walls: [wall], cabinets: [], appliances: [], scalePixelsPerFoot: SCALE };

  it('fits the plan, with two feet of room all round, in the picture', () => {
    const frame = planFrame(plan, 720, 750)!;
    expect(frame.minX).toBe(-40);
    expect(frame.maxX).toBe(240);
    expect(frame.minY).toBe(-40);
    expect(frame.maxY).toBe(40);
    expect(frame.width).toBeLessThanOrEqual(720);
    expect(frame.height).toBeLessThanOrEqual(750);
    // The plan's corner lands on the picture's corner.
    expect(frame.minX * frame.zoom + frame.x).toBeCloseTo(0);
    expect(frame.minY * frame.zoom + frame.y).toBeCloseTo(0);
  });

  it('counts a turned cabinet by its real corners', () => {
    const turned = { ...cabinet('c1', 'B30', 0, 30), rotation: 90 };
    const frame = planFrame({ ...plan, walls: [], cabinets: [turned] }, 720, 750)!;
    // Turned a quarter, its width runs down the page and its depth back from x = 0.
    expect(frame.minX).toBeCloseTo(-40 - 40);
    expect(frame.maxY).toBeCloseTo(50 + 40);
  });

  it('frames nothing when nothing is drawn', () => {
    expect(planFrame({ ...plan, walls: [] }, 720, 750)).toBeNull();
  });
});
