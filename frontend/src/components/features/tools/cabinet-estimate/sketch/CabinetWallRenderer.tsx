/**
 * CabinetWallRenderer
 *
 * Renders a cabinet-layout wall as a thick line with endpoint drag handles,
 * plus the ghost-line preview shown while a wall is being drawn.
 *
 * Ported from water-mitigation/sketch/canvas/WMFloorPlanRenderer.tsx's
 * WMWallRenderer/WMWallPreview — those are already domain-agnostic (no WM
 * material-type fields), so only the type import changes.
 */

import React, { useCallback, useState } from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { CabinetSketchWall } from '@/types/cabinetSketch';
import { DEFAULT_WALL_COLOR } from '@/types/cabinetSketch';

interface CabinetWallRendererProps {
  wall: CabinetSketchWall;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEndpoint: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  /** Drag the entire wall (both endpoints move together) */
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
  /** Stage zoom, so the length label and handles keep a constant on-screen size. */
  zoom?: number;
}

const CabinetWallRendererInner: React.FC<CabinetWallRendererProps> = ({
  wall,
  isSelected,
  onSelect,
  onDragEndpoint,
  onWallDragEnd,
  zoom = 1,
}) => {
  const px = 1 / zoom;
  const { id, thickness, color } = wall;

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  // The end handles sit inside this Group, which is draggable while the wall
  // is selected. A handle's drag events would bubble up to it, and the
  // Group would take the handle's position for its own move: the wall jumped
  // by the handle's coordinates on top of the end being moved. So the
  // handles keep their events, and the Group only acts on its own drag.
  const handleGroupDragEnd = useCallback(
    (e: any) => {
      if (e.target !== e.currentTarget) return;
      const dx = e.target.x();
      const dy = e.target.y();
      e.target.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) onWallDragEnd?.(id, dx, dy);
    },
    [id, onWallDragEnd]
  );

  // Where the end being dragged is now, so the wall and its length follow the
  // handle instead of jumping only when it is let go.
  const [dragging, setDragging] = useState<{ end: 'start' | 'end'; x: number; y: number } | null>(null);

  const handleEndpointDragMove = useCallback((end: 'start' | 'end', e: any) => {
    e.cancelBubble = true;
    setDragging({ end, x: e.target.x(), y: e.target.y() });
  }, []);

  const handleEndpointDragEnd = useCallback(
    (end: 'start' | 'end', e: any) => {
      e.cancelBubble = true;
      const x = e.target.x();
      const y = e.target.y();
      setDragging(null);
      // Back on the wall's end: the drop may snap elsewhere or change nothing,
      // and an unchanged prop would leave the handle where it was let go.
      e.target.position(end === 'start' ? { x: wall.start_x, y: wall.start_y } : { x: wall.end_x, y: wall.end_y });
      onDragEndpoint(id, end, x, y);
    },
    [id, onDragEndpoint, wall.start_x, wall.start_y, wall.end_x, wall.end_y]
  );

  const stopBubble = useCallback((e: any) => {
    e.cancelBubble = true;
  }, []);

  const start_x = dragging?.end === 'start' ? dragging.x : wall.start_x;
  const start_y = dragging?.end === 'start' ? dragging.y : wall.start_y;
  const end_x = dragging?.end === 'end' ? dragging.x : wall.end_x;
  const end_y = dragging?.end === 'end' ? dragging.y : wall.end_y;

  const strokeWidth = thickness || 4;

  const midX = (start_x + end_x) / 2;
  const midY = (start_y + end_y) / 2;
  const dx = end_x - start_x;
  const dy = end_y - start_y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  const nx = wallLen > 0 ? -dy / wallLen : 0;
  const ny = wallLen > 0 ? dx / wallLen : -1;
  const labelOffset = 14 * px;
  const labelX = midX + nx * labelOffset;
  const labelY = midY + ny * labelOffset;
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  const labelRotation = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;

  // While an end is dragged the length scales with the line (feet per pixel from the saved wall).
  const savedLen = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y);
  const lengthFt = dragging && savedLen > 0 ? (wall.length_ft * wallLen) / savedLen : wall.length_ft;
  const lengthLabel = lengthFt > 0 ? `${lengthFt.toFixed(1)}'` : '';

  return (
    <Group id={id} name="sketch-item" draggable={isSelected} onDragEnd={handleGroupDragEnd}>
      <Line
        points={[start_x, start_y, end_x, end_y]}
        stroke={isSelected ? '#1890ff' : color || DEFAULT_WALL_COLOR}
        strokeWidth={strokeWidth}
        lineCap="round"
        hitStrokeWidth={Math.max(strokeWidth + 10, 16)}
        onClick={handleClick}
        onTap={handleClick}
      />

      {lengthLabel && wallLen * zoom > 30 && (
        <Group x={labelX} y={labelY} rotation={labelRotation}>
          <Text
            text={lengthLabel}
            fontSize={11 * px}
            fill={isSelected ? '#1890ff' : '#595959'}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fontStyle={isSelected ? 'bold' : 'normal'}
            offsetX={lengthLabel.length * 3.2 * px}
            offsetY={6 * px}
            listening={false}
          />
        </Group>
      )}

      <Circle x={start_x} y={start_y} radius={3} fill={color || DEFAULT_WALL_COLOR} listening={false} />
      <Circle x={end_x} y={end_y} radius={3} fill={color || DEFAULT_WALL_COLOR} listening={false} />

      {isSelected && (
        <>
          <Circle
            x={start_x}
            y={start_y}
            radius={7 * px}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            strokeScaleEnabled={false}
            draggable
            onDragStart={stopBubble}
            onDragMove={(e) => handleEndpointDragMove('start', e)}
            onDragEnd={(e) => handleEndpointDragEnd('start', e)}
          />
          <Circle
            x={end_x}
            y={end_y}
            radius={7 * px}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            strokeScaleEnabled={false}
            draggable
            onDragStart={stopBubble}
            onDragMove={(e) => handleEndpointDragMove('end', e)}
            onDragEnd={(e) => handleEndpointDragEnd('end', e)}
          />
        </>
      )}
    </Group>
  );
};

export const CabinetWallRenderer = React.memo(CabinetWallRendererInner);

// ============================================================================
// Wall Drawing Preview (ghost line from start point to cursor)
// ============================================================================

interface CabinetWallPreviewProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  snappedEnd?: { x: number; y: number } | null;
}

export const CabinetWallPreview: React.FC<CabinetWallPreviewProps> = ({
  startX,
  startY,
  endX,
  endY,
  snappedEnd,
}) => {
  return (
    <Group listening={false}>
      <Line
        points={[startX, startY, endX, endY]}
        stroke="#1890ff"
        strokeWidth={3}
        dash={[8, 4]}
        opacity={0.7}
        lineCap="round"
      />
      <Circle x={startX} y={startY} radius={5} fill="#1890ff" opacity={0.8} />
      <Circle x={endX} y={endY} radius={4} fill="#1890ff" opacity={0.6} />
      {snappedEnd && <CabinetWallSnapMark x={snappedEnd.x} y={snappedEnd.y} />}
    </Group>
  );
};

/** The green ring where a wall point will join a wall already drawn — at its end or partway along it. */
export const CabinetWallSnapMark: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <Circle x={x} y={y} radius={8} fill="transparent" stroke="#52c41a" strokeWidth={2} opacity={0.9} listening={false} />
);

export default CabinetWallRenderer;
