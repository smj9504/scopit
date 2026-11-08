/**
 * Door, drawer and appliance-opening layout on a cabinet's front, by type
 * and specialty. Shared by the Front (elevation) view, which draws it flat,
 * and the 3D view, which stands it on each cabinet's door side.
 *
 * Pure functions only, like cabinetSketchLayout.ts.
 */

import type { CabType, DoorPattern, SpecialtyType } from '@/types/cabinetEstimate';
import { bayFront, blindLengthIn, cabinetDepthIn, cornerKind, wrapFront } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import type { CornerKind } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';

export const COUNTER_TOP_IN = 36;
export const TOE_KICK_IN = 4;
/** Gap between doors/drawers and the box edge, inches. */
export const REVEAL_IN = 0.75;
/** Width of the door frame around a glass insert, inches. */
export const GLASS_STILE_IN = 2.25;
/** Cabinets whose top is at least this high (uppers, talls, bridges) take crown molding. */
export const CROWN_MIN_TOP_IN = 72;
/**
 * Crown molding as stepped bands over a cabinet's top, each [from, to, out]:
 * inches above the top, and how far it stands out past the cabinet's exposed
 * sides. 3¾" tall, 2¾" out — a common stock crown. The 3D and Front views both draw it.
 */
export const CROWN_BANDS: [number, number, number][] = [
  [0, 0.75, 0.5],
  [0.75, 2.25, 1.5],
  [2.25, 3.25, 2.5],
  [3.25, 3.75, 2.75],
];
export const CROWN_HEIGHT_IN = CROWN_BANDS[CROWN_BANDS.length - 1][1];

export type FaceKind = 'door' | 'drawer' | 'panel' | 'opening';

/** An oven cabinet's opening: where the oven sits, inches above the floor. */
export const ovenOpening = (specialty?: SpecialtyType | null) =>
  specialty === 'double_oven_cabinet' ? { bottom: 22, height: 52 } : { bottom: 30, height: 30 };

/** How tall a refrigerator cabinet's opening is, under its upper doors, for a cabinet `h` tall. */
export const fridgeOpeningHeight = (h: number) => h - Math.min(24, h * 0.3) - REVEAL_IN;

/** A door, drawer or appliance opening, in inches from the cabinet's bottom-left (y up). */
export interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: FaceKind;
  label?: string;
  /** The edge a door's pull goes on, when the doors beside it don't settle that. */
  pull?: 'left' | 'right';
}

/** n equal doors side by side across [x, x + w]. */
function doorRow(x: number, y: number, w: number, h: number, n: number, kind: FaceKind = 'door'): Face[] {
  const each = (w - REVEAL_IN * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    x: x + REVEAL_IN + i * (each + REVEAL_IN),
    y,
    w: each,
    h,
    kind,
  }));
}

/** Doors across a box: two up to 48" wide, then as many as keep each about 24". */
const doorCount = (w: number) => (w < 24 ? 1 : w <= 48 ? 2 : Math.ceil(w / 24));

/**
 * Front of a corner unit. Its corner end shows no front of its own — an L
 * or diagonal's other leg comes toward the viewer, a blind corner's end
 * hides behind the other run — so doors go only on the open part.
 */
