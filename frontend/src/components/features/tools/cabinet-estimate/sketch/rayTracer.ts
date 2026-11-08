/**
 * Ray-traced light for the 3D view's realistic look, from three-gpu-pathtracer's
 * WebGPU path tracer: once the camera rests, every frame adds samples of
 * light bouncing round the room — soft shadows under the uppers, light
 * spilling off the floor, true reflections in the countertop and steel —
 * and the picture sharpens toward a photo. While the camera moves the
 * raster view shows, so turning stays smooth.
 *
 * It draws on a canvas of its own, a WebGPU one laid over the raster view's
 * WebGL canvas and shown once the picture has a few samples. Both read the
 * same scene: three's WebGL and WebGPU builds share one core.
 *
 * Measured on a laptop's Intel Iris Xe under Windows: the first traced
 * picture about five seconds after it is switched on, cold (the WebGL path
 * tracer this replaced took 30–100 s to build its shader), then two to
 * three samples a second at that screen's size.
 *
 * WebGPU only: where the browser has none, loadRayTracer gives null and the
 * raster view is all there is. Loaded only when first switched on
 * (import()), as the tracer is large.
 */

import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';

/** Samples per pixel at which the picture counts as finished, and the tracing rests. */
export const RAY_SAMPLES = 160;
/** Samples per pixel before the traced picture replaces the raster one. */
export const RAY_SHOW_SAMPLES = 3;

export interface RayTracer {
  /** The tracer's canvas, to lay over the raster view's. */
  canvas: HTMLCanvasElement;
  renderer: WebGPURenderer;
  tracer: WebGPUPathTracer;
  /** A soft sky, the tracer's environment: it needs an equirectangular map, not the raster view's prefiltered one. */
  sky: THREE.DataTexture;
}

/** Whether this browser offers WebGPU at all; it may still turn out to have no adapter. */
export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

/** An equirectangular sky, warm white overhead fading to a darker floor colour below. */
function skyTexture(): THREE.DataTexture {
  const w = 64;
  const h = 32;
  const data = new Float32Array(w * h * 4);
  const top = new THREE.Color('#ffffff');
  const bottom = new THREE.Color('#8a8278');
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    // Row 0 is straight down, the last row straight up.
    c.lerpColors(bottom, top, (y / (h - 1)) ** 2);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 1;
    }
  }
  const sky = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.magFilter = THREE.LinearFilter;
  sky.minFilter = THREE.LinearFilter;
  sky.needsUpdate = true;
  return sky;
}

/** A path tracer on a canvas of its own, `width` × `height` CSS px; null where there is no WebGPU. */
export async function loadRayTracer(width: number, height: number, pixelRatio: number): Promise<RayTracer | null> {
  if (!hasWebGPU()) return null;
  const [{ WebGPURenderer, AgXToneMapping }, { WebGPUPathTracer }] = await Promise.all([
    import('three/webgpu'),
    import('three-gpu-pathtracer/webgpu'),
  ]);
  const canvas = document.createElement('canvas');
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  try {
    await renderer.init();
  } catch {
    renderer.dispose();
    return null;
  }
  // WebGPURenderer falls back to WebGL where there is no adapter; the tracer can't run there.
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    renderer.dispose();
    return null;
  }
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.1;

  const tracer = new WebGPUPathTracer(renderer);
  // The raster view covers the wait and the moves; this canvas only shows a picture that has samples.
  tracer.renderDelay = 0;
  tracer.dynamicLowRes = false;
  tracer.fadeDuration = 0;
  tracer.minSamples = 1;
  tracer.maxSamples = RAY_SAMPLES;
  // Enough bounces to carry light under the uppers and into the toe kicks.
  tracer.maxBounces = 4;
  // Softens fireflies off the glossy countertops and steel.
  tracer.filterGlossyFactor = 0.5;
  // At CSS pixels: a high-DPI screen would otherwise cost four times as much.
  tracer.renderScale = 1 / pixelRatio;
  return { canvas, renderer, tracer, sky: skyTexture() };
}

export function disposeRayTracer({ canvas, renderer, tracer, sky }: RayTracer) {
  tracer.dispose();
  renderer.dispose();
  sky.dispose();
  canvas.remove();
}
