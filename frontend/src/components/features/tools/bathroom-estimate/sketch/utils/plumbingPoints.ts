/**
 * Where a tub's or shower's faucet and drain are.
 *
 * Each is a point in the fixture's own box, x and y from 0 to 1 across its
 * width and depth, (0, 0) its back-left corner looking in from the front
 * (north-west in its own frame). A faucet on a wall (an alcove tub's, every
 * shower's valve) sits on one of the walls it can have; a deck or a
 * freestanding tub's faucet can be anywhere on it. A tub's drain is under its
 * faucet until it's moved on its own; a shower's is in the middle.
 *
 * Unset, both come out where the plan and the 3D view always drew them, so
 * old sketches look the same. backend layout_changes.py has the same rules
 * to price a drain or a faucet moved on an option.
 */

import type { BEFixture } from '@/types/bathroomSketch';

export interface Pt01 {
  x: number;
  y: number;
}

export type Edge = 'north' | 'south' | 'east' | 'west';

/** How far a wall faucet stays from a corner, and a drain from the edge (fraction of the side) */
const FAUCET_MARGIN = 0.1;
const DRAIN_MARGIN = 0.08;
/** A tub's drain sits this far in from its faucet, inches */
const DRAIN_IN_FROM_FAUCET = 6;

export const hasPlumbing = (f: BEFixture) => f.type === 'bathtub' || f.type === 'shower';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The walls a faucet can be on, or null when it can be anywhere (on a deck, on the floor) */
export function faucetEdges(f: BEFixture): Edge[] | null {
  const p = f.properties;
  if (f.type === 'bathtub') {
    return (p.bathtubSubType ?? 'standard_alcove') === 'standard_alcove' ? ['north', 'west', 'east'] : null;
  }
  switch (p.showerLayout ?? 'alcove') {
    case 'corner':
    case 'neo_angle': return ['north', 'west'];
    case 'corner_right':
    case 'neo_angle_right': return ['north', 'east'];
    default: return ['north', 'west', 'east'];
  }
}

export function defaultFaucet(f: BEFixture): Pt01 {
  const p = f.properties;
  if (f.type === 'bathtub') {
    switch (p.bathtubSubType ?? 'standard_alcove') {
      case 'drop_in': return { x: 0.5, y: 0.05 };
      case 'corner_garden':
      case 'corner_drop_in': return { x: 0.72, y: 0.52 };
      case 'freestanding': return { x: 0.5, y: 1 };
      default: return { x: 0.5, y: 0 };
    }
  }
  const layout = p.showerLayout ?? 'alcove';
  return { x: layout === 'neo_angle' ? 0.45 : layout === 'neo_angle_right' ? 0.55 : 0.5, y: 0 };
}

/** `pt` put where a faucet can be: onto the nearest wall it can have, or inside the box */
export function snapFaucet(f: BEFixture, pt: Pt01): Pt01 {
  const edges = faucetEdges(f);
  if (!edges) return { x: clamp(pt.x, 0, 1), y: clamp(pt.y, 0, 1) };
  const off: Record<Edge, number> = { north: Math.abs(pt.y), south: Math.abs(1 - pt.y), west: Math.abs(pt.x), east: Math.abs(1 - pt.x) };
  const edge = edges.reduce((a, b) => (off[b] < off[a] ? b : a));
  const along = (v: number) => clamp(v, FAUCET_MARGIN, 1 - FAUCET_MARGIN);
  switch (edge) {
    case 'north': return { x: along(pt.x), y: 0 };
    case 'south': return { x: along(pt.x), y: 1 };
    case 'west': return { x: 0, y: along(pt.y) };
    default: return { x: 1, y: along(pt.y) };
  }
}

export function faucetOf(f: BEFixture): Pt01 {
  const set = f.properties.faucetPos;
  return set ? snapFaucet(f, set) : defaultFaucet(f);
}

/** The wall a faucet point is on, if it's on one */
export function faucetEdge(f: BEFixture, pt: Pt01 = faucetOf(f)): Edge | null {
  if (!faucetEdges(f)) return null;
  if (pt.y <= 0.001) return 'north';
  if (pt.y >= 0.999) return 'south';
  if (pt.x <= 0.001) return 'west';
  if (pt.x >= 0.999) return 'east';
  return null;
}

export function clampDrain(pt: Pt01): Pt01 {
  return { x: clamp(pt.x, DRAIN_MARGIN, 1 - DRAIN_MARGIN), y: clamp(pt.y, DRAIN_MARGIN, 1 - DRAIN_MARGIN) };
}

