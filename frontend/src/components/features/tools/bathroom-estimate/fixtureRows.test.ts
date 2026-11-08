import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom } from '@/types/bathroomSketch';
import {
  cabinetsFromSketch,
  isWallLight,
  lightPlanSize,
  lightsFromLegacy,
  lightsFromSketch,
  mergeFromSketch,
  withLightRows,
} from './fixtureRows';
import { soffitAreas } from './sketch/utils/soffit';
import { behind, placeFor } from './sketch/utils/hangOnWall';

// 40 px to the foot
const px = (inches: number) => (inches / 12) * 40;
const fixture = (
  id: string, type: BEFixture['type'], xIn: number, yIn: number, w: number, h: number,
  properties: BEFixture['properties'] = {}, rotation = 0,
): BEFixture => ({ id, type, position: { x: px(xIn), y: px(yIn) }, dimensions: { width: w, height: h }, rotation, roomId: 'r', properties });

// A 9 ft × 7 ft bath, 8 ft ceiling
const room: BERoom = {
  id: 'r', name: 'Bath', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: px(108), y: 0 }, { x: px(108), y: px(84) }, { x: 0, y: px(84) }],
  wallIds: [], heightInches: 96, floorAreaSF: 63, netFloorAreaSF: 63, wallAreaSF: 256, perimeterLF: 32,
};

describe('lights and cabinets by kind', () => {
  it('counts each light on the plan by kind, a vanity bar by its lights', () => {
    const rows = lightsFromSketch([
      fixture('can1', 'light', 20, 20, 6, 6, { lightType: 'recessed_multi', lightCount: 3 }),
      fixture('can2', 'light', 50, 20, 6, 6, { lightType: 'recessed', recessedParentId: 'can1' }),
      fixture('can3', 'light', 80, 20, 6, 6, { lightType: 'recessed', recessedParentId: 'can1' }),
      fixture('bar', 'light', 70, 2, 24, 5, { lightType: 'vanity_bar', lightBulbs: 3 }),
      fixture('ceiling', 'light', 54, 42, 12, 12, {}),
      fixture('sconce', 'light', 50, 2, 6, 5, { lightType: 'sconce' }),
      fixture('toilet', 'toilet', 20, 70, 15, 29),
    ]);
    expect(rows).toEqual([
      { type: 'vanity_bar', count: 1, bulbs: 3, from_sketch: true },
      { type: 'sconce', count: 1, from_sketch: true },
      { type: 'ceiling', count: 1, from_sketch: true },
      { type: 'recessed', count: 3, from_sketch: true },
    ]);
  });

  it('counts cabinets by kind', () => {
    expect(cabinetsFromSketch([
      fixture('m', 'cabinet', 70, 2, 24, 5, { cabinetType: 'medicine_cabinet' }),
      fixture('w', 'cabinet', 20, 4, 24, 8, { cabinetType: 'wall_cabinet' }),
      fixture('w2', 'cabinet', 40, 4, 24, 8, { cabinetType: 'wall_cabinet' }),
    ])).toEqual([
      { type: 'medicine_cabinet', count: 1, from_sketch: true },
      { type: 'wall_cabinet', count: 2, from_sketch: true },
    ]);
  });

  it('keeps New or D&R across plan changes, and typed rows of kinds the plan lacks', () => {
    const current = [
      { type: 'recessed', count: 4, action: 'detach_reset' as const, from_sketch: true },
      { type: 'vanity_bar', count: 1, bulbs: 2, action: 'detach_reset' as const },
      { type: 'pendant', count: 1, action: 'replace' as const },
    ];
    const merged = mergeFromSketch(current, [
      { type: 'recessed', count: 5, from_sketch: true },
      { type: 'vanity_bar', count: 1, bulbs: 3, from_sketch: true },
    ]);
    expect(merged).toEqual([
      { type: 'recessed', count: 5, from_sketch: true, action: 'detach_reset' },
      // Drawn now: the typed row of its kind gives way, its D&R kept
      { type: 'vanity_bar', count: 1, bulbs: 3, from_sketch: true, action: 'detach_reset' },
      { type: 'pendant', count: 1, action: 'replace' },
    ]);
    // Everything taken off the plan: only the typed rows stay
    expect(mergeFromSketch(merged, [])).toEqual([{ type: 'pendant', count: 1, action: 'replace' }]);
  });

  it('reads an estimate saved with one vanity light and one ceiling light as rows', () => {
    expect(lightsFromLegacy({
      replace_vanity_light: true,
      electrical_spec: { ceiling_fixture: 'recessed_multi', recessed_can_count: 6 },
    })).toEqual([
      { type: 'vanity_bar', count: 1, action: 'replace' },
      { type: 'recessed', count: 6, action: 'replace' },
    ]);
    expect(lightsFromLegacy({ detach_reset_vanity_light: true, electrical_spec: { ceiling_fixture: 'standard' } }))
      .toEqual([{ type: 'vanity_bar', count: 1, action: 'detach_reset' }, { type: 'ceiling', count: 1, action: 'replace' }]);
    expect(lightsFromLegacy({ electrical_spec: { lights: [] } })).toBeNull();

    const est = withLightRows({ replace_vanity_light: true, electrical_spec: { gfci_count: 1, ceiling_fixture: 'standard' } });
    expect(est.replace_vanity_light).toBe(false);
    expect(est.electrical_spec).toEqual({
      gfci_count: 1,
      lights: [{ type: 'vanity_bar', count: 1, action: 'replace' }, { type: 'ceiling', count: 1, action: 'replace' }],
    });
  });

  it('sizes a vanity bar by its lights and knows a wall light from a ceiling one', () => {
    expect(lightPlanSize('vanity_bar', 3)).toEqual({ width: 24, height: 5 });
    expect(lightPlanSize('recessed_multi')).toEqual({ width: 6, height: 6 });
    expect(isWallLight('sconce')).toBe(true);
    expect(isWallLight('standard')).toBe(false);
    expect(isWallLight(undefined)).toBe(false);
  });
});

