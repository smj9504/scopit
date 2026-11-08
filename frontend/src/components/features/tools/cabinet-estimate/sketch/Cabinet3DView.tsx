/**
 * Cabinet3DView
 *
 * The sketch in 3D: the plan's cabinets stood up at their real sizes, with
 * doors, drawers, glass, countertops, sinks, the detach & reset appliances
 * and the drawn walls. Drag to orbit,
 * scroll to zoom, right-drag to pan; click a cabinet to select it (Ctrl /
 * Cmd adds to the selection), click empty space to deselect.
 *
 * Two looks (see cabinet3dScene.ts): the drawing look, flat and outlined
 * like the Front view, and — given a `finish` — the realistic one, under a
 * sun that casts shadows and follows the camera round, with reflections
 * from a studio environment and ambient occlusion in the corners. In the
 * realistic look, ray-traced light (rayTracer.ts, on unless turned off)
 * takes over whenever the camera rests: a WebGPU canvas over the raster
 * one fades in as the picture sharpens toward a photo, and drops away the
 * moment the camera moves. The realistic view is what `capture` hands the
 * AI photo.
 *
 * View-only like the Front view: cabinets are moved in the plan and sized
 * in the Edit tab. Plain three.js rather than a React renderer — the scene
 * is rebuilt whole whenever the sketch or selection changes (a kitchen is
 * a few hundred meshes), and drawn only when something changes.
 *
 * Loaded lazily by CabinetSketchEditor, so three.js is only downloaded
 * when the 3D view is opened.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, Switch, Tooltip } from 'antd';
import { AimOutlined, EyeOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type {
  CabinetSketchAppliance,
  CabinetSketchCabinet,
  CabinetSketchFinish,
  CabinetSketchWall,
} from '@/types/cabinetSketch';
import type { PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
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
import { WALL_HEIGHT_IN, buildCabinetScene, cabinetIdOf, cutAwayWalls, disposeScene } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dScene';
import {
  ENVIRONMENT_INTENSITY,
  REALISTIC_BACKGROUND,
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
import { RAY_SAMPLES, RAY_SHOW_SAMPLES, disposeRayTracer, hasWebGPU, loadRayTracer } from '@/components/features/tools/cabinet-estimate/sketch/rayTracer';
import type { RayTracer } from '@/components/features/tools/cabinet-estimate/sketch/rayTracer';
import type { ProductSurfaces } from '@/components/features/tools/cabinet-estimate/sketch/productLook';
import { faceKeepsFromText, faceKeepsText } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import type { BacksplashSpec } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';

const NO_APPLIANCES: CabinetSketchAppliance[] = [];
/** How far (screen px) the pointer may move between press and release and still count as a click. */
const CLICK_SLOP_PX = 4;
/** Width of a captured image, px; its height keeps the view's proportions. */
const CAPTURE_WIDTH_PX = 1600;
/** The strength of the ray tracer's sky. */
const RAY_ENVIRONMENT_INTENSITY = 0.4;
/**
 * The ray-traced look's main light: a panel across the ceiling, shining
 * down. Light the tracer can aim at comes clean far sooner than light
 * reaching in only from the sky over the walls. The raster view never sees
 * it (CEILING_LAYER is off its camera) — it has its sun.
 */
const CEILING_INTENSITY = 1.4;
const CEILING_LAYER = 2;
/** How long (ms) the camera must rest before tracing starts. */
const TRACE_REST_MS = 150;
/** Frames between asks of how many samples the picture has (an ask reads back from the GPU). */
const COUNT_EVERY_FRAMES = 8;
/** Where this browser remembers ray tracing being turned off. */
const RAY_TRACED_KEY = 'cabinet3d.rayTraced';

const rememberedRayTraced = () => {
  try {
    return window.localStorage.getItem(RAY_TRACED_KEY) !== 'off';
  } catch {
    return true;
  }
};

/** How far the traced picture has come, 0 to 1; 'preparing' while the tracer loads; null while not tracing. */
type TraceProgress = number | 'preparing' | null;

