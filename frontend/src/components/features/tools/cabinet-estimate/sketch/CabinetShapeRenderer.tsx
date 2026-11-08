/**
 * CabinetShapeRenderer
 *
 * Renders a placed cabinet on the Konva canvas: a rectangle, or for a
 * corner unit its L / angled / blind footprint.
 * Supports drag (optionally snapping as it goes, see onDragSnap) and
 * rotate (Shift = 15° snap) via Transformer. No resize:
 * the footprint follows the Edit tab box the shape stands for.
 *
 * Uppers are drawn dashed and see-through over the bases, as on a printed
 * kitchen plan; the heavier line marks the front (door side), a blue double
 * line marks it instead on a cabinet with glass doors, and a dotted rust line
 * runs along it on one with a pattern in its doors.
 *
 * Ported from water-mitigation/sketch/canvas/WMShapeRenderer.tsx, keeping
 * only the rectangle path — no ellipse/door/stairs branches; corner
 * outlines are drawn here from the cabinet's own footprint.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Line, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import type { CabinetSketchCabinet } from '@/types/cabinetSketch';
import { bayFront, wrapFront } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CornerKind } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';

/** 15° snap angles for Shift+Rotate (0, 15, 30, …, 345) */
export const ROTATION_SNAP_ANGLES = Array.from({ length: 24 }, (_, i) => i * 15);

const FILL_BY_TYPE: Record<string, { fill: string; opacity: number }> = {
  base: { fill: '#D2B48C', opacity: 0.85 },
  specialty: { fill: '#D2B48C', opacity: 0.85 },
  tall: { fill: '#B8926A', opacity: 0.9 },
  wall: { fill: '#EADBC4', opacity: 0.55 },
};

const GLASS_STROKE = '#6E9CC0';
const PATTERN_STROKE = '#9A4A1F';

/** Konva hit-target sizing — fixed desktop sizes (no touch-device variant needed here) */
export const ANCHOR_SIZE = 8;
export const ROTATE_ANCHOR_OFFSET = 20;

/** A corner unit's footprint, in canvas pixels (see cornerFootprint). */
export interface CornerShape {
  kind: CornerKind;
  side: 'left' | 'right';
  /** Depth of each leg of an L / diagonal. */
  leg: number;
  /** Length of a blind corner's covered end. */
  blind: number;
}

/**
 * Closed outline and door faces (flat x, y lists) of a shaped unit, its
 * corner — or, for an angle end or a three-door corner, the end that joins
 * the run — at local x = 0 unless it is on the right. `null` for a blind
 * corner, which is a plain box.
 */
function cornerOutline(corner: CornerShape, w: number, h: number): { outline: number[]; front: number[] } | null {
  const d = corner.leg;
  let pts: [number, number][];
  let front: [number, number][];
  if (corner.kind === 'l') {
    pts = [[0, 0], [w, 0], [w, d], [d, d], [d, h], [0, h]];
    front = [[w, d], [d, d], [d, h]];
  } else if (corner.kind === 'diagonal') {
    pts = [[0, 0], [w, 0], [w, d], [d, h], [0, h]];
    front = [[w, d], [d, h]];
  } else if (corner.kind === 'end_wrap') {
    front = wrapFront(w, h);
    pts = [[0, 0], ...[...front].reverse()];
  } else if (corner.kind === 'bay_end') {
    front = bayFront(w, h);
    pts = [[0, 0], ...[...front].reverse()];
  } else if (corner.kind === 'angle_end') {
    // Cut back at 45° from the full-depth end: a triangle once it is as wide as it is deep.
    const outer = Math.max(h - w, 0);
    pts = [[0, 0], [w, 0], [w, outer], [0, h]];
    front = [[w, outer], [0, h]];
  } else {
    return null;
  }
  const mirror = (p: [number, number][]) => (corner.side === 'right' ? p.map(([x, y]) => [w - x, y]) : p).flat();
  return { outline: mirror(pts), front: mirror(front) };
}

