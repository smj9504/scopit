/**
 * Tile drawn as a texture at its real size: tiles of the look's size and
 * colour (each a shade off the next, as fired tile is), laid in its pattern
 * with grout between. A texture covers one repeat of the pattern — `repeatIn`
 * inches each way — so a surface maps it at u = x / repeat.x, v = y / repeat.y
 * and the joints line up from one repeat to the next.
 *
 * A picked tile with a surface picture (TileLook.swatchFileId) is drawn flat
 * first, then again with the picture on every tile once it has loaded.
 */

import * as THREE from 'three';
import type { TileLook } from './bathroom3dModel';

export interface TileTexture {
  texture: THREE.CanvasTexture;
  /** Inches the texture covers, across and up. */
  repeatIn: [number, number];
}

/** Grout joint, inches. */
const GROUT_IN = 0.125;
/** Repeats are at least this big, so a surface shows a few dozen tiles per repeat and their shading doesn't repeat close by. */
const MIN_REPEAT_IN = 48;
const MAX_CANVAS_PX = 2048;

const gcd = (a: number, b: number): number => (b < 0.5 ? a : gcd(b, a % b));

type Quad = [number, number][];

/** The tiles of one repeat (and the ones that cross its edges), and the repeat's size. */
export function patternTiles(look: TileLook): { repeat: [number, number]; tiles: Quad[] } {
  const L = Math.max(look.widthIn, 0.5);
  const S = Math.max(look.heightIn, 0.5);
  const rect = (x: number, y: number, w: number, h: number): Quad => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const tiles: Quad[] = [];

  switch (look.pattern) {
    case 'subway': {
      // Running bond: every other row shifted half a tile
      const kx = Math.max(1, Math.ceil(MIN_REPEAT_IN / L));
      const ky = Math.max(1, Math.ceil(MIN_REPEAT_IN / (2 * S)));
      const repeat: [number, number] = [L * kx, 2 * S * ky];
      for (let row = -1; row <= 2 * ky; row++) {
        const shift = row % 2 === 0 ? 0 : L / 2;
        for (let col = -1; col <= kx; col++) tiles.push(rect(col * L + shift, row * S, L, S));
      }
      return { repeat, tiles };
    }
    case 'diagonal': {
      // Square tiles turned 45°: a diamond lattice
      const d = L * Math.SQRT2;
      const k = Math.max(1, Math.ceil(MIN_REPEAT_IN / d));
      const repeat: [number, number] = [d * k, d * k];
      for (let i = -1; i <= 2 * k + 1; i++) {
        for (let j = -1; j <= 2 * k + 1; j++) {
          const cx = (i * d) / 2;
          const cy = (j * d) / 2;
          if ((i + j) % 2 !== 0) continue;
          tiles.push([[cx, cy - d / 2], [cx + d / 2, cy], [cx, cy + d / 2], [cx - d / 2, cy]]);
        }
      }
      return { repeat, tiles };
    }
    case 'herringbone':
    case 'chevron': {
      // Square herringbone: a lying tile at k·(S,S) + m·(−L,L), the standing tile beside it.
      // That lattice repeats every 2LS / gcd(L,S) along both axes.
      const g = gcd(Math.round(L), Math.round(S)) || 1;
      const period = (2 * L * S) / g;
      const k = Math.max(1, Math.ceil(MIN_REPEAT_IN / period));
      const size = period * k;
      const span = Math.ceil((size + 2 * L) / Math.min(S, L)) + 2;
      for (let a = -span; a <= span; a++) {
        for (let m = -span; m <= span; m++) {
          const ox = a * S - m * L;
          const oy = a * S + m * L;
          if (ox < -2 * L || ox > size + L || oy < -2 * L || oy > size + L) continue;
          tiles.push(rect(ox, oy, L, S));
          tiles.push(rect(ox + L, oy + S - L, S, L));
        }
      }
      return { repeat: [size, size], tiles };
    }
    case 'basketweave': {
      // Blocks of side L, each n tiles laid one way, the next block the other way
      const n = Math.max(1, Math.round(L / S));
      const block = n * S;
      const k = Math.max(1, Math.ceil(MIN_REPEAT_IN / (2 * block)));
      const size = 2 * block * k;
      for (let bx = 0; bx < 2 * k; bx++) {
        for (let by = 0; by < 2 * k; by++) {
          const across = (bx + by) % 2 === 0;
          for (let t = 0; t < n; t++) {
            tiles.push(across
              ? rect(bx * block, by * block + t * S, block, S)
              : rect(bx * block + t * S, by * block, S, block));
          }
        }
      }
      return { repeat: [size, size], tiles };
    }
    default: {
      // Straight lay (and patterns drawn straight for now, e.g. versailles)
      const kx = Math.max(1, Math.ceil(MIN_REPEAT_IN / L));
      const ky = Math.max(1, Math.ceil(MIN_REPEAT_IN / S));
      for (let col = 0; col < kx; col++) for (let row = 0; row < ky; row++) tiles.push(rect(col * L, row * S, L, S));
      return { repeat: [L * kx, S * ky], tiles };
    }
  }
}

