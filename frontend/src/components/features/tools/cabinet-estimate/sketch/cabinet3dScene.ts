/**
 * Turns the 3D model (cabinet3dModel.ts) into three.js objects: cabinet
 * boxes with their doors, drawers, glass and countertops, sinks, the
 * detach & reset appliances, walls and a floor. One
 * inch is one world unit.
 *
 * Two looks. The drawing look follows the Front view's colours, every edge
 * outlined, over a 1 ft grid with see-through walls, so the two read as the
 * same drawing, with the Edit tab's backsplashes (tile, and the 4"
 * countertop one) where cabinetBacksplash.ts puts them. The realistic look
 * draws the sketch's finish (kitchenFinish.ts) under real light: textured
 * materials (finishMaterials.ts), shaker, raised-panel, arched or slab doors
 * with pulls or knobs (or none), the finish's tile backsplash on every wall a
 * counter or range backs onto (at the Edit tab's height, over its 4"
 * countertop backsplash), sinks sunk into the
 * counter under a gooseneck faucet, solid walls that open toward the camera
 * (cutAwayWalls) — what the AI photo starts from. Either look can top the
 * uppers and talls with crown molding.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { DoorPattern } from '@/types/cabinetEstimate';
import type { CabinetSketchFinish } from '@/types/cabinetSketch';
import {
  ARCH_MIN_DOOR_IN,
  COUNTER_TOP_IN,
  CROWN_BANDS,
  CROWN_MIN_TOP_IN,
  GLASS_STILE_IN,
  LATTICE_BAR_IN,
  archOutline,
  doorDesign,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import type { DoorDesign, Face } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import { applianceExtent, inPolygon, modelBounds, toPlan } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import type { ApplianceSolid, CabinetSolid, CounterSlab, FillerSolid, FrontRun, Pt2, WallSolid } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import { COUNTER_SPLASH_IN, againstWall, applianceSplash, keptPart, splashSides } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import type { BacksplashSpec, FaceKeep } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import { finishMaterials } from '@/components/features/tools/cabinet-estimate/sketch/finishMaterials';
import type { FinishMaterials } from '@/components/features/tools/cabinet-estimate/sketch/finishMaterials';
import type { ProductSurfaces } from '@/components/features/tools/cabinet-estimate/sketch/productLook';
import type { LocalRect } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';

/** Walls are drawn to the 8 ft ceiling the Front view uses. */
export const WALL_HEIGHT_IN = 96;
/** Thickness of a door or drawer front, inches. */
const FACE_THICK_IN = 0.75;
/** An appliance opening is a panel set nearly flush with the box. */
const OPENING_THICK_IN = 0.3;
/** A shaker front's centre panel, set back in its frame. */
const SHAKER_PANEL_IN = 0.25;
/** Fronts smaller than this either way stay slabs in the shaker style, as short drawer fronts do. */
const SHAKER_MIN_IN = 9;
/** How far a pull's bar stands off the front. */
const PULL_STANDOFF_IN = 1.1;
/** Above this height (inches from the floor), a door is an upper's: its pull goes near its bottom. */
const UPPER_DOOR_FROM_IN = 30;
/** A tall door's pull is centred about this high off the floor. */
const TALL_PULL_AT_IN = 38;
/** A raised-panel door's raised field: its margin inside the frame, the slope of its bevel, and how far it stands off the panel. */
const RAISED_MARGIN_IN = 1;
const RAISED_BEVEL_IN = 1.1;
const RAISED_THICK_IN = 0.45;
/** How deep a sink's bowls go below the counter top, inches. */
const BOWL_DEPTH_IN = 8;
/** The tile backsplash: how high it goes above the counter (unless the Edit tab says otherwise), and how thick it is. */
const BACKSPLASH_IN = 18;
const BACKSPLASH_THICK_IN = 0.375;
/** The 4" countertop backsplash's thickness: a strip of the counter's own stone. */
const COUNTER_SPLASH_THICK_IN = 0.75;

const COLORS = {
  box: '#EADCC6',
  boxEdge: '#8B5E3C',
  face: '#FBF6EF',
  faceEdge: '#A87B54',
  appliance: '#d9d9d6',
  applianceEdge: '#374151',
  counter: '#8c8a85',
  toe: '#c9c1b4',
  glass: '#BFD8EA',
  pull: '#374151',
  wall: '#dedad2',
  wallEdge: '#a8a49c',
  floor: '#f1eee8',
  grid: '#dcd8d0',
  selected: '#2563eb',
  steel: '#c5cbd0',
  steelFace: '#d9dee2',
  steelEdge: '#5f6b73',
  dark: '#2f3337',
  burner: '#5a6066',
  window: '#39424a',
  wood: '#c49a6c',
  bowl: '#8f99a1',
  /** An apron sink's front, in the drawing look a face like the rest. */
  ceramic: '#FBF6EF',
  /** The tile backsplash in the drawing look (the Front view's tile colour). */
  splash: '#E6EEEC',
};

type Surface = keyof typeof COLORS;

/** The realistic material that stands for each drawing colour. */
const REALISTIC: Partial<Record<Surface, keyof FinishMaterials>> = {
  box: 'cabinet',
  face: 'cabinet',
  wood: 'cabinet',
  toe: 'toe',
  counter: 'counter',
  appliance: 'steel',
  steel: 'steel',
  steelFace: 'steel',
  bowl: 'sinkSteel',
  dark: 'black',
  burner: 'burner',
  window: 'darkGlass',
  glass: 'glass',
  pull: 'pull',
  wall: 'wall',
  floor: 'floor',
  ceramic: 'ceramic',
};

/** A solid colour that sits a hair behind its outline, so the edges don't flicker. */
function solidMaterial(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    ...extra,
  });
}

function withEdges(mesh: THREE.Mesh, color: string): THREE.Mesh {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({ color })
  );
  mesh.add(edges);
  return mesh;
}

/** How one build is drawn: see the file comment. */
interface Paint {
  realistic: boolean;
  /** Door and drawer fronts: shaker, raised (panel), arched (raised panel) or slab. */
  doors: string;
  /** Hardware shape: bar (pulls), knob, or cup (knobs on doors, cup pulls on drawers). */
  hardware: string;
  /** The realistic look's materials, for what has no drawing colour (backsplash, sink, faucet); null in the drawing look. */
  materials: FinishMaterials | null;
  /** The material of a surface; `extra` only tunes the drawing look's (see-through glass and walls, a selection glow). */
  mat: (surface: Surface, extra?: THREE.MeshStandardMaterialParameters) => THREE.Material;
  /** Outlines a mesh, in the drawing look. */
  outline: (mesh: THREE.Mesh, color: string) => THREE.Mesh;
}

