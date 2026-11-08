/**
 * Where the plan's words go.
 *
 * Three kinds of label: each room's name with its area and floor tile; each
 * fixture's name with the tile that comes with it (surround, deck, walls...);
 * and the dimensions along the walls. A fixture's tile used to be labelled
 * zone by zone and the room and its floor tile both at the room's centre, so
 * they piled up on each other. Here each room and each fixture gets one label,
 * a room's label moves off the fixtures, and a dimension sits outside the room.
 */

import type { BEFixture, BEPoint, BERoom, BETileZone, TileZoneType } from '@/types/bathroomSketch';
import { drainOf, faucetOf, hasPlumbing, onPlan } from './plumbingPoints';

export interface LabelLine {
  text: string;
  /** The name: a step bigger and bold */
  strong?: boolean;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlanLabel {
  key: string;
  kind: 'room' | 'fixture' | 'zone';
  /** Centre, in plan px */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: LabelLine[];
  subRoom?: boolean;
}

/** Width in px of a line of text */
export type Measure = (text: string, fontSize: number, strong: boolean) => number;

export const LABEL_FONT = { strong: 10, normal: 9, lineHeight: 1.25, pad: 3 };

/** Close enough to keep labels apart where there's no canvas to measure with */
export const estimateWidth: Measure = (text, fontSize, strong) => text.length * fontSize * (strong ? 0.62 : 0.55);

export const lineFontSize = (line: LabelLine) => (line.strong ? LABEL_FONT.strong : LABEL_FONT.normal);

export function labelSize(lines: LabelLine[], measure: Measure = estimateWidth): { w: number; h: number } {
  const w = Math.max(0, ...lines.map((l) => measure(l.text, lineFontSize(l), !!l.strong)));
  const h = lines.reduce((s, l) => s + lineFontSize(l) * LABEL_FONT.lineHeight, 0);
  return { w: Math.ceil(w) + LABEL_FONT.pad * 2, h: Math.ceil(h) + LABEL_FONT.pad * 2 };
}

export const boxOf = (l: { x: number; y: number; w: number; h: number }): Box => ({
  x0: l.x - l.w / 2,
  y0: l.y - l.h / 2,
  x1: l.x + l.w / 2,
  y1: l.y + l.h / 2,
});

export const boxesOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const sf = (n: number) => `${Math.round(n * 10) / 10} SF`;

const FIXTURE_NAMES: Record<BEFixture['type'], string> = {
  bathtub: 'Bathtub',
  shower: 'Shower',
  vanity: 'Vanity',
  toilet: 'Toilet',
  door: 'Door',
  window: 'Window',
  mirror: 'Mirror',
  light: 'Light',
  cabinet: 'Cabinet',
  soffit: 'Soffit',
};

/** A fixture's zones by what they are on that fixture */
const ZONE_SHORT: Partial<Record<TileZoneType, string>> = {
  tub_surround: 'Surround',
  tub_deck: 'Deck',
  tub_front_panel: 'Front panel',
  shower_walls: 'Walls',
  shower_floor: 'Floor',
  shower_niche: 'Niche',
  shower_bench: 'Bench',
  shower_curb: 'Curb',
  shower_glass_panel: 'Glass panel',
  shower_door: 'Door',
  vanity_backsplash: 'Backsplash',
};

/** "Niche (2)" → "Niches ×2"; the rest by their short name */
function zoneName(z: BETileZone): string {
  if (z.type === 'shower_niche') {
    const n = Number(/\((\d+)\)/.exec(z.label)?.[1] ?? 1);
    return n > 1 ? `Niches ×${n}` : 'Niche';
  }
  return ZONE_SHORT[z.type] ?? z.label;
}

const centroid = (pts: BEPoint[]): BEPoint => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

const sameBoundary = (a: BEPoint[], b: BEPoint[]) =>
  a === b || (a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 0.5 && Math.abs(p.y - b[i].y) < 0.5));

