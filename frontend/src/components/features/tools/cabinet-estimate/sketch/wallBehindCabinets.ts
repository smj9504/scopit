/**
 * Drawing a wall against cabinets already on the plan. Walls are drawn by
 * their middle line, so a wall drawn along a cabinet's back edge would
 * cover the cabinet's back half a wall thick. Instead, a wall point near a
 * cabinet's back — or on the cabinet itself — lands on the line half a wall
 * thickness behind that back: the wall comes out behind the cabinets, its
 * face on their backs, where a cabinet dropped on it would back onto it
 * (see snapCabinetToWall). Island cabinets have no wall behind them. An L
 * or diagonal corner cabinet has two backs: its own and its end in the
 * corner, the two lines meeting where the room's corner is.
 */

import type { CabinetSketchCabinet } from '@/types/cabinetSketch';
import type { CornerKind } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';

type Pt = { x: number; y: number };

/** A line a wall's middle can run along behind a cabinet, and the cabinet's footprint it stands behind. */
export interface WallLineBehind {
  a: Pt;
  b: Pt;
  cabinet: Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation'>;
}

/** How far past a cabinet's ends its back line still catches a wall point — to the room's corner, along the run. */
export const BEHIND_REACH_FT = 10;

/** A cabinet's frame: across its width, and toward its front. */
function frame(c: WallLineBehind['cabinet']) {
  const r = (c.rotation * Math.PI) / 180;
  const ux = { x: Math.cos(r), y: Math.sin(r) };
  const toFront = { x: -Math.sin(r), y: Math.cos(r) };
  const at = (along: number, front: number): Pt => ({
    x: c.x + ux.x * along + toFront.x * front,
    y: c.y + ux.y * along + toFront.y * front,
  });
  const local = (p: Pt) => {
    const d = { x: p.x - c.x, y: p.y - c.y };
    return { along: d.x * ux.x + d.y * ux.y, front: d.x * toFront.x + d.y * toFront.y };
  };
  return { at, local };
}

/**
 * The lines a wall `thickness` thick runs along, by its middle, to stand
 * behind a cabinet: one behind its back, and for an L or diagonal corner
 * one behind its corner end too (local x = 0, or its far end when
 * `cornerSide` is 'right'). None for an island cabinet.
 */
export function wallLinesBehind(
  cabinet: Pick<CabinetSketchCabinet, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'location'>,
  corner: { kind: CornerKind; side: 'left' | 'right' } | null,
  thickness: number
): WallLineBehind[] {
  if (cabinet.location === 'island') return [];
  const half = thickness / 2;
  const { at } = frame(cabinet);
  const { width: w, height: h } = cabinet;
  if (corner && (corner.kind === 'l' || corner.kind === 'diagonal')) {
    // The two lines meet behind the corner, where the room's corner is.
    const end = corner.side === 'right' ? w + half : -half;
    const roomCorner = at(end, -half);
    const farBack = at(corner.side === 'right' ? 0 : w, -half);
    return [
      { a: corner.side === 'right' ? farBack : roomCorner, b: corner.side === 'right' ? roomCorner : farBack, cabinet },
      { a: roomCorner, b: at(end, h), cabinet },
    ];
  }
  return [{ a: at(0, -half), b: at(w, -half), cabinet }];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Whether `p` lies on the cabinet's footprint (its box). */
function onCabinet(p: Pt, c: WallLineBehind['cabinet']): boolean {
  const { along, front } = frame(c).local(p);
  return along >= 0 && along <= c.width && front >= 0 && front <= c.height;
}

/**
 * Where a wall point at `pos` lands behind the cabinets: on a line's end
 * (a run's end, a room corner behind a corner cabinet) within `threshold`,
 * else on a line within `threshold` of it — or on the line behind the
 * cabinet `pos` is on — up to `reach` past the line's ends. `along` is
 * Shift's axis lock: the point then only slides along the line from
 * `along` through `pos`. `end` says it landed on a line's end. Null when
 * no cabinet is near.
 */
export function snapBehindCabinets(
  pos: Pt,
  lines: WallLineBehind[],
  threshold: number,
  opts: { along?: Pt; reach?: number } = {}
): { point: Pt; end: boolean } | null {
  let best: Pt | null = null;
  let bestDist = threshold;
  for (const l of lines) {
    for (const p of [l.a, l.b]) {
      const d = dist(p, pos);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  if (best) return { point: best, end: true };

  const reach = opts.reach ?? 0;
  let bestOn = Infinity;
  for (const l of lines) {
    const len = dist(l.a, l.b);
    if (len < 1e-9) continue;
    const dir = { x: (l.b.x - l.a.x) / len, y: (l.b.y - l.a.y) / len };
    let s: number;
    if (opts.along) {
      const r = { x: pos.x - opts.along.x, y: pos.y - opts.along.y };
      const cross = r.x * dir.y - r.y * dir.x;
      // Running alongside the line never meets it.
      if (Math.abs(cross) < 1e-9) continue;
      s = ((l.a.x - opts.along.x) * r.y - (l.a.y - opts.along.y) * r.x) / cross;
    } else {
      s = (pos.x - l.a.x) * dir.x + (pos.y - l.a.y) * dir.y;
    }
    if (s < -reach || s > len + reach) continue;
    const p = { x: l.a.x + dir.x * s, y: l.a.y + dir.y * s };
    const d = dist(p, pos);
    // A point on the cabinet itself goes behind it however deep the cabinet is.
    if (d >= threshold && !onCabinet(pos, l.cabinet)) continue;
    if (d < bestOn) {
      bestOn = d;
      best = p;
    }
  }
  return best ? { point: best, end: false } : null;
}

/**
 * The nearer of two snaps for a wall point — one onto the walls already
 * drawn, one behind the cabinets — ends (a wall's end, a run's end) before
 * points along a line. `pos` is where the point was before snapping.
 */
export function nearerWallPoint(
  pos: Pt,
  onWall: { point: Pt; snapped: boolean; end: boolean },
  behind: { point: Pt; end: boolean } | null
): { point: Pt; snapped: boolean } {
  if (!behind) return { point: onWall.point, snapped: onWall.snapped };
  if (!onWall.snapped) return { point: behind.point, snapped: true };
  if (onWall.end !== behind.end) return onWall.end ? onWall : { point: behind.point, snapped: true };
  return dist(onWall.point, pos) <= dist(behind.point, pos) ? onWall : { point: behind.point, snapped: true };
}
