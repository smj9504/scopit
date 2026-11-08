/**
 * A tub's or shower's faucet and drain on the plan, where they're set
 * (utils/plumbingPoints). With the fixture selected they can be dragged: a
 * wall faucet slides along the walls it can be on and jumps to the nearest
 * one, a deck faucet and a drain go anywhere in the fixture.
 *
 * Drawn inside the fixture's own group, so in its frame: (0, 0) its centre,
 * turned with it.
 */

import React from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import type { BEFixture } from '@/types/bathroomSketch';
import {
  clampDrain,
  drainOf,
  faucetEdge,
  faucetOf,
  snapFaucet,
  type Edge,
  type Pt01,
} from './utils/plumbingPoints';

const INK = '#444';
const SOFT = '#999';
const METAL = '#b8bcc0';
const PICK = '#1890ff';

/** Turn so the mark's +y points into the fixture from its wall */
const INWARD_DEG: Record<Edge, number> = { north: 0, east: 90, south: 180, west: -90 };

interface Props {
  fixture: BEFixture;
  wPx: number;
  hPx: number;
  ppf: number;
  /** Selected and the select tool on: the marks can be dragged */
  editable: boolean;
  onChange: (props: Partial<BEFixture['properties']>) => void;
}

const BEPlumbingMarks: React.FC<Props> = ({ fixture, wPx, hPx, ppf, editable, onChange }) => {
  const k = ppf / 12; // px per inch
  const toLocal = (pt: Pt01) => ({ x: (pt.x - 0.5) * wPx, y: (pt.y - 0.5) * hPx });
  const to01 = (x: number, y: number): Pt01 => ({ x: x / wPx + 0.5, y: y / hPx + 0.5 });
  const isShower = fixture.type === 'shower';

  const faucet = faucetOf(fixture);
  const edge = faucetEdge(fixture, faucet);
  const drain = drainOf(fixture);
  const fAt = toLocal(faucet);
  const dAt = toLocal(drain);
  const grab = Math.max(7, 3 * k);

  const cursor = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => {
    const stage = e.target.getStage();
    if (stage && editable) stage.container().style.cursor = c;
  };
  const hover = {
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => cursor(e, 'move'),
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => cursor(e, ''),
  };

  // The faucet: on a wall, a spout (a tub's) or the head with the valve under it
  // (a shower's), pointing into the fixture; on a deck or the floor, a round one
  const faucetMark = edge ? (
    isShower ? (
      <>
        <Rect x={-2 * k} y={0} width={4 * k} height={1.5 * k} fill={METAL} stroke={INK} strokeWidth={0.6} />
        <Line points={[0, 1.5 * k, 0, 4.2 * k]} stroke={SOFT} strokeWidth={0.6} />
        <Circle x={0} y={6 * k} radius={1.8 * k} fill={METAL} stroke={INK} strokeWidth={0.8} />
      </>
    ) : (
      <>
        <Rect x={-0.9 * k} y={0} width={1.8 * k} height={3.5 * k} fill={METAL} stroke={INK} strokeWidth={0.6} cornerRadius={0.4 * k} />
        <Circle x={0} y={1 * k} radius={1.3 * k} fill={METAL} stroke={INK} strokeWidth={0.6} />
      </>
    )
  ) : (
    <Circle x={0} y={0} radius={1.6 * k} fill={METAL} stroke={INK} strokeWidth={0.8} />
  );

  const ring = (r: number) => editable && <Circle radius={r} stroke={PICK} strokeWidth={1} dash={[3, 2]} listening={false} />;

  return (
    <>
      {/* Drain: a grate, round with a cross */}
      <Group
        x={dAt.x}
        y={dAt.y}
        draggable={editable}
        listening={editable}
        {...hover}
        onDragStart={(e) => { e.cancelBubble = true; }}
        onDragMove={(e) => {
          e.cancelBubble = true;
          const pt = clampDrain(to01(e.target.x(), e.target.y()));
          const at = toLocal(pt);
          e.target.position(at);
        }}
        onDragEnd={(e) => {
          e.cancelBubble = true;
          onChange({ drainPos: clampDrain(to01(e.target.x(), e.target.y())) });
        }}
      >
        <Circle radius={grab} fill="transparent" />
        <Circle radius={1.6 * k} fill="#fff" stroke={INK} strokeWidth={0.8} />
        <Line points={[-1.1 * k, -1.1 * k, 1.1 * k, 1.1 * k]} stroke={INK} strokeWidth={0.6} />
        <Line points={[1.1 * k, -1.1 * k, -1.1 * k, 1.1 * k]} stroke={INK} strokeWidth={0.6} />
        {ring(2.6 * k)}
      </Group>

      {/* Faucet */}
      <Group
        x={fAt.x}
        y={fAt.y}
        rotation={edge ? INWARD_DEG[edge] : 0}
        draggable={editable}
        listening={editable}
        {...hover}
        onDragStart={(e) => { e.cancelBubble = true; }}
        onDragMove={(e) => {
          e.cancelBubble = true;
          const pt = snapFaucet(fixture, to01(e.target.x(), e.target.y()));
          const at = toLocal(pt);
          e.target.position(at);
          const onEdge = faucetEdge(fixture, pt);
          e.target.rotation(onEdge ? INWARD_DEG[onEdge] : 0);
        }}
        onDragEnd={(e) => {
          e.cancelBubble = true;
          onChange({ faucetPos: snapFaucet(fixture, to01(e.target.x(), e.target.y())) });
        }}
      >
        <Circle y={edge ? 2 * k : 0} radius={grab} fill="transparent" />
        {faucetMark}
        {editable && (
          <Circle y={edge ? (isShower ? 3 * k : 1.5 * k) : 0} radius={(edge && isShower ? 5 : 2.8) * k} stroke={PICK} strokeWidth={1} dash={[3, 2]} listening={false} />
        )}
      </Group>
    </>
  );
};

export default BEPlumbingMarks;
