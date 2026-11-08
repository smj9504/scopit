/**
 * The Edit tab's Trim & Finished Panels, counted off the plan: fillers and
 * scribe, finished end panels (base, wall, tall, fridge deep) and
 * dishwasher return panels.
 *
 * Each end of each perimeter cabinet is looked at from the side: rays go
 * straight out of it — a quarter, half and three quarters of the way from
 * its back to its front — and the middle one of the three distances to the
 * first thing met (another cabinet, an appliance, a wall) decides the end:
 *
 * - a wall beside it — any wall crossing the 12" beside the end, over any
 *   part of its depth, the cabinet drawn short of it or into it: never an
 *   end panel; a scribed filler, unless the end is hidden behind the run
 *   that turns the corner in front of it;
 * - against the door side of a run that turns the corner (a dead or blind
 *   corner): a filler, so the doors and drawers clear each other;
 * - against another cabinet's side, or an appliance: nothing;
 * - across a gap in the run of up to 48" (an appliance's opening, drawn or
 *   not) to the next cabinet, or to the wall the run ends at: nothing;
 * - nothing there: the end shows, and takes a finished panel for its kind
 *   — base, wall or tall. A tall beside a base shows above the counter, so
 *   it takes one too.
 *
 * A Fridge Deep Upper marks a refrigerator opening: each side of it
 * without a wall or a tall cabinet beside it takes a fridge deep panel. A
 * free-standing refrigerator under a standard upper takes none. A
 * dishwasher (when the Appliance Detach & Reset list puts one on the plan)
 * takes a return panel at each side against a wall, at the door side of a
 * corner run, or open at a run end.
 *
 * Left out: island cabinets (the island's End / Back Panel SF prices
 * their ends), and the ends of an angled joint (Angled Joints bills their
 * filler). The ends are seen at the heights they stand at — a base's among
 * floor cabinets and appliances, an upper's among uppers and talls.
 *
 * Pure functions, like cabinetSketchLayout.ts.
 */

