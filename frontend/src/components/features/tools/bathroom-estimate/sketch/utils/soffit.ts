/**
 * What a soffit (a lowered part of the ceiling, as over a tub) does to the
 * walls: the wall above its underside is hidden where it's against one, and
 * its own faces stand out into the room. The estimate takes the first off
 * the wall paint and adds the second (calculator, walls_spec.soffit_*).
 */

import type { BEFixture, BERoom } from '@/types/bathroomSketch';
import { SOFFIT_BOTTOM_IN } from '@/types/bathroomSketch';
import { findFixtureWallSides } from './beTileZoneGenerator';

export function soffitAreas(
  fixtures: BEFixture[],
  room: BERoom | undefined,
  ppf: number,
): { soffit_hidden_wall_sf: number; soffit_face_sf: number } {
  let hidden = 0;
  let faces = 0;
  const ceilingIn = room?.heightInches || 96;
  for (const f of fixtures) {
    if (f.type !== 'soffit') continue;
    const dropFt = Math.max(0, ceilingIn - (f.properties.soffitBottom ?? SOFFIT_BOTTOM_IN)) / 12;
    const wFt = f.dimensions.width / 12;
    const dFt = f.dimensions.height / 12;
    const sides = findFixtureWallSides(f, room, wFt * ppf, dFt * ppf)
      ?? { north: false, south: false, east: false, west: false };
    const edges: [boolean, number][] = [[sides.north, wFt], [sides.south, wFt], [sides.east, dFt], [sides.west, dFt]];
    for (const [against, lenFt] of edges) {
      if (against) hidden += lenFt * dropFt;
      else faces += lenFt * dropFt;
    }
  }
  return { soffit_hidden_wall_sf: Math.round(hidden * 10) / 10, soffit_face_sf: Math.round(faces * 10) / 10 };
}
