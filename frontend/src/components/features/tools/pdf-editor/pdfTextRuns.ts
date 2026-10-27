/**
 * Scopit - PDF Editor: existing-text runs
 *
 * Finds the text already printed on a PDF page so the "Edit Text" tool can
 * replace it: the original words are erased from the page (the backend
 * removes their glyphs, see pdf_text_edit.py) and the new text is drawn in
 * their place, in the same PDF font when the page has it.
 *
 * Geometry is in the pdf.js viewport at scale 1, the same space annotations
 * use. Each run is anchored at its baseline-left point and laid out along
 * `angle` (degrees, clockwise on screen), so rotated pages and rotated text
 * work the same way.
 */
import { Util } from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';

export interface PdfTextRun {
  text: string;
  /** Baseline-left point */
  x: number;
  y: number;
  /** Clockwise angle of the text direction, degrees */
  angle: number;
  /** Advance width along the text direction */
  width: number;
  /** Extent above / below the baseline (both positive) */
  ascent: number;
  descent: number;
  fontSize: number;
  /** One of the editor's font choices, standing in for the PDF font */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** The PDF font it's printed in, as pdf.js names it (a PdfTextLayer.fonts key) */
  pdfFont?: string;
}

export interface SampledColors {
  background: string;
  text: string;
}

/** How pdf.js draws a PDF font on its canvas, for drawing text the same way. */
export interface PdfFontFace {
  /** CSS font-family list: the font pdf.js loaded from the PDF, then its fallback */
  family: string;
  weight: string;
  style: string;
}

export interface PdfTextLayer {
  runs: PdfTextRun[];
  /** The document's PDF fonts pdf.js has loaded, by PDF font name */
  fonts: Map<string, PdfFontFace>;
  /** Reads the rendered page to match the run's background and ink colors. */
  sampleColors: (run: PdfTextRun) => SampledColors | null;
}

// Neighbouring text items on one line closer than this (in font sizes) are
// one editable run; wider gaps are usually separate table columns.
const MAX_JOIN_GAP = 0.7;
// A gap wider than this between joined items stands for a space
const SPACE_GAP = 0.15;
const HIT_PADDING = 2;

interface FontInfo {
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  pdfFont?: string;
}

/** The parts of pdf.js's FontFaceObject used here */
interface PdfJsFont {
  name?: string;
  loadedName?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  isSerifFont?: boolean;
  isMonospace?: boolean;
  isType3Font?: boolean;
  disableFontFace?: boolean;
  fallbackName?: string;
  systemFontInfo?: { css?: string } | null;
}

function fontInfo(page: PDFPageProxy, fontName: string, style: TextStyle | undefined): FontInfo {
  let name = '';
  let serif = style?.fontFamily === 'serif';
  let mono = style?.fontFamily === 'monospace';
  let bold = false;
  let italic = false;
  try {
    // Loaded by the page render, which runs before text extraction
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as PdfJsFont;
      name = font.name ?? '';
      serif = serif || !!font.isSerifFont;
      mono = mono || !!font.isMonospace;
      bold = !!(font.bold || font.black);
      italic = !!font.italic;
    }
  } catch {
    // font not resolved -- fall back to the text-content style
  }
  if (/times|serif|georgia|garamond|cambria/i.test(name) && !/sans/i.test(name)) serif = true;
  if (/courier|mono|consol/i.test(name)) mono = true;
  if (/bold|black|heavy|semibold|demi/i.test(name)) bold = true;
  if (/italic|oblique/i.test(name)) italic = true;

  return {
    fontFamily: mono ? 'Courier' : serif ? 'Times New Roman' : 'Arial',
    bold,
    italic,
    pdfFont: name || undefined,
  };
}

/**
 * The PDF fonts pdf.js has loaded for this page's document, keyed by name,
 * each as pdf.js's canvas draws it (CanvasGraphics.setFont): the font is
 * registered with the browser under its loadedName. The fonts of erased
 * words are here too: their Tf operators are still in the page.
 */
export function loadedFonts(page: PDFPageProxy): Map<string, PdfFontFace> {
  const fonts = new Map<string, PdfFontFace>();
  for (const [, data] of page.commonObjs as unknown as Iterable<[string, unknown]>) {
    const font = data as PdfJsFont | null;
    // Type 3 glyphs and fonts the browser refused are drawn as paths
    if (!font?.name || !font.loadedName || font.isType3Font || font.disableFontFace) continue;
    if (fonts.has(font.name)) continue;
    fonts.set(font.name, {
      family: font.systemFontInfo?.css || `"${font.loadedName}", ${font.fallbackName ?? 'sans-serif'}`,
      weight: font.black ? '900' : font.bold ? 'bold' : 'normal',
      style: font.italic ? 'italic' : 'normal',
    });
  }
  return fonts;
}

function itemToRun(
  page: PDFPageProxy,
  viewport: PageViewport,
  item: TextItem,
  styles: Record<string, TextStyle>,
): PdfTextRun | null {
  const tx = Util.transform(viewport.transform, item.transform);
  const fontSize = Math.hypot(tx[2], tx[3]);
  if (!fontSize || !item.width) return null;

  const style = styles[item.fontName];
  if (style?.vertical) return null; // vertical CJK text isn't supported

  // Same ascent/descent estimate as pdf.js's own text layer
  let ascentRatio = 0.8;
  if (style?.ascent) ascentRatio = style.ascent;
  else if (style?.descent) ascentRatio = 1 + style.descent;
  const descentRatio = style?.descent ? Math.abs(style.descent) : 1 - ascentRatio;

  return {
    text: item.str,
    x: tx[4],
    y: tx[5],
    angle: (Math.atan2(tx[1], tx[0]) * 180) / Math.PI,
    width: item.width * viewport.scale,
    ascent: fontSize * ascentRatio,
    descent: fontSize * Math.max(0.15, descentRatio),
    fontSize,
    ...fontInfo(page, item.fontName, style),
  };
}

