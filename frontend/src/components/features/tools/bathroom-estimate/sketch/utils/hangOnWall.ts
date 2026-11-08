/**
 * Where a thing hung on a wall goes when it's added or changed kind: a
 * vanity bar or a medicine cabinet on the wall behind the vanity, a sconce
 * beside it, a wall cabinet behind the toilet; a soffit over the tub or the
 * shower. Each fixture's back is its top edge on the plan (north, in its own
 * frame), against the wall it stands at.
 */

import type { BEDimensions, BEFixture, BEFixtureType, BEPoint } from '@/types/bathroomSketch';

export interface Placement {
  position: BEPoint;
  rotation: number;
}

/** The fixture of one of `types` nearest `from`, if any */
export function nearestFixture(fixtures: BEFixture[], types: BEFixtureType[], from: BEPoint): BEFixture | undefined {
  let best: BEFixture | undefined;
  let bestD = Infinity;
  for (const f of fixtures) {
    if (!types.includes(f.type)) continue;
    const d = Math.hypot(f.position.x - from.x, f.position.y - from.y);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/**
 * On the wall behind `host`: its back on the host's back edge, `alongIn`
 * inches along the wall from the host's centre (right, facing the wall, is +).
 */
export function behind(host: BEFixture, depthIn: number, alongIn: number, ppf: number): Placement {
  const rad = ((host.rotation || 0) * Math.PI) / 180;
  const lx = alongIn;
  const ly = -host.dimensions.height / 2 + depthIn / 2;
  const k = ppf / 12;
  return {
    position: {
      x: host.position.x + (lx * Math.cos(rad) - ly * Math.sin(rad)) * k,
      y: host.position.y + (lx * Math.sin(rad) + ly * Math.cos(rad)) * k,
    },
    rotation: host.rotation || 0,
  };
}

/**
 * Where a wall light, cabinet or soffit of this kind goes in this sketch,
 * with its size, or null to leave it where it is.
 */
export function placeFor(
  fixtures: BEFixture[],
  self: BEFixture,
  kind: 'vanity_bar' | 'sconce' | 'medicine_cabinet' | 'wall_cabinet' | 'soffit',
  size: BEDimensions,
  ppf: number,
): (Placement & { dimensions: BEDimensions }) | null {
  const others = fixtures.filter((f) => f.id !== self.id);
  if (kind === 'soffit') {
    const over = nearestFixture(others, ['bathtub', 'shower'], self.position);
    if (!over) return null;
    // The width of the tub or shower, as deep as it is
    return { position: { ...over.position }, rotation: over.rotation || 0, dimensions: { ...over.dimensions } };
  }
  const hostTypes: BEFixtureType[] = kind === 'wall_cabinet' ? ['toilet'] : ['vanity'];
  const host = nearestFixture(others, hostTypes, self.position);
  if (!host) return null;
  // A sconce beside the mirror, a little in from the vanity's end
  const along = kind === 'sconce' ? -(host.dimensions.width / 2) + Math.min(4, host.dimensions.width / 4) : 0;
  return { ...behind(host, size.height, along, ppf), dimensions: size };
}
