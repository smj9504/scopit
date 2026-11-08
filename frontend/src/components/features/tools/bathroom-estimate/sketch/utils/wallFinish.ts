/**
 * Which parts of each wall are tile and which are drywall: today (the
 * existing tile, which is demolished) and after the work (the tile to
 * install; the rest of the wall is painted).
 *
 * A wall's face is measured in inches: along the wall from its start point,
 * and up from the floor. Tile is a list of rectangles on that face. Door and
 * window openings, and the wall behind a tub or shower (its own surround,
 * priced with the fixture), are neither tile nor paint here — unless the
 * tile to install runs over the whole of a surround (a wall tiled floor to
 * ceiling): then the wall is one tile, and that surround is its tile.
 */

import type { BEFixture, BEPoint, BERoom, BEWall, BEWallTileRegion } from '@/types/bathroomSketch';

export type WallFinishLayer = 'existing' | 'new';

/** A rectangle on a wall face, inches: x along the wall, y up from the floor. */
export interface FaceRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface WallFinishAreas {
  lengthIn: number;
  heightIn: number;
  /** The whole face. */
  grossSF: number;
  /** Doors and windows. */
  openingSF: number;
  /** Behind a tub or shower surround. */
  coveredSF: number;
  /** Of that, the surround the tile to install runs over, counted in tileSF. */
  surroundInTileSF: number;
  /** The same, by the fixture whose surround it is. */
  surroundInTile: Record<string, number>;
  /** Existing tile to take off. */
  existingTileSF: number;
  /** Tile to install. */
  tileSF: number;
  /** Drywall to paint: the face less openings, covered area and new tile. */
  paintSF: number;
}

/** Door opening height when the door doesn't say. */
export const DOOR_HEIGHT_IN = 80;
/** Window sill and opening height when the window doesn't say. */
export const WINDOW_SILL_IN = 36;
export const WINDOW_HEIGHT_IN = 48;
/** Tub rim height when the tub has no deck height. */
const TUB_RIM_IN = 15;
/** How close (px) a fixture corner must be to a wall to stand against it. */
const AGAINST_WALL_PX = 18;
/** How far (inches) tile may stop short of a surround's edge and still run over it: regions are kept to a tenth. */
const RUNS_OVER_SLACK_IN = 0.5;

const round1 = (n: number) => Math.round(n * 10) / 10;

export const wallLengthIn = (wall: BEWall, pixelsPerFoot: number): number =>
  (Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / pixelsPerFoot) * 12;

let regionCounter = 0;
export const newRegionId = (): string => {
  regionCounter += 1;
  return `wr_${Date.now().toString(36)}_${regionCounter}`;
};

/** A region over the whole face. */
export const fullWallRegion = (lengthIn: number, heightIn: number): BEWallTileRegion => ({
  id: newRegionId(), startIn: 0, endIn: round1(lengthIn), bottomIn: 0, topIn: heightIn,
});

/** Tile from the floor up to `topIn`, the whole length of the wall. */
export const wainscotRegion = (lengthIn: number, topIn: number): BEWallTileRegion => ({
  id: newRegionId(), startIn: 0, endIn: round1(lengthIn), bottomIn: 0, topIn,
});

/**
 * The wall's tile on one layer, clipped to the wall as it is now (it may have
 * been shortened since). Walls saved before regions existed are read from
 * their older fields: `finish: 'tile'` is the whole wall, and an existing tile
 * band runs the whole length between its two heights.
 */
export function wallTileRegions(wall: BEWall, layer: WallFinishLayer, pixelsPerFoot: number): BEWallTileRegion[] {
  const lengthIn = wallLengthIn(wall, pixelsPerFoot);
  const heightIn = wall.heightInches;
  const stored = layer === 'existing' ? wall.existingTileRegions : wall.tileRegions;

  let regions: BEWallTileRegion[];
  if (stored) {
    regions = stored;
  } else if (layer === 'new') {
    regions = wall.finish === 'tile' ? [{ id: 'legacy-new', startIn: 0, endIn: lengthIn, bottomIn: 0, topIn: heightIn }] : [];
  } else if (wall.existingFinish === 'tile') {
    const from = wall.existingTileFromInches ?? 0;
    const to = wall.existingTileToInches;
    // Neither height given (or both 0) means the full wall height
    const top = to === undefined || (to === 0 && from === 0) ? heightIn : to;
    regions = [{ id: 'legacy-existing', startIn: 0, endIn: lengthIn, bottomIn: from, topIn: top }];
  } else {
    regions = [];
  }

  return regions
    .map((r) => ({
      ...r,
      startIn: Math.max(0, Math.min(r.startIn, r.endIn)),
      endIn: Math.min(lengthIn, Math.max(r.startIn, r.endIn)),
      bottomIn: Math.max(0, Math.min(r.bottomIn, r.topIn)),
      topIn: Math.min(heightIn, Math.max(r.bottomIn, r.topIn)),
    }))
    .filter((r) => r.endIn - r.startIn > 0.01 && r.topIn - r.bottomIn > 0.01);
}

