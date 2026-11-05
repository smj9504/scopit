/**
 * Reading a dropped USGS LAS/LAZ tile on the main thread: the header (sent to the backend, which
 * knows coordinate systems) and the hand-off to the decompression worker.
 */
import type { LazJob, LazMessage } from './lazWorker';

export class TileReadError extends Error {
  name = 'TileReadError';
}

export interface TileHeader {
  headerBytes: Uint8Array;        // file start up to the point data (header + VLRs)
  evlrBytes: Uint8Array | null;   // LAS 1.4 extended VLRs at the end of the file (CRS may live there)
  compressed: boolean;
  pointOffset: number;
  pointLength: number;
  pointFormat: number;
  pointCount: number;
}

const MAX_EVLR_BYTES = 4 * 1024 * 1024;

export async function readTileHeader(file: File): Promise<TileHeader> {
  const head = new DataView(await file.slice(0, 375).arrayBuffer());
  const sig = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
  if (head.byteLength < 227 || sig !== 'LASF') {
    throw new TileReadError(`${file.name} is not a LAS/LAZ point cloud file.`);
  }
  const major = head.getUint8(24);
  const minor = head.getUint8(25);
  const pointOffset = head.getUint32(96, true);
  const formatByte = head.getUint8(104);
  const pointLength = head.getUint16(105, true);
  let pointCount = head.getUint32(107, true);
  let evlrBytes: Uint8Array | null = null;
  if ((major > 1 || minor >= 4) && head.byteLength >= 255) {
    const startEvlr = Number(head.getBigUint64(235, true));
    const nEvlr = head.getUint32(243, true);
    pointCount = Number(head.getBigUint64(247, true)) || pointCount;
    if (nEvlr > 0 && startEvlr > 0 && file.size - startEvlr <= MAX_EVLR_BYTES) {
      evlrBytes = new Uint8Array(await file.slice(startEvlr).arrayBuffer());
    }
  }
  return {
    headerBytes: new Uint8Array(await file.slice(0, pointOffset).arrayBuffer()),
    evlrBytes,
    compressed: (formatByte & 0xc0) !== 0,
    pointOffset,
    pointLength,
    pointFormat: formatByte & 0x3f,
    pointCount,
  };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}

/** Decompress the tile in a worker and keep the points inside `box`. */
export function extractPoints(
  file: File,
  header: TileHeader,
  box: [number, number, number, number],
  onProgress: (fraction: number) => void,
): Promise<{ buffer: ArrayBuffer; count: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lazWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<LazMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.total ? m.done / m.total : 0);
      else {
        worker.terminate();
        if (m.type === 'done') resolve({ buffer: m.buffer, count: m.count });
        else reject(new TileReadError(`Could not read ${file.name}: ${m.message}`));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new TileReadError(`Could not read ${file.name}: ${e.message || 'the browser stopped the reader'}`));
    };
    const job: LazJob = {
      file,
      box,
      compressed: header.compressed,
      pointOffset: header.pointOffset,
      pointLength: header.pointLength,
      pointFormat: header.pointFormat,
      pointCount: header.pointCount,
    };
    worker.postMessage(job);
  });
}