const DRAWING: Paint = {
  realistic: false,
  doors: 'slab',
  hardware: 'bar',
  materials: null,
  mat: (surface, extra) => solidMaterial(COLORS[surface], extra),
  outline: withEdges,
};

function realisticPaint(finish: CabinetSketchFinish, surfaces?: ProductSurfaces | null): Paint {
  const materials = finishMaterials(finish, surfaces ?? {});
  return {
    realistic: true,
    doors: finish.door_style,
    hardware: finish.hardware_style,
    materials,
    mat: (surface) => materials[REALISTIC[surface] ?? 'cabinet'] ?? materials.wall,
    outline: (mesh) => mesh,
  };
}

/** A plan outline (local x, z), less any holes, stood up between heights y0 and y1. UVs in inches. */
function prism(points: Pt2[], y0: number, y1: number, holes: Pt2[][] = []): THREE.BufferGeometry {
  // The shape is drawn in (x, -z) and extruded along +Z; turning it a
  // quarter about X then stands it up with z back where it belongs.
  const flat = (pts: Pt2[]) => pts.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(flat(points));
  shape.holes = holes.map((h) => new THREE.Path(flat(h)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  return geometry;
}

/** A box w × h × d with its UVs in inches, so a texture keeps its scale on every side. */
function inchBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  // Sides +x, -x, +y, -y, +z, -z, four corners each.
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  spans.forEach(([su, sv], side) => {
    for (let i = side * 4; i < side * 4 + 4; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  });
  return geometry;
}

/** A bar pull on its two posts, centred on the origin and standing off toward +z. */
function barPull(len: number, vertical: boolean, material: THREE.Material): THREE.Group {
  const pull = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 12), material);
  bar.position.z = PULL_STANDOFF_IN;
  pull.add(bar);
  for (const end of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, PULL_STANDOFF_IN, 10), material);
    leg.rotation.x = Math.PI / 2;
    leg.position.set(0, end * (len / 2 - 0.4), PULL_STANDOFF_IN / 2);
    pull.add(leg);
  }
  if (!vertical) pull.rotation.z = Math.PI / 2;
  return pull;
}

/** A raised-panel door's field, w × h, centred on the origin: flat in the middle, bevelled down to its edges, its back at z = 0. */
function raisedField(w: number, h: number, material: THREE.Material, arched = false): THREE.Mesh {
  const bevel = Math.min(RAISED_BEVEL_IN, w / 4, h / 4);
  const x = w / 2 - bevel;
  const y = h / 2 - bevel;
  const shape = new THREE.Shape(
    arched
      ? archOutline(2 * x, 2 * y).map(([px, py]) => new THREE.Vector2(px - x, py - y))
      : [new THREE.Vector2(-x, -y), new THREE.Vector2(x, -y), new THREE.Vector2(x, y), new THREE.Vector2(-x, y)]
  );
  // The bevel grows the outline by `bevel` and adds its thickness either side of `depth`.
  const slope = RAISED_THICK_IN * 0.4;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: RAISED_THICK_IN - 2 * slope,
    bevelEnabled: true,
    bevelThickness: slope,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, slope);
  return new THREE.Mesh(geometry, material);
}

/** A round knob on a short stem, standing off toward +z. */
function knob(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.7, 12), material);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 0.35;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), material);
  ball.scale.z = 0.8;
  ball.position.z = 0.95;
  group.add(stem, ball);
  return group;
}

/** A cup (bin) pull, 3" across: a quarter shell open underneath, on a plate, standing off toward +z. */
function cupPull(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3, 16, 1, true, 0, Math.PI / 2), material);
  // Its axis turned to run across; the quarter it keeps then runs from its top round to its front.
  shell.rotation.z = Math.PI / 2;
  shell.position.y = -0.4;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 0.12), material);
  plate.position.z = 0.06;
  group.add(shell, plate);
  return group;
}

/** Where a door is hung from: the side away from the door beside it, if there is one. */
function pullSide(f: Face, faces: Face[]): 'left' | 'right' {
  if (f.pull) return f.pull;
  const beside = (g: Face) => g !== f && g.kind === 'door' && g.y < f.y + f.h && f.y < g.y + g.h;
  if (faces.some((g) => beside(g) && Math.abs(g.x - (f.x + f.w)) < 2)) return 'right';
  if (faces.some((g) => beside(g) && Math.abs(g.x + g.w - f.x) < 2)) return 'left';
  return 'right';
}

/** A door w × h as one piece, its bottom-left corner at the origin, standing off toward +z, with `holes` (door inches) through it. */
function doorFrame(w: number, h: number, holes: Pt2[][]): THREE.BufferGeometry {
  const flat = (pts: Pt2[]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape(flat([[0, 0], [w, 0], [w, h], [0, h]]));
  shape.holes = holes.map((hole) => new THREE.Path(flat(hole)));
  return new THREE.ExtrudeGeometry(shape, { depth: FACE_THICK_IN, bevelEnabled: false });
}

/**
 * A door with a pattern, in both looks, in the front's own frame: the frame
 * with its opening and the band's cut-outs through it, the lattice bars
 * across the opening, and behind them the cabinet's dark inside, or glass.
 */
function patternFront(f: Face, design: DoorDesign, glass: boolean, edge: string, paint: Paint): THREE.Object3D[] {
  const { opening: o, bars, band } = design;
  const ovals = (band?.ovals ?? []).map(({ cx, cy, rx, ry }) =>
    Array.from({ length: 24 }, (_, i): Pt2 => {
      const t = (i / 24) * Math.PI * 2;
      return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
    })
  );
  const diamonds = (band?.diamonds ?? []).map(({ cx, cy, r }): Pt2[] => [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ]);
  const holes = [rectPoints([o.x, o.y, o.x + o.w, o.y + o.h]), ...ovals, ...diamonds];
  const frame = paint.outline(new THREE.Mesh(doorFrame(f.w, f.h, holes), paint.mat('face')), edge);

  const inside = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 0.2, f.h - 0.2), paint.mat(paint.realistic ? 'window' : 'toe'));
  inside.position.set(f.w / 2, f.h / 2, 0.02);
  const out: THREE.Object3D[] = [frame, inside];
  if (glass) {
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(o.w, o.h),
      paint.mat('glass', { roughness: 0.15, transparent: true, opacity: 0.8 })
    );
    pane.position.set(o.x + o.w / 2, o.y + o.h / 2, FACE_THICK_IN * 0.25);
    out.push(pane);
  }
  for (const [x0, y0, x1, y1] of bars) {
    const bar = new THREE.Mesh(inchBox(Math.hypot(x1 - x0, y1 - y0), LATTICE_BAR_IN, LATTICE_BAR_IN), paint.mat('face'));
    // Set back from the frame's face, so the bars' cut ends stay inside it.
    bar.position.set((x0 + x1) / 2, (y0 + y1) / 2, FACE_THICK_IN - LATTICE_BAR_IN / 2 - 0.1);
    bar.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    out.push(paint.outline(bar, edge));
  }
  return out;
}

