/**
 * Appliances in the cabinet sketch: the Edit tab's Appliance Detach &
 * Reset list, one shape per unit, so the plan and the 3D view show where
 * each one comes out and goes back. Like the cabinets, the Edit tab says
 * *which* appliances there are and the sketch only *where* they sit.
 *
 * An appliance that goes in or on a cabinet — a range in its range base, a
 * hood or OTR microwave over it, a wall oven or refrigerator in its tall
 * cabinet, a disposal under the sink — is hosted by that cabinet: it is
 * put there when it first appears and moves with it. The rest (a
 * dishwasher, a freestanding refrigerator, a cooktop) start in a row below
 * the drawing, to be dragged into place.
 *
 * Pure functions, like cabinetSketchLayout.ts.
 */

import type { SpecialtyType } from '@/types/cabinetEstimate';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import { inToPx, pointOnCabinet, snapDroppedCabinet } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { generateOverlayId } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchUtils';

/** Where an appliance sits: in the run on the floor, on the counter, hung over the range, in an oven cabinet, under the sink. */
export type ApplianceMount = 'floor' | 'counter' | 'hung' | 'oven' | 'under_sink';

export interface ApplianceSpec {
  /** Short code drawn on the plan. */
  code: string;
  label: string;
  /** Size, inches: along the run, front to back, and tall. */
  width: number;
  depth: number;
  height: number;
  mount: ApplianceMount;
  /** Cabinet specialties that hold it, first choice first. */
  hosts: SpecialtyType[];
  /** In a host, it takes the host's width (a range fills its opening). */
  fillsHost?: boolean;
  /** How the 3D view draws it. */
  model: 'fridge' | 'dishwasher' | 'range' | 'cooktop' | 'oven' | 'microwave' | 'hood' | 'disposal';
}

const RANGE_BASES: SpecialtyType[] = ['range_base_slide_in', 'range_base_drop_in'];

const range = (label: string, depth: number): ApplianceSpec => ({
  code: 'RANGE',
  label,
  width: 30,
  depth,
  height: 36,
  mount: 'floor',
  hosts: RANGE_BASES,
  fillsHost: true,
  model: 'range',
});
const cooktop = (label: string): ApplianceSpec => ({
  code: 'CT',
  label,
  width: 30,
  depth: 21,
  height: 2,
  mount: 'counter',
  hosts: [],
  model: 'cooktop',
});

/** The appliance_list types (backend appliance_labor.py), at common sizes. */
export const APPLIANCE_SPECS: Record<string, ApplianceSpec> = {
  refrigerator: {
    code: 'REF',
    label: 'Refrigerator',
    width: 36,
    depth: 30,
    height: 70,
    mount: 'floor',
    hosts: ['refrigerator_cabinet', 'refrigerator_wall_deep'],
    fillsHost: true,
    model: 'fridge',
  },
  refrigerator_builtin: {
    code: 'REF',
    label: 'Built-in Refrigerator',
    width: 36,
    depth: 24,
    height: 80,
    mount: 'floor',
    hosts: ['refrigerator_cabinet', 'refrigerator_wall_deep'],
    fillsHost: true,
    model: 'fridge',
  },
  dishwasher: { code: 'DW', label: 'Dishwasher', width: 24, depth: 24, height: 34.5, mount: 'floor', hosts: [], model: 'dishwasher' },
  range_electric: range('Range (Electric)', 27),
  range_gas: range('Range (Gas)', 27),
  range_electric_slide: range('Slide-in Range (Electric)', 25),
  range_gas_slide: range('Slide-in Range (Gas)', 25),
  range_dropin: range('Drop-in Range', 24),
  cooktop_electric: cooktop('Cooktop (Electric)'),
  cooktop_gas: cooktop('Cooktop (Gas)'),
  wall_oven: {
    code: 'OVEN',
    label: 'Wall Oven',
    width: 30,
    depth: 24,
    height: 29,
    mount: 'oven',
    hosts: ['oven_cabinet', 'double_oven_cabinet'],
    fillsHost: true,
    model: 'oven',
  },
  microwave_otr: {
    code: 'MW',
    label: 'OTR Microwave',
    width: 30,
    depth: 15,
    height: 16.5,
    mount: 'hung',
    hosts: ['otr_microwave_wall', ...RANGE_BASES],
    fillsHost: true,
    model: 'microwave',
  },
  hood_vent: {
    code: 'HOOD',
    label: 'Range Hood',
    width: 30,
    depth: 20,
    height: 6,
    mount: 'hung',
    hosts: RANGE_BASES,
    fillsHost: true,
    model: 'hood',
  },
  hood_wood_42: {
    code: 'HOOD',
    label: 'Wood Range Hood',
    width: 42,
    depth: 22,
    height: 30,
    mount: 'hung',
    hosts: RANGE_BASES,
    model: 'hood',
  },
  garbage_disposal: {
    code: 'GD',
    label: 'Disposal',
    width: 9,
    depth: 9,
    height: 13,
    mount: 'under_sink',
    hosts: ['sink_base', 'farmhouse_sink_base'],
    model: 'disposal',
  },
};

