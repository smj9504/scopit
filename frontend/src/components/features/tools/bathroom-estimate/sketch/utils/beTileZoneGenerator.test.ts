import { describe, it, expect } from 'vitest';
import type { BEFixture, BEPoint, BERoom } from '@/types/bathroomSketch';
import { generateTileZones } from './beTileZoneGenerator';

// 40 px to the foot: a 10 ft × 8 ft room from (0, 0) to (400, 320)
const PPF = 40;
const room: BERoom = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 320 }, { x: 0, y: 320 }],
  wallIds: [], heightInches: 96, floorAreaSF: 80, netFloorAreaSF: 80, wallAreaSF: 0, perimeterLF: 36,
};
const fixture = (type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'], rotation = 0): BEFixture => ({
  id: type, type, position: { x, y }, dimensions: { width: w, height: h }, rotation, roomId: 'bath', properties,
});
const zoneOf = (fix: BEFixture, type: string) => generateTileZones([fix], [room], PPF).find((z) => z.type === type)!;
const piecesOf = (zone: { boundary: BEPoint[]; subBoundaries?: BEPoint[][] }) => zone.subBoundaries ?? [zone.boundary];
const xs = (pts: BEPoint[]) => pts.map((p) => p.x);
const ys = (pts: BEPoint[]) => pts.map((p) => p.y);

describe('tub deck', () => {
  // A 60" × 42" corner drop-in (200 × 140 px) in the top-left corner, 12" deck (40 px)
  const cornerTub = (rotation = 0) => fixture('bathtub', 100, 70, 60, 42, {
    bathtubSubType: 'corner_drop_in', deckWidth: 12, deckHeight: 20, hasFrontPanel: true,
  }, rotation);

  it("marks a corner tub's deck with a thin strip inside the tub, not a deck-wide band over its neighbours", () => {
    const deck = zoneOf(cornerTub(), 'tub_deck');
    for (const piece of piecesOf(deck)) {
      expect(Math.min(...xs(piece))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs(piece))).toBeLessThanOrEqual(200);
      expect(Math.min(...ys(piece))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys(piece))).toBeLessThanOrEqual(140);
    }
    // Along the exposed right side it is 6 px deep, not the deck's 40
    const right = piecesOf(deck)[0].filter((p) => p.y === 0);
    expect(Math.max(...xs(right)) - Math.min(...xs(right))).toBeCloseTo(6);
  });

  it('keeps the area the deck is priced on', () => {
    // (36 + 25.2 + sqrt(24² + 16.8²)) × 12 / 144
    expect(zoneOf(cornerTub(), 'tub_deck').areaSF).toBeCloseTo(7.54, 2);
  });

  it('turns with the tub', () => {
    const deck = zoneOf(cornerTub(90), 'tub_deck');
    // Turned a quarter, the 140 px depth runs across: x within 100 ± 70
    for (const p of piecesOf(deck).flat()) expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(70.001);
  });

  it("strips a drop-in tub's open sides from the inside", () => {
    // 60" × 32" (200 × 106.7 px) against the top wall only
    const tub = fixture('bathtub', 150, 53.33, 60, 32, { bathtubSubType: 'drop_in', deckWidth: 10 });
    const deck = zoneOf(tub, 'tub_deck');
    expect(piecesOf(deck)).toHaveLength(3);
    for (const p of piecesOf(deck).flat()) {
      expect(p.x).toBeGreaterThanOrEqual(50 - 0.001);
      expect(p.x).toBeLessThanOrEqual(250 + 0.001);
      expect(p.y).toBeLessThanOrEqual(106.67);
    }
  });
});

describe('shower door', () => {
  // A 60" × 36" alcove (200 × 120 px), its front along y = 300, with a 30" swing door
  const shower = (props: BEFixture['properties']) => fixture('shower', 200, 240, 60, 36, {
    showerLayout: 'alcove', showerDoorType: 'swing', showerDoorWidth: 30, ...props,
  });

  it('marks the door where it sits across the front', () => {
    const left = xs(zoneOf(shower({ showerDoorPosition: 'left' }), 'shower_door').boundary);
    expect([Math.min(...left), Math.max(...left)]).toEqual([100, 198]);
    const right = xs(zoneOf(shower({ showerDoorPosition: 'right' }), 'shower_door').boundary);
    expect([Math.min(...right), Math.max(...right)]).toEqual([202, 300]);
  });

  it('fills the rest of the front with the panel beside a door against one side', () => {
    const glass = zoneOf(shower({ showerDoorPosition: 'left', fixedPanelConfig: 'right' }), 'shower_glass_panel');
    expect(xs(glass.boundary)).toEqual([200, 300, 300, 200]);
    // 30" × 72"
    expect(glass.areaSF).toBe(15);
  });

  it('keeps a quarter of the width a panel beside a centred door', () => {
    const glass = zoneOf(shower({ fixedPanelConfig: 'both' }), 'shower_glass_panel');
    expect(glass.areaSF).toBe(15);
    expect(piecesOf(glass).map((p) => [Math.min(...xs(p)), Math.max(...xs(p))])).toEqual([[100, 150], [250, 300]]);
  });
});
