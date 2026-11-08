/**
 * How an option's chosen products (its selections from the product library)
 * draw in the 3D view's realistic look.
 *
 * A product's look (ProductLook: colour, material, door / hardware / sink /
 * faucet style, pattern) picks the nearest of the finish's own choices
 * (kitchenFinish.ts) for the shapes - door style, hardware style, bowls -
 * and becomes a surface override for the colours: the product's colour, or
 * its swatch picture laid across the surface. finishMaterials.ts draws the
 * overrides; what no product covers stays as the sketch's finish has it.
 *
 * Plain data, no three.js.
 */

import type { CabinetSketchFinish } from '@/types/cabinetSketch';
import type { ProductSnapshot } from '@/types/productLibrary';
import { BACKSPLASHES, CABINET_COLORS, COUNTERTOPS, DOOR_STYLES, FAUCETS, FLOORS, SINKS, choiceOf, hardwareWords } from '@/components/features/tools/cabinet-estimate/sketch/kitchenFinish';

/** What a product puts on one surface of the kitchen. */
export interface SurfaceLook {
  /** Its colour, #rrggbb. */
  color?: string;
  /** Its swatch picture, a square close-up laid across the surface; set once it has loaded. */
  image?: HTMLImageElement | null;
  /** The swatch picture's file, to load it. */
  imageFileId?: string;
  /** Inches the swatch picture covers. */
  inches?: number;
  /** stone, marble, wood, laminate, tile, subway, metal, ceramic, composite, paint. */
  kind?: string;
}

export type SurfaceKey = 'cabinet' | 'counter' | 'backsplash' | 'sink' | 'faucet' | 'hardware';
export type ProductSurfaces = Partial<Record<SurfaceKey, SurfaceLook>>;