export function pointInPolygon(p: BEPoint, poly: BEPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The box a fixture covers on the plan, turned however it's turned */
export function fixtureBox(f: BEFixture, ppf: number): Box {
  const hw = ((f.dimensions.width / 12) * ppf) / 2;
  const hh = ((f.dimensions.height / 12) * ppf) / 2;
  const r = ((f.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const ex = hw * cos + hh * sin;
  const ey = hw * sin + hh * cos;
  return { x0: f.position.x - ex, y0: f.position.y - ey, x1: f.position.x + ex, y1: f.position.y + ey };
}

/**
 * Somewhere near `start` for a box of w × h: inside `poly`, clear of every
 * obstacle. Tries the nearest spots first; keeps `start` if nothing is clear.
 */
export function findClearSpot(
  start: BEPoint,
  w: number,
  h: number,
  poly: BEPoint[],
  obstacles: Box[],
  step = 6,
  reach = 240,
): BEPoint {
  const corners = (c: BEPoint) => {
    const b = boxOf({ ...c, w, h });
    return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  };
  const fits = (c: BEPoint) =>
    corners(c).every((p) => pointInPolygon(p, poly)) && !obstacles.some((o) => boxesOverlap(boxOf({ ...c, w, h }), o));

  if (fits(start)) return start;
  const candidates: { p: BEPoint; d: number }[] = [];
  for (let dy = -reach; dy <= reach; dy += step) {
    for (let dx = -reach; dx <= reach; dx += step) {
      // Up and down first: a label reads best centred across the room
      candidates.push({ p: { x: start.x + dx, y: start.y + dy }, d: Math.hypot(dx * 1.5, dy) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.find((c) => fits(c.p))?.p ?? start;
}

/**
 * Where a fixture's label goes: on it, moved off its faucet and drain (a
 * tub's or shower's) so they can be seen and grabbed.
 */
export function fixtureLabelSpot(f: BEFixture, w: number, h: number, ppf: number): BEPoint {
  const start = { x: f.position.x, y: f.position.y };
  if (!hasPlumbing(f)) return start;
  const marks = [onPlan(f, drainOf(f), ppf), onPlan(f, faucetOf(f), ppf)];
  const pad = (4 * ppf) / 12;
  const clear = (c: BEPoint) => marks.every((m) => Math.abs(m.x - c.x) >= w / 2 + pad || Math.abs(m.y - c.y) >= h / 2 + pad);
  if (clear(start)) return start;
  for (let step = 4; step <= 240; step += 4) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const c = { x: start.x + dx * step, y: start.y + dy * step };
      if (clear(c)) return c;
    }
  }
  return start;
}

export interface PlanLabels {
  labels: PlanLabel[];
  /** Fixtures whose name is in a label here, so the fixture doesn't draw its own */
  labelledFixtureIds: Set<string>;
}

/**
 * The room and fixture labels for a plan. With `withTile` off (tile zones
 * hidden), rooms and fixtures are labelled without their tile.
 */
export function buildPlanLabels(
  rooms: BERoom[],
  fixtures: BEFixture[],
  tileZones: BETileZone[],
  ppf: number,
  opts: { withRooms: boolean; withTile: boolean; measure?: Measure },
): PlanLabels {
  const measure = opts.measure ?? estimateWidth;
  const labels: PlanLabel[] = [];
  const labelledFixtureIds = new Set<string>();
  const used = new Set<string>();

  // ── Fixtures: the name, then each tile zone that comes with it ──
  if (opts.withTile) {
    for (const f of fixtures) {
      const zones = tileZones.filter((z) => z.fixtureId === f.id);
      if (!zones.length) continue;
      zones.forEach((z) => used.add(z.id));
      const lines: LabelLine[] = [
        { text: f.label ?? FIXTURE_NAMES[f.type], strong: true },
        ...zones.map((z) => ({ text: `${zoneName(z)} ${sf(z.areaSF)}` })),
      ];
      const size = labelSize(lines, measure);
      labels.push({ key: `f-${f.id}`, kind: 'fixture', ...fixtureLabelSpot(f, size.w, size.h, ppf), lines, ...size });
      labelledFixtureIds.add(f.id);
    }
  }

  // ── Rooms: name, area, floor tile; off the fixtures and their labels ──
  if (opts.withRooms) {
    const obstacles = [
      ...fixtures.map((f) => fixtureBox(f, ppf)),
      ...labels.map(boxOf),
    ];
    for (const room of rooms) {
      if (room.boundary.length < 3) continue;
      const floor = opts.withTile
        ? tileZones.find((z) => z.type === 'floor' && !used.has(z.id) && sameBoundary(z.boundary, room.boundary))
        : undefined;
      if (floor) used.add(floor.id);
      const lines: LabelLine[] = [
        { text: room.name, strong: true },
        { text: sf(room.netFloorAreaSF ?? room.floorAreaSF) },
        ...(floor ? [{ text: `Floor tile ${sf(floor.areaSF)}` }] : []),
      ];
      const size = labelSize(lines, measure);
      const at = findClearSpot(centroid(room.boundary), size.w, size.h, room.boundary, obstacles);
      const label: PlanLabel = { key: `r-${room.id}`, kind: 'room', ...at, lines, ...size, subRoom: !!room.parentRoomId };
      labels.push(label);
      obstacles.push(boxOf(label));
    }
  }

  // ── Anything left (a zone with no fixture or room to go on) labels itself ──
  if (opts.withTile) {
    for (const z of tileZones) {
      if (used.has(z.id) || z.boundary.length === 0) continue;
      const lines: LabelLine[] = [{ text: z.label }, { text: sf(z.areaSF) }];
      labels.push({ key: `z-${z.id}`, kind: 'zone', ...centroid(z.boundary), lines, ...labelSize(lines, measure) });
    }
  }

  return { labels, labelledFixtureIds };
}

/**
 * Where an edge's dimension goes: off its middle, on the side away from
 * `inside` (the room's centre), far enough out that a w × h label clears the
 * line by `gap`. With no room, it goes above a level edge or left of an
 * upright one. All in the same units as the points.
 */
export function dimensionAnchor(
  a: BEPoint,
  b: BEPoint,
  inside: BEPoint | null,
  w: number,
  h: number,
  gap: number,
): BEPoint {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  if (inside) {
    if ((inside.x - mid.x) * n.x + (inside.y - mid.y) * n.y > 0) n = { x: -n.x, y: -n.y };
  } else if (n.y > 1e-9 || (Math.abs(n.y) <= 1e-9 && n.x > 0)) {
    n = { x: -n.x, y: -n.y };
  }
  const out = Math.abs(n.x) * (w / 2) + Math.abs(n.y) * (h / 2) + gap;
  return { x: mid.x + n.x * out, y: mid.y + n.y * out };
}
