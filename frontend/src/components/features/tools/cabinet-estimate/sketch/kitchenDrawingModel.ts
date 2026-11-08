/**
 * What the design quote's drawings draw, from a saved estimate and its sketch:
 * the same cabinets and appliances the Sketch tab would open on, the finish
 * with an option's products over it, and the plan's framing. Plain data, no
 * canvas.
 */

import type { CabinetEstimate } from '@/types/cabinetEstimate';
import type {
  CabinetSketch,
  CabinetSketchAppliance,
  CabinetSketchCabinet,
  CabinetSketchFinish,
  CabinetSketchOverlayData,
  CabinetSketchWall,
} from '@/types/cabinetSketch';
import type { SplashChoices } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { layoutIslandSides, reconcileCabinets } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { finishOf } from '@/components/features/tools/cabinet-estimate/sketch/kitchenFinish';
import { productLook } from '@/components/features/tools/cabinet-estimate/sketch/productLook';
import type { ProductSurfaces } from '@/components/features/tools/cabinet-estimate/sketch/productLook';
import { reconcileAppliances } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';

export interface KitchenDrawingInput {
  cabinets: CabinetSketchCabinet[];
  walls: CabinetSketchWall[];
  appliances: CabinetSketchAppliance[];
  scalePixelsPerFoot: number;
  sinkBowls: 1 | 2;
  crownMolding: boolean;
  archedDoors: boolean;
  islandSeatingIn: number;
  /** The finish the realistic 3D look draws, with the products' surfaces over it. */
  finish: CabinetSketchFinish;
  surfaces: ProductSurfaces;
  /** Which wall faces have backsplash and where it stops, as saved with the sketch. */
  backsplash?: SplashChoices;
}

export interface PlanFrame {
  /** Canvas px to picture px. */
  zoom: number;
  /** The stage's offset and size, picture px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** What it shows, canvas px. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Pt {
  x: number;
  y: number;
}

/** A sketch worth drawing: laid out at least once. One never opened would come out as rows of boxes. */
export const hasDrawing = (overlay?: CabinetSketchOverlayData | null): boolean =>
  !!overlay && (overlay.cabinets.length > 0 || overlay.walls.length > 0);

/**
 * Line the sketch up with the estimate the way opening the Sketch tab does,
 * so a box added since it was last open is drawn too (and the island in
 * two rows or one, when its "Cabinets on both sides" has changed since), and pick the look as
 * the tab does: arched doors go by the estimate's door style unless an
 * option's cabinet product says otherwise.
 */
export function drawingInput(
  sketch: Pick<CabinetSketch, 'overlay_data' | 'scale_pixels_per_foot'>,
  estimate: Pick<
    CabinetEstimate,
    | 'boxes'
    | 'kind'
    | 'selections'
    | 'sink_type'
    | 'door_style'
    | 'include_crown_molding'
    | 'include_appliance_rr'
    | 'appliance_list'
    | 'island_seating_overhang_in'
    | 'island_two_sided'
  >,
  presets: PresetCatalog
): KitchenDrawingInput {
  const overlay = sketch.overlay_data;
  const scale = sketch.scale_pixels_per_foot ?? 20;
  const walls = overlay.walls;
  const twoSided = !!estimate.island_two_sided;
  const laid =
    twoSided !== (overlay.island_two_sided ?? false)
      ? layoutIslandSides(overlay.cabinets, walls, twoSided, scale).cabinets
      : overlay.cabinets;
  const cabinets = reconcileCabinets(laid, estimate.boxes, walls, presets, scale, { islandTwoSided: twoSided }) ?? laid;
  const list = estimate.include_appliance_rr ? estimate.appliance_list ?? [] : [];
  const appliances =
    reconcileAppliances(overlay.appliances ?? [], list, cabinets, walls, presets, scale) ?? overlay.appliances ?? [];

  const products = estimate.kind === 'option' ? estimate.selections : null;
  const look = productLook(finishOf(overlay.finish), products);
  const archedByStyle = estimate.door_style === 'Arched Raised Panel' && !look.setBy.door_style;
  const finish = archedByStyle ? { ...look.finish, door_style: 'arched' } : look.finish;
  return {
    cabinets,
    walls,
    appliances,
    scalePixelsPerFoot: scale,
    sinkBowls: look.sinkBowls ?? (estimate.sink_type === 'double' ? 2 : 1),
    crownMolding: !!estimate.include_crown_molding,
    archedDoors: finish.door_style === 'arched',
    // Back to back, neither side of the island is free for seating.
    islandSeatingIn: twoSided ? 0 : estimate.island_seating_overhang_in ?? 0,
    finish,
    surfaces: look.surfaces,
    backsplash: { off: overlay.backsplash_off, on: overlay.backsplash_on, trim: overlay.backsplash_trim },
  };
}

/**
 * Where the printed plan writes a wall's length: beside it, on the side away
 * from the cabinets, which would cover it on the other, reading upright. `gap`
 * is how far off the wall, canvas px.
 */
export function wallLengthPlace(
  wall: Pick<CabinetSketchWall, 'start_x' | 'start_y' | 'end_x' | 'end_y'>,
  cabinets: Pick<CabinetSketchCabinet, 'x' | 'y'>[],
  gap: number
): { x: number; y: number; rotation: number } {
  const midX = (wall.start_x + wall.end_x) / 2;
  const midY = (wall.start_y + wall.end_y) / 2;
  const dx = wall.end_x - wall.start_x;
  const dy = wall.end_y - wall.start_y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const middle = cabinets.reduce((sum, c) => ({ x: sum.x + c.x, y: sum.y + c.y }), { x: 0, y: 0 });
  const count = cabinets.length || 1;
  const away = (midX - middle.x / count) * nx + (midY - middle.y / count) * ny >= 0 ? 1 : -1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    x: midX + nx * away * gap,
    y: midY + ny * away * gap,
    rotation: angle > 90 || angle <= -90 ? angle + 180 : angle,
  };
}

