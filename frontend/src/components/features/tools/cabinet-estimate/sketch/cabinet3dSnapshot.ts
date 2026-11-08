/**
 * Still pictures of a kitchen in 3D, for the design quote: drawn off screen
 * with the 3D view's lighting and camera spots, without the ray tracer (it
 * takes a minute to get ready). Imported on demand, so three.js loads only
 * when a picture is wanted.
 */

import * as THREE from 'three';
import {
  applianceExtent,
  applianceSolids,
  cabinetSolids,
  islandFillerSolids,
  islandTopSlabs,
  mainFacing,
  modelBounds,
  wallSolids,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import { buildCabinetScene, cutAwayWalls, disposeScene } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dScene';
import {
  addLights,
  aimSun,
  createComposer,
  createEnvironment,
  eyeLevelPose,
  fitSunShadow,
  overviewPose,
  setLook,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dStage';
import type { CameraPose } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dStage';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { KitchenDrawingInput } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawingModel';
import { surfacesWithSwatches } from '@/components/features/tools/cabinet-estimate/sketch/useProductLook';

/** A little wider than 16:9: across the full width of a letter page, it leaves room under it on the first page. */
const WIDTH_PX = 1600;
const HEIGHT_PX = 850;
const FIELD_OF_VIEW = 40;
const JPEG_QUALITY = 0.88;
const NOTHING_SELECTED = new Set<string>();

export interface KitchenView {
  label: string;
  /** JPEG, base64 with no data: prefix. */
  image: string;
}

/**
 * The kitchen at eye height, as a photo of it would be taken, then from above.
 * None when there is nothing to show or the browser has no WebGL.
 */
export async function renderKitchenViews(
  input: KitchenDrawingInput,
  presets: PresetCatalog,
  realistic: boolean
): Promise<KitchenView[]> {
  const { cabinets, walls, appliances, scalePixelsPerFoot: scale } = input;
  const solids = cabinetSolids(cabinets, presets, scale, input.sinkBowls);
  const wallModels = wallSolids(walls, scale);
  const applianceModels = applianceSolids(appliances, cabinets, presets, scale);
  const overall = modelBounds(solids, wallModels, applianceExtent(applianceModels));
  if (!overall) return [];
  const surfaces = realistic ? await surfacesWithSwatches(input.surfaces) : null;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.createElement('canvas') });
  } catch {
    return [];
  }
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH_PX, HEIGHT_PX, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const lights = addLights(scene);
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, WIDTH_PX / HEIGHT_PX, 1, 10000);
  const { texture: environment, dispose: disposeEnvironment } = createEnvironment(renderer);
  const { composer, dispose: disposeComposer } = createComposer(renderer, scene, camera, WIDTH_PX, HEIGHT_PX);
  setLook({ renderer, scene, environment, ...lights }, realistic);
  const { center, reach } = fitSunShadow(lights.sun, overall);

  const content = buildCabinetScene(solids, wallModels, NOTHING_SELECTED, {
    counters: islandTopSlabs(solids, scale, input.islandSeatingIn),
    fillers: islandFillerSolids(solids, scale),
    appliances: applianceModels,
    finish: realistic ? input.finish : null,
    surfaces,
    crown: input.crownMolding,
    archedDoors: input.archedDoors,
  });
  scene.add(content);

  const shoot = ({ position, target }: CameraPose): string => {
    camera.position.set(...position);
    camera.lookAt(...target);
    camera.updateMatrixWorld();
    if (realistic) {
      cutAwayWalls(content, camera);
      aimSun(lights.sun, camera, center, reach);
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
    // Read before the frame is handed to the page, which clears the canvas.
    return renderer.domElement.toDataURL('image/jpeg', JPEG_QUALITY).replace(/^data:image\/\w+;base64,/, '');
  };

  try {
    const facing = mainFacing(solids);
    const views: KitchenView[] = [];
    const cabinetsOnly = modelBounds(solids, [], applianceExtent(applianceModels));
    if (cabinetsOnly) {
      views.push({
        label: 'At eye level',
        image: shoot(eyeLevelPose(cabinetsOnly, facing, FIELD_OF_VIEW, WIDTH_PX / HEIGHT_PX)),
      });
    }
    views.push({ label: 'Overview', image: shoot(overviewPose(overall, facing)) });
    return views;
  } finally {
    disposeScene(content);
    disposeComposer();
    disposeEnvironment();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
