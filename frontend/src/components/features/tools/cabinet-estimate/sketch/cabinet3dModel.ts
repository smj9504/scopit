/**
 * 3D model of the cabinet sketch: each placed cabinet as a solid with its
 * doors and drawers on its door side, plus the drawn walls, in inches —
 * what the 3D view turns into meshes (see cabinet3dScene.ts).
 *
 * Built from the same data as the Front view: position and turn from the
 * floor plan, size from the Edit tab box, upper heights from
 * mountHeightsIn, fronts from facesFor — plus the sinks on sink bases and
 * the detach & reset appliances (sketchAppliances.ts). Pure, so it is
 * tested without WebGL.
 *
 * Coordinates: x and z are the plan's x and y in inches (z grows down the
 * screen), y is height above the floor. A cabinet's local frame is the
 * plan's: x along its run, z from its back (0) toward its doors.
 */

import type { DoorPattern } from '@/types/cabinetEstimate';
import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import {
  cabinetDepthIn,
  cabinetSizeIn,
  cornerKind,
  islandJointFillers,
  islandTopPieces,
  mountHeightsIn,
  polygonUnion,
  pxToIn,
  signedArea2,
  bayFront,
  wrapFront,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { COUNTER_TOP_IN, REVEAL_IN, TOE_KICK_IN, facesFor, fridgeOpeningHeight, ovenOpening } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import { SINK_SPECIALTIES, applianceSpec, middleOf, onFootprint, sinkLayout } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';
import type { ApplianceSpec, LocalRect } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';
import type { Face } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';

export type Pt2 = [number, number];

/** How far the toe kick is set back from the doors, inches. */
const TOE_SETBACK_IN = 3;
/** Countertop overhang past the doors, inches. */
const COUNTER_OVERHANG_IN = 1;

/**
 * A flat stretch of a cabinet's door side, local inches. It runs from `a`
 * to `b` left to right as seen standing in front of it, so its outward
 * normal is (-dz, dx); faces are measured along it from `a`.
 */
export interface FrontRun {
  a: Pt2;
  b: Pt2;
  faces: Face[];
}

export interface CabinetSolid {
  cabinet: CabinetSketchCabinet;
  /** Back-left corner on the floor plan, inches, and the plan rotation (degrees) about it. */
  x: number;
  z: number;
  rotation: number;
  /** Height of the cabinet's bottom above the floor. */
  bottom: number;
  /** Height of the box, from its bottom. */
  height: number;
  /** Plan outline, local inches. */
  outline: Pt2[];
  /**
   * Per outline side (point i to the next), whether it is a back, against
   * the wall the cabinet stands or hangs on: its own back, and an L or
   * diagonal corner's side leg, which backs onto the other wall — whether
   * or not that wall is drawn.
   */
  backs: boolean[];
  /** Recessed toe kick under a floor cabinet: its height (0 for none) and outline. */
  toeKick: number;
  toeOutline: Pt2[];
  fronts: FrontRun[];
  /** Countertop over a base, local inches, from the box top up to COUNTER_TOP_IN; null for none (an island's cabinets share islandTopSlabs). */
  counter: Pt2[] | null;
  /** A range: an appliance standing in the run, not a cabinet box. */
  appliance: boolean;
  glass: boolean;
  /** The pattern in its doors, if any. */
  doorPattern: DoorPattern | null;
  /** The sink set in a sink base's counter, local inches; null for none. */
  sink: { rim: LocalRect; bowls: LocalRect[]; faucet: [number, number] } | null;
}

/** A countertop over several cabinets, plan inches: from `bottom` up to COUNTER_TOP_IN, with openings cut through it. */
export interface CounterSlab {
  outline: Pt2[];
  holes: Pt2[][];
  bottom: number;
}

/** A tapered filler closing an angled joint, plan inches: from `toeKick` up to `height`, over a set-back toe kick. */
export interface FillerSolid {
  outline: Pt2[];
  height: number;
  toeKick: number;
  toeOutline: Pt2[] | null;
}

export interface WallSolid {
  id: string;
  a: Pt2;
  b: Pt2;
  thickness: number;
}

/** Faces laid out across [from, from + span] of the cabinet's width, stretched onto a run `len` long. */
function fitFaces(faces: Face[], from: number, span: number, len: number): Face[] {
  const k = span > 0 ? len / span : 1;
  return faces.map((f) => ({ ...f, x: (f.x - from) * k, w: f.w * k }));
}

const runLength = ({ a, b }: Pick<FrontRun, 'a' | 'b'>) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function cabinetSolid(
  cabinet: CabinetSketchCabinet,
  presets: PresetCatalog,
  scalePixelsPerFoot: number,
  bottom: number,
  sinkBowls: 1 | 2
): CabinetSolid {
  const specialty = presets[cabinet.preset_code]?.specialty;
  const { width: w, depth: d, height } = cabinetSizeIn(cabinet, presets, scalePixelsPerFoot);
  const kind = cornerKind(specialty);
  const right = cabinet.corner_side === 'right';
  const leg = Math.min(cabinetDepthIn(cabinet.cab_type, specialty), w, d);
  const faces = facesFor(cabinet.cab_type, specialty, w, height, cabinet.corner_side, cabinet.door_pattern);
  const appliance = specialty === 'range_base_slide_in' || specialty === 'range_base_drop_in';
  const mirror = (pts: Pt2[]): Pt2[] => (right ? pts.map(([x, z]) => [w - x, z] as Pt2) : pts);

  let outline: Pt2[];
  let fronts: FrontRun[];
  if (kind === 'l') {
    // The open leaf's doors face the room along the back leg; the other leg
    // gets a matching door on its inside face.
    outline = mirror([[0, 0], [w, 0], [w, leg], [leg, leg], [leg, d], [0, d]]);
    const side: Pick<FrontRun, 'a' | 'b'> = right
      ? { a: [w - leg, leg], b: [w - leg, d] }
      : { a: [leg, d], b: [leg, leg] };
    fronts = [
      { a: [0, leg], b: [w, leg], faces },
      { ...side, faces: fitFaces(faces, right ? 0 : leg, w - leg, runLength(side)) },
    ];
  } else if (kind === 'diagonal') {
    outline = mirror([[0, 0], [w, 0], [w, leg], [leg, d], [0, d]]);
    const cut: Pick<FrontRun, 'a' | 'b'> = right ? { a: [0, leg], b: [w - leg, d] } : { a: [leg, d], b: [w, leg] };
    fronts = [{ ...cut, faces: fitFaces(faces, right ? 0 : leg, w - leg, runLength(cut)) }];
  } else if (kind === 'end_wrap') {
    const front = wrapFront(w, d);
    outline = mirror([[0, 0], ...[...front].reverse()]);
    // Left to right as seen from in front, a door on each: front, cut, end.
    // With no door in line beside it, each says which edge its pull goes
    // on: the front and cut doors meet at their joint, the end door's is
    // on the edge toward them.
    const points = right ? [...front].reverse().map(([x, z]) => [w - x, z] as Pt2) : front;
    const pulls: Face['pull'][] = right ? ['right', 'right', 'left'] : ['right', 'left', 'left'];
    fronts = points.slice(0, 3).map((a, i) => {
      const b = points[i + 1];
      const len = runLength({ a, b });
      const door: Face = { ...faces[0], x: REVEAL_IN, w: len - 2 * REVEAL_IN, pull: pulls[i] };
      return { a, b, faces: [door] };
    });
  } else if (kind === 'bay_end') {
    const front = bayFront(w, d);
    outline = mirror([[0, 0], ...[...front].reverse()]);
    // Left to right as seen from in front, a door on each face, their pulls where they meet at the bend.
    const points = right ? [...front].reverse().map(([x, z]) => [w - x, z] as Pt2) : front;
    const pulls: Face['pull'][] = ['right', 'left'];
    fronts = points.slice(0, 2).map((a, i) => {
      const b = points[i + 1];
      const len = runLength({ a, b });
      const door: Face = { ...faces[0], x: REVEAL_IN, w: len - 2 * REVEAL_IN, pull: pulls[i] };
      return { a, b, faces: [door] };
    });
  } else if (kind === 'angle_end') {
    const outer = Math.max(d - w, 0);
    // A triangle once it is as wide as it is deep.
    outline = mirror(outer > 0 ? [[0, 0], [w, 0], [w, outer], [0, d]] : [[0, 0], [w, 0], [0, d]]);
    const cut: Pick<FrontRun, 'a' | 'b'> = right ? { a: [0, outer], b: [w, d] } : { a: [0, d], b: [w, outer] };
    fronts = [{ ...cut, faces: fitFaces(faces, 0, w, runLength(cut)) }];
  } else {
    // A plain box; a blind corner too, its covered end drawn as a panel.
    outline = [[0, 0], [w, 0], [w, d], [0, d]];
    fronts = [{ a: [0, d], b: [w, d], faces }];
  }

  const legX = right ? w : 0;
  const on = (v: number, at: number) => Math.abs(v - at) < 0.01;
  const backs = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    if (on(a[1], 0) && on(b[1], 0)) return true;
    return (kind === 'l' || kind === 'diagonal') && on(a[0], legX) && on(b[0], legX);
  });

  const straight = !kind || kind === 'blind';
  const onFloor = cabinet.cab_type !== 'wall' && !appliance;
  // An island's cabinets share one top (islandTopSlabs).
  const hasCounter = onFloor && cabinet.cab_type !== 'tall' && height < COUNTER_TOP_IN && cabinet.location !== 'island';
  return {
    cabinet,
    x: pxToIn(cabinet.x, scalePixelsPerFoot),
    z: pxToIn(cabinet.y, scalePixelsPerFoot),
    rotation: cabinet.rotation,
    bottom,
    // A range's top sits flush with the counters around it.
    height: appliance ? Math.max(height, COUNTER_TOP_IN) : height,
    outline,
    backs,
    toeKick: onFloor ? TOE_KICK_IN : 0,
    toeOutline: straight ? [[0, 0], [w, 0], [w, d - TOE_SETBACK_IN], [0, d - TOE_SETBACK_IN]] : outline,
    fronts,
    counter: !hasCounter
      ? null
      : straight
        ? [[0, 0], [w, 0], [w, d + COUNTER_OVERHANG_IN], [0, d + COUNTER_OVERHANG_IN]]
        : outline,
    appliance,
    glass: !!cabinet.has_glass_door,
    doorPattern: cabinet.door_pattern ?? null,
    sink:
      specialty && SINK_SPECIALTIES.includes(specialty) && cabinet.cab_type !== 'wall'
        ? sinkLayout(w, d, sinkBowls, specialty === 'farmhouse_sink_base')
        : null,
  };
}