function cornerFaces(
  cabType: CabType,
  specialty: SpecialtyType,
  kind: CornerKind,
  side: 'left' | 'right',
  w: number,
  h: number,
  pattern?: DoorPattern | null
): Face[] {
  const r = REVEAL_IN;
  const bottom = cabType === 'wall' ? r : TOE_KICK_IN + r;
  // An angle end's cut face spans its whole width: full-height doors across it (two on BEC24).
  if (kind === 'angle_end') return doorRow(0, bottom, w, h - r - bottom, doorCount(w));
  if (kind === 'end_wrap') {
    // Seen from in front: the front door, then the cut's door foreshortened
    // to the width it covers. The end's door faces sideways, out of view.
    const cutX = wrapFront(w, cabinetDepthIn(cabType, specialty))[1][0];
    const doorH = h - r - bottom;
    const faces: Face[] = [
      { x: r, y: bottom, w: cutX - 1.5 * r, h: doorH, kind: 'door' },
      { x: cutX + r / 2, y: bottom, w: w - cutX - 1.5 * r, h: doorH, kind: 'door' },
    ];
    return side === 'right' ? faces.map((f) => ({ ...f, x: w - f.x - f.w })) : faces;
  }
  if (kind === 'bay_end') {
    // Seen from in front: both faces foreshortened to the widths they cover,
    // the one off the run's end wide, the one turning back to the wall narrow.
    const bendX = bayFront(w, cabinetDepthIn(cabType, specialty))[1][0];
    const doorH = h - r - bottom;
    const faces: Face[] = [
      { x: r, y: bottom, w: bendX - 1.5 * r, h: doorH, kind: 'door' },
      { x: bendX + r / 2, y: bottom, w: w - bendX - 1.5 * r, h: doorH, kind: 'door' },
    ];
    return side === 'right' ? faces.map((f) => ({ ...f, x: w - f.x - f.w })) : faces;
  }
  const cornerLen =
    kind === 'blind' ? Math.min(blindLengthIn(cabType), w * 0.75) : cabinetDepthIn(cabType, specialty);
  const openW = w - cornerLen;
  const faces: Face[] =
    kind === 'blind'
      ? [
          { x: r, y: bottom, w: cornerLen - r, h: h - r - bottom, kind: 'panel', label: 'BLIND' },
          // The open part reads like a plain box of its width.
          ...facesFor(cabType, undefined, openW, h, 'left', pattern).map((f) => ({ ...f, x: f.x + cornerLen })),
        ]
      : // One full-height door on the open leaf.
        doorRow(cornerLen, bottom, openW, h - r - bottom, 1);
  return side === 'right' ? faces.map((f) => ({ ...f, x: w - f.x - f.w })) : faces;
}