/** A stable small shade (−1…1) per tile, so a wall doesn't flicker between redraws. */
function shade(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function shiftColor(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

function drawTiles(
  look: TileLook,
  swatch?: HTMLImageElement,
  into?: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; repeat: [number, number] } {
  const { repeat, tiles } = patternTiles(look);
  const ppi = Math.min(16, MAX_CANVAS_PX / Math.max(repeat[0], repeat[1]));
  const canvas = into ?? document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(repeat[0] * ppi));
  canvas.height = Math.max(8, Math.round(repeat[1] * ppi));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = look.grout;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Wood-look plank varies more than glazed tile
  const variation = look.material === 'lvt_spc' ? 0.06 : look.material === 'natural_stone' ? 0.04 : 0.018;
  const groutPx = Math.max(1, GROUT_IN * ppi);

  const half = groutPx / ppi / 2;
  tiles.forEach((quad, i) => {
    // Pull each corner in by half a joint, toward the tile's middle
    const cx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
    const cy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
    ctx.fillStyle = shiftColor(look.color, shade(i) * variation);
    ctx.beginPath();
    quad.forEach(([x, y], j) => {
      const px = (x + Math.sign(cx - x) * half) * ppi;
      // Canvas y runs down; the texture's v runs up
      const py = canvas.height - (y + Math.sign(cy - y) * half) * ppi;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    if (!swatch) {
      ctx.fill();
      return;
    }
    // The picture on this tile: as much of it as the tile's shape takes, from a different spot per tile
    ctx.save();
    ctx.clip();
    const xs = quad.map((p) => p[0] * ppi);
    const ys = quad.map((p) => canvas.height - p[1] * ppi);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const want = (x1 - x0) / Math.max(1e-6, y1 - y0);
    const iw = swatch.naturalWidth;
    const ih = swatch.naturalHeight;
    const sw = Math.min(iw, ih * want);
    const sh = sw / want;
    const pick = (shade(i + 7) + 1) / 2;
    ctx.drawImage(swatch, (iw - sw) * pick, (ih - sh) * (1 - pick), sw, sh, x0, y0, x1 - x0, y1 - y0);
    // Fired tile varies a little from one to the next
    ctx.globalAlpha = Math.abs(shade(i)) * variation * 2;
    ctx.fillStyle = shade(i) > 0 ? '#ffffff' : '#000000';
    ctx.fill();
    ctx.restore();
  });
  return { canvas, repeat };
}

/** A picture, ready to draw, or null if it can't be had (gone, or not shareable with WebGL). */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface TileTextureOptions {
  anisotropy?: number;
  /**
   * Where a surface picture (a file id) is fetched from; without it, picked
   * tile stays flat. May resolve later: Scopit fetches product pictures
   * through the API and hands back an object URL.
   */
  imageUrl?: (fileId: string) => string | Promise<string>;
  /** A texture changed after it was handed out (its picture came in): draw again. */
  onChange?: () => void;
}

/** One texture per look, shared by every surface with that look until the view closes. */
export class TileTextureCache {
  private textures = new Map<string, TileTexture>();
  private pending: Promise<void>[] = [];
  private disposed = false;

  constructor(private options: TileTextureOptions = {}) {}

  get(look: TileLook): TileTexture {
    const cached = this.textures.get(look.key);
    if (cached) return cached;
    const { canvas, repeat } = drawTiles(look);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.options.anisotropy ?? 4;
    const entry = { texture, repeatIn: repeat };
    this.textures.set(look.key, entry);
    if (look.swatchFileId && this.options.imageUrl) {
      const url = Promise.resolve(this.options.imageUrl(look.swatchFileId));
      this.pending.push(url.then(loadImage, () => null).then((img) => {
        if (!img || this.disposed) return;
        drawTiles(look, img, canvas);
        texture.needsUpdate = true;
        this.options.onChange?.();
      }));
    }
    return entry;
  }

  /** Once every surface picture asked for so far is in (or has failed). */
  async ready(): Promise<void> {
    await Promise.all(this.pending);
  }

  dispose() {
    this.disposed = true;
    this.textures.forEach((t) => t.texture.dispose());
    this.textures.clear();
  }
}