/** Whether a front takes the arched style's panel: a door wide enough, with no glass in it. */
const archedDoor = (f: Face, glass: boolean, paint: Paint) =>
  paint.doors === 'arched' && f.kind === 'door' && !glass && Math.min(f.w, f.h) >= ARCH_MIN_DOOR_IN;

/**
 * One realistic front in its own frame (x from its left edge, y up from its
 * bottom, z out from the box): a slab, a shaker frame around a recessed panel
 * or glass, an arched frame around a raised field, or a pattern (`design`),
 * with its pull. `bottom` is the front's height off the floor.
 */
function realisticFront(f: Face, faces: Face[], glass: boolean, design: DoorDesign | null, bottom: number, paint: Paint): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const at = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    out.push(mesh);
    return mesh;
  };
  if (f.kind === 'opening') {
    at(new THREE.Mesh(inchBox(f.w, f.h, OPENING_THICK_IN), paint.mat('appliance')), f.w / 2, f.h / 2, OPENING_THICK_IN / 2);
    return out;
  }
  const surface: Surface = f.label === 'APRON SINK' ? 'ceramic' : 'face';
  const glassDoor = glass && f.kind === 'door';
  const arched = !design && surface === 'face' && archedDoor(f, glassDoor, paint);
  const framed = glassDoor || !!design || arched || (paint.doors !== 'slab' && surface === 'face' && Math.min(f.w, f.h) >= SHAKER_MIN_IN);
  const s = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4);
  if (design) {
    out.push(...patternFront(f, design, glassDoor, COLORS.faceEdge, paint));
  } else if (arched) {
    // The frame in one piece, around a recessed panel; the field stands up off it, short of the frame.
    const [panelW, panelH] = [f.w - 2 * s, f.h - 2 * s];
    const hole = archOutline(panelW, panelH).map(([x, y]): Pt2 => [x + s, y + s]);
    out.push(new THREE.Mesh(doorFrame(f.w, f.h, [hole]), paint.mat(surface)));
    at(new THREE.Mesh(inchBox(panelW, panelH, SHAKER_PANEL_IN), paint.mat(surface)), f.w / 2, f.h / 2, SHAKER_PANEL_IN / 2);
    at(raisedField(panelW - 2 * RAISED_MARGIN_IN, panelH - 2 * RAISED_MARGIN_IN, paint.mat(surface), true), f.w / 2, f.h / 2, SHAKER_PANEL_IN);
  } else if (framed) {
    const piece = (x: number, y: number, w: number, h: number) =>
      at(new THREE.Mesh(inchBox(w, h, FACE_THICK_IN), paint.mat(surface)), x + w / 2, y + h / 2, FACE_THICK_IN / 2);
    piece(0, 0, s, f.h);
    piece(f.w - s, 0, s, f.h);
    piece(s, 0, f.w - 2 * s, s);
    piece(s, f.h - s, f.w - 2 * s, s);
    const inner = new THREE.Mesh(inchBox(f.w - 2 * s, f.h - 2 * s, SHAKER_PANEL_IN), paint.mat(glassDoor ? 'glass' : surface));
    at(inner, f.w / 2, f.h / 2, glassDoor ? FACE_THICK_IN / 2 : SHAKER_PANEL_IN / 2);
    // A raised-panel door's field stands up off the recessed panel, bevelled, short of the frame.
    const fieldW = f.w - 2 * s - 2 * RAISED_MARGIN_IN;
    const fieldH = f.h - 2 * s - 2 * RAISED_MARGIN_IN;
    if (paint.doors === 'raised' && f.kind === 'door' && !glassDoor && fieldW > 4 && fieldH > 4) {
      at(raisedField(fieldW, fieldH, paint.mat(surface)), f.w / 2, f.h / 2, SHAKER_PANEL_IN);
    }
  } else {
    at(new THREE.Mesh(inchBox(f.w, f.h, FACE_THICK_IN), paint.mat(surface)), f.w / 2, f.h / 2, FACE_THICK_IN / 2);
  }

  // Push-to-open fronts: nothing to put on them
  if (paint.hardware === 'none') return out;
  const metal = paint.mat('pull');
  if (f.kind === 'drawer') {
    // Centred — on the recessed panel of a framed front — and a pair across a wide drawer for knobs and cups.
    const z = framed ? SHAKER_PANEL_IN : FACE_THICK_IN;
    if (paint.hardware === 'bar') {
      const pull = barPull(Math.min(Math.max(f.w * 0.33, 3.75), 12), false, metal);
      pull.position.set(f.w / 2, f.h / 2, z);
      out.push(pull);
    } else {
      const across = f.w >= 30 ? [f.w / 4, (3 * f.w) / 4] : [f.w / 2];
      for (const x of across) {
        const piece = paint.hardware === 'cup' ? cupPull(metal) : knob(metal);
        piece.position.set(x, f.h / 2, z);
        out.push(piece);
      }
    }
  } else if (f.kind === 'door') {
    const tall = bottom < UPPER_DOOR_FROM_IN && bottom + f.h > TALL_PULL_AT_IN + 6;
    const len = paint.hardware === 'bar' ? (tall ? 12 : 5) : 0;
    const ends = Math.min(len / 2 + 2, f.h / 2);
    const y =
      bottom >= UPPER_DOOR_FROM_IN
        ? ends
        : tall
          ? Math.min(Math.max(TALL_PULL_AT_IN - bottom, ends), f.h - ends)
          : f.h - ends;
    // On the stile of a framed door.
    const inset = framed ? s / 2 : 1.5;
    const pull = paint.hardware === 'bar' ? barPull(len, true, metal) : knob(metal);
    pull.position.set(pullSide(f, faces) === 'right' ? f.w - inset : inset, y, FACE_THICK_IN);
    out.push(pull);
  }
  return out;
}

