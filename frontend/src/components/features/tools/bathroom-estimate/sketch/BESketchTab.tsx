/**
 * BESketchTab - Bathroom Estimate Sketch main tab component
 *
 * Top-level component rendered inside BathroomEstimateDetail as the Sketch tab.
 * Composes: BESketchToolbar + BESketchCanvas + BESketchSidebar
 *
 * Usage:
 *   <BESketchTab
 *     estimateId="abc-123"
 *     estimateData={formValues}
 *     onSketchChange={handleSketchChange}
 *   />
 */

import React, { useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import { Button, Dropdown, Segmented, message, Spin, Tooltip, Grid, Drawer } from 'antd';
import {
  CheckOutlined,
  CompressOutlined,
  EllipsisOutlined,
  MinusOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { BESketchData, BESketchTool } from '@/types/bathroomSketch';
import { BATHTUB_SURROUND_DEFAULTS, MIRROR_HEIGHT_IN, SHOWER_DOOR_HEIGHT_IN } from '@/types/bathroomSketch';
import { soffitAreas } from './utils/soffit';
import { cabinetsFromSketch, lightsFromSketch, type FixtureRow } from '../fixtureRows';
import { mirrorsFromSketch, type MirrorRow } from '../mirrorRows';
import { findFixtureWallSides } from './utils/beTileZoneGenerator';
import { showerDoorPosition } from './utils/beGeometry';
import { roomWallFinishTotals } from './utils/wallFinish';
import { useBESketchState } from './hooks/useBESketchState';
import BESketchToolbar, { MARK_TOOLS, type BESketchView } from './BESketchToolbar';
import BESketchCanvas from './BESketchCanvas';
import BESketchSidebar from './BESketchSidebar';
import BELayoutPicker from './BELayoutPicker';
import { findSelection, selectionTitle } from './BESketchInspector';
import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import './sketch.css';

// three.js comes with it, so it's only downloaded when the 3D view is opened
const Bathroom3DView = lazy(() => import('./Bathroom3DView'));

const { useBreakpoint } = Grid;

const PANEL_WIDTH = 300;

/** The box around everything drawn, in plan coordinates */
function contentBounds(d: BESketchData): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const ppf = d.settings.pixelsPerFoot;
  d.rooms.forEach((r) => r.boundary.forEach((p) => { xs.push(p.x); ys.push(p.y); }));
  d.walls.forEach((w) => { xs.push(w.start.x, w.end.x); ys.push(w.start.y, w.end.y); });
  d.fixtures.forEach((f) => {
    const hw = (f.dimensions.width / 12) * ppf / 2;
    const hh = (f.dimensions.height / 12) * ppf / 2;
    xs.push(f.position.x - hw, f.position.x + hw);
    ys.push(f.position.y - hh, f.position.y + hh);
  });
  [...d.damageZones, ...(d.drywallRepairZones ?? []), ...(d.insulationZones ?? [])]
    .forEach((z) => z.boundary.forEach((p) => { xs.push(p.x); ys.push(p.y); }));
  if (!xs.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** What the drawing tools do, said while they're on */
function toolHint(tool: BESketchTool, surface: 'wall' | 'ceiling', touch: boolean): string | null {
  switch (tool) {
    case 'room':
      return touch
        ? 'Tap each corner, then the first corner again.'
        : 'Click each corner, double-click to finish. Shift-drag for a rectangle.';
    case 'wall': return 'Drag from one end of the wall to the other.';
    case 'damage_zone': return 'Drag over the damaged area.';
    case 'drywall_repair':
    case 'insulation':
      return surface === 'wall' ? 'Drag along the wall.' : 'Drag over the ceiling area.';
    default: return null;
  }
}

const TOOL_NAMES: Partial<Record<BESketchTool, string>> = {
  room: 'Room',
  wall: 'Wall',
  ...Object.fromEntries(MARK_TOOLS.map((t) => [t.key, t.label])),
};

// ── Props ──

/** Extracted sketch data for syncing sketch → estimate form fields */
export interface SketchFixtureSync {
  // Room dimensions
  length_ft?: number;
  width_ft?: number;
  floor_sf?: number;
  wall_sf?: number;
  /** Paintable wall SF (total wall minus shower/tub/tile wall areas) */
  paint_wall_sf?: number;
  /** Tile wall SF: the walls' tile regions to install */
  tile_wall_sf?: number;
  /** SF of the walls' existing tile regions — needs demo */
  existing_tile_wall_sf?: number;

  // Walls spec sync
  walls_spec?: Record<string, any>;

  // Fixture on the plan or not. The form turns this into Replace or D&R,
  // keeping the person's choice; a mirror starts as D&R, the rest as Replace
  replace_tub?: boolean;
  replace_shower?: boolean;
  replace_vanity?: boolean;
  replace_toilet?: boolean;
  replace_mirror?: boolean;

  /** The room's ceiling height, feet */
  height_ft?: number;

  // Demo flags
  demo_walls?: boolean;
  water_damage?: boolean;
  repair_drywall_walls?: boolean;
  repair_drywall_walls_sf?: number;
  repair_drywall_ceiling?: boolean;
  repair_drywall_ceiling_sf?: number;

  // Specs
  bathtub_spec?: Record<string, any>;
  shower_spec?: Record<string, any>;
  vanity_spec?: Record<string, any>;
  toilet_spec?: Record<string, any>;

  // Electrical
  electrical_spec?: Record<string, any>;
  /** The lights drawn on the plan, by kind (merged into electrical_spec.lights by the page) */
  sketch_lights?: FixtureRow[];
  /** The cabinets drawn on the plan, by kind (merged into accessories_spec.cabinets by the page) */
  sketch_cabinets?: FixtureRow[];
  /** The mirrors drawn on the plan, by width (merged into accessories_spec.mirrors by the page) */
  sketch_mirrors?: MirrorRow[];

  // Drywall repair (from sketch drywall zones)
  hidden_costs?: Record<string, any>;

  // Insulation (from sketch insulation zones)
  demo_insulation_walls?: boolean;
  demo_insulation_walls_sf?: number;
  demo_insulation_ceiling?: boolean;
  demo_insulation_ceiling_sf?: number;
  install_insulation_walls?: boolean;
  install_insulation_walls_sf?: number;
  install_insulation_ceiling?: boolean;
  install_insulation_ceiling_sf?: number;
}

export interface BESketchTabProps {
  /** Bathroom estimate ID for persistence */
  estimateId: string;
  /** Current estimate form data (for syncing dimensions, fixtures, etc.) */
  estimateData?: Record<string, any>;
  /** Callback when sketch data changes */
  onSketchChange?: (data: BESketchData) => void;
  /** Callback to sync fixture data → estimate form fields */
  onFixtureSync?: (sync: SketchFixtureSync) => void;
  /** Initial sketch data (loaded from backend) */
  initialSketchData?: BESketchData;
  /** Whether this tab is currently active */
  isActive?: boolean;
  /** For an option: the bathroom as it is (restoration or current layout), drawn faintly under the plan */
  baselineSketch?: BESketchData | null;
  baselineName?: string;
  /** Bumped when the page changed the saved sketch itself (a picked product resized a fixture): load it again */
  reloadKey?: number;
}

// ── Component ──

/** Build sync payload from sketch rooms + fixtures → estimate form fields */
export function buildSketchSync(data: BESketchData): SketchFixtureSync {
  const { fixtures, rooms, walls } = data;
  const ppf = data.settings.pixelsPerFoot;
  const sync: SketchFixtureSync = {};
  // By tub or shower: the SF of its surround the walls' tile runs over, priced as wall tile
  let surroundInTile: Record<string, number> = {};

  // ── Room dimensions (all rooms combined) ──
  const bathroom = rooms.find(r => r.roomType === 'bathroom') || rooms[0];
  if (bathroom && bathroom.boundary.length >= 3) {
    // Primary bathroom bounding box → length/width fields
    const xs = bathroom.boundary.map(p => p.x);
    const ys = bathroom.boundary.map(p => p.y);
    const widthPx = Math.max(...xs) - Math.min(...xs);
    const depthPx = Math.max(...ys) - Math.min(...ys);
    const widthFt = Math.round((widthPx / ppf) * 4) / 4;
    const depthFt = Math.round((depthPx / ppf) * 4) / 4;
    sync.length_ft = widthFt;
    sync.width_ft = depthFt;

    // Floor SF: the whole room (primary + additional rooms). The calculator
    // takes the tub, shower and vanity footprints off for the tile and its
    // underlayment, and uses the whole room for the ceiling and paint prep;
    // taking them off here too took them off twice.
    let totalFloorSF = widthFt * depthFt;

    // Wall SF: primary room + additional rooms, minus door/window openings
    const heightFt = (bathroom.heightInches || 96) / 12;
    sync.height_ft = Math.round(heightFt * 100) / 100;
    const perimeterFt = 2 * (widthFt + depthFt);
    const grossWallSF = perimeterFt * heightFt;

    // Deduct door/window openings from wall area
    let doorWindowDeductSF = 0;
    for (const fix of fixtures) {
      if (fix.type !== 'door' && fix.type !== 'window') continue;
      const fW = fix.dimensions.width / 12;  // ft
      const fH = fix.dimensions.height / 12; // ft
      doorWindowDeductSF += fW * fH;
    }
    let totalWallSF = Math.max(0, grossWallSF - doorWindowDeductSF);

    // Add additional rooms (non-sub-rooms)
    for (const rm of rooms) {
      if (rm.id === bathroom.id || rm.parentRoomId) continue;
      totalFloorSF += rm.netFloorAreaSF || rm.floorAreaSF || 0;
      totalWallSF += rm.wallAreaSF || 0;
    }

    sync.floor_sf = Math.round(totalFloorSF * 10) / 10;
    sync.wall_sf = Math.round(totalWallSF * 10) / 10;

    // ── Per-wall finish: calculate paint SF vs tile SF ──
    // Walls with finish='tile' → tile_wall_sf, rest → paint_wall_sf
    // Both exclude areas covered by shower/bathtub fixtures
    let coveredWallSF = 0;

    // Shower: walls touching bathroom walls
    const showerFix = fixtures.find(f => f.type === 'shower');
    if (showerFix) {
      const sp = showerFix.properties;
      const sLayout = sp.showerLayout ?? 'alcove';
      const sTileH = (sp.showerTileHeight ?? 96) / 12;
      const sW = showerFix.dimensions.width / 12;
      const sD = showerFix.dimensions.height / 12;
      if (sLayout === 'alcove') {
        coveredWallSF += (sW + 2 * sD) * sTileH;
      } else {
        coveredWallSF += (sW + sD) * sTileH;
      }
    }

    // Bathtub: walls covered by surround (skip freestanding)
    const tubFix = fixtures.find(f => f.type === 'bathtub');
    if (tubFix) {
      const tp = tubFix.properties;
      if ((tp.bathtubSubType ?? 'standard_alcove') !== 'freestanding') {
        const surrWalls = tp.surroundWallCount ?? 3;
        const surrH = (tp.surroundHeight ?? 60) / 12;
        const tW = tubFix.dimensions.width / 12;
        const tD = tubFix.dimensions.height / 12;
        let surrLen = 0;
        if (surrWalls >= 1) surrLen += tW;
        if (surrWalls >= 2) surrLen += tD;
        if (surrWalls >= 3) surrLen += tD;
        coveredWallSF += surrLen * surrH;
        coveredWallSF += surrLen * ((tp.deckHeight ?? 18) / 12);
      }
    }

    // Available wall SF (after shower/tub deduction)
    const availableWallSF = Math.max(0, grossWallSF - coveredWallSF);

    let tileWallSF = 0;
    let paintWallSF = 0;
    // Tile on the walls today: it comes off before any new finish goes on
    let existingTileWallSF = 0;
    const roomWalls = walls.filter(w => bathroom.wallIds.includes(w.id));

    if (roomWalls.length > 0) {
      // Walls exist: each wall's tile regions (part of a wall can be tile and
      // the rest drywall), less its doors and windows and the part behind
      // a tub or shower surround, which is tiled with the fixture — unless
      // the wall's tile runs over the whole surround, which is then wall tile.
      const totals = roomWallFinishTotals(roomWalls, fixtures, ppf);
      tileWallSF = totals.tileSF;
      paintWallSF = totals.paintSF;
      existingTileWallSF = totals.existingTileSF;
      surroundInTile = totals.surroundInTile;
    } else {
      // No explicit walls: all paint by default
      paintWallSF = Math.round(availableWallSF * 10) / 10;
    }

    sync.paint_wall_sf = paintWallSF;
    sync.tile_wall_sf = tileWallSF;
    sync.existing_tile_wall_sf = existingTileWallSF;

    // Determine wall_finish mode
    const hasAnyTile = tileWallSF > 0;
    const hasAnyPaint = paintWallSF > 0;
    const wallsSpecBase: Record<string, any> = {
      ...(existingTileWallSF > 0 ? { existing_tile_wall_sf: existingTileWallSF } : {}),
      // Always sent, so a soffit taken off the plan comes off the estimate
      ...soffitAreas(fixtures, bathroom, ppf),
    };
    if (hasAnyTile && hasAnyPaint) {
      sync.walls_spec = { ...wallsSpecBase, wall_finish: 'paint_and_tile', paint_wall_sf: paintWallSF, tile_wall_sf: tileWallSF };
    } else if (hasAnyTile) {
      sync.walls_spec = { ...wallsSpecBase, wall_finish: 'tile', tile_wall_sf: tileWallSF };
    } else {
      sync.walls_spec = { ...wallsSpecBase, wall_finish: 'paint' };
    }
  }

  // ── Fixture flags & specs ──
  const bathtub = fixtures.find(f => f.type === 'bathtub');
  const shower = fixtures.find(f => f.type === 'shower');
  const vanities = fixtures.filter(f => f.type === 'vanity');
  const toilet = fixtures.find(f => f.type === 'toilet');
  const mirrors = fixtures.filter(f => f.type === 'mirror');

  sync.replace_tub = !!bathtub;
  sync.replace_shower = !!shower;
  sync.replace_vanity = vanities.length > 0;
  sync.replace_toilet = !!toilet;
  if (toilet) {
    sync.toilet_spec = { type: 'two_piece_standard' };
  }
  sync.replace_mirror = mirrors.length > 0;
  // Electrical spec defaults (GFCI, exhaust fan); the lights go by kind, each one on the plan counted
  sync.electrical_spec = {
    gfci_count: 1,
    exhaust_fan_cfm: 80,
    exhaust_fan_switch: 'standard',
  };
  sync.sketch_lights = lightsFromSketch(fixtures);
  sync.sketch_cabinets = cabinetsFromSketch(fixtures);
  sync.sketch_mirrors = mirrorsFromSketch(fixtures);
  // demo_floor is a user decision — don't auto-set from sketch
  sync.demo_walls = !!(shower || bathtub);

  if (bathtub) {
    const p = bathtub.properties;
    const subType = p.bathtubSubType ?? 'standard_alcove';
    const typeMap: Record<string, string> = {
      standard_alcove: 'alcove', drop_in: 'drop_in',
      corner_garden: 'corner', freestanding: 'freestanding',
    };
    // Calculate surround tile SF
    const tubW = bathtub.dimensions.width;
    const tubD = bathtub.dimensions.height;
    const surrWallCount = p.surroundWallCount ?? 3;
    const surrHeight = p.surroundHeight ?? 60;
    let surrPerimeter = 0;
    if (surrWallCount >= 1) surrPerimeter += tubW;
    if (surrWallCount >= 2) surrPerimeter += tubD;
    if (surrWallCount >= 3) surrPerimeter += tubD;
    const surroundSF = Math.round((surrPerimeter * surrHeight) / 144 * 100) / 100;

    // Calculate deck tile SF. If the user hasn't explicitly set a side
    // count, auto-detect which sides are actually against a room wall
    // (same logic used to render the deck zone on canvas) so the SF sent
    // to the estimate matches what's drawn — a tub flush to one wall gets
    // deck tile only on its exposed sides, not a fixed back/left/right guess.
    const tubDefaults = BATHTUB_SURROUND_DEFAULTS[subType];
    const deckW = p.deckWidth ?? tubDefaults.deckWidth;
    const tubWPx = (tubW / 12) * ppf;
    const tubDPx = (tubD / 12) * ppf;
    const autoWalls = p.deckTileSides == null
      ? findFixtureWallSides(bathtub, bathroom, tubWPx, tubDPx)
      : null;
    const deckSides = p.deckTileSides
      ?? (autoWalls ? (4 - [autoWalls.north, autoWalls.south, autoWalls.east, autoWalls.west].filter(Boolean).length) : (tubDefaults.deckTileSides ?? 2));
    let deckLen = 0;
    if (autoWalls) {
      if (!autoWalls.north) deckLen += tubW;
      if (!autoWalls.south) deckLen += tubW;
      if (!autoWalls.east) deckLen += tubD;
      if (!autoWalls.west) deckLen += tubD;
    } else {
      if (deckSides >= 1) deckLen += tubW;
      if (deckSides >= 2) deckLen += tubD;
      if (deckSides >= 3) deckLen += tubD;
      if (deckSides >= 4) deckLen += tubW;
    }
    const cornerCount = Math.max(0, deckSides - 1);
    const deckSF = Math.round((deckLen * deckW + cornerCount * deckW * deckW) / 144 * 100) / 100;

    // Calculate front panel SF
    const deckH = p.deckHeight ?? 0;
    const frontPanelSF = p.hasFrontPanel && deckH > 0
      ? Math.round((deckLen * deckH) / 144 * 100) / 100
      : 0;

    sync.bathtub_spec = {
      type: typeMap[subType] ?? 'alcove',
      material: 'acrylic',
      surround_tile: !!p.hasSurround,
      surround_tile_sf: p.hasSurround ? surroundSF : 0,
      has_faucet: p.hasFaucet ?? true,
      tub_length_in: Math.max(tubW, tubD),
      tub_depth_in: Math.min(tubW, tubD),
      surround_height_in: surrHeight,
      surround_wall_count: surrWallCount,
      tiled_with_wall_sf: surroundInTile[bathtub.id] ?? 0,
      deck_tile: deckW > 0 && deckSides > 0,
      deck_tile_sf: deckSF,
      deck_width_in: deckW,
      deck_tile_sides: deckSides,
      front_panel_tile: !!p.hasFrontPanel,
      front_panel_sf: frontPanelSF,
      deck_height_in: deckH,
    };
  }

  if (shower) {
    const p = shower.properties;
    sync.shower_spec = {
      type: (p.showerWallCount ?? 3) > 0 ? 'custom_tile' : 'one_piece',
      width_in: shower.dimensions.width,
      depth_in: shower.dimensions.height,
      tile_height_in: p.showerTileHeight ?? 96,
      niches: p.nicheCount ?? 0,
      bench: !!p.hasBench,
      bench_position: p.benchPosition ?? 'left',
      bench_length: p.benchLength ?? 36,
      curb_height: p.curbHeight ?? 4,
      door_type: p.showerDoorType ?? 'none',
      door_width_in: p.showerDoorWidth ?? Math.round(shower.dimensions.width * 0.5),
      door_height_in: p.showerDoorHeight ?? SHOWER_DOOR_HEIGHT_IN,
      door_position: showerDoorPosition(p),
      fixed_panel_config: p.fixedPanelConfig ?? 'none',
      layout: p.showerLayout ?? 'alcove',
      wall_material: p.showerWallMaterial ?? 'tile',
      tiled_with_wall_sf: surroundInTile[shower.id] ?? 0,
    };
  }

  if (vanities.length > 0) {
    sync.vanity_spec = {
      items: vanities.map((v, i) => {
        const mirrorForVanity = mirrors[i] ?? mirrors[0];
        const sinkType = v.properties.vanitySubType ?? 'cabinet';
        return {
          sink_type: sinkType,
          width: v.dimensions.width,
          sinks: v.properties.sinkCount ?? 1,
          mirror_width: mirrorForVanity ? mirrorForVanity.dimensions.width : undefined,
          mirror_height: mirrorForVanity ? (mirrorForVanity.properties.mirrorHeight ?? MIRROR_HEIGHT_IN) : undefined,
          has_mirror: !!mirrorForVanity,
        };
      }),
    };
  } else if (mirrors.length > 0) {
    // Mirrors without vanity: still sync mirror replacement
    sync.vanity_spec = {
      items: mirrors.map(m => ({
        mirror_width: m.dimensions.width,
        mirror_height: m.properties.mirrorHeight ?? MIRROR_HEIGHT_IN,
        has_mirror: true,
      })),
    };
  }

  // ── Drywall repair zones → hidden_costs + paint sync ──
  const dwZones = data.drywallRepairZones ?? [];
  if (dwZones.length > 0) {
    const totalDwSF = dwZones.reduce((sum, z) => sum + z.areaSF, 0);
    const hasFullRepair = dwZones.some(z => z.includeGluing);
    sync.hidden_costs = {
      drywall_patch: true,
      drywall_patch_sf: Math.round(totalDwSF * 10) / 10,
      drywall_patch_full: hasFullRepair,
    };

    // Seal & prime: only demo'd (repaired) areas
    const wallDwSF = dwZones.filter(z => z.surface === 'wall').reduce((s, z) => s + z.areaSF, 0);
    const ceilDwSF = dwZones.filter(z => z.surface === 'ceiling').reduce((s, z) => s + z.areaSF, 0);
    const hasWallDw = wallDwSF > 0;
    const hasCeilDw = ceilDwSF > 0;

    // Auto-set demo scope flags: water damage repair + drywall repair
    sync.water_damage = true;
    if (hasWallDw) {
      sync.repair_drywall_walls = true;
      sync.repair_drywall_walls_sf = Math.round(wallDwSF * 10) / 10;
    }
    if (hasCeilDw) {
      sync.repair_drywall_ceiling = true;
      sync.repair_drywall_ceiling_sf = Math.round(ceilDwSF * 10) / 10;
    }

    // Full paint: if ANY wall/ceiling drywall repair, paint entire area minus tub/shower

    // Calculate paintable wall SF: total wall SF minus bathtub/shower wall areas
    let fullPaintWallSF = 0;
    if (hasWallDw && bathroom) {
      let deductSF = 0;
      // Deduct bathtub surround area
      const bathtubFix = fixtures.find(f => f.type === 'bathtub');
      if (bathtubFix) {
        const wCount = bathtubFix.properties.surroundWallCount ?? 3;
        const sHeight = bathtubFix.properties.surroundHeight ?? 60;
        const tubW = bathtubFix.dimensions.width;
        const tubD = bathtubFix.dimensions.height;
        let perim = 0;
        if (wCount >= 1) perim += tubW;
        if (wCount >= 2) perim += tubD;
        if (wCount >= 3) perim += tubD;
        deductSF += (perim * sHeight) / 144;
      }
      // Deduct shower wall area
      const showerFix = fixtures.find(f => f.type === 'shower');
      if (showerFix) {
        const sWalls = showerFix.properties.showerWallCount ?? 3;
        const sTileH = showerFix.properties.showerTileHeight ?? 96;
        const sW = showerFix.dimensions.width;
        const sD = showerFix.dimensions.height;
        let perim = 0;
        if (sWalls >= 1) perim += sW;
        if (sWalls >= 2) perim += sD;
        if (sWalls >= 3) perim += sD;
        deductSF += (perim * sTileH) / 144;
      }
      fullPaintWallSF = Math.max(0, Math.round((bathroom.wallAreaSF - deductSF) * 10) / 10);
    }

    // Ceiling: use floor SF as ceiling area
    const fullPaintCeilSF = hasCeilDw && bathroom ? bathroom.floorAreaSF : 0;

    // Merge paint data into walls_spec
    const existingWallsSpec = sync.walls_spec ?? {};
    sync.walls_spec = {
      ...existingWallsSpec,
      paint_walls: hasWallDw,
      // A ceiling repair needs the ceiling painted; otherwise the Paint Ceiling
      // box is the person's choice, which a sketch sync must not undo
      ...(hasCeilDw ? { paint_ceiling: true } : {}),
      paint_grade: existingWallsSpec.paint_grade ?? 'mid',
      seal_prime_wall_sf: Math.round(wallDwSF * 10) / 10,
      seal_prime_ceiling_sf: Math.round(ceilDwSF * 10) / 10,
      full_paint_wall_sf: fullPaintWallSF,
      full_paint_ceiling_sf: Math.round(fullPaintCeilSF * 10) / 10,
    };
  }

  // ── Insulation zones → demo & install sync ──
  const insZones = data.insulationZones ?? [];
  if (insZones.length > 0) {
    const wallInsSF = insZones.filter(z => z.surface === 'wall').reduce((s, z) => s + z.areaSF, 0);
    const ceilInsSF = insZones.filter(z => z.surface === 'ceiling').reduce((s, z) => s + z.areaSF, 0);
    const demoWallInsSF = insZones.filter(z => z.surface === 'wall' && z.needsDemo).reduce((s, z) => s + z.areaSF, 0);
    const demoCeilInsSF = insZones.filter(z => z.surface === 'ceiling' && z.needsDemo).reduce((s, z) => s + z.areaSF, 0);

    // Demo flags
    if (demoWallInsSF > 0) {
      sync.demo_insulation_walls = true;
      sync.demo_insulation_walls_sf = Math.round(demoWallInsSF * 10) / 10;
    }
    if (demoCeilInsSF > 0) {
      sync.demo_insulation_ceiling = true;
      sync.demo_insulation_ceiling_sf = Math.round(demoCeilInsSF * 10) / 10;
    }

    // Install flags
    if (wallInsSF > 0) {
      sync.install_insulation_walls = true;
      sync.install_insulation_walls_sf = Math.round(wallInsSF * 10) / 10;
    }
    if (ceilInsSF > 0) {
      sync.install_insulation_ceiling = true;
      sync.install_insulation_ceiling_sf = Math.round(ceilInsSF * 10) / 10;
    }

    // Merge insulation info into walls_spec
    const existingWallsSpec = sync.walls_spec ?? {};
    const primaryType = insZones[0]?.insulationType ?? 'fiberglass_batt';
    const primaryRValue = insZones[0]?.rValue ?? 13;
    sync.walls_spec = {
      ...existingWallsSpec,
      insulation_walls: wallInsSF > 0,
      insulation_walls_sf: Math.round(wallInsSF * 10) / 10,
      insulation_ceiling: ceilInsSF > 0,
      insulation_ceiling_sf: Math.round(ceilInsSF * 10) / 10,
      insulation_type: primaryType,
      insulation_r_value: primaryRValue,
    };
  }

  return sync;
}

const BESketchTab: React.FC<BESketchTabProps> = ({
  estimateId,
  estimateData,
  onSketchChange,
  onFixtureSync,
  initialSketchData,
  isActive = false,
  baselineSketch,
  baselineName,
  reloadKey = 0,
}) => {
  const api = useBESketchState();
  const lastLoadedRef = useRef<string | null>(null);

  // Load sketch_data when estimate data arrives or changes
  useEffect(() => {
    if (!initialSketchData) return;
    // Compare by a stable signature to avoid re-loading our own saves
    const sig = JSON.stringify({
      r: initialSketchData.rooms?.length ?? 0,
      f: initialSketchData.fixtures?.length ?? 0,
      w: initialSketchData.walls?.length ?? 0,
      v: initialSketchData.version,
      k: reloadKey,
    });
    if (sig !== lastLoadedRef.current) {
      lastLoadedRef.current = sig;
      api.loadSketch(initialSketchData);
    }
  }, [initialSketchData, api, reloadKey]);

  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<BESketchView>('plan');
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const stageRef = useRef<any>(null); // Konva.Stage ref passed to canvas
  // The canvas has been measured, so a fit uses its real size
  const measuredRef = useRef(false);
  const fittedRef = useRef(false);

  const data = api.data;
  const hasContent = data.rooms.length > 0 || data.walls.length > 0 || data.fixtures.length > 0;
  const selection = findSelection(data, api.selectedId);

  // ── Zoom controls ──
  const handleZoom = useCallback((direction: 'in' | 'out' | 'fit') => {
    const stage = stageRef.current;
    if (!stage) return;
    if (direction === 'fit') {
      // Everything drawn, as large as the canvas allows
      const b = contentBounds(data);
      if (!b) {
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        setZoomLevel(1);
      } else {
        const pad = 56;
        const scale = Math.min(3, Math.max(0.2, Math.min(
          (canvasSize.width - pad * 2) / Math.max(1, b.maxX - b.minX),
          (canvasSize.height - pad * 2) / Math.max(1, b.maxY - b.minY),
        )));
        stage.scale({ x: scale, y: scale });
        stage.position({
          x: canvasSize.width / 2 - ((b.minX + b.maxX) / 2) * scale,
          y: canvasSize.height / 2 - ((b.minY + b.maxY) / 2) * scale,
        });
        setZoomLevel(scale);
      }
    } else {
      const scaleBy = 1.25;
      const oldScale = stage.scaleX();
      const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
      const mousePointTo = {
        x: (center.x - stage.x()) / oldScale,
        y: (center.y - stage.y()) / oldScale,
      };
      const newScale = direction === 'in'
        ? Math.min(5, oldScale * scaleBy)
        : Math.max(0.2, oldScale / scaleBy);
      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: center.x - mousePointTo.x * newScale,
        y: center.y - mousePointTo.y * newScale,
      });
      setZoomLevel(newScale);
    }
    stage.batchDraw();
  }, [canvasSize, data]);

  // The first time the plan is shown with something on it, fit it to the view
  useEffect(() => {
    if (!isActive || view !== 'plan' || !hasContent || fittedRef.current || !measuredRef.current) return;
    const raf = requestAnimationFrame(() => {
      fittedRef.current = true;
      handleZoom('fit');
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, view, hasContent, canvasSize, handleZoom]);

  // Moves the drawing itself (not the view) to the middle of the canvas, so
  // nothing sits off the edge where the PDF's picture of the plan would cut it
  const movePlanToMiddle = useCallback(() => {
    const b = contentBounds(data);
    if (!b) return;
    const dx = Math.round(canvasSize.width / 2 - (b.minX + b.maxX) / 2);
    const dy = Math.round(canvasSize.height / 2 - (b.minY + b.maxY) / 2);
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) api.moveAll(dx, dy);
    const stage = stageRef.current;
    if (stage) {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.batchDraw();
      setZoomLevel(1);
    }
  }, [api, canvasSize, data]);

  // ── Expose sketch capture for PDF export ──
  useEffect(() => {
    (window as any).__beSketchCapture = () => {
      const stage = stageRef.current;
      if (!stage) return undefined;
      const d = api.data;
      if (!d.rooms.length && !d.fixtures.length && !d.walls.length) return undefined;
      try {
        // Compute content bounding box from data
        const allX: number[] = [];
        const allY: number[] = [];
        const ppf = d.settings.pixelsPerFoot;
        d.rooms.forEach(r => r.boundary.forEach(p => { allX.push(p.x); allY.push(p.y); }));
        d.walls.forEach(w => { allX.push(w.start.x, w.end.x); allY.push(w.start.y, w.end.y); });
        d.fixtures.forEach(f => {
          const hw = (f.dimensions.width / 12) * ppf / 2;
          const hh = (f.dimensions.height / 12) * ppf / 2;
          allX.push(f.position.x - hw, f.position.x + hw);
          allY.push(f.position.y - hh, f.position.y + hh);
        });
        // Include tile zones and damage zones in bounding box
        (d.tileZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
        (d.damageZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
        if (!allX.length) return undefined;
        const pad = 40;
        // Not clamped at 0: the plan can be drawn left of or above the
        // canvas origin, and the capture redraws each layer, so it's there too
        const minX = Math.min(...allX) - pad;
        const minY = Math.min(...allY) - pad;
        const maxX = Math.max(...allX) + pad;
        const maxY = Math.max(...allY) + pad;
        const cropW = maxX - minX;
        const cropH = maxY - minY;

        // Save current state
        const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
        const oldPos = { x: stage.x(), y: stage.y() };
        const oldW = stage.width();
        const oldH = stage.height();

        // Expand stage to cover all content
        const needW = Math.max(oldW, maxX + pad);
        const needH = Math.max(oldH, maxY + pad);
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.width(needW);
        stage.height(needH);

        // Hide the grid and the dimension tags. By name: with the grid off,
        // the first layer is the rooms, which the picture needs.
        const hiddenLayers: any[] = [];
        stage.getLayers().forEach((layer: any) => {
          if ((layer.name() === 'grid' || layer.name() === 'dimensions') && layer.visible()) {
            layer.visible(false);
            hiddenLayers.push(layer);
          }
        });
        const overlays = document.querySelectorAll<HTMLElement>('[data-sketch-overlay]');
        overlays.forEach(el => { el.style.display = 'none'; });

        // Synchronous full redraw at new size
        stage.draw();

        // Capture content region
        const dataUrl = stage.toDataURL({
          pixelRatio: 2,
          x: minX,
          y: minY,
          width: cropW,
          height: cropH,
        });
        console.log('[SketchCapture]', { minX, minY, cropW, cropH, needW, needH, oldW, oldH });

        // Restore everything
        stage.width(oldW);
        stage.height(oldH);
        stage.scale(oldScale);
        stage.position(oldPos);
        hiddenLayers.forEach(l => l.visible(true));
        overlays.forEach(el => { el.style.display = ''; });
        stage.draw();
        return dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        return undefined;
      }
    };
    return () => { delete (window as any).__beSketchCapture; };
  }, [api.data]);

  // ── Resize observer ──
  useEffect(() => {
    if (!containerRef.current || !isActive) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const sidebarW = isMobile || sidebarCollapsed ? 0 : PANEL_WIDTH;
      measuredRef.current = true;
      setCanvasSize({
        width: Math.max(200, Math.floor(rect.width - sidebarW)),
        height: Math.max(200, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isActive, sidebarCollapsed, isMobile]);

  // ── Notify parent on changes ──
  useEffect(() => {
    if (api.isDirty && onSketchChange) {
      onSketchChange(api.data);
    }
  }, [api.data, api.isDirty, onSketchChange]);

  // ── Sync sketch (rooms + fixtures) → estimate form fields ──
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!onFixtureSync) return;
    // On edit: sync when sketch is dirty (user changed something)
    // On load: sync once when sketch has fixtures (e.g. saved from another env)
    if (api.isDirty) {
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    } else if (!initialSyncDone.current && api.data.fixtures.length > 0) {
      initialSyncDone.current = true;
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    }
    // Walls too: their tile regions set the tile, paint and demo areas
  }, [api.data.fixtures, api.data.rooms, api.data.walls, api.isDirty, onFixtureSync]);

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    try {
      await bathroomEstimateService.update(estimateId, {
        sketch_data: api.data as any,
      });
      api.setIsDirty(false);
      message.success('Sketch saved');
    } catch (err) {
      message.error('Failed to save sketch');
      console.error('Sketch save error:', err);
    }
  }, [api, estimateId]);

  // Ctrl+S saves the sketch while its tab is open
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (api.isDirty) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, api.isDirty, handleSave]);

  const surface = api.activeTool === 'insulation' ? api.insulationSurface : api.drywallSurface;
  const setSurface = api.activeTool === 'insulation' ? api.setInsulationSurface : api.setDrywallSurface;
  const hint = toolHint(api.activeTool, surface, isMobile);
  const baselineDrawn = !!baselineSketch && (baselineSketch.rooms?.length ?? 0) > 0;
  const showEmpty = view === 'plan' && !hasContent && !baselineDrawn && api.activeTool === 'select';

  return (
    <div className="bes-root">
      <BESketchToolbar
        api={api}
        view={view}
        onViewChange={setView}
        onSave={handleSave}
        panel={isMobile ? undefined : { open: !sidebarCollapsed, onToggle: () => setSidebarCollapsed((c) => !c) }}
      />

      <div ref={containerRef} className="bes-main">
        {/* The plan stays mounted under the 3D view, so its zoom and the PDF's capture of it carry on */}
        <div className="bes-stage" style={{ display: view === 'plan' ? 'block' : 'none' }}>
          <BESketchCanvas
            api={api} width={canvasSize.width} height={canvasSize.height} stageRef={stageRef} onZoomChange={setZoomLevel}
            zoom={zoomLevel} baseline={baselineSketch} baselineName={baselineName}
          />

          {hint && (
            <div className="bes-hint" role="status">
              <span className="bes-hint-tool">{TOOL_NAMES[api.activeTool]}</span>
              {(api.activeTool === 'drywall_repair' || api.activeTool === 'insulation') && (
                <Segmented
                  size="small"
                  value={surface}
                  onChange={(v) => setSurface(v as 'wall' | 'ceiling')}
                  options={[
                    { value: 'wall', label: 'Wall' },
                    { value: 'ceiling', label: 'Ceiling' },
                  ]}
                  aria-label="Wall or ceiling"
                />
              )}
              <span className="bes-hint-text">{hint}</span>
              <Button type="text" size="small" onClick={() => api.setActiveTool('select')}>
                Done
              </Button>
            </div>
          )}

          {showEmpty && (
            <div className="bes-empty">
              <div className="bes-empty-title">Draw the bathroom</div>
              <p className="bes-empty-text">
                Start from a common layout and adjust it, or draw the room corner by corner.
              </p>
              <div className="bes-empty-actions">
                <BELayoutPicker api={api}>
                  <Button type="primary">Start from a layout</Button>
                </BELayoutPicker>
                <Button onClick={() => api.setActiveTool('room')}>Draw the room</Button>
              </div>
            </div>
          )}

          <div className="bes-view" role="group" aria-label="Zoom and view">
            <Tooltip title="Zoom out" mouseEnterDelay={0.6}>
              <Button type="text" icon={<MinusOutlined />} onClick={() => handleZoom('out')} aria-label="Zoom out" />
            </Tooltip>
            <span className="bes-zoom">{Math.round(zoomLevel * 100)}%</span>
            <Tooltip title="Zoom in" mouseEnterDelay={0.6}>
              <Button type="text" icon={<PlusOutlined />} onClick={() => handleZoom('in')} aria-label="Zoom in" />
            </Tooltip>
            <Tooltip title="Fit the plan" mouseEnterDelay={0.6}>
              <Button type="text" icon={<CompressOutlined />} onClick={() => handleZoom('fit')} aria-label="Fit the plan" />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              placement="topRight"
              menu={{
                items: [
                  {
                    key: 'grid',
                    label: 'Grid',
                    icon: <CheckOutlined style={{ visibility: data.settings.showGrid ? 'visible' : 'hidden' }} />,
                  },
                  {
                    key: 'dimensions',
                    label: 'Dimensions',
                    icon: <CheckOutlined style={{ visibility: data.settings.showDimensions ? 'visible' : 'hidden' }} />,
                  },
                  { type: 'divider' },
                  { key: 'middle', label: 'Move the plan to the middle', disabled: !hasContent },
                ],
                onClick: ({ key }) => {
                  if (key === 'grid') api.updateSettings({ showGrid: !data.settings.showGrid });
                  else if (key === 'dimensions') api.updateSettings({ showDimensions: !data.settings.showDimensions });
                  else if (key === 'middle') movePlanToMiddle();
                },
              }}
            >
              <Button type="text" icon={<EllipsisOutlined />} aria-label="View settings" />
            </Dropdown>
          </div>

          {isMobile && (
            <Button className="bes-sheet-open" onClick={() => setDrawerOpen(true)}>
              {selection ? `Edit ${selectionTitle(selection).toLowerCase()}` : 'Add & takeoff'}
            </Button>
          )}
        </div>
        {view === '3d' && (
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <Suspense fallback={<div style={{ height: canvasSize.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>}>
              <Bathroom3DView
                sketch={api.data}
                estimate={estimateData}
                height={canvasSize.height}
                selectedId={api.selectedId}
                onSelect={api.setSelectedId}
              />
            </Suspense>
          </div>
        )}

        {/* Desktop: the panel beside the canvas */}
        {!isMobile && !sidebarCollapsed && (
          <BESketchSidebar api={api} width={PANEL_WIDTH} />
        )}
      </div>

      {/* Phones: the same panel as a sheet */}
      {isMobile && (
        <Drawer
          title="Plan"
          placement="bottom"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          height="70vh"
          styles={{ body: { padding: 0 } }}
        >
          <BESketchSidebar api={api} width="100%" sheet />
        </Drawer>
      )}
    </div>
  );
};

export default BESketchTab;