export interface ProductLookResult {
  /** The finish, with the products' shapes and nearest colours chosen. */
  finish: CabinetSketchFinish;
  /** The products' own colours and pictures, over the finish. */
  surfaces: ProductSurfaces;
  /** The chosen sink's bowls, when its listing says. */
  sinkBowls?: 1 | 2;
  /** Which surfaces a product sets, for the finish picker to say so. */
  setBy: Partial<Record<keyof CabinetSketchFinish, string>>;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const text = (...vs: unknown[]) => vs.filter((v) => typeof v === 'string').join(' ').toLowerCase();
const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/** 0 (black) .. 1 (white). */
function lightness(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The choice whose swatch is nearest `color`. */
function nearest<T extends { key: string; swatch: string }>(choices: T[], color: string): T {
  const rgb = (c: string) => {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r, g, b] = rgb(color);
  let best = choices[0];
  let bestD = Infinity;
  for (const c of choices) {
    const [r2, g2, b2] = rgb(c.swatch);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

const named = (p: ProductSnapshot) => [p.brand, p.title].filter(Boolean).join(' ');

/** An option's products, drawn over the sketch's finish. */
export function productLook(finish: CabinetSketchFinish, products?: Record<string, ProductSnapshot> | null): ProductLookResult {
  const out: CabinetSketchFinish = { ...finish };
  const surfaces: ProductSurfaces = {};
  const setBy: ProductLookResult['setBy'] = {};
  let sinkBowls: 1 | 2 | undefined;
  if (!products) return { finish: out, surfaces, setBy };
  const swatch = (p: ProductSnapshot, inches: number): Pick<SurfaceLook, 'imageFileId' | 'inches'> =>
    p.swatch_file_id ? { imageFileId: p.swatch_file_id, inches } : {};

  const cab = products.cabinets;
  if (cab) {
    const look = cab.look || {};
    const words = text(look.door_style, cab.title);
    if (has(words, 'slab', 'flat', 'euro', 'modern')) out.door_style = 'slab';
    else if (has(words, 'arched', 'arch top', 'arch-top', 'cathedral')) out.door_style = 'arched';
    else if (has(words, 'raised')) out.door_style = 'raised';
    else if (has(words, 'shaker', 'recessed')) out.door_style = 'shaker';
    const material = text(look.material, cab.finish, cab.title);
    const color = hex(look.color);
    if (has(material, 'walnut', 'espresso')) out.cabinet_color = 'walnut';
    else if (has(material, 'oak', 'wood', 'maple', 'cherry', 'hickory') && !has(material, 'painted', 'white')) {
      out.cabinet_color = color && lightness(color) < 0.35 ? 'walnut' : 'oak';
    } else if (color) {
      out.cabinet_color = nearest(CABINET_COLORS.filter((c) => !c.wood), color).key;
      surfaces.cabinet = { color, kind: 'paint' };
    }
    if (cab.swatch_file_id) surfaces.cabinet = { ...surfaces.cabinet, ...swatch(cab, 24), kind: 'wood' };
    setBy.cabinet_color = setBy.door_style = named(cab);
  }

  const pull = products.cabinet_hardware;
  if (pull) {
    const look = pull.look || {};
    const words = text(look.hardware_style, pull.title);
    if (has(words, 'cup', 'bin')) out.hardware_style = 'cup';
    else if (has(words, 'knob')) out.hardware_style = 'knob';
    else if (has(words, 'pull', 'bar', 'handle', 'edge')) out.hardware_style = 'bar';
    const metal = text(look.material, pull.finish, pull.title);
    out.hardware = has(metal, 'brass', 'gold', 'champagne', 'bronze') ? 'brass' : has(metal, 'black') ? 'black' : 'nickel';
    surfaces.hardware = { color: hex(look.color), kind: 'metal' };
    setBy.hardware = setBy.hardware_style = named(pull);
  }

  const top = products.countertop;
  if (top) {
    const look = top.look || {};
    const material = text(look.material, top.title, top.finish);
    const color = hex(look.color);
    const kind = has(material, 'butcher', 'wood', 'maple', 'walnut', 'oak')
      ? 'wood'
      : has(material, 'laminate', 'formica')
        ? 'laminate'
        : has(material, 'marble', 'calacatta', 'carrara', 'statuario')
          ? 'marble'
          : 'stone';
    out.countertop =
      kind === 'wood' ? 'butcher_block'
        : kind === 'laminate' ? 'laminate'
          : kind === 'marble' ? 'marble'
            : color
              ? nearest(COUNTERTOPS.filter((c) => !['butcher_block', 'laminate'].includes(c.key)), color).key
              : has(material, 'black', 'absolute') ? 'black_granite' : out.countertop;
    surfaces.counter = { color, kind, ...swatch(top, 24) };
    setBy.countertop = named(top);
  }

  const tile = products.backsplash;
  if (tile) {
    const look = tile.look || {};
    const pattern = text(look.pattern, tile.title);
    const color = hex(look.color);
    const subway = has(pattern, 'subway', '3x6', '3 in. x 6', '4x12', '2x8');
    const slab = has(pattern, 'slab');
    out.backsplash = slab ? 'marble_slab' : color ? (lightness(color) > 0.8 ? 'white_subway' : 'gray_subway') : out.backsplash === 'none' ? 'white_subway' : out.backsplash;
    const piece = Math.max(tile.tile_width_in || 0, tile.tile_length_in || 0);
    surfaces.backsplash = { color, kind: subway ? 'subway' : slab ? 'marble' : 'tile', ...swatch(tile, piece || 12) };
    setBy.backsplash = named(tile);
  }

  const sink = products.kitchen_sink;
  if (sink) {
    const look = sink.look || {};
    const material = text(look.material, sink.finish, sink.title);
    const color = hex(look.color);
    out.sink = has(material, 'fireclay', 'porcelain', 'ceramic', 'cast iron')
      ? 'white_fireclay'
      : has(material, 'composite', 'granite', 'quartz')
        ? 'black_composite'
        : 'stainless';
    surfaces.sink = { color: out.sink === 'stainless' ? undefined : color, kind: out.sink === 'stainless' ? 'metal' : out.sink === 'white_fireclay' ? 'ceramic' : 'composite' };
    const bowls = Number(look.bowls) || (has(text(sink.title), 'double', '50/50', '60/40', '70/30') ? 2 : has(text(sink.title), 'single') ? 1 : 0);
    if (bowls === 1 || bowls === 2) sinkBowls = bowls;
    setBy.sink = named(sink);
  }

  const faucet = products.kitchen_faucet;
  if (faucet) {
    const look = faucet.look || {};
    const metal = text(look.material, faucet.finish, faucet.title);
    out.faucet = has(metal, 'brass', 'gold', 'champagne', 'bronze') ? 'brass' : has(metal, 'black') ? 'black' : 'stainless';
    surfaces.faucet = { color: hex(look.color), kind: 'metal' };
    setBy.faucet = named(faucet);
  }

  return { finish: out, surfaces, sinkBowls, setBy };
}

/** The finish in words for the AI photo, naming the products where there are some. */
export function productWords(finish: CabinetSketchFinish, products?: Record<string, ProductSnapshot> | null): string {
  const p = products || {};
  const describe = (product: ProductSnapshot | undefined, fallback: string, what: string) =>
    product ? `${[product.finish, product.title].filter(Boolean).join(' ')} ${what}`.trim() : fallback;
  return [
    describe(
      p.cabinets,
      `${choiceOf(CABINET_COLORS, finish.cabinet_color).words} ${choiceOf(DOOR_STYLES, finish.door_style).words} cabinet doors and drawer fronts`,
      'cabinets'
    ),
    describe(p.cabinet_hardware, hardwareWords(finish), 'cabinet hardware'),
    describe(p.countertop, choiceOf(COUNTERTOPS, finish.countertop).words, 'countertops'),
    describe(p.backsplash, choiceOf(BACKSPLASHES, finish.backsplash).words, 'backsplash'),
    describe(p.kitchen_sink, choiceOf(SINKS, finish.sink).words, 'sink'),
    describe(p.kitchen_faucet, choiceOf(FAUCETS, finish.faucet).words, 'faucet'),
    choiceOf(FLOORS, finish.floor).words,
  ].join(', ');
}
