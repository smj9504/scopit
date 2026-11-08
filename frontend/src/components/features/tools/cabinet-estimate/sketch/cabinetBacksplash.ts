/**
 * Where the kitchen's backsplashes go — the tile backsplash (the Edit tab's
 * Backsplash) and the 4" countertop backsplash — worked out once from the
 * 3D model (cabinet3dModel.ts), so the 3D view, the Front view, the plan
 * and the count on the plan all show the same pieces.
 *
 * A backsplash runs along each side of a perimeter base that lies against a
 * drawn wall: its back, an L or diagonal corner's side leg, and a run's end
 * set against a side wall. Behind a dishwasher standing at a wall too, and
 * the tile — not the 4" countertop splash, which needs a counter — behind a
 * range and its range base. With no walls drawn yet, every base's back (and
 * a corner's side leg) counts as on its wall. Island cabinets take none.
 *
 * Pieces on the same face of a wall are measured as one stretch, so a
 * range drawn in its range base, or a run's end meeting the next run's
 * back in a corner, is not counted twice.
 *
 * Pure, so it is tested without WebGL.
 */

import { COUNTER_TOP_IN } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import { toPlan } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import type { ApplianceSolid, CabinetSolid, Pt2, WallSolid } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import type { ElevationRun } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';

/** A side within this of a wall's face lies against it (the plan snaps backs to the face), inches. */
export const WALL_TOUCH_IN = 2;
/** How high the countertop backsplash stands over the counter, inches. */
export const COUNTER_SPLASH_IN = 4;

/** The Edit tab's backsplashes, as the views draw them. */
export interface BacksplashSpec {
  /** The tile backsplash's height over the counter, inches; null for none. */
  tileIn: number | null;
  /** The 4" countertop backsplash (with the countertop). */
  counter: boolean;
  /**
   * Faces left without backsplash (splashFaceKey), as the sketch saves them
   * — a side wall at a run's end is tiled in some kitchens and not in others.
   */
  off?: string[] | null;
}

/** The wall whose face the side pa→pb (plan inches) lies against, along it and within its length; null for none. */
export function wallAgainst(pa: Pt2, pb: Pt2, walls: WallSolid[]): WallSolid | null {
  return (
    walls.find((w) => {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 1) return false;
      const ux = (w.b[0] - w.a[0]) / len;
      const uz = (w.b[1] - w.a[1]) / len;
      const off = (p: Pt2) => Math.abs((p[0] - w.a[0]) * -uz + (p[1] - w.a[1]) * ux) - w.thickness / 2;
      const along = (p: Pt2) => (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz;
      if (Math.abs(off(pa)) > WALL_TOUCH_IN || Math.abs(off(pb)) > WALL_TOUCH_IN) return false;
      return Math.max(along(pa), along(pb)) > WALL_TOUCH_IN && Math.min(along(pa), along(pb)) < len - WALL_TOUCH_IN;
    }) ?? null
  );
}

/** Whether the side pa→pb (plan inches) lies against a wall's face, along it and within its length. */
export const againstWall = (pa: Pt2, pb: Pt2, walls: WallSolid[]) => wallAgainst(pa, pb, walls) !== null;

/** A perimeter base: on the floor, no taller than the counter, not in the island. */
export const isPerimeterBase = (solid: CabinetSolid) =>
  solid.bottom < 1 && solid.height < COUNTER_TOP_IN + 1 && solid.cabinet.location !== 'island';

/** The sides of a perimeter base's outline (side i runs from point i to the next) that take a backsplash. */
export function splashSides(solid: CabinetSolid, walls: WallSolid[]): number[] {
  if (!isPerimeterBase(solid)) return [];
  const pts = solid.outline;
  const sides: number[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const onWall = walls.length ? againstWall(toPlan(solid, a), toPlan(solid, b), walls) : solid.backs[i];
    if (onWall) sides.push(i);
  });
  return sides;
}

/** Whether an appliance has a backsplash behind it: a dishwasher (tile and the 4" one, as the counter runs over it) or a range (tile only). */
export function applianceSplash(a: ApplianceSolid, walls: WallSolid[]): { tile: boolean; counter: boolean } {
  const range = a.spec.model === 'range';
  if ((!a.counter && !range) || a.bottom > 1) return { tile: false, counter: false };
  const onWall = !walls.length || againstWall(toPlan(a, [0, a.back]), toPlan(a, [a.width, a.back]), walls);
  return { tile: onWall, counter: onWall && a.counter };
}

/** One side with a backsplash, plan inches. */
export interface SplashPiece {
  a: Pt2;
  b: Pt2;
  /** A point on the counter's side of it. */
  inside: Pt2;
  /** The 4" countertop splash runs here too: there is a counter (not a range). */
  counter: boolean;
  /** The cabinet or appliance it is behind. */
  ownerId: string;
  /** A back (else a run's end against a side wall). */
  back: boolean;
}