import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import { bayFront, buildElevations, cornerFootprint, inToPx, pxToIn, type PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { applianceSpec } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';

/** The Edit tab's Trim & Finished Panels fields this fills. */
export type TrimField =
  | 'filler_count'
  | 'end_panel_base'
  | 'end_panel_wall'
  | 'end_panel_tall'
  | 'end_panel_refrigerator'
  | 'dishwasher_return_panel_count';

export const TRIM_FIELDS: TrimField[] = [
  'filler_count',
  'end_panel_base',
  'end_panel_wall',
  'end_panel_tall',
  'end_panel_refrigerator',
  'dishwasher_return_panel_count',
];

/** As the Edit tab labels them. */
export const TRIM_FIELD_LABELS: Record<TrimField, string> = {
  filler_count: 'Fillers / Scribe',
  end_panel_base: 'Base End Panels',
  end_panel_wall: 'Wall End Panels',
  end_panel_tall: 'Tall End Panels',
  end_panel_refrigerator: 'Fridge Deep Panels',
  dishwasher_return_panel_count: 'DW Return Panels',
};

export type TrimCounts = Record<TrimField, number>;

/** One counted piece: where it goes and why. */
export interface TrimItem {
  field: TrimField;
  /** The run, the cabinet (or appliance) and which end of it, seen from the front. */
  where: string;
  why: string;
}

export interface TrimTakeoff {
  counts: TrimCounts;
  items: TrimItem[];
}

/** Two things this close (inches) touch. */
const TOUCH_IN = 2;
/**
 * A wall anywhere this close (inches) beside a cabinet end — over any part
 * of its depth, at any angle that crosses the run — means the end is set
 * against it: no end panel, a scribed filler to take up the gap. Generous,
 * since a run end is seldom drawn exactly to the side wall.
 */
const WALL_NEAR_IN = 12;
/** A wall at least this far off parallel to the way an end faces stands beside it; one closer to parallel is the wall behind the run. */
const WALL_CROSS_MIN_DEG = 30;
/** A run's back is on a wall when one is this close (inches) behind it. */
const BACK_ON_WALL_IN = 6;
/** A gap in a run up to this wide (inches) is an appliance's opening — dishwasher 24", range 30", refrigerator 36" — not open floor. */
const OPENING_MAX_IN = 48;
/** Two cabinets are in one run when they face the same way (degrees) with their backs this close (inches). */
const ROW_ANGLE_DEG = 3;
const ROW_BACK_IN = 6;
/** A neighbour turned more than this off a quarter turn is an angled joint (as countAngledJoints). */
const QUARTER_TOL_DEG = 10;
/** Where along an end the rays leave from, back to front. */
const RAY_AT = [0.25, 0.5, 0.75];
/** The rays start this far (inches) inside the end, so a neighbour flush against it is met at 0, not missed. */
const RAY_INSET_IN = 0.5;

interface Pt {
  x: number;
  y: number;
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

type Pose = Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** A pose's run axis (to its right, seen from the front) and the way its front faces. */
function frame(rotationDeg: number): { ux: Pt; front: Pt; back: Pt } {
  const r = (rotationDeg * Math.PI) / 180;
  const back = { x: Math.sin(r), y: -Math.cos(r) };
  return { ux: { x: Math.cos(r), y: Math.sin(r) }, front: scale(back, -1), back };
}

/** A local point (x along the run, y from the back toward the front) in the plan. */
function onPose(p: Pose, x: number, y: number): Pt {
  const { ux, front } = frame(p.rotation);
  return add({ x: p.x, y: p.y }, add(scale(ux, x), scale(front, y)));
}

function angleDiffDeg(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** How far two facings are from the nearest quarter turn apart, degrees. */
const offQuarterDeg = (a: number, b: number) => angleDiffDeg(b, a + Math.round((b - a) / 90) * 90);

// ---------------------------------------------------------------------------
// What the rays can meet
// ---------------------------------------------------------------------------

/** Which side of a cabinet an edge of its footprint is. */
type EdgeKind = 'back' | 'end' | 'front' | 'wall';

/** What an end beside it needs differs by what it is. */
type ObstacleKind = 'base' | 'upper' | 'tall' | 'fridge' | 'appliance' | 'wall';

interface Obstacle {
  kind: ObstacleKind;
  /** Stands among the floor cabinets / hangs among the uppers. */
  floor: boolean;
  upper: boolean;
  /** The cabinet or appliance (absent for a wall), for its facing and its run. */
  pose?: Pose & { id: string };
  location?: CabinetSketchCabinet['location'];
  poly: Pt[];
  /** edges[i] runs from poly[i] to poly[i + 1]. */
  edges: EdgeKind[];
  /** A wall's direction, unit length. */
  dir?: Pt;
}

type Local = [number, number];

/** A cabinet's footprint in its own pixels, each edge named, its corner end on the left unless corner_side is right. */
function localOutline(c: CabinetSketchCabinet, presets: PresetCatalog, scalePx: number): { pts: Local[]; kinds: EdgeKind[] } {
  const [w, h] = [c.width, c.height];
  const corner = cornerFootprint(c, presets, scalePx);
  let pts: Local[];
  let kinds: EdgeKind[];
  switch (corner?.kind) {
    case 'l': {
      const d = corner.leg;
      pts = [[0, 0], [w, 0], [w, d], [d, d], [d, h], [0, h]];
      kinds = ['back', 'end', 'front', 'front', 'end', 'back'];
      break;
    }
    case 'diagonal': {
      const d = corner.leg;
      pts = [[0, 0], [w, 0], [w, d], [d, h], [0, h]];
      kinds = ['back', 'end', 'front', 'end', 'back'];
      break;
    }
    case 'angle_end': {
      const outer = Math.max(h - w, 0);
      pts = [[0, 0], [w, 0], [w, outer], [0, h]];
      kinds = ['back', 'end', 'front', 'end'];
      break;
    }
    case 'end_wrap': {
      // As wrapFront: doors on the front, the 45° cut and the open end.
      const cut = Math.min(h / (1 + Math.SQRT2), w / 2);
      pts = [[0, 0], [w, 0], [w, h - cut], [w - cut, h], [0, h]];
      kinds = ['back', 'front', 'front', 'front', 'end'];
      break;
    }
    case 'bay_end': {
      // As bayFront: two door faces from the wall round to the end that joins the run.
      const [, bend] = bayFront(w, h);
      pts = [[0, 0], [w, 0], bend, [0, h]];
      kinds = ['back', 'front', 'front', 'end'];
      break;
    }
    default:
      pts = [[0, 0], [w, 0], [w, h], [0, h]];
      kinds = ['back', 'end', 'front', 'end'];
  }
  if (corner?.side === 'right') pts = pts.map(([x, y]) => [w - x, y]);
  return { pts, kinds };
}

const isFridgeUpper = (c: CabinetSketchCabinet, presets: PresetCatalog) =>
  presets[c.preset_code]?.specialty === 'refrigerator_wall_deep';

function cabinetObstacle(c: CabinetSketchCabinet, presets: PresetCatalog, scalePx: number): Obstacle {
  const { pts, kinds } = localOutline(c, presets, scalePx);
  const poly = pts.map(([x, y]) => onPose(c, x, y));
  const base = { pose: c, location: c.location, poly, edges: kinds };
  // A fridge deep upper stands for the refrigerator opening under it too.
  if (isFridgeUpper(c, presets)) return { ...base, kind: 'fridge', floor: true, upper: true };
  if (c.cab_type === 'tall') return { ...base, kind: 'tall', floor: true, upper: true };
  if (c.cab_type === 'wall') return { ...base, kind: 'upper', floor: false, upper: true };
  return { ...base, kind: 'base', floor: true, upper: false };
}

/** A free-standing appliance on the floor; one in a cabinet is inside that cabinet's footprint already. */
function applianceObstacle(a: CabinetSketchAppliance): Obstacle | null {
  if (a.host_id) return null;
  const spec = applianceSpec(a.type);
  if (spec.mount !== 'floor') return null;
  const poly = [onPose(a, 0, 0), onPose(a, a.width, 0), onPose(a, a.width, a.height), onPose(a, 0, a.height)];
  return {
    kind: spec.model === 'fridge' ? 'fridge' : 'appliance',
    floor: true,
    upper: false,
    pose: a,
    poly,
    edges: ['back', 'end', 'front', 'end'],
  };
}

function wallObstacle(w: CabinetSketchWall): Obstacle | null {
  const a = { x: w.start_x, y: w.start_y };
  const b = { x: w.end_x, y: w.end_y };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const half = Math.max(w.thickness || 0, 1) / 2;
  const dir = scale(sub(b, a), 1 / len);
  const n = scale({ x: -dir.y, y: dir.x }, half);
  return {
    kind: 'wall',
    floor: true,
    upper: true,
    poly: [add(a, n), add(b, n), sub(b, n), sub(a, n)],
    edges: ['wall', 'wall', 'wall', 'wall'],
    dir,
  };
}

/** Whether two convex polygons overlap or touch (separating axis test). */
function convexOverlap(p: Pt[], q: Pt[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const axis = { x: -e.y, y: e.x };
      if (Math.hypot(axis.x, axis.y) < 1e-9) continue;
      const span = (pts: Pt[]) => {
        const d = pts.map((v) => dot(v, axis));
        return [Math.min(...d), Math.max(...d)];
      };
      const [p0, p1] = span(p);
      const [q0, q1] = span(q);
      const eps = 1e-9 * Math.hypot(axis.x, axis.y);
      if (p1 < q0 - eps || q1 < p0 - eps) return false;
    }
  }
  return true;
}

/** Even-odd point in polygon (the L-shaped corners aren't convex). */
function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    const crosses = (a.y > p.y) !== (b.y > p.y);
    if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a);
  const len2 = dot(d, d);
  const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / len2)) : 0;
  const q = add(a, scale(d, t));
  return Math.hypot(p.x - q.x, p.y - q.y);
}

