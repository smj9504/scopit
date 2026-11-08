/**
 * The kitchen's drawings as pictures, for the design quote's PDF: the floor
 * plan and the front elevations from the Sketch tab's own renderers, off
 * screen, and the 3D views (cabinet3dSnapshot). The backend only lays them
 * out. Imported on demand when a quote with drawings is exported.
 */

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { CabinetEstimate } from '@/types/cabinetEstimate';
import type { CabinetSketch } from '@/types/cabinetSketch';
import { DEFAULT_WALL_COLOR, DEFAULT_WALL_THICKNESS } from '@/types/cabinetSketch';
import { CABINET_PRESETS } from '@/components/features/tools/cabinet-estimate/CabinetBoxEditor';
import { ApplianceShape, SinkShape } from '@/components/features/tools/cabinet-estimate/sketch/CabinetApplianceRenderer';
import CabinetElevationView from '@/components/features/tools/cabinet-estimate/sketch/CabinetElevationView';
import CabinetShapeRenderer from '@/components/features/tools/cabinet-estimate/sketch/CabinetShapeRenderer';
import {
  buildElevations,
  cabinetSizeIn,
  cornerFootprint,
  islandJointFillers,
  islandTopPieces,
  polygonUnion,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { drawingInput, planFrame, wallLengthPlace } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawingModel';
import type { KitchenDrawingInput, PlanFrame } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawingModel';
import { SINK_SPECIALTIES, applianceSpec } from '@/components/features/tools/cabinet-estimate/sketch/sketchAppliances';

/** Picture sizes, px, for a letter page's 7.3" column: at these a 10-11px label prints near 7-8pt. */
const PLAN_MAX_WIDTH = 720;
const PLAN_MAX_HEIGHT = 750;
const ELEVATION_WIDTH = 720;
const ELEVATION_HEIGHT = 400;
/** Line drawings are drawn this many times over, to stay sharp on paper. */
const PIXEL_RATIO = 3;
const GRID_COLOR = '#ececec';
/** A wall's length on the plan: its size and how far off the wall, picture px, and how wide its box. */
const WALL_LABEL_SIZE = 11;
const WALL_LABEL_GAP = 14;
const WALL_LABEL_WIDTH = 60;
const PNG_PREFIX = /^data:image\/\w+;base64,/;
const noop = () => {};

export interface KitchenDrawings {
  plan?: string;
  elevations?: { label: string; image: string }[];
  views?: { label: string; image: string }[];
}

export interface DrawingRequest {
  plan: boolean;
  elevations: boolean;
  /** The 3D views, in the realistic look or the outlined drawing. */
  views3d: boolean;
  realistic: boolean;
}

/**
 * The plan as the Sketch tab draws it (CabinetSketchEditor), in the same order
 * and nothing selected; only the walls' lengths go where paper can show them.
 */
const PlanPicture = React.forwardRef<Konva.Stage, { input: KitchenDrawingInput; frame: PlanFrame }>(function PlanPicture(
  { input, frame },
  ref
) {
  const { cabinets, walls, appliances, scalePixelsPerFoot: scale, sinkBowls } = input;
  const { zoom } = frame;
  const outline = polygonUnion(islandTopPieces(cabinets, scale, input.islandSeatingIn));
  const fillers = islandJointFillers(cabinets, scale).map((f) => f.wedge);
  const sinks = cabinets.flatMap((c) => {
    const specialty = CABINET_PRESETS[c.preset_code]?.specialty;
    if (c.cab_type === 'wall' || !specialty || !SINK_SPECIALTIES.includes(specialty)) return [];
    const { width, depth } = cabinetSizeIn(c, CABINET_PRESETS, scale);
    return [{ cabinet: c, widthIn: width, depthIn: depth, apron: specialty === 'farmhouse_sink_base' }];
  });
  const cabinetShape = (cabinet: KitchenDrawingInput['cabinets'][number]) => (
    <CabinetShapeRenderer
      key={cabinet.id}
      cabinet={cabinet}
      isSelected={false}
      onSelect={noop}
      onDragEnd={noop}
      zoom={zoom}
      corner={cornerFootprint(cabinet, CABINET_PRESETS, scale)}
    />
  );
  const applianceShape = (appliance: KitchenDrawingInput['appliances'][number]) => (
    <ApplianceShape key={appliance.id} appliance={appliance} isSelected={false} zoom={zoom} onSelect={noop} onDragEnd={noop} />
  );
  const isHung = (a: KitchenDrawingInput['appliances'][number]) => applianceSpec(a.type).mount === 'hung';

  const grid: React.ReactNode[] = [];
  const hairline = 0.75 / zoom;
  for (let x = Math.ceil(frame.minX / scale) * scale; x <= frame.maxX; x += scale) {
    grid.push(<Line key={`v${x}`} points={[x, frame.minY, x, frame.maxY]} stroke={GRID_COLOR} strokeWidth={hairline} />);
  }
  for (let y = Math.ceil(frame.minY / scale) * scale; y <= frame.maxY; y += scale) {
    grid.push(<Line key={`h${y}`} points={[frame.minX, y, frame.maxX, y]} stroke={GRID_COLOR} strokeWidth={hairline} />);
  }

  return (
    <Stage ref={ref} width={frame.width} height={frame.height} scaleX={zoom} scaleY={zoom} x={frame.x} y={frame.y}>
      <Layer listening={false}>
        <Rect x={frame.minX} y={frame.minY} width={frame.maxX - frame.minX} height={frame.maxY - frame.minY} fill="#ffffff" />
        {grid}
      </Layer>
      <Layer listening={false}>
        {walls.map((wall) => (
          <Line
            key={wall.id}
            points={[wall.start_x, wall.start_y, wall.end_x, wall.end_y]}
            stroke={wall.color || DEFAULT_WALL_COLOR}
            strokeWidth={wall.thickness || DEFAULT_WALL_THICKNESS}
            lineCap="round"
          />
        ))}
        {outline.length > 0 && (
          <Shape
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              for (const loop of outline) {
                loop.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                ctx.closePath();
              }
              ctx.fillStrokeShape(shape);
            }}
            fill="#E4DED3"
            stroke="#A89F8F"
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        )}
        {fillers.map((wedge, i) => (
          <Line
            key={`filler-${i}`}
            points={wedge.flatMap((p) => [p.x, p.y])}
            closed
            fill="#D2B48C"
            opacity={0.85}
            stroke="#8B5E3C"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        ))}
        {cabinets.filter((c) => c.cab_type !== 'wall').map(cabinetShape)}
        {sinks.map((sink) => (
          <SinkShape key={`sink-${sink.cabinet.id}`} bowls={sinkBowls} {...sink} />
        ))}
        {appliances.filter((a) => !isHung(a)).map(applianceShape)}
        {cabinets.filter((c) => c.cab_type === 'wall').map(cabinetShape)}
        {appliances.filter(isHung).map(applianceShape)}
        {walls
          .filter((wall) => wall.length_ft > 0)
          .map((wall) => (
            <Text
              key={`length-${wall.id}`}
              {...wallLengthPlace(wall, cabinets, WALL_LABEL_GAP / zoom)}
              offsetX={WALL_LABEL_WIDTH / zoom / 2}
              offsetY={WALL_LABEL_SIZE / zoom / 2}
              width={WALL_LABEL_WIDTH / zoom}
              align="center"
              text={`${wall.length_ft.toFixed(1)}'`}
              fontSize={WALL_LABEL_SIZE / zoom}
              fontStyle="bold"
              fontFamily="'Inter', 'Segoe UI', sans-serif"
              fill="#111827"
            />
          ))}
      </Layer>
    </Stage>
  );
});

