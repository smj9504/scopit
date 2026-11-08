/**
 * Layout model behind the cabinet sketch: keeps the placed shapes in step
 * with the Edit tab's box list, and derives the front elevations from the
 * floor plan.
 *
 * The Edit tab is the source of truth for *which* cabinets exist; the
 * sketch only owns *where* they sit. Boxes carry no stable id, so a sketch
 * shape is matched to a box by identity key (location + code + size) and
 * counted — 2 × B30 in the list means two B30 shapes on the canvas.
 *
 * Geometry convention (see CabinetSketchCabinet): (x, y) is the back-left
 * corner, the back edge is local y = 0, doors face local +y. With rotation
 * r, the run axis is ux = (cos r, sin r) and the back points along
 * back = (sin r, -cos r). Standing in front of a cabinet and facing it you
 * look along `back`, with +ux to your right — which is what the elevation
 * view draws left to right.
 *
 * Pure functions only, so the presets catalog is passed in rather than
 * imported (it lives in a .tsx component).
 */

import type { CabinetLocation, CabType, DoorPattern, SpecialtyType } from '@/types/cabinetEstimate';
import type { CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';
import { generateOverlayId } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchUtils';

export interface PresetDims {
  width: number;
  height: number;
  specialty?: SpecialtyType;
}
export type PresetCatalog = Record<string, PresetDims>;

/** The fields of an Edit-tab box the sketch cares about. */
export interface SketchBoxSource {
  code: string;
  cab_type: CabType;
  location: CabinetLocation;
  width_inches: number;
  height_inches: number;
  specialty_type?: SpecialtyType | null;
  has_glass_door?: boolean;
  door_pattern?: DoorPattern | null;
  qty: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Standard bottom of a 30"+ upper: 36" counter + 18" backsplash gap. */
export const UPPER_BOTTOM_IN = 54;
/** Where a new island run's back line sits, measured off the perimeter run: 24" base + 42" aisle. */
export const ISLAND_OFFSET_IN = 66;
/** How close (feet) a dragged cabinet's back edge must come to a wall to snap onto it. */
const WALL_SNAP_FT = 1.5;
/** How far apart (inches) two cabinets' facing sides may be and still butt together. */
const NEIGHBOR_SNAP_GAP_IN = 6;
/** How far out of line (inches) two backs may be for a cabinet to be levelled with its neighbour. */
const NEIGHBOR_SNAP_BACK_IN = 12;
/** A cabinet turned less than this off its neighbour is squared up to it. */
const NEIGHBOR_SNAP_ANGLE_DEG = 10;
/** Two cabinets share an elevation if their back lines are within this (inches). */
const RUN_BACK_TOLERANCE_IN = 6;
const ANGLE_TOLERANCE_DEG = 3;

// ---------------------------------------------------------------------------
// Units and vectors
// ---------------------------------------------------------------------------

export const pxToIn = (px: number, scalePixelsPerFoot: number) =>
  scalePixelsPerFoot > 0 ? (px * 12) / scalePixelsPerFoot : 0;
export const inToPx = (inches: number, scalePixelsPerFoot: number) => (inches / 12) * scalePixelsPerFoot;

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

function axes(rotationDeg: number): { ux: Pt; back: Pt } {
  const r = (rotationDeg * Math.PI) / 180;
  return { ux: { x: Math.cos(r), y: Math.sin(r) }, back: { x: Math.sin(r), y: -Math.cos(r) } };
}

/** Rotation (degrees) that points a cabinet's back along `back`. */
function rotationForBack(back: Pt): number {
  const ux = { x: -back.y, y: back.x };
  return (Math.atan2(ux.y, ux.x) * 180) / Math.PI;
}

function angleDiffDeg(a: number, b: number): number {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

// ---------------------------------------------------------------------------
// Real-world cabinet size
// ---------------------------------------------------------------------------

/** Box depth: uppers are 12" except the 24"-deep one over a refrigerator. */
export function cabinetDepthIn(cabType: CabType, specialty?: SpecialtyType | null): number {
  if (cabType === 'wall') return specialty === 'refrigerator_wall_deep' ? 24 : 12;
  return 24;
}

/**
 * How a corner cabinet's footprint differs from a plain box:
 * - 'l': lazy susan / easy-reach — an L, `width` along each wall;
 * - 'diagonal': the same reach with the inside corner cut on an angle;
 * - 'blind': a plain box whose corner end hides behind the other run;
 * - 'angle_end': a run end cut back at 45°, full depth only at the end
 *   that joins the run;
 * - 'end_wrap': a plain box at the open end of a run, its outer front
 *   corner cut at 45°, with doors that wrap round it: one on the front,
 *   one on the cut, one on the end (the three-door corner, and the
 *   three-door angle end, which is the same wrap 12" wide);
 * - 'bay_end': an angle end whose front bends once, two doors on two
 *   faces meeting at 135° (see bayFront).
 */
export type CornerKind = 'l' | 'diagonal' | 'blind' | 'angle_end' | 'end_wrap' | 'bay_end';

export function cornerKind(specialty?: SpecialtyType | null): CornerKind | null {
  switch (specialty) {
    case 'lazy_susan':
    case 'easy_reach_corner_wall':
      return 'l';
    case 'diagonal_corner_wall':
    case 'diagonal_corner_base':
      return 'diagonal';
    case 'three_door_corner_wall':
    case 'three_door_angle_end_wall':
      return 'end_wrap';
    case 'two_door_angle_end_wall':
      return 'bay_end';
    case 'angle_end_base':
    case 'angle_end_wall':
      return 'angle_end';
    case 'blind_corner':
    case 'blind_corner_wall':
      return 'blind';
    default:
      return null;
  }
}

/** Plan depth of the footprint: an L or diagonal corner reaches as far along the side wall as along its own. */
export function footprintDepthIn(cabType: CabType, specialty: SpecialtyType | null | undefined, widthIn: number): number {
  const kind = cornerKind(specialty);
  return kind === 'l' || kind === 'diagonal' ? widthIn : cabinetDepthIn(cabType, specialty);
}

/**
 * The door side of a three-door corner, `w` wide and `d` deep, its doors
 * wrapping the open end at local x = w: the four points from the front's
 * end at x = 0 round to the back, a door on each of the three stretches
 * between them — the front, the 45° cut across the corner, the end. The
 * cut is sized so its door and the end's come out the same width (7" on a
 * 12"-deep upper); no real one has been measured.
 */
export function wrapFront(w: number, d: number): [number, number][] {
  const cut = Math.min(d / (1 + Math.SQRT2), w / 2);
  return [
    [0, d],
    [w - cut, d],
    [w, d - cut],
    [w, 0],
  ];
}

/**
 * The door side of a two-door angle end, `w` along the wall and `d` deep:
 * the three points from the front corner at the end that joins the run
 * (x = 0) round to the wall at x = w, a door on each of the two faces. The
 * bend sits on the 45° line from the back corner, as far out as the box
 * is deep, so on a 12" x 12" the faces meet at 135° and leave the box's
 * sides at 67.5° — Wolf's WEC1230D, two 9 5/32" doors.
 */
export function bayFront(w: number, d: number): [number, number][] {
  return [
    [0, d],
    [w * Math.SQRT1_2, d * Math.SQRT1_2],
    [w, 0],
  ];
}

/** Length of a blind corner's end that the other run covers: that run's depth. */
export const blindLengthIn = (cabType: CabType) => (cabType === 'wall' ? 12 : 24);

/**
 * A corner cabinet's shape in plan pixels, for drawing. The corner end (an
 * angle end's full-depth end, the end of a three-door corner that joins
 * the run) is local x = 0 (the left end, seen from the front) unless
 * `corner_side` is 'right'. `null` for an ordinary box.
 */
export function cornerFootprint(
  cabinet: CabinetSketchCabinet,
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): { kind: CornerKind; side: 'left' | 'right'; leg: number; blind: number } | null {
  const specialty = presets[cabinet.preset_code]?.specialty;
  const kind = cornerKind(specialty);
  if (!kind) return null;
  return {
    kind,
    side: cabinet.corner_side ?? 'left',
    leg: inToPx(cabinetDepthIn(cabinet.cab_type, specialty), scalePixelsPerFoot),
    blind: Math.min(inToPx(blindLengthIn(cabinet.cab_type), scalePixelsPerFoot), cabinet.width * 0.75),
  };
}

/** Inches of a sketch shape, falling back to the catalog for sketches saved before the sync. */
export function cabinetSizeIn(
  cabinet: CabinetSketchCabinet,
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): { width: number; depth: number; height: number } {
  const preset = presets[cabinet.preset_code];
  const width = cabinet.width_in ?? preset?.width ?? pxToIn(cabinet.width, scalePixelsPerFoot);
  const height =
    cabinet.height_in ?? preset?.height ?? (cabinet.cab_type === 'wall' ? 30 : cabinet.cab_type === 'tall' ? 84 : 34.5);
  const depth = cabinet.depth_in ?? footprintDepthIn(cabinet.cab_type, preset?.specialty, width);
  return { width, depth, height };
}

/**
 * Height of each cabinet's bottom above the floor, in inches.
 *
 * Bases and talls stand on the floor. Uppers 30" and taller hang at the
 * standard 54"; shorter ones (over a fridge, range or OTR microwave) are
 * hung so their tops line up with the tallest regular upper in the same
 * location. Kept here, not in the elevation view, so a 3D view can reuse it.
 */
export function mountHeightsIn(
  cabinets: CabinetSketchCabinet[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): Map<string, number> {
  const topLine = new Map<string, number>();
  for (const c of cabinets) {
    if (c.cab_type !== 'wall') continue;
    const h = cabinetSizeIn(c, presets, scalePixelsPerFoot).height;
    if (h < 30) continue;
    const loc = c.location ?? 'perimeter';
    topLine.set(loc, Math.max(topLine.get(loc) ?? 0, UPPER_BOTTOM_IN + h));
  }

  const out = new Map<string, number>();
  for (const c of cabinets) {
    if (c.cab_type !== 'wall') {
      out.set(c.id, 0);
      continue;
    }
    const h = cabinetSizeIn(c, presets, scalePixelsPerFoot).height;
    const top = topLine.get(c.location ?? 'perimeter') ?? UPPER_BOTTOM_IN + 30;
    out.set(c.id, h >= 30 ? UPPER_BOTTOM_IN : top - h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync with the Edit tab
// ---------------------------------------------------------------------------

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * A glass-door or patterned box is a different cabinet from the same box
 * without, so that 1 glass + 1 plain W3030 each get a shape that shows which
 * it is. The suffixes are only added for those, leaving plain keys as they
 * were.
 */
export function boxKey(
  box: Pick<SketchBoxSource, 'location' | 'code' | 'cab_type' | 'width_inches' | 'height_inches' | 'has_glass_door' | 'door_pattern'>
) {
  const glass = box.has_glass_door ? '|glass' : '';
  const pattern = box.door_pattern ? `|${box.door_pattern}` : '';
  return `${box.location}|${box.code}|${box.cab_type}|${fmt(box.width_inches)}x${fmt(box.height_inches)}${glass}${pattern}`;
}

export function cabinetKey(cabinet: CabinetSketchCabinet, presets: PresetCatalog, scalePixelsPerFoot: number) {
  const { width, height } = cabinetSizeIn(cabinet, presets, scalePixelsPerFoot);
  return boxKey({
    location: cabinet.location ?? 'perimeter',
    code: cabinet.preset_code,
    cab_type: cabinet.cab_type,
    width_inches: width,
    height_inches: height,
    has_glass_door: !!cabinet.has_glass_door,
    door_pattern: cabinet.door_pattern,
  });
}

/** A run's back line: where its first cabinet's back-left corner goes, and which way it faces. */
interface RunAnchor {
  origin: Pt;
  ux: Pt;
  back: Pt;
}

/**
 * Where an auto-placed run starts. With walls drawn, cabinets go along the
 * inside face of the longest wall ("inside" = away from the centroid of
 * all the wall endpoints). With no walls, a north-backed run near the top
 * left of the canvas.
 */
export function perimeterAnchor(walls: CabinetSketchWall[], scalePixelsPerFoot: number): RunAnchor {
  const longest = walls.reduce<CabinetSketchWall | null>((best, w) => {
    const len = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y);
    const bestLen = best ? Math.hypot(best.end_x - best.start_x, best.end_y - best.start_y) : 0;
    return len > bestLen ? w : best;
  }, null);

  if (!longest || Math.hypot(longest.end_x - longest.start_x, longest.end_y - longest.start_y) < 1) {
    return {
      origin: { x: 2 * scalePixelsPerFoot, y: 2 * scalePixelsPerFoot },
      ux: { x: 1, y: 0 },
      back: { x: 0, y: -1 },
    };
  }

  const start = { x: longest.start_x, y: longest.start_y };
  const end = { x: longest.end_x, y: longest.end_y };
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const dir = scale(sub(end, start), 1 / len);
  const normal = { x: -dir.y, y: dir.x };

  const pts = walls.flatMap((w) => [
    { x: w.start_x, y: w.start_y },
    { x: w.end_x, y: w.end_y },
  ]);
  const centroid = scale(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length);
  const mid = scale(add(start, end), 0.5);
  // The back points at the wall, i.e. away from the room's middle.
  const back = dot(sub(centroid, mid), normal) > 0 ? scale(normal, -1) : normal;
  const ux = { x: -back.y, y: back.x };

  const runStart = dot(start, ux) <= dot(end, ux) ? start : end;
  const inset = (longest.thickness || 0) / 2;
  return { origin: sub(runStart, scale(back, inset)), ux, back };
}

function islandAnchor(perimeter: RunAnchor, scalePixelsPerFoot: number): RunAnchor {
  return {
    ...perimeter,
    origin: sub(perimeter.origin, scale(perimeter.back, inToPx(ISLAND_OFFSET_IN, scalePixelsPerFoot))),
  };
}

const rowOf = (location: CabinetLocation, cabType: CabType) =>
  `${location}|${cabType === 'wall' ? 'upper' : 'lower'}`;

/**
 * Bring the sketch's shapes in line with the Edit tab's boxes.
 *
 * - Shapes that still match a box keep their position (and get their
 *   inch fields / footprint refreshed — older sketches drew depth from the
 *   cabinet's height).
 * - A box changed in the Edit tab (another code, size or glass) no longer
 *   matches its shape, so it takes over a leftover shape of the same
 *   location and height (upper vs floor) instead — the cabinet keeps the
 *   place it was dragged to.
 * - Shapes with no box left are dropped.
 * - Boxes with no shape yet get one, appended to the end of their row
 *   (bases then talls along the floor, uppers along the same back line,
 *   island as a parallel run — or, with `islandTwoSided`, on the shorter
 *   of its two back-to-back sides; see placeOnIslandSide).
 *
 * Returns `null` when nothing needs to change, so callers can skip a
 * dispatch and avoid a render loop.
 */
export function reconcileCabinets(
  cabinets: CabinetSketchCabinet[],
  boxes: SketchBoxSource[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number,
  { islandTwoSided = false }: { islandTwoSided?: boolean } = {}
): CabinetSketchCabinet[] | null {
  // How many shapes each key needs, and the box to build missing ones from.
  const needed = new Map<string, { count: number; box: SketchBoxSource }>();
  for (const box of boxes) {
    const qty = Math.max(0, Math.floor(box.qty || 0));
    if (qty === 0) continue;
    const key = boxKey(box);
    const entry = needed.get(key);
    if (entry) entry.count += qty;
    else needed.set(key, { count: qty, box });
  }

  // `c`'s place in the plan, sized for `box`.
  const fit = (c: CabinetSketchCabinet, box: SketchBoxSource): CabinetSketchCabinet => {
    const depth = footprintDepthIn(box.cab_type, box.specialty_type, box.width_inches);
    return {
      ...c,
      location: box.location,
      width_in: box.width_inches,
      depth_in: depth,
      height_in: box.height_inches,
      // Left off a plain cabinet, so its saved JSON stays as before.
      has_glass_door: box.has_glass_door ? true : undefined,
      door_pattern: box.door_pattern || undefined,
      width: inToPx(box.width_inches, scalePixelsPerFoot),
      height: inToPx(depth, scalePixelsPerFoot),
    };
  };

  let changed = false;
  const used = new Map<string, number>();
  // One slot per existing shape, in order; null until a box claims it.
  const slots: (CabinetSketchCabinet | null)[] = [];
  const leftover: number[] = [];

  for (const c of cabinets) {
    const key = cabinetKey(c, presets, scalePixelsPerFoot);
    const entry = needed.get(key);
    const n = used.get(key) ?? 0;
    if (!entry || n >= entry.count) {
      leftover.push(slots.length);
      slots.push(null);
      continue;
    }
    used.set(key, n + 1);

    const refreshed = fit(c, entry.box);
    if (
      refreshed.location !== c.location ||
      refreshed.width_in !== c.width_in ||
      refreshed.depth_in !== c.depth_in ||
      refreshed.height_in !== c.height_in ||
      Math.abs(refreshed.width - c.width) > 0.01 ||
      Math.abs(refreshed.height - c.height) > 0.01
    ) {
      changed = true;
    }
    slots.push(refreshed);
  }

  // Boxes without a shape, in placement order: lower row bases first, then talls.
  const unplaced: SketchBoxSource[] = [];
  const typeOrder: CabType[] = ['base', 'specialty', 'tall', 'wall'];
  for (const cabType of typeOrder) {
    for (const [key, entry] of Array.from(needed.entries())) {
      if (entry.box.cab_type !== cabType) continue;
      const short = entry.count - (used.get(key) ?? 0);
      for (let i = 0; i < short; i++) unplaced.push(entry.box);
    }
  }

  // A changed box takes over the leftover shape it most likely was: one of
  // the same code (only its glass or pattern changed), then one as wide
  // (only its height changed, as when a new Tier switches every upper),
  // else any at the same height.
  const missing: SketchBoxSource[] = [];
  for (const box of unplaced) {
    const sameSpot = (c: CabinetSketchCabinet) =>
      (c.location ?? 'perimeter') === box.location && (c.cab_type === 'wall') === (box.cab_type === 'wall');
    let at = leftover.findIndex((i) => sameSpot(cabinets[i]) && cabinets[i].preset_code === box.code);
    if (at < 0) {
      at = leftover.findIndex(
        (i) => sameSpot(cabinets[i]) && cabinetSizeIn(cabinets[i], presets, scalePixelsPerFoot).width === box.width_inches
      );
    }
    if (at < 0) at = leftover.findIndex((i) => sameSpot(cabinets[i]));
    if (at < 0) {
      missing.push(box);
      continue;
    }
    const i = leftover.splice(at, 1)[0];
    slots[i] = {
      ...fit(cabinets[i], box),
      preset_code: box.code,
      cab_type: box.cab_type,
      label: box.code === 'CUSTOM' ? `${fmt(box.width_inches)}"` : box.code,
    };
    changed = true;
  }
  if (leftover.length > 0) changed = true;

  const kept = slots.filter((c): c is CabinetSketchCabinet => c !== null);
  if (missing.length === 0) return changed ? kept : null;

  const perim = perimeterAnchor(walls, scalePixelsPerFoot);
  const anchors: Record<CabinetLocation, RunAnchor> = {
    perimeter: perim,
    island: islandAnchor(perim, scalePixelsPerFoot),
  };
  const anchorRotation = rotationForBack(perim.back);
  const tolPx = inToPx(3, scalePixelsPerFoot);

  // Far end (along the run axis) of each row's cabinets that sit on its anchor line.
  const rowEnd = new Map<string, number>();
  for (const c of kept) {
    const loc = c.location ?? 'perimeter';
    const anchor = anchors[loc];
    if (angleDiffDeg(c.rotation, anchorRotation) > ANGLE_TOLERANCE_DEG) continue;
    if (Math.abs(dot({ x: c.x, y: c.y }, anchor.back) - dot(anchor.origin, anchor.back)) > tolPx) continue;
    const row = rowOf(loc, c.cab_type);
    const end = dot({ x: c.x, y: c.y }, anchor.ux) + c.width;
    rowEnd.set(row, Math.max(rowEnd.get(row) ?? -Infinity, end));
  }

  const next = [...kept];
  for (const box of missing) {
    const anchor = anchors[box.location];
    const row = rowOf(box.location, box.cab_type);
    const t0 = dot(anchor.origin, anchor.ux);
    const t = rowEnd.get(row) ?? t0;
    const pos = add(anchor.origin, scale(anchor.ux, t - t0));
    const shape = fit(
      {
        id: generateOverlayId(),
        preset_code: box.code,
        cab_type: box.cab_type,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: anchorRotation,
        label: box.code === 'CUSTOM' ? `${fmt(box.width_inches)}"` : box.code,
      },
      box
    );
    const onSide =
      islandTwoSided && box.location === 'island' && box.cab_type !== 'wall'
        ? placeOnIslandSide(next, shape, anchor, anchorRotation, scalePixelsPerFoot)
        : null;
    if (onSide) {
      next.push(onSide);
      continue;
    }
    next.push(shape);
    rowEnd.set(row, t + shape.width);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Snap a dragged cabinet onto a wall
// ---------------------------------------------------------------------------

/**
 * If the cabinet was dropped near a wall, return the position and rotation
 * that put its back flush against that wall's face (on the side the
 * cabinet is on), centred where it was dropped. `null` when no wall is
 * close enough.
 *
 * Closeness is measured from the nearest corner of the footprint, not the
 * back edge, so an unrotated cabinet pushed sideways up to a vertical wall
 * still snaps (and turns to face the room).
 */
export function snapCabinetToWall(
  cabinet: Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  walls: CabinetSketchWall[],
  scalePixelsPerFoot: number
): { x: number; y: number; rotation: number } | null {
  const { ux, back } = axes(cabinet.rotation);
  const backLeft = { x: cabinet.x, y: cabinet.y };
  const front = scale(back, -cabinet.height);
  const across = scale(ux, cabinet.width);
  const corners = [backLeft, add(backLeft, across), add(backLeft, front), add(add(backLeft, across), front)];
  const body = add(backLeft, scale(add(across, front), 0.5));

  let best: { wall: CabinetSketchWall; q: Pt; dir: Pt; d: number } | null = null;
  for (const wall of walls) {
    const a = { x: wall.start_x, y: wall.start_y };
    const b = { x: wall.end_x, y: wall.end_y };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const dir = scale(sub(b, a), 1 / len);
    const closest = (p: Pt) => add(a, scale(dir, Math.max(0, Math.min(len, dot(sub(p, a), dir)))));
    const d =
      Math.min(...corners.map((p) => Math.hypot(p.x - closest(p).x, p.y - closest(p).y))) -
      (wall.thickness || 0) / 2;
    if (d <= WALL_SNAP_FT * scalePixelsPerFoot && (!best || d < best.d)) {
      best = { wall, q: closest(body), dir, d };
    }
  }
  if (!best) return null;

  const normal = { x: -best.dir.y, y: best.dir.x };
  const side = dot(sub(body, best.q), normal) >= 0 ? 1 : -1;
  const newBack = scale(normal, -side);
  const newUx = { x: -newBack.y, y: newBack.x };
  const face = sub(best.q, scale(newBack, (best.wall.thickness || 0) / 2));
  const corner = sub(face, scale(newUx, cabinet.width / 2));
  return { x: corner.x, y: corner.y, rotation: rotationForBack(newBack) };
}

// ---------------------------------------------------------------------------
// Snap a dragged cabinet against its neighbour
// ---------------------------------------------------------------------------

export interface CabinetPose {
  x: number;
  y: number;
  rotation: number;
}

type DroppedCabinet = Pick<CabinetSketchCabinet, 'id' | 'cab_type' | 'x' | 'y' | 'width' | 'height' | 'rotation'>;

type CabTypeOf = Pick<CabinetSketchCabinet, 'cab_type'>;
/** The heights a cabinet fills: uppers hang, bases stand, talls span both. */
const onFloor = (c: CabTypeOf) => c.cab_type !== 'wall';
const atUpperHeight = (c: CabTypeOf) => c.cab_type === 'wall' || c.cab_type === 'tall';
const sharesHeight = (a: CabTypeOf, b: CabTypeOf) =>
  (onFloor(a) && onFloor(b)) || (atUpperHeight(a) && atUpperHeight(b));

/** Where a cabinet's footprint centre is, in canvas pixels. */
function centerOf(c: Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Pt {
  const { ux, back } = axes(c.rotation);
  return add({ x: c.x, y: c.y }, sub(scale(ux, c.width / 2), scale(back, c.height / 2)));
}

/** The back-left corner that puts a `width` × `height` footprint's centre at `center`. */
function cornerFor(center: Pt, width: number, height: number, rotation: number): Pt {
  const { ux, back } = axes(rotation);
  return add(sub(center, scale(ux, width / 2)), scale(back, height / 2));
}

/**
 * Two runs meeting at an angle that isn't a quarter turn (an angled island,
 * or a run turning off a bay wall). The cabinet keeps its own angle; its
 * end meets the neighbour's end at the inside corner of the turn, which
 * leaves the wedge on the outside for a tapered filler. Returns the moves
 * that put it past the neighbour's right end, or before its left end.
 */
function angledJoinShifts(cabinet: DroppedCabinet, n: CabinetSketchCabinet): Pt[] {
  // How far the cabinet's run turns from the neighbour's; > 0 turns toward the neighbour's front.
  const phi = ((((cabinet.rotation - n.rotation) % 360) + 540) % 360) - 180;
  const N = axes(n.rotation);
  const M = axes(cabinet.rotation);
  const nLeftBack = { x: n.x, y: n.y };
  const nRightBack = add(nLeftBack, scale(N.ux, n.width));
  const nFront = scale(N.back, -n.height);
  const mLeftBack = { x: cabinet.x, y: cabinet.y };
  const mRightBack = add(mLeftBack, scale(M.ux, cabinet.width));
  const mFront = scale(M.back, -cabinet.height);
  return [
    // Its left end on the neighbour's right end: the turn is phi.
    phi > 0 ? sub(add(nRightBack, nFront), add(mLeftBack, mFront)) : sub(nRightBack, mLeftBack),
    // Its right end on the neighbour's left end: from it to the neighbour, the turn is -phi.
    phi < 0 ? sub(add(nLeftBack, nFront), add(mRightBack, mFront)) : sub(nLeftBack, mRightBack),
  ];
}

/**
 * If the cabinet was dropped by a neighbour, return the pose that squares
 * it up to that neighbour (turned to match, or to a right angle or back to
 * back with it) and lines its edges up with the neighbour's:
 *
 * - facing the same way at the same height (base by base, upper by upper,
 *   either by a tall): backs level, side butted against the neighbour's;
 * - an upper over a base, or a base under an upper: backs level, left or
 *   right ends flush, so the two stack square in the plan;
 * - back to back (a two-sided island): backs touching, ends flush;
 * - at a right angle (an L, or the ends of a three-sided island): butted
 *   against the neighbour's end with its outside face flush with the
 *   neighbour's back or front, or set against the neighbour's front or
 *   back with its side flush with the neighbour's end;
 * - at any other angle (an angled island): end to end at the inside corner
 *   of the turn, keeping its own angle (see angledJoinShifts).
 *
 * `null` when no cabinet is close enough: edges must be within a few
 * inches (backs within a foot when only levelling), so a cabinet set in
 * front of another, or left a dishwasher gap away, stays where it was
 * dropped. `sameFacingOnly` skips the right-angle and angled joins.
 */
export function snapCabinetToNeighbors(
  cabinet: DroppedCabinet,
  cabinets: CabinetSketchCabinet[],
  scalePixelsPerFoot: number,
  { sameFacingOnly = false }: { sameFacingOnly?: boolean } = {}
): CabinetPose | null {
  const gapTol = inToPx(NEIGHBOR_SNAP_GAP_IN, scalePixelsPerFoot);
  const backTol = inToPx(NEIGHBOR_SNAP_BACK_IN, scalePixelsPerFoot);
  const { width: w, height: h } = cabinet;
  // Squared up to a neighbour, the cabinet turns about its middle.
  const center = centerOf(cabinet);

  let best: (CabinetPose & { d: number }) | null = null;
  for (const n of cabinets) {
    if (n.id === cabinet.id) continue;
    // Quarter turns from the neighbour: 0 same facing, 2 back to back, 1 / 3 at a right angle.
    const turn = (((Math.round((cabinet.rotation - n.rotation) / 90) % 4) + 4) % 4);
    const rotation = turn === 0 ? n.rotation : (((n.rotation + turn * 90) % 360) + 360) % 360;
    if (angleDiffDeg(rotation, cabinet.rotation) > NEIGHBOR_SNAP_ANGLE_DEG) {
      // Well off a quarter turn: an angled run, joined end to end at its own angle.
      if (sameFacingOnly || !sharesHeight(cabinet, n)) continue;
      for (const shift of angledJoinShifts(cabinet, n)) {
        const d = Math.hypot(shift.x, shift.y);
        if (d > gapTol || (best && d >= best.d)) continue;
        best = { x: cabinet.x + shift.x, y: cabinet.y + shift.y, rotation: cabinet.rotation, d };
      }
      continue;
    }
    if (sameFacingOnly && turn % 2 === 1) continue;
    const same = sharesHeight(cabinet, n);
    if (!same && turn !== 0) continue;

    // Both footprints in the neighbour's run coordinates: t along its run, s toward its back.
    const { ux, back } = axes(n.rotation);
    const ht = (turn % 2 === 0 ? w : h) / 2;
    const hs = (turn % 2 === 0 ? h : w) / 2;
    const ct = dot(center, ux);
    const cs = dot(center, back);
    const [mt0, mt1, ms0, ms1] = [ct - ht, ct + ht, cs - hs, cs + hs];
    const nt0 = dot({ x: n.x, y: n.y }, ux);
    const nt1 = nt0 + n.width;
    const ns1 = dot({ x: n.x, y: n.y }, back);
    const ns0 = ns1 - n.height;

    // Shifts (dt along the run, ds toward the back) that bring an edge onto an edge.
    const besideEnd = [nt1 - mt0, nt0 - mt1]; // past the neighbour's right / left end
    const endsFlush = [nt0 - mt0, nt1 - mt1]; // left ends / right ends lined up
    const backsLevel = ns1 - ms1;
    const frontsLevel = ns0 - ms0;
    const againstFront = ns0 - ms1;
    const againstBack = ns1 - ms0;

    // [shifts along the run, shifts toward the back, how far the latter may reach]
    const joins: [number[], number[], number][] =
      turn === 0
        ? [[same ? besideEnd : endsFlush, [backsLevel], backTol]]
        : turn === 2
          ? [[endsFlush, [againstBack], gapTol]]
          : [
              [besideEnd, [backsLevel, frontsLevel], gapTol],
              [endsFlush, [againstFront, againstBack], gapTol],
            ];
    for (const [dts, dss, sTol] of joins) {
      for (const dt of dts) {
        for (const ds of dss) {
          if (Math.abs(dt) > gapTol || Math.abs(ds) > sTol) continue;
          const d = Math.hypot(dt, ds);
          if (best && d >= best.d) continue;
          const p = cornerFor(add(center, add(scale(ux, dt), scale(back, ds))), w, h, rotation);
          best = { x: p.x, y: p.y, rotation, d };
        }
      }
    }
  }
  return best && { x: best.x, y: best.y, rotation: best.rotation };
}

/**
 * Turn cabinets by `degrees` (positive is clockwise on screen) as one
 * piece about the middle of the group, so a selected run keeps its shape
 * — a quarter turn for the ends of a three-sided island, 45° for one side
 * of an angled island.
 */
export function turnCabinets(
  cabinets: Pick<CabinetSketchCabinet, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation'>[],
  degrees: number
): ({ id: string } & CabinetPose)[] {
  if (cabinets.length === 0) return [];
  const centers = cabinets.map(centerOf);
  const pivot = scale(centers.reduce(add, { x: 0, y: 0 }), 1 / centers.length);
  const r = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  return cabinets.map((c, i) => {
    const v = sub(centers[i], pivot);
    const center = add(pivot, { x: cos * v.x - sin * v.y, y: sin * v.x + cos * v.y });
    // Rounded to a hundredth of a degree, so 15° steps stay exact.
    const rotation = Math.round(((((c.rotation + degrees) % 360) + 360) % 360) * 100) / 100;
    const p = cornerFor(center, c.width, c.height, rotation);
    return { id: c.id, x: p.x, y: p.y, rotation };
  });
}

/**
 * Angled joints in the plan: floor cabinets joined end to end at an angle
 * other than a quarter turn (see angledJoinShifts). It is what the Edit
 * tab's Angled Joints should hold. Uppers are left out: each joint bills a
 * countertop cut, which only the floor run has.
 */
export function countAngledJoints(cabinets: CabinetSketchCabinet[], scalePixelsPerFoot: number): number {
  const tol = inToPx(1, scalePixelsPerFoot);
  const floor = cabinets.filter(onFloor);
  let joints = 0;
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      const [a, b] = [floor[i], floor[j]];
      const quarter = Math.round((b.rotation - a.rotation) / 90) * 90;
      if (angleDiffDeg(b.rotation, a.rotation + quarter) <= NEIGHBOR_SNAP_ANGLE_DEG) continue;
      if (angledJoinShifts(b, a).some((s) => Math.hypot(s.x, s.y) <= tol)) joints++;
    }
  }
  return joints;
}

// ---------------------------------------------------------------------------
// Island countertop
// ---------------------------------------------------------------------------

/** How far a countertop runs past the box at a front or an exposed end or back, inches. */
export const TOP_EDGE_OVERHANG_IN = 1.5;

const islandFloor = (cabinets: CabinetSketchCabinet[]) =>
  cabinets.filter((c) => c.location === 'island' && onFloor(c));

/** A point on a cabinet, x along its run and y toward its front. */
export function pointOnCabinet(c: Pick<CabinetSketchCabinet, 'x' | 'y' | 'rotation'>, x: number, y: number): Pt {
  const { ux, back } = axes(c.rotation);
  return add({ x: c.x, y: c.y }, sub(scale(ux, x), scale(back, y)));
}

/** Two island cabinets joined end to end at an angle: which ends meet, and which side the wedge between them opens on. */
interface IslandJoint {
  a: CabinetSketchCabinet;
  b: CabinetSketchCabinet;
  aEnd: number;
  bEnd: number;
  /** The wedge opens at the backs (the fronts meet at the inside corner of the turn). */
  opensBack: boolean;
}

function islandJoints(island: CabinetSketchCabinet[], scalePixelsPerFoot: number): IslandJoint[] {
  const tol = inToPx(1, scalePixelsPerFoot);
  const joints: IslandJoint[] = [];
  for (let i = 0; i < island.length; i++) {
    for (let j = i + 1; j < island.length; j++) {
      const [a, b] = [island[i], island[j]];
      const quarter = Math.round((b.rotation - a.rotation) / 90) * 90;
      if (angleDiffDeg(b.rotation, a.rotation + quarter) <= NEIGHBOR_SNAP_ANGLE_DEG) continue;
      const phi = ((((b.rotation - a.rotation) % 360) + 540) % 360) - 180;
      const [pastRight, beforeLeft] = angledJoinShifts(b, a).map((s) => Math.hypot(s.x, s.y) <= tol);
      if (pastRight) joints.push({ a, b, aEnd: a.width, bEnd: 0, opensBack: phi > 0 });
      else if (beforeLeft) joints.push({ a, b, aEnd: 0, bEnd: b.width, opensBack: phi < 0 });
    }
  }
  return joints;
}

/**
 * The island's countertop in plan, as convex pieces whose union is the
 * top: each island floor cabinet grown by the edge overhang (and by the
 * seating overhang behind its back), plus the wedge each angled joint
 * leaves on the outside of its turn, so the top reads — and measures — as
 * one piece however the island bends. Back-to-back rows need no special
 * case: one row's seating strip lies over the other row. polygonUnion
 * turns the pieces into the top's outline.
 */
export function islandTopPieces(
  cabinets: CabinetSketchCabinet[],
  scalePixelsPerFoot: number,
  seatingOverhangIn = 0
): Pt[][] {
  const island = islandFloor(cabinets);
  const edge = inToPx(TOP_EDGE_OVERHANG_IN, scalePixelsPerFoot);
  const behind = Math.max(edge, inToPx(seatingOverhangIn, scalePixelsPerFoot));

  const pieces: Pt[][] = island.map((c) => [
    pointOnCabinet(c, -edge, -behind),
    pointOnCabinet(c, c.width + edge, -behind),
    pointOnCabinet(c, c.width + edge, c.height + edge),
    pointOnCabinet(c, -edge, c.height + edge),
  ]);

  // The wedge on the outside of each angled joint: from the inside corner
  // the two cabinets share, out to their outside corners (and past them by
  // the overhang on that side).
  for (const { a, b, aEnd, bEnd, opensBack } of islandJoints(island, scalePixelsPerFoot)) {
    const outY = (c: CabinetSketchCabinet) => (opensBack ? -behind : c.height + edge);
    const hinge = pointOnCabinet(a, aEnd, opensBack ? a.height : 0);
    pieces.push([hinge, pointOnCabinet(a, aEnd, outY(a)), pointOnCabinet(b, bEnd, outY(b))]);
  }
  return pieces;
}

/**
 * The tapered filler in each angled island joint: the wedge between the
 * two boxes, from the inside corner they share out to the outside corners
 * of their joined ends (a's, then b's), so the island reads as one run.
 * `atFront` when it fills the door side (the backs meet), not the backs.
 */
export function islandJointFillers(
  cabinets: CabinetSketchCabinet[],
  scalePixelsPerFoot: number
): { wedge: Pt[]; atFront: boolean; a: CabinetSketchCabinet; b: CabinetSketchCabinet }[] {
  return islandJoints(islandFloor(cabinets), scalePixelsPerFoot).map(({ a, b, aEnd, bEnd, opensBack }) => {
    const outY = (c: CabinetSketchCabinet) => (opensBack ? 0 : c.height);
    const hinge = pointOnCabinet(a, aEnd, opensBack ? a.height : 0);
    return { wedge: [hinge, pointOnCabinet(a, aEnd, outY(a)), pointOnCabinet(b, bEnd, outY(b))], atFront: !opensBack, a, b };
  });
}

/** Twice a polygon's signed area (shoelace); its sign is the winding. */
export function signedArea2(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s;
}

const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A loop without its zero-length sides and the corners that don't turn. */
function dropStraightCorners(loop: Pt[], tol: number): Pt[] {
  const pts = [...loop];
  for (let i = 0; pts.length >= 3 && i < pts.length; ) {
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const across = Math.hypot(next.x - prev.x, next.y - prev.y);
    const offLine = Math.abs(cross(sub(pts[i], prev), sub(next, pts[i])));
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) <= tol || offLine <= tol * across) {
      pts.splice(i, 1);
      i = Math.max(i - 1, 0);
    } else {
      i++;
    }
  }
  return pts;
}

/**
 * The outline of the union of convex polygons, as closed loops: each
 * separate shape's outside wound with a positive signedArea2, any hole the
 * other way, so a nonzero fill draws it right. Each edge is cut where the
 * other pieces cross or touch it, and a stretch is kept when the union is
 * on its inner side but not its outer side — which drops the edges buried
 * in other pieces, and keeps one copy of an outside edge two pieces share.
 */
export function polygonUnion(pieces: Pt[][]): Pt[][] {
  const polys = pieces
    .filter((p) => p.length >= 3 && Math.abs(signedArea2(p)) > 1e-9)
    .map((p) => (signedArea2(p) > 0 ? p : [...p].reverse()));
  const pts = polys.flat();
  if (pts.length === 0) return [];
  const span = Math.max(
    Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
    Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
  );
  // Points closer than `tol` are one point; the in / out probes sit `probe` off the edge.
  const tol = span * 1e-6;
  const probe = span * 1e-5;
  const inUnion = (p: Pt) => polys.some((poly) => inConvex(p, poly));
  const same = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

  const sides: [Pt, Pt][] = [];
  polys.forEach((poly, i) => {
    poly.forEach((a, k) => {
      const b = poly[(k + 1) % poly.length];
      const d = sub(b, a);
      const len = Math.hypot(d.x, d.y);
      if (len <= tol) return;
      const cuts = [0, 1];
      polys.forEach((other, j) => {
        if (j === i) return;
        other.forEach((c, m) => {
          // Its corner on this edge…
          const ac = sub(c, a);
          const t = dot(ac, d) / (len * len);
          if (t > 0 && t < 1 && Math.abs(cross(d, ac)) / len <= tol) cuts.push(t);
          // …or its edge across this one.
          const f = sub(other[(m + 1) % other.length], c);
          const den = cross(d, f);
          if (Math.abs(den) <= 1e-9 * len * Math.hypot(f.x, f.y)) return;
          const s = cross(ac, f) / den;
          const u = cross(ac, d) / den;
          if (s > 0 && s < 1 && u >= 0 && u <= 1) cuts.push(s);
        });
      });
      cuts.sort((p, q) => p - q);
      // The interior of a positively wound polygon is on the left of each edge.
      const outward = scale({ x: d.y, y: -d.x }, probe / len);
      for (let n = 0; n + 1 < cuts.length; n++) {
        if ((cuts[n + 1] - cuts[n]) * len <= tol) continue;
        const mid = lerp(a, b, (cuts[n] + cuts[n + 1]) / 2);
        if (inUnion(add(mid, outward)) || !inUnion(sub(mid, outward))) continue;
        const side: [Pt, Pt] = [lerp(a, b, cuts[n]), lerp(a, b, cuts[n + 1])];
        if (!sides.some(([p, q]) => same(p, side[0]) && same(q, side[1]))) sides.push(side);
      }
    });
  });

  // Chain the kept stretches, end to start, into loops.
  const loops: Pt[][] = [];
  const used = sides.map(() => false);
  for (let first = 0; first < sides.length; first++) {
    if (used[first]) continue;
    const loop: Pt[] = [];
    for (let cur = first; cur >= 0; ) {
      used[cur] = true;
      loop.push(sides[cur][0]);
      const end = sides[cur][1];
      cur = sides.findIndex(([p], k) => !used[k] && same(p, end));
    }
    const clean = dropStraightCorners(loop, tol);
    if (clean.length >= 3 && Math.abs(signedArea2(clean)) > tol * span) loops.push(clean);
  }
  return loops;
}

/** Point in a convex polygon (either winding). */
function inConvex(p: Pt, poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Area of the island top (the union of islandTopPieces), square feet to a
 * tenth. Sampled on a half-inch grid, which is well inside a fabricator's
 * rounding.
 */
export function islandTopAreaSf(pieces: Pt[][], scalePixelsPerFoot: number): number {
  const pts = pieces.flat();
  if (pts.length === 0 || scalePixelsPerFoot <= 0) return 0;
  const step = inToPx(0.5, scalePixelsPerFoot);
  const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
  const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  let inside = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const p = { x, y };
      if (pieces.some((poly) => inConvex(p, poly))) inside++;
    }
  }
  const sf = (inside * step * step) / (scalePixelsPerFoot * scalePixelsPerFoot);
  return Math.round(sf * 10) / 10;
}

// ---------------------------------------------------------------------------
// Island with cabinets on both sides
// ---------------------------------------------------------------------------

/**
 * A straight island's floor cabinets, in the run coordinates of the side
 * that faces `rotation`: t along that side's ux, s along its back. `facing`
 * face that way; `opposite` are turned half round, back to back with them.
 * Every back is on the line s = `backLine`.
 */
interface IslandRows {
  rotation: number;
  ux: Pt;
  back: Pt;
  backLine: number;
  facing: CabinetSketchCabinet[];
  opposite: CabinetSketchCabinet[];
}

/**
 * The island as one row or two back-to-back rows, `facing` being the side
 * that faces `preferRotation` (the way a new island faces) when it has
 * cabinets. Null for no island, or one of another shape: an L, angled
 * sides, rows set apart.
 */
function islandRows(cabinets: CabinetSketchCabinet[], scalePixelsPerFoot: number, preferRotation: number): IslandRows | null {
  const island = islandFloor(cabinets);
  if (island.length === 0) return null;
  const facingWay = (c: CabinetSketchCabinet, r: number) => angleDiffDeg(c.rotation, r) <= ANGLE_TOLERANCE_DEG;
  const rotation = (island.find((c) => facingWay(c, preferRotation)) ?? island[0]).rotation;
  const facing = island.filter((c) => facingWay(c, rotation));
  const opposite = island.filter((c) => facingWay(c, rotation + 180));
  if (facing.length + opposite.length !== island.length) return null;
  const { ux, back } = axes(rotation);
  // A cabinet's back edge runs through its back-left corner, whichever way it faces.
  const lines = island.map((c) => dot({ x: c.x, y: c.y }, back));
  if (Math.max(...lines) - Math.min(...lines) > inToPx(1, scalePixelsPerFoot)) return null;
  return { rotation, ux, back, backLine: lines.reduce((a, b) => a + b, 0) / lines.length, facing, opposite };
}

/** Where an island cabinet starts and ends along the facing side's run. */
function spanOnIsland(rows: IslandRows, c: CabinetSketchCabinet): [number, number] {
  const t = dot({ x: c.x, y: c.y }, rows.ux);
  return rows.facing.includes(c) ? [t, t + c.width] : [t - c.width, t];
}

/** `c` across [t, t + its width] of the island's run, its back on the line s: facing the island's way, or turned half round. */
function setOnIsland(rows: IslandRows, c: CabinetSketchCabinet, t: number, s: number, turned: boolean): CabinetSketchCabinet {
  const p = add(scale(rows.ux, turned ? t + c.width : t), scale(rows.back, s));
  const rotation = turned ? Math.round(((((rows.rotation + 180) % 360) + 360) % 360) * 100) / 100 : rows.rotation;
  return { ...c, x: p.x, y: p.y, rotation };
}

const runLength = (list: CabinetSketchCabinet[]) => list.reduce((sum, c) => sum + c.width, 0);

/**
 * The island laid out for the Edit tab's "Cabinets on both sides", or back
 * for one side.
 *
 * Both sides: a single row is cut in two, the halves as near equal in
 * length as its boxes allow. The first half (along its run) moves forward
 * by the row's depth, still facing its way; the second turns half round
 * into the row's old place, backs on one line, so the aisle behind the
 * island stays as wide as it was. One side: two back-to-back rows go back
 * to one in the turned row's place (the reverse of the cut), facing the
 * way the other did. The rows are butted and centred on where the island
 * was.
 *
 * `straight` is false when the island is another shape (an L, angled
 * sides, rows set apart), which is left as drawn. The input array comes
 * back when nothing moves.
 */
export function layoutIslandSides(
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  twoSided: boolean,
  scalePixelsPerFoot: number
): { cabinets: CabinetSketchCabinet[]; straight: boolean } {
  if (islandFloor(cabinets).length === 0) return { cabinets, straight: true };
  const rows = islandRows(cabinets, scalePixelsPerFoot, rotationForBack(perimeterAnchor(walls, scalePixelsPerFoot).back));
  if (!rows) return { cabinets, straight: false };
  const { facing, opposite, backLine } = rows;
  if (twoSided ? opposite.length > 0 || facing.length < 2 : opposite.length === 0) return { cabinets, straight: true };

  const byRun = (list: CabinetSketchCabinet[]) =>
    [...list].sort((a, b) => spanOnIsland(rows, a)[0] - spanOnIsland(rows, b)[0]);
  const spans = [...facing, ...opposite].map((c) => spanOnIsland(rows, c));
  const middle = (Math.min(...spans.map(([t0]) => t0)) + Math.max(...spans.map(([, t1]) => t1))) / 2;
  const moved = new Map<string, CabinetSketchCabinet>();
  // `list` end to end, centred on the island's middle, its backs on the line s.
  const lay = (list: CabinetSketchCabinet[], s: number, turned: boolean) => {
    let t = middle - runLength(list) / 2;
    for (const c of list) {
      moved.set(c.id, setOnIsland(rows, c, t, s, turned));
      t += c.width;
    }
  };

  if (twoSided) {
    const row = byRun(facing);
    const total = runLength(row);
    let cut = 1;
    let best = Infinity;
    for (let k = 1, before = 0; k < row.length; k++) {
      before += row[k - 1].width;
      if (Math.abs(total - 2 * before) < best) [best, cut] = [Math.abs(total - 2 * before), k];
    }
    const depth = Math.max(...row.map((c) => c.height));
    lay(row.slice(0, cut), backLine - depth, false);
    lay(row.slice(cut), backLine - depth, true);
  } else {
    const depth = Math.max(...opposite.map((c) => c.height));
    lay([...byRun(facing), ...byRun(opposite)], backLine + depth, false);
  }
  return { cabinets: cabinets.map((c) => moved.get(c.id) ?? c), straight: true };
}

/**
 * Where a new island floor cabinet goes while the island has cabinets on
 * both sides: on the end of the shorter side, both sides started from the
 * same end. The island's first cabinet goes one depth out from the usual
 * island line, so the side that comes in behind it takes that line and the
 * aisle stays as wide as a one-sided island leaves it. Null when the island
 * is another shape: the cabinet goes where a one-sided island's would.
 */
function placeOnIslandSide(
  cabinets: CabinetSketchCabinet[],
  shape: CabinetSketchCabinet,
  anchor: RunAnchor,
  anchorRotation: number,
  scalePixelsPerFoot: number
): CabinetSketchCabinet | null {
  if (islandFloor(cabinets).length === 0) {
    const p = sub(anchor.origin, scale(anchor.back, shape.height));
    return { ...shape, x: p.x, y: p.y, rotation: anchorRotation };
  }
  const rows = islandRows(cabinets, scalePixelsPerFoot, anchorRotation);
  if (!rows) return null;
  const turned = runLength(rows.opposite) < runLength(rows.facing);
  const [side, other] = turned ? [rows.opposite, rows.facing] : [rows.facing, rows.opposite];
  const t =
    side.length > 0
      ? Math.max(...side.map((c) => spanOnIsland(rows, c)[1]))
      : Math.min(...other.map((c) => spanOnIsland(rows, c)[0]));
  return setOnIsland(rows, shape, t, rows.backLine, turned);
}

/**
 * Where a dropped cabinet lands. By another cabinet, it lines up with it
 * (checked first, so a cabinet slid to the end of a run near a corner
 * joins the run instead of turning onto the side wall). Otherwise, near a
 * wall, it backs onto the wall — and then lines up with any cabinet
 * already on that wall. Unchanged when nothing is close.
 */
export function snapDroppedCabinet(
  cabinet: DroppedCabinet,
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  scalePixelsPerFoot: number
): CabinetPose {
  // A right-angle join waits until the walls have had their say: near a
  // wall, the cabinet belongs on it rather than sideways off a neighbour.
  const beside = snapCabinetToNeighbors(cabinet, cabinets, scalePixelsPerFoot, { sameFacingOnly: true });
  if (beside) return beside;
  const onWall = snapCabinetToWall(cabinet, walls, scalePixelsPerFoot);
  if (onWall) return snapCabinetToNeighbors({ ...cabinet, ...onWall }, cabinets, scalePixelsPerFoot) ?? onWall;
  return (
    snapCabinetToNeighbors(cabinet, cabinets, scalePixelsPerFoot) ?? {
      x: cabinet.x,
      y: cabinet.y,
      rotation: cabinet.rotation,
    }
  );
}

// ---------------------------------------------------------------------------
// Front elevations
// ---------------------------------------------------------------------------

export interface ElevationItem {
  cabinet: CabinetSketchCabinet;
  /** Distance from the run's left edge to the cabinet's left side, inches. */
  left_in: number;
  width_in: number;
  height_in: number;
  bottom_in: number;
}

export interface ElevationRun {
  key: string;
  label: string;
  items: ElevationItem[];
  /** Total drawn width (cabinets plus any wall behind them), inches. */
  length_in: number;
  /** The drawn wall behind this run, if one lines up, in run coordinates. */
  wall?: { left_in: number; right_in: number };
  /** Free-standing: no wall behind it, so the elevation draws none. */
  island: boolean;
}

/** Compass point a direction points to (screen up = north), or null when it's off-axis. */
function compassName(dir: Pt): string | null {
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  // Eight points, so a run set at 45° (an angled island side) is still named.
  const points: [number, string][] = [
    [-135, 'Northwest'],
    [-90, 'North'],
    [-45, 'Northeast'],
    [0, 'East'],
    [45, 'Southeast'],
    [90, 'South'],
    [135, 'Southwest'],
    [180, 'West'],
    [-180, 'West'],
  ];
  for (const [angle, name] of points) {
    if (Math.abs(deg - angle) <= 10) return name;
  }
  return null;
}

/** A wall run is named for the wall its back is on. */
function compassLabel(back: Pt): string {
  const name = compassName(back);
  return name ? `${name} wall` : 'Angled wall';
}

/** One side of an island with several (an L, three sides, back to back): named for the way its doors face. */
function islandSideLabel(back: Pt): string {
  const name = compassName(scale(back, -1));
  return name ? `Island – ${name} side` : 'Island';
}

/**
 * Group the plan's cabinets into front elevations: one per back line
 * (same facing, backs within a few inches), so the bases and uppers on a
 * wall share a drawing and an island gets its own.
 *
 * Only one run per facing is named for a wall. A run standing in front of
 * another that faces the same way — an island or peninsula, whatever the
 * Edit tab calls its cabinets — would hide part of that run from the
 * front, so it gets its own drawing, but as an island rather than a
 * second wall. A run backed onto a drawn wall is always a wall run.
 */
export function buildElevations(
  cabinets: CabinetSketchCabinet[],
  walls: CabinetSketchWall[],
  presets: PresetCatalog,
  scalePixelsPerFoot: number
): ElevationRun[] {
  const tolPx = inToPx(RUN_BACK_TOLERANCE_IN, scalePixelsPerFoot);
  const groups: { rotation: number; ux: Pt; back: Pt; s: number; cabinets: CabinetSketchCabinet[] }[] = [];

  for (const c of cabinets) {
    const { ux, back } = axes(c.rotation);
    const s = dot({ x: c.x, y: c.y }, back);
    const group = groups.find(
      (g) => angleDiffDeg(g.rotation, c.rotation) <= ANGLE_TOLERANCE_DEG && Math.abs(g.s - s) <= tolPx
    );
    if (group) group.cabinets.push(c);
    else groups.push({ rotation: c.rotation, ux, back, s, cabinets: [c] });
  }

  const mounts = mountHeightsIn(cabinets, presets, scalePixelsPerFoot);
  const parallelSin = Math.sin((ANGLE_TOLERANCE_DEG * Math.PI) / 180);

  const runs = groups.map((g) => {
    const raw = g.cabinets.map((c) => {
      const size = cabinetSizeIn(c, presets, scalePixelsPerFoot);
      return {
        cabinet: c,
        left: pxToIn(dot({ x: c.x, y: c.y }, g.ux), scalePixelsPerFoot),
        width_in: size.width,
        height_in: size.height,
        bottom_in: mounts.get(c.id) ?? 0,
      };
    });

    let min = Math.min(...raw.map((r) => r.left));
    let max = Math.max(...raw.map((r) => r.left + r.width_in));

    // A drawn wall whose face this run backs onto.
    let wallRange: { left: number; right: number } | undefined;
    for (const w of walls) {
      const len = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y);
      if (len < 1) continue;
      const dir = { x: (w.end_x - w.start_x) / len, y: (w.end_y - w.start_y) / len };
      if (Math.abs(dir.x * g.ux.y - dir.y * g.ux.x) > parallelSin) continue;
      const mid = { x: (w.start_x + w.end_x) / 2, y: (w.start_y + w.end_y) / 2 };
      const offset = Math.abs(dot(mid, g.back) - g.s);
      if (offset > (w.thickness || 0) / 2 + tolPx) continue;
      const a = pxToIn(dot({ x: w.start_x, y: w.start_y }, g.ux), scalePixelsPerFoot);
      const b = pxToIn(dot({ x: w.end_x, y: w.end_y }, g.ux), scalePixelsPerFoot);
      const left = Math.min(a, b);
      const right = Math.max(a, b);
      if (right < min || left > max) continue;
      wallRange = { left, right };
      break;
    }

    const standsInFront = groups.some(
      (o) => o !== g && angleDiffDeg(o.rotation, g.rotation) <= ANGLE_TOLERANCE_DEG && o.s - g.s > tolPx
    );
    const island = g.cabinets.every((c) => c.location === 'island') || (!wallRange && standsInFront);
    if (island) wallRange = undefined;
    if (wallRange) {
      min = Math.min(min, wallRange.left);
      max = Math.max(max, wallRange.right);
    }

    const items: ElevationItem[] = raw
      .map((r) => ({
        cabinet: r.cabinet,
        left_in: r.left - min,
        width_in: r.width_in,
        height_in: r.height_in,
        bottom_in: r.bottom_in,
      }))
      .sort((a, b) => a.left_in - b.left_in || a.bottom_in - b.bottom_in);

    return {
      label: island ? 'Island' : compassLabel(g.back),
      back: g.back,
      island,
      items,
      length_in: max - min,
      wall: wallRange ? { left_in: wallRange.left - min, right_in: wallRange.right - min } : undefined,
    };
  });

  runs.sort((a, b) => Number(a.island) - Number(b.island) || b.items.length - a.items.length);

  // A one-run island is just "Island"; with several runs each is named for its side.
  const islandRuns = runs.filter((r) => r.island).length;
  const seen = new Map<string, number>();
  return runs.map((r) => {
    const name = r.island && islandRuns > 1 ? islandSideLabel(r.back) : r.label;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const label = n > 1 ? `${name} ${n}` : name;
    return {
      key: label,
      label,
      items: r.items,
      length_in: r.length_in,
      wall: r.wall,
      island: r.island,
    };
  });
}
