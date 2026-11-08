import { describe, it, expect } from 'vitest';
import type { BathroomSelection } from '@/types/bathroomEstimate';
import type { BEFixture, BESketchData } from '@/types/bathroomSketch';
import { DEFAULT_BE_SKETCH_SETTINGS } from '@/types/bathroomSketch';
import { fitFixturesToProducts, vanitySinks } from './productFit';

// 40 px to the foot: an 8 ft × 5 ft bath drawn from (0,0) to (320,200)
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, rotation = 0): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation, roomId: 'r', properties: {},
});
const sketch = (fixtures: BEFixture[]): BESketchData => ({
  version: '1.0.0',
  walls: [],
  rooms: [{
    id: 'r', name: 'Bath', roomType: 'bathroom',
    boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
    wallIds: [], heightInches: 96, floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 0, perimeterLF: 26,
  }],
  fixtures,
  tileZones: [],
  damageZones: [],
  drywallRepairZones: [],
  insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: 40 },
});
const pick = (fields: Partial<BathroomSelection>): BathroomSelection => ({
  product_id: 'p', category: 'vanity', title: 'Product', retailer: 'home_depot', price_unit: 'each',
  image_file_ids: [], look: {}, taken_at: '2026-10-26T10:00:00Z', ...fields,
});
const px = (inches: number) => (inches / 12) * 40;

describe('fitFixturesToProducts', () => {
  it('draws a tub in the corner at the picked size, still in its corner', () => {
    // 60" × 32" against the north and west walls
    const tub = fixture('tub', 'bathtub', px(30), px(16), 60, 32);
    const out = fitFixturesToProducts(sketch([tub]), { bathtub: pick({ width_in: 66, depth_in: 36 }) });
    const fitted = out.fixtures[0];
    expect(fitted.dimensions).toMatchObject({ width: 66, height: 36 });
    // Its top-left corner hasn't moved
    expect(fitted.position.x - px(66) / 2).toBeCloseTo(0);
    expect(fitted.position.y - px(36) / 2).toBeCloseTo(0);
    expect(fitted.properties.productTakenAt).toBe('2026-10-26T10:00:00Z');
  });

  it('turns a tub listed width-first to the way it is drawn', () => {
    // Drawn along the west wall: 32" across, 60" down
    const tub = fixture('tub', 'bathtub', px(16), px(30), 32, 60);
    const out = fitFixturesToProducts(sketch([tub]), { bathtub: pick({ width_in: 66, depth_in: 30 }) });
    expect(out.fixtures[0].dimensions).toMatchObject({ width: 30, height: 66 });
  });

  it('widens a vanity mid-wall evenly and keeps its back to the wall', () => {
    const vanity = fixture('v', 'vanity', 160, px(10.5), 36, 21);
    const out = fitFixturesToProducts(sketch([vanity]), { vanity: pick({ width_in: 48, depth_in: 22 }) });
    const fitted = out.fixtures[0];
    expect(fitted.dimensions).toMatchObject({ width: 48, height: 22 });
    expect(fitted.position.x).toBeCloseTo(160);
    expect(fitted.position.y - px(22) / 2).toBeCloseTo(0);
  });

  it('keeps a turned vanity against its wall', () => {
    // On the east wall, turned 90°: its back (local north) faces east
    const vanity = fixture('v', 'vanity', 320 - px(10.5), 100, 36, 21, 90);
    const fitted = fitFixturesToProducts(sketch([vanity]), { vanity: pick({ width_in: 36, depth_in: 24 }) }).fixtures[0];
    expect(fitted.position.x + px(24) / 2).toBeCloseTo(320);
    expect(fitted.position.y).toBeCloseTo(100);
  });

  it('sizes a fixture once per pick, so a hand resize afterwards stays', () => {
    const vanity = fixture('v', 'vanity', 160, px(10.5), 36, 21);
    const selections = { vanity: pick({ width_in: 48, depth_in: 21 }) };
    const once = fitFixturesToProducts(sketch([vanity]), selections);
    const byHand = { ...once, fixtures: [{ ...once.fixtures[0], dimensions: { width: 42, height: 21 } }] };
    expect(fitFixturesToProducts(byHand, selections)).toBe(byHand);
    // A new pick sizes it again
    const again = fitFixturesToProducts(byHand, { vanity: pick({ width_in: 30, depth_in: 21, taken_at: 'later' }) });
    expect(again.fixtures[0].dimensions.width).toBe(30);
  });

  it('gives a vanity as many sinks as the picked one has', () => {
    const double = { ...fixture('v', 'vanity', 160, px(10.5), 60, 21), properties: { sinkCount: 2 } };
    const single = pick({ title: 'Glacier Bay 48 in. Single Sink Bath Vanity', width_in: 48, depth_in: 21 });
    expect(fitFixturesToProducts(sketch([double]), { vanity: single }).fixtures[0].properties.sinkCount).toBe(1);
    expect(vanitySinks(pick({ title: 'Vanity', look: { bowls: 2 } }))).toBe(2);
    expect(vanitySinks(pick({ title: '72 in. Double Bath Vanity' }))).toBe(2);
    expect(vanitySinks(pick({ title: 'Sonoma 36 in. Vanity Cabinet' }))).toBeNull();
    // A listing that doesn't say leaves the drawing's sinks as they are
    const unsaid = fitFixturesToProducts(sketch([double]), { vanity: pick({ title: 'Sonoma Vanity', width_in: 60, depth_in: 21 }) });
    expect(unsaid.fixtures[0].properties.sinkCount).toBe(2);
  });

  it('hangs a picked mirror at its width along the wall and its height up it', () => {
    const mirror = fixture('m', 'mirror', 160, px(2), 30, 4);
    const out = fitFixturesToProducts(sketch([mirror]), { mirror: pick({ category: 'mirror', width_in: 24, depth_in: 1, height_in: 36 }) });
    expect(out.fixtures[0].dimensions).toEqual({ width: 24, height: 4 });
    expect(out.fixtures[0].properties.mirrorHeight).toBe(36);
  });

  it('leaves the drawing alone when a listing has no usable size', () => {
    const toilet = fixture('t', 'toilet', 100, 100, 20, 28);
    const out = fitFixturesToProducts(sketch([toilet]), { toilet: pick({ category: 'toilet', width_in: 2 }) });
    expect(out.fixtures[0].dimensions).toEqual({ width: 20, height: 28 });
    expect(fitFixturesToProducts(sketch([toilet]), null).fixtures[0]).toBe(toilet);
  });
});