/** Every corner of what the plan draws, canvas px. */
function planPoints(walls: CabinetSketchWall[], shapes: (CabinetSketchCabinet | CabinetSketchAppliance)[]): Pt[] {
  const pts: Pt[] = walls.flatMap((w) => [
    { x: w.start_x, y: w.start_y },
    { x: w.end_x, y: w.end_y },
  ]);
  for (const c of shapes) {
    const r = (c.rotation * Math.PI) / 180;
    const across = { x: Math.cos(r) * c.width, y: Math.sin(r) * c.width };
    const deep = { x: -Math.sin(r) * c.height, y: Math.cos(r) * c.height };
    pts.push(
      { x: c.x, y: c.y },
      { x: c.x + across.x, y: c.y + across.y },
      { x: c.x + deep.x, y: c.y + deep.y },
      { x: c.x + across.x + deep.x, y: c.y + across.y + deep.y }
    );
  }
  return pts;
}

/**
 * The plan fitted in maxWidth × maxHeight, picture px, with room round it for
 * the walls' lengths (and an island top's overhang); null with nothing to frame.
 */
export function planFrame(
  input: Pick<KitchenDrawingInput, 'walls' | 'cabinets' | 'appliances' | 'scalePixelsPerFoot'>,
  maxWidth: number,
  maxHeight: number
): PlanFrame | null {
  const pts = planPoints(input.walls, [...input.cabinets, ...input.appliances]);
  if (pts.length === 0) return null;
  const margin = 2 * input.scalePixelsPerFoot;
  const minX = Math.min(...pts.map((p) => p.x)) - margin;
  const maxX = Math.max(...pts.map((p) => p.x)) + margin;
  const minY = Math.min(...pts.map((p) => p.y)) - margin;
  const maxY = Math.max(...pts.map((p) => p.y)) + margin;
  const zoom = Math.min(maxWidth / (maxX - minX), maxHeight / (maxY - minY));
  return {
    zoom,
    x: -minX * zoom,
    y: -minY * zoom,
    width: Math.ceil((maxX - minX) * zoom),
    height: Math.ceil((maxY - minY) * zoom),
    minX,
    minY,
    maxX,
    maxY,
  };
}
