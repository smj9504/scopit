/**
 * beFixtureShapes - Plan-view fixture shapes (blueprint style)
 *
 * Minimal monochrome line drawings. Each shape normalized to (0,0)→(1,1).
 * Stroke color: #444 (dark gray), Fill: #f8f8f8 (near-white) or none.
 */

import type { BEFixtureType, BathtubSubType, VanitySubType, ShowerDoorPosition, ShowerDoorType } from '@/types/bathroomSketch';
import { showerDoorSpan, showerFrontPanels } from './beGeometry';

const GLASS = '#d4eaf7'; // light blue for glass panels

export interface FixtureShape {
  paths: { d: string; fill: string; stroke: string; strokeWidth: number }[];
  label: string;
}

const S = '#444';     // stroke
const SL = '#999';    // stroke light
const F = 'none';     // fill — transparent (blueprint style)
const FL = 'none';    // fill light — transparent
const N = 'none';     // no fill

// ── Wall-aware deck rim helper ──

/**
 * Which fixture-local sides (before rotation) are flush against a room wall.
 * Mirrors the shape returned by findFixtureWallSides in beTileZoneGenerator —
 * kept as a separate local type so this file stays a pure shape/render utility
 * with no dependency on the tile-zone module.
 */
export interface WallSides {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

/**
 * Trace only the exposed (non-wall) edges of a box from (inset,inset) to
 * (1-inset,1-inset) as an SVG path, rounding a corner only where both
 * adjacent edges are exposed. A side flagged true in wallSides is omitted
 * entirely — a tub deck has no rim where it butts into a room wall, so no
 * line should be drawn there. wallSides=null means "no room context", i.e.
 * treat every side as exposed (matches prior unconditional behavior, used
 * e.g. for palette preview icons that aren't placed in a room).
 */
function buildExposedRimPath(wallSides: WallSides | null, inset: number, r: number): string {
  const north = !wallSides?.north;
  const east = !wallSides?.east;
  const south = !wallSides?.south;
  const west = !wallSides?.west;

  const lo = inset;
  const hi = 1 - inset;

  const roundTR = north && east;
  const roundBR = east && south;
  const roundBL = south && west;
  const roundTL = west && north;

  const nStart: [number, number] = roundTL ? [lo + r, lo] : [lo, lo];
  const nEnd: [number, number] = roundTR ? [hi - r, lo] : [hi, lo];
  const eStart: [number, number] = roundTR ? [hi, lo + r] : [hi, lo];
  const eEnd: [number, number] = roundBR ? [hi, hi - r] : [hi, hi];
  const sStart: [number, number] = roundBR ? [hi - r, hi] : [hi, hi];
  const sEnd: [number, number] = roundBL ? [lo + r, hi] : [lo, hi];
  const wStart: [number, number] = roundBL ? [lo, hi - r] : [lo, hi];
  const wEnd: [number, number] = roundTL ? [lo, lo + r] : [lo, lo];

  const pt = (p: [number, number]) => `${p[0]},${p[1]}`;
  const parts: string[] = [];
  let open = false;

  const drawEdge = (present: boolean, start: [number, number], end: [number, number]) => {
    if (!present) { open = false; return; }
    parts.push(open ? `L${pt(end)}` : `M${pt(start)} L${pt(end)}`);
    open = true;
  };
  const drawCorner = (rounded: boolean, cx: number, cy: number, end: [number, number], edgeAfterPresent: boolean) => {
    if (rounded) {
      parts.push(`Q${cx},${cy} ${pt(end)}`);
      open = true;
    } else if (!edgeAfterPresent) {
      open = false;
    }
  };

  drawEdge(north, nStart, nEnd);
  drawCorner(roundTR, hi, lo, eStart, east);
  drawEdge(east, eStart, eEnd);
  drawCorner(roundBR, hi, hi, sStart, south);
  drawEdge(south, sStart, sEnd);
  drawCorner(roundBL, lo, hi, wStart, west);
  drawEdge(west, wStart, wEnd);
  drawCorner(roundTL, lo, lo, nStart, north);

  if (north && east && south && west) parts.push('Z');

  return parts.join(' ');
}

// ── Bathtub ──

const bathtubAlcove: FixtureShape = {
  label: 'Bathtub',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.06,0.06 L0.94,0.06 L0.94,0.94 L0.06,0.94 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Faucet and drain: drawn where they're set (BESketchCanvas, utils/plumbingPoints)
  ],
};

function buildBathtubDropIn(wallSides: WallSides | null): FixtureShape {
  return {
    label: 'Drop-in',
    paths: [
      // Outer platform/deck rim — only on sides exposed to the room (no rim where deck meets a wall)
      { d: buildExposedRimPath(wallSides, 0, 0.08), fill: F, stroke: S, strokeWidth: 2 },
      // Inner deck edge — same exposure pattern
      { d: buildExposedRimPath(wallSides, 0.05, 0.08), fill: FL, stroke: SL, strokeWidth: 0.6 },
      // Tub basin (rounded rectangle)
      { d: 'M0.15,0.12 Q0.15,0.08 0.2,0.08 L0.8,0.08 Q0.85,0.08 0.85,0.12 L0.85,0.88 Q0.85,0.92 0.8,0.92 L0.2,0.92 Q0.15,0.92 0.15,0.88 Z', fill: FL, stroke: S, strokeWidth: 1.5 },
    ],
  };
}

