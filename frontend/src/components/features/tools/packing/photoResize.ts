/**
 * Scopit - Packing photo downscaling helpers
 *
 * Every path that turns a user-picked file into a base64 photo goes through
 * here, because the raw originals are far larger than anything downstream
 * needs and holding several of them at once is what actually breaks imports.
 *
 * Two separate costs motivate this:
 *
 * 1. Peak browser memory. A 4K PNG screenshot is ~10-20MB (lossless, so much
 *    larger than a JPEG photo of the same scene), and its base64 string is
 *    ~1.37x that in characters — which JS stores as UTF-16, so ~2.7x the
 *    original in bytes. Reading a room's photos concurrently multiplies that
 *    by the photo count; the allocation can fail outright, and a rejected
 *    FileReader used to take the whole import down with it.
 *
 * 2. Request size. Uncompressed originals were posted verbatim to
 *    /photos/upload, so one room could be a ~30MB request, and every room
 *    fired at once. That is the upstream source of the memory pressure the
 *    backend export path has repeatedly had to defend against.
 *
 * Downscaling here fixes both at the source. Claude Vision downsamples
 * images before analysis anyway, so IMPORT_PHOTO_MAX_DIMENSION is chosen to
 * be comfortably above what analysis resolves, not to preserve the original.
 */

export const IMPORT_PHOTO_MAX_DIMENSION = 1600;
export const IMPORT_PHOTO_JPEG_QUALITY = 0.8;

/** Read a File as a data URL. Rejects if the file can't be read. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale a data URL to fit within `maxDimension`, re-encoded as JPEG.
 *
 * Never rejects: if the image can't be decoded or canvas is unavailable, the
 * original data URL is returned unchanged. A photo that is merely too large
 * is still a usable photo, so failing to shrink it must not fail the import.
 */
export function resizeDataUrl(
  dataUrl: string,
  maxDimension: number = IMPORT_PHOTO_MAX_DIMENSION,
  quality: number = IMPORT_PHOTO_JPEG_QUALITY,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        if (scale === 1) {
          resolve(dataUrl); // already small enough — don't re-encode
          return;
        }
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl); // canvas unsupported — fall back to original
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl); // e.g. canvas allocation failed — keep the original
      }
    };
    img.onerror = () => resolve(dataUrl); // decode failed — fall back to original
    img.src = dataUrl;
  });
}

/** Strip the "data:...;base64," prefix, yielding the raw base64 payload. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Read one File and downscale it, returning the raw base64 payload (no data
 * URL prefix) that the packing APIs expect.
 */
export async function fileToResizedBase64(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const resized = await resizeDataUrl(dataUrl);
  return dataUrlToBase64(resized);
}
