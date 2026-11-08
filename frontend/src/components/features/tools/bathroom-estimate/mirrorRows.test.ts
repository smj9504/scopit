import { describe, it, expect } from 'vitest';
import type { BEFixture } from '@/types/bathroomSketch';
import { mergeMirrorsFromSketch, mirrorsFromSketch } from './mirrorRows';

const mirror = (id: string, width: number): BEFixture => ({
  id, type: 'mirror', position: { x: 0, y: 0 }, dimensions: { width, height: 2 }, rotation: 0, properties: {},
} as BEFixture);
const vanity: BEFixture = {
  id: 'v', type: 'vanity', position: { x: 0, y: 0 }, dimensions: { width: 60, height: 22 }, rotation: 0, properties: {},
} as BEFixture;

describe('mirrors from the plan', () => {
  it('one wide mirror over a double vanity is one 60" mirror', () => {
    expect(mirrorsFromSketch([vanity, mirror('m', 60)])).toEqual([{ width: 60, count: 1, from_sketch: true }]);
  });

  it('two small mirrors of a width are one row of two, rounded to the inch', () => {
    expect(mirrorsFromSketch([vanity, mirror('a', 24), mirror('b', 24.2)]))
      .toEqual([{ width: 24, count: 2, from_sketch: true }]);
  });

  it('mirrors of two widths are two rows', () => {
    expect(mirrorsFromSketch([mirror('a', 30), mirror('b', 48)]).map((r) => r.width)).toEqual([30, 48]);
  });
});

describe('merging the plan into the estimate', () => {
  const typed = { width: 40, count: 1 };
  it('mirrors drawn on the plan take over the typed ones', () => {
    expect(mergeMirrorsFromSketch([typed], [{ width: 60, count: 1, from_sketch: true }]))
      .toEqual([{ width: 60, count: 1, from_sketch: true }]);
  });

  it('with none drawn the typed rows stay and the plan\'s old rows go', () => {
    expect(mergeMirrorsFromSketch([typed, { width: 60, count: 1, from_sketch: true }], [])).toEqual([typed]);
    expect(mergeMirrorsFromSketch(undefined, [])).toEqual([]);
  });
});
