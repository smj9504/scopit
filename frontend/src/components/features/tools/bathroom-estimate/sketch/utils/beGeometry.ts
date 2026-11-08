/**
 * beGeometry - Shared pure polygon geometry helpers
 *
 * Used to keep wall-mounted overlays (e.g. a shower bench) inside the
 * actual shape they're mounted in — a neo-angle shower's footprint is a
 * pentagon (one diagonal-cut corner), so a plain rectangle can overshoot
 * past the glass unless it's clipped against the real footprint.
 */

import type { BEFixtureProperties, ShowerDoorPosition } from '@/types/bathroomSketch';

export interface Pt2 {
  x: number;
  y: number;
}

/** true if p is on the inside of the directed edge a→b, for a clockwise-on-screen polygon */
function isInsideEdge(p: Pt2, a: Pt2, b: Pt2): boolean {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
}

function edgeIntersection(p1: Pt2, p2: Pt2, a: Pt2, b: Pt2): Pt2 {
  const A1 = p2.y - p1.y, B1 = p1.x - p2.x, C1 = A1 * p1.x + B1 * p1.y;
  const A2 = b.y - a.y, B2 = a.x - b.x, C2 = A2 * a.x + B2 * a.y;
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-9) return p2; // parallel edges — degenerate, keep p2
  return {
    x: (B2 * C1 - B1 * C2) / det,
    y: (A1 * C2 - A2 * C1) / det,
  };
}

/**
 * Clip a subject polygon against a convex clip polygon (Sutherland-Hodgman).
 * Both polygons must be wound clockwise-on-screen (the convention used
 * throughout this sketch: y grows downward, vertices listed top→right→
 * bottom→left).
 */
export function clipPolygon(subject: Pt2[], clip: Pt2[]): Pt2[] {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      const curIn = isInsideEdge(cur, a, b);
      const prevIn = isInsideEdge(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(edgeIntersection(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(edgeIntersection(prev, cur, a, b));
      }
    }
  }
  return output;
}

type ShowerLayout = 'alcove' | 'corner' | 'corner_right' | 'neo_angle' | 'neo_angle_right' | undefined;

/**
 * The shower's own footprint polygon, normalized to (0,0)-(1,1) — a unit
 * square for alcove/corner layouts, but a pentagon with one diagonal-cut
 * corner for neo-angle layouts. Mirrors the vertex layout documented in
 * buildNeoAngleShowerShape (beFixtureShapes.ts). Callers map these into
 * whatever coordinate frame they need (local pixel-center-origin, absolute
 * canvas coords, etc).
 */
export function getShowerUnitPolygon(layout: ShowerLayout): Pt2[] {
  if (layout === 'neo_angle') {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
  }
  if (layout === 'neo_angle_right') {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
  }
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

/**
 * Where a shower's door sits across its front: a glass door in an alcove or
 * corner shower where it's set; an open front, a curtain or a neo-angle
 * door (on its diagonal) in the middle.
 */
export function showerDoorPosition(
  p: Pick<BEFixtureProperties, 'showerDoorType' | 'showerDoorPosition' | 'showerLayout'>,
): ShowerDoorPosition {
  const glassDoor = !!p.showerDoorType && p.showerDoorType !== 'none' && p.showerDoorType !== 'curtain';
  const neo = p.showerLayout === 'neo_angle' || p.showerLayout === 'neo_angle_right';
  return glassDoor && !neo ? p.showerDoorPosition ?? 'center' : 'center';
}

/**
 * The door's stretch of an alcove or corner shower's front, as [start, end]
 * fractions of the width from the left: centred, or against one side.
 */
export function showerDoorSpan(position: ShowerDoorPosition, doorRatio: number): [number, number] {
  const w = Math.min(Math.max(doorRatio, 0.2), 1);
  const start = position === 'left' ? 0 : position === 'right' ? 1 - w : (1 - w) / 2;
  return [start, start + w];
}

/**
 * The fixed glass panels across a shower's front, as [start, end] fractions
 * of the width: each fills its side up to the door, so there's none on a
 * side the door is against.
 */
export function showerFrontPanels(
  panelConfig: 'none' | 'left' | 'right' | 'both' | undefined,
  [doorStart, doorEnd]: [number, number],
): [number, number][] {
  const panels: [number, number][] = [];
  if ((panelConfig === 'left' || panelConfig === 'both') && doorStart > 0.02) panels.push([0, doorStart]);
  if ((panelConfig === 'right' || panelConfig === 'both') && doorEnd < 0.98) panels.push([doorEnd, 1]);
  return panels;
}

/**
 * A room's outline with one edge set to a new length. The edge's end moves
 * along it (snapped level or upright when it nearly is); in a four-cornered
 * room, the corners lined up with that end move with it, so a rectangle stays
 * a rectangle. Null when the edge has no length to go by.
 */
export function resizeRoomEdge(boundary: Pt2[], edgeIdx: number, newLengthPx: number): Pt2[] | null {
  const nIdx = (edgeIdx + 1) % boundary.length;
  const pt = boundary[edgeIdx];
  const npt = boundary[nIdx];

  let dx = npt.x - pt.x;
  let dy = npt.y - pt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  // Force horizontal/vertical if close
  const isH = Math.abs(dy) < Math.abs(dx) * 0.2;
  const isV = Math.abs(dx) < Math.abs(dy) * 0.2;
  if (isH) { dy = 0; dx = dx > 0 ? len : -len; }
  else if (isV) { dx = 0; dy = dy > 0 ? len : -len; }
  const dirLen = Math.sqrt(dx * dx + dy * dy);

  const newNpt: Pt2 = {
    x: Math.round(pt.x + (dx / dirLen) * newLengthPx),
    y: Math.round(pt.y + (dy / dirLen) * newLengthPx),
  };

  const b = [...boundary];
  b[nIdx] = newNpt;
  // Rectangular rooms: the corners that shared X or Y with the old end follow it
  if (boundary.length === 4) {
    for (let i = 0; i < 4; i++) {
      if (i === nIdx) continue;
      if (Math.abs(boundary[i].x - npt.x) < 2) b[i] = { x: newNpt.x, y: b[i].y };
      if (Math.abs(boundary[i].y - npt.y) < 2) b[i] = { x: b[i].x, y: newNpt.y };
    }
  }
  return b;
}
