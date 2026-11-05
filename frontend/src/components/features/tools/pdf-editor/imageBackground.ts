/**
 * Scopit - PDF Editor: take the background out of a picture
 *
 * For a photo or scan of a stamp, seal, logo or signature: the paper (or
 * whatever plain color it sits on) becomes transparent, so only the mark
 * lands on the page. Runs in the browser, on the picture's own pixels.
 *
 * The background is the color around the picture's edges. A photo is rarely
 * lit evenly, so that color is followed across the picture -- cell by cell,
 * from the pixels in each that look like it -- and each pixel is measured
 * against the background where it is. Pixels close to it go; a band past
 * that fades out, and the edge pixels that stay lose the background's tint.
 *
 * Usage:
 *   const img = await loadImage(dataUrl);
 *   const canvas = imageToCanvas(img, 1200);
 *   const cut = trimTransparent(removeBackground(canvas, 50));
 *   cut.toDataURL('image/png');
 */

/** Distance (RGB) at strength 0 and 100 below which a pixel is background */
const CUTOFF_MIN = 12;
const CUTOFF_MAX = 110;
/** Width of the fade past the cutoff */
const FADE = 36;
/** How far from the edge color a pixel may be and still describe the background around it */
const BACKGROUND_SPREAD = 90;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This picture could not be opened'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('This file could not be read'));
    reader.readAsDataURL(file);
  });
}