/** The doors, drawers and openings of one front run, in the cabinet's local frame. `bottom`: the cabinet's height off the floor. */
function frontMeshes(run: FrontRun, glass: boolean, pattern: DoorPattern | null, edgeColor: string, bottom: number, paint: Paint): THREE.Object3D[] {
  const [ax, az] = run.a;
  const len = Math.hypot(run.b[0] - ax, run.b[1] - az);
  if (len < 0.01) return [];
  const u = { x: (run.b[0] - ax) / len, z: (run.b[1] - az) / len };
  const n = { x: -u.z, z: u.x };
  // Turned so a front's x runs along the run and its z points out of it.
  const turn = Math.atan2(-u.z, u.x);

  const out: THREE.Object3D[] = [];
  run.faces.forEach((f: Face) => {
    if (f.w <= 0 || f.h <= 0) return;
    // Each front in its own frame: x from its left edge, y up from its bottom, z out from the box.
    const front = new THREE.Group();
    front.position.set(ax + u.x * f.x + n.x * 0.02, f.y, az + u.z * f.x + n.z * 0.02);
    front.rotation.y = turn;
    out.push(front);

    const design = pattern && f.kind === 'door' ? doorDesign(f, pattern) : null;
    if (paint.realistic) {
      front.add(...realisticFront(f, run.faces, glass, design, bottom + f.y, paint));
      return;
    }
    if (design) {
      front.add(...patternFront(f, design, glass, edgeColor, paint));
      return;
    }
    const opening = f.kind === 'opening';
    const thick = opening ? OPENING_THICK_IN : FACE_THICK_IN;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, thick), paint.mat(opening ? 'appliance' : 'face'));
    panel.position.set(f.w / 2, f.h / 2, thick / 2);
    front.add(paint.outline(panel, opening ? COLORS.applianceEdge : edgeColor));

    if (glass && f.kind === 'door') {
      const stile = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4);
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(f.w - 2 * stile, f.h - 2 * stile),
        paint.mat('glass', { roughness: 0.15, transparent: true, opacity: 0.8 })
      );
      pane.position.set(f.w / 2, f.h / 2, thick + 0.02);
      front.add(pane);
    }
    if (archedDoor(f, glass, paint)) {
      // The arched panel, as a line on the door.
      const s = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4);
      const panel = archOutline(f.w - 2 * s, f.h - 2 * s).map(([x, y]) => new THREE.Vector3(x + s, y + s, thick + 0.02));
      front.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(panel), new THREE.LineBasicMaterial({ color: edgeColor })));
    }
    if (f.kind === 'drawer' && f.h > 3) {
      const pull = new THREE.Mesh(new THREE.BoxGeometry(Math.min(f.w * 0.4, 5), 0.5, 0.6), paint.mat('pull'));
      pull.position.set(f.w / 2, f.h - Math.min(f.h / 2, 2), thick + 0.28);
      front.add(pull);
    }
  });
  return out;
}

const rectPoints = ([x0, z0, x1, z1]: LocalRect): Pt2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

/** A box between local x0..x1, z0..z1 and heights y0..y1, outlined. */
function block(rect: LocalRect, y0: number, y1: number, surface: Surface, edge: string, paint: Paint): THREE.Mesh {
  return paint.outline(new THREE.Mesh(prism(rectPoints(rect), y0, y1), paint.mat(surface)), edge);
}

/** An upright cylinder standing on (x, y0, z). */
function post(x: number, z: number, radius: number, y0: number, height: number, surface: Surface, paint: Paint): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), paint.mat(surface));
  mesh.position.set(x, y0 + height / 2, z);
  return mesh;
}

/** A sink set in the counter of its base: rim, bowls with their drains, and the faucet behind. */
function sinkObject(sink: NonNullable<CabinetSolid['sink']>, paint: Paint): THREE.Group {
  const group = new THREE.Group();
  const top = COUNTER_TOP_IN;
  group.add(block(sink.rim, top, top + 0.15, 'steelFace', COLORS.steelEdge, paint));
  for (const bowl of sink.bowls) {
    group.add(block(bowl, top + 0.15, top + 0.18, 'bowl', COLORS.steelEdge, paint));
    group.add(post((bowl[0] + bowl[2]) / 2, (bowl[1] + bowl[3]) / 2, 1.4, top + 0.18, 0.04, 'dark', paint));
  }
  const [fx, fz] = sink.faucet;
  group.add(post(fx, fz, 0.6, top, 11, 'steel', paint));
  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 8), paint.mat('steel'));
  spout.position.set(fx, top + 10.5, fz + 4);
  group.add(spout);
  return group;
}

/** A bowl's inside, facing in: four sides and a floor hanging BOWL_DEPTH_IN under the counter top `top`, a drain in the floor. */
function basin([x0, z0, x1, z1]: LocalRect, top: number, material: THREE.Material, drain: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const bottom = top - BOWL_DEPTH_IN;
  // A plane faces +z; turned about y it faces +x (pi/2), -x (-pi/2) or -z (pi).
  const side = (width: number, x: number, z: number, turn: number) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, BOWL_DEPTH_IN), material);
    wall.position.set(x, bottom + BOWL_DEPTH_IN / 2, z);
    wall.rotation.y = turn;
    group.add(wall);
  };
  side(w, cx, z0, 0);
  side(w, cx, z1, Math.PI);
  side(d, x0, cz, Math.PI / 2);
  side(d, x1, cz, -Math.PI / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, bottom, cz);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.06, 24), drain);
  hole.position.set(cx, bottom + 0.04, cz);
  group.add(floor, hole);
  return group;
}

/** A gooseneck pull-down faucet standing on the counter top `top` at (x, z), its spout arching over toward +z. */
function gooseneck(x: number, z: number, top: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const rise = 12;
  const reach = 4.5;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 1, 24), material);
  base.position.y = 0.5;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, rise, 20), material);
  column.position.y = 1 + rise / 2;
  // A half torus stood up and turned so it arches from the column top forward.
  const arch = new THREE.Mesh(new THREE.TorusGeometry(reach / 2, 0.5, 12, 32, Math.PI), material);
  arch.rotation.y = -Math.PI / 2;
  arch.position.set(0, 1 + rise, reach / 2);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 3.2, 16), material);
  head.position.set(0, 1 + rise - 1.6, reach);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3, 10), material);
  lever.rotation.z = Math.PI / 2.6;
  lever.position.set(1.4, 5, 0);
  group.add(base, column, arch, head, lever);
  group.position.set(x, top, z);
  return group;
}

/** The realistic look's sink: its bowls sunk into the counter (cut out by cabinetObject), and the faucet behind. */
function realisticSink(sink: NonNullable<CabinetSolid['sink']>, materials: FinishMaterials): THREE.Group {
  const group = new THREE.Group();
  for (const bowl of sink.bowls) group.add(basin(bowl, COUNTER_TOP_IN, materials.sink, materials.black));
  group.add(gooseneck(sink.faucet[0], sink.faucet[1], COUNTER_TOP_IN, materials.faucet));
  return group;
}

