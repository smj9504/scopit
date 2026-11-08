/**
 * Walls that meet stay joined. A kitchen sketch rarely closes a room — it
 * is a few stretches of wall — but where two walls meet, end to end at a
 * corner or one ending partway along another (a T), moving one must not
 * pull them apart. Pure functions over the plan's walls, in canvas pixels.
 */

import type { CabinetSketchWall } from '@/types/cabinetSketch';
import { pixelsToFeet } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchUtils';

type Pt = { x: number; y: number };
type End = 'start' | 'end';

/** How close (canvas px) a wall end must be to another wall to count as joined to it. */
export const WALL_JOINT_TOL_PX = 0.75;

const endOf = (w: CabinetSketchWall, end: End): Pt =>
  end === 'start' ? { x: w.start_x, y: w.start_y } : { x: w.end_x, y: w.end_y };

const withEnd = (w: CabinetSketchWall, end: End, p: Pt): CabinetSketchWall =>
  end === 'start' ? { ...w, start_x: p.x, start_y: p.y } : { ...w, end_x: p.x, end_y: p.y };

const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) <= WALL_JOINT_TOL_PX;

/** Where `p` sits along wall `w`, 0 at its start and 1 at its end, when it is on it between them; else null. */
function paramOn(p: Pt, w: CabinetSketchWall): number | null {
  const dx = w.end_x - w.start_x;
  const dy = w.end_y - w.start_y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  const t = ((p.x - w.start_x) * dx + (p.y - w.start_y) * dy) / len2;
  if (t <= 0 || t >= 1) return null;
  const q = { x: w.start_x + t * dx, y: w.start_y + t * dy };
  return near(p, q) ? t : null;
}

const pointAt = (w: CabinetSketchWall, t: number): Pt => ({
  x: w.start_x + t * (w.end_x - w.start_x),
  y: w.start_y + t * (w.end_y - w.start_y),
});

/** Where the line through a and b crosses wall w's line, as a parameter along w; null when they run parallel. */
function crossingOn(a: Pt, b: Pt, w: CabinetSketchWall): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = w.end_x - w.start_x;
  const sy = w.end_y - w.start_y;
  // a + u r = w.start + t s; crossing both sides with r leaves t.
  const denom = sx * ry - sy * rx;
  if (Math.abs(denom) < 1e-9) return null;
  return ((a.x - w.start_x) * ry - (a.y - w.start_y) * rx) / denom;
}

const withLength = (w: CabinetSketchWall, scalePixelsPerFoot: number): CabinetSketchWall => ({
  ...w,
  length_ft: pixelsToFeet(Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y), scalePixelsPerFoot),
});

const otherEnd = (end: End): End => (end === 'start' ? 'end' : 'start');

/** A wall joined to a moved one turns only in steps this big — 90° stays 90° for a small move, never 98°. */
export const WALL_TURN_STEP_DEG = 15;
/** How far from the turn the joint would give a step may be and still be taken. */
const MAX_STEP_OFF_DEG = 22.5;

const degreesOf = (v: Pt) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Where a wall that keeps its far end `far` meets `host`'s line, keeping
 * its old direction (toward `was`, its joined end) when the meeting point
 * there `fits`; else turned in whole steps, the step nearest the turn that
 * following `target` would give first. Null when none fits.
 */
function steppedJoin(
  far: Pt,
  was: Pt,
  target: Pt,
  host: CabinetSketchWall,
  fits: (p: Pt, t: number) => boolean
): Pt | null {
  const len = Math.hypot(was.x - far.x, was.y - far.y);
  if (len < 1e-9) return null;
  const u = { x: (was.x - far.x) / len, y: (was.y - far.y) / len };
  const toTarget = { x: target.x - far.x, y: target.y - far.y };
  const turn = Math.hypot(toTarget.x, toTarget.y) < 1 ? 0 : wrap180(degreesOf(toTarget) - degreesOf(u));
  const k = Math.round(turn / WALL_TURN_STEP_DEG);
  const near = [k, k - 1, k + 1]
    .filter((s) => s !== 0 && Math.abs(s * WALL_TURN_STEP_DEG - turn) <= MAX_STEP_OFF_DEG)
    .sort((a, b) => Math.abs(a * WALL_TURN_STEP_DEG - turn) - Math.abs(b * WALL_TURN_STEP_DEG - turn));
  for (const s of [0, ...near]) {
    // Turning the old direction itself, so no step leaves it exactly as it was.
    const r = (s * WALL_TURN_STEP_DEG * Math.PI) / 180;
    const [c, n] = s === 0 ? [1, 0] : [Math.cos(r), Math.sin(r)];
    const dir = { x: u.x * c - u.y * n, y: u.x * n + u.y * c };
    const t = crossingOn(far, { x: far.x + dir.x, y: far.y + dir.y }, host);
    if (t === null) continue;
    const p = pointAt(host, t);
    const reach = (p.x - far.x) * dir.x + (p.y - far.y) * dir.y;
    if (reach >= 1 && fits(p, t)) return p;
  }
  return null;
}