interface Stage {
  renderer: THREE.WebGLRenderer;
  /** Draws the D&R tags, HTML labels over both canvases. */
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  ceiling: THREE.RectAreaLight;
  environment: THREE.Texture;
  content: THREE.Group | null;
  realistic: boolean;
  /** Middle of the model and how far its farthest corner is from it, for the realistic sun's shadows. */
  center: THREE.Vector3;
  reach: number;
  /** The ray tracer, once loaded, and whether it is wanted. */
  tracer: RayTracer | null;
  rayTraced: boolean;
  /** The tracer's copy of the scene is out of date (a rebuilt model): taken again before its next sample. */
  traceStale: boolean;
  /** A wall was cut away or came back: the tracer re-reads what shows. */
  wallsChanged: boolean;
  /** Which walls showed last (cutAwayWalls). */
  wallsShown: string;
  /** When the camera last moved (performance.now()). */
  movedAt: number;
  /** Bumped at each restart of the picture, so a sample count asked for before it is ignored. */
  traceRound: number;
  frames: number;
  counting: boolean;
  /** The traced picture is finished: the loop rests until something changes. */
  traceDone: boolean;
  /** Cancels the tracing loop's next turn, while one is due. */
  stopTracing: (() => void) | null;
  onTraceProgress: (progress: TraceProgress) => void;
  /** Draws the raster view and the tags, now. */
  draw: () => void;
  /** Shows the scene as it stands: the raster view now, and the traced picture started over. */
  render: () => void;
}

const tracing = (stage: Stage) => stage.realistic && stage.rayTraced && !!stage.tracer && !!stage.content;

/** Lay the traced canvas over the raster one (fading in), or take it away at once. */
function showTraced(stage: Stage, shown: boolean) {
  const canvas = stage.tracer?.canvas;
  if (!canvas) return;
  canvas.style.transition = shown ? 'opacity 0.4s' : 'none';
  canvas.style.opacity = shown ? '1' : '0';
}

/**
 * Give the ray tracer the scene as it stands. It reads the backdrop, the
 * environment and the lights as it takes it: a colour for the backdrop
 * (the raster look clears to one instead), its own sky, and no sun — the
 * ceiling panel lights the room, the sky fills in and gives the reflections.
 */
function traceScene(stage: Stage, { tracer, sky }: RayTracer) {
  const { scene, camera, sun, fill } = stage;
  const environment = scene.environment;
  scene.background = new THREE.Color(REALISTIC_BACKGROUND);
  scene.environment = sky;
  scene.environmentIntensity = RAY_ENVIRONMENT_INTENSITY;
  sun.visible = false;
  fill.visible = false;
  tracer.setScene(scene, camera);
  scene.background = null;
  scene.environment = environment;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  sun.visible = true;
  fill.visible = true;
}

/** Run traceFrame on the next frame, or after `wait` ms; one turn due at a time. */
function scheduleTrace(stage: Stage, wait = 0) {
  if (stage.stopTracing) return;
  const run = () => {
    stage.stopTracing = null;
    traceFrame(stage);
  };
  if (wait > 0) {
    const id = window.setTimeout(run, wait);
    stage.stopTracing = () => window.clearTimeout(id);
  } else {
    const id = requestAnimationFrame(run);
    stage.stopTracing = () => cancelAnimationFrame(id);
  }
}

function stopTrace(stage: Stage) {
  stage.stopTracing?.();
  stage.stopTracing = null;
}

/** Every few frames, how many samples the picture has: it is shown once it has a few, and the loop rests once it has all. */
function countSamples(stage: Stage, rt: RayTracer) {
  if (stage.counting) return;
  stage.counting = true;
  const round = stage.traceRound;
  rt.tracer
    .getSampleCountsAsync()
    .then(({ min }) => {
      stage.counting = false;
      if (round !== stage.traceRound || !tracing(stage)) return;
      if (min >= RAY_SHOW_SAMPLES) showTraced(stage, true);
      stage.onTraceProgress(Math.min(min / RAY_SAMPLES, 1));
      if (min >= RAY_SAMPLES) {
        stage.traceDone = true;
        stopTrace(stage);
      }
    })
    .catch(() => {
      stage.counting = false;
    });
}

