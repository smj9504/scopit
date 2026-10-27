/**
 * Scopit - PDF Editor: canvas pixel density
 *
 * Phones and tablets give a canvas only so many pixels (iOS about 16
 * million, less once several are open); past that it stays blank. A zoomed
 * page there gets fewer pixels per point instead -- the cap pdf.js uses on
 * mobile.
 *
 * Usage:
 *   const ratio = canvasPixelRatio(cssWidth, cssHeight);
 *   canvas.width = Math.floor(cssWidth * ratio);
 */

const MOBILE_MAX_PIXELS = 5_242_880;

const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Device pixels per CSS pixel for a canvas this size */
export function canvasPixelRatio(cssWidth: number, cssHeight: number): number {
  const dpr = window.devicePixelRatio || 1;
  const area = cssWidth * cssHeight;
  if (!coarsePointer || area <= 0) return dpr;
  return Math.min(dpr, Math.sqrt(MOBILE_MAX_PIXELS / area));
}