describe('hanging things on the wall', () => {
  it('puts a vanity bar on the wall behind the vanity, turned as it is', () => {
    // A 36" vanity against the north wall, and one turned to the east wall
    const vanity = fixture('v', 'vanity', 54, 10.5, 36, 21);
    const spot = behind(vanity, 5, 0, 40);
    expect(spot.position.x).toBeCloseTo(px(54));
    expect(spot.position.y).toBeCloseTo(px(2.5));
    const turned = fixture('v2', 'vanity', 97.5, 42, 36, 21, {}, 90);
    const onEast = behind(turned, 5, 0, 40);
    expect(onEast.position.x).toBeCloseTo(px(108 - 2.5));
    expect(onEast.position.y).toBeCloseTo(px(42));
    expect(onEast.rotation).toBe(90);
  });

  it('puts a wall cabinet behind the toilet and a soffit over the tub', () => {
    const toilet = fixture('t', 'toilet', 20, 14.5, 15, 29);
    const tub = fixture('tub', 'bathtub', 30, 16, 60, 32);
    const cab = fixture('c', 'cabinet', 54, 42, 24, 8);
    expect(placeFor([toilet, tub, cab], cab, 'wall_cabinet', { width: 24, height: 8 }, 40)?.position.y).toBeCloseTo(px(4));
    const soffit = fixture('s', 'soffit', 54, 42, 60, 30);
    const over = placeFor([toilet, tub, soffit], soffit, 'soffit', soffit.dimensions, 40);
    expect(over).toMatchObject({ position: tub.position, dimensions: { width: 60, height: 32 } });
    expect(placeFor([soffit], soffit, 'soffit', soffit.dimensions, 40)).toBeNull();
  });
});

describe('soffitAreas', () => {
  it('takes the wall behind a soffit over an alcove tub and adds its front face', () => {
    // 60" × 32" over the tub in the north-west corner, 12" down from an 8 ft ceiling;
    // its east side stands out into the room too (the tub doesn't reach the east wall)
    const soffit = fixture('s', 'soffit', 30, 16, 60, 32, { soffitBottom: 84 });
    expect(soffitAreas([soffit], room, 40)).toEqual({
      // North wall 5 ft and west wall 2'8" behind it, 1 ft down
      soffit_hidden_wall_sf: 7.7,
      // Its south face 5 ft and east face 2'8", 1 ft each
      soffit_face_sf: 7.7,
    });
    expect(soffitAreas([], room, 40)).toEqual({ soffit_hidden_wall_sf: 0, soffit_face_sf: 0 });
  });
});