const bathtubCorner: FixtureShape = {
  label: 'Corner Tub',
  paths: [
    // Outer platform rim — corner tubs sit against the top+left room walls by
    // definition, so no rim is drawn there; only the exposed right/bottom/
    // chamfer edges get a rounded rim.
    { d: 'M1,0 L1,0.54 Q1,0.6 0.958,0.642 L0.642,0.958 Q0.6,1 0.54,1 L0,1', fill: F, stroke: S, strokeWidth: 2 },
    // Inner platform edge (same exposed sides)
    { d: 'M0.96,0.04 L0.96,0.51 Q0.96,0.56 0.925,0.595 L0.595,0.925 Q0.56,0.96 0.51,0.96 L0.04,0.96', fill: FL, stroke: SL, strokeWidth: 0.6 },
    // Tub basin (curved pentagon - chamfered corner with rounded edges)
    { d: 'M0.1,0.1 Q0.5,0.08 0.85,0.1 Q0.87,0.35 0.85,0.48 L0.48,0.85 Q0.35,0.87 0.1,0.85 Q0.08,0.5 0.1,0.1 Z', fill: FL, stroke: S, strokeWidth: 1.5 },
    // Deck tile hatching - right side
    { d: 'M0.88,0.15 L0.96,0.15', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.88,0.3 L0.96,0.3', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.88,0.45 L0.96,0.45', fill: N, stroke: SL, strokeWidth: 0.3 },
    // Deck tile hatching - bottom side
    { d: 'M0.15,0.9 L0.15,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.3,0.9 L0.3,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.45,0.9 L0.45,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
  ],
};

// Corner drop-in: tub dropped into tile platform, corner walls top+left
// Tub basin has a 45° chamfered corner on the exposed side (bottom-right)
const bathtubCornerDropIn: FixtureShape = {
  label: 'Corner Drop-in',
  paths: [
    // Outer platform rim (bottom-right chamfer cut at 45°) — corner tubs sit
    // against the top+left room walls by definition, so no rim is drawn
    // there; only the exposed right/bottom/chamfer edges get a rounded rim.
    { d: 'M1,0 L1,0.54 Q1,0.6 0.958,0.642 L0.642,0.958 Q0.6,1 0.54,1 L0,1', fill: F, stroke: S, strokeWidth: 2 },
    // Inner platform edge (same exposed sides)
    { d: 'M0.96,0.04 L0.96,0.51 Q0.96,0.56 0.925,0.595 L0.595,0.925 Q0.56,0.96 0.51,0.96 L0.04,0.96', fill: FL, stroke: SL, strokeWidth: 0.6 },
    // Tub basin (pentagon - chamfered bottom-right corner)
    { d: 'M0.08,0.08 L0.88,0.08 L0.88,0.48 L0.48,0.88 L0.08,0.88 Z', fill: FL, stroke: S, strokeWidth: 1.5 },
    // Deck tile hatching - right side
    { d: 'M0.9,0.15 L0.96,0.15', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.9,0.3 L0.96,0.3', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.9,0.45 L0.96,0.45', fill: N, stroke: SL, strokeWidth: 0.3 },
    // Deck tile hatching - bottom side
    { d: 'M0.15,0.9 L0.15,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.3,0.9 L0.3,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.45,0.9 L0.45,0.96', fill: N, stroke: SL, strokeWidth: 0.3 },
    // Wall indicators (top and left - thicker lines)
    { d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 3 },
    { d: 'M0,0 L0,1', fill: N, stroke: S, strokeWidth: 3 },
  ],
};

const bathtubFreestanding: FixtureShape = {
  label: 'Freestanding',
  paths: [
    { d: 'M0.1,0.5 Q0.1,0.05 0.5,0.05 Q0.9,0.05 0.9,0.5 Q0.9,0.95 0.5,0.95 Q0.1,0.95 0.1,0.5 Z', fill: F, stroke: S, strokeWidth: 2 },
    { d: 'M0.18,0.5 Q0.18,0.12 0.5,0.12 Q0.82,0.12 0.82,0.5 Q0.82,0.88 0.5,0.88 Q0.18,0.88 0.18,0.5 Z', fill: FL, stroke: S, strokeWidth: 1 },
  ],
};

// ── Shower ──
// Dynamic shower shape builder: walls + glass panels + door

type PathEntry = { d: string; fill: string; stroke: string; strokeWidth: number };

function buildShowerShape(
  layout: 'alcove' | 'corner' | 'corner_right' | 'neo_angle' | 'neo_angle_right',
  doorType: ShowerDoorType,
  panelConfig: 'none' | 'left' | 'right' | 'both',
  doorRatio: number, // 0-1, door width as fraction of shower width
  doorPosition: ShowerDoorPosition,
): FixtureShape {
  // Neo-angle layouts use a dedicated builder
  if (layout === 'neo_angle' || layout === 'neo_angle_right') {
    return buildNeoAngleShowerShape(layout, doorType);
  }

  const paths: PathEntry[] = [];
  const [doorStart, doorEnd] = showerDoorSpan(doorPosition, doorRatio);
  const panels = showerFrontPanels(panelConfig, [doorStart, doorEnd]);
  const hasLeft = panels.some(([s]) => s === 0);
  const hasRight = panels.some(([, e]) => e === 1);

  // ── Interior (tile grid, showerhead, wall-mounted faucet/valve) ──
  paths.push(
    { d: 'M0.33,0.05 L0.33,0.95', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.66,0.05 L0.66,0.95', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.05,0.33 L0.95,0.33', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.05,0.66 L0.95,0.66', fill: N, stroke: SL, strokeWidth: 0.3 },
    // The head, valve and drain are drawn where they're set (BESketchCanvas, utils/plumbingPoints)
  );

  // ── Walls ──
  paths.push({ d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 3 }); // back wall

  if (layout === 'alcove') {
    paths.push({ d: 'M0,0 L0,1', fill: N, stroke: S, strokeWidth: 3 });
    paths.push({ d: 'M1,0 L1,1', fill: N, stroke: S, strokeWidth: 3 });
  } else if (layout === 'corner') {
    paths.push({ d: 'M0,0 L0,1', fill: N, stroke: S, strokeWidth: 3 });
    paths.push({ d: 'M1,0 L1,1', fill: N, stroke: '#2196f3', strokeWidth: 2 });
    paths.push({ d: 'M0.97,0.2 L0.97,0.8', fill: N, stroke: '#90caf9', strokeWidth: 0.5 });
  } else {
    paths.push({ d: 'M1,0 L1,1', fill: N, stroke: S, strokeWidth: 3 });
    paths.push({ d: 'M0,0 L0,1', fill: N, stroke: '#2196f3', strokeWidth: 2 });
    paths.push({ d: 'M0.03,0.2 L0.03,0.8', fill: N, stroke: '#90caf9', strokeWidth: 0.5 });
  }

  // ── Front side: [left panel?] + door + [right panel?] ──
  // Door centered or against one side; panels fill from their side to the door
  if (hasLeft) {
    paths.push(
      { d: `M0,0.94 L${doorStart},0.94 L${doorStart},1 L0,1 Z`, fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
      { d: `M${doorStart},0.92 L${doorStart},1`, fill: N, stroke: S, strokeWidth: 2 },
    );
  }
  if (hasRight) {
    paths.push(
      { d: `M${doorEnd},0.94 L1,0.94 L1,1 L${doorEnd},1 Z`, fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
      { d: `M${doorEnd},0.92 L${doorEnd},1`, fill: N, stroke: S, strokeWidth: 2 },
    );
  }

  // Door
  if (doorType === 'none' || doorType === 'curtain') {
    const lineStart = hasLeft ? doorStart : 0;
    const lineEnd = hasRight ? doorEnd : 1;
    paths.push({ d: `M${lineStart},1 L${lineEnd},1`, fill: N, stroke: SL, strokeWidth: 1 });
    if (doorType === 'curtain') {
      const cx = (doorStart + doorEnd) / 2;
      paths.push({ d: `M${doorStart + 0.02},0.97 Q${cx - 0.08},0.94 ${cx},0.97 Q${cx + 0.08},1 ${doorEnd - 0.02},0.97`, fill: N, stroke: SL, strokeWidth: 0.6 });
    }
  } else if (doorType === 'sliding') {
    const left = doorStart;
    const right = doorEnd;
    const mid = (left + right) / 2;
    paths.push(
      { d: `M${left},0.94 L${mid + 0.02},0.94 L${mid + 0.02},1 L${left},1 Z`, fill: GLASS, stroke: S, strokeWidth: 1.2 },
      { d: `M${mid - 0.02},0.94 L${right},0.94 L${right},1 L${mid - 0.02},1 Z`, fill: GLASS, stroke: S, strokeWidth: 1.2 },
      { d: `M${mid + 0.05},0.97 L${Math.min(mid + 0.2, right - 0.03)},0.97`, fill: N, stroke: S, strokeWidth: 0.6 },
      { d: `M${Math.min(mid + 0.17, right - 0.06)},0.95 L${Math.min(mid + 0.2, right - 0.03)},0.97 L${Math.min(mid + 0.17, right - 0.06)},0.99`, fill: N, stroke: S, strokeWidth: 0.6 },
    );
  } else if (doorType === 'swing' || doorType === 'frameless_swing') {
    const isFrameless = doorType === 'frameless_swing';
    const sw = isFrameless ? 2 : 1.5;
    paths.push({ d: `M${doorStart},0.93 L${doorEnd},0.93 L${doorEnd},1 L${doorStart},1 Z`, fill: GLASS, stroke: S, strokeWidth: sw });
    paths.push({ d: `M${doorStart},0.92 L${doorStart},1`, fill: N, stroke: S, strokeWidth: isFrameless ? 1.5 : 2 });
    // Swing arc from the free edge, about the hinge: on the right for a door against the right side
    const radius = doorEnd - doorStart;
    paths.push(doorPosition === 'right'
      ? { d: `M${doorStart},0.97 A${radius},${radius} 0 0,1 ${doorEnd},${0.97 - radius}`, fill: N, stroke: SL, strokeWidth: 0.6 }
      : { d: `M${doorEnd},0.97 A${radius},${radius} 0 0,0 ${doorStart},${0.97 - radius}`, fill: N, stroke: SL, strokeWidth: 0.6 });
    if (!hasLeft && doorStart > 0) paths.push({ d: `M0,1 L${doorStart},1`, fill: N, stroke: S, strokeWidth: 3 });
    if (!hasRight && doorEnd < 1) paths.push({ d: `M${doorEnd},1 L1,1`, fill: N, stroke: S, strokeWidth: 3 });
    paths.push({ d: `M${doorEnd},0.92 L${doorEnd},1`, fill: N, stroke: S, strokeWidth: 2 });
  } else if (doorType === 'bi_fold') {
    const mid = (doorStart + doorEnd) / 2;
    paths.push(
      { d: `M${doorStart},0.94 L${mid},0.94 L${mid},1 L${doorStart},1 Z`, fill: GLASS, stroke: S, strokeWidth: 1.2 },
      { d: `M${mid},0.94 L${doorEnd},0.94 L${doorEnd},1 L${mid},1 Z`, fill: GLASS, stroke: S, strokeWidth: 1.2 },
      { d: `M${mid},0.93 L${mid},1`, fill: N, stroke: S, strokeWidth: 1.2 },
      { d: `M${doorStart},0.92 L${doorStart},1`, fill: N, stroke: S, strokeWidth: 2 },
      { d: `M${doorEnd},0.92 L${doorEnd},1`, fill: N, stroke: S, strokeWidth: 2 },
    );
    if (!hasLeft && doorStart > 0) paths.push({ d: `M0,1 L${doorStart},1`, fill: N, stroke: S, strokeWidth: 3 });
    if (!hasRight && doorEnd < 1) paths.push({ d: `M${doorEnd},1 L1,1`, fill: N, stroke: S, strokeWidth: 3 });
  }

  return { label: 'Shower', paths };
}

/**
 * Neo-angle (corner) shower shape builder.
 * Pentagonal footprint: 2 walls (back + one side) + 3 glass panels (2 angled + 1 door).
 *
 * Plan view (neo_angle, walls on top + left):
 *   (0,0)───────(1,0)
 *     │              \
 *     │   valve  ⊕    \  ← angled glass panel
 *     │                 (1,0.5) ← corner point
 *     │                /
 *     │              /  ← angled glass panel (with door)
 *   (0,1)───(0.5,1)
 *
 * The diagonal front spans from (1,0.5) down to (0.5,1) — the door is on this segment.
 * Two side glass panels: right wall (1,0)→(1,0.5) and bottom (0.5,1)→(0,1) are replaced
 * by the angled front.
 */
function buildNeoAngleShowerShape(
  layout: 'neo_angle' | 'neo_angle_right',
  doorType: ShowerDoorType,
): FixtureShape {
  const paths: PathEntry[] = [];
  const isRight = layout === 'neo_angle_right';

  // Neo-angle pentagon vertices (normalized 0-1):
  // neo_angle (walls: top + left):      (0,0), (1,0), (1,0.5), (0.5,1), (0,1)
  // neo_angle_right (walls: top + right): (0,0), (1,0), (1,1), (0.5,1), (0,0.5)
  // But to keep it symmetric we use a cleaner geometry:
  // The "cut corner" is at bottom-right for neo_angle, bottom-left for neo_angle_right.

  // ── Interior details ── (the head, valve and drain are drawn where they're set)
  paths.push(
    // Tile grid lines (adapted for pentagon)
    { d: 'M0.33,0.05 L0.33,0.85', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.66,0.05 L0.66,0.85', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.05,0.33 L0.95,0.33', fill: N, stroke: SL, strokeWidth: 0.3 },
    { d: 'M0.05,0.66 L0.85,0.66', fill: N, stroke: SL, strokeWidth: 0.3 },
  );

  if (!isRight) {
    // neo_angle: walls = top + left, glass = right angled + door + bottom angled
    // Pentagon: (0,0)→(1,0)→(1,0.5)→(0.5,1)→(0,1)

    // Walls (thick solid)
    paths.push({ d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 3 });   // back (top)
    paths.push({ d: 'M0,0 L0,1', fill: N, stroke: S, strokeWidth: 3 });   // left side

    // Glass panel: right side (1,0) → (1,0.5)
    paths.push(
      { d: 'M0.97,0.02 L0.97,0.48 L1,0.5 L1,0 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
    );

    // Glass panel: bottom side (0,1) → (0.5,1)
    paths.push(
      { d: 'M0.02,0.97 L0.48,0.97 L0.5,1 L0,1 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
    );

    // Door diagonal: (1,0.5) → (0.5,1)
    // Draw frame posts at both ends
    paths.push({ d: 'M1,0.5 L1,0.46', fill: N, stroke: S, strokeWidth: 2 });
    paths.push({ d: 'M0.5,1 L0.46,1', fill: N, stroke: S, strokeWidth: 2 });

    if (doorType === 'none' || doorType === 'curtain') {
      paths.push({ d: 'M1,0.5 L0.5,1', fill: N, stroke: SL, strokeWidth: 1 });
    } else {
      // Neo-angle pivot door (glass panel along the diagonal)
      paths.push({ d: 'M0.98,0.52 L0.52,0.98', fill: N, stroke: '#2196f3', strokeWidth: 2 });
      // Door glass fill (thin parallelogram along diagonal)
      paths.push({ d: 'M0.99,0.51 L0.97,0.53 L0.51,0.99 L0.53,0.97 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1 });
      // Swing arc (outward)
      const arcR = 0.35;
      paths.push({ d: `M${0.5 + arcR * 0.707},${1 - arcR * 0.707} A${arcR},${arcR} 0 0,1 0.5,${1 - arcR}`, fill: N, stroke: SL, strokeWidth: 0.6 });
      // Hinge dot at (1, 0.5)
      paths.push({ d: 'M1,0.5 m-0.03,0 a0.03,0.03 0 1,0 0.06,0 a0.03,0.03 0 1,0 -0.06,0', fill: S, stroke: S, strokeWidth: 0.5 });
    }
  } else {
    // neo_angle_right: walls = top + right, glass = left angled + door + bottom angled
    // Pentagon: (0,0)→(1,0)→(1,1)→(0.5,1)→(0,0.5)

    // Walls (thick solid)
    paths.push({ d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 3 });   // back (top)
    paths.push({ d: 'M1,0 L1,1', fill: N, stroke: S, strokeWidth: 3 });   // right side

    // Glass panel: left side (0,0) → (0,0.5)
    paths.push(
      { d: 'M0,0 L0,0.5 L0.03,0.48 L0.03,0.02 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
    );

    // Glass panel: bottom side (0.5,1) → (1,1)
    paths.push(
      { d: 'M0.52,0.97 L0.98,0.97 L1,1 L0.5,1 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1.5 },
    );

    // Door diagonal: (0,0.5) → (0.5,1)
    paths.push({ d: 'M0,0.5 L0,0.46', fill: N, stroke: S, strokeWidth: 2 });
    paths.push({ d: 'M0.5,1 L0.54,1', fill: N, stroke: S, strokeWidth: 2 });

    if (doorType === 'none' || doorType === 'curtain') {
      paths.push({ d: 'M0,0.5 L0.5,1', fill: N, stroke: SL, strokeWidth: 1 });
    } else {
      paths.push({ d: 'M0.02,0.52 L0.48,0.98', fill: N, stroke: '#2196f3', strokeWidth: 2 });
      paths.push({ d: 'M0.01,0.51 L0.03,0.53 L0.49,0.99 L0.47,0.97 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 1 });
      const arcR = 0.35;
      paths.push({ d: `M${0.5 - arcR * 0.707},${1 - arcR * 0.707} A${arcR},${arcR} 0 0,0 0.5,${1 - arcR}`, fill: N, stroke: SL, strokeWidth: 0.6 });
      paths.push({ d: 'M0,0.5 m-0.03,0 a0.03,0.03 0 1,0 0.06,0 a0.03,0.03 0 1,0 -0.06,0', fill: S, stroke: S, strokeWidth: 0.5 });
    }
  }

  return { label: 'Neo-Angle', paths };
}

// ── Vanity ──

const vanitySingle: FixtureShape = {
  label: 'Vanity',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Countertop edge
    { d: 'M0,0.12 L1,0.12', fill: N, stroke: S, strokeWidth: 0.8 },
    // Sink basin (oval)
    { d: 'M0.3,0.18 Q0.3,0.14 0.5,0.14 Q0.7,0.14 0.7,0.18 L0.7,0.52 Q0.7,0.58 0.5,0.58 Q0.3,0.58 0.3,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Faucet
    { d: 'M0.47,0.04 L0.53,0.04 L0.53,0.1 L0.47,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Cabinet handles
    { d: 'M0.36,0.78 L0.44,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.56,0.78 L0.64,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
  ],
};

const vanityDouble: FixtureShape = {
  label: 'Dbl Vanity',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Countertop edge
    { d: 'M0,0.12 L1,0.12', fill: N, stroke: S, strokeWidth: 0.8 },
    // Left sink
    { d: 'M0.08,0.18 Q0.08,0.14 0.25,0.14 Q0.42,0.14 0.42,0.18 L0.42,0.52 Q0.42,0.58 0.25,0.58 Q0.08,0.58 0.08,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Right sink
    { d: 'M0.58,0.18 Q0.58,0.14 0.75,0.14 Q0.92,0.14 0.92,0.18 L0.92,0.52 Q0.92,0.58 0.75,0.58 Q0.58,0.58 0.58,0.52 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Left faucet
    { d: 'M0.22,0.04 L0.28,0.04 L0.28,0.1 L0.22,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Right faucet
    { d: 'M0.72,0.04 L0.78,0.04 L0.78,0.1 L0.72,0.1 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Center divider
    { d: 'M0.5,0.65 L0.5,0.95', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Cabinet handles
    { d: 'M0.18,0.78 L0.26,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.36,0.78 L0.44,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.56,0.78 L0.64,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
    { d: 'M0.74,0.78 L0.82,0.78', fill: N, stroke: S, strokeWidth: 1.2 },
  ],
};

// ── Pedestal Sink (plan view: semicircular basin on narrow column) ──
// Standard: ~20"W x 17"D. Round basin at front, thin pedestal column below.

const pedestalSink: FixtureShape = {
  label: 'Pedestal',
  paths: [
    // Basin (semicircular, wider side toward wall/top)
    { d: 'M0.1,0.08 L0.9,0.08 Q0.95,0.08 0.95,0.2 L0.95,0.45 Q0.95,0.75 0.5,0.75 Q0.05,0.75 0.05,0.45 L0.05,0.2 Q0.05,0.08 0.1,0.08 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Inner basin rim
    { d: 'M0.2,0.14 L0.8,0.14 Q0.85,0.14 0.85,0.24 L0.85,0.42 Q0.85,0.66 0.5,0.66 Q0.15,0.66 0.15,0.42 L0.15,0.24 Q0.15,0.14 0.2,0.14 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Pedestal column (narrow rectangle centered below basin)
    { d: 'M0.35,0.65 L0.65,0.65 L0.65,0.98 L0.35,0.98 Z', fill: F, stroke: S, strokeWidth: 1.5 },
    // Pedestal base (slightly wider)
    { d: 'M0.3,0.92 L0.7,0.92 L0.7,1 L0.3,1 Z', fill: F, stroke: S, strokeWidth: 1 },
    // Faucet
    { d: 'M0.47,0.03 L0.53,0.03 L0.53,0.08 L0.47,0.08 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Drain
    { d: 'M0.5,0.45 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Wall-Mount Sink (plan view: semicircular basin, no pedestal, mounted to wall) ──

const wallMountSink: FixtureShape = {
  label: 'Wall Sink',
  paths: [
    // Basin (semicircular, flat back against wall/top)
    { d: 'M0.08,0.05 L0.92,0.05 Q0.98,0.05 0.98,0.2 L0.98,0.5 Q0.98,0.85 0.5,0.85 Q0.02,0.85 0.02,0.5 L0.02,0.2 Q0.02,0.05 0.08,0.05 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Inner basin rim
    { d: 'M0.18,0.12 L0.82,0.12 Q0.88,0.12 0.88,0.25 L0.88,0.46 Q0.88,0.75 0.5,0.75 Q0.12,0.75 0.12,0.46 L0.12,0.25 Q0.12,0.12 0.18,0.12 Z', fill: FL, stroke: S, strokeWidth: 1 },
    // Wall-mount bracket indicators (small lines at back)
    { d: 'M0.25,0.02 L0.25,0.08', fill: N, stroke: S, strokeWidth: 1.5 },
    { d: 'M0.75,0.02 L0.75,0.08', fill: N, stroke: S, strokeWidth: 1.5 },
    // Faucet
    { d: 'M0.47,0.03 L0.53,0.03 L0.53,0.08 L0.47,0.08 Z', fill: SL, stroke: S, strokeWidth: 0.5 },
    // Drain
    { d: 'M0.5,0.48 m-0.035,0 a0.035,0.035 0 1,0 0.07,0 a0.035,0.035 0 1,0 -0.07,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Toilet (plan view: rectangular tank + elongated oval bowl) ──
// Standard: 15"W x 29"D elongated. Tank at back (top), bowl tapers to front (bottom).
// Reference: ANSI/AIA architectural symbol standard

const toilet: FixtureShape = {
  label: 'Toilet',
  paths: [
    // Tank (rectangular, flat back against wall) — top 28% of fixture
    { d: 'M0.1,0.02 L0.9,0.02 Q0.95,0.02 0.95,0.06 L0.95,0.26 Q0.95,0.3 0.9,0.3 L0.1,0.3 Q0.05,0.3 0.05,0.26 L0.05,0.06 Q0.05,0.02 0.1,0.02 Z', fill: F, stroke: S, strokeWidth: 1.5 },
    // Bowl outer (elongated oval, wider at tank connection, tapers to front)
    { d: 'M0.08,0.3 L0.92,0.3 Q0.98,0.3 0.98,0.42 L0.98,0.68 Q0.98,0.98 0.5,0.98 Q0.02,0.98 0.02,0.68 L0.02,0.42 Q0.02,0.3 0.08,0.3 Z', fill: F, stroke: S, strokeWidth: 2 },
    // Seat opening (inner oval, slightly inset from bowl)
    { d: 'M0.18,0.34 L0.82,0.34 Q0.88,0.34 0.88,0.44 L0.88,0.64 Q0.88,0.92 0.5,0.92 Q0.12,0.92 0.12,0.64 L0.12,0.44 Q0.12,0.34 0.18,0.34 Z', fill: F, stroke: SL, strokeWidth: 0.8 },
    // Tank-bowl connection line
    { d: 'M0.1,0.3 L0.9,0.3', fill: N, stroke: S, strokeWidth: 0.5 },
    // Flush handle (small line on right side of tank)
    { d: 'M0.88,0.14 L1.0,0.14', fill: N, stroke: S, strokeWidth: 1 },
  ],
};

// ── Door (plan view: horizontal panel line + 90° swing arc) ──
// Standard architectural floor-plan symbol: horizontal line from hinge to door edge,
// plus a quarter-circle arc showing the swing direction.
// Oriented: hinge at bottom-left (0,1), panel along bottom edge to (1,1),
// arc sweeps clockwise from door edge (1,1) up to open position (0,0).

const door: FixtureShape = {
  label: 'Door',
  paths: [
    // Door panel (horizontal line from hinge to door edge)
    // Hinge at (0,1), panel extends right to (1,1)
    { d: 'M0,1 L1,1', fill: N, stroke: S, strokeWidth: 2.5 },
    // 90° swing arc from door-edge (1,1) to open position (0,0)
    // Quarter circle: center at hinge (0,1), radius = 1 (normalized)
    { d: 'M1,1 A1,1 0 0,0 0,0', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Wall line (hinge to open position)
    { d: 'M0,1 L0,0', fill: N, stroke: S, strokeWidth: 1.5 },
    // Hinge dot
    { d: 'M0,1 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: S, stroke: S, strokeWidth: 0.5 },
  ],
};

// ── Window (plan view: wall opening) ──

const windowShape: FixtureShape = {
  label: 'Window',
  paths: [
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#f0f8ff', stroke: S, strokeWidth: 1.5 },
    // Double glass lines
    { d: 'M0.05,0.35 L0.95,0.35', fill: N, stroke: S, strokeWidth: 1 },
    { d: 'M0.05,0.65 L0.95,0.65', fill: N, stroke: S, strokeWidth: 1 },
    // Frame ends
    { d: 'M0.04,0.2 L0.04,0.8', fill: N, stroke: S, strokeWidth: 1.5 },
    { d: 'M0.96,0.2 L0.96,0.8', fill: N, stroke: S, strokeWidth: 1.5 },
  ],
};

// ── Mirror (plan view: thin strip on wall, reflective surface) ──

const mirror: FixtureShape = {
  label: 'Mirror',
  paths: [
    // Frame
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: N, stroke: S, strokeWidth: 1.5 },
    // Reflective surface (diagonal hatching)
    { d: 'M0.15,0 L0,0.6', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.4,0 L0.05,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.65,0 L0.3,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M0.9,0 L0.55,1', fill: N, stroke: SL, strokeWidth: 0.4 },
    { d: 'M1,0.2 L0.8,1', fill: N, stroke: SL, strokeWidth: 0.4 },
  ],
};

// ── Light fixture (plan view: circle with rays) ──

const light: FixtureShape = {
  label: 'Light',
  paths: [
    // Outer circle
    { d: 'M0.5,0.1 A0.4,0.4 0 1,1 0.5,0.9 A0.4,0.4 0 1,1 0.5,0.1 Z', fill: N, stroke: S, strokeWidth: 1.5 },
    // Inner circle (bulb)
    { d: 'M0.5,0.25 A0.25,0.25 0 1,1 0.5,0.75 A0.25,0.25 0 1,1 0.5,0.25 Z', fill: N, stroke: SL, strokeWidth: 0.8 },
    // Cross lines (filament)
    { d: 'M0.35,0.5 L0.65,0.5', fill: N, stroke: SL, strokeWidth: 0.6 },
    { d: 'M0.5,0.35 L0.5,0.65', fill: N, stroke: SL, strokeWidth: 0.6 },
  ],
};

// ── Recessed can light (small circle with concentric ring) ──
const recessedCan: FixtureShape = {
  label: 'Can',
  paths: [
    { d: 'M0.5,0.1 A0.4,0.4 0 1,1 0.5,0.9 A0.4,0.4 0 1,1 0.5,0.1 Z', fill: '#f5f5f5', stroke: S, strokeWidth: 1.5 },
    { d: 'M0.5,0.25 A0.25,0.25 0 1,1 0.5,0.75 A0.25,0.25 0 1,1 0.5,0.25 Z', fill: '#fff', stroke: S, strokeWidth: 1 },
  ],
};

// ── Lights on a wall, a pendant (the wall is the top edge, y = 0) ──

/** An ellipse path of radius r across the depth, round on the plan for a box `aspect` wide per deep */
function dot(cx: number, cy: number, ry: number, aspect: number): string {
  const rx = ry / Math.max(0.2, aspect);
  return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0`;
}

function buildVanityBar(bulbs: number, aspect: number): FixtureShape {
  const n = Math.max(1, Math.min(8, Math.round(bulbs)));
  const paths: PathEntry[] = [
    // Back plate on the wall, the bar out from it
    { d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 2 },
    { d: 'M0.02,0.08 L0.98,0.08 L0.98,0.42 L0.02,0.42 Z', fill: F, stroke: S, strokeWidth: 1.2 },
  ];
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) / n;
    paths.push({ d: `M${cx},0.42 L${cx},0.5`, fill: N, stroke: SL, strokeWidth: 0.6 });
    paths.push({ d: dot(cx, 0.72, 0.24, aspect), fill: '#fff8e1', stroke: S, strokeWidth: 0.9 });
  }
  return { label: `${n}-light`, paths };
}

function buildSconce(aspect: number): FixtureShape {
  return {
    label: 'Sconce',
    paths: [
      { d: 'M0.15,0 L0.85,0', fill: N, stroke: S, strokeWidth: 2 },
      { d: 'M0.35,0.04 L0.65,0.04 L0.65,0.25 L0.35,0.25 Z', fill: F, stroke: S, strokeWidth: 1 },
      { d: dot(0.5, 0.62, 0.34, aspect), fill: '#fff8e1', stroke: S, strokeWidth: 1.2 },
    ],
  };
}

const pendant: FixtureShape = {
  label: 'Pendant',
  paths: [
    { d: 'M0.5,0.08 A0.42,0.42 0 1,1 0.5,0.92 A0.42,0.42 0 1,1 0.5,0.08 Z', fill: N, stroke: S, strokeWidth: 1.5 },
    { d: 'M0.5,0.32 A0.18,0.18 0 1,1 0.5,0.68 A0.18,0.18 0 1,1 0.5,0.32 Z', fill: '#fff8e1', stroke: S, strokeWidth: 0.8 },
    { d: 'M0.5,0.08 L0.5,0.32 M0.5,0.68 L0.5,0.92 M0.08,0.5 L0.32,0.5 M0.68,0.5 L0.92,0.5', fill: N, stroke: SL, strokeWidth: 0.6 },
  ],
};

// ── Cabinets on a wall (the wall is the top edge) ──

function buildCabinet(cabinetType?: string): FixtureShape {
  const paths: PathEntry[] = [
    { d: 'M0,0 L1,0', fill: N, stroke: S, strokeWidth: 2 },
    { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: '#fbfaf7', stroke: S, strokeWidth: 1.5 },
  ];
  if (cabinetType === 'wall_cabinet') {
    // Two doors meeting in the middle (its name goes inside the box)
    paths.push({ d: 'M0.5,0.8 L0.5,1', fill: N, stroke: S, strokeWidth: 0.8 });
  } else {
    // Its door is a mirror: glass along the front
    paths.push({ d: 'M0.02,0.86 L0.98,0.86 L0.98,1 L0.02,1 Z', fill: GLASS, stroke: '#2196f3', strokeWidth: 0.8 });
  }
  const label = cabinetType === 'wall_cabinet' ? 'Wall cab.'
    : cabinetType === 'medicine_cabinet_recessed' ? 'Med. cab. (rec.)' : 'Med. cab.';
  return { label, paths };
}

// ── Soffit: a lowered ceiling, overhead, so light and crossed ──

const feetInches = (inches: number) => `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

function buildSoffit(bottomIn: number): FixtureShape {
  return {
    label: `Soffit ${feetInches(bottomIn)}`,
    paths: [
      { d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: 'rgba(120, 110, 90, 0.06)', stroke: '#8a8070', strokeWidth: 1.2 },
      { d: 'M0,0 L1,1 M1,0 L0,1', fill: N, stroke: '#b5ad9f', strokeWidth: 0.6 },
    ],
  };
}

/** What a fixture's plan symbol needs beyond its type, sub-type and size */
export interface FixtureShapeExtras {
  /** Width over depth on the plan, to keep a vanity bar's lights round */
  aspect?: number;
  lightBulbs?: number;
  cabinetType?: string;
  soffitBottom?: number;
}

// ── Lookup ──

const BATHTUB_SHAPES: Partial<Record<BathtubSubType, FixtureShape>> = {
  standard_alcove: bathtubAlcove,
  corner_garden: bathtubCorner,
  corner_drop_in: bathtubCornerDropIn,
  freestanding: bathtubFreestanding,
};

export function getFixtureShape(
  type: BEFixtureType,
  subType?: BathtubSubType,
  sinkCount?: number,
  showerDoorType?: ShowerDoorType,
  showerLayout?: 'alcove' | 'corner' | 'corner_right' | 'neo_angle' | 'neo_angle_right',
  fixedPanelConfig?: 'none' | 'left' | 'right' | 'both',
  showerDoorRatio?: number,
  vanitySubType?: VanitySubType,
  lightType?: string,
  wallSides?: WallSides | null,
  showerDoorPosition?: ShowerDoorPosition,
  extras: FixtureShapeExtras = {},
): FixtureShape {
  switch (type) {
    case 'bathtub':
      // drop_in's deck can be against 0-4 walls depending on placement, so its rim is
      // built dynamically from wallSides; other subtypes have a fixed wall arrangement
      // (or no deck at all) baked into their static shape.
      if ((subType ?? 'standard_alcove') === 'drop_in') return buildBathtubDropIn(wallSides ?? null);
      return BATHTUB_SHAPES[subType ?? 'standard_alcove']!;
    case 'shower':
      return buildShowerShape(
        showerLayout ?? 'alcove',
        showerDoorType ?? 'none',
        fixedPanelConfig ?? 'none',
        showerDoorRatio ?? 0.5,
        showerDoorPosition ?? 'center',
      );
    case 'vanity':
      if (vanitySubType === 'pedestal_sink') return pedestalSink;
      if (vanitySubType === 'wall_mount_sink') return wallMountSink;
      return (sinkCount ?? 1) >= 2 ? vanityDouble : vanitySingle;
    case 'toilet':
      return toilet;
    case 'door':
      return door;
    case 'window':
      return windowShape;
    case 'mirror':
      return mirror;
    case 'light':
      switch (lightType) {
        case 'recessed':
        case 'recessed_multi': return recessedCan;
        case 'vanity_bar': return buildVanityBar(extras.lightBulbs ?? 3, extras.aspect ?? 5);
        case 'sconce': return buildSconce(extras.aspect ?? 1.2);
        case 'pendant': return pendant;
        default: return light;
      }
    case 'cabinet':
      return buildCabinet(extras.cabinetType);
    case 'soffit':
      return buildSoffit(extras.soffitBottom ?? 84);
    default:
      return { label: type, paths: [{ d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: F, stroke: S, strokeWidth: 1.5 }] };
  }
}
