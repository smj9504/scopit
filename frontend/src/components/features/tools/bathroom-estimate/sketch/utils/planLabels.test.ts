import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BETileZone } from '@/types/bathroomSketch';
import { DEFAULT_TILE_SPEC } from '@/types/bathroomSketch';
import { generateTileZones } from './beTileZoneGenerator';
import {
  boxOf,
  boxesOverlap,
  buildPlanLabels,
  dimensionAnchor,
  fixtureBox,
  pointInPolygon,
} from './planLabels';

// 40 px to the foot: the "Standard full" layout, a 5 ft × 8 ft room at (60, 40)
const PPF = 40;
const boundary = [{ x: 60, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 360 }, { x: 60, y: 360 }];
const room = (extra: Partial<BERoom> = {}): BERoom => ({
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', boundary, wallIds: [], heightInches: 96,
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 0, perimeterLF: 26, ...extra,
});
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, roomId: 'bath', properties,
});
const tub = fixture('tub', 'bathtub', 160, 93.2, 60, 32, { bathtubSubType: 'standard_alcove', hasSurround: true, surroundWallCount: 3, surroundHeight: 60 });
const toilet = fixture('toilet', 'toilet', 110, 251.6, 15, 29);
const vanity = fixture('vanity', 'vanity', 200, 251.6, 36, 21, { vanitySubType: 'cabinet', sinkCount: 1, hasBacksplash: true, backsplashHeight: 4 });
const door = fixture('door', 'door', 206.8, 306.8, 32, 32);
const layout = [tub, toilet, vanity, door];

const labelsFor = (fixtures: BEFixture[], rooms: BERoom[] = [room()], withTile = true) => {
  const zones = generateTileZones(fixtures, rooms, PPF);
  return { zones, ...buildPlanLabels(rooms, fixtures, zones, PPF, { withRooms: true, withTile }) };
};

describe('buildPlanLabels', () => {
  it("puts a fixture's tile on one label under its name, instead of a label per zone", () => {
    const { labels, labelledFixtureIds, zones } = labelsFor(layout);
    const tubLabel = labels.find((l) => l.key === 'f-tub')!;
    expect(tubLabel.lines[0]).toEqual({ text: 'Bathtub', strong: true });
    expect(tubLabel.lines.map((l) => l.text)).toContain('Surround 51.7 SF');
    expect(labels.find((l) => l.key === 'f-vanity')!.lines.map((l) => l.text)).toEqual(['Vanity', expect.stringMatching(/^Backsplash /)]);
    // Fixtures with no tile keep their own name under them
    expect([...labelledFixtureIds].sort()).toEqual(['tub', 'vanity']);
    // No zone of a fixture is labelled on its own
    const fixtureZoneIds = zones.filter((z) => z.fixtureId).map((z) => `z-${z.id}`);
    expect(labels.filter((l) => fixtureZoneIds.includes(l.key))).toEqual([]);
  });

  it("lists a shower's niches with how many there are", () => {
    const shower = fixture('shower', 'shower', 200, 120, 36, 36, { showerLayout: 'alcove', showerWallCount: 3, showerTileHeight: 96, nicheCount: 2 });
    const { labels } = labelsFor([shower]);
    const lines = labels.find((l) => l.key === 'f-shower')!.lines.map((l) => l.text);
    expect(lines[0]).toBe('Shower');
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^Walls \d/), expect.stringMatching(/^Niches ×2 \d/)]));
  });

  it("puts the floor tile on its room's label, not a second label at the same spot", () => {
    const { labels } = labelsFor(layout);
    const roomLabel = labels.find((l) => l.kind === 'room')!;
    expect(roomLabel.lines.map((l) => l.text)).toEqual(['Bathroom', '40 SF', expect.stringMatching(/^Floor tile \d/)]);
    expect(labels.filter((l) => l.kind === 'zone')).toEqual([]);
  });

  it("moves the room's label off the fixtures and their labels, and keeps it in the room", () => {
    // Centre of the room (160, 200) is where the toilet and vanity labels crowd in
    const { labels } = labelsFor(layout);
    const roomLabel = labels.find((l) => l.kind === 'room')!;
    const box = boxOf(roomLabel);
    for (const f of layout) expect(boxesOverlap(box, fixtureBox(f, PPF))).toBe(false);
    for (const l of labels.filter((x) => x.kind === 'fixture')) expect(boxesOverlap(box, boxOf(l))).toBe(false);
    for (const p of [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 }]) expect(pointInPolygon(p, boundary)).toBe(true);
  });

  it("leaves the room's label at its centre when nothing is there", () => {
    const { labels } = labelsFor([]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ kind: 'room', x: 160, y: 200 });
  });

  it('labels rooms by name and area alone when tile zones are hidden, and fixtures label themselves', () => {
    const { labels, labelledFixtureIds } = labelsFor(layout, [room()], false);
    expect(labelledFixtureIds.size).toBe(0);
    expect(labels.map((l) => l.lines.map((x) => x.text))).toEqual([['Bathroom', '40 SF']]);
  });

  it('labels a zone that belongs to no fixture or room on its own', () => {
    const stray: BETileZone = {
      id: 'stray', type: 'wall_full', label: 'Full wall', boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }],
      areaSF: 12.34, tileSpec: DEFAULT_TILE_SPEC, color: 'rgba(0,0,0,0.2)',
    };
    const { labels } = buildPlanLabels([], [], [stray], PPF, { withRooms: true, withTile: true });
    expect(labels).toMatchObject([{ kind: 'zone', lines: [{ text: 'Full wall' }, { text: '12.3 SF' }] }]);
  });

  it('marks a room inside another as a sub-room', () => {
    const closet = room({ id: 'closet', name: 'Closet', parentRoomId: 'bath', boundary: [{ x: 60, y: 40 }, { x: 140, y: 40 }, { x: 140, y: 120 }, { x: 60, y: 120 }] });
    const { labels } = buildPlanLabels([closet], [], [], PPF, { withRooms: true, withTile: false });
    expect(labels[0]).toMatchObject({ kind: 'room', subRoom: true });
  });
});

