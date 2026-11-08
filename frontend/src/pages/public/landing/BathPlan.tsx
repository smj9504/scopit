/**
 * The floor plan of a real bathroom sketched in the Bathroom Estimator, drawn
 * the way the app's Sketch tab (BESketchCanvas) draws it, in the landing
 * page's blues: the room, its walls, the tile zones, the drywall repair mark,
 * then the fixtures with the tub's and shower's faucet and drain. The app's
 * area labels and dimension tags are left off; they don't read at this size.
 * Decorative; the copy carries the meaning.
 */
import React from 'react';
import { BATH_DRYWALL, BATH_FIXTURES, BATH_FRAME, BATH_PPF, BATH_ROOMS, BATH_ZONES } from './bathPlanData';
import type { BathFixture, BathZoneType } from './bathPlanData';

const INK = '#1e3a8a';
const WALL = '#111827';
const ACCENT = '#2563eb';
const METAL = '#cbd5e1';
const SOFT = '#94a3b8';

// The app tells its tile zones apart by hue; here they are tints of one blue.
const ZONE_FILL: Record<BathZoneType, [string, number]> = {
  floor: ['#2563eb', 0.1],
  tub_surround: ['#3b82f6', 0.32],
  tub_deck: ['#1d4ed8', 0.3],
  tub_front_panel: ['#60a5fa', 0.4],
  shower_walls: ['#3b82f6', 0.32],
  shower_floor: ['#93c5fd', 0.45],
  shower_curb: ['#64748b', 0.35],
  shower_glass_panel: ['#bae6fd', 0.6],
  shower_door: ['#7dd3fc', 0.5],
};

// The fixture shapes' own colours, mapped onto the page's.
const COLOR: Record<string, string> = {
  '#444': INK,
  '#999': SOFT,
  '#d4eaf7': '#dbeafe',
  '#2196f3': ACCENT,
  '#90caf9': '#93c5fd',
};
const color = (c: string) => (c === 'none' ? 'none' : COLOR[c.toLowerCase()] ?? c);

const pts = (flat: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(`${flat[i]},${flat[i + 1]}`);
  return out.join(' ');
};

/** px per inch on the plan, which the plumbing marks are sized in. */
const K = BATH_PPF / 12;
const INWARD: Record<string, number> = { north: 0, east: 90, south: 180, west: -90 };

const Plumbing: React.FC<{ f: BathFixture }> = ({ f }) => {
  const p = f.plumbing!;
  const at = (pt: number[]) => [(pt[0] - 0.5) * f.w, (pt[1] - 0.5) * f.h];
  const [dx, dy] = at(p.drain);
  const [fx, fy] = at(p.faucet);
  const c = 1.1 * K;
  return (
    <>
      <g transform={`translate(${dx} ${dy})`}>
        <circle r={1.6 * K} fill="#ffffff" stroke={INK} strokeWidth={0.8} />
        <path d={`M${-c} ${-c}L${c} ${c}M${c} ${-c}L${-c} ${c}`} stroke={INK} strokeWidth={0.6} />
      </g>
      <g transform={`translate(${fx} ${fy}) rotate(${p.edge ? INWARD[p.edge] ?? 0 : 0})`}>
        {p.edge && p.shower ? (
          <>
            <rect x={-2 * K} y={0} width={4 * K} height={1.5 * K} fill={METAL} stroke={INK} strokeWidth={0.6} />
            <line x1={0} y1={1.5 * K} x2={0} y2={4.2 * K} stroke={SOFT} strokeWidth={0.6} />
            <circle cy={6 * K} r={1.8 * K} fill={METAL} stroke={INK} strokeWidth={0.8} />
          </>
        ) : p.edge ? (
          <>
            <rect x={-0.9 * K} y={0} width={1.8 * K} height={3.5 * K} rx={0.4 * K} fill={METAL} stroke={INK} strokeWidth={0.6} />
            <circle cy={1 * K} r={1.3 * K} fill={METAL} stroke={INK} strokeWidth={0.6} />
          </>
        ) : (
          <circle r={1.6 * K} fill={METAL} stroke={INK} strokeWidth={0.8} />
        )}
      </g>
    </>
  );
};

const Fixture: React.FC<{ f: BathFixture }> = ({ f }) => (
  <g transform={`translate(${f.x} ${f.y}) rotate(${f.r})`}>
    <g transform={`translate(${-f.w / 2} ${-f.h / 2}) scale(${f.w} ${f.h})`}>
      {f.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={color(p.fill)}
          stroke={color(p.stroke)}
          strokeWidth={p.sw}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
    {f.plumbing && <Plumbing f={f} />}
  </g>
);

const BathPlan: React.FC = () => {
  const { x, y, w, h } = BATH_FRAME;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`}>
      {BATH_ROOMS.map((room, i) => (
        <polygon key={i} points={pts(room)} fill="#f8fbff" stroke={WALL} strokeWidth={3} strokeLinejoin="round" />
      ))}
      {BATH_ZONES.map((zone) =>
        zone.pieces.map((piece, i) => (
          <polygon
            key={`${zone.type}-${i}`}
            points={pts(piece)}
            fill={ZONE_FILL[zone.type][0]}
            fillOpacity={ZONE_FILL[zone.type][1]}
            stroke={INK}
            strokeOpacity={0.25}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))
      )}
      {BATH_DRYWALL.map(([x1, y1, x2, y2], i) => (
        <g key={i} strokeLinecap="round">
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeWidth={6.5} strokeOpacity={0.3} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeWidth={2.5} strokeDasharray="8 4" />
          <circle cx={x1} cy={y1} r={4} fill={ACCENT} />
          <circle cx={x2} cy={y2} r={4} fill={ACCENT} />
        </g>
      ))}
      {BATH_FIXTURES.map((f, i) => <Fixture key={i} f={f} />)}
    </svg>
  );
};

export default BathPlan;