function direction(run: PdfTextRun): { dx: number; dy: number } {
  const a = (run.angle * Math.PI) / 180;
  return { dx: Math.cos(a), dy: Math.sin(a) };
}

/** Run-local coordinates: u along the text, v down from the baseline. */
function toLocal(run: PdfTextRun, px: number, py: number): { u: number; v: number } {
  const { dx, dy } = direction(run);
  const ox = px - run.x;
  const oy = py - run.y;
  return { u: ox * dx + oy * dy, v: -ox * dy + oy * dx };
}

/**
 * Appends `next` to `run` if it continues the same line in the same font.
 * `spaced`: a whitespace item came between them.
 */
function tryJoin(run: PdfTextRun, next: PdfTextRun, spaced: boolean): boolean {
  if (Math.abs(run.angle - next.angle) > 1) return false;
  if (Math.abs(run.fontSize - next.fontSize) > run.fontSize * 0.1) return false;
  if (run.fontFamily !== next.fontFamily || run.bold !== next.bold || run.italic !== next.italic) {
    return false;
  }
  const { u, v } = toLocal(run, next.x, next.y);
  if (Math.abs(v) > run.fontSize * 0.2) return false;
  const gap = u - run.width;
  if (gap < -run.fontSize * 0.5 || gap > run.fontSize * MAX_JOIN_GAP) return false;

  const needsSpace = (spaced || gap > run.fontSize * SPACE_GAP) && !/^\s/.test(next.text);
  run.text += (needsSpace ? ' ' : '') + next.text;
  run.width = u + next.width;
  run.ascent = Math.max(run.ascent, next.ascent);
  run.descent = Math.max(run.descent, next.descent);
  return true;
}

/** Text on the page grouped into editable runs (roughly: phrases on one line). */
export async function extractTextRuns(
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<PdfTextRun[]> {
  const content = await page.getTextContent();
  const runs: PdfTextRun[] = [];
  let current: PdfTextRun | null = null;
  let spaced = false;

  for (const raw of content.items) {
    if (!('str' in raw)) continue; // marked-content markers
    const item = raw as TextItem;

    // pdf.js inserts whitespace items that span the gap between strings,
    // even across table columns; they mark a space but never bridge runs
    if (!item.str.trim()) {
      spaced = true;
    } else {
      const run = itemToRun(page, viewport, item, content.styles);
      if (run && !(current && tryJoin(current, run, spaced))) {
        current = { ...run };
        runs.push(current);
      }
      spaced = false;
    }
    if (item.hasEOL) current = null;
  }

  for (const run of runs) run.text = run.text.trim();
  return runs.filter((r) => r.text);
}

/** The run under a page point, if any. */
export function findRunAt(runs: PdfTextRun[], px: number, py: number): PdfTextRun | null {
  // Last match wins: later text is drawn on top
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const { u, v } = toLocal(run, px, py);
    if (
      u >= -HIT_PADDING && u <= run.width + HIT_PADDING &&
      v >= -run.ascent - HIT_PADDING && v <= run.descent + HIT_PADDING
    ) {
      return run;
    }
  }
  return null;
}

/** Center of a point given in run-local (u, v) coordinates. */
export function runPoint(run: PdfTextRun, u: number, v: number): { x: number; y: number } {
  const { dx, dy } = direction(run);
  return { x: run.x + u * dx - v * dy, y: run.y + u * dy + v * dx };
}

// ── Color sampling ───────────────────────────────────────────────────────────

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Background = the most common color just outside the run's box; text = the
 * pixel inside the box that differs most from that background (glyph cores,
 * not their anti-aliased edges). `scale` maps viewport units to canvas pixels.
 */
export function sampleRunColors(
  canvas: HTMLCanvasElement,
  run: PdfTextRun,
  scale: number,
): SampledColors | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const margin = Math.max(2, run.fontSize * 0.15);
  const corners = [
    runPoint(run, -margin, -run.ascent - margin),
    runPoint(run, run.width + margin, -run.ascent - margin),
    runPoint(run, run.width + margin, run.descent + margin),
    runPoint(run, -margin, run.descent + margin),
  ];
  const xs = corners.map((p) => p.x * scale);
  const ys = corners.map((p) => p.y * scale);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys)));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 || h < 3) return null;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    return null;
  }
  const px = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };

  // Border ring: most common color, quantized so anti-aliasing doesn't split it
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const tally = (x: number, y: number) => {
    const [r, g, b] = px(x, y);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = counts.get(key);
    if (c) { c.n++; c.r += r; c.g += g; c.b += b; }
    else counts.set(key, { n: 1, r, g, b });
  };
  for (let x = 0; x < w; x++) { tally(x, 0); tally(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { tally(0, y); tally(w - 1, y); }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  const bg = [best.r / best.n, best.g / best.n, best.b / best.n];

  let ink: readonly number[] | null = null;
  let maxDist = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = px(x, y);
      const d = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
      if (d > maxDist) { maxDist = d; ink = c; }
    }
  }

  return {
    background: toHex(bg[0], bg[1], bg[2]),
    text: ink && maxDist > 900 ? toHex(ink[0], ink[1], ink[2]) : '#111827',
  };
}
