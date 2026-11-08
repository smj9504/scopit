/**
 * The bathroom sketch in 3D, as plain data in inches: the walls cut around
 * their doors and windows with the tile and the tub / shower surrounds on
 * their room side, the floors, each fixture where the plan puts it, and the
 * looks (tile, paint, metal, tops) the estimate's specs give them, or an
 * option's picked products (their colour, finish, tile size and surface
 * picture). No three.js here — bathroom3dScene.ts turns this into meshes.
 *
 * Plan to 3D: a plan point (x, y) in px is (x, y) / pixelsPerFoot × 12
 * inches. Plan x is three's x, plan y (down the screen) is three's z, and
 * three's y is up from the floor. A wall stands on its plan line and is as
 * thick as a framed wall toward the outside, so the room keeps the size it
 * was drawn at and fixtures stand against the wall's face.
 */

import type { BathroomSelection } from '@/types/bathroomEstimate';
import type { BEFixture, BEPoint, BERoom, BESketchData, BEWall } from '@/types/bathroomSketch';
import { findFixtureWallSides } from './utils/beTileZoneGenerator';
import {
  regionRect,
  subtractRects,
  surroundsAfterWork,
  wallFixtureCovers,
  wallLengthIn,
  wallOpeningsOf,
  wallTileRegions,
  type FaceRect,
} from './utils/wallFinish';

/** A plan point in inches: [x, z]. */
export type Pt = [number, number];

/** Which finish the walls show: after the work (the tile to install) or as they are today. */
export type FinishView = 'after' | 'today';

export interface TileLook {
  /** Same look, same key: the scene makes one texture per key. */
  key: string;
  material: string;
  /** One tile, inches: along the surface, and across it. */
  widthIn: number;
  heightIn: number;
  pattern: string;
  color: string;
  grout: string;
  roughness: number;
  /** A picked tile's surface picture (a file id), laid on each tile in place of the flat colour. */
  swatchFileId?: string;
}

export interface BathroomLooks {
  paint: string;
  /** Null when the floor isn't tile (a plain floor in floorPlain). */
  floor: TileLook | null;
  floorPlain: string;
  wallTile: TileLook;
  showerTile: TileLook;
  surroundTile: TileLook;
  /** Acrylic / fiberglass surrounds, pans and tubs. */
  prefab: string;
  vanityBox: string;
  vanityTop: string;
  /** A wall-hung vanity, clear of the floor. */
  vanityFloating: boolean;
  /** Toilets and sinks. */
  china: string;
  metal: string;
  /** A tub with a shower over it (the job has no separate shower): head and curtain rod. */
  tubShower: boolean;
}

export interface WallOpeningSolid {
  rect: FaceRect;
  kind: 'door' | 'window';
  fixtureId: string;
  /** A door: which end of the opening its hinge is at, and whether it swings into the room. */
  hingeAtStart: boolean;
  swingsIn: boolean;
}

export interface WallSolid {
  id: string;
  a: Pt;
  b: Pt;
  lengthIn: number;
  heightIn: number;
  thicknessIn: number;
  /** Unit normal from the wall into its room; null for a wall in no room. */
  inward: Pt | null;
  /** The wall itself, as rectangles on its face (along from a, up from the floor), openings left out. */
  pieces: FaceRect[];
  /** Tile on its room side, less openings and surrounds — save those the tile runs over whole. */
  tile: FaceRect[];
  /** The part behind a tub or shower: tiled with the fixture, or its prefab surround. */
  surrounds: { rect: FaceRect; finish: 'tile' | 'prefab'; fixtureId: string }[];
  openings: WallOpeningSolid[];
}

export interface FixtureSolid {
  fixture: BEFixture;
  center: Pt;
  rotationDeg: number;
  widthIn: number;
  depthIn: number;
  /** Which of its sides stand against a wall, in its own frame (north = the back). */
  against: { north: boolean; south: boolean; east: boolean; west: boolean } | null;
  /** The room's ceiling height, for lights. */
  ceilingIn: number;
}

