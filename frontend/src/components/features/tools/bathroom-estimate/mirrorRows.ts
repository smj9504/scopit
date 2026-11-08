/**
 * Mirrors over the vanity, counted and sized on their own.
 *
 * A double vanity can have one wide mirror or a small one over each sink, so
 * mirrors aren't one per vanity. They're rows of a width and how many
 * (accessories_spec.mirrors), and detach & reset is priced per mirror by its
 * width (backend mirrors.py).
 *
 * Rows come from the plan, every mirror drawn on it, or are typed on the
 * estimate page. Mirrors drawn on the plan take over the typed rows; with
 * none drawn, the typed rows stay.
 */

import type { BEFixture } from '@/types/bathroomSketch';

export interface MirrorRow {
  /** Inches */
  width: number;
  count: number;
  /** Measured on the plan: it changes there, not on the estimate */
  from_sketch?: boolean;
}

export const DEFAULT_MIRROR_WIDTH = 36;

/** The plan's mirrors, one row per width (rounded to the inch), in the order first drawn */
export function mirrorsFromSketch(fixtures: BEFixture[]): MirrorRow[] {
  const rows: MirrorRow[] = [];
  for (const f of fixtures) {
    if (f.type !== 'mirror') continue;
    const width = Math.round(f.dimensions.width);
    const row = rows.find((r) => r.width === width);
    if (row) row.count += 1;
    else rows.push({ width, count: 1, from_sketch: true });
  }
  return rows;
}

/** The estimate's mirror rows after the plan changed */
export function mergeMirrorsFromSketch(current: MirrorRow[] | null | undefined, fromSketch: MirrorRow[]): MirrorRow[] {
  if (fromSketch.length > 0) return fromSketch;
  return (current ?? []).filter((r) => !r.from_sketch);
}
