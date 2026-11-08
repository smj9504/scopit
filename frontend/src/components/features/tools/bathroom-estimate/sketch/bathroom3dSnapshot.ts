/**
 * Still pictures of bathroom sketches in 3D, for the PDFs and the Compare
 * drawer: drawn off screen with the same lighting and camera spots as the 3D
 * view, one renderer for all of them. Imported on demand, so three.js loads
 * only when a picture is wanted.
 */

import * as THREE from 'three';
import type { BESketchData } from '@/types/bathroomSketch';
import { bathroomModel, type FinishView } from './bathroom3dModel';
import { buildBathroomScene, disposeScene, updateCutaway } from './bathroom3dScene';
import { aimSun, applyPose, createLitScene, eyeLevelPose, overviewPose, setUpRenderer } from './bathroom3dStage';
import { TileTextureCache } from './bathroom3dTextures';
import { productImageUrl } from '@/components/features/tools/cabinet-estimate/products/productImages';

export interface SnapshotSubject {
  key: string;
  sketch?: BESketchData | null;
  /** The estimate: its specs give the tile, tops and metal finish. */
  estimate?: Record<string, any> | null;
}

export interface SnapshotOptions {
  width?: number;
  height?: number;
  pose?: 'overview' | 'eye';
  view?: FinishView;
  /** JPEG keeps a PDF's pictures small. */
  type?: 'image/jpeg' | 'image/png';
  quality?: number;
}

/** A sketch worth picturing: something drawn. */
export const hasSketch = (sketch?: BESketchData | null): sketch is BESketchData =>
  !!sketch && ((sketch.walls?.length ?? 0) > 0 || (sketch.fixtures?.length ?? 0) > 0);

/**
 * One picture per subject with a sketch, as base64 (no data: prefix), by key.
 * Subjects with nothing drawn, or a browser without WebGL, give none.
 */
export async function renderBathroomSnapshots(
  subjects: SnapshotSubject[],
  {
    width = 1200,
    height = 800,
    pose = 'overview',
    view = 'after',
    type = 'image/jpeg',
    quality = 0.86,
  }: SnapshotOptions = {},
): Promise<Record<string, string>> {
  const drawn = subjects.filter((s) => hasSketch(s.sketch));
  if (!drawn.length) return {};
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      canvas: document.createElement('canvas'),
    });
  } catch {
    return {};
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  setUpRenderer(renderer);
  const { scene, sun, dispose: disposeLights } = createLitScene(renderer);
  const camera = new THREE.PerspectiveCamera(45, width / height, 1, 6000);
  const textures = new TileTextureCache({
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
    imageUrl: productImageUrl,
  });
  const out: Record<string, string> = {};

  try {
    for (const subject of drawn) {
      const model = bathroomModel(subject.sketch!, subject.estimate, view);
      const at = pose === 'eye' ? eyeLevelPose(model) : overviewPose(model);
      if (!at) continue;
      const built = buildBathroomScene(model, textures);
      scene.add(built.root);
      aimSun(sun, model);
      applyPose(camera, at);
      updateCutaway(built, camera);
      // A picked tile's surface picture
      await textures.ready();
      renderer.render(scene, camera);
      out[subject.key] = renderer.domElement.toDataURL(type, quality).replace(/^data:image\/\w+;base64,/, '');
      scene.remove(built.root);
      disposeScene(built.root);
    }
  } finally {
    textures.dispose();
    disposeLights();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
