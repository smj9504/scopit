/**
 * CabinetElevationView
 *
 * Front elevation of one cabinet run, drawn to scale from the floor plan
 * (see buildElevations in cabinetSketchLayout.ts). Read-only: cabinets are
 * moved in the plan and sized in the Edit tab; this view only shows how
 * the run reads from the front — door/drawer layout (glass doors from the
 * Edit tab's Glass box drawn as panes, its door patterns as a lattice, arched
 * panels when the job's doors are arched), upper mounting height, countertop
 * line and widths, crown molding over the uppers and talls when the
 * estimate has it, and its backsplashes (tile, 4" countertop) where they run.
 *
 * Plain SVG rather than Konva: nothing here is interactive, and SVG scales
 * crisply and prints/exports as-is.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ElevationItem, ElevationRun, PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import {
  ARCH_MIN_DOOR_IN,
  COUNTER_TOP_IN,
  CROWN_BANDS,
  CROWN_HEIGHT_IN,
  CROWN_MIN_TOP_IN,
  GLASS_STILE_IN,
  LATTICE_BAR_IN,
  TOE_KICK_IN,
  archOutline,
  doorDesign,
  facesFor,
} from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import type { Face } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';
import { COUNTER_SPLASH_IN } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';
import type { BacksplashSpec, RunSplash } from '@/components/features/tools/cabinet-estimate/sketch/cabinetBacksplash';

/** Reference ceiling drawn behind the run (8 ft). */
const CEILING_IN = 96;

const INK = '#111827';
const INK_SECONDARY = '#374151';
const HAIRLINE = '#dfdfdc';
const QUIET_FILL = '#f7f7f5';
const BOX_FILL = '#F3E8D8';
const BOX_STROKE = '#8B5E3C';
const FACE_STROKE = '#A87B54';
const FACE_FILL = '#FBF6EF';
const APPLIANCE_FILL = '#d9d9d6';
const COUNTER_FILL = '#8c8a85';
/** The tile backsplash: 3x6 subway in running bond, as the 3D drawing look's colour. */
const TILE_FILL = '#E6EEEC';
const TILE_GROUT = '#b8c6c2';
const TILE_STROKE = '#8fa6a0';
const GLASS_FILL = '#DCEAF3';
const GLASS_STROKE = '#7FA6C2';
const LATTICE_BEHIND = '#6b645a';
const SELECTED = '#2563eb';

const MARGIN_X = 40;
// Room for an upper's label over crown on a 42"H cabinet, whose top is at the ceiling line.
const MARGIN_TOP = 44;
const MARGIN_BOTTOM = 76;

function formatFeetInches(totalIn: number): string {
  const rounded = Math.round(totalIn * 4) / 4;
  const ft = Math.floor(rounded / 12);
  const inch = Math.round((rounded - ft * 12) * 100) / 100;
  if (ft === 0) return `${inch}"`;
  return inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
}

export interface CabinetElevationViewProps {
  run: ElevationRun | undefined;
  presets: PresetCatalog;
  height: number;
  selectedIds?: Set<string>;
  /** Draw crown molding over the uppers and talls (the Edit tab's Crown Molding scope). */
  crownMolding?: boolean;
  /** Draw the doors' arched panels. */
  archedDoors?: boolean;
  /** Draw at this width, px, instead of the container's: for a picture of it. */
  fixedWidth?: number;
  /**
   * The Edit tab's backsplashes, and where they run behind this run
   * (splashOnRun in cabinetBacksplash.ts): the tile from the counter up its
   * height, the 4" countertop one at its foot.
   */
  backsplash?: BacksplashSpec | null;
  splash?: RunSplash | null;
}

/** A stretch of crown: over cabinets side by side with the same top, and how far it returns at each end. */
interface CrownRun {
  key: string;
  left: number;
  right: number;
  top: number;
  outLeft: boolean;
  outRight: boolean;
}

/**
 * Crown over the uppers and talls of a run: one stretch per row of cabinets
 * butted side by side at the same top. An end returns past the cabinet
 * unless it meets the wall or a taller cabinet beside it.
 */
