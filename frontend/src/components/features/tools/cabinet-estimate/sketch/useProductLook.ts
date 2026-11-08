/**
 * An option's chosen products over the sketch's finish, ready to draw:
 * productLook(), with each product's swatch picture loaded (a surface shows
 * the product's colour until its picture is in, or if it never loads).
 */

import { useEffect, useMemo, useState } from 'react';
import type { CabinetSketchFinish } from '@/types/cabinetSketch';
import type { ProductSnapshot } from '@/types/productLibrary';
import { productImageUrl } from '@/components/features/tools/cabinet-estimate/products/productImages';
import { productLook } from '@/components/features/tools/cabinet-estimate/sketch/productLook';
import type { ProductLookResult, ProductSurfaces } from '@/components/features/tools/cabinet-estimate/sketch/productLook';

/** How long a still picture waits for the swatches, ms; it goes with the products' colours after that. */
const SWATCH_WAIT_MS = 10000;

/** Pictures already loaded, by file id, for the page's lifetime. */
const loaded = new Map<string, HTMLImageElement>();

function loadSwatch(id: string, onLoaded: () => void) {
  // An object URL from our own API: same-origin, so WebGL may draw it
  productImageUrl(id).then(
    (url) => {
      const img = new Image();
      img.onload = () => {
        loaded.set(id, img);
        onLoaded();
      };
      img.onerror = onLoaded;
      img.src = url;
    },
    onLoaded,
  );
}

const withSwatches = (surfaces: ProductSurfaces): ProductSurfaces => {
  const out: ProductSurfaces = {};
  for (const [key, look] of Object.entries(surfaces) as [keyof ProductSurfaces, ProductSurfaces[keyof ProductSurfaces]][]) {
    if (!look) continue;
    out[key] = look.imageFileId ? { ...look, image: loaded.get(look.imageFileId) ?? null } : look;
  }
  return out;
};

const wantedSwatches = (surfaces: ProductSurfaces) =>
  Object.values(surfaces).map((s) => s?.imageFileId).filter((id): id is string => !!id);

export function useProductLook(
  finish: CabinetSketchFinish,
  products?: Record<string, ProductSnapshot> | null
): ProductLookResult {
  const base = useMemo(() => productLook(finish, products), [finish, products]);
  const [, setLoadedCount] = useState(loaded.size);

  const wanted = useMemo(() => wantedSwatches(base.surfaces), [base]);
  useEffect(() => {
    const live = { current: true };
    wanted
      .filter((id) => !loaded.has(id))
      .forEach((id) =>
        loadSwatch(id, () => {
          if (live.current) setLoadedCount(loaded.size);
        })
      );
    return () => {
      live.current = false;
    };
  }, [wanted]);

  const ready = wanted.filter((id) => loaded.has(id)).join(',');
  // `ready` changes as pictures arrive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const surfaces = useMemo(() => withSwatches(base.surfaces), [base, ready]);

  return useMemo(() => ({ ...base, surfaces }), [base, surfaces]);
}

/** The surfaces with their swatch pictures in, for a still picture, which can't draw again as they arrive. */
export async function surfacesWithSwatches(surfaces: ProductSurfaces): Promise<ProductSurfaces> {
  const missing = wantedSwatches(surfaces).filter((id) => !loaded.has(id));
  await Promise.race([
    Promise.all(missing.map((id) => new Promise<void>((done) => loadSwatch(id, done)))),
    new Promise((done) => window.setTimeout(done, SWATCH_WAIT_MS)),
  ]);
  return withSwatches(surfaces);
}