/** A joint of a wall end onto a changed wall: at one of its ends (a corner) or partway along it (a T, at `t`). */
type Joint = { host: string; hostEnd: End | null; t: number };

/**
 * The walls after some of them were moved, turned or had an end dragged
 * (`after` holds every wall, the changed ones in their new place), with
 * the walls joined to them kept joined. A wall that follows keeps its far
 * end and its angle: its joined end slides along its own line to where it
 * meets the changed wall's line, so it only gets longer or shorter — 90°
 * stays 90°. Only when it can't meet the changed wall that way (a T slid
 * off the end of it, lines gone parallel) does it turn, and then in whole
 * 15° steps (the step nearest what following the joint would give):
 * - at a corner (its end met a changed wall's end) both ends go to that
 *   meeting point — the changed wall stretches or shortens along its own
 *   line to keep the corner closed;
 * - at a T (its end partway along a changed wall) it ends on the changed
 *   wall there;
 * - a changed wall's end that stood partway along an unchanged wall slides
 *   along that wall to where the changed wall's line now crosses it.
 * Ends in `free` were dragged: they go where they were dropped, and the
 * walls meeting them there (a corner) follow exactly. A wall joined at
 * both ends to changed walls follows both joints exactly.
 * Lengths are recomputed for every wall that changed.
 */