/**
 * A backsplash panel along the side a→b of a footprint (local inches),
 * `from` inches over the counter top and `height` tall, `thick` off the
 * wall, its face turned to `inside` (a point of the footprint). `bottom`:
 * the footprint's height off the floor. The tiles are laid out from where
 * the side is along the wall line (`toWorld` gives plan inches), so they
 * run on unbroken from one cabinet to the next.
 */
function splashPanel(
  a: Pt2,
  b: Pt2,
  inside: Pt2,
  toWorld: (p: Pt2) => Pt2,
  bottom: number,
  material: THREE.Material,
  { from = 0, height = BACKSPLASH_IN, thick = BACKSPLASH_THICK_IN }: { from?: number; height?: number; thick?: number } = {}
): THREE.Mesh | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return null;
  // Run the side so the panel's face (its +z) turns inward, over the counter.
  if ((inside[0] - (a[0] + b[0]) / 2) * -(b[1] - a[1]) + (inside[1] - (a[1] + b[1]) / 2) * (b[0] - a[0]) < 0) [a, b] = [b, a];
  const u = { x: (b[0] - a[0]) / len, z: (b[1] - a[1]) / len };
  const n = { x: -u.z, z: u.x };
  const geometry = inchBox(len, height, thick);
  // Along the wall line: from the plan's origin, measured the way the side runs.
  const [wax, waz] = toWorld(a);
  const [wbx, wbz] = toWorld(b);
  const along = (wax * (wbx - wax) + waz * (wbz - waz)) / len;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) + along);
  const panel = new THREE.Mesh(geometry, material);
  const off = thick / 2 + 0.01;
  panel.position.set((a[0] + b[0]) / 2 + n.x * off, COUNTER_TOP_IN + from - bottom + height / 2, (a[1] + b[1]) / 2 + n.z * off);
  panel.rotation.y = Math.atan2(-u.z, u.x);
  return panel;
}

/** How one build draws the backsplashes: see splashPaint. */
interface SplashPaint {
  /** The tile's material, null for none, and its height over the counter. */
  tile: THREE.Material | null;
  tileIn: number;
  /** The 4" countertop backsplash's material, null for none. */
  counter: THREE.Material | null;
  outline: (mesh: THREE.Mesh, color: string) => THREE.Mesh;
  /** Faces without backsplash, or kept short of an end (BacksplashSpec.faces), in either look. */
  faces: ReadonlyMap<string, FaceKeep> | null;
}

/**
 * The drawing look draws the Edit tab's backsplashes (`spec`); the
 * realistic look its finish's tile — none for a painted wall — at the
 * Edit tab's height, and the Edit tab's 4" countertop backsplash in the
 * counter's own material.
 */
function splashPaint(paint: Paint, spec: BacksplashSpec | null): SplashPaint {
  return {
    tile: paint.materials ? paint.materials.backsplash : spec?.tileIn ? paint.mat('splash') : null,
    tileIn: spec?.tileIn ?? BACKSPLASH_IN,
    counter: spec?.counter ? paint.mat('counter') : null,
    outline: paint.outline,
    faces: spec?.faces ?? null,
  };
}

/**
 * The part of the side a→b of a footprint (local inches; toPlan to the
 * plan) that has backsplash: none on a face without it, less where its face
 * stops short of an end.
 */
const keptSide = (a: Pt2, b: Pt2, inside: Pt2, toWorld: (p: Pt2) => Pt2, walls: WallSolid[], splash: SplashPaint): [Pt2, Pt2] | null => {
  const part = keptPart(toWorld(a), toWorld(b), toWorld(inside), walls, splash.faces);
  if (!part) return null;
  const at = (f: number): Pt2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return [at(part[0]), at(part[1])];
};

/**
 * The backsplashes along the side a→b of a footprint (as splashPanel): the
 * 4" countertop one where a counter meets the wall, and the tile from the
 * top of it (or from the counter) up to the tile's height.
 */
function splashMeshes(
  a: Pt2,
  b: Pt2,
  inside: Pt2,
  toWorld: (p: Pt2) => Pt2,
  bottom: number,
  hasCounter: boolean,
  splash: SplashPaint
): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const four = hasCounter && splash.counter;
  if (four) {
    const strip = splashPanel(a, b, inside, toWorld, bottom, four, { height: COUNTER_SPLASH_IN, thick: COUNTER_SPLASH_THICK_IN });
    if (strip) out.push(splash.outline(strip, '#6f6d68'));
  }
  const from = four ? COUNTER_SPLASH_IN : 0;
  if (splash.tile && splash.tileIn > from + 0.5) {
    const tile = splashPanel(a, b, inside, toWorld, bottom, splash.tile, { from, height: splash.tileIn - from });
    if (tile) out.push(splash.outline(tile, '#b5afa4'));
  }
  return out;
}

/** The middle of a footprint, to tell its inside from its outside. */
const middle = (pts: Pt2[]): Pt2 => [pts.reduce((sum, [x]) => sum + x, 0) / pts.length, pts.reduce((sum, [, z]) => sum + z, 0) / pts.length];

/**
 * A perimeter base's backsplashes, on each side against a wall (see
 * splashSides in cabinetBacksplash.ts): its back, a corner unit's side leg,
 * and a run's end along the side wall, where the run turns.
 */
function backsplashes(solid: CabinetSolid, walls: WallSolid[], splash: SplashPaint): THREE.Mesh[] {
  const pts = solid.outline;
  const inside = middle(pts);
  const toWorld = (p: Pt2) => toPlan(solid, p);
  return splashSides(solid, walls).flatMap((i) => {
    const side = keptSide(pts[i], pts[(i + 1) % pts.length], inside, toWorld, walls, splash);
    return side ? splashMeshes(side[0], side[1], inside, toWorld, solid.bottom, !!solid.counter, splash) : [];
  });
}

/**
 * A footprint grown outward side by side: side i (from point i to the next)
 * moves out by grow[i], 0 leaving it where it is, the corners meeting where
 * the moved sides cross.
 */
function grownOutline(pts: Pt2[], grow: number[]): Pt2[] {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
  }
  // Outward is to the right of a side when the outline runs counter-clockwise (in x, z)
  const sides = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Pt2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const out: Pt2 = area > 0 ? [u[1], -u[0]] : [-u[1], u[0]];
    return { p: [a[0] + out[0] * grow[i], a[1] + out[1] * grow[i]] as Pt2, u, out };
  });
  return pts.map((corner, i) => {
    const prev = sides[(i - 1 + n) % n];
    const next = sides[i];
    const cross = prev.u[0] * next.u[1] - prev.u[1] * next.u[0];
    if (Math.abs(cross) < 1e-6) return [corner[0] + next.out[0] * grow[i], corner[1] + next.out[1] * grow[i]] as Pt2;
    const dx = next.p[0] - prev.p[0];
    const dz = next.p[1] - prev.p[1];
    const t = (dx * next.u[1] - dz * next.u[0]) / cross;
    return [prev.p[0] + prev.u[0] * t, prev.p[1] + prev.u[1] * t] as Pt2;
  });
}

