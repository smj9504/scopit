import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOKS, type TileLook } from './bathroom3dModel';
import { patternTiles } from './bathroom3dTextures';

const inside = (quad: [number, number][], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [xi, yi] = quad[i];
    const [xj, yj] = quad[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const tile = (pattern: string, widthIn: number, heightIn: number): TileLook => ({
  ...DEFAULT_LOOKS.wallTile, pattern, widthIn, heightIn, key: `${pattern}${widthIn}x${heightIn}`,
});

describe('patternTiles', () => {
  // Points off the joints, across one repeat: each must be on exactly one tile
  it.each([
    ['straight', 24, 12],
    ['subway', 6, 3],
    ['diagonal', 12, 12],
    ['herringbone', 24, 12],
    ['herringbone', 12, 4],
    ['basketweave', 12, 4],
  ])('lays %s %ix%i over its whole repeat, no gaps and no overlaps', (pattern, w, h) => {
    const { repeat, tiles } = patternTiles(tile(pattern as string, w as number, h as number));
    const steps = 37;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const x = ((i + 0.37) / steps) * repeat[0];
        const y = ((j + 0.61) / steps) * repeat[1];
        const count = tiles.filter((q) => inside(q, x, y)).length;
        expect(count, `${pattern} at (${x.toFixed(2)}, ${y.toFixed(2)})`).toBe(1);
      }
    }
  });

  it('repeats a herringbone exactly: every 2LS / gcd(L, S)', () => {
    expect(patternTiles(tile('herringbone', 24, 12)).repeat).toEqual([48, 48]);
    expect(patternTiles(tile('herringbone', 6, 3)).repeat).toEqual([48, 48]);
  });
});