describe('fixtureBox', () => {
  it('turns with the fixture', () => {
    // 60" × 32" is 200 × 106.7 px
    const box = fixtureBox(tub, PPF);
    expect(box.x0).toBeCloseTo(60);
    expect(box.x1).toBeCloseTo(260);
    expect(box.y1 - box.y0).toBeCloseTo(32 / 12 * PPF);
    const turned = fixtureBox({ ...tub, rotation: 90 }, PPF);
    expect(turned.x1 - turned.x0).toBeCloseTo(32 / 12 * PPF);
    expect(turned.y1 - turned.y0).toBeCloseTo(60 / 12 * PPF);
  });
});

describe('dimensionAnchor', () => {
  const inside = { x: 160, y: 200 };
  const [nw, ne, se, sw] = boundary;

  it('puts each edge of a room outside it, clear of the line', () => {
    expect(dimensionAnchor(nw, ne, inside, 40, 20, 6)).toEqual({ x: 160, y: 40 - 16 }); // top: above
    expect(dimensionAnchor(se, sw, inside, 40, 20, 6)).toEqual({ x: 160, y: 360 + 16 }); // bottom: below
    expect(dimensionAnchor(ne, se, inside, 40, 20, 6)).toEqual({ x: 260 + 26, y: 200 }); // right: to the right
    expect(dimensionAnchor(sw, nw, inside, 40, 20, 6)).toEqual({ x: 60 - 26, y: 200 }); // left: to the left
  });

  it('is the same whichever way the edge was drawn', () => {
    expect(dimensionAnchor(ne, nw, inside, 40, 20, 6)).toEqual(dimensionAnchor(nw, ne, inside, 40, 20, 6));
  });

  it('puts a wall with no room above it, or left of it when upright', () => {
    expect(dimensionAnchor({ x: 0, y: 100 }, { x: 80, y: 100 }, null, 40, 20, 6)).toEqual({ x: 40, y: 84 });
    expect(dimensionAnchor({ x: 80, y: 100 }, { x: 0, y: 100 }, null, 40, 20, 6)).toEqual({ x: 40, y: 84 });
    expect(dimensionAnchor({ x: 50, y: 0 }, { x: 50, y: 80 }, null, 40, 20, 6)).toEqual({ x: 24, y: 40 });
  });
});