export function defaultDrain(f: BEFixture): Pt01 {
  if (f.type === 'shower') {
    const layout = f.properties.showerLayout ?? 'alcove';
    if (layout === 'neo_angle') return { x: 0.4, y: 0.4 };
    if (layout === 'neo_angle_right') return { x: 0.6, y: 0.4 };
    return { x: 0.5, y: 0.5 };
  }
  // A tub's: in from its faucet, toward the middle
  const fp = faucetOf(f);
  const W = f.dimensions.width;
  const D = f.dimensions.height;
  const dx = (0.5 - fp.x) * W;
  const dy = (0.5 - fp.y) * D;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return { x: 0.5, y: 0.5 };
  const step = Math.min(DRAIN_IN_FROM_FAUCET, len);
  return clampDrain({ x: fp.x + ((dx / len) * step) / W, y: fp.y + ((dy / len) * step) / D });
}

export function drainOf(f: BEFixture): Pt01 {
  const set = f.properties.drainPos;
  return set ? clampDrain(set) : defaultDrain(f);
}

/** A point of the fixture's box on the plan (px), turned as the fixture is */
export function onPlan(f: BEFixture, pt: Pt01, ppf: number): { x: number; y: number } {
  const lx = ((pt.x - 0.5) * f.dimensions.width * ppf) / 12;
  const ly = ((pt.y - 0.5) * f.dimensions.height * ppf) / 12;
  const r = ((f.rotation || 0) * Math.PI) / 180;
  return { x: f.position.x + lx * Math.cos(r) - ly * Math.sin(r), y: f.position.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

// ── Quick choices in the inspector ──

export interface PlacePreset {
  value: string;
  label: string;
  pt: Pt01 | null;
}

/** Where a faucet can go in a click: each wall it can have, or the deck's ends */
export function faucetPresets(f: BEFixture): PlacePreset[] {
  const edges = faucetEdges(f);
  const isTub = f.type === 'bathtub';
  if (edges) {
    const names: Record<Edge, string> = isTub
      ? { north: 'Back wall', west: 'Left end', east: 'Right end', south: 'Front' }
      : { north: 'Back wall', west: 'Left wall', east: 'Right wall', south: 'Front' };
    const at: Record<Edge, Pt01> = { north: { x: 0.5, y: 0 }, west: { x: 0, y: 0.5 }, east: { x: 1, y: 0.5 }, south: { x: 0.5, y: 1 } };
    return edges.map((e) => ({ value: e, label: names[e], pt: at[e] }));
  }
  const sub = f.properties.bathtubSubType ?? 'standard_alcove';
  const list: PlacePreset[] = [
    { value: 'west', label: 'Left end', pt: sub === 'freestanding' ? { x: 0, y: 0.5 } : { x: 0.05, y: 0.5 } },
    { value: 'north', label: 'Back', pt: sub === 'freestanding' ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.05 } },
    { value: 'east', label: 'Right end', pt: sub === 'freestanding' ? { x: 1, y: 0.5 } : { x: 0.95, y: 0.5 } },
    { value: 'south', label: 'Front', pt: sub === 'freestanding' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.95 } },
  ];
  if (sub === 'corner_garden' || sub === 'corner_drop_in') list.push({ value: 'corner', label: 'Corner deck', pt: { x: 0.72, y: 0.52 } });
  return list;
}

export function drainPresets(f: BEFixture): PlacePreset[] {
  if (f.type === 'bathtub') {
    return [
      { value: 'faucet', label: 'Under the faucet', pt: null },
      { value: 'west', label: 'Left end', pt: { x: 0.1, y: 0.5 } },
      { value: 'middle', label: 'Middle', pt: { x: 0.5, y: 0.5 } },
      { value: 'east', label: 'Right end', pt: { x: 0.9, y: 0.5 } },
    ];
  }
  return [
    { value: 'middle', label: 'Middle', pt: null },
    { value: 'north', label: 'Back', pt: { x: 0.5, y: 0.12 } },
    { value: 'south', label: 'Front', pt: { x: 0.5, y: 0.88 } },
    { value: 'west', label: 'Left', pt: { x: 0.12, y: 0.5 } },
    { value: 'east', label: 'Right', pt: { x: 0.88, y: 0.5 } },
  ];
}

const near = (a: Pt01, b: Pt01) => Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02;

/** Which quick choice a point is, or 'custom' when it was moved on the plan */
export function presetOf(presets: PlacePreset[], pt: Pt01, isDefault: boolean): string {
  if (isDefault) {
    const followDefault = presets.find((p) => !p.pt);
    if (followDefault) return followDefault.value;
  }
  return presets.find((p) => p.pt && near(p.pt, pt))?.value ?? 'custom';
}