/** One turn of tracing, once the camera has rested: samples onto the traced canvas, and the next turn until the picture is done. */
function traceFrame(stage: Stage) {
  const rt = stage.tracer;
  if (!rt || !tracing(stage) || stage.traceDone) return;
  const rested = performance.now() - stage.movedAt;
  if (rested < TRACE_REST_MS) {
    scheduleTrace(stage, TRACE_REST_MS - rested);
    return;
  }
  if (stage.traceStale) {
    stage.traceStale = false;
    stage.wallsChanged = false;
    traceScene(stage, rt);
  } else if (stage.wallsChanged) {
    stage.wallsChanged = false;
    rt.tracer.updateTransforms();
  }
  rt.tracer.renderSample();
  stage.frames += 1;
  if (stage.frames % COUNT_EVERY_FRAMES === 0) countSamples(stage, rt);
  scheduleTrace(stage);
}

export interface Cabinet3DViewHandle {
  /** The realistic view as it stands (the traced picture when it shows), as a JPEG data URL; null before there is one. */
  capture: () => string | null;
}

export interface Cabinet3DViewProps {
  cabinets: CabinetSketchCabinet[];
  walls: CabinetSketchWall[];
  /** The plan's detach & reset appliances. */
  appliances?: CabinetSketchAppliance[];
  /** Bowls of the sinks drawn on sink bases (the Edit tab's sink type). */
  sinkBowls?: 1 | 2;
  presets: PresetCatalog;
  scalePixelsPerFoot: number;
  height: number;
  /** The Edit tab's island seating overhang, inches, for the island top. */
  islandSeatingIn?: number;
  /** Draw the realistic look, in this finish; absent for the drawing look. */
  finish?: CabinetSketchFinish | null;
  /** An option's chosen products over the finish, in the realistic look (productLook.ts). */
  surfaces?: ProductSurfaces | null;
  /** Top the uppers and talls with crown molding (the Edit tab's Crown Molding scope). */
  crownMolding?: boolean;
  /** Mark the doors' arched panels in the drawing look. */
  archedDoors?: boolean;
  /** The Edit tab's backsplashes: drawn in the drawing look; the realistic look takes their height (see cabinet3dScene.ts). */
  backsplash?: BacksplashSpec | null;
  /** On show. Kept mounted while hidden, so the ray tracer needn't start over; it rests meanwhile. */
  active?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onDeselect: () => void;
}

function moveCamera(stage: Stage, { position, target }: CameraPose) {
  stage.camera.position.set(...position);
  stage.controls.target.set(...target);
  stage.controls.update();
  stage.render();
}

