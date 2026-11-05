/**
 * Web Worker: read a USGS LAS/LAZ tile the user dropped in and keep only the points inside a box
 * around the address (raw integer coordinates, computed by the backend from the tile header).
 *
 * LAZ is decompressed with laz-perf (LASzip compiled to WASM). A tile is ~30 million points, so
 * this runs off the main thread; only the few hundred thousand points near the house are returned.
 *
 * Output: one ArrayBuffer, struct-of-arrays: int32 X[n], Y[n], Z[n], then uint8 class[n],
 * returnNumber[n], numberOfReturns[n].
 */
import createLazPerf from 'laz-perf/lib/worker/laz-perf.js';
import wasmUrl from 'laz-perf/lib/worker/laz-perf.wasm?url';

export interface LazJob {
  file: File;
  box: [number, number, number, number];
  compressed: boolean;
  pointOffset: number;
  pointLength: number;
  pointFormat: number;
  pointCount: number;
}

export type LazMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; buffer: ArrayBuffer; count: number }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  postMessage: (m: LazMessage, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<LazJob>) => void) | null;
};

const READ_CHUNK = 16 * 1024 * 1024;

/** Growable column store for the kept points. */
class Kept {
  n = 0;
  cap = 1 << 18;
  x = new Int32Array(this.cap);
  y = new Int32Array(this.cap);
  z = new Int32Array(this.cap);
  c = new Uint8Array(this.cap);
  r = new Uint8Array(this.cap);
  nr = new Uint8Array(this.cap);

  push(x: number, y: number, z: number, c: number, r: number, nr: number) {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.c[i] = c; this.r[i] = r; this.nr[i] = nr;
  }

  private grow() {
    this.cap *= 2;
    const g32 = (a: Int32Array) => { const b = new Int32Array(this.cap); b.set(a); return b; };
    const g8 = (a: Uint8Array) => { const b = new Uint8Array(this.cap); b.set(a); return b; };
    this.x = g32(this.x); this.y = g32(this.y); this.z = g32(this.z);
    this.c = g8(this.c); this.r = g8(this.r); this.nr = g8(this.nr);
  }

  pack(): ArrayBuffer {
    const n = this.n;
    const out = new ArrayBuffer(n * 15);
    new Int32Array(out, 0, n).set(this.x.subarray(0, n));
    new Int32Array(out, 4 * n, n).set(this.y.subarray(0, n));
    new Int32Array(out, 8 * n, n).set(this.z.subarray(0, n));
    const b = new Uint8Array(out, 12 * n);
    b.set(this.c.subarray(0, n), 0);
    b.set(this.r.subarray(0, n), n);
    b.set(this.nr.subarray(0, n), 2 * n);
    return out;
  }
}

/** Return number, number of returns and class from a point record (LAS 1.0-1.4 layouts). */
function attrs(bytes: Uint8Array, at: number, format: number): [number, number, number] {
  const b14 = bytes[at + 14];
  if (format >= 6) return [b14 & 0x0f, b14 >> 4, bytes[at + 16]];
  return [b14 & 0x07, (b14 >> 3) & 0x07, bytes[at + 15] & 0x1f];
}

async function readLaz(job: LazJob, kept: Kept) {
  const [x0, y0, x1, y1] = job.box;
  const mod = await createLazPerf({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) });
  const size = job.file.size;
  const filePtr = mod._malloc(size);
  if (!filePtr) throw new Error('Not enough memory to open this tile in the browser.');
  const laszip = new mod.LASZip();
  const pointPtr = mod._malloc(64);
  try {
    for (let off = 0; off < size; off += READ_CHUNK) {
      const part = new Uint8Array(await job.file.slice(off, Math.min(size, off + READ_CHUNK)).arrayBuffer());
      mod.HEAPU8.set(part, filePtr + off);
    }
    laszip.open(filePtr, size);
    const total = laszip.getCount();
    const format = laszip.getPointFormat();
    let heap8 = mod.HEAPU8;
    let heap32 = new Int32Array(heap8.buffer);
    const p32 = pointPtr >> 2;
    for (let i = 0; i < total; i++) {
      laszip.getPoint(pointPtr);
      if (heap8.buffer !== mod.HEAPU8.buffer) { heap8 = mod.HEAPU8; heap32 = new Int32Array(heap8.buffer); }
      const x = heap32[p32];
      const y = heap32[p32 + 1];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const [r, nr, c] = attrs(heap8, pointPtr, format);
        kept.push(x, y, heap32[p32 + 2], c, r, nr);
      }
      if ((i & 0xfffff) === 0) ctx.postMessage({ type: 'progress', done: i, total });
    }
  } finally {
    laszip.delete();
    mod._free(pointPtr);
    mod._free(filePtr);
  }
}

async function readLas(job: LazJob, kept: Kept) {
  const [x0, y0, x1, y1] = job.box;
  const len = job.pointLength;
  const perChunk = Math.max(1, Math.floor(READ_CHUNK / len));
  for (let i = 0; i < job.pointCount; i += perChunk) {
    const count = Math.min(perChunk, job.pointCount - i);
    const start = job.pointOffset + i * len;
    const buf = await job.file.slice(start, start + count * len).arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    for (let k = 0; k < count; k++) {
      const at = k * len;
      const x = view.getInt32(at, true);
      const y = view.getInt32(at + 4, true);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const [r, nr, c] = attrs(bytes, at, job.pointFormat);
        kept.push(x, y, view.getInt32(at + 8, true), c, r, nr);
      }
    }
    ctx.postMessage({ type: 'progress', done: i + count, total: job.pointCount });
  }
}

ctx.onmessage = async (e: MessageEvent<LazJob>) => {
  const kept = new Kept();
  try {
    if (e.data.compressed) await readLaz(e.data, kept);
    else await readLas(e.data, kept);
    const buffer = kept.pack();
    ctx.postMessage({ type: 'done', buffer, count: kept.n }, [buffer]);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
