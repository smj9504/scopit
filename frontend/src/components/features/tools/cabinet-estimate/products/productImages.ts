/**
 * Stored product pictures (GET /api/products/images/{file_id}).
 *
 * The API needs the signed-in user's token, which an <img src> can't send,
 * so a picture is fetched through the API client and shown from an object
 * URL. Each picture is fetched once per page lifetime. (MJ Estimate served
 * them from its file service by URL; this stands in for that.)
 */
import { useEffect, useState } from 'react';
import api from '@/services/api';

const urls = new Map<string, Promise<string>>();

/** A product picture as an object URL, fetched once. Rejects if it can't be had. */
export function productImageUrl(fileId: string): Promise<string> {
  let url = urls.get(fileId);
  if (!url) {
    url = api
      .get(`/products/images/${fileId}`, { responseType: 'blob' })
      .then((r) => URL.createObjectURL(r.data as Blob));
    // A failure isn't kept: the next ask tries again
    url.catch(() => urls.delete(fileId));
    urls.set(fileId, url);
  }
  return url;
}

/** The object URL of a product picture once it's in; undefined until then (or if it never loads). */
export function useProductImage(fileId?: string | null): string | undefined {
  const [src, setSrc] = useState<string | undefined>();
  useEffect(() => {
    setSrc(undefined);
    if (!fileId) return;
    let live = true;
    productImageUrl(fileId).then(
      (url) => live && setSrc(url),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [fileId]);
  return src;
}
