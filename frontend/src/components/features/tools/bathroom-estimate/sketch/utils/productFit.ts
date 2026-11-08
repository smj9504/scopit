/**
 * An option's picked products at their real size on the plan: the vanity,
 * tub, toilet and mirror drawn at the product's width and depth (a mirror's
 * height going up the wall, for the 3D view), keeping
 * to the walls they stood against, and a vanity with as many sinks as the
 * product has. A fixture remembers which pick it was sized to
 * (properties.productTakenAt), so it's sized once per pick and can still be
 * changed by hand afterwards.
 */

import type { BathroomSelection } from '@/types/bathroomEstimate';
import type { BEFixture, BESketchData } from '@/types/bathroomSketch';
import { findFixtureWallSides } from './beTileZoneGenerator';

// fixture type -> the slot whose product sizes it, and whether its depth is the product's
const SIZED_BY: Partial<Record<BEFixture['type'], { slot: string; depth: boolean }>> = {
  vanity: { slot: 'vanity', depth: true },
  bathtub: { slot: 'bathtub', depth: true },
  toilet: { slot: 'toilet', depth: true },
  mirror: { slot: 'mirror', depth: false },
};

/** Listed sizes outside this are a misread listing, not a fixture. */
const sane = (v?: number | null): v is number => typeof v === 'number' && v >= 6 && v <= 120;

/** The fixture's size for the product: [width, depth] in inches, or null to leave it. */
function productSize(fix: BEFixture, p: BathroomSelection, depth: boolean): [number, number] | null {
  const { width, height } = fix.dimensions;
  if (!sane(p.width_in)) return null;
  if (!depth) return [p.width_in, height];
  if (!sane(p.depth_in)) return [p.width_in, height];
  if (fix.type === 'bathtub') {
    // A tub's length runs along whichever side of the drawing is longer
    const long = Math.max(p.width_in, p.depth_in);
    const short = Math.min(p.width_in, p.depth_in);
    return width >= height ? [long, short] : [short, long];
  }
  return [p.width_in, p.depth_in];
}

/** How many sinks a vanity listing has: its bowls, else what its title says; null if it doesn't say. */
export function vanitySinks(p: BathroomSelection): number | null {
  const bowls = Number(p.look?.bowls);
  if (bowls >= 1 && bowls <= 3) return Math.round(bowls);
  if (/\b(double|dual|two)[- ]sink|\bdouble\b/i.test(p.title)) return 2;
  if (/\bsingle\b/i.test(p.title)) return 1;
  return null;
}

/** `fix` at `size`, its sides against a wall staying there. */
function resized(fix: BEFixture, size: [number, number], sketch: BESketchData): BEFixture {
  const ppf = sketch.settings.pixelsPerFoot;
  const [w, d] = size;
  const { width, height } = fix.dimensions;
  const room = sketch.rooms.find((r) => r.id === fix.roomId)
    ?? sketch.rooms.find((r) => r.roomType === 'bathroom')
    ?? sketch.rooms[0];
  const walls = fix.type === 'mirror'
    ? null
    : findFixtureWallSides(fix, room, (width / 12) * ppf, (height / 12) * ppf);
  // In the fixture's own frame (inches): move toward the side that stays put
  const grow = (dw: number, low: boolean, high: boolean) => (low && !high ? dw / 2 : high && !low ? -dw / 2 : 0);
  const lx = walls ? grow(w - width, walls.west, walls.east) : 0;
  const ly = walls ? grow(d - height, walls.north, walls.south) : 0;
  const rad = (fix.rotation * Math.PI) / 180;
  const k = ppf / 12;
  return {
    ...fix,
    dimensions: { ...fix.dimensions, width: w, height: d },
    position: {
      x: fix.position.x + (lx * Math.cos(rad) - ly * Math.sin(rad)) * k,
      y: fix.position.y + (lx * Math.sin(rad) + ly * Math.cos(rad)) * k,
    },
  };
}

/**
 * The sketch with each fixture a newly picked product sizes at that
 * product's size, or the same sketch if nothing needs to change.
 */
export function fitFixturesToProducts(
  sketch: BESketchData,
  selections?: Record<string, BathroomSelection> | null,
): BESketchData {
  if (!selections || !sketch?.fixtures?.length) return sketch;
  let changed = false;
  const fixtures = sketch.fixtures.map((fix) => {
    const rule = SIZED_BY[fix.type];
    const p = rule && selections[rule.slot];
    if (!rule || !p || fix.properties.productTakenAt === p.taken_at) return fix;
    changed = true;
    const size = productSize(fix, p, rule.depth);
    const sized = size && (Math.abs(size[0] - fix.dimensions.width) > 0.25 || Math.abs(size[1] - fix.dimensions.height) > 0.25)
      ? resized(fix, size, sketch)
      : fix;
    const sinks = fix.type === 'vanity' ? vanitySinks(p) : null;
    // A mirror's height is up the wall, not on the plan
    const mirrorHeight = fix.type === 'mirror' && sane(p.height_in) ? p.height_in : null;
    return {
      ...sized,
      properties: {
        ...sized.properties,
        ...(sinks ? { sinkCount: sinks } : {}),
        ...(mirrorHeight ? { mirrorHeight } : {}),
        productTakenAt: p.taken_at,
      },
    };
  });
  return changed ? { ...sketch, fixtures } : sketch;
}
