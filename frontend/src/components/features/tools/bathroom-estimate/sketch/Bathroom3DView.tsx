/**
 * Bathroom3DView
 *
 * The bathroom sketch in 3D at its real sizes: walls with their tile and
 * surrounds, doors and windows, the floor tile, and each fixture. Walls
 * between the camera and the room turn see-through, so the room can be
 * looked into from any side; "Eye level" stands in the doorway. "After
 * work" shows the tile to install, "Today" the tile there now. Drag to
 * orbit, scroll to zoom, right-drag to pan; clicking a wall or fixture
 * selects it in the sketch, so its panel opens beside the view.
 *
 * Plain three.js, rebuilt whole when the sketch changes and drawn only when
 * something moves. Loaded lazily by BESketchTab, so three.js is only
 * downloaded when the 3D view is opened.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented, Tooltip } from 'antd';
import { AimOutlined, EyeOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BESketchData } from '@/types/bathroomSketch';
import { bathroomModel, type FinishView } from './bathroom3dModel';
import { buildBathroomScene, disposeScene, sketchIdOf, updateCutaway, type BuiltScene } from './bathroom3dScene';
import {
  aimSun,
  createLitScene,
  eyeLevelPose,
  OUTSIDE_FOV,
  overviewPose,
  setUpRenderer,
  type CameraPose,
} from './bathroom3dStage';
import { TileTextureCache } from './bathroom3dTextures';
import { productImageUrl } from '@/components/features/tools/cabinet-estimate/products/productImages';

/** How far (screen px) the pointer may move between press and release and still count as a click. */
const CLICK_SLOP_PX = 4;

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  textures: TileTextureCache;
  built: BuiltScene | null;
  render: () => void;
}

export interface Bathroom3DViewProps {
  sketch: BESketchData;
  /** The estimate's form values: tile, tops and metal finishes come from its specs. */
  estimate?: Record<string, any> | null;
  height: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

const Bathroom3DView: React.FC<Bathroom3DViewProps> = ({ sketch, estimate, height, selectedId, onSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [stageVersion, setStageVersion] = useState(0);
  const framed = useRef(false);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<FinishView>('after');
  const pickRef = useRef(onSelect);
  pickRef.current = onSelect;

  const model = useMemo(() => bathroomModel(sketch, estimate, view), [sketch, estimate, view]);
  const modelRef = useRef(model);
  modelRef.current = model;

  const goTo = useCallback((pose: CameraPose | null) => {
    const stage = stageRef.current;
    if (!stage || !pose) return;
    stage.camera.fov = pose.fov;
    stage.camera.updateProjectionMatrix();
    stage.camera.position.copy(pose.position);
    stage.controls.target.copy(pose.target);
    stage.controls.update();
  }, []);
  const frameView = useCallback(() => goTo(overviewPose(modelRef.current)), [goTo]);
  const eyeLevel = useCallback(() => goTo(eyeLevelPose(modelRef.current)), [goTo]);

  // Renderer, camera, lights and controls: once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 900, height);
    setUpRenderer(renderer);
    container.appendChild(renderer.domElement);

    const { scene, sun, dispose: disposeLights } = createLitScene(renderer);

    const camera = new THREE.PerspectiveCamera(OUTSIDE_FOV, (container.clientWidth || 900) / height, 1, 6000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Stay above the floor
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 6;
    controls.maxDistance = 2000;

    const stage: Stage = {
      renderer,
      scene,
      camera,
      controls,
      sun,
      textures: new TileTextureCache({
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
        imageUrl: productImageUrl,
        // A picked tile's picture came in
        onChange: () => stageRef.current?.render(),
      }),
      built: null,
      render: () => {
        if (stage.built) updateCutaway(stage.built, camera);
        renderer.render(scene, camera);
      },
    };
    stageRef.current = stage;
    framed.current = false;
    setStageVersion((v) => v + 1);
    controls.addEventListener('change', stage.render);

    const resize = new ResizeObserver((entries) => {
      const w = Math.max(320, Math.floor(entries[0]?.contentRect.width ?? 0));
      if (!w) return;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      stage.render();
    });
    resize.observe(container);

    // A click (not a drag) picks the wall or fixture under the pointer; see-through walls are passed over
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > CLICK_SLOP_PX || !stage.built) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const ghosts = new Set(stage.built.walls.filter((w) => w.ghosted).map((w) => w.group.userData.sketchId));
      const hit = raycaster
        .intersectObjects(stage.built.root.children, true)
        .find((h) => {
          const id = sketchIdOf(h.object);
          return h.object instanceof THREE.Mesh && id && !ghosts.has(id);
        });
      pickRef.current?.(hit ? sketchIdOf(hit.object) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      if (stage.built) disposeScene(stage.built.root);
      stage.textures.dispose();
      disposeLights();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [height]);

  // The model: rebuilt whenever the sketch, the estimate's looks, the finish shown or the selection changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.built) {
      stage.scene.remove(stage.built.root);
      disposeScene(stage.built.root);
    }
    stage.built = buildBathroomScene(model, stage.textures, selectedId);
    stage.scene.add(stage.built.root);
    aimSun(stage.sun, model);
    // Frame the room the first time there is one to see; after that the camera stays where it was put
    if (!framed.current && model.bounds) {
      framed.current = true;
      frameView();
    }
    stage.render();
  }, [model, selectedId, frameView, stageVersion]);

  if (failed) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
        3D isn't available in this browser (WebGL is off).
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height }}>
      <div ref={containerRef} style={{ height, cursor: 'grab' }} />
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as FinishView)}
          options={[
            { value: 'after', label: 'After work' },
            { value: 'today', label: 'Today' },
          ]}
        />
        <Tooltip title="Back to the view from above">
          <Button size="small" icon={<AimOutlined />} onClick={() => { frameView(); stageRef.current?.render(); }}>
            Reset view
          </Button>
        </Tooltip>
        <Tooltip title="Stand in the doorway at eye height">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { eyeLevel(); stageRef.current?.render(); }}>
            Eye level
          </Button>
        </Tooltip>
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 11, color: '#6b7280', pointerEvents: 'none' }}>
        Drag to orbit · scroll to zoom · right-drag to pan · click a wall or fixture to select it
      </div>
    </div>
  );
};

export default Bathroom3DView;