/** Front layout of a cabinet by type, following the catalog's specialty. */
export function facesFor(
  cabType: CabType,
  specialty: SpecialtyType | undefined,
  w: number,
  h: number,
  cornerSide: 'left' | 'right' = 'left',
  pattern?: DoorPattern | null
): Face[] {
  const inner = w - REVEAL_IN * 2;
  const r = REVEAL_IN;

  const corner = cornerKind(specialty);
  if (corner && specialty) return cornerFaces(cabType, specialty, corner, cornerSide, w, h, pattern);

  // A lattice over a band is the whole front as one panel; on a tall, each row of doors.
  const doors = pattern === 'lattice_band' ? 1 : doorCount(w);

  if (cabType === 'wall') {
    return doorRow(0, r, w, h - r * 2, doors);
  }

  if (cabType === 'tall') {
    const bottom = TOE_KICK_IN + r;
    if (specialty === 'refrigerator_cabinet') {
      const upper = Math.min(24, h * 0.3);
      return [
        { x: r, y: 0, w: inner, h: fridgeOpeningHeight(h), kind: 'opening', label: 'FRIDGE' },
        ...doorRow(0, h - upper, w, upper - r, doors),
      ];
    }
    if (specialty === 'oven_cabinet' || specialty === 'double_oven_cabinet') {
      const { height: ovenH, bottom: ovenBottom } = ovenOpening(specialty);
      const upperY = ovenBottom + ovenH + r;
      return [
        ...doorRow(0, bottom, w, ovenBottom - bottom - r, 1, 'drawer'),
        { x: r, y: ovenBottom, w: inner, h: ovenH, kind: 'opening', label: specialty === 'double_oven_cabinet' ? 'OVEN ×2' : 'OVEN' },
        ...doorRow(0, upperY, w, h - upperY - r, doors),
      ];
    }
    // Pantry: tall lower doors, shorter upper doors.
    const split = Math.max(bottom + 30, h * 0.6);
    return [
      ...doorRow(0, bottom, w, split - bottom - r / 2, doors),
      ...doorRow(0, split + r / 2, w, h - split - r * 1.5, doors),
    ];
  }

  // Base (and the legacy 'specialty' type).
  const bottom = TOE_KICK_IN + r;
  const top = h - r;
  const drawerH = 6;
  const below = top - drawerH - r - bottom;

  switch (specialty) {
    case 'range_base_slide_in':
    case 'range_base_drop_in':
      return [{ x: r, y: 0, w: inner, h: h + 1.5, kind: 'opening', label: 'RANGE' }];
    case 'drawer_base': {
      const rest = (top - drawerH - r - bottom - r) / 2;
      return [
        { x: r, y: bottom, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: bottom + rest + r, w: inner, h: rest, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    }
    case 'trash_pullout':
      return [
        { x: r, y: bottom, w: inner, h: below, kind: 'drawer' },
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'drawer' },
      ];
    case 'microwave_drawer_base': {
      const mwH = 15;
      return [
        { x: r, y: bottom, w: inner, h: top - mwH - r - bottom, kind: 'drawer' },
        { x: r, y: top - mwH, w: inner, h: mwH, kind: 'opening', label: 'MW' },
      ];
    }
    case 'farmhouse_sink_base': {
      const apronH = 10;
      return [
        ...doorRow(0, bottom, w, top - apronH - r - bottom, doorCount(w)),
        { x: r, y: top - apronH, w: inner, h: apronH, kind: 'panel', label: 'APRON SINK' },
      ];
    }
    case 'sink_base':
      return [
        ...doorRow(0, bottom, w, below, doors),
        { x: r, y: top - drawerH, w: inner, h: drawerH, kind: 'panel', label: 'SINK' },
      ];
    default:
      return [
        ...doorRow(0, bottom, w, below, doors),
        ...doorRow(0, top - drawerH, w, drawerH, w >= 30 ? doorCount(w) : 1, 'drawer'),
      ];
  }
}

/** How far a door's arch rises above its shoulders, for a panel `w` wide and `h` tall. */
export const archRiseIn = (w: number, h: number) => Math.min(w * 0.22, h * 0.15);

/**
 * Doors narrower than this stay flat in the arched style: no room for its
 * frame and panel. Low enough for a three-door corner's cut door seen in
 * the Front view, where it draws under 4" wide, so it arches there as in 3D.
 */
export const ARCH_MIN_DOOR_IN = 3.5;

/**
 * A panel with an arched top: its outline from the bottom-left corner round
 * by the bottom-right, in inches from that corner. An arched door's frame
 * has this as its opening, and its raised field this shape.
 */
export function archOutline(w: number, h: number): [number, number][] {
  const rise = archRiseIn(w, h);
  const steps = 16;
  const top = Array.from({ length: steps + 1 }, (_, i): [number, number] => [
    w * (1 - i / steps),
    h - rise + rise * Math.sin((Math.PI * i) / steps),
  ]);
  return [[0, 0], [w, 0], ...top];
}

/** A rectangle on a door, inches from its bottom-left corner. */
export interface DoorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a door pattern puts in a door's frame, in inches from the door's
 * bottom-left corner: the opening, the bars across it (a diamond lattice,
 * or a mullion door's square grid), and for a lattice over a band the
 * band's cut-outs below it (ovals in a row, a small diamond between each two).
 */
export interface DoorDesign {
  opening: DoorRect;
  /** Each bar's two ends, x0, y0, x1, y1, cut off at the opening's edge. */
  bars: [number, number, number, number][];
  band: {
    ovals: { cx: number; cy: number; rx: number; ry: number }[];
    diamonds: { cx: number; cy: number; r: number }[];
  } | null;
}

/** Width of a lattice bar, inches. */
export const LATTICE_BAR_IN = 0.5;
/** A lattice diamond is about this wide, narrower on a door it wouldn't fit twice across. */
const LATTICE_DIAMOND_IN = 7;
const LATTICE_DIAMOND_MIN_IN = 3.5;
/** The band's height, and the solid rail between it and the lattice. */
const BAND_IN = 5;
const BAND_RAIL_IN = 0.75;
/** About how wide each oval's stretch of the band is. */
const BAND_OVAL_SPAN_IN = 11;
/**
 * About how wide and tall a mullion door's panes are: two across and four
 * down on a W3042's 14"-wide doors, as in the user's photo; three down on a
 * 30" or 36" upper.
 */
const MULLION_PANE_W_IN = 6;
const MULLION_PANE_H_IN = 9;

export function doorDesign(f: Pick<Face, 'w' | 'h'>, pattern: DoorPattern): DoorDesign {
  const s = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4);
  const inW = f.w - 2 * s;
  const inH = f.h - 2 * s;
  const bandH = pattern === 'lattice_band' ? Math.min(BAND_IN, inH * 0.3) : 0;
  const lift = bandH > 0 ? bandH + BAND_RAIL_IN : 0;
  const opening: DoorRect = { x: s, y: s + lift, w: inW, h: inH - lift };

  if (pattern === 'mullion') {
    // Upright and level bars splitting the opening into equal panes.
    const cols = Math.max(1, Math.round(opening.w / MULLION_PANE_W_IN));
    const rows = Math.max(1, Math.round(opening.h / MULLION_PANE_H_IN));
    const [left, right, low, high] = [opening.x, opening.x + opening.w, opening.y, opening.y + opening.h];
    const bars: DoorDesign['bars'] = [
      ...Array.from({ length: cols - 1 }, (_, i): DoorDesign['bars'][number] => {
        const x = left + (opening.w * (i + 1)) / cols;
        return [x, low, x, high];
      }),
      ...Array.from({ length: rows - 1 }, (_, i): DoorDesign['bars'][number] => {
        const y = low + (opening.h * (i + 1)) / rows;
        return [left, y, right, y];
      }),
    ];
    return { opening, bars, band: null };
  }

  // Two families of 45° bars, a crossing at the opening's middle.
  const step = Math.max(LATTICE_DIAMOND_MIN_IN, Math.min(LATTICE_DIAMOND_IN, Math.min(opening.w, opening.h) / 2));
  const [cx, cy] = [opening.x + opening.w / 2, opening.y + opening.h / 2];
  const [x0, x1, y0, y1] = [opening.x, opening.x + opening.w, opening.y, opening.y + opening.h];
  const reach = Math.ceil((opening.w + opening.h) / step) + 1;
  const bars: DoorDesign['bars'] = [];
  for (let k = -reach; k <= reach; k++) {
    // Up to the right: y = x - c.
    const c = cx - cy + k * step;
    const [ax, bx] = [Math.max(x0, y0 + c), Math.min(x1, y1 + c)];
    if (bx - ax > 0.01) bars.push([ax, ax - c, bx, bx - c]);
    // Down to the right: y = e - x.
    const e = cx + cy + k * step;
    const [dx, fx] = [Math.max(x0, e - y1), Math.min(x1, e - y0)];
    if (fx - dx > 0.01) bars.push([dx, e - dx, fx, e - fx]);
  }

  let band: DoorDesign['band'] = null;
  if (bandH > 0) {
    const n = Math.max(1, Math.round(inW / BAND_OVAL_SPAN_IN));
    const span = inW / n;
    const midY = s + bandH / 2;
    band = {
      ovals: Array.from({ length: n }, (_, i) => ({
        cx: s + span * (i + 0.5),
        cy: midY,
        rx: span * 0.32,
        ry: bandH * 0.3,
      })),
      diamonds: Array.from({ length: n - 1 }, (_, i) => ({
        cx: s + span * (i + 1),
        cy: midY,
        r: Math.min(bandH * 0.22, span * 0.1),
      })),
    };
  }
  return { opening, bars, band };
}
