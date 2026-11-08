/**
 * beWallLoop - Detect closed wall loops and convert to rooms
 *
 * When walls form a closed polygon (endpoints connect),
 * extract the boundary vertices to create a Room.
 */

import type { BEWall, BEPoint } from '@/types/bathroomSketch';

const SNAP_DIST = 8; // px tolerance for endpoint matching

function ptEq(a: BEPoint, b: BEPoint): boolean {
  return Math.abs(a.x - b.x) < SNAP_DIST && Math.abs(a.y - b.y) < SNAP_DIST;
}

interface WallEdge {
  wallId: string;
  start: BEPoint;
  end: BEPoint;
}

/**
 * Find a closed loop of walls.
 * Returns the ordered boundary vertices and wall IDs if found, or null.
 */
export function findClosedWallLoop(walls: BEWall[]): {
  boundary: BEPoint[];
  wallIds: string[];
} | null {
  if (walls.length < 3) return null;

  const edges: WallEdge[] = walls.map((w) => ({
    wallId: w.id,
    start: w.start,
    end: w.end,
  }));

  // Try starting from each wall
  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    const result = traceLoop(edges, startIdx);
    if (result) return result;
  }

  return null;
}

function traceLoop(
  edges: WallEdge[],
  startIdx: number,
): { boundary: BEPoint[]; wallIds: string[] } | null {
  const used = new Set<number>();
  const boundary: BEPoint[] = [];
  const wallIds: string[] = [];

  let currentPt = edges[startIdx].start;
  const originPt = currentPt;
  boundary.push(currentPt);

  let currentIdx = startIdx;
  used.add(currentIdx);
  wallIds.push(edges[currentIdx].wallId);

  // Walk to the end of this wall
  currentPt = edges[currentIdx].end;
  boundary.push(currentPt);

  // Try to chain walls until we return to origin
  for (let iter = 0; iter < edges.length; iter++) {
    // Check if we've closed the loop
    if (boundary.length >= 4 && ptEq(currentPt, originPt)) {
      // Remove the duplicate closing point
      boundary.pop();
      return { boundary, wallIds };
    }

    // Find next connecting wall
    let found = false;
    for (let i = 0; i < edges.length; i++) {
      if (used.has(i)) continue;
      const e = edges[i];

      if (ptEq(currentPt, e.start)) {
        used.add(i);
        wallIds.push(e.wallId);
        currentPt = e.end;
        boundary.push(currentPt);
        found = true;
        break;
      }
      if (ptEq(currentPt, e.end)) {
        used.add(i);
        wallIds.push(e.wallId);
        currentPt = e.start;
        boundary.push(currentPt);
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  // Final check: did we close?
  if (boundary.length >= 4 && ptEq(currentPt, originPt)) {
    boundary.pop();
    return { boundary, wallIds };
  }

  return null;
}

/**
 * Find ALL closed loops in a set of walls.
 * Returns array of loops found (may be 0).
 */
export function findAllClosedLoops(walls: BEWall[]): {
  boundary: BEPoint[];
  wallIds: string[];
}[] {
  const results: { boundary: BEPoint[]; wallIds: string[] }[] = [];
  const usedWallIds = new Set<string>();

  // Keep finding loops until no more are found
  const remainingWalls = [...walls];

  for (let attempt = 0; attempt < 10; attempt++) {
    const available = remainingWalls.filter((w) => !usedWallIds.has(w.id));
    if (available.length < 3) break;

    const loop = findClosedWallLoop(available);
    if (!loop) break;

    results.push(loop);
    loop.wallIds.forEach((id) => usedWallIds.add(id));
  }

  return results;
}
