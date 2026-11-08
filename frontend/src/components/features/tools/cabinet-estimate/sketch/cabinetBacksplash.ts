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
 * What the sketch saves for each face (SplashChoices): a face behind a
 * run's backs has backsplash unless it is left off; a side wall at a run's
 * end — tiled in some kitchens, not in others — has none unless it is
 * ticked on. A face's backsplash can stop short of either end, so many
 * inches in from its left or right as you face that wall.
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
   * Where each face's backsplash goes (faceKeeps of the layout): faces with
   * none, and how much of a face is kept when it stops short of an end.
   * Absent: every side against a wall has it, end to end.
   */
  faces?: ReadonlyMap<string, FaceKeep> | null;
}

/** What the sketch saves about its backsplash faces (splashFaceKey keys). */
export interface SplashChoices {
  /** Faces left without backsplash. */
  off?: readonly string[] | null;
  /** Faces given it that start without one: a side wall at a run's end. */
  on?: readonly string[] | null;
  /** Inches it stops short of a face's [left, right] end, as you face that wall. */
  trim?: Readonly<Record<string, readonly number[]>> | null;
}

/** A face as the 3D view draws it: none, or kept from `from` to `to` along its face (FaceFrame's `along`). */
export interface FaceKeep {
  off: boolean;
  from: number;
  to: number;
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
  /** Without backsplash (left off, or a side wall not ticked on): not measured, not drawn. */
  off: boolean;
  /** The tile backsplash's stretches on it, and the 4" countertop one's (none behind a range), as far as it is kept. */
  tile: SplashSpan[];
  counter: SplashSpan[];
  tileIn: number;
  counterIn: number;
  /** The stretches end to end, before it stops short of either end. */
  uncut: { tile: SplashSpan[]; counter: SplashSpan[] };
  /** How far the tile runs end to end, inches. */
  wholeIn: number;
  /** Inches it stops short of the [left, right] end, as you face the wall. */
  trim: [number, number];
  /** The part kept, along the face (FaceFrame's `along`), for the 3D view. */
  keep: [number, number];
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

/** Pieces closer than this along a line are one stretch, inches; a stretch cut shorter than it is gone. */
const JOIN_IN = 0.5;

/** A saved trim as two inch figures, nothing negative or unreadable. */
const trimOf = (saved: readonly number[] | undefined): [number, number] => {
  const inch = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return [inch(saved?.[0]), inch(saved?.[1])];
};

/**
 * The backsplash as measured: the pieces on each face of each wall joined
 * into stretches, the tile and the 4" countertop splash apiece, cut back
 * where the sketch has it stop short of an end. Faces without it (see
 * SplashChoices) are listed, marked off, and left out of the totals.
 */
export function backsplashLayout(
  pieces: SplashPiece[],
  walls: WallSolid[],
  choices: SplashChoices = {}
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
  const offKeys = new Set(choices.off ?? []);
  const onKeys = new Set(choices.on ?? []);

  const byKey = new Map<string, Placed[]>();
  for (const p of placed) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);