export function keepWallsJoined(
  before: CabinetSketchWall[],
  after: CabinetSketchWall[],
  changedIds: Set<string>,
  scalePixelsPerFoot: number,
  free: { id: string; end: End }[] = []
): CabinetSketchWall[] {
  const moved = new Map(after.map((w) => [w.id, w]));
  const changedBefore = before.filter((w) => changedIds.has(w.id));
  const fixedBefore = before.filter((w) => !changedIds.has(w.id));
  const isFree = (id: string, end: End) => free.some((f) => f.id === id && f.end === end);

  const jointAt = (p: Pt): Joint | null => {
    for (const c of changedBefore) {
      if (near(p, endOf(c, 'start'))) return { host: c.id, hostEnd: 'start', t: 0 };
      if (near(p, endOf(c, 'end'))) return { host: c.id, hostEnd: 'end', t: 1 };
    }
    for (const c of changedBefore) {
      const t = paramOn(p, c);
      if (t !== null) return { host: c.id, hostEnd: null, t };
    }
    return null;
  };

  // Changed walls' ends moved to close a corner, and unchanged walls' ends that follow.
  const pins = new Map<string, Pt>();
  const placed = new Map<string, Pt>();
  const key = (id: string, end: End) => `${id}|${end}`;
  const hostNow = (id: string): CabinetSketchWall => {
    let h = moved.get(id)!;
    for (const end of ['start', 'end'] as End[]) {
      const p = pins.get(key(id, end));
      if (p) h = withEnd(h, end, p);
    }
    return h;
  };

  const followers = fixedBefore.flatMap((wall) => {
    const joints = { start: jointAt(endOf(wall, 'start')), end: jointAt(endOf(wall, 'end')) };
    return (['start', 'end'] as End[])
      .filter((end) => joints[end])
      .map((end) => ({ wall, end, joint: joints[end]!, both: !!joints[otherEnd(end)] }));
  });
  const keepsAngle = (f: (typeof followers)[number]) =>
    !f.both && !(f.joint.hostEnd && isFree(f.joint.host, f.joint.hostEnd));

  // Corners first: where they close decides the changed walls' ends that the Ts then sit on.
  for (const f of followers) {
    if (!f.joint.hostEnd || !keepsAngle(f)) continue;
    const corner = key(f.joint.host, f.joint.hostEnd);
    const host = moved.get(f.joint.host)!;
    const e = endOf(host, f.joint.hostEnd);
    const o = endOf(host, otherEnd(f.joint.hostEnd));
    // The corner must stay on the changed wall's side of its other end.
    const fits = (p: Pt) => (p.x - o.x) * (e.x - o.x) + (p.y - o.y) * (e.y - o.y) > 0 && Math.hypot(p.x - o.x, p.y - o.y) >= 1;
    const p =
      pins.get(corner) ?? steppedJoin(endOf(f.wall, otherEnd(f.end)), endOf(f.wall, f.end), e, host, fits) ?? e;
    placed.set(key(f.wall.id, f.end), p);
    if (p !== e) pins.set(corner, p);
  }
  for (const f of followers) {
    if (f.joint.hostEnd || !keepsAngle(f)) continue;
    const host = hostNow(f.joint.host);
    const natural = pointAt(host, f.joint.t);
    const p =
      steppedJoin(endOf(f.wall, otherEnd(f.end)), endOf(f.wall, f.end), natural, host, (_p, t) => t >= 0 && t <= 1) ??
      natural;
    placed.set(key(f.wall.id, f.end), p);
  }
  // Dragged corners and walls held at both ends follow their joints exactly.
  for (const f of followers) {
    if (keepsAngle(f)) continue;
    const host = hostNow(f.joint.host);
    placed.set(key(f.wall.id, f.end), f.joint.hostEnd ? endOf(host, f.joint.hostEnd) : pointAt(host, f.joint.t));
  }

  const old = new Map(before.map((w) => [w.id, w]));
  return after.map((wall) => {
    const was = old.get(wall.id);
    if (!was) return wall;
    let next = changedIds.has(was.id) ? hostNow(was.id) : was;
    for (const end of ['start', 'end'] as End[]) {
      const p = placed.get(key(was.id, end));
      if (p) {
        next = withEnd(next, end, p);
        continue;
      }
      if (!changedIds.has(was.id) || isFree(was.id, end) || pins.has(key(was.id, end))) continue;
      // A changed wall's end on an unchanged wall's side slides along it.
      const host = fixedBefore.find((f) => paramOn(endOf(was, end), f) !== null);
      if (!host) continue;
      const t = crossingOn(endOf(next, 'start'), endOf(next, 'end'), host);
      if (t === null || t < 0 || t > 1) continue;
      next = withEnd(next, end, pointAt(host, t));
    }
    const same = (['start_x', 'start_y', 'end_x', 'end_y'] as const).every((k) => Math.abs(next[k] - was[k]) < 1e-9);
    return same ? was : withLength(next, scalePixelsPerFoot);
  });
}

/** Every wall after `ids` move by (dx, dy), the walls joined to them following. */
export function moveWallsJoined(
  walls: CabinetSketchWall[],
  ids: Set<string>,
  dx: number,
  dy: number,
  scalePixelsPerFoot: number
): CabinetSketchWall[] {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return walls;
  const after = walls.map((w) =>
    ids.has(w.id)
      ? { ...w, start_x: w.start_x + dx, start_y: w.start_y + dy, end_x: w.end_x + dx, end_y: w.end_y + dy }
      : w
  );
  return keepWallsJoined(walls, after, ids, scalePixelsPerFoot);
}

/**
 * Every wall after one wall's end is dropped at `to`: the walls that met it
 * there (a corner) move with it, and those ending partway along the wall
 * stay on it, keeping their angle (or turning in 15° steps).
 */
export function moveWallEndJoined(
  walls: CabinetSketchWall[],
  wallId: string,
  end: End,
  to: Pt,
  scalePixelsPerFoot: number
): CabinetSketchWall[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return walls;
  const after = walls.map((w) => (w.id === wallId ? withEnd(w, end, to) : w));
  return keepWallsJoined(walls, after, new Set([wallId]), scalePixelsPerFoot, [{ id: wallId, end }]);
}

/**
 * The ids of the walls whose end meets `wallId`'s `end` there — they move
 * with that end, so a dropped end must not snap onto them.
 */
export function wallsMeetingEnd(walls: CabinetSketchWall[], wallId: string, end: End): string[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return [];
  const p = endOf(wall, end);
  return walls
    .filter((w) => w.id !== wallId && (near(p, endOf(w, 'start')) || near(p, endOf(w, 'end'))))
    .map((w) => w.id);
}
