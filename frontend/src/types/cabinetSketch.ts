/**
 * Cabinet Estimate Sketch types.
 *
 * A small, cabinet-specific analog of types/wmSketch.ts — walls + placed
 * cabinet shapes only. No demolition/equipment/containment/room concepts;
 * a cabinet "room" is just whatever the drawn walls visually enclose.
 */

import type { CabinetLocation, CabType, DoorPattern } from '@/types/cabinetEstimate';

export interface CabinetSketchWall {
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  thickness: number;
  color: string;
  length_ft: number;
}

export interface CabinetSketchCabinet {
  id: string;
  /** Catalog code, e.g. "B30" — matches CABINET_PRESETS keys in CabinetBoxEditor.tsx */
  preset_code: string;
  cab_type: CabType;
  /**
   * Plan position, in canvas pixels. (x, y) is the back-left corner — the
   * back edge is local y = 0 and the doors face local +y — so rotation 0
   * means "backed against a wall at the top of the screen".
   */
  x: number;
  y: number;
  /** Plan footprint in canvas pixels: width along the run, height = depth. */
  width: number;
  height: number;
  rotation: number;
  label: string;
  /**
   * Real-world size, in inches, copied from the Edit tab box this cabinet
   * stands for. The elevation view (and a later 3D view) read these instead
   * of the pixel footprint. Optional only because sketches saved before
   * the Edit-tab sync lack them; sync fills them in on load.
   */
  location?: CabinetLocation;
  width_in?: number;
  /** Plan depth; for an L or diagonal corner unit, its reach along the side wall. */
  depth_in?: number;
  height_in?: number;
  /** Which end of a corner unit sits in the corner, seen from the front. Default left. */
  corner_side?: 'left' | 'right';
  /** The Edit tab box has glass door inserts; the sketch draws its doors as glass. */
  has_glass_door?: boolean | null;
  /** The pattern the Edit tab box has in its doors. */
  door_pattern?: DoorPattern | null;
}

/**
 * One unit of the Edit tab's Appliance Detach & Reset list, placed on the
 * plan so the drawing shows where it comes out and goes back. The Edit tab
 * says which appliances there are; the sketch only owns where they sit
 * (see sketchAppliances.ts).
 */
export interface CabinetSketchAppliance {
  id: string;
  /** The appliance_list type it stands for: 'dishwasher', 'range_gas', … */
  type: string;
  /** Plan position and footprint in canvas pixels, as a cabinet's: (x, y) the back-left corner, front toward local +y. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** The cabinet it sits in or on (a range base, a sink base, an oven cabinet…); it moves with it. Absent or null: it stands on its own. */
  host_id?: string | null;
}

/**
 * What the kitchen is finished in, for the 3D view's realistic look and
 * the AI photo made from it (see kitchenFinish.ts for the choices). Not
 * priced — the estimate's own line items are. Absent on sketches saved
 * before it existed; kitchenFinish.ts fills in the defaults.
 */
export interface CabinetSketchFinish {
  cabinet_color: string;
  door_style: string;
  countertop: string;
  backsplash: string;
  sink: string;
  faucet: string;
  /** The hardware's metal; hardware_style its shape. */
  hardware: string;
  hardware_style: string;
  floor: string;
}

export interface CabinetSketchOverlayData {
  walls: CabinetSketchWall[];
  cabinets: CabinetSketchCabinet[];
  appliances: CabinetSketchAppliance[];
  element_order: string[];
  finish?: CabinetSketchFinish | null;
  /** The estimate's "cabinets on both sides" the island was last laid out for (see layoutIslandSides). */
  island_two_sided?: boolean | null;
  /**
   * Wall faces left without backsplash (splashFaceKey in cabinetBacksplash.ts:
   * a wall's id and which of its faces). Absent: every face behind a run's
   * backs has it.
   */
  backsplash_off?: string[] | null;
  /**
   * Faces given backsplash that start without one: a side wall at a run's
   * end, tiled in some kitchens and not in others.
   */
  backsplash_on?: string[] | null;
  /** Inches a face's backsplash stops short of its [left, right] end, as you face that wall. */
  backsplash_trim?: Record<string, number[]> | null;
}

export interface CabinetSketch {
  id: string;
  estimate_id: string;
  canvas_width: number;
  canvas_height: number;
  scale_pixels_per_foot: number;
  overlay_data: CabinetSketchOverlayData;
}

export interface CabinetSketchUpdate {
  canvas_width?: number;
  canvas_height?: number;
  scale_pixels_per_foot?: number;
}

export const EMPTY_CABINET_OVERLAY_DATA: CabinetSketchOverlayData = {
  walls: [],
  cabinets: [],
  appliances: [],
  element_order: [],
};

/** Snap threshold in canvas pixels for wall endpoint snapping */
export const WALL_SNAP_THRESHOLD = 15;
export const DEFAULT_WALL_THICKNESS = 4;
export const DEFAULT_WALL_COLOR = '#333333';

export type CabinetSketchTool = 'select' | 'wall' | 'place_cabinet' | 'pan';

/** Which drawing the Sketch tab shows: the floor plan, a front elevation, or the 3D model. */
export type CabinetSketchView = 'plan' | 'elevation' | '3d';

export interface CabinetSketchSelection {
  element_id: string;
  element_type: 'wall' | 'cabinet' | 'appliance';
}
