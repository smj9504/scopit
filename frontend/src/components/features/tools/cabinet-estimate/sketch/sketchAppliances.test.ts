import { describe, it, expect } from 'vitest';
import {
  applianceNeighbors,
  applianceSpec,
  placeDroppedAppliance,
  reconcileAppliances,
  sinkLayout,
} from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';
import { applianceSolids, cabinetSolids } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';

const SCALE = 20; // px per foot: 1" = 5/3 px
const px = (inches: number) => (inches / 12) * SCALE;
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  RB30S: { width: 30, height: 34.5, specialty: 'range_base_slide_in' },
  SB36: { width: 36, height: 34.5, specialty: 'sink_base' },
  FSB33: { width: 33, height: 34.5, specialty: 'farmhouse_sink_base' },
  WMW30: { width: 30, height: 18, specialty: 'otr_microwave_wall' },
  W3015: { width: 30, height: 15 },
  W3030: { width: 30, height: 30 },
  OC33: { width: 33, height: 84, specialty: 'oven_cabinet' },
};

/** A cabinet in a north-backed run starting at x = 40 px, `at` inches along it. */
const cab = (id: string, code: string, at: number, over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => {
  const p = PRESETS[code];
  const wall = code.startsWith('W');
  return {
    id,
    preset_code: code,
    cab_type: wall ? 'wall' : code.startsWith('OC') ? 'tall' : 'base',
    x: 40 + px(at),
    y: 40,
    width: px(p.width),
    height: px(wall ? 12 : 24),
    rotation: 0,
    label: code,
    location: 'perimeter',
    width_in: p.width,
    height_in: p.height,
    ...over,
  };
};
const NO_WALLS: CabinetSketchWall[] = [];
const sync = (apps: CabinetSketchAppliance[], list: { type: string; qty: number }[], cabinets: CabinetSketchCabinet[]) =>
  reconcileAppliances(apps, list, cabinets, NO_WALLS, PRESETS, SCALE);

describe('reconcileAppliances', () => {
  const kitchen = [cab('b1', 'B30', 0), cab('range', 'RB30S', 30), cab('sink', 'SB36', 60), cab('mwcab', 'WMW30', 30)];

  it('puts each appliance in the cabinet that holds it, and the rest in a row below', () => {
    const apps = sync([], [
      { type: 'range_gas_slide', qty: 1 },
      { type: 'microwave_otr', qty: 1 },
      { type: 'garbage_disposal', qty: 1 },
      { type: 'dishwasher', qty: 1 },
    ], kitchen)!;
    expect(apps).toHaveLength(4);
    const byType = Object.fromEntries(apps.map((a) => [a.type, a]));
    // The range fills its range base.
    expect(byType.range_gas_slide).toMatchObject({ host_id: 'range', x: 40 + px(30), y: 40, rotation: 0 });
    expect(byType.range_gas_slide.width).toBeCloseTo(px(30));
    // The microwave hangs in the OTR microwave cabinet's place; the disposal sits mid sink base.
    expect(byType.microwave_otr.host_id).toBe('mwcab');
    expect(byType.garbage_disposal.host_id).toBe('sink');
    expect(byType.garbage_disposal.x + byType.garbage_disposal.width / 2).toBeCloseTo(40 + px(60 + 18));
    // No cabinet for a dishwasher: a row 2 ft under the drawing.
    expect(byType.dishwasher.host_id).toBeNull();
    expect(byType.dishwasher.y).toBeCloseTo(40 + px(24) + 2 * SCALE);
    // Nothing more to do on the next pass.
    expect(sync(apps, [
      { type: 'range_gas_slide', qty: 1 },
      { type: 'microwave_otr', qty: 1 },
      { type: 'garbage_disposal', qty: 1 },
      { type: 'dishwasher', qty: 1 },
    ], kitchen)).toBeNull();
  });

  it('keeps one appliance per place in a cabinet', () => {
    const apps = sync([], [{ type: 'hood_vent', qty: 1 }, { type: 'microwave_otr', qty: 1 }], [cab('range', 'RB30S', 0)])!;
    // The hood takes the range base's place overhead; the microwave has nowhere left to hang.
    expect(apps.find((a) => a.type === 'hood_vent')!.host_id).toBe('range');
    expect(apps.find((a) => a.type === 'microwave_otr')!.host_id).toBeNull();
  });

  it('moves an appliance with its cabinet, and leaves it standing when the cabinet goes', () => {
    const list = [{ type: 'range_gas', qty: 1 }];
    const apps = sync([], list, kitchen)!;
    const moved = kitchen.map((c) => (c.id === 'range' ? { ...c, x: 300, y: 200, rotation: 90 } : c));
    const [follows] = sync(apps, list, moved)!;
    expect(follows).toMatchObject({ host_id: 'range', x: 300, y: 200, rotation: 90 });
    const [stays] = sync([follows], list, moved.filter((c) => c.id !== 'range'))!;
    expect(stays).toMatchObject({ host_id: null, x: 300, y: 200, rotation: 90 });
  });

  it('drops the units taken off the list, and adds the ones put on it', () => {
    const apps = sync([], [{ type: 'dishwasher', qty: 2 }], [])!;
    expect(apps).toHaveLength(2);
    // Side by side, 6" apart.
    expect(apps[1].x - apps[0].x).toBeCloseTo(px(30));
    const one = sync(apps, [{ type: 'dishwasher', qty: 1 }], [])!;
    expect(one).toEqual([apps[0]]);
    expect(sync(one, [], [])).toEqual([]);
  });
});

describe('placeDroppedAppliance', () => {
  it('goes into the cabinet it is dropped on, else lines up beside the cabinets', () => {
    const kitchen = [cab('b1', 'B30', 0), cab('range', 'RB30S', 30)];
    const [range] = sync([], [{ type: 'range_electric', qty: 1 }], [])!;
    // Dropped over the range base: in it.
    const onBase = placeDroppedAppliance({ ...range, x: 40 + px(32), y: 45 }, [range], kitchen, NO_WALLS, PRESETS, SCALE);
    expect(onBase).toMatchObject({ host_id: 'range', x: 40 + px(30), y: 40 });
    // A dishwasher dropped just past the run's end butts against it, backs level.
    const [dw] = sync([], [{ type: 'dishwasher', qty: 1 }], [])!;
    const beside = placeDroppedAppliance({ ...dw, x: 40 + px(62), y: 44 }, [dw], kitchen, NO_WALLS, PRESETS, SCALE);
    expect(beside.host_id).toBeNull();
    expect(beside.x).toBeCloseTo(40 + px(60));
    expect(beside.y).toBeCloseTo(40);
  });

  it('counts free-standing floor appliances as neighbours, not ones in a cabinet', () => {
    const apps = sync([], [{ type: 'dishwasher', qty: 1 }, { type: 'range_gas', qty: 1 }], [cab('range', 'RB30S', 0)])!;
    expect(applianceNeighbors(apps).map((n) => n.id)).toEqual([apps.find((a) => a.type === 'dishwasher')!.id]);
  });
});

describe('sinks and appliances in 3D', () => {
  it('sets a sink in each sink base, one or two bowls, inside the cabinet', () => {
    const [plain, apron, b30] = cabinetSolids([cab('s', 'SB36', 0), cab('f', 'FSB33', 36), cab('b', 'B30', 69)], PRESETS, SCALE, 2);
    expect(b30.sink).toBeNull();
    expect(plain.sink!.bowls).toHaveLength(2);
    const [x0, z0, x1, z1] = plain.sink!.rim;
    expect(x0).toBeGreaterThan(0);
    expect(x1).toBeLessThan(36);
    expect(z0).toBeGreaterThan(plain.sink!.faucet[1]);
    expect(z1).toBe(22);
    // An apron front runs out to the doors.
    expect(apron.sink!.rim[3]).toBe(24);
    expect(sinkLayout(30, 24, 1).bowls).toHaveLength(1);
  });

  it('stands each appliance at its height: range in its base, microwave under its upper, oven in its opening', () => {
    const kitchen = [cab('range', 'RB30S', 0), cab('over', 'W3015', 0), cab('oven', 'OC33', 40), cab('w', 'W3030', 80)];
    const apps = sync([], [
      { type: 'range_gas_slide', qty: 1 },
      { type: 'microwave_otr', qty: 1 },
      { type: 'wall_oven', qty: 1 },
      { type: 'cooktop_gas', qty: 1 },
    ], kitchen)!;
    const solids = Object.fromEntries(applianceSolids(apps, kitchen, PRESETS, SCALE).map((s) => [s.appliance.type, s]));
    expect(solids.range_gas_slide).toMatchObject({ bottom: 0, height: 36, replacesHost: true, hostId: 'range' });
    // The short upper over the range lines its top up with the 30" one (84"), so it starts at 69"; the microwave hangs under it.
    expect(solids.microwave_otr.bottom + solids.microwave_otr.height).toBeCloseTo(69);
    expect(solids.wall_oven).toMatchObject({ bottom: 30, height: 30, hostId: 'oven' });
    expect(solids.wall_oven.back).toBeGreaterThan(24);
    expect(solids.cooktop_gas.bottom).toBe(36);
    expect(applianceSpec('steam_oven').code).toBe('STEA');
  });
});