/**
 * How crown molding meets a side of a cabinet's top: standing out past it,
 * running on across a joint into the next cabinet's crown, or stopping
 * flush at a back or a wall.
 */
export type CrownSide = 'out' | 'joint' | 'flush';

/**
 * Each upper's and tall's crown, side by side: flush at its backs (a
 * corner's side leg too) and at a side against a wall, a joint where it is
 * butted to the next cabinet, out everywhere else.
 */
function crownSides(solids: CabinetSolid[], walls: WallSolid[]): Map<string, CrownSide[]> {
  const tops = solids.filter((s) => s.bottom + s.height >= CROWN_MIN_TOP_IN);
  const planSides = tops.map((s) => s.outline.map((a, i) => [toPlan(s, a), toPlan(s, s.outline[(i + 1) % s.outline.length])] as [Pt2, Pt2]));
  const butted = (pa: Pt2, pb: Pt2, self: number) => {
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (len < 1) return true;
    const ux = (pb[0] - pa[0]) / len;
    const uz = (pb[1] - pa[1]) / len;
    const off = (q: Pt2) => Math.abs((q[0] - pa[0]) * -uz + (q[1] - pa[1]) * ux);
    const along = (q: Pt2) => (q[0] - pa[0]) * ux + (q[1] - pa[1]) * uz;
    // Butted along most of it: a corner upper's front only partly behind the next run's end still shows crown
    return planSides.some((sides, j) =>
      j !== self &&
      sides.some(
        ([qa, qb]) =>
          off(qa) < 1 &&
          off(qb) < 1 &&
          Math.min(Math.max(along(qa), along(qb)), len) - Math.max(Math.min(along(qa), along(qb)), 0) > len * 0.8
      )
    );
  };
  const out = new Map<string, CrownSide[]>();
  tops.forEach((s, si) => {
    out.set(
      s.cabinet.id,
      s.outline.map((_, i): CrownSide => {
        if (s.backs[i]) return 'flush';
        const [pa, pb] = planSides[si][i];
        if (againstWall(pa, pb, walls)) return 'flush';
        return butted(pa, pb, si) ? 'joint' : 'out';
      })
    );
  });
  return out;
}

/**
 * Outline of one band of a cabinet's crown (local frame): its top grown
 * `out` past its 'out' sides. Where an angled side meets a joint — a
 * diagonal corner's face or an angle end's cut beside the next cabinet —
 * the band carries on to the miter with that cabinet's crown, which stands
 * `out` in front of its face, square to the joint; cut off at the joint it
 * would leave a notch.
 */
export function crownBand(pts: Pt2[], sides: CrownSide[], out: number): Pt2[] {
  const n = pts.length;
  const grown = grownOutline(pts, sides.map((side) => (side === 'out' ? out : 0)));
  const dir = (i: number): Pt2 => {
    const [a, b] = [pts[i], pts[(i + 1) % n]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  // Where the line through g along u crosses the line through q square to `normal`.
  const meet = (g: Pt2, u: Pt2, q: Pt2, normal: Pt2): Pt2 => {
    const t = ((q[0] - g[0]) * normal[0] + (q[1] - g[1]) * normal[1]) / (u[0] * normal[0] + u[1] * normal[1]);
    return [g[0] + u[0] * t, g[1] + u[1] * t];
  };
  return pts.flatMap((corner, i): Pt2[] => {
    const prev = (i - 1 + n) % n;
    const [uPrev, uNext] = [dir(prev), dir(i)];
    if (Math.abs(uPrev[0] * uNext[0] + uPrev[1] * uNext[1]) < 1e-3) return [grown[i]];
    if (sides[prev] === 'joint' && sides[i] === 'out') {
      // The joint runs into this corner; the next cabinet's crown front is `out` past it.
      const q: Pt2 = [corner[0] + uPrev[0] * out, corner[1] + uPrev[1] * out];
      return [q, meet(grown[i], uNext, q, uPrev)];
    }
    if (sides[prev] === 'out' && sides[i] === 'joint') {
      // The joint runs out of this corner.
      const q: Pt2 = [corner[0] - uNext[0] * out, corner[1] - uNext[1] * out];
      return [meet(grown[i], uPrev, q, uNext), q];
    }
    return [grown[i]];
  });
}

/** Crown molding over a cabinet's top, standing out past its 'out' sides (local frame). */
function crownMolding(solid: CabinetSolid, sides: CrownSide[], edge: string, paint: Paint): THREE.Mesh[] {
  return CROWN_BANDS.map(([from, to, outBy]) => {
    const band = crownBand(solid.outline, sides, outBy);
    return paint.outline(new THREE.Mesh(prism(band, solid.height + from, solid.height + to), paint.mat('box')), edge);
  });
}

/** In the realistic look a selected cabinet glows faintly, having no outline to colour. */
function glow(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const material = o.material.clone();
    material.emissive.set(COLORS.selected);
    material.emissiveIntensity = 0.22;
    o.material = material;
  });
}

function cabinetObject(
  solid: CabinetSolid,
  selected: boolean,
  paint: Paint,
  walls: WallSolid[],
  crown: CrownSide[] | undefined,
  splash: SplashPaint
): THREE.Group {
  const group = new THREE.Group();
  group.userData.cabinetId = solid.cabinet.id;
  group.position.set(solid.x, solid.bottom, solid.z);
  // The plan turns clockwise on screen (y down); about three's y axis that is negative.
  group.rotation.y = (-solid.rotation * Math.PI) / 180;

  const boxEdge = selected ? COLORS.selected : solid.appliance ? COLORS.applianceEdge : COLORS.boxEdge;
  const faceEdge = selected ? COLORS.selected : COLORS.faceEdge;

  // The realistic look sinks the bowls into the counter, through the box top under it.
  const materials = paint.materials;
  const bowls = materials && solid.sink ? solid.sink.bowls.map(rectPoints) : [];
  const box = new THREE.Mesh(
    prism(solid.outline, solid.toeKick, solid.height, bowls),
    paint.mat(solid.appliance ? 'appliance' : 'box', selected ? { emissive: COLORS.selected, emissiveIntensity: 0.12 } : {})
  );
  group.add(paint.outline(box, boxEdge));
  if (solid.toeKick > 0) {
    group.add(new THREE.Mesh(prism(solid.toeOutline, 0, solid.toeKick), paint.mat('toe')));
  }
  if (solid.counter) {
    const top = new THREE.Mesh(prism(solid.counter, solid.height, COUNTER_TOP_IN, bowls), paint.mat('counter'));
    group.add(paint.outline(top, '#6f6d68'));
  }
  for (const run of solid.fronts) group.add(...frontMeshes(run, solid.glass, solid.doorPattern, faceEdge, solid.bottom, paint));
  if (solid.sink) group.add(materials ? realisticSink(solid.sink, materials) : sinkObject(solid.sink, paint));
  const splashes = backsplashes(solid, walls, splash);
  if (splashes.length) group.add(...splashes);
  if (crown) group.add(...crownMolding(solid, crown, boxEdge, paint));
  if (selected && paint.realistic) glow(group);
  return group;
}

