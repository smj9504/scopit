/**
 * How the bathroom 3D view is lit and looked at, shared by the live view
 * (Bathroom3DView) and the still pictures for the PDFs and Compare
 * (bathroom3dSnapshot): the renderer's tone and shadows, a soft room for
 * chrome, glass and glazed tile to reflect, a sun over the room, and the two
 * standard camera spots — above the room from its front corner, and at eye
 * level in the doorway.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BathroomModel } from './bathroom3dModel';

export const BACKGROUND = '#f7f7f5';
export const OUTSIDE_FOV = 45;
/** A wider lens inside a small room, as a phone camera would see it. */
export const INSIDE_FOV = 68;
const EYE_HEIGHT_IN = 62;

export function setUpRenderer(renderer: THREE.WebGLRenderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  // Soft since r180 (PCFSoftShadowMap is deprecated there)
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/** A scene with the background, the soft room to reflect, sky light and a sun that casts shadows. */
export function createLitScene(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.4;
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8ba', 0.55));
  const sun = new THREE.DirectionalLight('#fff6e8', 1.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  return {
    scene,
    sun,
    dispose: () => {
      environment.dispose();
      pmrem.dispose();
    },
  };
}

/** Light from above and to one side, its shadows covering the room. */
export function aimSun(sun: THREE.DirectionalLight, model: BathroomModel) {
  if (!model.bounds) return;
  const { minX, maxX, minZ, maxZ } = model.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxZ - minZ, 96);
  sun.position.set(cx - size * 0.6, size * 2.2, cz + size * 0.9);
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();
  const half = size * 0.9;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: size * 6 });
  sun.shadow.camera.updateProjectionMatrix();
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Above the room from its front corner, far enough back to see all of it. */
export function overviewPose(model: BathroomModel): CameraPose | null {
  const b = model.bounds;
  if (!b) return null;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 72);
  return {
    position: new THREE.Vector3(cx + size * 0.75, size * 1.15 + 40, cz + size * 1.05),
    target: new THREE.Vector3(cx, 30, cz),
    fov: OUTSIDE_FOV,
  };
}

/** Standing in the doorway, past the open door's reach (or at the front of the room), looking in. */
export function eyeLevelPose(model: BathroomModel): CameraPose | null {
  const b = model.bounds;
  if (!b) return null;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  let from = new THREE.Vector3(cx, EYE_HEIGHT_IN, b.maxZ - 10);
  for (const w of model.walls) {
    const door = w.openings.find((o) => o.kind === 'door');
    if (!door || !w.inward) continue;
    const t = (door.rect.x0 + door.rect.x1) / 2 / (w.lengthIn || 1);
    from = new THREE.Vector3(
      w.a[0] + (w.b[0] - w.a[0]) * t + w.inward[0] * 40,
      EYE_HEIGHT_IN,
      w.a[1] + (w.b[1] - w.a[1]) * t + w.inward[1] * 40,
    );
    break;
  }
  const look = new THREE.Vector3(cx, 44, cz);
  // Past the middle of the room, toward the far wall
  look.add(look.clone().sub(from).setY(0).multiplyScalar(0.5));
  return { position: from, target: look, fov: INSIDE_FOV };
}

export function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose) {
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
}