/** The picture on a canvas, scaled down to fit `maxSide` pixels */
export function imageToCanvas(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * A copy of `source` with its background made transparent. `strength`
 * (0-100) is how far from the background color a pixel can be and still go.
 */
export function removeBackground(source: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const srcCtx = source.getContext('2d', { willReadFrequently: true });
  const outCtx = out.getContext('2d');
  if (!srcCtx || !outCtx) throw new Error('Could not get 2d context');
  const pixels = srcCtx.getImageData(0, 0, w, h);
  const d = pixels.data;

  // The background: the usual color of a band around the edges
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  // About 4000 samples, however big the picture
  const step = Math.max(1, Math.round((2 * (w + h) * band) / 4000));
  const er: number[] = [];
  const eg: number[] = [];
  const eb: number[] = [];
  const ea: number[] = [];
  let n = 0;
  const sample = (x: number, y: number) => {
    if (n++ % step) return;
    const i = (y * w + x) * 4;
    er.push(d[i]);
    eg.push(d[i + 1]);
    eb.push(d[i + 2]);
    ea.push(d[i + 3]);
  };
  for (let y = 0; y < h; y++) {
    if (y < band || y >= h - band) {
      for (let x = 0; x < w; x++) sample(x, y);
    } else {
      for (let x = 0; x < Math.min(band, w); x++) sample(x, y);
      for (let x = Math.max(band, w - band); x < w; x++) sample(x, y);
    }
  }
  // Already cut out (a transparent PNG): nothing to take away
  if (median(ea) < 128) {
    outCtx.drawImage(source, 0, 0);
    return out;
  }
  const bg = [median(er), median(eg), median(eb)];

  // The background where each cell is: its pixels that look like the edges'
  const cell = Math.max(8, Math.round(Math.max(w, h) / 16));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh * 3);
  const known = new Uint8Array(gw * gh);
  const spread2 = BACKGROUND_SPREAD * BACKGROUND_SPREAD;
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      let seen = 0;
      const y1 = Math.min(h, (cy + 1) * cell);
      const x1 = Math.min(w, (cx + 1) * cell);
      for (let y = cy * cell; y < y1; y += 2) {
        for (let x = cx * cell; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          seen++;
          const dr = d[i] - bg[0];
          const dg = d[i + 1] - bg[1];
          const db = d[i + 2] - bg[2];
          if (dr * dr + dg * dg + db * db > spread2) continue;
          sr += d[i];
          sg += d[i + 1];
          sb += d[i + 2];
          count++;
        }
      }
      const k = cy * gw + cx;
      if (count >= Math.max(4, seen * 0.15)) {
        grid[k * 3] = sr / count;
        grid[k * 3 + 1] = sg / count;
        grid[k * 3 + 2] = sb / count;
        known[k] = 1;
      }
    }
  }
  // Cells covered by the mark take the background from their neighbors
  for (let pass = 0, missing = true; missing && pass < gw + gh; pass++) {
    missing = false;
    const filled: number[] = [];
    for (let k = 0; k < gw * gh; k++) {
      if (known[k]) continue;
      const cx = k % gw;
      const cy = (k - cx) / gw;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const nk = ny * gw + nx;
          if (known[nk] !== 1) continue;
          sr += grid[nk * 3];
          sg += grid[nk * 3 + 1];
          sb += grid[nk * 3 + 2];
          count++;
        }
      }
      if (count) {
        grid[k * 3] = sr / count;
        grid[k * 3 + 1] = sg / count;
        grid[k * 3 + 2] = sb / count;
        filled.push(k);
      } else {
        missing = true;
      }
    }
    for (const k of filled) known[k] = 1;
  }
  for (let k = 0; k < gw * gh; k++) {
    if (known[k]) continue;
    grid[k * 3] = bg[0];
    grid[k * 3 + 1] = bg[1];
    grid[k * 3 + 2] = bg[2];
  }

  // Each pixel against the background where it is (between cell centers)
  const cutoff = CUTOFF_MIN + (CUTOFF_MAX - CUTOFF_MIN) * (Math.max(0, Math.min(100, strength)) / 100);
  const colIdx = new Int32Array(w);
  const colFrac = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const g = Math.max(0, Math.min(gw - 1, (x + 0.5) / cell - 0.5));
    colIdx[x] = Math.min(gw - 2, Math.floor(g));
    colFrac[x] = gw > 1 ? g - colIdx[x] : 0;
    if (gw === 1) colIdx[x] = 0;
  }
  const local = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const gy = Math.max(0, Math.min(gh - 1, (y + 0.5) / cell - 0.5));
    const r0 = gh > 1 ? Math.min(gh - 2, Math.floor(gy)) : 0;
    const fy = gh > 1 ? gy - r0 : 0;
    const r1 = gh > 1 ? r0 + 1 : 0;
    for (let x = 0; x < w; x++) {
      const c0 = colIdx[x];
      const c1 = gw > 1 ? c0 + 1 : 0;
      const fx = colFrac[x];
      const k00 = (r0 * gw + c0) * 3;
      const k01 = (r0 * gw + c1) * 3;
      const k10 = (r1 * gw + c0) * 3;
      const k11 = (r1 * gw + c1) * 3;
      for (let c = 0; c < 3; c++) {
        const top = grid[k00 + c] + (grid[k01 + c] - grid[k00 + c]) * fx;
        const bottom = grid[k10 + c] + (grid[k11 + c] - grid[k10 + c]) * fx;
        local[c] = top + (bottom - top) * fy;
      }
      const i = (y * w + x) * 4;
      const dr = d[i] - local[0];
      const dg = d[i + 1] - local[1];
      const db = d[i + 2] - local[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const keep = Math.max(0, Math.min(1, (dist - cutoff) / FADE));
      if (keep >= 1) continue;
      d[i + 3] = Math.round(d[i + 3] * keep);
      if (keep > 0) {
        // What's left of an edge pixel, without the background showing through
        for (let c = 0; c < 3; c++) {
          d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - (1 - keep) * local[c]) / keep)));
        }
      }
    }
  }
  outCtx.putImageData(pixels, 0, 0);
  return out;
}

/** `source` cut down to what isn't transparent, with `pad` pixels around it */
export function trimTransparent(source: HTMLCanvasElement, pad = 4): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return source; // all of it went: leave the size alone
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(w, maxX + 1 + pad);
  const y1 = Math.min(h, maxY + 1 + pad);
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return source;
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d')?.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