/** One detach & reset appliance, built from boxes in its own frame: x along it, z from its back to its front, y up from its bottom. */
function applianceObject(a: ApplianceSolid, selected: boolean, paint: Paint, walls: WallSolid[], splash: SplashPaint): THREE.Group {
  const group = new THREE.Group();
  // In a cabinet, picking it picks the cabinet.
  if (a.hostId) group.userData.cabinetId = a.hostId;
  group.position.set(a.x, a.bottom, a.z);
  group.rotation.y = (-a.rotation * Math.PI) / 180;

  const { width: w, height: h, back: b } = a;
  const front = b + a.depth;
  const edge = selected ? COLORS.selected : COLORS.steelEdge;
  const body = (surface: Surface = 'steel') => block([0, b, w, front], 0, h, surface, edge, paint);
  // A panel on the front, standing out from it by `out`.
  const panel = (x0: number, x1: number, y0: number, y1: number, surface: Surface, out = 0.4) =>
    block([x0, front, x1, front + out], y0, y1, surface, edge, paint);
  const barAcross = (x0: number, x1: number, y: number) => block([x0, front + 0.4, x1, front + 1.4], y - 0.4, y + 0.4, 'dark', COLORS.dark, paint);
  const barUp = (x: number, y0: number, y1: number) => block([x - 0.4, front + 0.4, x + 0.4, front + 1.4], y0, y1, 'dark', COLORS.dark, paint);
  const burners = (y: number) => {
    for (const fx of [0.28, 0.72]) {
      for (const fz of [0.3, 0.7]) group.add(post(w * fx, b + a.depth * fz, Math.min(w, a.depth) * 0.12, y, 0.25, 'burner', paint));
    }
  };

  switch (a.spec.model) {
    case 'fridge': {
      const split = h * 0.36;
      group.add(body());
      group.add(panel(0.4, w / 2 - 0.2, split + 0.3, h - 0.4, 'steelFace'));
      group.add(panel(w / 2 + 0.2, w - 0.4, split + 0.3, h - 0.4, 'steelFace'));
      group.add(panel(0.4, w - 0.4, 0.4, split - 0.3, 'steelFace'));
      group.add(barUp(w / 2 - 1.6, split + 6, Math.min(split + 34, h - 4)));
      group.add(barUp(w / 2 + 1.6, split + 6, Math.min(split + 34, h - 4)));
      group.add(barAcross(w * 0.3, w * 0.7, split - 3));
      break;
    }
    case 'range': {
      group.add(body());
      group.add(panel(0.8, w - 0.8, 0.5, 4.5, 'steelFace'));
      group.add(panel(0.8, w - 0.8, 5, h - 6, 'steelFace'));
      group.add(panel(4, w - 4, 10, h - 14, 'window', 0.6));
      group.add(barAcross(3, w - 3, h - 8));
      group.add(block([0.5, b + 0.5, w - 0.5, front - 0.5], h, h + 0.3, 'dark', COLORS.dark, paint));
      burners(h + 0.3);
      break;
    }
    case 'cooktop':
      group.add(body('dark'));
      burners(h);
      break;
    case 'oven':
      group.add(body());
      group.add(panel(4, w - 4, h * 0.2, h - 7, 'window', 0.3));
      group.add(barAcross(3, w - 3, h - 3.5));
      break;
    case 'microwave':
      group.add(body());
      group.add(panel(1.5, w * 0.68, 2, h - 2, 'window'));
      group.add(panel(w * 0.72, w - 1.5, 2, h - 2, 'dark'));
      group.add(barUp(w * 0.7, 3, h - 3));
      break;
    case 'hood':
      group.add(body(h > 12 ? 'wood' : 'steel'));
      break;
    case 'disposal':
      group.add(post(w / 2, b + a.depth / 2, (Math.min(w, a.depth) / 2) * 0.9, 0, h, 'dark', paint));
      break;
    default: {
      // A dishwasher (and any appliance this catalog doesn't know).
      group.add(body());
      group.add(panel(0.3, w - 0.3, 4.5, h - 0.3, 'steelFace'));
      group.add(barAcross(3, w - 3, h - 3));
    }
  }
  if (a.counter) group.add(block([0, b, w, front + 1], h, COUNTER_TOP_IN, 'counter', '#6f6d68', paint));
  // In line with the backsplash of the cabinets beside it, whose backs are at
  // the wall; behind a range the tile runs on, up under the microwave or hood over it.
  const behind = applianceSplash(a, walls);
  const side = behind.tile ? keptSide([0, b], [w, b], [w / 2, front], (p) => toPlan(a, p), walls, splash) : null;
  if (side) {
    const splashes = splashMeshes(side[0], side[1], [w / 2, front], (p) => toPlan(a, p), a.bottom, behind.counter, splash);
    if (splashes.length) group.add(...splashes);
  }
  if (selected && paint.realistic) glow(group);
  return group;
}

/** A countertop laid over several cabinets (the island top), in plan coordinates. */
function slabObject(slab: CounterSlab, paint: Paint): THREE.Mesh {
  const top = new THREE.Mesh(prism(slab.outline, slab.bottom, COUNTER_TOP_IN, slab.holes), paint.mat('counter'));
  return paint.outline(top, '#6f6d68');
}

/** A tapered filler in an angled joint, in plan coordinates: finished like the doors on the door side, like the boxes at the back. */
function fillerObject(filler: FillerSolid, paint: Paint): THREE.Group {
  const group = new THREE.Group();
  const front = !!filler.toeOutline;
  const body = new THREE.Mesh(prism(filler.outline, filler.toeKick, filler.height), paint.mat(front ? 'face' : 'box'));
  group.add(paint.outline(body, front ? COLORS.faceEdge : COLORS.boxEdge));
  if (filler.toeOutline && filler.toeKick > 0) {
    group.add(new THREE.Mesh(prism(filler.toeOutline, 0, filler.toeKick), paint.mat('toe')));
  }
  return group;
}

