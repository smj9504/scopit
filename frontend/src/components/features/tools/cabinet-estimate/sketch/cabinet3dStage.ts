/**
 * The 3D view's stage, shared by the live view (Cabinet3DView) and its still
 * pictures for the PDF (cabinet3dSnapshot): the lights and the two looks, the
 * reflections and the raster passes, and where the camera stands.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export const BACKGROUND = '#f7f7f5';
export const REALISTIC_BACKGROUND = '#e7e4de';
/** The realistic sun: this far up from the horizon, turned this far from the camera, so it shines over the viewer's shoulder. */
const SUN_ELEVATION = (50 * Math.PI) / 180;
const SUN_TURN = (70 * Math.PI) / 180;
/** A standing person's eye, inches off the floor: the Eye level view's camera height. */
const EYE_HEIGHT_IN = 62;
/** The studio environment's strength in the raster look. */
export const ENVIRONMENT_INTENSITY = 0.45;

export interface ModelBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface StageLights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}

/** What setLook changes. */
export interface LookParts extends StageLights {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  environment: THREE.Texture;
}

/** Where the camera stands, and what it looks at. */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export function addLights(scene: THREE.Scene): StageLights {
  const hemi = new THREE.HemisphereLight('#ffffff', '#cfc8bc', 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#ffffff', 0.6);
  fill.position.set(400, 300, -300);
  scene.add(fill);
  return { hemi, sun, fill };
}

/** The raster look's light and reflections: a studio room, caught in a cube map. */
export function createEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; dispose: () => void } {
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const studio = new RoomEnvironment();
  new THREE.CubeCamera(0.1, 100, target).update(renderer, studio);
  studio.dispose();
  const texture = target.texture;
  texture.needsPMREMUpdate = true;
  return { texture, dispose: () => target.dispose() };
}

/** The raster view's passes: the scene, ambient occlusion (radius in inches), then tone and colour. */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): { composer: EffectComposer; dispose: () => void } {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 }));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, width, height);
  ao.updateGtaoMaterial({ radius: 16, thickness: 10, distanceExponent: 1, scale: 1.8, samples: 16 });
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  return {
    composer,
    dispose: () => {
      ao.dispose();
      composer.dispose();
    },
  };
}

/** Put the realistic sun over the camera's shoulder, its shadows covering the model. */
export function aimSun(sun: THREE.DirectionalLight, camera: THREE.Camera, center: THREE.Vector3, reach: number) {
  const turn = Math.atan2(camera.position.z - center.z, camera.position.x - center.x) + SUN_TURN;
  const far = reach * 2;
  sun.position.set(
    center.x + Math.cos(turn) * Math.cos(SUN_ELEVATION) * far,
    center.y + Math.sin(SUN_ELEVATION) * far,
    center.z + Math.sin(turn) * Math.cos(SUN_ELEVATION) * far
  );
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
}

/** Size the sun's shadows to the model; gives the model's middle and how far its farthest corner is from it. */
export function fitSunShadow(sun: THREE.DirectionalLight, bounds: ModelBounds): { center: THREE.Vector3; reach: number } {
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 40, (bounds.minZ + bounds.maxZ) / 2);
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 96) / 2 + 24;
  const shadow = sun.shadow.camera;
  shadow.left = -reach;
  shadow.right = reach;
  shadow.top = reach;
  shadow.bottom = -reach;
  shadow.near = 1;
  shadow.far = reach * 4;
  shadow.updateProjectionMatrix();
  return { center, reach };
}

/** Set the lights, tone and background for one look or the other. */
export function setLook({ renderer, scene, environment, hemi, sun, fill }: LookParts, realistic: boolean) {
  renderer.setClearColor(realistic ? REALISTIC_BACKGROUND : BACKGROUND);
  scene.environment = realistic ? environment : null;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  renderer.toneMapping = realistic ? THREE.AgXToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.1;
  hemi.intensity = realistic ? 0.3 : 2.2;
  sun.intensity = realistic ? 2.8 : 1.6;
  sun.castShadow = realistic;
  fill.intensity = realistic ? 0.2 : 0.6;
  if (!realistic) {
    sun.position.set(-300, 600, 400);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
  }
}

/** Stand in front of the doors, a little to one side and above, far enough back to see it all. */
export function overviewPose(bounds: ModelBounds, [fx, fz]: [number, number]): CameraPose {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 96);
  const distance = size * 1.3 + 48;
  const angle = Math.atan2(fz, fx) + 0.45;
  return {
    position: [cx + Math.cos(angle) * distance, distance * 0.7, cz + Math.sin(angle) * distance],
    target: [cx, 36, cz],
  };
}

/** Stand across the room from the doors at eye height, back far enough for the cabinets to fill the width: how a photo of the kitchen is taken. */
export function eyeLevelPose(bounds: ModelBounds, [fx, fz]: [number, number], fov: number, aspect: number): CameraPose {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  // Half the cabinets' spread across the line of sight.
  const half = (Math.abs(fz) * (bounds.maxX - bounds.minX) + Math.abs(fx) * (bounds.maxZ - bounds.minZ)) / 2;
  const halfWide = Math.atan(Math.tan(((fov / 2) * Math.PI) / 180) * aspect);
  const distance = Math.max(half / Math.tan(halfWide) * 1.1, 72);
  const angle = Math.atan2(fz, fx) + 0.12;
  return {
    position: [cx + Math.cos(angle) * distance, EYE_HEIGHT_IN, cz + Math.sin(angle) * distance],
    target: [cx, 44, cz],
  };
}
