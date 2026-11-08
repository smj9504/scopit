/**
 * Where a wall being drawn (or a wall end being dragged) lands among the
 * walls already there: on a wall end within `radius`, else anywhere along a
 * wall within it — so a new wall can start or stop partway along one (a T).
 * `excludeId` is the wall being dragged, which never snaps to itself.
 */

import type { BEPoint, BEWall } from '@/types/bathroomSketch';

export function snapToWalls(
  p: BEPoint,
  walls: Pick<BEWall, 'id' | 'start' | 'end'>[],
  radius: number,
  opts: { alongWalls?: boolean; excludeId?: string } = {},
): BEPoint {
  const others = opts.excludeId ? walls.filter((w) => w.id !== opts.excludeId) : walls;

  let best: BEPoint | null = null;
  let bestDist = radius;
  for (const w of others) {
    for (const end of [w.start, w.end]) {
      const d = Math.hypot(end.x - p.x, end.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  if (best || !opts.alongWalls) return best ?? p;

  for (const w of others) {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    const t = ((p.x - w.start.x) * dx + (p.y - w.start.y) * dy) / len2;
    // Past a wall's ends is the ends' business.
    if (t < 0 || t > 1) continue;
    const q = { x: w.start.x + t * dx, y: w.start.y + t * dy };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best ?? p;
}