const middle = (pts: Pt2[]): Pt2 => [
  pts.reduce((sum, [x]) => sum + x, 0) / pts.length,
  pts.reduce((sum, [, z]) => sum + z, 0) / pts.length,
];

/** Every side with a backsplash, cabinets' and appliances'. */
export function splashPieces(solids: CabinetSolid[], appliances: ApplianceSolid[], walls: WallSolid[]): SplashPiece[] {
  const pieces: SplashPiece[] = [];
  for (const solid of solids) {
    const pts = solid.outline;
    const inside = toPlan(solid, middle(pts));
    for (const i of splashSides(solid, walls)) {
      pieces.push({
        a: toPlan(solid, pts[i]),
        b: toPlan(solid, pts[(i + 1) % pts.length]),
        inside,
        counter: !!solid.counter,
        ownerId: solid.cabinet.id,
        back: solid.backs[i],
      });
    }
  }
  for (const a of appliances) {
    const s = applianceSplash(a, walls);
    if (!s.tile) continue;
    pieces.push({
      a: toPlan(a, [0, a.back]),
      b: toPlan(a, [a.width, a.back]),
      inside: toPlan(a, [a.width / 2, a.back + a.depth]),
      counter: s.counter,
      ownerId: a.appliance.id,
      back: true,
    });
  }
  return pieces;
}

/** A stretch of backsplash, plan inches, laid along a wall's face. */
export interface SplashSpan {
  a: Pt2;
  b: Pt2;
  /** Unit vector from the wall toward the counter. */
  normal: Pt2;
  lengthIn: number;
}

/** Where a side with backsplash lies: the face it is on, along it (`u` from `origin`) and toward the counter (`n`). */
interface FaceFrame {
  key: string;
  origin: Pt2;
  u: Pt2;
  n: Pt2;
  /** How far a point is off the wall's (or line's) middle, to its left going along u. */
  sideOf: (p: Pt2) => number;
}

function faceFrame(a: Pt2, b: Pt2, inside: Pt2, walls: WallSolid[]): FaceFrame | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return null;
  const wall = wallAgainst(a, b, walls);
  let origin: Pt2;
  let u: Pt2;
  let key: string;
  if (wall) {
    const wl = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    origin = wall.a;
    u = [(wall.b[0] - wall.a[0]) / wl, (wall.b[1] - wall.a[1]) / wl];
    key = wall.id;
  } else {
    // No wall drawn: the line it is on, its direction made one way round.
    u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = [-u[0], -u[1]];
    origin = [0, 0];
    const c = a[0] * -u[1] + a[1] * u[0];
    key = `line:${Math.round((Math.atan2(u[1], u[0]) * 180) / Math.PI)}:${Math.round(c)}`;
  }
  const n0: Pt2 = [-u[1], u[0]];
  const sideOf = (p: Pt2) => (p[0] - origin[0]) * n0[0] + (p[1] - origin[1]) * n0[1];
  const side = sideOf(inside) - sideOf(a) >= 0 ? 1 : -1;
  return { key: `${key}:${side}`, origin, u, n: [n0[0] * side, n0[1] * side], sideOf };
}

/**
 * The face of a wall the side a→b (plan inches, the counter toward
 * `inside`) has its backsplash on: the wall and which of its two faces, or,
 * with no wall drawn there, the line. Null for a side too short to count.
 */
export const splashFaceKey = (a: Pt2, b: Pt2, inside: Pt2, walls: WallSolid[]): string | null =>
  faceFrame(a, b, inside, walls)?.key ?? null;

/** One face of a wall (or, with no walls drawn, one line) with backsplash on it. */
export interface SplashFace {
  key: string;
  /** Left without backsplash (BacksplashSpec.off): not measured, not drawn. */
  off: boolean;
  /** The tile backsplash's stretches on it, and the 4" countertop one's (none behind a range). */
  tile: SplashSpan[];
  counter: SplashSpan[];
  tileIn: number;
  counterIn: number;
  /** The cabinets and appliances it runs behind. */
  ownerIds: string[];
  /** Behind a run's backs (else only the end of a run, against a side wall). */
  back: boolean;
}

export interface BacksplashLayout {
  faces: SplashFace[];
  /** Totals, inches. */
  tileIn: number;
  counterIn: number;
}

/** Pieces closer than this along a line are one stretch, inches. */
const JOIN_IN = 0.5;

/**
 * The backsplash as measured: the pieces on each face of each wall joined
 * into stretches, the tile and the 4" countertop splash apiece. Faces in
 * `off` are listed, marked off, and left out of the totals.
 */
