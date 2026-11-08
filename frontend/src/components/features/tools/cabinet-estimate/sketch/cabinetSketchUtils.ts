/**
 * Small domain-agnostic helpers for the cabinet sketch canvas.
 * Mirrors water-mitigation/sketch/utils/wmCalculations.ts's
 * pixelsToFeet/generateOverlayId — kept as a local copy rather than a
 * cross-domain import, consistent with this codebase's convention of each
 * sketch feature owning its own small utilities.
 */

export function pixelsToFeet(px: number, scalePixelsPerFoot: number): number {
  if (scalePixelsPerFoot <= 0) return 0;
  return px / scalePixelsPerFoot;
}

export function feetToPixels(ft: number, scalePixelsPerFoot: number): number {
  return ft * scalePixelsPerFoot;
}

export function generateOverlayId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

type Pt = { x: number; y: number };
type WallLine = { id?: string; start_x: number; start_y: number; end_x: number; end_y: number };

/**
 * Where a wall being drawn (or a wall end being dragged) lands among the
 * walls already there: on a wall end within `threshold`, else anywhere along
 * a wall within it — so a new wall can start or stop partway along one (a T).
 * `along` is Shift's axis lock: the point then only slides along the line from
 * `along` through `pos`, to where that line meets the wall. `excludeId` is the
 * wall being dragged, which never snaps to itself.
 */
export function snapToWall(
  pos: Pt,
  walls: WallLine[],
  threshold: number,
  opts: { along?: Pt; excludeId?: string } = {}
): { point: Pt; snapped: boolean } {
  const others = opts.excludeId ? walls.filter((w) => w.id !== opts.excludeId) : walls;

  let best: Pt | null = null;
  let bestDist = threshold;
  for (const w of others) {
    for (const end of [
      { x: w.start_x, y: w.start_y },
      { x: w.end_x, y: w.end_y },
    ]) {
      const d = Math.hypot(end.x - pos.x, end.y - pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  if (best) return { point: best, snapped: true };

  for (const w of others) {
    const p = pointOnWall(pos, w, opts.along);
    if (!p) continue;
    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { point: best, snapped: true } : { point: pos, snapped: false };
}

/** The point of a wall `pos` lands on: straight across to it, or along the line from `along` through `pos`. */
function pointOnWall(pos: Pt, w: WallLine, along?: Pt): Pt | null {
  const dx = w.end_x - w.start_x;
  const dy = w.end_y - w.start_y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  let t: number;
  if (along) {
    const rx = pos.x - along.x;
    const ry = pos.y - along.y;
    const cross = rx * dy - ry * dx;
    // Running alongside the wall never meets it.
    if (Math.abs(cross) < 1e-9) return null;
    t = ((w.start_x - along.x) * ry - (w.start_y - along.y) * rx) / cross;
  } else {
    t = ((pos.x - w.start_x) * dx + (pos.y - w.start_y) * dy) / len2;
  }
  // Past a wall's ends is the ends' business.
  if (t < 0 || t > 1) return null;
  return { x: w.start_x + t * dx, y: w.start_y + t * dy };
}

/** Constrain a point to horizontal or vertical relative to start (Shift-drag). */
export function constrainToAxis(
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number } {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx > dy) return { x: end.x, y: start.y };
  return { x: start.x, y: end.y };
}