/** A type this catalog doesn't know (added on the backend later) still shows, as a box in the run. */
export function applianceSpec(type: string): ApplianceSpec {
  return (
    APPLIANCE_SPECS[type] ?? {
      code: type.slice(0, 4).toUpperCase(),
      label: type.replace(/_/g, ' '),
      width: 24,
      depth: 24,
      height: 34.5,
      mount: 'floor',
      hosts: [],
      model: 'dishwasher',
    }
  );
}

export const SINK_SPECIALTIES: SpecialtyType[] = ['sink_base', 'farmhouse_sink_base'];

/** Rectangle in a cabinet's local inches: [x0, z0, x1, z1], x along it, z from its back toward its front. */
export type LocalRect = [number, number, number, number];

/**
 * The sink on a sink base, in the base's local inches: its rim, set 2"
 * back from the doors (out to them for an apron front), each bowl inside
 * it, and the faucet behind it.
 */
export function sinkLayout(
  widthIn: number,
  depthIn: number,
  bowls: 1 | 2,
  apron = false
): { rim: LocalRect; bowls: LocalRect[]; faucet: [number, number] } {
  const rimW = Math.max(Math.min(widthIn - 6, bowls === 2 ? 33 : 30), 12);
  const z1 = apron ? depthIn : depthIn - 2;
  const z0 = Math.max(z1 - 18, 3);
  const x0 = (widthIn - rimW) / 2;
  const lip = 1.25;
  const divider = 1.5;
  const bowlW = (rimW - 2 * lip - (bowls - 1) * divider) / bowls;
  return {
    rim: [x0, z0, x0 + rimW, z1],
    bowls: Array.from({ length: bowls }, (_, i): LocalRect => {
      const bx = x0 + lip + i * (bowlW + divider);
      return [bx, z0 + lip, bx + bowlW, z1 - lip];
    }),
    faucet: [widthIn / 2, z0 - 1.5],
  };
}

type Host = Pick<CabinetSketchCabinet, 'id' | 'preset_code' | 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const canHost = (spec: ApplianceSpec, cabinet: Host, presets: PresetCatalog) => {
  const specialty = presets[cabinet.preset_code]?.specialty;
  return !!specialty && spec.hosts.includes(specialty);
};

/** A cabinet holds one appliance per place: a range base one range and one hood or microwave, a sink base one disposal. */
const slotOf = (hostId: string, spec: ApplianceSpec) => `${hostId}|${spec.mount}`;

/** Where an appliance sits in its host: across its middle, at its back (centred front to back on a counter or under a sink). */
export function hostedPose(
  spec: ApplianceSpec,
  host: Host,
  scalePixelsPerFoot: number
): Pick<CabinetSketchAppliance, 'x' | 'y' | 'width' | 'height' | 'rotation'> {
  const width = spec.fillsHost ? host.width : inToPx(spec.width, scalePixelsPerFoot);
  const height = inToPx(spec.depth, scalePixelsPerFoot);
  const centred = spec.mount === 'counter' || spec.mount === 'under_sink';
  const p = pointOnCabinet(host, (host.width - width) / 2, centred ? (host.height - height) / 2 : 0);
  return { x: p.x, y: p.y, width, height, rotation: host.rotation };
}