interface Hit {
  /** From the ray's start, pixels. */
  t: number;
  obstacle: Obstacle;
  edge: EdgeKind;
  point: Pt;
}

/** The first obstacle a ray meets; one the ray starts inside is met at once, on its nearest edge. */
function castRay(start: Pt, dir: Pt, obstacles: Obstacle[]): Hit | null {
  let best: Hit | null = null;
  for (const o of obstacles) {
    const n = o.poly.length;
    if (inside(start, o.poly)) {
      let edge = 0;
      let nearest = Infinity;
      for (let i = 0; i < n; i++) {
        const d = distToSegment(start, o.poly[i], o.poly[(i + 1) % n]);
        if (d < nearest) [nearest, edge] = [d, i];
      }
      if (!best || best.t > 0) best = { t: 0, obstacle: o, edge: o.edges[edge], point: start };
      continue;
    }
    for (let i = 0; i < n; i++) {
      const a = o.poly[i];
      const e = sub(o.poly[(i + 1) % n], a);
      const den = cross(dir, e);
      if (Math.abs(den) < 1e-12) continue;
      const ap = sub(a, start);
      const t = cross(ap, e) / den;
      const u = cross(ap, dir) / den;
      if (t < 0 || u < 0 || u > 1) continue;
      if (!best || t < best.t) best = { t, obstacle: o, edge: o.edges[i], point: add(start, scale(dir, t)) };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The ends looked at
// ---------------------------------------------------------------------------

type EndSide = 'left' | 'right';

/**
 * An end of a cabinet, in its own pixels: its back corner `a` and front
 * corner `b`, the way it faces `n`, and the way the back of the run it ends
 * faces `back` — the cabinet's own back, or for the side leg of an L its
 * side.
 */
interface LocalFace {
  end: EndSide;
  a: Local;
  b: Local;
  n: Local;
  back: Local;
}

const endFace = (end: EndSide, x: number, depth: number): LocalFace => ({
  end,
  a: [x, 0],
  b: [x, depth],
  n: [end === 'left' ? -1 : 1, 0],
  back: [0, -1],
});

/**
 * The ends that can show. An L or diagonal corner's are the ends of its two
 * legs; an angle end's (one, two or three doors) and a three-door corner's
 * only the end that joins the run — their open end is a door.
 */
function localFaces(c: Pose & Partial<CabinetSketchCabinet>, presets: PresetCatalog, scalePx: number): LocalFace[] {
  const [w, h] = [c.width, c.height];
  const corner = c.preset_code ? cornerFootprint(c as CabinetSketchCabinet, presets, scalePx) : null;
  let faces: LocalFace[];
  switch (corner?.kind) {
    case 'l':
    case 'diagonal':
      faces = [endFace('right', w, corner.leg), { end: 'left', a: [0, h], b: [corner.leg, h], n: [0, 1], back: [-1, 0] }];
      break;
    case 'angle_end':
    case 'end_wrap':
    case 'bay_end':
      faces = [endFace('left', 0, h)];
      break;
    default:
      faces = [endFace('left', 0, h), endFace('right', w, h)];
  }
  if (corner?.side !== 'right') return faces;
  const flip = (end: EndSide): EndSide => (end === 'left' ? 'right' : 'left');
  return faces.map((f) => ({
    end: flip(f.end),
    a: [w - f.a[0], f.a[1]],
    b: [w - f.b[0], f.b[1]],
    n: [-f.n[0], f.n[1]],
    back: [-f.back[0], f.back[1]],
  }));
}

/** A local direction in the plan. */
function planDir(pose: Pose, v: Local): Pt {
  const { ux, front } = frame(pose.rotation);
  return add(scale(ux, v[0]), scale(front, v[1]));
}

/** What the three rays out of an end met. */
interface FaceLook {
  /** The middle of the three, by distance; null when two or more met nothing. */
  mid: (Hit & { dist: number }) | null;
  all: ((Hit & { dist: number }) | null)[];
}

function lookOut(pose: Pose, face: LocalFace, obstacles: Obstacle[], scalePx: number): FaceLook {
  const inset = inToPx(RAY_INSET_IN, scalePx);
  const dir = planDir(pose, face.n);
  const all = RAY_AT.map((k) => {
    const lx = face.a[0] + (face.b[0] - face.a[0]) * k - face.n[0] * inset;
    const ly = face.a[1] + (face.b[1] - face.a[1]) * k - face.n[1] * inset;
    const hit = castRay(onPose(pose, lx, ly), dir, obstacles);
    return hit && { ...hit, dist: Math.max(0, pxToIn(hit.t - inset, scalePx)) };
  });
  const sorted = [...all].sort((p, q) => (p?.dist ?? Infinity) - (q?.dist ?? Infinity));
  return { mid: sorted[1], all };
}

/**
 * Whether a wall stands behind the run's back line `alongIn` inches out
 * past the end (negative: back inside the cabinet).
 */
function wallBehind(pose: Pose, face: LocalFace, alongIn: number, walls: Obstacle[], scalePx: number): boolean {
  const inset = inToPx(RAY_INSET_IN, scalePx);
  const back = planDir(pose, face.back);
  const start = add(
    onPose(pose, face.a[0], face.a[1]),
    add(scale(planDir(pose, face.n), inToPx(alongIn, scalePx)), scale(back, -inset))
  );
  const hit = castRay(start, back, walls);
  return !!hit && pxToIn(hit.t - inset, scalePx) <= BACK_ON_WALL_IN;
}

/**
 * Whether a wall stands beside the end: one crossing the strip that runs
 * WALL_NEAR_IN out from the end, over its whole depth — however little of
 * the depth it covers, and also when the cabinet is drawn into it. Walls
 * near parallel to the way the end faces are left out: that is the wall
 * behind the run.
 */
function wallBeside(pose: Pose, face: LocalFace, walls: Obstacle[], scalePx: number): boolean {
  const inset = inToPx(RAY_INSET_IN, scalePx);
  const out = inToPx(WALL_NEAR_IN, scalePx);
  const at = (p: Local, k: number) => onPose(pose, p[0] + face.n[0] * k, p[1] + face.n[1] * k);
  const strip = [at(face.a, -inset), at(face.b, -inset), at(face.b, out), at(face.a, out)];
  const dir = planDir(pose, face.n);
  const minCross = Math.sin((WALL_CROSS_MIN_DEG * Math.PI) / 180);
  return walls.some((w) => !!w.dir && Math.abs(cross(w.dir, dir)) >= minCross && convexOverlap(strip, w.poly));
}

/** Whether a cabinet or appliance continues the run the end belongs to: facing the same way, its back on the same line. */
function continuesRun(pose: Pose, face: LocalFace, other: Pose, scalePx: number): boolean {
  const back = planDir(pose, face.back);
  const otherBack = frame(other.rotation).back;
  const angle = (Math.acos(Math.max(-1, Math.min(1, dot(back, otherBack)))) * 180) / Math.PI;
  if (angle > ROW_ANGLE_DEG) return false;
  const offset = dot(sub({ x: other.x, y: other.y }, onPose(pose, face.a[0], face.a[1])), back);
  return Math.abs(offset) <= inToPx(ROW_BACK_IN, scalePx);
}

/** Which end of a cabinet a point beside it is nearer. */
function endNear(pose: Pose, p: Pt): EndSide {
  return dot(sub(p, { x: pose.x, y: pose.y }), frame(pose.rotation).ux) < pose.width / 2 ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// The takeoff
// ---------------------------------------------------------------------------

const ZERO: TrimCounts = {
  filler_count: 0,
  end_panel_base: 0,
  end_panel_wall: 0,
  end_panel_tall: 0,
  end_panel_refrigerator: 0,
  dishwasher_return_panel_count: 0,
};

/**
 * Count the Trim & Finished Panels the plan calls for. See the top of this
 * file for the rules; `items` says where each counted piece goes.
 */
export function takeoffTrim(
  cabinets: CabinetSketchCabinet[],
  appliances: CabinetSketchAppliance[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePx: number
): TrimTakeoff {
  const cabObstacles = cabinets.map((c) => ({ c, o: cabinetObstacle(c, presets, scalePx) }));
  const wallObstacles = walls.map(wallObstacle).filter((o): o is Obstacle => o !== null);
  const all: Obstacle[] = [
    ...cabObstacles.map((x) => x.o),
    ...appliances.map(applianceObstacle).filter((o): o is Obstacle => o !== null),
    ...wallObstacles,
  ];
  const others = (id: string, keep: (o: Obstacle) => boolean) => all.filter((o) => o.pose?.id !== id && keep(o));

  const runOf = new Map<string, string>();
  for (const run of buildElevations(cabinets, walls, presets, scalePx)) {
    for (const item of run.items) runOf.set(item.cabinet.id, run.label);
  }
  const whereOf = (c: CabinetSketchCabinet, end: EndSide) => {
    const run = runOf.get(c.id);
    return `${run ? `${run} · ` : ''}${c.label || c.preset_code}, ${end} end`;
  };

  const counts: TrimCounts = { ...ZERO };
  const items: TrimItem[] = [];
  const count = (field: TrimField, where: string, why: string) => {
    counts[field]++;
    items.push({ field, where, why });
  };

  // Ends against a wall wait until every end has been seen: one hidden
  // behind the run that turns the corner in front of it takes no filler.
  const atWall: { c: CabinetSketchCabinet; end: EndSide }[] = [];
  const hidden = new Set<string>();

  for (const { c } of cabObstacles) {
    if (c.location === 'island') continue;
    const fridge = isFridgeUpper(c, presets);
    const level = c.cab_type === 'wall' && !fridge ? 'upper' : 'floor';
    const near = others(c.id, (o) => (level === 'upper' ? o.upper : o.floor));
    const fullHeight = others(c.id, (o) => o.kind === 'tall' || o.kind === 'fridge' || o.kind === 'wall');

    for (const face of localFaces(c, presets, scalePx)) {
      const where = whereOf(c, face.end);

      const besideWall = wallBeside(c, face, wallObstacles, scalePx);

      if (fridge) {
        // The refrigerator opening's side: a wall or a tall closes it, else a deep panel.
        const side = lookOut(c, face, fullHeight, scalePx).mid;
        const closed = besideWall || (side && side.obstacle.kind !== 'wall' && side.dist <= TOUCH_IN);
        if (!closed) count('end_panel_refrigerator', where, 'side of the refrigerator opening');
        continue;
      }

      const look = lookOut(c, face, near, scalePx);
      // Joined at an angle: the angled filler is the Angled Joints line.
      const depthIn = pxToIn(c.height, scalePx);
      const angled = look.all.some(
        (h) => h && h.dist <= depthIn && h.obstacle.pose && offQuarterDeg(c.rotation, h.obstacle.pose.rotation) > QUARTER_TOL_DEG
      );
      if (angled) continue;

      const mid = look.mid;
      if (mid && mid.obstacle.kind !== 'wall' && mid.dist <= TOUCH_IN) {
        if (mid.edge === 'front' && mid.obstacle.pose) {
          // Against the door side of the run turning the corner: a filler
          // for clearance, and that run's end is hidden behind this one.
          count('filler_count', where, 'inside corner');
          hidden.add(`${mid.obstacle.pose.id}|${endNear(mid.obstacle.pose, mid.point)}`);
        }
        if (c.cab_type === 'tall') {
          // A tall shows above whatever lower thing stands beside it.
          const tallSide = lookOut(c, face, fullHeight, scalePx).mid;
          const closed = tallSide && tallSide.obstacle.kind !== 'wall' && tallSide.dist <= TOUCH_IN;
          if (!closed) count('end_panel_tall', where, 'beside the counter — shows above it');
        }
        continue;
      }

      // A wall beside the end: never a panel, a scribed filler.
      if (besideWall) {
        atWall.push({ c, end: face.end });
        continue;
      }

      // A gap in a floor run up to an opening's width: an appliance stands
      // in it (drawn or not) — unless no wall runs behind the gap of a run
      // that has one, which makes it a doorway.
      if (level === 'floor' && mid && mid.dist <= OPENING_MAX_IN) {
        const far = mid.obstacle;
        const onWall = wallBehind(c, face, -3, wallObstacles, scalePx);
        const inRun = far.kind === 'wall' ? onWall : !!far.pose && continuesRun(c, face, far.pose, scalePx);
        const walled = !onWall || wallBehind(c, face, mid.dist / 2, wallObstacles, scalePx);
        if (inRun && walled) continue;
      }

      const field: TrimField =
        c.cab_type === 'wall' ? 'end_panel_wall' : c.cab_type === 'tall' ? 'end_panel_tall' : 'end_panel_base';
      count(field, where, 'open end');
    }
  }

  for (const { c, end } of atWall) {
    if (!hidden.has(`${c.id}|${end}`)) count('filler_count', whereOf(c, end), 'against the wall');
  }

  // Dishwashers on the plan (only when the Appliance Detach & Reset list has one).
  for (const a of appliances) {
    if (a.host_id || a.type !== 'dishwasher') continue;
    const near = others(a.id, (o) => o.floor);
    const sides = localFaces(a, presets, scalePx).map((face) => {
      const hit = lookOut(a, face, near, scalePx).mid;
      return {
        end: face.end,
        touching: hit && hit.obstacle.kind !== 'wall' && hit.dist <= TOUCH_IN ? hit : null,
        besideWall: wallBeside(a, face, wallObstacles, scalePx),
      };
    });
    // Not yet dragged into a run (it starts in a row under the drawing): nothing to count.
    if (!sides.some(({ touching }) => touching && touching.obstacle.kind !== 'appliance')) continue;
    // In an island, the island's end panel finishes it.
    if (sides.some(({ touching }) => touching?.obstacle.location === 'island')) continue;
    for (const { end, touching, besideWall } of sides) {
      const where = `Dishwasher, ${end} side`;
      if (touching) {
        if (touching.edge === 'front') count('dishwasher_return_panel_count', where, 'inside corner');
      } else if (besideWall) count('dishwasher_return_panel_count', where, 'against the wall');
      else count('dishwasher_return_panel_count', where, 'open end of the run');
    }
  }

  return { counts, items };
}