/**
 * A wall. In the drawing look it is see-through, so the cabinets stay in
 * view from any side; in the realistic look it is solid, and remembers
 * which way the room is (`toward`, a point inside it) so cutAwayWalls can
 * take it out when the camera is behind it.
 */
function wallObject(wall: WallSolid, toward: { x: number; z: number }, paint: Paint): THREE.Mesh {
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dz);
  const mesh = new THREE.Mesh(
    paint.realistic ? inchBox(len, WALL_HEIGHT_IN, wall.thickness) : new THREE.BoxGeometry(len, WALL_HEIGHT_IN, wall.thickness),
    paint.mat('wall', { transparent: true, opacity: 0.35, depthWrite: false })
  );
  const mx = (wall.a[0] + wall.b[0]) / 2;
  const mz = (wall.a[1] + wall.b[1]) / 2;
  mesh.position.set(mx, WALL_HEIGHT_IN / 2, mz);
  mesh.rotation.y = Math.atan2(-dz, dx);
  if (paint.realistic && len > 0) {
    let nx = -dz / len;
    let nz = dx / len;
    if ((toward.x - mx) * nx + (toward.z - mz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    mesh.userData.cutaway = { x: mx, z: mz, nx, nz, half: wall.thickness / 2 };
  }
  return paint.outline(mesh, COLORS.wallEdge);
}

/** Everything the 3D view draws for the sketch, as one group to swap out when the sketch changes. */
export function buildCabinetScene(
  solids: CabinetSolid[],
  walls: WallSolid[],
  selectedIds: Set<string>,
  {
    counters = [],
    fillers = [],
    appliances = [],
    finish = null,
    surfaces = null,
    crown = false,
    archedDoors = false,
    backsplash = null,
  }: {
    counters?: CounterSlab[];
    fillers?: FillerSolid[];
    appliances?: ApplianceSolid[];
    /** Draw the realistic look, in this finish; absent for the drawing look. */
    finish?: CabinetSketchFinish | null;
    /** An option's chosen products over the finish (productLook.ts). */
    surfaces?: ProductSurfaces | null;
    /** Top the uppers and talls with crown molding (the estimate's Crown Molding scope). */
    crown?: boolean;
    /** Mark the doors' arched panels in the drawing look; the realistic look goes by its finish. */
    archedDoors?: boolean;
    /** The Edit tab's backsplashes (see splashPaint); none drawn in the drawing look when absent. */
    backsplash?: BacksplashSpec | null;
  } = {}
): THREE.Group {
  const paint = finish ? realisticPaint(finish, surfaces) : archedDoors ? { ...DRAWING, doors: 'arched' } : DRAWING;
  const splash = splashPaint(paint, backsplash);
  const root = new THREE.Group();
  const bounds = modelBounds(solids, walls, applianceExtent(appliances));
  const center = bounds ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } : { x: 0, z: 0 };
  if (bounds) {
    // The floor, a couple of feet past the drawing on every side; a 1 ft grid on it in the drawing look.
    const size = Math.ceil((Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 48) / 12) * 12;
    const plane = new THREE.PlaneGeometry(size, size);
    if (paint.realistic) {
      const uv = plane.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    }
    const floor = new THREE.Mesh(plane, paint.mat('floor'));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, 0, center.z);
    floor.userData.floor = true;
    root.add(floor);
    if (!paint.realistic) {
      const grid = new THREE.GridHelper(size, size / 12, COLORS.grid, COLORS.grid);
      grid.position.set(center.x, 0.05, center.z);
      root.add(grid);
    }
  }
  for (const wall of walls) root.add(wallObject(wall, center, paint));
  // A range in its range base is drawn in place of the base's own appliance box.
  const replaced = new Set(appliances.filter((a) => a.replacesHost).map((a) => a.hostId));
  const crowns = crown ? crownSides(solids, walls) : new Map<string, CrownSide[]>();
  for (const solid of solids) {
    if (!replaced.has(solid.cabinet.id)) {
      root.add(cabinetObject(solid, selectedIds.has(solid.cabinet.id), paint, walls, crowns.get(solid.cabinet.id), splash));
    }
  }
  // In the realistic look an island sink's bowls sink through the island top too.
  const islandBowls = paint.materials
    ? solids
        .filter((s) => s.sink && !s.counter)
        .flatMap((s) => s.sink!.bowls.map((bowl) => rectPoints(bowl).map((p) => toPlan(s, p))))
    : [];
  for (const slab of counters) {
    const holes = islandBowls.filter((hole) => inPolygon(hole[0], slab.outline));
    root.add(slabObject(holes.length ? { ...slab, holes: [...slab.holes, ...holes] } : slab, paint));
  }
  for (const filler of fillers) root.add(fillerObject(filler, paint));
  for (const a of appliances) {
    root.add(applianceObject(a, !!a.hostId && selectedIds.has(a.hostId), paint, walls, splash));
  }
  if (paint.realistic) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = !o.userData.floor;
      o.receiveShadow = true;
    });
  }
  return root;
}

/**
 * Realistic look: hide each wall the camera stands behind, so the room is
 * seen as through an opening. Returns which walls show, one 0/1 each, so a
 * change can be noticed.
 */
export function cutAwayWalls(root: THREE.Object3D, camera: THREE.Camera): string {
  const eye = camera.position;
  let shown = '';
  for (const child of root.children) {
    const cut = child.userData.cutaway as { x: number; z: number; nx: number; nz: number; half: number } | undefined;
    if (!cut) continue;
    child.visible = (eye.x - cut.x) * cut.nx + (eye.z - cut.z) * cut.nz > -cut.half;
    shown += child.visible ? '1' : '0';
  }
  return shown;
}

/** Free the GPU buffers of everything under `root`, but the kept textures (finishMaterials.ts), and take any HTML labels off the page. */
export function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    // A label's element is only taken off when the label itself is removed, not a group above it.
    if (obj instanceof CSS2DObject) obj.element.remove();
    const item = obj as THREE.Mesh;
    item.geometry?.dispose();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    const release = (m: THREE.Material) => {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map && !map.userData.keep) map.dispose();
      m.dispose();
    };
    if (Array.isArray(material)) material.forEach(release);
    else if (material) release(material);
  });
}

/** The cabinet a picked object belongs to, if any. */
export function cabinetIdOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) {
    if (o.userData.cabinetId) return o.userData.cabinetId as string;
  }
  return null;
}