  const faces: SplashFace[] = [];
  for (const [key, group] of Array.from(byKey.entries())) {
    const { origin, u, n } = group[0];
    const off = group.reduce((sum, p) => sum + p.off, 0) / group.length;
    const at = (t: number): Pt2 => [origin[0] + u[0] * t + -u[1] * off, origin[1] + u[1] * t + u[0] * off];
    const joinedOf = (list: Placed[]): [number, number][] => {
      const sorted = [...list].sort((p, q) => p.t0 - q.t0);
      const joined: [number, number][] = [];
      for (const p of sorted) {
        const last = joined[joined.length - 1];
        if (last && p.t0 <= last[1] + JOIN_IN) last[1] = Math.max(last[1], p.t1);
        else joined.push([p.t0, p.t1]);
      }
      return joined;
    };
    const spansOf = (joined: [number, number][]): SplashSpan[] =>
      joined.map(([t0, t1]) => ({ a: at(t0), b: at(t1), normal: n, lengthIn: t1 - t0 }));

    // Facing the wall from the counter, the right hand points along
    // (n.z, -n.x) on the plan (whose z runs down the screen); when that is
    // the way `u` runs, a face's left end is where `along` is least.
    const leftFirst = n[1] * u[0] - n[0] * u[1] > 0;
    const trim = trimOf(choices.trim?.[key]);
    const tileJoined = joinedOf(group);
    const lo = Math.min(...tileJoined.map(([t0]) => t0));
    const hi = Math.max(...tileJoined.map(([, t1]) => t1));
    const keep: [number, number] = leftFirst ? [lo + trim[0], hi - trim[1]] : [lo + trim[1], hi - trim[0]];
    const cut = (joined: [number, number][]) =>
      joined
        .map(([t0, t1]): [number, number] => [Math.max(t0, keep[0]), Math.min(t1, keep[1])])
        .filter(([t0, t1]) => t1 - t0 >= JOIN_IN);

    const counterJoined = joinedOf(group.filter((p) => p.piece.counter));
    const tile = spansOf(cut(tileJoined));
    const counter = spansOf(cut(counterJoined));
    const back = group.some((p) => p.piece.back);
    faces.push({
      key,
      // A side wall at a run's end starts without; a face ticked one way stays that way.
      off: onKeys.has(key) ? false : offKeys.has(key) ? true : !back,
      tile,
      counter,
      tileIn: tile.reduce((sum, s) => sum + s.lengthIn, 0),
      counterIn: counter.reduce((sum, s) => sum + s.lengthIn, 0),
      uncut: { tile: spansOf(tileJoined), counter: spansOf(counterJoined) },
      wholeIn: tileJoined.reduce((sum, [t0, t1]) => sum + (t1 - t0), 0),
      trim,
      keep,
      ownerIds: Array.from(new Set(group.map((p) => p.piece.ownerId))),
      back,
    });
  }
  const on = faces.filter((f) => !f.off);
  return {
    faces,
    tileIn: on.reduce((sum, f) => sum + f.tileIn, 0),
    counterIn: on.reduce((sum, f) => sum + f.counterIn, 0),
  };
}

/** Each face as the 3D view draws it (BacksplashSpec.faces). */
export function faceKeeps(layout: BacksplashLayout): Map<string, FaceKeep> {
  return new Map(layout.faces.map((f) => [f.key, { off: f.off, from: f.keep[0], to: f.keep[1] }]));
}

/** The faces as one string, so a view can tell new faces from the same ones again. */
export const faceKeepsText = (faces: ReadonlyMap<string, FaceKeep> | null | undefined): string =>
  faces && faces.size
    ? JSON.stringify(
        Array.from(faces.entries(), ([key, f]) => [key, f.off ? 1 : 0, Math.round(f.from * 100) / 100, Math.round(f.to * 100) / 100])
      )
    : '';

/** faceKeepsText read back. */
export function faceKeepsFromText(text: string): Map<string, FaceKeep> | null {
  if (!text) return null;
  const rows = JSON.parse(text) as [string, number, number, number][];
  return new Map(rows.map(([key, off, from, to]) => [key, { off: off === 1, from, to }]));
}

/**
 * How much of the side a→b (plan inches, the counter toward `inside`) has
 * backsplash, as fractions along a→b: all of it unless its face is off or
 * stops short of an end there. Null for none.
 */
export function keptPart(
  a: Pt2,
  b: Pt2,
  inside: Pt2,
  walls: WallSolid[],
  faces: ReadonlyMap<string, FaceKeep> | null | undefined
): [number, number] | null {
  if (!faces || !faces.size) return [0, 1];
  const frame = faceFrame(a, b, inside, walls);
  const keep = frame && faces.get(frame.key);
  if (!frame || !keep) return [0, 1];
  if (keep.off || keep.to - keep.from < JOIN_IN) return null;
  const along = (p: Pt2) => (p[0] - frame.origin[0]) * frame.u[0] + (p[1] - frame.origin[1]) * frame.u[1];
  const ta = along(a);
  const tb = along(b);
  if (Math.abs(tb - ta) < 1e-6) return [0, 1];
  const [f0, f1] = [(keep.from - ta) / (tb - ta), (keep.to - ta) / (tb - ta)].sort((p, q) => p - q);
  const from = Math.max(0, f0);
  const to = Math.min(1, f1);
  return (to - from) * Math.abs(tb - ta) >= JOIN_IN ? [from, to] : null;
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
