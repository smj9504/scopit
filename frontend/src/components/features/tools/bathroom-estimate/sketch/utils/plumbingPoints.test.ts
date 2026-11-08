import { describe, it, expect } from 'vitest';
import type { BEFixture } from '@/types/bathroomSketch';
import {
  drainOf,
  drainPresets,
  faucetEdge,
  faucetOf,
  faucetPresets,
  onPlan,
  presetOf,
  snapFaucet,
} from './plumbingPoints';

// The same cases as backend tests/test_bathroom_plumbing_points.py: both sides read a sketch alike
const fixture = (type: BEFixture['type'], w: number, h: number, properties: BEFixture['properties'] = {}, rotation = 0): BEFixture => ({
  id: type, type, position: { x: 0, y: 0 }, dimensions: { width: w, height: h }, rotation, properties,
});
const tub = (props: BEFixture['properties'] = {}) => fixture('bathtub', 60, 32, { bathtubSubType: 'standard_alcove', ...props });
const shower = (props: BEFixture['properties'] = {}) => fixture('shower', 36, 36, { showerLayout: 'alcove', ...props });

describe('faucet and drain points', () => {
  it('unset, are where the sketch always drew them', () => {
    expect(faucetOf(tub())).toEqual({ x: 0.5, y: 0 });
    expect(drainOf(tub()).y).toBeCloseTo(6 / 32);
    expect(faucetOf(shower())).toEqual({ x: 0.5, y: 0 });
    expect(drainOf(shower())).toEqual({ x: 0.5, y: 0.5 });
    expect(faucetOf(fixture('bathtub', 60, 30, { bathtubSubType: 'freestanding' }))).toEqual({ x: 0.5, y: 1 });
  });

  it("keeps a tub's drain under its faucet until it's moved on its own", () => {
    const left = tub({ faucetPos: { x: 0, y: 0.5 } });
    expect(drainOf(left).x).toBeCloseTo(0.1);
    expect(drainOf(left).y).toBeCloseTo(0.5);
    expect(drainOf(tub({ faucetPos: { x: 0, y: 0.5 }, drainPos: { x: 0.5, y: 0.5 } }))).toEqual({ x: 0.5, y: 0.5 });
    expect(drainOf(tub({ drainPos: { x: 1.4, y: -1 } }))).toEqual({ x: 0.92, y: 0.08 });
  });

  it('puts a wall faucet onto a wall it can have', () => {
    expect(snapFaucet(tub(), { x: 0.97, y: 0.9 })).toEqual({ x: 1, y: 0.9 });
    expect(snapFaucet(tub(), { x: 0.5, y: 0.9 })).toEqual({ x: 0, y: 0.9 });
    const corner = shower({ showerLayout: 'corner_right' });
    expect(snapFaucet(corner, { x: 0.02, y: 0.5 })).toEqual({ x: 0.1, y: 0 });
    expect(snapFaucet(corner, { x: 0.95, y: 0.6 })).toEqual({ x: 1, y: 0.6 });
    const deck = fixture('bathtub', 60, 32, { bathtubSubType: 'drop_in' });
    expect(snapFaucet(deck, { x: 0.3, y: 0.6 })).toEqual({ x: 0.3, y: 0.6 });
    expect(faucetEdge(deck, { x: 0, y: 0.5 })).toBeNull();
    expect(faucetEdge(tub(), { x: 1, y: 0.4 })).toBe('east');
  });

  it('turns with the fixture', () => {
    // 40 px to the foot: a 60" tub turned 90° at (50", 50"); its left end is at the top
    const turned = { ...tub(), position: { x: (50 / 12) * 40, y: (50 / 12) * 40 }, rotation: 90 };
    const at = onPlan(turned, { x: 0, y: 0.5 }, 40);
    expect((at.x / 40) * 12).toBeCloseTo(50);
    expect((at.y / 40) * 12).toBeCloseTo(20);
  });

  it('names its quick choices, and a point moved by hand as moved', () => {
    const left = tub({ faucetPos: { x: 0, y: 0.5 } });
    expect(presetOf(faucetPresets(left), faucetOf(left), false)).toBe('west');
    expect(presetOf(drainPresets(left), drainOf(left), true)).toBe('faucet');
    const dragged = tub({ faucetPos: { x: 0, y: 0.3 }, drainPos: { x: 0.3, y: 0.6 } });
    expect(presetOf(faucetPresets(dragged), faucetOf(dragged), false)).toBe('custom');
    expect(presetOf(drainPresets(dragged), drainOf(dragged), false)).toBe('custom');
    // A corner shower glassed on the right offers the back and left walls
    expect(faucetPresets(shower({ showerLayout: 'corner' })).map((p) => p.value)).toEqual(['north', 'west']);
  });
});