/** `sinkBowls`: the Edit tab's sink type, for the sinks on sink bases. */
export function cabinetSolids(
  cabinets: CabinetSketchCabinet[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number,
  sinkBowls: 1 | 2 = 1
): CabinetSolid[] {
  const mounts = mountHeightsIn(cabinets, presets, scalePixelsPerFoot);
  return cabinets.map((c) => cabinetSolid(c, presets, scalePixelsPerFoot, mounts.get(c.id) ?? 0, sinkBowls));
}

/** A detach & reset appliance stood up where the plan puts it. */
export interface ApplianceSolid {
  appliance: CabinetSketchAppliance;
  spec: ApplianceSpec;
  /** Back-left corner on the floor plan, inches, and the plan rotation (degrees) about it. */
  x: number;
  z: number;
  rotation: number;
  width: number;
  /** Local z of its back, and its depth: in an oven cabinet, the oven is a door on the cabinet's opening. */
  back: number;
  depth: number;
  bottom: number;
  height: number;
  /** The cabinet it sits in or on: picking the appliance picks that cabinet. */
  hostId: string | null;
  /** A range in a range base is drawn instead of the base's own appliance box. */
  replacesHost: boolean;
  /** A counter runs over it, as over the bases beside it (a dishwasher). */
  counter: boolean;
}

/** Tops of an OTR microwave and of a hood with no upper over them: 30" over the cooktop, and under a standard 18" upper. */
const MICROWAVE_TOP_IN = 66;
const HOOD_TOP_IN = 72;

/**
 * The detach & reset appliances in 3D: a range on the floor (in its range
 * base if it has one), a hood or OTR microwave hung under the upper over
 * it, an oven in its cabinet's opening, a refrigerator under its upper or
 * in its cabinet, a cooktop on the counter, a disposal under the sink.
 */
export function applianceSolids(
  appliances: CabinetSketchAppliance[],
  cabinets: CabinetSketchCabinet[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): ApplianceSolid[] {
  const inches = (px: number) => pxToIn(px, scalePixelsPerFoot);
  const mounts = mountHeightsIn(cabinets, presets, scalePixelsPerFoot);
  const byId = new Map(cabinets.map((c) => [c.id, c]));
  const uppers = cabinets.filter((c) => c.cab_type === 'wall');
  return appliances.map((appliance) => {
    const spec = applianceSpec(appliance.type);
    const host = appliance.host_id ? byId.get(appliance.host_id) : undefined;
    const hostSpecialty = host ? presets[host.preset_code]?.specialty : undefined;
    // The upper over it: its host when that is an upper, else any upper over its middle.
    const middle = middleOf(appliance);
    const over = host?.cab_type === 'wall' ? host : uppers.find((u) => onFootprint(middle, u));
    const upperBottom = over ? mounts.get(over.id) : undefined;

    let bottom = 0;
    let height = spec.height;
    let back = 0;
    let depth = inches(appliance.height);
    if (spec.mount === 'counter') {
      bottom = COUNTER_TOP_IN;
      height = 0.4;
    } else if (spec.mount === 'under_sink') {
      bottom = 12;
    } else if (spec.mount === 'oven') {
      ({ bottom, height } = ovenOpening(hostSpecialty));
      if (host) {
        back = cabinetSizeIn(host, presets, scalePixelsPerFoot).depth + 0.3;
        depth = 1.2;
      }
    } else if (spec.mount === 'hung') {
      // A big wood hood starts 30" over the cooktop; the rest hang under the upper over them.
      const top = upperBottom ?? (spec.model === 'microwave' ? MICROWAVE_TOP_IN : HOOD_TOP_IN);
      bottom = spec.model === 'hood' && spec.height > 12 ? COUNTER_TOP_IN + 30 : top - spec.height;
    } else if (spec.model === 'fridge') {
      if (host && hostSpecialty === 'refrigerator_cabinet') {
        height = fridgeOpeningHeight(cabinetSizeIn(host, presets, scalePixelsPerFoot).height);
      } else if (upperBottom !== undefined) {
        height = Math.min(spec.height, upperBottom - 1);
      }
    }

    return {
      appliance,
      spec,
      x: inches(appliance.x),
      z: inches(appliance.y),
      rotation: appliance.rotation,
      width: inches(appliance.width),
      back,
      depth,
      bottom,
      height,
      hostId: host?.id ?? null,
      replacesHost:
        spec.model === 'range' && (hostSpecialty === 'range_base_slide_in' || hostSpecialty === 'range_base_drop_in'),
      counter: spec.mount === 'floor' && spec.model === 'dishwasher',
    };
  });
}

/** The plan corners of each appliance, inches, so the floor and the starting view take them in too. */
export function applianceExtent(appliances: ApplianceSolid[]): Pt2[] {
  return appliances.flatMap((a) =>
    (
      [
        [0, a.back],
        [a.width, a.back],
        [a.width, a.back + a.depth],
        [0, a.back + a.depth],
      ] as Pt2[]
    ).map((p) => toPlan(a, p))
  );
}

const toPlanIn = (p: { x: number; y: number }, scalePixelsPerFoot: number): Pt2 => [
  pxToIn(p.x, scalePixelsPerFoot),
  pxToIn(p.y, scalePixelsPerFoot),
];
const area2 = (loop: Pt2[]) => signedArea2(loop.map(([x, y]) => ({ x, y })));

/** Point in a polygon of any shape (even-odd). */
export function inPolygon([x, z]: Pt2, loop: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i];
    const [xj, zj] = loop[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The island countertop in one piece — the top the plan shades and
 * measures (islandTopPieces), outlined — where the island's cabinets lay
 * no counters of their own. An island cabinet standing through it (a
 * range, a tall) is cut out of it.
 */
export function islandTopSlabs(solids: CabinetSolid[], scalePixelsPerFoot: number, seatingOverhangIn = 0): CounterSlab[] {
  const island = solids.filter((s) => s.cabinet.location === 'island' && s.cabinet.cab_type !== 'wall');
  const under = island.filter((s) => s.height < COUNTER_TOP_IN);
  if (under.length === 0) return [];
  const loops = polygonUnion(islandTopPieces(solids.map((s) => s.cabinet), scalePixelsPerFoot, seatingOverhangIn)).map(
    (loop) => loop.map((p) => toPlanIn(p, scalePixelsPerFoot))
  );
  const through = polygonUnion(
    island.filter((s) => s.height >= COUNTER_TOP_IN).map((s) => s.outline.map((p) => toPlan(s, p)).map(([x, y]) => ({ x, y })))
  ).map((loop) => loop.map(({ x, y }) => [x, y] as Pt2));
  const holes = [...loops.filter((l) => area2(l) < 0), ...through];
  // It sits on the tallest of the cabinets under it.
  const bottom = Math.max(...under.map((s) => s.height));
  return loops
    .filter((l) => area2(l) > 0)
    .map((outline) => ({ outline, holes: holes.filter((h) => inPolygon(h[0], outline)), bottom }));
}

/**
 * The tapered fillers of an angled island (islandJointFillers), stood up:
 * on the door side, from a toe kick set back like the cabinets' to the
 * lower of the two box tops; at the backs, a panel from the floor.
 */
export function islandFillerSolids(solids: CabinetSolid[], scalePixelsPerFoot: number): FillerSolid[] {
  const heightOf = new Map(solids.map((s) => [s.cabinet.id, s.height]));
  return islandJointFillers(
    solids.map((s) => s.cabinet),
    scalePixelsPerFoot
  ).map(({ wedge, atFront, a, b }) => {
    const [hinge, ...outer] = wedge.map((p) => toPlanIn(p, scalePixelsPerFoot));
    const outline = [hinge, ...outer];
    const height = Math.min(heightOf.get(a.id) ?? COUNTER_TOP_IN, heightOf.get(b.id) ?? COUNTER_TOP_IN);
    if (!atFront) return { outline, height, toeKick: 0, toeOutline: null };
    // Each outer corner is on a cabinet's end, a box depth out from the hinge.
    const setBack = ([x, z]: Pt2): Pt2 => {
      const len = Math.hypot(x - hinge[0], z - hinge[1]);
      const k = len > 0 ? Math.max(len - TOE_SETBACK_IN, 0) / len : 0;
      return [hinge[0] + (x - hinge[0]) * k, hinge[1] + (z - hinge[1]) * k];
    };
    return { outline, height, toeKick: TOE_KICK_IN, toeOutline: [hinge, ...outer.map(setBack)] };
  });
}

export function wallSolids(walls: CabinetSketchWall[], scalePixelsPerFoot: number): WallSolid[] {
  const inches = (px: number) => pxToIn(px, scalePixelsPerFoot);
  return walls
    .filter((wall) => Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y) >= 1)
    .map((wall) => ({
      id: wall.id,
      a: [inches(wall.start_x), inches(wall.start_y)],
      b: [inches(wall.end_x), inches(wall.end_y)],
      thickness: Math.max(inches(wall.thickness || 0), 1),
    }));
}

/** A point of a cabinet's local frame on the floor plan, inches. */
export function toPlan(solid: Pick<CabinetSolid, 'x' | 'z' | 'rotation'>, [x, z]: Pt2): Pt2 {
  const r = (solid.rotation * Math.PI) / 180;
  return [solid.x + x * Math.cos(r) - z * Math.sin(r), solid.z + x * Math.sin(r) + z * Math.cos(r)];
}

/** Plan extent of the cabinets and walls (and any `extra` plan points), inches; null when there is nothing. */
export function modelBounds(
  solids: CabinetSolid[],
  walls: WallSolid[],
  extra: Pt2[] = []
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const pts: Pt2[] = [
    ...solids.flatMap((s) => s.outline.map((p) => toPlan(s, p))),
    ...walls.flatMap((w) => [w.a, w.b]),
    ...extra,
  ];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * The way most of the doors face, on the plan (unit vector), weighted by
 * cabinet width — where the camera stands to look at the kitchen from the
 * front. Straight down the screen when there is no clear answer.
 */
export function mainFacing(solids: CabinetSolid[]): Pt2 {
  let fx = 0;
  let fz = 0;
  for (const s of solids) {
    const r = (s.rotation * Math.PI) / 180;
    const w = s.outline.reduce((m, [x]) => Math.max(m, x), 0);
    fx += -Math.sin(r) * w;
    fz += Math.cos(r) * w;
  }
  const len = Math.hypot(fx, fz);
  return len < 1e-6 ? [0, 1] : [fx / len, fz / len];
}