function crownRuns(items: ElevationItem[], wall?: { left_in: number; right_in: number }): CrownRun[] {
  const tops = items
    .filter((i) => i.bottom_in + i.height_in >= CROWN_MIN_TOP_IN)
    .sort((a, b) => a.left_in - b.left_in);
  const topOf = (i: ElevationItem) => i.bottom_in + i.height_in;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const runs: CrownRun[] = [];
  for (const i of tops) {
    const last = runs[runs.length - 1];
    if (last && near(last.right, i.left_in) && near(last.top, topOf(i))) {
      last.right = i.left_in + i.width_in;
      continue;
    }
    runs.push({ key: i.cabinet.id, left: i.left_in, right: i.left_in + i.width_in, top: topOf(i), outLeft: true, outRight: true });
  }
  const tallerAt = (x: number, top: number) => tops.some((i) => topOf(i) > top + 0.5 && x > i.left_in - 0.5 && x < i.left_in + i.width_in + 0.5);
  for (const r of runs) {
    r.outLeft = !(wall && near(r.left, wall.left_in)) && !tallerAt(r.left, r.top);
    r.outRight = !(wall && near(r.right, wall.right_in)) && !tallerAt(r.right, r.top);
  }
  return runs;
}

const CabinetElevationView: React.FC<CabinetElevationViewProps> = ({
  run,
  presets,
  height,
  selectedIds,
  crownMolding = false,
  archedDoors = false,
  fixedWidth,
  backsplash = null,
  splash = null,
}) => {
  // The tile pattern's id, unique on the page (useId's colons don't belong in url(#…)).
  const tileId = `tile${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setWidth] = useState(900);
  const width = fixedWidth ?? measuredWidth;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.floor(w)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!run || run.items.length === 0) return null;
    const lengthIn = Math.max(run.length_in, 24);
    const ppi = Math.min((width - MARGIN_X * 2) / lengthIn, (height - MARGIN_TOP - MARGIN_BOTTOM) / CEILING_IN);
    const x0 = (width - lengthIn * ppi) / 2;
    const floorY = MARGIN_TOP + CEILING_IN * ppi;
    return {
      lengthIn,
      ppi,
      x: (inches: number) => x0 + inches * ppi,
      y: (aff: number) => floorY - aff * ppi,
      floorY,
    };
  }, [run, width, height]);

  if (!run || !layout) {
    return (
      <div ref={containerRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SECONDARY, fontSize: 13 }}>
        No cabinets to show yet. Add cabinets in the Edit tab and they appear here.
      </div>
    );
  }

  const { x, y, ppi, floorY, lengthIn } = layout;
  const wallLeft = run.wall ? run.wall.left_in : 0;
  const wallRight = run.wall ? run.wall.right_in : lengthIn;
  const lowers = run.items.filter((i) => i.bottom_in === 0);
  const uppers = run.items.filter((i) => i.bottom_in > 0);
  const tileIn = backsplash?.tileIn ?? null;

  const renderItem = (item: ElevationItem) => {
    const c = item.cabinet;
    const specialty = presets[c.preset_code]?.specialty;
    const isRange = specialty === 'range_base_slide_in' || specialty === 'range_base_drop_in';
    const isLower = item.bottom_in === 0;
    const left = x(item.left_in);
    const top = y(item.bottom_in + item.height_in);
    const w = item.width_in * ppi;
    const h = item.height_in * ppi;
    const selected = selectedIds?.has(c.id);
    const faces = facesFor(c.cab_type, specialty, item.width_in, item.height_in, c.corner_side, c.door_pattern);
    const fx = (f: Face) => left + f.x * ppi;
    const fy = (f: Face) => y(item.bottom_in + f.y + f.h);
    // A point on a door, inches from its bottom-left corner, on the drawing.
    const onFace = (f: Face, px: number, py: number): [number, number] => [left + (f.x + px) * ppi, y(item.bottom_in + f.y + py)];

    return (
      <g key={c.id}>
        {!isRange && (
          <rect x={left} y={top} width={w} height={h} fill={BOX_FILL} stroke={selected ? SELECTED : BOX_STROKE} strokeWidth={selected ? 2 : 1.25} />
        )}
        {isLower && !isRange && c.cab_type !== 'tall' && (
          <rect x={left + ppi} y={y(TOE_KICK_IN)} width={w - 2 * ppi} height={TOE_KICK_IN * ppi} fill={HAIRLINE} />
        )}
        {faces.map((f, i) => {
          const fw = f.w * ppi;
          const fh = f.h * ppi;
          if (f.kind === 'opening') {
            return (
              <g key={i}>
                <rect x={fx(f)} y={fy(f)} width={fw} height={fh} fill={APPLIANCE_FILL} stroke={INK_SECONDARY} strokeWidth={1} />
                {f.label && fh > 14 && (
                  <text x={fx(f) + fw / 2} y={fy(f) + fh / 2 + 4} textAnchor="middle" fontSize={10} fill={INK_SECONDARY} letterSpacing={0.5}>
                    {f.label}
                  </text>
                )}
              </g>
            );
          }
          // Drawer pull: a short bar centred near the top of the drawer front.
          const handleLen = Math.min(fw * 0.4, 4 * ppi);
          const handleY = fy(f) + Math.min(fh / 2, 2 * ppi);
          // Glass insert: a pane inside the door frame, with the usual two reflection strokes.
          const stile = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4) * ppi;
          const design = c.door_pattern && f.kind === 'door' ? doorDesign(f, c.door_pattern) : null;
          const pane =
            c.has_glass_door && f.kind === 'door' && !design
              ? { x: fx(f) + stile, y: fy(f) + stile, w: fw - 2 * stile, h: fh - 2 * stile }
              : null;
          const m = pane ? Math.min(pane.w, pane.h) : 0;
          const sx = pane ? pane.x + pane.w * 0.22 : 0;
          const sy = pane ? pane.y + pane.h * 0.5 : 0;
          const arched = archedDoors && f.kind === 'door' && !c.has_glass_door && !design && Math.min(f.w, f.h) >= ARCH_MIN_DOOR_IN;
          const barW = Math.max(LATTICE_BAR_IN * ppi, 1.5);
          return (
            <g key={i}>
              <rect
                x={fx(f)}
                y={fy(f)}
                width={fw}
                height={fh}
                fill={FACE_FILL}
                stroke={FACE_STROKE}
                strokeWidth={0.75}
                strokeDasharray={f.kind === 'panel' ? '3 2' : undefined}
              />
              {pane && pane.w > 4 && pane.h > 4 && (
                <g stroke={GLASS_STROKE}>
                  <rect x={pane.x} y={pane.y} width={pane.w} height={pane.h} fill={GLASS_FILL} strokeWidth={0.75} />
                  <line x1={sx} y1={sy} x2={sx + m * 0.4} y2={sy - m * 0.4} strokeWidth={1} />
                  <line x1={sx + m * 0.1} y1={sy + m * 0.1} x2={sx + m * 0.38} y2={sy - m * 0.18} strokeWidth={1} />
                </g>
              )}
              {arched && (
                <polygon
                  points={archOutline(f.w - 2 * (stile / ppi), f.h - 2 * (stile / ppi))
                    .map(([ax, ay]) => onFace(f, ax + stile / ppi, ay + stile / ppi).join(','))
                    .join(' ')}
                  fill="none"
                  stroke={FACE_STROKE}
                  strokeWidth={0.75}
                />
              )}
              {design && (
                <g>
                  <rect
                    x={onFace(f, design.opening.x, 0)[0]}
                    y={onFace(f, 0, design.opening.y + design.opening.h)[1]}
                    width={design.opening.w * ppi}
                    height={design.opening.h * ppi}
                    fill={c.has_glass_door ? GLASS_FILL : LATTICE_BEHIND}
                    stroke={FACE_STROKE}
                    strokeWidth={0.75}
                  />
                  {design.bars.map(([x0, y0, x1, y1], b) => {
                    const [ax, ay] = onFace(f, x0, y0);
                    const [bx, by] = onFace(f, x1, y1);
                    return <line key={b} x1={ax} y1={ay} x2={bx} y2={by} stroke={FACE_FILL} strokeWidth={barW} />;
                  })}
                  {design.band?.ovals.map((o, b) => {
                    const [cx, cy] = onFace(f, o.cx, o.cy);
                    return <ellipse key={b} cx={cx} cy={cy} rx={o.rx * ppi} ry={o.ry * ppi} fill={LATTICE_BEHIND} stroke={FACE_STROKE} strokeWidth={0.5} />;
                  })}
                  {design.band?.diamonds.map((d, b) => {
                    const [cx, cy] = onFace(f, d.cx, d.cy);
                    const r = d.r * ppi;
                    return (
                      <polygon
                        key={b}
                        points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                        fill={LATTICE_BEHIND}
                        stroke={FACE_STROKE}
                        strokeWidth={0.5}
                      />
                    );
                  })}
                </g>
              )}
              {f.kind === 'drawer' && fh > 6 && (
                <line
                  x1={fx(f) + fw / 2 - handleLen / 2}
                  x2={fx(f) + fw / 2 + handleLen / 2}
                  y1={handleY}
                  y2={handleY}
                  stroke={INK_SECONDARY}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Countertop over every base cabinet; a range opening breaks it.
  const counters = lowers.filter((i) => {
    const sp = presets[i.cabinet.preset_code]?.specialty;
    return i.cabinet.cab_type !== 'tall' && sp !== 'range_base_slide_in' && sp !== 'range_base_drop_in';
  });

  // Under the floor: each lower's code over its width; then the run length.
  const codeY = floorY + 16;
  const dimY = floorY + 29;
  const totalY = floorY + 56;
  const widthLabel = (i: ElevationItem) => `${Math.round(i.width_in * 100) / 100}"`;
  // Narrow cabinets can't fit their code; their width still shows.
  const fitsCode = (i: ElevationItem) => i.width_in * ppi >= (i.cabinet.label || i.cabinet.preset_code).length * 6.5;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Front elevation, ${run.label}`}
        style={{ display: 'block', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}
      >
        {/* Wall and ceiling reference; an island stands free, so only the ceiling */}
        {run.island ? (
          <line x1={x(0)} x2={x(lengthIn)} y1={y(CEILING_IN)} y2={y(CEILING_IN)} stroke={HAIRLINE} strokeDasharray="4 3" />
        ) : (
          <rect x={x(wallLeft)} y={y(CEILING_IN)} width={(wallRight - wallLeft) * ppi} height={CEILING_IN * ppi} fill={QUIET_FILL} stroke={HAIRLINE} />
        )}
        <text x={x(wallLeft) + 4} y={y(CEILING_IN) + 12} fontSize={10} fill={INK_SECONDARY}>
          8' ceiling
        </text>

        {lowers.map(renderItem)}
        {counters.map((i) => (
          <rect
            key={`ct-${i.cabinet.id}`}
            x={x(i.left_in)}
            y={y(COUNTER_TOP_IN)}
            width={i.width_in * ppi}
            height={(COUNTER_TOP_IN - i.height_in) * ppi}
            fill={COUNTER_FILL}
          />
        ))}
        {/* The backsplashes, under the uppers: the tile from the counter up, the 4" countertop one at its foot */}
        {tileIn !== null && splash && splash.tile.length > 0 && (
          <defs>
            <pattern id={tileId} patternUnits="userSpaceOnUse" x={x(0)} y={y(COUNTER_TOP_IN)} width={6 * ppi} height={6 * ppi}>
              <rect width={6 * ppi} height={6 * ppi} fill={TILE_FILL} />
              <path
                d={`M0 0H${6 * ppi}M0 ${3 * ppi}H${6 * ppi}M0 0V${3 * ppi}M${3 * ppi} ${3 * ppi}V${6 * ppi}`}
                stroke={TILE_GROUT}
                strokeWidth={0.6}
              />
            </pattern>
          </defs>
        )}
        {tileIn !== null &&
          splash?.tile.map(([l, r]) => (
            <rect
              key={`bs-${l}`}
              x={x(l)}
              y={y(COUNTER_TOP_IN + tileIn)}
              width={(r - l) * ppi}
              height={tileIn * ppi}
              fill={`url(#${tileId})`}
              stroke={TILE_STROKE}
              strokeWidth={0.75}
            />
          ))}
        {backsplash?.counter &&
          splash?.counter.map(([l, r]) => (
            <rect
              key={`cs-${l}`}
              x={x(l)}
              y={y(COUNTER_TOP_IN + COUNTER_SPLASH_IN)}
              width={(r - l) * ppi}
              height={COUNTER_SPLASH_IN * ppi}
              fill={COUNTER_FILL}
              stroke="#6f6d68"
              strokeWidth={0.75}
            />
          ))}
        {uppers.map(renderItem)}
        {crownMolding &&
          crownRuns(run.items, run.wall).map((r) => (
            <g key={`crown-${r.key}`}>
              {CROWN_BANDS.map(([from, to, out]) => {
                const left = r.left - (r.outLeft ? out : 0);
                const right = r.right + (r.outRight ? out : 0);
                return (
                  <rect
                    key={from}
                    x={x(left)}
                    y={y(r.top + to)}
                    width={(right - left) * ppi}
                    height={(to - from) * ppi}
                    fill={BOX_FILL}
                    stroke={BOX_STROKE}
                    strokeWidth={0.75}
                  />
                );
              })}
            </g>
          ))}

        {/* Floor */}
        <line x1={MARGIN_X / 2} x2={width - MARGIN_X / 2} y1={floorY} y2={floorY} stroke={INK} strokeWidth={2} />

        {/* Code and width: lowers under the floor line, uppers above their tops */}
        {lowers.map((i) => (
          <g key={`dl-${i.cabinet.id}`}>
            {fitsCode(i) && (
              <text x={x(i.left_in + i.width_in / 2)} y={codeY} textAnchor="middle" fontSize={10} fontWeight={600} fill={INK}>
                {i.cabinet.label || i.cabinet.preset_code}
              </text>
            )}
            <text x={x(i.left_in + i.width_in / 2)} y={dimY} textAnchor="middle" fontSize={10} fill={INK_SECONDARY}>
              {widthLabel(i)}
            </text>
          </g>
        ))}
        {uppers.map((i) => (
          <text
            key={`du-${i.cabinet.id}`}
            x={x(i.left_in + i.width_in / 2)}
            y={y(i.bottom_in + i.height_in + (crownMolding && i.bottom_in + i.height_in >= CROWN_MIN_TOP_IN ? CROWN_HEIGHT_IN : 0)) - 5}
            textAnchor="middle"
            fontSize={10}
            fill={INK_SECONDARY}
          >
            {fitsCode(i) ? (
              <>
                <tspan fontWeight={600} fill={INK}>{i.cabinet.label || i.cabinet.preset_code}</tspan>
                {`  ${widthLabel(i)}`}
              </>
            ) : (
              widthLabel(i)
            )}
          </text>
        ))}

        {/* Overall run length */}
        <g stroke={INK_SECONDARY} strokeWidth={1}>
          <line x1={x(0)} x2={x(lengthIn)} y1={totalY} y2={totalY} />
          <line x1={x(0)} x2={x(0)} y1={totalY - 5} y2={totalY + 5} />
          <line x1={x(lengthIn)} x2={x(lengthIn)} y1={totalY - 5} y2={totalY + 5} />
        </g>
        <rect x={x(lengthIn / 2) - 30} y={totalY - 8} width={60} height={16} fill="#ffffff" />
        <text x={x(lengthIn / 2)} y={totalY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
          {formatFeetInches(lengthIn)}
        </text>
      </svg>
    </div>
  );
};

export default CabinetElevationView;