const pause = (ms: number) => new Promise((done) => window.setTimeout(done, ms));

/** Draw `node` in a throwaway root off the page, and hand its element to `read`. */
async function offScreen<T>(node: (ref: React.Ref<any>) => React.ReactElement, read: (host: HTMLElement, current: any) => Promise<T> | T): Promise<T> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;';
  document.body.appendChild(host);
  const root = createRoot(host);
  const ref = React.createRef<any>();
  try {
    flushSync(() => root.render(node(ref)));
    return await read(host, ref.current);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** The floor plan, PNG in base64. The stage's shapes are drawn by Konva's own renderer, a moment after React's. */
async function drawPlan(input: KitchenDrawingInput): Promise<string | undefined> {
  const frame = planFrame(input, PLAN_MAX_WIDTH, PLAN_MAX_HEIGHT);
  if (!frame) return undefined;
  return offScreen(
    (ref) => <PlanPicture ref={ref} input={input} frame={frame} />,
    async (_host, stage: Konva.Stage) => {
      for (let wait = 0; wait < 80 && !stage.getLayers()[1]?.hasChildren(); wait += 1) await pause(25);
      return stage.toDataURL({ mimeType: 'image/png', pixelRatio: PIXEL_RATIO }).replace(PNG_PREFIX, '');
    }
  );
}

/** An SVG on the page as a PNG in base64, on white. */
async function svgToPng(svg: SVGSVGElement): Promise<string> {
  const image = new Image();
  await new Promise((done, fail) => {
    image.onload = done;
    image.onerror = fail;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = svg.width.baseVal.value * PIXEL_RATIO;
  canvas.height = svg.height.baseVal.value * PIXEL_RATIO;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').replace(PNG_PREFIX, '');
}

/** One picture per front elevation, named as on the Sketch tab. */
async function drawElevations(input: KitchenDrawingInput): Promise<{ label: string; image: string }[]> {
  const runs = buildElevations(input.cabinets, input.walls, CABINET_PRESETS, input.scalePixelsPerFoot);
  const out: { label: string; image: string }[] = [];
  for (const run of runs) {
    const image = await offScreen(
      () => (
        <CabinetElevationView
          run={run}
          presets={CABINET_PRESETS}
          height={ELEVATION_HEIGHT}
          fixedWidth={ELEVATION_WIDTH}
          crownMolding={input.crownMolding}
          archedDoors={input.archedDoors}
        />
      ),
      (host) => svgToPng(host.querySelector('svg')!)
    );
    out.push({ label: run.label, image });
  }
  return out;
}

/**
 * The drawings asked for, from the saved estimate and sketch. What couldn't be
 * drawn is left out and named in `missed`, for the person exporting to be told.
 */
export async function drawKitchen(
  sketch: CabinetSketch,
  estimate: CabinetEstimate,
  { plan, elevations, views3d, realistic }: DrawingRequest
): Promise<{ drawings: KitchenDrawings; missed: string[] }> {
  const input = drawingInput(sketch, estimate, CABINET_PRESETS);
  const drawings: KitchenDrawings = {};
  const missed: string[] = [];
  if (plan) {
    try {
      drawings.plan = await drawPlan(input);
    } catch {
      missed.push('floor plan');
    }
  }
  if (elevations) {
    try {
      drawings.elevations = await drawElevations(input);
    } catch {
      missed.push('front elevations');
    }
  }
  if (views3d) {
    try {
      const { renderKitchenViews } = await import('@/components/features/tools/cabinet-estimate/sketch/cabinet3dSnapshot');
      drawings.views = await renderKitchenViews(input, CABINET_PRESETS, realistic);
    } catch {
      drawings.views = [];
    }
    if (drawings.views.length === 0) missed.push('3D views');
  }
  return { drawings, missed };
}