export interface BathroomModel {
  walls: WallSolid[];
  floors: Pt[][];
  fixtures: FixtureSolid[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  ceilingIn: number;
  looks: BathroomLooks;
}

/** A framed wall with drywall both sides, at least. */
export const WALL_THICKNESS_IN = 4.5;

// ── Looks ──

const TILE_COLORS: Record<string, string> = {
  porcelain: '#d6d1c7',
  ceramic: '#eeebe5',
  natural_stone: '#cbbfad',
  glass_mosaic: '#9fc2cb',
  glass: '#a7c7cf',
  mosaic: '#e6e2db',
  lvt_spc: '#b6987a',
};
const TILE_ROUGHNESS: Record<string, number> = {
  porcelain: 0.45,
  ceramic: 0.3,
  natural_stone: 0.6,
  glass_mosaic: 0.12,
  glass: 0.12,
  mosaic: 0.35,
  lvt_spc: 0.65,
};
const TOP_COLORS: Record<string, string> = {
  cultured_marble: '#f3f1ec',
  quartz: '#efeeea',
  granite: '#77736b',
  marble: '#ebe9e3',
  laminate: '#d7d0c3',
};
const METAL_COLORS: Record<string, string> = {
  chrome: '#c8cdd2',
  brushed_nickel: '#b8b3a8',
  matte_black: '#2a2a2a',
  brass: '#c4a14e',
  mixed: '#c8cdd2',
};

interface TileSpecLike {
  material?: string;
  size?: string;
  pattern?: string;
  customWidth?: number;
  customHeight?: number;
}

/** A tile size as the estimate writes it ("12x24", "3x6_subway", "1x1_mosaic"): long side first. */
export function parseTileSize(size: string | undefined, customWidth?: number, customHeight?: number) {
  if (size === 'custom' && customWidth && customHeight) {
    return { widthIn: Math.max(customWidth, customHeight), heightIn: Math.min(customWidth, customHeight), subway: false };
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/.exec(size || '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { widthIn: Math.max(a, b), heightIn: Math.min(a, b), subway: /subway/.test(size || '') };
}

/** How a tile spec looks, filling what it doesn't say from `fallback`. */
export function tileLook(spec: TileSpecLike | undefined | null, fallback: TileLook): TileLook {
  if (!spec) return fallback;
  const material = spec.material || fallback.material;
  const size = parseTileSize(spec.size, spec.customWidth, spec.customHeight);
  const widthIn = size?.widthIn ?? fallback.widthIn;
  const heightIn = size?.heightIn ?? fallback.heightIn;
  let pattern = spec.pattern || (size ? 'straight' : fallback.pattern);
  // Subway tile goes up in a running bond unless the spec says otherwise
  if (size?.subway && pattern === 'straight') pattern = 'subway';
  const color = material === fallback.material && !spec.material ? fallback.color : (TILE_COLORS[material] ?? fallback.color);
  const grout = material === 'natural_stone' || material === 'porcelain' ? '#a9a398' : '#d3cec5';
  const roughness = TILE_ROUGHNESS[material] ?? fallback.roughness;
  return {
    key: `${material}|${widthIn}x${heightIn}|${pattern}|${color}|${grout}`,
    material, widthIn, heightIn, pattern, color, grout, roughness,
  };
}

const look = (material: string, widthIn: number, heightIn: number, pattern: string, color: string, grout: string): TileLook => ({
  key: `${material}|${widthIn}x${heightIn}|${pattern}|${color}|${grout}`,
  material, widthIn, heightIn, pattern, color, grout, roughness: TILE_ROUGHNESS[material] ?? 0.4,
});

export const DEFAULT_LOOKS: BathroomLooks = {
  paint: '#efebe3',
  floor: look('porcelain', 24, 12, 'straight', '#cfcac0', '#a9a398'),
  floorPlain: '#c9c1b4',
  wallTile: look('ceramic', 6, 3, 'subway', '#f3f1ec', '#d3cec5'),
  showerTile: look('porcelain', 24, 12, 'straight', '#dad5cc', '#a9a398'),
  surroundTile: look('ceramic', 6, 3, 'subway', '#f3f1ec', '#d3cec5'),
  prefab: '#f5f4f0',
  vanityBox: '#f1eee8',
  vanityTop: TOP_COLORS.quartz,
  vanityFloating: false,
  china: '#f7f7f5',
  metal: METAL_COLORS.chrome,
  tubShower: false,
};

// A product's look.material (product library) as the tile looks name it
const PRODUCT_TILE_MATERIALS: Record<string, string> = {
  porcelain: 'porcelain', ceramic: 'ceramic', glass: 'glass_mosaic', vinyl: 'lvt_spc', wood: 'lvt_spc',
  natural_stone: 'natural_stone', marble: 'natural_stone', granite: 'natural_stone', quartzite: 'natural_stone',
};
const LAID_PATTERNS = new Set(['subway', 'herringbone', 'chevron', 'diagonal', 'basketweave']);

const hexColor = (v: unknown): string | undefined =>
  (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

/**
 * A picked tile: its real size and colour, and its surface picture when it
 * has one, laid in the estimate's pattern (or the product's own subway or
 * herringbone when the estimate just says straight).
 */
export function productTileLook(p: BathroomSelection | undefined, specPattern: string | undefined, fallback: TileLook): TileLook | null {
  if (!p) return null;
  const material = PRODUCT_TILE_MATERIALS[String(p.look?.material ?? '')] ?? fallback.material;
  const size = p.tile_width_in && p.tile_length_in ? `${p.tile_width_in}x${p.tile_length_in}` : undefined;
  const own = String(p.look?.pattern ?? '');
  const pattern = (!specPattern || specPattern === 'straight') && LAID_PATTERNS.has(own) ? own : specPattern;
  const base = tileLook({ material, size, pattern }, fallback);
  const color = hexColor(p.look?.color) ?? base.color;
  const swatchFileId = p.swatch_file_id || undefined;
  return {
    ...base,
    color,
    swatchFileId,
    key: `${base.material}|${base.widthIn}x${base.heightIn}|${base.pattern}|${color}|${base.grout}|${swatchFileId ?? ''}`,
  };
}

/** A faucet's metal from its finish as sold ("Matte Black", "Brushed Nickel"…), else its colour. */
function productMetal(p: BathroomSelection | undefined): string | undefined {
  if (!p) return undefined;
  const finish = `${p.finish ?? ''} ${p.title}`.toLowerCase();
  if (/black/.test(finish)) return METAL_COLORS.matte_black;
  if (/nickel|stainless/.test(finish)) return METAL_COLORS.brushed_nickel;
  if (/gold|brass|bronze/.test(finish)) return METAL_COLORS.brass;
  if (/chrome/.test(finish)) return METAL_COLORS.chrome;
  return hexColor(p.look?.color);
}

const FLOOR_TILE_MATERIALS = new Set(['ceramic', 'porcelain', 'natural_stone', 'glass_mosaic', 'mosaic', 'glass']);

/** The looks the estimate's specs and the sketch's tile zones give the bathroom. */
export function bathroomLooks(sketch: BESketchData, estimate?: Record<string, any> | null): BathroomLooks {
  const zoneSpec = (type: string) => sketch.tileZones?.find((z) => z.type === type)?.tileSpec;
  const floorSpec = estimate?.floor_spec || {};
  const walls = estimate?.walls_spec || {};
  const shower = estimate?.shower_spec || {};
  const vanity = estimate?.vanity_spec || {};
  const firstVanity = (Array.isArray(vanity.items) && vanity.items[0]) || vanity;
  // An option's picked products (a restoration has none)
  const picked: Record<string, BathroomSelection> = estimate?.selections || {};
  const showerWallTile = productTileLook(picked.shower_wall_tile, shower.tile_spec?.pattern, DEFAULT_LOOKS.showerTile);

  let floor: TileLook | null;
  if (floorSpec.material === 'lvt_spc') {
    // Plank flooring, staggered
    floor = tileLook({ material: 'lvt_spc', size: floorSpec.size || '7x48', pattern: 'subway' }, DEFAULT_LOOKS.floor!);
  } else if (floorSpec.material && !FLOOR_TILE_MATERIALS.has(floorSpec.material)) {
    floor = null;
  } else {
    floor = tileLook(floorSpec.material ? floorSpec : zoneSpec('floor'), DEFAULT_LOOKS.floor!);
  }
  floor = productTileLook(picked.floor_tile, floorSpec.pattern, floor ?? DEFAULT_LOOKS.floor!) ?? floor;

  return {
    ...DEFAULT_LOOKS,
    floor,
    wallTile: productTileLook(picked.wall_tile, walls.tile_pattern, DEFAULT_LOOKS.wallTile) ?? tileLook(
      walls.tile_material || walls.tile_size || walls.tile_pattern
        ? { material: walls.tile_material, size: walls.tile_size, pattern: walls.tile_pattern }
        : null,
      DEFAULT_LOOKS.wallTile,
    ),
    showerTile: showerWallTile ?? tileLook(shower.tile_spec || zoneSpec('shower_walls'), DEFAULT_LOOKS.showerTile),
    surroundTile: showerWallTile ?? tileLook(zoneSpec('tub_surround'), DEFAULT_LOOKS.surroundTile),
    prefab: hexColor(picked.bathtub?.look?.color) ?? DEFAULT_LOOKS.prefab,
    vanityBox: hexColor(picked.vanity?.look?.color) ?? DEFAULT_LOOKS.vanityBox,
    vanityTop: hexColor(picked.vanity_top?.look?.color)
      ?? TOP_COLORS[String(picked.vanity_top?.look?.material ?? '')]
      ?? TOP_COLORS[firstVanity?.top_material] ?? DEFAULT_LOOKS.vanityTop,
    vanityFloating: (firstVanity?.mounting ?? vanity.mounting) === 'wall_mount',
    china: hexColor(picked.toilet?.look?.color) ?? DEFAULT_LOOKS.china,
    metal: productMetal(picked.bath_faucet) ?? METAL_COLORS[estimate?.accessories_spec?.finish] ?? DEFAULT_LOOKS.metal,
    tubShower: shower.type === 'tub_combo'
      || (!sketch.fixtures.some((f) => f.type === 'shower')
        && sketch.fixtures.some((f) => f.type === 'bathtub' && f.properties.bathtubSubType !== 'freestanding'
          && f.properties.hasSurround !== false && (f.properties.surroundHeight ?? 60) >= 60)),
  };
}

// ── Geometry ──

const toIn = (p: BEPoint, ppf: number): Pt => [(p.x / ppf) * 12, (p.y / ppf) * 12];

function polygonCentroid(points: BEPoint[]): BEPoint {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

/** The unit normal from a wall into its room, or null if it's in none. */
export function wallInward(wall: BEWall, rooms: BERoom[]): Pt | null {
  const room = rooms.find((r) => r.wallIds.includes(wall.id) && r.boundary.length >= 3);
  if (!room) return null;
  const c = polygonCentroid(room.boundary);
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  let n: Pt = [-dy / len, dx / len];
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  if (n[0] * (c.x - mx) + n[1] * (c.y - my) < 0) n = [-n[0], -n[1]];
  return n;
}

const PREFAB_SHOWER_TYPES = new Set(['one_piece', 'multi_piece_kit', 'neo_angle_kit']);

function surroundFinish(fix: BEFixture, estimate?: Record<string, any> | null): 'tile' | 'prefab' {
  if (fix.type === 'shower') {
    const wallMaterial = fix.properties.showerWallMaterial;
    if (wallMaterial && wallMaterial !== 'tile') return 'prefab';
    return PREFAB_SHOWER_TYPES.has(estimate?.shower_spec?.type) ? 'prefab' : 'tile';
  }
  return fix.properties.hasSurround === false ? 'prefab' : 'tile';
}

function wallSolid(
  wall: BEWall,
  sketch: BESketchData,
  view: FinishView,
  estimate?: Record<string, any> | null,
): WallSolid {
  const ppf = sketch.settings.pixelsPerFoot;
  const lengthIn = wallLengthIn(wall, ppf);
  const heightIn = wall.heightInches;
  const clip = (r: FaceRect): FaceRect => ({
    x0: Math.max(0, r.x0), x1: Math.min(lengthIn, r.x1), y0: Math.max(0, r.y0), y1: Math.min(heightIn, r.y1),
  });
  const inward = wallInward(wall, sketch.rooms);
  const a = toIn(wall.start, ppf);
  const b = toIn(wall.end, ppf);
  const along = (p: Pt) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (lengthIn || 1);

  const openings: WallOpeningSolid[] = wallOpeningsOf(wall, sketch.fixtures, ppf).map(({ rect, fixture }) => {
    const r = clip(rect);
    // The plan's door hinges at the left end of its closed panel and swings to the side its symbol is on
    const rad = ((fixture.rotation || 0) * Math.PI) / 180;
    const hwIn = fixture.dimensions.width / 2;
    const hhIn = fixture.dimensions.height / 2;
    const c = toIn(fixture.position, ppf);
    const hinge: Pt = [c[0] + -hwIn * Math.cos(rad) - hhIn * Math.sin(rad), c[1] + -hwIn * Math.sin(rad) + hhIn * Math.cos(rad)];
    const hingeAlong = along(hinge);
    const side = inward ? (c[0] - a[0]) * inward[0] + (c[1] - a[1]) * inward[1] : 1;
    return {
      rect: r,
      kind: fixture.type as 'door' | 'window',
      fixtureId: fixture.id,
      hingeAtStart: Math.abs(hingeAlong - r.x0) <= Math.abs(hingeAlong - r.x1),
      swingsIn: side >= 0,
    };
  });
  const holes = openings.map((o) => o.rect);

  // A prefab surround stays itself, whatever tile is around it
  const covers = wallFixtureCovers(wall, sketch.fixtures, ppf)
    .map((c) => (surroundFinish(c.fixture, estimate) === 'prefab' ? { ...c, tiled: null } : c));
  const regions = wallTileRegions(wall, view === 'today' ? 'existing' : 'new', ppf).map(regionRect);
  // After the work, tile over a whole surround makes the wall one tile there,
  // down behind the tub too (out of sight, and not counted as tile)
  let kept = covers;
  if (view === 'after') {
    const after = surroundsAfterWork(covers, regions);
    kept = after.kept.filter((c) => !after.inTile.some((t) => t.fixture.id === c.fixture.id));
  }
  const surrounds = kept.flatMap(({ rect, fixture }) =>
    subtractRects([clip(rect)], holes).map((piece) => ({ rect: piece, finish: surroundFinish(fixture, estimate), fixtureId: fixture.id })));

  return {
    id: wall.id,
    a,
    b,
    lengthIn,
    heightIn,
    thicknessIn: Math.max(WALL_THICKNESS_IN, (wall.thickness / ppf) * 12),
    inward,
    pieces: subtractRects([{ x0: 0, x1: lengthIn, y0: 0, y1: heightIn }], holes),
    tile: subtractRects(regions, holes.concat(kept.map((c) => clip(c.rect)))),
    surrounds,
    openings,
  };
}

function fixtureSolid(fix: BEFixture, sketch: BESketchData): FixtureSolid {
  const ppf = sketch.settings.pixelsPerFoot;
  const room = sketch.rooms.find((r) => r.id === fix.roomId) ?? sketch.rooms.find((r) => !r.parentRoomId) ?? sketch.rooms[0];
  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  return {
    fixture: fix,
    center: toIn(fix.position, ppf),
    rotationDeg: fix.rotation || 0,
    widthIn: fix.dimensions.width,
    depthIn: fix.dimensions.height,
    against: findFixtureWallSides(fix, room, wPx, hPx),
    ceilingIn: room?.heightInches || 96,
  };
}

export function bathroomModel(
  sketch: BESketchData,
  estimate?: Record<string, any> | null,
  view: FinishView = 'after',
): BathroomModel {
  const ppf = sketch.settings.pixelsPerFoot;
  const walls = sketch.walls.map((w) => wallSolid(w, sketch, view, estimate));
  const floors = sketch.rooms
    .filter((r) => !r.parentRoomId && r.boundary.length >= 3)
    .map((r) => r.boundary.map((p) => toIn(p, ppf)));
  // Doors and windows are drawn in their walls' openings
  const fixtures = sketch.fixtures
    .filter((f) => f.type !== 'door' && f.type !== 'window')
    .map((f) => fixtureSolid(f, sketch));

  const xs: number[] = [];
  const zs: number[] = [];
  walls.forEach((w) => { xs.push(w.a[0], w.b[0]); zs.push(w.a[1], w.b[1]); });
  floors.forEach((f) => f.forEach(([x, z]) => { xs.push(x); zs.push(z); }));
  fixtures.forEach((f) => {
    const rad = (f.rotationDeg * Math.PI) / 180;
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = (lx * f.widthIn) / 2;
      const z = (lz * f.depthIn) / 2;
      xs.push(f.center[0] + x * Math.cos(rad) - z * Math.sin(rad));
      zs.push(f.center[1] + x * Math.sin(rad) + z * Math.cos(rad));
    }
  });
  const bounds = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    : null;
  const ceilingIn = Math.max(96, ...sketch.walls.map((w) => w.heightInches));

  return { walls, floors, fixtures, bounds, ceilingIn, looks: bathroomLooks(sketch, estimate) };
}