export interface CabinetShapeRendererProps {
  cabinet: CabinetSketchCabinet;
  isSelected: boolean;
  /**
   * Picked: `ctrlKey` adds it to the selection or takes it out; `single`
   * (double-click or Alt+click) picks just this one, not the island it is in.
   */
  onSelect: (id: string, ctrlKey?: boolean, single?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  /** Right-clicked: the page position, for the edit panel. */
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Show its own turning handle when selected; off while several are selected, which share one. */
  handles?: boolean;
  /**
   * Mid-drag: where the shape should sit instead of under the pointer
   * (lined up with a neighbour), or null to follow the pointer.
   */
  onDragSnap?: (id: string, x: number, y: number) => { x: number; y: number; rotation: number } | null;
  /** Rotation finished: the new back-left corner and rotation (size never changes here). */
  onTransformEnd?: (id: string, x: number, y: number, rotation: number) => void;
  /** Stage zoom, so labels and outlines keep a constant on-screen size. */
  zoom?: number;
  /** Set for a corner unit, which draws its real footprint instead of a box. */
  corner?: CornerShape | null;
}

const CabinetShapeRenderer: React.FC<CabinetShapeRendererProps> = ({
  cabinet,
  isSelected,
  onSelect,
  onDragEnd,
  onDragSnap,
  onTransformEnd,
  zoom = 1,
  corner,
  onContextMenu,
  handles = true,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { width, height } = cabinet;

  // Reset Konva node transform state when dimensions change from props
  useEffect(() => {
    const node = rectRef.current;
    if (!node) return;
    node.scaleX(1);
    node.scaleY(1);
    node.x(0);
    node.y(0);
    node.rotation(0);
    node.width(width);
    node.height(height);
    node.getLayer()?.batchDraw();
  }, [width, height]);

  // Attach / detach transformer
  useEffect(() => {
    if (!transformerRef.current || !rectRef.current) return;
    if (isSelected && handles) {
      transformerRef.current.nodes([rectRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [isSelected, handles]);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // The right button opens the edit panel instead.
      if (e.evt.button === 2) return;
      onSelect(cabinet.id, e.evt.ctrlKey || e.evt.metaKey, e.evt.altKey);
    },
    [cabinet.id, onSelect]
  );

  const handleDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 2) return;
      onSelect(cabinet.id, e.evt.ctrlKey || e.evt.metaKey, true);
    },
    [cabinet.id, onSelect]
  );

  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      onContextMenu?.(cabinet.id, e.evt.clientX, e.evt.clientY);
    },
    [cabinet.id, onContextMenu]
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(cabinet.id, e.target.x(), e.target.y());
    },
    [cabinet.id, onDragEnd]
  );

  // Konva re-places the node under the pointer before every dragmove, so
  // moving it here sticks it to the snap without fighting the drag.
  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!onDragSnap) return;
      const node = e.target;
      const snapped = onDragSnap(cabinet.id, node.x(), node.y());
      node.rotation(snapped?.rotation ?? cabinet.rotation);
      if (snapped) node.position({ x: snapped.x, y: snapped.y });
    },
    [cabinet.id, cabinet.rotation, onDragSnap]
  );

  // Shift-key snap: toggle Konva's native rotationSnaps during transform.
  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const tr = transformerRef.current;
    if (!tr) return;
    const shiftHeld = !!(e.evt as MouseEvent)?.shiftKey;
    const currentSnaps = tr.rotationSnaps();
    if (shiftHeld && (!currentSnaps || currentSnaps.length === 0)) {
      tr.rotationSnaps(ROTATION_SNAP_ANGLES);
    } else if (!shiftHeld && currentSnaps && currentSnaps.length > 0) {
      tr.rotationSnaps([]);
    }
  }, []);

  // Center-stable transform transfer: compute the shape's visual center
  // BEFORE reset, then reposition the group so the center stays fixed.
  const handleTransformEnd = useCallback(() => {
    if (!rectRef.current || !groupRef.current) return;
    if (transformerRef.current) transformerRef.current.rotationSnaps([]);

    const node = rectRef.current;
    const group = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    const newWidth = Math.max(10, node.width() * scaleX);
    const newHeight = Math.max(10, node.height() * scaleY);

    const groupRot = group.rotation();
    const nodeRot = node.rotation();
    const nodeX = node.x();
    const nodeY = node.y();

    const localCX = (node.width() * scaleX) / 2;
    const localCY = (node.height() * scaleY) / 2;

    const nRad = (nodeRot * Math.PI) / 180;
    const centerInGroupX = nodeX + localCX * Math.cos(nRad) - localCY * Math.sin(nRad);
    const centerInGroupY = nodeY + localCX * Math.sin(nRad) + localCY * Math.cos(nRad);

    const gRad = (groupRot * Math.PI) / 180;
    const centerParentX = group.x() + centerInGroupX * Math.cos(gRad) - centerInGroupY * Math.sin(gRad);
    const centerParentY = group.y() + centerInGroupX * Math.sin(gRad) + centerInGroupY * Math.cos(gRad);

    const newRotation = groupRot + nodeRot;

    node.rotation(0);
    node.scaleX(1);
    node.scaleY(1);
    node.width(newWidth);
    node.height(newHeight);
    node.x(0);
    node.y(0);

    const newCX = newWidth / 2;
    const newCY = newHeight / 2;
    const newRad = (newRotation * Math.PI) / 180;
    group.x(centerParentX - (newCX * Math.cos(newRad) - newCY * Math.sin(newRad)));
    group.y(centerParentY - (newCX * Math.sin(newRad) + newCY * Math.cos(newRad)));
    group.rotation(newRotation);

    onTransformEnd?.(cabinet.id, group.x(), group.y(), newRotation);
  }, [cabinet.id, onTransformEnd]);

  const labelText = cabinet.label || cabinet.preset_code;
  const isUpper = cabinet.cab_type === 'wall';
  const look = FILL_BY_TYPE[cabinet.cab_type] ?? FILL_BY_TYPE.base;
  // Label metrics are in screen pixels, converted to canvas units.
  const px = 1 / zoom;
  const showLabel = labelText.length > 0 && width * zoom > 20 && height * zoom > 12;

  // An L or diagonal corner draws its real outline; the Rect stays (unseen,
  // unclickable) as the Transformer's frame. A blind corner keeps the box
  // and shades the end the other run covers.
  const shaped = corner ? cornerOutline(corner, width, height) : null;
  const outline = shaped?.outline ?? null;
  const blind = corner?.kind === 'blind' ? corner : null;
  const blindX = blind ? (blind.side === 'left' ? 0 : width - blind.blind) : 0;
  // Door side: the inside faces of an L/diagonal, the cut face of an angle end, the open part of a blind corner.
  const front = shaped
    ? shaped.front
    : blind
      ? blind.side === 'left'
        ? [blind.blind, height, width, height]
        : [0, height, width - blind.blind, height]
      : [0, height, width, height];
  // Where the label fits: the strip along the back wall of an L, the deep half of an angle end.
  const labelBand =
    !shaped || !corner ? height : corner.kind === 'angle_end' || corner.kind === 'bay_end' ? height / 2 : corner.leg;
  const turned = ((cabinet.rotation % 360) + 360) % 360;
  const labelUpsideDown = turned > 90 && turned < 270;
  const outlineStyle = {
    stroke: '#8B5E3C',
    strokeWidth: 1.5,
    strokeScaleEnabled: false,
    dash: isUpper ? [5 * px, 3 * px] : undefined,
  };

  return (
    <>
      <Group
        ref={groupRef}
        id={cabinet.id}
        name="sketch-item"
        x={cabinet.x}
        y={cabinet.y}
        rotation={cabinet.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onContextMenu={handleContextMenu}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <Rect
          ref={rectRef}
          width={width}
          height={height}
          fill={look.fill}
          opacity={outline ? 0 : look.opacity}
          listening={!outline}
          {...outlineStyle}
          cornerRadius={2}
        />
        {outline && <Line points={outline} closed fill={look.fill} opacity={look.opacity} {...outlineStyle} />}
        {blind && (
          <>
            <Rect x={blindX} width={blind.blind} height={height} fill="#ffffff" opacity={0.45} listening={false} />
            <Line
              points={[blind.side === 'left' ? blind.blind : width - blind.blind, 0, blind.side === 'left' ? blind.blind : width - blind.blind, height]}
              stroke="#8B5E3C"
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[3 * px, 3 * px]}
              listening={false}
            />
          </>
        )}
        {cabinet.has_glass_door ? (
          <>
            <Line points={front} stroke={GLASS_STROKE} strokeWidth={4} strokeScaleEnabled={false} listening={false} />
            <Line points={front} stroke="#ffffff" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          </>
        ) : (
          !isUpper && (
            <Line points={front} stroke="#5A3E28" strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />
          )
        )}
        {cabinet.door_pattern && (
          <Line
            points={front}
            stroke={PATTERN_STROKE}
            strokeWidth={3}
            strokeScaleEnabled={false}
            dash={[2 * px, 3 * px]}
            listening={false}
          />
        )}
        {isSelected &&
          (outline ? (
            <Line
              points={outline}
              closed
              stroke="#1890ff"
              strokeWidth={2}
              strokeScaleEnabled={false}
              dash={[6 * px, 3 * px]}
              listening={false}
            />
          ) : (
            <Rect
              width={width}
              height={height}
              fill="transparent"
              stroke="#1890ff"
              strokeWidth={2}
              strokeScaleEnabled={false}
              dash={[6 * px, 3 * px]}
              listening={false}
            />
          ))}
        {showLabel && (
          <Text
            // Turned about its own middle when the cabinet is more than a
            // quarter turn round, so the code never reads upside down.
            x={width / 2}
            y={(isUpper ? 2 * px : Math.max(labelBand / 2 - 7 * px, labelBand - 16 * px)) + 5.5 * px}
            offsetX={width / 2 - 2 * px}
            offsetY={5.5 * px}
            rotation={labelUpsideDown ? 180 : 0}
            width={width - 4 * px}
            text={labelText}
            fontSize={11 * px}
            fontStyle="bold"
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#5A3E28"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        )}
      </Group>

      <Transformer
        ref={transformerRef}
        rotateEnabled
        resizeEnabled={false}
        rotateAnchorOffset={ROTATE_ANCHOR_OFFSET}
        borderStroke="#1890ff"
        borderDash={[3, 3]}
        anchorSize={ANCHOR_SIZE}
        anchorCornerRadius={2}
        anchorStroke="#1890ff"
        anchorFill="#ffffff"
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 10 || newBox.height < 10) return oldBox;
          return newBox;
        }}
      />
    </>
  );
};

export default React.memo(CabinetShapeRenderer);