export const regionRect = (r: BEWallTileRegion): FaceRect => ({ x0: r.startIn, x1: r.endIn, y0: r.bottomIn, y1: r.topIn });

/** Square inches covered by `include` and by none of `exclude`, overlaps counted once. */
export function coveredArea(include: FaceRect[], exclude: FaceRect[] = []): number {
  if (!include.length) return 0;
  const all = include.concat(exclude);
  const xs = Array.from(new Set(all.flatMap((r) => [r.x0, r.x1]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(all.flatMap((r) => [r.y0, r.y1]))).sort((a, b) => a - b);
  const inside = (r: FaceRect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ys.length - 1; j++) {
      const y = (ys[j] + ys[j + 1]) / 2;
      if (include.some((r) => inside(r, x, y)) && !exclude.some((r) => inside(r, x, y))) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return area;
}

/** Where a plan point falls along the wall (inches from its start) and how far off it is (px). */
function alongWall(wall: BEWall, p: BEPoint, pixelsPerFoot: number) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = ((p.x - wall.start.x) * dx + (p.y - wall.start.y) * dy) / len;
  const off = Math.abs((p.x - wall.start.x) * dy - (p.y - wall.start.y) * dx) / len;
  // To a hundredth of an inch, so a corner on the wall's end reads as 0, not 2e-15
  const alongIn = Math.round((t / pixelsPerFoot) * 1200) / 100;
  return { alongIn, offPx: off, lenPx: len, tPx: t };
}

/** A point of a fixture given in its own frame (px from its centre, before it's turned). */
function fixturePoint(fix: BEFixture, lx: number, ly: number): BEPoint {
  const rad = ((fix.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: fix.position.x + lx * cos - ly * sin, y: fix.position.y + lx * sin + ly * cos };
}

function fixtureCorners(fix: BEFixture, pixelsPerFoot: number): BEPoint[] {
  const hw = ((fix.dimensions.width / 12) * pixelsPerFoot) / 2;
  const hh = ((fix.dimensions.height / 12) * pixelsPerFoot) / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => fixturePoint(fix, x, y));
}

export interface WallOpening {
  rect: FaceRect;
  fixture: BEFixture;
}

/**
 * Door and window openings in this wall. The part of the plan symbol in the
 * wall is a door's closed panel (its bottom edge — the door swings off it)
 * or a window's middle line; a door or window not tied to a wall is in this
 * one when that edge lies along it.
 */
export function wallOpeningsOf(wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): WallOpening[] {
  const openings: WallOpening[] = [];
  for (const fix of fixtures) {
    if (fix.type !== 'door' && fix.type !== 'window') continue;
    const hw = ((fix.dimensions.width / 12) * pixelsPerFoot) / 2;
    const ly = fix.type === 'door' ? ((fix.dimensions.height / 12) * pixelsPerFoot) / 2 : 0;
    const ends = [fixturePoint(fix, -hw, ly), fixturePoint(fix, hw, ly)].map((p) => alongWall(wall, p, pixelsPerFoot));
    const onWall = fix.wallId
      ? fix.wallId === wall.id
      : ends.every((a) => a.offPx <= AGAINST_WALL_PX / 2 && a.tPx >= -AGAINST_WALL_PX && a.tPx <= a.lenPx + AGAINST_WALL_PX);
    if (!onWall) continue;
    const p = fix.properties || {};
    const y0 = fix.type === 'door' ? 0 : (p.sillHeightIn ?? WINDOW_SILL_IN);
    const y1 = fix.type === 'door'
      ? (p.openingHeightIn ?? DOOR_HEIGHT_IN)
      : y0 + (p.openingHeightIn ?? WINDOW_HEIGHT_IN);
    const xs = ends.map((a) => a.alongIn);
    openings.push({ rect: { x0: Math.min(...xs), x1: Math.max(...xs), y0, y1 }, fixture: fix });
  }
  return openings;
}

export const wallOpenings = (wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): FaceRect[] =>
  wallOpeningsOf(wall, fixtures, pixelsPerFoot).map((o) => o.rect);

export interface WallCover {
  rect: FaceRect;
  fixture: BEFixture;
  /** The part tiled with the fixture: a tub's surround above its rim, a tiled shower's wall. None for a prefab one. */
  tiled: FaceRect | null;
}

/**
 * The part of this wall behind each tub or shower that stands against it: up
 * to the shower's tile height, or the tub's rim plus its surround. Two corners
 * of the fixture against the wall make the span.
 */
export function wallFixtureCovers(wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): WallCover[] {
  const lengthIn = wallLengthIn(wall, pixelsPerFoot);
  const covers: WallCover[] = [];
  for (const fix of fixtures) {
    let top: number;
    // How far up the wall the fixture's own tile starts; null when it has none
    let tiledFrom: number | null;
    if (fix.type === 'shower') {
      top = fix.properties.showerTileHeight ?? 96;
      tiledFrom = (fix.properties.showerWallMaterial ?? 'tile') === 'tile' ? 0 : null;
    } else if (fix.type === 'bathtub') {
      if (fix.properties.bathtubSubType === 'freestanding') continue;
      const rim = fix.properties.deckHeight || TUB_RIM_IN;
      const surround = fix.properties.hasSurround === false ? 0 : (fix.properties.surroundHeight ?? 60);
      top = rim + surround;
      tiledFrom = surround > 0 ? rim : null;
    } else {
      continue;
    }
    const near = fixtureCorners(fix, pixelsPerFoot)
      .map((c) => alongWall(wall, c, pixelsPerFoot))
      .filter((a) => a.offPx <= AGAINST_WALL_PX && a.tPx >= -AGAINST_WALL_PX && a.tPx <= a.lenPx + AGAINST_WALL_PX);
    if (near.length < 2) continue;
    const xs = near.map((a) => a.alongIn);
    const rect = {
      x0: Math.max(0, Math.min(...xs)), x1: Math.min(lengthIn, Math.max(...xs)), y0: 0, y1: Math.min(top, wall.heightInches),
    };
    if (rect.x1 - rect.x0 <= 0.01) continue;
    const tiled = tiledFrom !== null && tiledFrom < rect.y1 ? { ...rect, y0: tiledFrom } : null;
    covers.push({ rect, fixture: fix, tiled });
  }
  return covers;
}

export const wallFixtureCover = (wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): FaceRect[] =>
  wallFixtureCovers(wall, fixtures, pixelsPerFoot).map((c) => c.rect);

export interface WallSurrounds {
  /** What stays the fixtures' after the work: each surround the tile doesn't run over, and the wall behind a tub's body. */
  kept: WallCover[];
  /** Surrounds the wall's tile runs over, now that tile. */
  inTile: WallCover[];
}

/**
 * The wall's surrounds after the work, given its tile to install. Tile over
 * the whole of a surround's tiled part makes the wall one tile there: that
 * part is the wall's tile, not a patch of the fixture's own, and only the
 * wall behind a tub below its rim is left to the fixture.
 */
export function surroundsAfterWork(covers: WallCover[], tile: FaceRect[]): WallSurrounds {
  const s = RUNS_OVER_SLACK_IN;
  const reach = tile.map((r) => ({ x0: r.x0 - s, x1: r.x1 + s, y0: r.y0 - s, y1: r.y1 + s }));
  const kept: WallCover[] = [];
  const inTile: WallCover[] = [];
  for (const c of covers) {
    if (!c.tiled || !reach.length || coveredArea([c.tiled], reach) > 0) {
      kept.push(c);
      continue;
    }
    inTile.push({ ...c, rect: c.tiled });
    if (c.tiled.y0 > c.rect.y0) kept.push({ ...c, rect: { ...c.rect, y1: c.tiled.y0 }, tiled: null });
  }
  return { kept, inTile };
}

/**
 * `include` less `exclude`, as rectangles that don't overlap: the face is cut
 * into columns at every edge, and a column's runs carry on into the next
 * column for as long as they stay the same.
 */
export function subtractRects(include: FaceRect[], exclude: FaceRect[] = []): FaceRect[] {
  if (!include.length) return [];
  const all = include.concat(exclude);
  const xs = Array.from(new Set(all.flatMap((r) => [r.x0, r.x1]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(all.flatMap((r) => [r.y0, r.y1]))).sort((a, b) => a - b);
  const inside = (r: FaceRect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  const out: FaceRect[] = [];
  let open: FaceRect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2;
    const runs: [number, number][] = [];
    for (let j = 0; j < ys.length - 1; j++) {
      const y = (ys[j] + ys[j + 1]) / 2;
      if (!include.some((r) => inside(r, x, y)) || exclude.some((r) => inside(r, x, y))) continue;
      const last = runs[runs.length - 1];
      if (last && last[1] === ys[j]) last[1] = ys[j + 1];
      else runs.push([ys[j], ys[j + 1]]);
    }
    const next: FaceRect[] = [];
    for (const [y0, y1] of runs) {
      const carried = open.find((r) => r.y0 === y0 && r.y1 === y1 && r.x1 === xs[i]);
      if (carried) {
        carried.x1 = xs[i + 1];
        next.push(carried);
      } else {
        const rect = { x0: xs[i], x1: xs[i + 1], y0, y1 };
        out.push(rect);
        next.push(rect);
      }
    }
    open = next;
  }
  return out;
}

export function wallFinishAreas(wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): WallFinishAreas {
  const lengthIn = wallLengthIn(wall, pixelsPerFoot);
  const heightIn = wall.heightInches;
  const face: FaceRect = { x0: 0, x1: lengthIn, y0: 0, y1: heightIn };
  const clip = (r: FaceRect): FaceRect => ({
    x0: Math.max(0, r.x0), x1: Math.min(lengthIn, r.x1), y0: Math.max(0, r.y0), y1: Math.min(heightIn, r.y1),
  });
  const openings = wallOpenings(wall, fixtures, pixelsPerFoot).map(clip);
  const covers = wallFixtureCovers(wall, fixtures, pixelsPerFoot);
  const covered = covers.map((c) => clip(c.rect));
  const newTile = wallTileRegions(wall, 'new', pixelsPerFoot).map(regionRect);
  const existingTile = wallTileRegions(wall, 'existing', pixelsPerFoot).map(regionRect);
  // Today every surround is the fixture's: its tile comes off with it
  const holesToday = openings.concat(covered);
  const after = surroundsAfterWork(covers, newTile);
  const holesAfter = openings.concat(after.kept.map((c) => clip(c.rect)));
  const sf = (sqIn: number) => round1(sqIn / 144);

  const surroundInTile: Record<string, number> = {};
  for (const c of after.inTile) {
    surroundInTile[c.fixture.id] = round1((surroundInTile[c.fixture.id] ?? 0) + sf(coveredArea([clip(c.rect)], openings)));
  }

  return {
    lengthIn,
    heightIn,
    grossSF: sf(lengthIn * heightIn),
    openingSF: sf(coveredArea(openings)),
    coveredSF: sf(coveredArea(covered, openings)),
    surroundInTileSF: sf(coveredArea(after.inTile.map((c) => clip(c.rect)), openings)),
    surroundInTile,
    existingTileSF: sf(coveredArea(existingTile, holesToday)),
    tileSF: sf(coveredArea(newTile, holesAfter)),
    paintSF: sf(coveredArea([face], holesAfter.concat(newTile))),
  };
}

/** The finish areas of a room's walls, added up. */
export function roomWallFinishTotals(walls: BEWall[], fixtures: BEFixture[], pixelsPerFoot: number) {
  return walls.reduce(
    (sum, wall) => {
      const a = wallFinishAreas(wall, fixtures, pixelsPerFoot);
      const surroundInTile = { ...sum.surroundInTile };
      for (const [id, v] of Object.entries(a.surroundInTile)) surroundInTile[id] = round1((surroundInTile[id] ?? 0) + v);
      return {
        tileSF: round1(sum.tileSF + a.tileSF),
        paintSF: round1(sum.paintSF + a.paintSF),
        existingTileSF: round1(sum.existingTileSF + a.existingTileSF),
        // By fixture: the SF of its surround the walls' tile runs over
        surroundInTile,
      };
    },
    { tileSF: 0, paintSF: 0, existingTileSF: 0, surroundInTile: {} as Record<string, number> },
  );
}

/**
 * Whether the wall's start is on your left when you stand in its room facing
 * it, so its face can be drawn as you'd see it. A wall in no room is drawn
 * start-left.
 */
export function wallStartOnLeft(wall: BEWall, rooms: BERoom[]): boolean {
  const room = rooms.find((r) => r.wallIds.includes(wall.id) && r.boundary.length >= 3);
  if (!room) return true;
  const cx = room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length;
  const cy = room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length;
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  // Facing the wall from inside: from the room's middle toward the wall
  const fx = mx - cx;
  const fy = my - cy;
  // Your right hand, on a plan whose y runs down the screen
  const rx = -fy;
  const ry = fx;
  return rx * (wall.end.x - wall.start.x) + ry * (wall.end.y - wall.start.y) > 0;
}
