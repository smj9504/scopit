/**
 * Materials for the 3D view's realistic look, in the sketch's finish
 * (kitchenFinish.ts): painted or wood-grained cabinets, stone and wood
 * countertops, metal pulls, stainless appliances, the floor.
 *
 * Wood, stone and tile are painted on canvases here, so no image files
 * ship with the app. Each texture is painted once and kept (marked
 * userData.keep, which disposeScene leaves alone): the scene is rebuilt on
 * every selection, and would otherwise upload them all again each time.
 *
 * Textures are laid out in inches: the scene's geometry has its UVs in
 * inches, and each texture repeats once per the inches it was painted to
 * cover.
 *
 * An option's chosen products (productLook.ts) override surfaces: their own
 * colour, painted in the surface's kind of texture, or their swatch picture
 * laid across it.
 */

import * as THREE from 'three';
import type { CabinetSketchFinish } from '@/types/cabinetSketch';
import { BACKSPLASHES, CABINET_COLORS, COUNTERTOPS, FAUCETS, HARDWARE, SINKS, choiceOf } from '@/components/features/tools/cabinet-estimate/sketch/kitchenFinish';
import type { ProductSurfaces, SurfaceLook } from '@/components/features/tools/cabinet-estimate/sketch/productLook';

/** A seeded random, so a texture comes out the same every time it is painted. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

/** Wavy grain lines along a board lying from x to x + w (grain running along x), y to y + h. */
function grain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dark: string, light: string, rand: () => number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // Broad streaks first, then fine lines over them.
  for (let i = 0; i < h / 6; i++) {
    ctx.globalAlpha = 0.04 + rand() * 0.06;
    ctx.fillStyle = rand() < 0.5 ? dark : light;
    ctx.fillRect(x, y + rand() * h, w, 1 + rand() * h * 0.12);
  }
  const lines = Math.ceil(h / 2.2);
  for (let i = 0; i < lines; i++) {
    const at = y + rand() * h;
    const amp = 0.5 + rand() * h * 0.03;
    const freq = (0.5 + rand() * 2) / w;
    const phase = rand() * Math.PI * 2;
    ctx.globalAlpha = 0.05 + rand() * 0.18;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.4 + rand() * 1.4;
    ctx.beginPath();
    for (let px = x; px <= x + w; px += 8) {
      const py = at + Math.sin((px - x) * freq * Math.PI * 2 + phase) * amp + (rand() - 0.5) * 0.6;
      if (px === x) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

interface BoardsSpec {
  size: number;
  rows: number;
  /** Board lengths, as a share of the canvas width. */
  minLen: number;
  maxLen: number;
  base: string;
  dark: string;
  light: string;
  /** How far one board's tone strays from the next, 0..1. */
  tint: number;
  seam: string;
  seamPx: number;
  seed: number;
}

/** Rows of boards, ends staggered, wrapping seamlessly both ways: floor planks, butcher block, wood veneer. */
function paintBoards(spec: BoardsSpec): HTMLCanvasElement {
  const { size } = spec;
  const [canvas, ctx] = newCanvas(size, size);
  if (!ctx) return canvas;
  const rand = seeded(spec.seed);
  const rowH = size / spec.rows;
  for (let r = 0; r < spec.rows; r++) {
    const y = r * rowH;
    // Board ends around the row, closing the loop so the row wraps.
    const ends: number[] = [];
    const start = rand() * size;
    for (let at = start; at < start + size; ) {
      ends.push(at);
      at += size * (spec.minLen + rand() * (spec.maxLen - spec.minLen));
    }
    ends.push(start + size);
    for (let i = 0; i < ends.length - 1; i++) {
      const x0 = ends[i];
      const len = ends[i + 1] - x0;
      const tone = (rand() - 0.5) * 2 * spec.tint;
      const fill = tone > 0 ? mix(spec.base, spec.light, tone) : mix(spec.base, spec.dark, -tone);
      for (const shift of [0, -size]) {
        ctx.fillStyle = fill;
        ctx.fillRect(x0 + shift, y, len, rowH);
        grain(ctx, x0 + shift, y, len, rowH, spec.dark, spec.light, seeded(spec.seed + r * 97 + i));
        if (spec.seamPx > 0) {
          ctx.fillStyle = spec.seam;
          ctx.fillRect(x0 + shift, y, spec.seamPx, rowH);
        }
      }
    }
    if (spec.seamPx > 0) {
      ctx.fillStyle = spec.seam;
      ctx.fillRect(0, y, size, spec.seamPx);
    }
  }
  return canvas;
}

interface StoneSpec {
  size: number;
  base: string;
  flecks: string[];
  count: number;
  maxPx: number;
  seed: number;
}

/** An engineered or granite stone: flecks over a base, wrapping seamlessly. */
function paintStone(spec: StoneSpec): HTMLCanvasElement {
  const { size } = spec;
  const [canvas, ctx] = newCanvas(size, size);
  if (!ctx) return canvas;
  const rand = seeded(spec.seed);
  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < spec.count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.4 + rand() * rand() * spec.maxPx;
    ctx.globalAlpha = 0.25 + rand() * 0.6;
    ctx.fillStyle = spec.flecks[Math.floor(rand() * spec.flecks.length)];
    // Drawn again across each edge it crosses, so the tile wraps.
    for (const dx of [0, size, -size]) {
      for (const dy of [0, size, -size]) {
        if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/** White marble: a faint cloud and a few soft gray veins wandering across. */
function paintMarble(size: number, seed: number): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size, size);
  if (!ctx) return canvas;
  const rand = seeded(seed);
  ctx.fillStyle = '#f3f1ed';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, size * (0.1 + rand() * 0.25));
    g.addColorStop(0, 'rgba(200,198,194,0.10)');
    g.addColorStop(1, 'rgba(200,198,194,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const vein = (width: number, alpha: number, blur: number) => {
    let x = -20;
    let y = rand() * size;
    let angle = (rand() - 0.5) * 0.9;
    ctx.save();
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.strokeStyle = `rgba(120,118,115,${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (x < size + 20) {
      angle += (rand() - 0.5) * 0.35;
      angle = Math.max(-1.1, Math.min(1.1, angle));
      x += Math.cos(angle) * 10;
      y += Math.sin(angle) * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  for (let i = 0; i < 5; i++) vein(6 + rand() * 10, 0.12, 6);
  for (let i = 0; i < 7; i++) vein(0.8 + rand() * 1.6, 0.35 + rand() * 0.3, 0.6);
  return canvas;
}

/** Large square tiles with a slight tone from tile to tile and grout between; `base` is the tile's colour. */
function paintTile(size: number, tiles: number, seed: number, base = '#b8b6b1'): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size, size);
  if (!ctx) return canvas;
  const rand = seeded(seed);
  const step = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = mix(base, rand() < 0.5 ? mix(base, '#000000', 0.08) : mix(base, '#ffffff', 0.08), rand() * 0.6);
      ctx.fillRect(i * step, j * step, step, step);
    }
  }
  for (let k = 0; k < size * size * 0.02; k++) {
    ctx.globalAlpha = 0.08 + rand() * 0.1;
    ctx.fillStyle = rand() < 0.5 ? mix(base, '#000000', 0.22) : mix(base, '#ffffff', 0.4);
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  // Half the grout on each side of every edge, so the two halves meet when it wraps.
  const grout = 2;
  ctx.fillStyle = mix(base, '#7f7d78', 0.5);
  for (let i = 0; i <= tiles; i++) {
    ctx.fillRect(i * step - grout, 0, grout * 2, size);
    ctx.fillRect(0, i * step - grout, size, grout * 2);
  }
  return canvas;
}

/**
 * 3x6 subway tile in running bond over a foot square (4 rows, 2 tiles a
 * row, every other row shifted half a tile), wrapping seamlessly: each tile
 * a little lighter at its top edge and darker at its bottom, as the glaze
 * catches light over the rounded edge.
 */
function paintSubway(size: number, tile: string, grout: string, seed: number): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size, size);
  if (!ctx) return canvas;
  const rand = seeded(seed);
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, size, size);
  const rowH = size / 4;
  const tileW = size / 2;
  const gap = Math.max(2, Math.round(size / 180));
  for (let r = 0; r < 4; r++) {
    const shift = r % 2 ? tileW / 2 : 0;
    for (let k = -1; k <= 2; k++) {
      const x = shift + k * tileW + gap / 2;
      const y = r * rowH + gap / 2;
      const w = tileW - gap;
      const h = rowH - gap;
      const tone = mix(tile, rand() < 0.5 ? '#ffffff' : '#9a9a9a', rand() * 0.06);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, mix(tone, '#ffffff', 0.35));
      g.addColorStop(0.12, tone);
      g.addColorStop(0.88, tone);
      g.addColorStop(1, mix(tone, '#000000', 0.12));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
  }
  return canvas;
}

interface Painted {
  paint: () => HTMLCanvasElement;
  /** Inches the canvas covers, across and up. */
  inches: number;
  /** Turned a quarter, for grain that runs up the doors. */
  upright?: boolean;
}

const WOOD = {
  oak: { base: '#c39a6b', dark: '#8f6a43', light: '#d8b88f' },
  walnut: { base: '#6a4a34', dark: '#3f2a1c', light: '#8a6548' },
};

const TEXTURES: Record<string, Painted> = {
  cabinet_oak: {
    paint: () => paintBoards({ size: 512, rows: 4, minLen: 0.9, maxLen: 1.1, ...WOOD.oak, tint: 0.08, seam: '', seamPx: 0, seed: 11 }),
    inches: 24,
    upright: true,
  },
  cabinet_walnut: {
    paint: () => paintBoards({ size: 512, rows: 4, minLen: 0.9, maxLen: 1.1, ...WOOD.walnut, tint: 0.08, seam: '', seamPx: 0, seed: 12 }),
    inches: 24,
    upright: true,
  },
  floor_light_oak: {
    paint: () =>
      paintBoards({ size: 1024, rows: 12, minLen: 0.35, maxLen: 0.9, base: '#c9a77c', dark: '#9c7a52', light: '#dcc19d', tint: 0.22, seam: 'rgba(80,58,36,0.55)', seamPx: 2, seed: 21 }),
    inches: 64,
  },
  floor_walnut: {
    paint: () =>
      paintBoards({ size: 1024, rows: 12, minLen: 0.35, maxLen: 0.9, base: '#5f4331', dark: '#3a271b', light: '#7b5a43', tint: 0.25, seam: 'rgba(25,16,10,0.6)', seamPx: 2, seed: 22 }),
    inches: 64,
  },
  floor_gray_tile: { paint: () => paintTile(1024, 2, 23), inches: 48 },
  counter_white_quartz: {
    paint: () => paintStone({ size: 512, base: '#eeece7', flecks: ['#d6d3cc', '#c7c3bc', '#faf9f7', '#b3afa8'], count: 9000, maxPx: 2.2, seed: 31 }),
    inches: 24,
  },
  counter_gray_quartz: {
    paint: () => paintStone({ size: 512, base: '#9b9993', flecks: ['#84827d', '#b4b2ac', '#6e6c68', '#c9c7c2'], count: 12000, maxPx: 2.4, seed: 32 }),
    inches: 24,
  },
  counter_black_granite: {
    paint: () => paintStone({ size: 512, base: '#1f1f21', flecks: ['#3a3a3d', '#56565b', '#2b2b2e', '#45454a', '#8c8c90'], count: 12000, maxPx: 1.8, seed: 33 }),
    inches: 24,
  },
  counter_marble: { paint: () => paintMarble(1536, 34), inches: 96 },
  counter_laminate: {
    paint: () => paintStone({ size: 512, base: '#d9d6cf', flecks: ['#cfccc4', '#e3e0d9', '#c4c0b7'], count: 6000, maxPx: 1.6, seed: 36 }),
    inches: 24,
  },
  backsplash_white_subway: { paint: () => paintSubway(512, '#f4f3ef', '#d3d1cb', 41), inches: 12 },
  backsplash_gray_subway: { paint: () => paintSubway(512, '#b9bcbd', '#e6e4df', 42), inches: 12 },
  counter_butcher_block: {
    paint: () =>
      paintBoards({ size: 1024, rows: 32, minLen: 0.25, maxLen: 0.75, base: '#b8875a', dark: '#8a5f39', light: '#d1a678', tint: 0.35, seam: 'rgba(90,60,35,0.35)', seamPx: 1, seed: 35 }),
    inches: 48,
  },
};

const painted = new Map<string, THREE.Texture>();

/** A texture of TEXTURES, painted the first time it is asked for and kept after. */
function texture(key: string): THREE.Texture | null {
  const spec = TEXTURES[key];
  if (!spec) return null;
  let tex = painted.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(spec.paint());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.repeat.set(1 / spec.inches, 1 / spec.inches);
    if (spec.upright) tex.rotation = Math.PI / 2;
    tex.userData.keep = true;
    painted.set(key, tex);
  }
  return tex;
}

/** A product's swatch picture, laid across a surface every `inches`; kept per picture. */
function pictureTexture(look: SurfaceLook, upright = false): THREE.Texture | null {
  if (!look.image || !look.imageFileId) return null;
  const key = `picture_${look.imageFileId}`;
  let tex = painted.get(key);
  if (!tex) {
    tex = new THREE.Texture(look.image);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const inches = look.inches || 24;
    tex.repeat.set(1 / inches, 1 / inches);
    if (upright) tex.rotation = Math.PI / 2;
    tex.userData.keep = true;
    painted.set(key, tex);
  }
  return tex;
}

/** A texture painted in a product's colour, like the finish's own of that kind; kept per kind and colour. */
function tintedTexture(kind: string, color: string): THREE.Texture | null {
  const key = `tinted_${kind}_${color}`;
  if (!TEXTURES[key]) {
    const dark = mix(color, '#000000', 0.3);
    const light = mix(color, '#ffffff', 0.3);
    const seed = parseInt(color.slice(1), 16) % 997;
    TEXTURES[key] =
      kind === 'wood'
        ? { paint: () => paintBoards({ size: 1024, rows: 32, minLen: 0.25, maxLen: 0.75, base: color, dark, light, tint: 0.35, seam: 'rgba(60,40,25,0.3)', seamPx: 1, seed }), inches: 48 }
        : kind === 'subway'
          ? { paint: () => paintSubway(512, color, mix(color, '#d9d7d2', 0.6), seed), inches: 12 }
          : kind === 'tile'
            ? { paint: () => paintTile(512, 2, seed, color), inches: 12 }
            : {
                paint: () =>
                  paintStone({
                    size: 512,
                    base: color,
                    flecks: [mix(color, '#000000', 0.12), mix(color, '#ffffff', 0.15), mix(color, '#000000', 0.25), mix(color, '#ffffff', 0.3)],
                    count: kind === 'laminate' ? 6000 : 10000,
                    maxPx: kind === 'laminate' ? 1.6 : 2.2,
                    seed,
                  }),
                inches: 24,
              };
  }
  return texture(key);
}

export interface FinishMaterials {
  cabinet: THREE.Material;
  toe: THREE.Material;
  counter: THREE.Material;
  pull: THREE.Material;
  wall: THREE.Material;
  floor: THREE.Material;
  steel: THREE.Material;
  sinkSteel: THREE.Material;
  black: THREE.Material;
  burner: THREE.Material;
  darkGlass: THREE.Material;
  glass: THREE.Material;
  ceramic: THREE.Material;
  /** Tile or slab between the countertop and the uppers; null for a painted wall. */
  backsplash: THREE.Material | null;
  sink: THREE.Material;
  faucet: THREE.Material;
}

/**
 * The materials of one realistic scene, shared by all its meshes; `surfaces`
 * are an option's products over the finish (productLook.ts).
 */
export function finishMaterials(finish: CabinetSketchFinish, surfaces: ProductSurfaces = {}): FinishMaterials {
  const color = choiceOf(CABINET_COLORS, finish.cabinet_color);
  const cabinetLook = surfaces.cabinet ?? {};
  const woodMap = pictureTexture(cabinetLook, true) ?? (color.wood ? texture(`cabinet_${color.key}`) : null);
  const paint = cabinetLook.color ?? color.swatch;
  const cabinet = new THREE.MeshStandardMaterial(
    woodMap ? { map: woodMap, roughness: 0.5 } : { color: paint, roughness: 0.42 }
  );
  const toe = new THREE.MeshStandardMaterial(
    woodMap
      ? { map: woodMap, color: '#9a9a9a', roughness: 0.6 }
      : { color: new THREE.Color(paint).multiplyScalar(0.72), roughness: 0.6 }
  );

  const top = choiceOf(COUNTERTOPS, finish.countertop).key;
  const topLook = surfaces.counter ?? {};
  const topKind = topLook.kind ?? (top === 'butcher_block' ? 'wood' : top === 'laminate' ? 'laminate' : top === 'marble' ? 'marble' : 'stone');
  const topMap =
    pictureTexture(topLook) ??
    (topLook.color && topKind !== 'marble' ? tintedTexture(topKind, topLook.color) : texture(`counter_${top}`));
  const counter =
    topKind === 'wood' || topKind === 'laminate'
      ? new THREE.MeshStandardMaterial({ map: topMap, roughness: topKind === 'laminate' ? 0.6 : 0.55 })
      : new THREE.MeshPhysicalMaterial({
          map: topMap,
          roughness: topKind === 'marble' ? 0.18 : 0.26,
          clearcoat: 0.5,
          clearcoatRoughness: 0.12,
        });

  const metal = {
    nickel: { color: '#c9c9c4', metalness: 1, roughness: 0.36 },
    black: { color: '#1d1d1d', metalness: 0.3, roughness: 0.5 },
    brass: { color: '#c9a35a', metalness: 1, roughness: 0.3 },
  }[choiceOf(HARDWARE, finish.hardware).key as 'nickel' | 'black' | 'brass'];
  if (surfaces.hardware?.color) metal.color = surfaces.hardware.color;

  const splash = choiceOf(BACKSPLASHES, finish.backsplash).key;
  const splashLook = surfaces.backsplash ?? {};
  const splashMap =
    pictureTexture(splashLook) ??
    (splashLook.color && splashLook.kind && splashLook.kind !== 'marble'
      ? tintedTexture(splashLook.kind, splashLook.color)
      : texture(splash === 'marble_slab' ? 'counter_marble' : `backsplash_${splash}`));
  const backsplash =
    splash === 'none' && !surfaces.backsplash
      ? null
      : new THREE.MeshPhysicalMaterial({
          map: splashMap,
          roughness: splash === 'marble_slab' ? 0.18 : 0.1,
          clearcoat: splash === 'marble_slab' ? 0.5 : 0.8,
          clearcoatRoughness: 0.08,
        });
  const ceramic = new THREE.MeshPhysicalMaterial({ color: '#f4f3ef', roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const sinkSteel = new THREE.MeshStandardMaterial({ color: '#b9bfc4', metalness: 1, roughness: 0.42 });
  const sinkColor = surfaces.sink?.color;
  const sink = {
    stainless: sinkSteel,
    white_fireclay: sinkColor
      ? new THREE.MeshPhysicalMaterial({ color: sinkColor, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1 })
      : ceramic,
    black_composite: new THREE.MeshStandardMaterial({ color: sinkColor ?? '#2b2b2d', roughness: 0.5 }),
  }[choiceOf(SINKS, finish.sink).key as 'stainless' | 'white_fireclay' | 'black_composite'];
  const faucet = {
    stainless: { color: '#d0d4d7', metalness: 1, roughness: 0.22 },
    black: { color: '#1b1b1b', metalness: 0.3, roughness: 0.45 },
    brass: { color: '#c9a35a', metalness: 1, roughness: 0.28 },
  }[choiceOf(FAUCETS, finish.faucet).key as 'stainless' | 'black' | 'brass'];
  if (surfaces.faucet?.color) faucet.color = surfaces.faucet.color;

  const floorMap = texture(`floor_${finish.floor}`);
  return {
    cabinet,
    toe,
    counter,
    pull: new THREE.MeshStandardMaterial(metal),
    wall: new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.92 }),
    floor: new THREE.MeshStandardMaterial({ map: floorMap, roughness: finish.floor === 'gray_tile' ? 0.32 : 0.48 }),
    steel: new THREE.MeshStandardMaterial({ color: '#d2d6d9', metalness: 1, roughness: 0.3 }),
    sinkSteel,
    black: new THREE.MeshStandardMaterial({ color: '#161718', metalness: 0.1, roughness: 0.35 }),
    burner: new THREE.MeshStandardMaterial({ color: '#2a2c2f', metalness: 0.4, roughness: 0.6 }),
    darkGlass: new THREE.MeshPhysicalMaterial({ color: '#0d0f11', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#46504f', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    ceramic,
    backsplash,
    sink,
    faucet: new THREE.MeshStandardMaterial(faucet),
  };
}