/** The plan footprint's middle. */
export function middleOf(a: Pick<CabinetSketchAppliance, 'x' | 'y' | 'width' | 'height' | 'rotation'>) {
  return pointOnCabinet(a, a.width / 2, a.height / 2);
}

/** Whether a plan point lies on a cabinet's (or appliance's) footprint. */
export function onFootprint(p: { x: number; y: number }, c: Host): boolean {
  const r = (c.rotation * Math.PI) / 180;
  const [dx, dy] = [p.x - c.x, p.y - c.y];
  const along = dx * Math.cos(r) + dy * Math.sin(r);
  const toFront = -dx * Math.sin(r) + dy * Math.cos(r);
  return along >= 0 && along <= c.width && toFront >= 0 && toFront <= c.height;
}

const samePose = (a: CabinetSketchAppliance, b: CabinetSketchAppliance) =>
  (a.host_id ?? null) === (b.host_id ?? null) &&
  (['x', 'y', 'width', 'height', 'rotation'] as const).every((k) => Math.abs(a[k] - b[k]) < 1e-6);

/** The first cabinet with room that holds the appliance, in the order of its hosts. */
function freeHost(spec: ApplianceSpec, cabinets: Host[], presets: PresetCatalog, taken: Set<string>) {
  for (const specialty of spec.hosts) {
    const host = cabinets.find(
      (c) => presets[c.preset_code]?.specialty === specialty && !taken.has(slotOf(c.id, spec))
    );
    if (host) return host;
  }
  return undefined;
}

/**
 * Bring the sketch's appliances in line with the Edit tab's list:
 *
 * - each unit keeps its shape (matched by type, in order); extra shapes
 *   are dropped;
 * - a hosted one follows its cabinet; when the cabinet is gone (or no
 *   longer holds it) it stays where it was, on its own;
 * - a new one goes into the first cabinet with room that holds it, else
 *   into a row under the drawing.
 *
 * `null` when nothing changes, so the caller can skip a dispatch.
 */
export function reconcileAppliances(
  appliances: CabinetSketchAppliance[],
  list: { type: string; qty: number }[],
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): CabinetSketchAppliance[] | null {
  const needed = new Map<string, number>();
  for (const { type, qty } of list) needed.set(type, (needed.get(type) ?? 0) + Math.max(0, Math.floor(qty || 0)));

  const byId = new Map(cabinets.map((c) => [c.id, c]));
  const taken = new Set<string>();
  const used = new Map<string, number>();
  const kept: CabinetSketchAppliance[] = [];
  let changed = false;
  for (const a of appliances) {
    const n = used.get(a.type) ?? 0;
    if (n >= (needed.get(a.type) ?? 0)) {
      changed = true;
      continue;
    }
    used.set(a.type, n + 1);
    const spec = applianceSpec(a.type);
    const host = a.host_id ? byId.get(a.host_id) : undefined;
    let next: CabinetSketchAppliance = a;
    if (host && canHost(spec, host, presets) && !taken.has(slotOf(host.id, spec))) {
      taken.add(slotOf(host.id, spec));
      next = { ...a, ...hostedPose(spec, host, scalePixelsPerFoot) };
    } else if (a.host_id) {
      next = { ...a, host_id: null };
    }
    if (!samePose(next, a)) changed = true;
    kept.push(next);
  }

  const missing: string[] = [];
  needed.forEach((count, type) => {
    for (let i = used.get(type) ?? 0; i < count; i++) missing.push(type);
  });
  if (missing.length === 0) return changed ? kept : null;

  // The row for appliances with no cabinet to go in: 2 ft under everything drawn.
  const pts = [
    ...walls.flatMap((w) => [
      { x: w.start_x, y: w.start_y },
      { x: w.end_x, y: w.end_y },
    ]),
    ...[...cabinets, ...kept].flatMap((c) => [
      pointOnCabinet(c, 0, 0),
      pointOnCabinet(c, c.width, 0),
      pointOnCabinet(c, 0, c.height),
      pointOnCabinet(c, c.width, c.height),
    ]),
  ];
  const ft = scalePixelsPerFoot;
  let rowX = pts.length > 0 ? Math.min(...pts.map((p) => p.x)) : 2 * ft;
  const rowY = pts.length > 0 ? Math.max(...pts.map((p) => p.y)) + 2 * ft : 2 * ft;

  for (const type of missing) {
    const spec = applianceSpec(type);
    const host = freeHost(spec, cabinets, presets, taken);
    if (host) {
      taken.add(slotOf(host.id, spec));
      kept.push({ id: generateOverlayId(), type, host_id: host.id, ...hostedPose(spec, host, scalePixelsPerFoot) });
      continue;
    }
    const width = inToPx(spec.width, scalePixelsPerFoot);
    kept.push({
      id: generateOverlayId(),
      type,
      x: rowX,
      y: rowY,
      width,
      height: inToPx(spec.depth, scalePixelsPerFoot),
      rotation: 0,
      host_id: null,
    });
    rowX += width + inToPx(6, scalePixelsPerFoot);
  }
  return kept;
}

