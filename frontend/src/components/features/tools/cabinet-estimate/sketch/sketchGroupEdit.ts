/**
 * Picking and moving several things on the cabinet plan at once: what a
 * drag-box takes in, the island's cabinets as one group, and turning a
 * mixed group (cabinets, free-standing appliances, walls) as one piece.
 * Pure functions, canvas pixels; a cabinet or appliance is placed by its
 * back-left corner (x, y) and turned about it by `rotation` degrees.
 */

import type { CabinetSketchAppliance, CabinetSketchCabinet, CabinetSketchWall } from '@/types/cabinetSketch';

type Pt = { x: number; y: number };
type Placed = { id: string; x: number; y: number; width: number; height: number; rotation: number };
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The four corners of a placed footprint, from its back-left corner round. */
export function footprintCorners(c: Placed): Pt[] {
  const r = (c.rotation * Math.PI) / 180;
  const ux = { x: Math.cos(r), y: Math.sin(r) };
  const uy = { x: -Math.sin(r), y: Math.cos(r) };
  const at = (a: number, b: number) => ({ x: c.x + ux.x * a + uy.x * b, y: c.y + ux.y * a + uy.y * b });
  return [at(0, 0), at(c.width, 0), at(c.width, c.height), at(0, c.height)];
}

const normal = (b: Box): Box => ({
  x0: Math.min(b.x0, b.x1),
  y0: Math.min(b.y0, b.y1),
  x1: Math.max(b.x0, b.x1),
  y1: Math.max(b.y0, b.y1),
});

/** Whether a convex polygon and an upright box overlap at all (separating axes). */
export function boxMeetsPolygon(box: Box, poly: Pt[]): boolean {
  const b = normal(box);
  const rect = [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ];
  const axes: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    axes.push({ x: -(q.y - p.y), y: q.x - p.x });
  });
  return axes.every((a) => {
    const proj = (pts: Pt[]) => pts.map((p) => p.x * a.x + p.y * a.y);
    const [r, s] = [proj(rect), proj(poly)];
    return Math.max(...r) >= Math.min(...s) && Math.max(...s) >= Math.min(...r);
  });
}

/** Whether a wall's line (a to b) crosses or lies in an upright box. */
export function boxMeetsSegment(box: Box, a: Pt, b: Pt): boolean {
  return boxMeetsPolygon(box, [a, b]);
}

/** The island's cabinets: they move and turn as one piece. */
export const islandIds = (cabinets: Pick<CabinetSketchCabinet, 'id' | 'location'>[]): string[] =>
  cabinets.filter((c) => c.location === 'island').map((c) => c.id);

/** `ids` with the whole island added when they take in any island cabinet. */
export function withIslandGroup(ids: string[], cabinets: Pick<CabinetSketchCabinet, 'id' | 'location'>[]): string[] {
  const island = islandIds(cabinets);
  if (!ids.some((id) => island.includes(id))) return ids;
  return [...ids, ...island.filter((id) => !ids.includes(id))];
}

/**
 * What a drag-box touches: cabinets, free-standing appliances (one in a
 * cabinet goes with the cabinet) and walls, each by id. A box touching any
 * island cabinet takes the whole island.
 */
export function pickInBox(
  box: Box,
  cabinets: CabinetSketchCabinet[],
  appliances: CabinetSketchAppliance[],
  walls: CabinetSketchWall[]
): { cabinets: string[]; appliances: string[]; walls: string[] } {
  const cabs = cabinets.filter((c) => boxMeetsPolygon(box, footprintCorners(c))).map((c) => c.id);
  return {
    cabinets: withIslandGroup(cabs, cabinets),
    appliances: appliances.filter((a) => !a.host_id && boxMeetsPolygon(box, footprintCorners(a))).map((a) => a.id),
    walls: walls
      .filter((w) => boxMeetsSegment(box, { x: w.start_x, y: w.start_y }, { x: w.end_x, y: w.end_y }))
      .map((w) => w.id),
  };
}

const turnAbout = (p: Pt, pivot: Pt, cos: number, sin: number): Pt => {
  const v = { x: p.x - pivot.x, y: p.y - pivot.y };
  return { x: pivot.x + cos * v.x - sin * v.y, y: pivot.y + sin * v.x + cos * v.y };
};

/** Rounded to a hundredth of a degree, so 15° steps stay exact. */
const tidyAngle = (deg: number) => Math.round(((((deg % 360) + 360) % 360) * 100)) / 100;

/**
 * A group turned `degrees` as one piece, about the middle of its extent:
 * each footprint's new back-left corner and rotation, and each wall's new
 * ends.
 */
export function turnGroup(
  placed: Placed[],
  walls: CabinetSketchWall[],
  degrees: number
): { placed: { id: string; x: number; y: number; rotation: number }[]; walls: CabinetSketchWall[] } {
  const pts = [
    ...placed.flatMap(footprintCorners),
    ...walls.flatMap((w) => [
      { x: w.start_x, y: w.start_y },
      { x: w.end_x, y: w.end_y },
    ]),
  ];
  if (pts.length === 0 || degrees === 0) return { placed: [], walls: [] };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pivot = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const r = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  return {
    placed: placed.map((c) => {
      const p = turnAbout(c, pivot, cos, sin);
      return { id: c.id, x: p.x, y: p.y, rotation: tidyAngle(c.rotation + degrees) };
    }),
    walls: walls.map((w) => {
      const s = turnAbout({ x: w.start_x, y: w.start_y }, pivot, cos, sin);
      const e = turnAbout({ x: w.end_x, y: w.end_y }, pivot, cos, sin);
      return { ...w, start_x: s.x, start_y: s.y, end_x: e.x, end_y: e.y };
    }),
  };
}