export function backsplashLayout(
  pieces: SplashPiece[],
  walls: WallSolid[],
  off: readonly string[] = []
): BacksplashLayout {
  type Placed = { piece: SplashPiece; key: string; origin: Pt2; u: Pt2; n: Pt2; off: number; t0: number; t1: number };
  const placed: Placed[] = [];
  for (const piece of pieces) {
    const frame = faceFrame(piece.a, piece.b, piece.inside, walls);
    if (!frame) continue;
    const { key, origin, u, n, sideOf } = frame;
    const along = (p: Pt2) => (p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1];
    const [t0, t1] = [along(piece.a), along(piece.b)].sort((p, q) => p - q);
    placed.push({ piece, key, origin, u, n, off: (sideOf(piece.a) + sideOf(piece.b)) / 2, t0, t1 });
  }
  const offKeys = new Set(off);

  const byKey = new Map<string, Placed[]>();
  for (const p of placed) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);

  const faces: SplashFace[] = [];
  for (const [key, group] of Array.from(byKey.entries())) {
    const { origin, u, n } = group[0];
    const off = group.reduce((sum, p) => sum + p.off, 0) / group.length;
    const spans = (list: Placed[]): SplashSpan[] => {
      const sorted = [...list].sort((p, q) => p.t0 - q.t0);
      const joined: [number, number][] = [];
      for (const p of sorted) {
        const last = joined[joined.length - 1];
        if (last && p.t0 <= last[1] + JOIN_IN) last[1] = Math.max(last[1], p.t1);
        else joined.push([p.t0, p.t1]);
      }
      const at = (t: number): Pt2 => [
        origin[0] + u[0] * t + -u[1] * off,
        origin[1] + u[1] * t + u[0] * off,
      ];
      return joined.map(([t0, t1]) => ({ a: at(t0), b: at(t1), normal: n, lengthIn: t1 - t0 }));
    };
    const tile = spans(group);
    const counter = spans(group.filter((p) => p.piece.counter));
    faces.push({
      key,
      off: offKeys.has(key),
      tile,
      counter,
      tileIn: tile.reduce((sum, s) => sum + s.lengthIn, 0),
      counterIn: counter.reduce((sum, s) => sum + s.lengthIn, 0),
      ownerIds: Array.from(new Set(group.map((p) => p.piece.ownerId))),
      back: group.some((p) => p.piece.back),
    });
  }
  const on = faces.filter((f) => !f.off);
  return {
    faces,
    tileIn: on.reduce((sum, f) => sum + f.tileIn, 0),
    counterIn: on.reduce((sum, f) => sum + f.counterIn, 0),
  };
}

/** A run's backsplash in its own frame: inches from the run's left edge, as the Front view draws it. */
export interface RunSplash {
  tile: [number, number][];
  counter: [number, number][];
}

/** Off parallel (sine) and off the run's back line (inches) a stretch may be and still be on it. */
const RUN_PARALLEL_SIN = Math.sin((3 * Math.PI) / 180);
const RUN_BACK_IN = 6;

/**
 * The stretches of backsplash behind a Front-view run, along it. The run's
 * frame comes from its first cabinet: its turn gives the run's direction,
 * and where it stands (`toIn` turns its plan pixels to inches) where the
 * run's left edge and back line are.
 */
export function splashOnRun(run: ElevationRun, layout: BacksplashLayout, toIn: (px: number) => number): RunSplash {
  const out: RunSplash = { tile: [], counter: [] };
  const first = run.items[0];
  if (!first || run.island) return out;
  const r = (first.cabinet.rotation * Math.PI) / 180;
  const ux: Pt2 = [Math.cos(r), Math.sin(r)];
  const back: Pt2 = [Math.sin(r), -Math.cos(r)];
  const corner: Pt2 = [toIn(first.cabinet.x), toIn(first.cabinet.y)];
  const dot = (p: Pt2, v: Pt2) => p[0] * v[0] + p[1] * v[1];
  const left = dot(corner, ux) - first.left_in;
  const line = dot(corner, back);
  const onRun = (s: SplashSpan): [number, number] | null => {
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5 || Math.abs((dx * ux[1] - dz * ux[0]) / len) > RUN_PARALLEL_SIN) return null;
    // Facing the room in front of the run, on its back line.
    if (dot(s.normal, back) > 0) return null;
    const mid: Pt2 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    if (Math.abs(dot(mid, back) - line) > RUN_BACK_IN) return null;
    const [p, q] = [dot(s.a, ux) - left, dot(s.b, ux) - left].sort((m, n) => m - n);
    return [p, q];
  };
  for (const face of layout.faces) {
    if (face.off) continue;
    for (const s of face.tile) {
      const span = onRun(s);
      if (span) out.tile.push(span);
    }
    for (const s of face.counter) {
      const span = onRun(s);
      if (span) out.counter.push(span);
    }
  }
  return out;
}