const Cabinet3DView = forwardRef<Cabinet3DViewHandle, Cabinet3DViewProps>(function Cabinet3DView(
  {
    cabinets,
    walls,
    appliances = NO_APPLIANCES,
    sinkBowls = 1,
    presets,
    scalePixelsPerFoot,
    height,
    islandSeatingIn = 0,
    finish = null,
    surfaces = null,
    crownMolding = false,
    archedDoors = false,
    backsplash = null,
    active = true,
    selectedIds,
    onSelect,
    onDeselect,
  },
  ref
) {
  // As plain values, so a new object with the same backsplashes doesn't rebuild the scene.
  const splashTileIn = backsplash?.tileIn ?? null;
  const splashCounter = !!backsplash?.counter;
  const splashFaces = faceKeepsText(backsplash?.faces);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  // Bumped when the renderer is (re)created, so the model is put into the new scene.
  const [stageVersion, setStageVersion] = useState(0);
  const framed = useRef(false);
  const [failed, setFailed] = useState(false);
  const [rayTraced, setRayTraced] = useState(rememberedRayTraced);
  // The browser turned out to have no WebGPU: the toggle says so.
  const [noWebGPU, setNoWebGPU] = useState(() => !hasWebGPU());
  // Coarse (5% steps), so the tracing loop doesn't re-render the page every frame.
  const [traceProgress, setTraceProgress] = useState<TraceProgress>(null);
  // Latest callbacks, so the pointer handlers set up once still call the current ones.
  const pickRef = useRef({ onSelect, onDeselect });
  pickRef.current = { onSelect, onDeselect };
  // The height the view opens at. A new height only resizes it (see the ResizeObserver
  // below): building it again would start the ray tracer's minute-long setup over.
  const heightRef = useRef(height);
  heightRef.current = height;

  const solids = useMemo(
    () => cabinetSolids(cabinets, presets, scalePixelsPerFoot, sinkBowls),
    [cabinets, presets, scalePixelsPerFoot, sinkBowls]
  );
  const wallModels = useMemo(() => wallSolids(walls, scalePixelsPerFoot), [walls, scalePixelsPerFoot]);
  // The island in one piece (its top over all its cabinets, the fillers closing its angled joints) and the appliances.
  const extras = useMemo(
    () => ({
      counters: islandTopSlabs(solids, scalePixelsPerFoot, islandSeatingIn),
      fillers: islandFillerSolids(solids, scalePixelsPerFoot),
      appliances: applianceSolids(appliances, cabinets, presets, scalePixelsPerFoot),
    }),
    [solids, scalePixelsPerFoot, islandSeatingIn, appliances, cabinets, presets]
  );

  const frameView = useCallback(() => {
    const stage = stageRef.current;
    const bounds = modelBounds(solids, wallModels, applianceExtent(extras.appliances));
    if (!stage || !bounds) return;
    moveCamera(stage, overviewPose(bounds, mainFacing(solids)));
  }, [solids, wallModels, extras]);

  const eyeLevel = useCallback(() => {
    const stage = stageRef.current;
    const bounds = modelBounds(solids, [], applianceExtent(extras.appliances));
    if (!stage || !bounds) return;
    moveCamera(stage, eyeLevelPose(bounds, mainFacing(solids), stage.camera.fov, stage.camera.aspect));
  }, [solids, extras]);

  // Renderer, camera, lights and controls: once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    const width = container.clientWidth || 900;
    const height = heightRef.current;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    // Soft since r182, which retired PCFSoftShadowMap.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.setSize(width, height);
    Object.assign(labels.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const { hemi, sun, fill } = addLights(scene);
    const ceiling = new THREE.RectAreaLight('#fff4e6', CEILING_INTENSITY, 96, 96);
    // Facing down: the tracer lights the side its -z faces.
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.layers.set(CEILING_LAYER);
    scene.add(ceiling);

    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Stay above the floor.
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 24;
    controls.maxDistance = 2400;

    const { texture: environment, dispose: disposeEnvironment } = createEnvironment(renderer);
    const { composer, dispose: disposeComposer } = createComposer(renderer, scene, camera, width, height);

    const stage: Stage = {
      renderer,
      labels,
      scene,
      camera,
      controls,
      composer,
      hemi,
      sun,
      fill,
      ceiling,
      environment,
      content: null,
      realistic: false,
      center: new THREE.Vector3(),
      reach: 240,
      tracer: null,
      rayTraced: false,
      traceStale: true,
      wallsChanged: false,
      wallsShown: '',
      movedAt: 0,
      traceRound: 0,
      frames: 0,
      counting: false,
      traceDone: false,
      stopTracing: null,
      onTraceProgress: () => {},
      draw: () => {
        if (stage.realistic && stage.content) {
          followCamera();
          composer.render();
        } else {
          renderer.render(scene, camera);
        }
        labels.render(scene, camera);
      },
      render: () => {
        stage.draw();
        const rt = stage.tracer;
        if (!rt || !tracing(stage)) return;
        // The traced picture starts over from where the camera now is, once it rests.
        showTraced(stage, false);
        stage.movedAt = performance.now();
        stage.traceRound += 1;
        stage.traceDone = false;
        rt.tracer.updateCamera();
        stage.onTraceProgress(0);
        scheduleTrace(stage);
      },
    };
    // What in the realistic look turns with the camera: the walls cut away, the sun.
    const followCamera = () => {
      if (!stage.content) return;
      const shown = cutAwayWalls(stage.content, camera);
      if (shown !== stage.wallsShown) {
        stage.wallsShown = shown;
        stage.wallsChanged = true;
      }
      aimSun(stage.sun, camera, stage.center, stage.reach);
    };
    setLook(stage, false);
    stageRef.current = stage;
    framed.current = false;
    setStageVersion((v) => v + 1);
    controls.addEventListener('change', stage.render);

    const resize = new ResizeObserver((entries) => {
      // Hidden (the Sketch tab on another view) it measures nothing: leave it as it was.
      const measured = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (!measured) return;
      const w = Math.max(320, measured);
      // The container takes the height prop, so a new height arrives here too.
      const h = Math.max(200, Math.floor(entries[0]?.contentRect.height ?? 0) || heightRef.current);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      labels.setSize(w, h);
      stage.tracer?.renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      stage.render();
    });
    resize.observe(container);

    // A click (not a drag) picks the cabinet under the pointer, or clears the selection.
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > CLICK_SLOP_PX || !stage.content) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      // Walls are see-through (or cut away), so a cabinet behind one is still the pick.
      const hit = raycaster
        .intersectObjects(stage.content.children, true)
        .find((h) => h.object instanceof THREE.Mesh && cabinetIdOf(h.object));
      const id = hit ? cabinetIdOf(hit.object) : null;
      if (id) pickRef.current.onSelect(id, e.ctrlKey || e.metaKey);
      else pickRef.current.onDeselect();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      stopTrace(stage);
      if (stage.tracer) disposeRayTracer(stage.tracer);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      if (stage.content) disposeScene(stage.content);
      disposeComposer();
      disposeEnvironment();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      stageRef.current = null;
    };
  }, []);

  // The model: rebuilt whenever the sketch, the selection or the look changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.content) {
      stage.scene.remove(stage.content);
      disposeScene(stage.content);
    }
    stage.realistic = !!finish;
    setLook(stage, !!finish);
    stage.content = buildCabinetScene(solids, wallModels, selectedIds, {
      ...extras,
      finish,
      surfaces,
      crown: crownMolding,
      archedDoors,
      backsplash: { tileIn: splashTileIn, counter: splashCounter, faces: faceKeepsFromText(splashFaces) },
    });
    stage.scene.add(stage.content);
    stage.traceStale = true;

    const bounds = modelBounds(solids, wallModels, applianceExtent(extras.appliances));
    if (bounds) {
      const { center, reach } = fitSunShadow(stage.sun, bounds);
      stage.center.copy(center);
      stage.reach = reach;
      // Most of the room's ceiling, just under it.
      stage.ceiling.position.set(stage.center.x, WALL_HEIGHT_IN - 1, stage.center.z);
      stage.ceiling.width = Math.max(bounds.maxX - bounds.minX, 48) * 0.8;
      stage.ceiling.height = Math.max(bounds.maxZ - bounds.minZ, 48) * 0.8;
    }

    // Frame the kitchen the first time there is one to see; after that the camera stays where it was put.
    if (!framed.current && (solids.length > 0 || wallModels.length > 0)) {
      framed.current = true;
      frameView();
    } else {
      stage.render();
    }
  }, [solids, wallModels, extras, selectedIds, finish, surfaces, crownMolding, archedDoors, splashTileIn, splashCounter, splashFaces, frameView, stageVersion]);

  // Ray tracing: loaded the first time the realistic look wants it, then
  // switched on and off with the look, the toggle and the view's showing.
  useEffect(() => {
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;
    let step: TraceProgress = null;
    stage.onTraceProgress = (progress) => {
      const next = typeof progress === 'number' ? Math.floor(progress * 20) / 20 : progress;
      if (next !== step) {
        step = next;
        setTraceProgress(next);
      }
    };
    stage.rayTraced = rayTraced && active && !noWebGPU;
    if (!finish || !stage.rayTraced) {
      stopTrace(stage);
      showTraced(stage, false);
      stage.onTraceProgress(null);
      stage.render();
      return;
    }
    if (stage.tracer) {
      stage.render();
      return;
    }
    let current = true;
    stage.onTraceProgress('preparing');
    const size = stage.renderer.getSize(new THREE.Vector2());
    loadRayTracer(size.x, size.y, stage.renderer.getPixelRatio())
      .then((rt) => {
        if (!current || stageRef.current !== stage) {
          if (rt) disposeRayTracer(rt);
          return;
        }
        if (!rt) {
          setNoWebGPU(true);
          return;
        }
        // Over the raster canvas, under the tags; the raster canvas still takes the pointer.
        Object.assign(rt.canvas.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', opacity: '0' });
        stage.renderer.domElement.after(rt.canvas);
        stage.tracer = rt;
        stage.traceStale = true;
        stage.render();
      })
      .catch(() => {
        // Left on the raster view, the toggle off, so it's plain why.
        if (current) setRayTraced(false);
      });
    return () => {
      current = false;
    };
  }, [finish, rayTraced, active, noWebGPU, stageVersion]);

  const toggleRayTraced = (on: boolean) => {
    setRayTraced(on);
    try {
      window.localStorage.setItem(RAY_TRACED_KEY, on ? 'on' : 'off');
    } catch {
      // Not remembered; it still switches for now.
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      capture: () => {
        const stage = stageRef.current;
        if (!stage?.content) return null;
        const { renderer, composer, tracer } = stage;
        // A traced picture on show is taken as it is, at the view's own size: tracing it again bigger would take seconds.
        if (tracer && tracing(stage) && tracer.canvas.style.opacity === '1') {
          tracer.tracer.renderSample();
          // Read in the same task as the sample, before the canvas hands the frame on.
          return tracer.canvas.toDataURL('image/jpeg', 0.92);
        }
        const size = renderer.getSize(new THREE.Vector2());
        const ratio = renderer.getPixelRatio();
        // Drawn again bigger, at the same proportions so the camera sees the same picture.
        const w = CAPTURE_WIDTH_PX;
        const h = Math.round((w * size.y) / size.x);
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        composer.setPixelRatio(1);
        composer.setSize(w, h);
        stage.draw();
        // Read before the frame is handed to the page, which clears the canvas.
        const image = renderer.domElement.toDataURL('image/jpeg', 0.92);
        renderer.setPixelRatio(ratio);
        renderer.setSize(size.x, size.y);
        composer.setPixelRatio(ratio);
        composer.setSize(size.x, size.y);
        stage.draw();
        return image;
      },
    }),
    []
  );

  if (failed) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
        The 3D view needs WebGL, which this browser has turned off.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height, cursor: 'grab' }} />
      {finish && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '3px 10px',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.85)',
            fontSize: 12,
            color: '#3d3c39',
          }}
        >
          <Tooltip
            title={
              noWebGPU
                ? 'Needs a browser with WebGPU (Chrome or Edge, or Safari 26); this one draws the realistic look without it.'
                : 'Light, shadow and reflections worked out as in a photo: a few seconds after the view stops moving, the picture sharpens toward a photo. Turn it off on a slow computer.'
            }
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Switch size="small" checked={rayTraced && !noWebGPU} disabled={noWebGPU} onChange={toggleRayTraced} />
              Ray-traced light
            </span>
          </Tooltip>
          {rayTraced && !noWebGPU && traceProgress !== null && (
            <span style={{ color: '#7a7873', fontVariantNumeric: 'tabular-nums' }}>
              {traceProgress === 'preparing'
                ? 'Preparing…'
                : traceProgress >= 1
                  ? 'Done'
                  : `Refining ${Math.round(traceProgress * 100)}%`}
            </span>
          )}
        </div>
      )}
      {cabinets.length === 0 && walls.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13, pointerEvents: 'none' }}>
          No cabinets to show yet. Add cabinets in the Edit tab and they appear here.
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
        <Tooltip title="Stand across the room at eye height, as a photo of the kitchen would be taken">
          <Button size="small" icon={<EyeOutlined />} onClick={eyeLevel} disabled={solids.length === 0}>
            Eye level
          </Button>
        </Tooltip>
        <Tooltip title="Back to the starting view">
          <Button size="small" icon={<AimOutlined />} onClick={frameView}>
            Reset view
          </Button>
        </Tooltip>
      </div>
    </div>
  );
});

export default Cabinet3DView;