/**
 * Free-standing floor and hung appliances, as neighbours a cabinet (or
 * another appliance) dropped beside them lines up with. Hosted ones are
 * left out: they sit where their cabinet already is.
 */
export function applianceNeighbors(appliances: CabinetSketchAppliance[]): CabinetSketchCabinet[] {
  return appliances
    .filter((a) => !a.host_id)
    .flatMap((a) => {
      const { mount } = applianceSpec(a.type);
      if (mount !== 'floor' && mount !== 'hung') return [];
      return [
        {
          id: a.id,
          preset_code: '',
          cab_type: mount === 'hung' ? ('wall' as const) : ('base' as const),
          x: a.x,
          y: a.y,
          width: a.width,
          height: a.height,
          rotation: a.rotation,
          label: '',
        },
      ];
    });
}

/**
 * Where a dragged appliance lands. Dropped on a cabinet that holds it (with
 * room), it goes in it and from then on moves with it. Otherwise it stands
 * on its own at its own size: a floor or hung one lines up with walls and
 * cabinets the way a cabinet would; one on a counter or under a sink stays
 * where it was dropped.
 */
export function placeDroppedAppliance(
  appliance: CabinetSketchAppliance,
  appliances: CabinetSketchAppliance[],
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): Partial<CabinetSketchAppliance> {
  const spec = applianceSpec(appliance.type);
  const taken = new Set(
    appliances
      .filter((o) => o.id !== appliance.id && o.host_id)
      .map((o) => slotOf(o.host_id as string, applianceSpec(o.type)))
  );
  const middle = middleOf(appliance);
  const host = cabinets.find(
    (c) => canHost(spec, c, presets) && !taken.has(slotOf(c.id, spec)) && onFootprint(middle, c)
  );
  if (host) return { host_id: host.id, ...hostedPose(spec, host, scalePixelsPerFoot) };

  const width = inToPx(spec.width, scalePixelsPerFoot);
  const height = inToPx(spec.depth, scalePixelsPerFoot);
  // Its own size, about the same middle (a host may have stretched it).
  const own = { ...appliance, ...pointOnCabinet(appliance, (appliance.width - width) / 2, (appliance.height - height) / 2), width, height };
  if (spec.mount !== 'floor' && spec.mount !== 'hung') return { host_id: null, x: own.x, y: own.y, width, height };
  const neighbors = [...cabinets, ...applianceNeighbors(appliances.filter((o) => o.id !== appliance.id))];
  const placed = snapDroppedCabinet(
    { id: own.id, cab_type: spec.mount === 'hung' ? 'wall' : 'base', x: own.x, y: own.y, width, height, rotation: own.rotation },
    neighbors,
    walls,
    scalePixelsPerFoot
  );
  return { host_id: null, ...placed, width, height };
}
