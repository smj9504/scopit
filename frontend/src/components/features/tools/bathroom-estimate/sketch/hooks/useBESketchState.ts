/**
 * useBESketchState - Bathroom Estimate Sketch state management hook
 *
 * Manages walls, rooms, fixtures, tile zones, damage zones,
 * tool selection, undo/redo, and canvas settings.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  BESketchData,
  BESketchTool,
  BEWall,
  BERoom,
  BEFixture,
  BETileZone,
  BEDamageZone,
  BEDrywallRepairZone,
  BEInsulationZone,
  BEDimensions,
  DrywallTextureType,
  BEPoint,
  BEFixtureType,
  BEFixtureProperties,
  BESketchSettings,
  BERoomType,
} from '@/types/bathroomSketch';
import {
  EMPTY_BE_SKETCH,
  BE_FIXTURE_DEFAULTS,
  BATHTUB_SURROUND_DEFAULTS,
  DEFAULT_TILE_SPEC,
  TILE_ZONE_COLORS,
  DEFAULT_DRYWALL_COSTS,
  DEFAULT_INSULATION_COSTS,
} from '@/types/bathroomSketch';
import { generateTileZones } from '../utils/beTileZoneGenerator';
import { wallAreaSF as roomWallSF } from '../utils/beGeometry';
import { findClosedWallLoop } from '../utils/beWallLoop';

let _idCounter = 0;
function generateId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${Date.now()}_${_idCounter}`;
}

// ── Pixels ↔ Inches conversion ──

function pxToInches(px: number, pixelsPerFoot: number): number {
  return (px / pixelsPerFoot) * 12;
}

function inchesToPx(inches: number, pixelsPerFoot: number): number {
  return (inches / 12) * pixelsPerFoot;
}

function calcDistance(a: BEPoint, b: BEPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Ray-casting point-in-polygon test */
function pointInPolygon(pt: BEPoint, poly: BEPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Find parent room: the existing room whose boundary contains the centroid of the new room */
function findParentRoom(rooms: BERoom[], newBoundary: BEPoint[], excludeId?: string): string | undefined {
  const cx = newBoundary.reduce((s, p) => s + p.x, 0) / newBoundary.length;
  const cy = newBoundary.reduce((s, p) => s + p.y, 0) / newBoundary.length;
  const centroid = { x: cx, y: cy };
  for (const room of rooms) {
    if (room.id === excludeId) continue;
    if (pointInPolygon(centroid, room.boundary)) {
      return room.id;
    }
  }
  return undefined;
}

/** Recalculate netFloorAreaSF for all rooms (gross - sub-rooms) */
function recalcNetAreas(rooms: BERoom[]): BERoom[] {
  return rooms.map((room) => {
    const childArea = rooms
      .filter((r) => r.parentRoomId === room.id)
      .reduce((sum, r) => sum + r.floorAreaSF, 0);
    return { ...room, netFloorAreaSF: Math.round((room.floorAreaSF - childArea) * 100) / 100 };
  });
}

// ── Undo/Redo history ──

const MAX_HISTORY = 30;

interface HistoryState {
  past: BESketchData[];
  future: BESketchData[];
}

// ── Hook ──

export function useBESketchState(initialData?: BESketchData) {
  const [data, setData] = useState<BESketchData>(initialData ?? { ...EMPTY_BE_SKETCH });
  const [activeTool, setActiveTool] = useState<BESketchTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [drywallSurface, setDrywallSurface] = useState<'wall' | 'ceiling'>('wall');
  const [insulationSurface, setInsulationSurface] = useState<'wall' | 'ceiling'>('wall');

  const historyRef = useRef<HistoryState>({ past: [], future: [] });

  // ── History helpers ──

  const pushHistory = useCallback((prev: BESketchData) => {
    const h = historyRef.current;
    h.past = [...h.past.slice(-(MAX_HISTORY - 1)), prev];
    h.future = [];
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    setData((cur) => {
      h.future = [cur, ...h.future];
      h.past = h.past.slice(0, -1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    setData((cur) => {
      h.past = [...h.past, cur];
      h.future = h.future.slice(1);
      return next;
    });
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // ── Mutate helper (records undo) ──

  const mutate = useCallback(
    (updater: (draft: BESketchData) => BESketchData) => {
      setData((prev) => {
        pushHistory(prev);
        setIsDirty(true);
        return updater(prev);
      });
    },
    [pushHistory],
  );

  // ── Wall CRUD ──

  const addWall = useCallback(
    (start: BEPoint, end: BEPoint) => {
      const wall: BEWall = {
        id: generateId('wall'),
        start,
        end,
        thickness: 4,
        heightInches: 96,
      };
      mutate((d) => {
        const newWalls = [...d.walls, wall];
        // Auto-detect closed loop → create Room
        const loop = findClosedWallLoop(newWalls);
        if (loop && loop.boundary.length >= 3) {
          // Check if a room with these walls already exists
          const existingWallIds = new Set(d.rooms.flatMap((r) => r.wallIds));
          const alreadyUsed = loop.wallIds.some((id) => existingWallIds.has(id));
          if (!alreadyUsed) {
            const ppf = d.settings.pixelsPerFoot;
            let perimeterPx = 0;
            for (let i = 0; i < loop.boundary.length; i++) {
              const next = loop.boundary[(i + 1) % loop.boundary.length];
              perimeterPx += calcDistance(loop.boundary[i], next);
            }
            let areaPx2 = 0;
            for (let i = 0; i < loop.boundary.length; i++) {
              const j = (i + 1) % loop.boundary.length;
              areaPx2 += loop.boundary[i].x * loop.boundary[j].y;
              areaPx2 -= loop.boundary[j].x * loop.boundary[i].y;
            }
            areaPx2 = Math.abs(areaPx2) / 2;
            const floorAreaSF = areaPx2 / (ppf * ppf);
            const perimeterLF = pxToInches(perimeterPx, ppf) / 12;
            const wallAreaSF = roomWallSF(perimeterLF, 96);

            const parentRoomId = findParentRoom(d.rooms, loop.boundary);
            const room: BERoom = {
              id: generateId('room'),
              name: parentRoomId ? 'Closet' : 'Bathroom',
              roomType: parentRoomId ? 'closet' : 'bathroom',
              boundary: loop.boundary,
              wallIds: loop.wallIds,
              parentRoomId,
              heightInches: 96,
              floorAreaSF: Math.round(floorAreaSF * 100) / 100,
              netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
              wallAreaSF: Math.round(wallAreaSF * 100) / 100,
              perimeterLF: Math.round(perimeterLF * 100) / 100,
            };
            const newRooms = recalcNetAreas([...d.rooms, room]);
            return { ...d, walls: newWalls, rooms: newRooms };
          }
        }
        return { ...d, walls: newWalls };
      });
      return wall.id;
    },
    [mutate],
  );

  const updateWall = useCallback(
    (id: string, updates: Partial<BEWall>) => {
      mutate((d) => ({
        ...d,
        walls: d.walls.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      }));
    },
    [mutate],
  );

  const removeWall = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, walls: d.walls.filter((w) => w.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Room CRUD ──

  const addRoom = useCallback(
    (boundary: BEPoint[], wallIds: string[], name?: string, roomType?: BERoomType) => {
      const ppf = data.settings.pixelsPerFoot;
      let perimeterPx = 0;
      for (let i = 0; i < boundary.length; i++) {
        const next = boundary[(i + 1) % boundary.length];
        perimeterPx += calcDistance(boundary[i], next);
      }
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const floorAreaSF = areaPx2 / (ppf * ppf);
      const perimeterLF = pxToInches(perimeterPx, ppf) / 12;
      const heightInches = 96;
      const wallAreaSF = roomWallSF(perimeterLF, heightInches);

      mutate((d) => {
        // Auto-detect parent room
        const parentRoomId = findParentRoom(d.rooms, boundary);
        const isSubRoom = !!parentRoomId;
        const defaultType: BERoomType = isSubRoom ? 'closet' : 'bathroom';
        const defaultName = isSubRoom
          ? (roomType === 'toilet_room' ? 'Toilet Room' : roomType === 'linen_closet' ? 'Linen Closet' : 'Closet')
          : 'Bathroom';

        // Auto-create walls for each boundary edge if none provided
        let finalWallIds = wallIds;
        let newWalls = [...d.walls];
        if (wallIds.length === 0 && boundary.length >= 3) {
          finalWallIds = [];
          for (let i = 0; i < boundary.length; i++) {
            const next = boundary[(i + 1) % boundary.length];
            const wall: BEWall = {
              id: generateId('wall'),
              start: boundary[i],
              end: next,
              thickness: 4,
              heightInches,
            };
            newWalls.push(wall);
            finalWallIds.push(wall.id);
          }
        }

        const room: BERoom = {
          id: generateId('room'),
          name: name ?? defaultName,
          roomType: roomType ?? defaultType,
          boundary,
          wallIds: finalWallIds,
          parentRoomId,
          heightInches,
          floorAreaSF: Math.round(floorAreaSF * 100) / 100,
          netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
          wallAreaSF: Math.round(wallAreaSF * 100) / 100,
          perimeterLF: Math.round(perimeterLF * 100) / 100,
        };
        const newRooms = recalcNetAreas([...d.rooms, room]);
        return { ...d, walls: newWalls, rooms: newRooms };
      });
      return generateId('room'); // Note: actual ID created inside mutate
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateRoom = useCallback(
    (id: string, boundary: BEPoint[]) => {
      const ppf = data.settings.pixelsPerFoot;
      let perimeterPx = 0;
      for (let i = 0; i < boundary.length; i++) {
        const next = boundary[(i + 1) % boundary.length];
        perimeterPx += calcDistance(boundary[i], next);
      }
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const floorAreaSF = areaPx2 / (ppf * ppf);
      const perimeterLF = pxToInches(perimeterPx, ppf) / 12;

      mutate((d) => {
        const room = d.rooms.find((r) => r.id === id);
        const wallAreaSF = roomWallSF(perimeterLF, room?.heightInches || 96);

        // Sync walls to match new boundary edges
        let newWalls = d.walls;
        if (room && room.wallIds.length === boundary.length && room.wallIds.length > 0) {
          const wallIdSet = new Set(room.wallIds);
          newWalls = d.walls.map((w) => {
            if (!wallIdSet.has(w.id)) return w;
            const wallIdx = room.wallIds.indexOf(w.id);
            return {
              ...w,
              start: boundary[wallIdx],
              end: boundary[(wallIdx + 1) % boundary.length],
            };
          });
        }

        const updated = d.rooms.map((r) =>
          r.id === id
            ? {
                ...r,
                boundary,
                floorAreaSF: Math.round(floorAreaSF * 100) / 100,
                netFloorAreaSF: Math.round(floorAreaSF * 100) / 100,
                wallAreaSF: Math.round(wallAreaSF * 100) / 100,
                perimeterLF: Math.round(perimeterLF * 100) / 100,
              }
            : r,
        );
        return { ...d, walls: newWalls, rooms: recalcNetAreas(updated) };
      });
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateRoomMeta = useCallback(
    (id: string, updates: Partial<Pick<BERoom, 'name' | 'roomType' | 'heightInches'>>) => {
      mutate((d) => ({
        ...d,
        rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      }));
    },
    [mutate],
  );

  /** A room's ceiling height, and its own walls' with it */
  const setRoomHeight = useCallback(
    (id: string, heightInches: number) => {
      mutate((d) => {
        const room = d.rooms.find((r) => r.id === id);
        if (!room) return d;
        const own = new Set(room.wallIds);
        return {
          ...d,
          walls: d.walls.map((w) => (own.has(w.id) ? { ...w, heightInches } : w)),
          rooms: d.rooms.map((r) => (r.id === id
            ? { ...r, heightInches, wallAreaSF: Math.round(roomWallSF(r.perimeterLF, heightInches) * 100) / 100 }
            : r)),
        };
      });
    },
    [mutate],
  );

  const removeRoom = useCallback(
    (id: string) => {
      mutate((d) => {
        const filtered = d.rooms.filter((r) => r.id !== id);
        // Re-parent children: clear parentRoomId for any child rooms
        const updated = filtered.map((r) => r.parentRoomId === id ? { ...r, parentRoomId: undefined } : r);
        return { ...d, rooms: recalcNetAreas(updated), fixtures: d.fixtures.filter((f) => f.roomId !== id) };
      });
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Fixture CRUD ──

  const addFixture = useCallback(
    (
      type: BEFixtureType,
      position: BEPoint,
      roomId?: string,
      wallId?: string,
      properties?: Partial<BEFixtureProperties>,
      overrideDimensions?: BEDimensions,
    ) => {
      const defaults = BE_FIXTURE_DEFAULTS[type];
      const fixture: BEFixture = {
        id: generateId('fix'),
        type,
        position,
        dimensions: overrideDimensions ? { ...overrideDimensions } : { ...defaults },
        rotation: 0,
        roomId,
        wallId,
        properties: properties ?? {},
      };

      // Apply bathtub subtype defaults (surround ON for wall-mounted types)
      if (type === 'bathtub') {
        const subType = properties?.bathtubSubType ?? 'standard_alcove';
        const sd = BATHTUB_SURROUND_DEFAULTS[subType];
        fixture.properties = {
          ...fixture.properties,
          bathtubSubType: subType,
          // Default hasSurround based on wall count (ON for alcove/drop_in/corner)
          hasSurround: properties?.hasSurround ?? (sd.surroundWallCount > 0),
          surroundWallCount: sd.surroundWallCount,
          surroundHeight: sd.surroundHeight,
          deckWidth: sd.deckWidth,
          deckHeight: sd.deckHeight,
          deckTileSides: sd.deckTileSides,
          hasFrontPanel: properties?.hasFrontPanel ?? sd.hasFrontPanel,
        };
      }

      mutate((d) => ({ ...d, fixtures: [...d.fixtures, fixture] }));
      return fixture.id;
    },
    [mutate],
  );

  const updateFixture = useCallback(
    (id: string, updates: Partial<BEFixture>) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      }));
    },
    [mutate],
  );

  const updateFixtureProperties = useCallback(
    (id: string, propUpdates: Partial<BEFixtureProperties>) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.map((f) =>
          f.id === id ? { ...f, properties: { ...f.properties, ...propUpdates } } : f,
        ),
      }));
    },
    [mutate],
  );

  const removeFixture = useCallback(
    (id: string) => {
      mutate((d) => ({
        ...d,
        fixtures: d.fixtures.filter((f) => f.id !== id),
        tileZones: d.tileZones.filter((z) => z.fixtureId !== id),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Tile Zone management ──

  const updateTileZone = useCallback(
    (id: string, updates: Partial<BETileZone>) => {
      mutate((d) => ({
        ...d,
        tileZones: d.tileZones.map((z) => (z.id === id ? { ...z, ...updates } : z)),
      }));
    },
    [mutate],
  );

  // ── Damage Zone CRUD ──

  const addDamageZone = useCallback(
    (boundary: BEPoint[], damageType: BEDamageZone['damageType']) => {
      const ppf = data.settings.pixelsPerFoot;
      let areaPx2 = 0;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length;
        areaPx2 += boundary[i].x * boundary[j].y;
        areaPx2 -= boundary[j].x * boundary[i].y;
      }
      areaPx2 = Math.abs(areaPx2) / 2;

      const zone: BEDamageZone = {
        id: generateId('dmg'),
        boundary,
        areaSF: Math.round((areaPx2 / (ppf * ppf)) * 100) / 100,
        damageType,
        needsDemo: true,
        needsReplace: true,
      };
      mutate((d) => ({ ...d, damageZones: [...d.damageZones, zone] }));
      return zone.id;
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateDamageZone = useCallback(
    (id: string, updates: Partial<Pick<BEDamageZone, 'boundary' | 'damageType' | 'label' | 'needsDemo' | 'needsReplace'>>) => {
      const ppf = data.settings.pixelsPerFoot;
      mutate((d) => ({
        ...d,
        damageZones: d.damageZones.map((z) => {
          if (z.id !== id) return z;
          const merged = { ...z, ...updates };
          // Recalculate area if boundary changed
          if (updates.boundary) {
            const b = updates.boundary;
            let area2 = 0;
            for (let i = 0; i < b.length; i++) {
              const j = (i + 1) % b.length;
              area2 += b[i].x * b[j].y;
              area2 -= b[j].x * b[i].y;
            }
            merged.areaSF = Math.round((Math.abs(area2) / 2 / (ppf * ppf)) * 100) / 100;
          }
          return merged;
        }),
      }));
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const removeDamageZone = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, damageZones: d.damageZones.filter((z) => z.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Drywall Repair Zone CRUD ──

  const addDrywallRepairZone = useCallback(
    (boundary: BEPoint[], roomId?: string, surface: 'wall' | 'ceiling' = 'wall') => {
      const ppf = data.settings.pixelsPerFoot;
      const repairHeightInches = 96;

      let areaSF: number;
      if (surface === 'wall') {
        // boundary = [start, end]; area = lineLengthFt × repairHeightInches/12
        const dx = boundary[1].x - boundary[0].x;
        const dy = boundary[1].y - boundary[0].y;
        const lineLengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
        areaSF = Math.round(lineLengthFt * (repairHeightInches / 12) * 100) / 100;
      } else {
        // boundary = 4-point rectangle; shoelace formula
        let areaPx2 = 0;
        for (let i = 0; i < boundary.length; i++) {
          const j = (i + 1) % boundary.length;
          areaPx2 += boundary[i].x * boundary[j].y;
          areaPx2 -= boundary[j].x * boundary[i].y;
        }
        areaSF = Math.round((Math.abs(areaPx2) / 2 / (ppf * ppf)) * 100) / 100;
      }

      const zone: BEDrywallRepairZone = {
        id: generateId('dwr'),
        roomId,
        surface,
        boundary,
        areaSF,
        repairHeightInches,
        includeGluing: true,
        textureType: 'smooth',
        paintCoats: 2,
        ...DEFAULT_DRYWALL_COSTS,
      };
      mutate((d) => ({
        ...d,
        drywallRepairZones: [...(d.drywallRepairZones ?? []), zone],
      }));
      return zone.id;
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateDrywallRepairZone = useCallback(
    (id: string, updates: Partial<BEDrywallRepairZone>) => {
      mutate((d) => {
        const ppf = d.settings.pixelsPerFoot;
        return {
          ...d,
          drywallRepairZones: (d.drywallRepairZones ?? []).map((z) => {
            if (z.id !== id) return z;
            const merged = { ...z, ...updates };
            // Recalculate area whenever boundary or height changes
            if (updates.boundary !== undefined || updates.repairHeightInches !== undefined) {
              if (merged.surface === 'wall') {
                const dx = merged.boundary[1].x - merged.boundary[0].x;
                const dy = merged.boundary[1].y - merged.boundary[0].y;
                const lineLengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
                merged.areaSF = Math.round(lineLengthFt * (merged.repairHeightInches / 12) * 100) / 100;
              } else {
                let areaPx2 = 0;
                for (let i = 0; i < merged.boundary.length; i++) {
                  const j = (i + 1) % merged.boundary.length;
                  areaPx2 += merged.boundary[i].x * merged.boundary[j].y;
                  areaPx2 -= merged.boundary[j].x * merged.boundary[i].y;
                }
                merged.areaSF = Math.round((Math.abs(areaPx2) / 2 / (ppf * ppf)) * 100) / 100;
              }
            }
            return merged;
          }),
        };
      });
    },
    [mutate],
  );

  const removeDrywallRepairZone = useCallback(
    (id: string) => {
      mutate((d) => ({
        ...d,
        drywallRepairZones: (d.drywallRepairZones ?? []).filter((z) => z.id !== id),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Insulation Zone CRUD ──

  const addInsulationZone = useCallback(
    (boundary: BEPoint[], roomId?: string, surface: 'wall' | 'ceiling' = 'wall') => {
      const ppf = data.settings.pixelsPerFoot;
      const heightInches = 96;

      let areaSF: number;
      if (surface === 'wall') {
        const dx = boundary[1].x - boundary[0].x;
        const dy = boundary[1].y - boundary[0].y;
        const lineLengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
        areaSF = Math.round(lineLengthFt * (heightInches / 12) * 100) / 100;
      } else {
        let areaPx2 = 0;
        for (let i = 0; i < boundary.length; i++) {
          const j = (i + 1) % boundary.length;
          areaPx2 += boundary[i].x * boundary[j].y;
          areaPx2 -= boundary[j].x * boundary[i].y;
        }
        areaSF = Math.round((Math.abs(areaPx2) / 2 / (ppf * ppf)) * 100) / 100;
      }

      const zone: BEInsulationZone = {
        id: generateId('ins'),
        roomId,
        surface,
        boundary,
        areaSF,
        heightInches,
        needsDemo: false,
        insulationType: 'fiberglass_batt',
        rValue: 13,
        ...DEFAULT_INSULATION_COSTS,
      };
      mutate((d) => ({
        ...d,
        insulationZones: [...(d.insulationZones ?? []), zone],
      }));
      return zone.id;
    },
    [mutate, data.settings.pixelsPerFoot],
  );

  const updateInsulationZone = useCallback(
    (id: string, updates: Partial<BEInsulationZone>) => {
      mutate((d) => {
        const ppf = d.settings.pixelsPerFoot;
        return {
          ...d,
          insulationZones: (d.insulationZones ?? []).map((z) => {
            if (z.id !== id) return z;
            const merged = { ...z, ...updates };
            if (updates.boundary !== undefined || updates.heightInches !== undefined) {
              if (merged.surface === 'wall') {
                const dx = merged.boundary[1].x - merged.boundary[0].x;
                const dy = merged.boundary[1].y - merged.boundary[0].y;
                const lineLengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
                merged.areaSF = Math.round(lineLengthFt * (merged.heightInches / 12) * 100) / 100;
              } else {
                let areaPx2 = 0;
                for (let i = 0; i < merged.boundary.length; i++) {
                  const j = (i + 1) % merged.boundary.length;
                  areaPx2 += merged.boundary[i].x * merged.boundary[j].y;
                  areaPx2 -= merged.boundary[j].x * merged.boundary[i].y;
                }
                merged.areaSF = Math.round((Math.abs(areaPx2) / 2 / (ppf * ppf)) * 100) / 100;
              }
            }
            return merged;
          }),
        };
      });
    },
    [mutate],
  );

  const removeInsulationZone = useCallback(
    (id: string) => {
      mutate((d) => ({
        ...d,
        insulationZones: (d.insulationZones ?? []).filter((z) => z.id !== id),
      }));
      if (selectedId === id) setSelectedId(null);
    },
    [mutate, selectedId],
  );

  // ── Settings ──

  const updateSettings = useCallback(
    (updates: Partial<BESketchSettings>) => {
      mutate((d) => ({ ...d, settings: { ...d.settings, ...updates } }));
    },
    [mutate],
  );

  // ── Move All Elements ──

  const moveAll = useCallback(
    (dx: number, dy: number) => {
      mutate((d) => ({
        ...d,
        walls: d.walls.map((w) => ({
          ...w,
          start: { x: w.start.x + dx, y: w.start.y + dy },
          end: { x: w.end.x + dx, y: w.end.y + dy },
        })),
        rooms: d.rooms.map((r) => ({
          ...r,
          boundary: r.boundary.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        })),
        fixtures: d.fixtures.map((f) => ({
          ...f,
          position: { x: f.position.x + dx, y: f.position.y + dy },
        })),
        tileZones: (d.tileZones ?? []).map((z) => ({
          ...z,
          boundary: z.boundary.map((p: BEPoint) => ({ x: p.x + dx, y: p.y + dy })),
        })),
        damageZones: (d.damageZones ?? []).map((z) => ({
          ...z,
          boundary: z.boundary.map((p: BEPoint) => ({ x: p.x + dx, y: p.y + dy })),
        })),
        drywallRepairZones: (d.drywallRepairZones ?? []).map((z) => ({
          ...z,
          boundary: z.boundary.map((p: BEPoint) => ({ x: p.x + dx, y: p.y + dy })),
        })),
        insulationZones: (d.insulationZones ?? []).map((z) => ({
          ...z,
          boundary: z.boundary.map((p: BEPoint) => ({ x: p.x + dx, y: p.y + dy })),
        })),
      }));
    },
    [mutate],
  );

  // ── Reset ──

  const resetSketch = useCallback(() => {
    pushHistory(data);
    setData({ ...EMPTY_BE_SKETCH });
    setSelectedId(null);
    setIsDirty(true);
  }, [data, pushHistory]);

  // ── Load external data ──

  const loadSketch = useCallback((newData: BESketchData) => {
    historyRef.current = { past: [], future: [] };
    setData(newData);
    setSelectedId(null);
    setIsDirty(false);
  }, []);

  // ── Auto-regenerate tile zones when fixtures or rooms change ──
  const fixtureSignature = JSON.stringify(data.fixtures.map((f) => ({
    id: f.id, type: f.type, pos: f.position, dim: f.dimensions, props: f.properties,
  })));
  const roomSignature = JSON.stringify(data.rooms.map((r) => ({ id: r.id, boundary: r.boundary, area: r.floorAreaSF })));

  useEffect(() => {
    const newZones = generateTileZones(data.fixtures, data.rooms, data.settings.pixelsPerFoot);
    setData((prev) => ({ ...prev, tileZones: newZones }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureSignature, roomSignature, data.settings.pixelsPerFoot]);

  return {
    // Data
    data,
    isDirty,
    setIsDirty,

    // Tool state
    activeTool,
    setActiveTool,
    selectedId,
    setSelectedId,

    // Wall ops
    addWall,
    updateWall,
    removeWall,

    // Room ops
    addRoom,
    updateRoom,
    updateRoomMeta,
    setRoomHeight,
    removeRoom,

    // Fixture ops
    addFixture,
    updateFixture,
    updateFixtureProperties,
    removeFixture,

    // Tile zone ops
    updateTileZone,

    // Damage zone ops
    addDamageZone,
    updateDamageZone,
    removeDamageZone,

    // Drywall repair zone ops
    addDrywallRepairZone,
    updateDrywallRepairZone,
    removeDrywallRepairZone,
    drywallSurface,
    setDrywallSurface,

    // Insulation zone ops
    addInsulationZone,
    updateInsulationZone,
    removeInsulationZone,
    insulationSurface,
    setInsulationSurface,

    // Settings
    updateSettings,

    // History
    undo,
    redo,
    canUndo,
    canRedo,

    // Bulk ops
    moveAll,

    // Lifecycle
    resetSketch,
    loadSketch,

    // Utility
    pxToInches: (px: number) => pxToInches(px, data.settings.pixelsPerFoot),
    inchesToPx: (inches: number) => inchesToPx(inches, data.settings.pixelsPerFoot),
  };
}

export type BESketchStateAPI = ReturnType<typeof useBESketchState>;
