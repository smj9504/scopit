/**
 * The floor plan of a real kitchen sketched in the Cabinet Estimator, drawn
 * the way the app's plan (PlanPicture in kitchenDrawings.tsx) draws it, in the
 * landing page's blues: walls, the island top, base and tall cabinets, the
 * sink, the detach & reset appliances, then the uppers, dashed and see-through
 * over the bases, and each wall's length. Decorative; the copy carries the meaning.
 */
import React from 'react';
import {
  PLAN_APPLIANCES,
  PLAN_CABINETS,
  PLAN_FRAME,
  PLAN_GRID,
  PLAN_ISLAND_TOP,
  PLAN_LABEL,
  PLAN_PX,
  PLAN_SINKS,
  PLAN_WALLS,
} from './kitchenPlanData';
import type { PlanAppliance, PlanCabinet } from './kitchenPlanData';

const WALL = '#111827';
const LINE = '#1e3a8a';
const FILL = { base: '#dbeafe', tall: '#bfdbfe', wall: '#eff6ff' } as const;
const GLASS = '#93c5fd';
const TOP = '#f1f5f9';
const TOP_LINE = '#94a3b8';
const BODY = '#f8fafc';
const BODY_LINE = '#475569';
const TAG = '#2563eb';
const SINK_LINE = '#64748b';

const pts = (flat: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(`${flat[i]},${flat[i + 1]}`);
  return out.join(' ');
};
const pose = (p: { x: number; y: number; r: number }) => `translate(${p.x} ${p.y}) rotate(${p.r})`;

const Cabinet: React.FC<{ c: PlanCabinet }> = ({ c }) => {
  const upper = c.t === 'wall';
  const body = {
    fill: FILL[c.t],
    fillOpacity: upper ? 0.55 : 0.9,
    stroke: LINE,
    strokeWidth: 1.2,
    strokeDasharray: upper ? '4 2.5' : undefined,
    strokeLinejoin: 'round' as const,
  };
  const front = pts(c.f);
  return (
    <g transform={pose(c)}>
      {c.o ? <polygon points={pts(c.o)} {...body} /> : <rect width={c.w} height={c.h} rx={1.5} {...body} />}
      {c.glass ? (
        <>
          <polyline points={front} fill="none" stroke={GLASS} strokeWidth={3.4} />
          <polyline points={front} fill="none" stroke="#ffffff" strokeWidth={1.3} />
        </>
      ) : (
        !upper && <polyline points={front} fill="none" stroke={LINE} strokeWidth={2.2} />
      )}
      {c.pattern && <polyline points={front} fill="none" stroke={LINE} strokeWidth={2.4} strokeDasharray="1.6 2.4" />}
      {c.label && (
        <text
          x={c.label.x}
          y={c.label.y}
          transform={c.label.flip ? `rotate(180 ${c.label.x} ${c.label.y})` : undefined}
          fontSize={PLAN_LABEL}
          fill={LINE}
        >
          {c.label.text}
        </text>
      )}
    </g>
  );
};

const Appliance: React.FC<{ a: PlanAppliance }> = ({ a }) => {
  const burner = Math.min(a.w, a.h) * 0.12;
  return (
    <g transform={pose(a)}>
      <rect width={a.w} height={a.h} rx={1.5} fill={BODY} fillOpacity={0.95} stroke={BODY_LINE} strokeWidth={1.2} />
      {a.burners &&
        [0.28, 0.72].flatMap((fx) =>
          [0.3, 0.7].map((fy) => (
            <circle key={`${fx}-${fy}`} cx={a.w * fx} cy={a.h * fy} r={burner} fill="none" stroke={BODY_LINE} strokeWidth={0.8} />
          ))
        )}
      <line x1={0} y1={a.h} x2={a.w} y2={a.h} stroke="#334155" strokeWidth={2.2} />
      <g transform={`translate(${a.w / 2} ${a.labelY})${a.flip ? ' rotate(180)' : ''}`}>
        {a.roomy ? (
          <>
            <text y={-5.5 * PLAN_PX} fontSize={11 * PLAN_PX} fill="#1e293b">{a.code}</text>
            <text y={5.5 * PLAN_PX} fontSize={9 * PLAN_PX} fill={TAG}>D&amp;R</text>
          </>
        ) : (
          <text y={-0.5 * PLAN_PX} fontSize={9 * PLAN_PX} fill={TAG}>{a.code} D&amp;R</text>
        )}
      </g>
    </g>
  );
};

const KitchenPlan: React.FC = () => {
  const { x, y, w, h } = PLAN_FRAME;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`}>
      <defs>
        <pattern id="lp-kitchen-grid" width={PLAN_GRID} height={PLAN_GRID} patternUnits="userSpaceOnUse">
          <path d={`M${PLAN_GRID} 0H0V${PLAN_GRID}`} fill="none" stroke="#eef2f7" strokeWidth={0.8} />
        </pattern>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill="url(#lp-kitchen-grid)" />
      <g fontFamily="Inter, 'Segoe UI', sans-serif" fontWeight={700} textAnchor="middle" dominantBaseline="central">
        {PLAN_WALLS.map((wall, i) => (
          <line key={i} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} stroke={WALL} strokeWidth={wall.t} strokeLinecap="round" />
        ))}
        {PLAN_ISLAND_TOP.map((loop, i) => (
          <polygon key={i} points={pts(loop)} fill={TOP} stroke={TOP_LINE} strokeWidth={0.8} />
        ))}
        {PLAN_CABINETS.filter((c) => c.t !== 'wall').map((c, i) => <Cabinet key={i} c={c} />)}
        {PLAN_SINKS.map((s, i) => {
          const [rx, ry, rw, rh] = s.rim;
          return (
            <g key={i} transform={pose(s)}>
              <rect x={rx} y={ry} width={rw} height={rh} rx={1.5 * s.k} fill={BODY} stroke={SINK_LINE} strokeWidth={0.8} />
              {s.bowls.map(([bx, by, bw, bh], j) => (
                <React.Fragment key={j}>
                  <rect x={bx} y={by} width={bw} height={bh} rx={2 * s.k} fill="#e2e8f0" stroke={SINK_LINE} strokeWidth={0.8} />
                  <circle cx={bx + bw / 2} cy={by + bh / 2} r={1.2 * s.k} fill={SINK_LINE} />
                </React.Fragment>
              ))}
              <circle cx={s.faucet[0]} cy={s.faucet[1]} r={1.1 * s.k} fill={SINK_LINE} />
            </g>
          );
        })}
        {PLAN_APPLIANCES.map((a, i) => <Appliance key={i} a={a} />)}
        {PLAN_CABINETS.filter((c) => c.t === 'wall').map((c, i) => <Cabinet key={i} c={c} />)}
        {PLAN_WALLS.map((wall, i) => (
          <text
            key={i}
            x={wall.lx}
            y={wall.ly}
            transform={`rotate(${wall.lr} ${wall.lx} ${wall.ly})`}
            fontSize={PLAN_LABEL}
            fill={WALL}
          >
            {`${wall.len.toFixed(1)}′`}
          </text>
        ))}
      </g>
    </svg>
  );
};

export default KitchenPlan;
