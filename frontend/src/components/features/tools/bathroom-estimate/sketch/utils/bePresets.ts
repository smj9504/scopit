/**
 * bePresets - Bathroom layout presets for quick-start
 *
 * Pre-configured bathroom layouts that automatically create
 * room, walls, and common fixtures.
 */

import type { BEPoint, BEFixtureType, BEFixtureProperties, BEDimensions } from '@/types/bathroomSketch';

export interface BathroomPreset {
  id: string;
  name: string;
  description: string;
  /** Room dimensions in feet */
  widthFt: number;
  depthFt: number;
  /** Fixtures to place */
  fixtures: {
    type: BEFixtureType;
    /** Position relative to room origin (0,0 = top-left), in feet */
    relX: number;
    relY: number;
    rotation: number;
    properties?: Partial<BEFixtureProperties>;
    /** Override default fixture dimensions (inches) */
    dimensions?: BEDimensions;
  }[];
}

/**
 * Preset positions use relX/relY in feet from room top-left corner.
 * Fixtures render CENTERED at that position.
 *
 * Wall-flush formula (fixture center → wall edge):
 *   Against top wall:    relY = fixtureDepthIn / 2 / 12
 *   Against bottom wall: relY = roomDepthFt - fixtureDepthIn / 2 / 12
 *   Against left wall:   relX = fixtureWidthIn / 2 / 12
 *   Against right wall:  relX = roomWidthFt - fixtureWidthIn / 2 / 12
 *
 * Clearance rules (IRC / NKBA):
 *   Toilet centerline ≥ 15" from side wall (1.25 ft)
 *   21" min clear in front of toilet
 *   30" x 48" clear floor space at each fixture
 *   24" clear in front of shower/tub entry
 *
 * Industry standard plan-view dimensions (inches):
 *   Bathtub alcove: 60 W x 32 D
 *   Shower stall:   36 W x 36 D
 *   Vanity:         varies W x 21 D
 *   Toilet:         15 W x 29 D
 *   Door swing:     32 W x 32 D (plan-view arc)
 */
export const BATHROOM_PRESETS: BathroomPreset[] = [
  {
    // ┌─────── 5 ft ───────┐
    // │  BATHTUB (60x32)    │ ← back wall
    // │                     │
    // │ TOILET │   VANITY   │
    // │        │            │
    // │              DOOR → │ ← front wall
    // └─────────────────────┘  8 ft
    id: 'standard_full',
    name: 'Standard Full (5x8)',
    description: 'Alcove tub/shower combo, vanity, toilet. Common hall bath.',
    widthFt: 5,
    depthFt: 8,
    fixtures: [
      // Bathtub: 60"W x 32"D, flush to back (top) wall, spans full 5ft width
      { type: 'bathtub', relX: 2.5, relY: 1.33, rotation: 0, properties: { bathtubSubType: 'standard_alcove', hasSurround: true, surroundWallCount: 3, surroundHeight: 60 } },
      // Toilet: 15"W x 29"D, center 15" from left wall, flush to left side
      { type: 'toilet', relX: 1.25, relY: 5.29, rotation: 0 },
      // Vanity: 36"W x 21"D, right side, flush to right wall
      { type: 'vanity', relX: 3.5, relY: 5.29, rotation: 0, properties: { vanityWidth: 36, sinkCount: 1 } },
      // Door: 32"x32" swing, bottom-right corner
      { type: 'door', relX: 3.67, relY: 6.67, rotation: 0 },
    ],
  },
  {
    // ┌──────────── 9 ft ────────────┐
    // │ BATHTUB (60x32) │ SHOWER(36²) │ ← back wall
    // │                 │             │
    // │ TOILET │                      │
    // │        │   DBL VANITY (60)    │
    // │                     DOOR →    │ ← front wall
    // └───────────────────────────────┘  12 ft
    id: 'master_large',
    name: 'Master Bath (9x12)',
    description: 'Separate tub + walk-in shower, double vanity, toilet.',
    widthFt: 9,
    depthFt: 12,
    fixtures: [
      // Bathtub: 60"W x 32"D, flush to back wall & left wall
      { type: 'bathtub', relX: 2.5, relY: 1.33, rotation: 0, properties: { bathtubSubType: 'drop_in', hasSurround: true, surroundWallCount: 3, surroundHeight: 60, deckWidth: 10, deckHeight: 20 } },
      // Shower: 36"x36", flush to back wall & right wall
      { type: 'shower', relX: 7.5, relY: 1.5, rotation: 0, properties: { showerFloorType: 'tile', showerWallCount: 3, showerTileHeight: 96, nicheCount: 2, hasBench: true } },
      // Toilet: 15"W x 29"D, center 15" from left wall
      { type: 'toilet', relX: 1.25, relY: 7.0, rotation: 0 },
      // Double vanity: 60"W x 21"D, centered on bottom wall
      { type: 'vanity', relX: 4.5, relY: 11.13, rotation: 0, properties: { vanityWidth: 60, sinkCount: 2, hasBacksplash: true, backsplashHeight: 4 } },
      // Door: bottom area
      { type: 'door', relX: 7.67, relY: 10.67, rotation: 0 },
    ],
  },
  {
    // ┌─────── 5 ft ───────┐
    // │  SHOWER (36x36)     │ ← back wall
    // │                     │
    // │ TOILET │   VANITY   │
    // │              DOOR → │ ← front wall
    // └─────────────────────┘  7 ft
    id: 'three_quarter',
    name: '3/4 Bath (5x7)',
    description: 'Walk-in shower (no tub), vanity, toilet.',
    widthFt: 5,
    depthFt: 7,
    fixtures: [
      // Shower: 36"x36", flush to back wall, centered
      { type: 'shower', relX: 2.5, relY: 1.5, rotation: 0, properties: { showerFloorType: 'tile', showerWallCount: 3, showerTileHeight: 96, nicheCount: 1 } },
      // Toilet: center 15" from left wall
      { type: 'toilet', relX: 1.25, relY: 4.71, rotation: 0 },
      // Vanity: 30"W x 21"D, right side
      { type: 'vanity', relX: 3.75, relY: 4.71, rotation: 0, properties: { vanityWidth: 30, sinkCount: 1 } },
      // Door: bottom-right
      { type: 'door', relX: 3.67, relY: 5.67, rotation: 0 },
    ],
  },
  {
    // ┌───── 4 ft ─────┐
    // │    VANITY (24)  │ ← back wall
    // │                 │
    // │    TOILET       │
    // │          DOOR → │ ← front wall
    // └─────────────────┘  5 ft
    id: 'powder_room',
    name: 'Powder Room (4x5)',
    description: 'Half bath: vanity + toilet only.',
    widthFt: 4,
    depthFt: 5,
    fixtures: [
      // Vanity: 24"W x 21"D, flush to back wall, centered
      { type: 'vanity', relX: 2, relY: 0.88, rotation: 0, properties: { vanityWidth: 24, sinkCount: 1 } },
      // Toilet: centered, below vanity
      { type: 'toilet', relX: 2, relY: 3.21, rotation: 0 },
      // Door: bottom-right
      { type: 'door', relX: 2.67, relY: 3.67, rotation: 0 },
    ],
  },
  {
    // ┌──────── 6 ft ────────┐
    // │  SHOWER (48x36)       │ ← back wall (curbless)
    // │                       │
    // │ TOILET │              │
    // │        │ VANITY (48)  │
    // │              DOOR →   │ ← front wall
    // └───────────────────────┘  9 ft
    id: 'curbless_ada',
    name: 'ADA / Curbless (6x9)',
    description: 'Curbless shower, grab bars, wider clearances.',
    widthFt: 6,
    depthFt: 9,
    fixtures: [
      // Shower: 48"x36" (wider for ADA), flush to back wall
      { type: 'shower', relX: 3, relY: 1.5, rotation: 0, properties: { showerFloorType: 'tile', showerWallCount: 3, showerTileHeight: 96, curbHeight: 0, hasBench: true, nicheCount: 1 } },
      // Toilet: center 18" from left wall (ADA: wider clearance)
      { type: 'toilet', relX: 1.5, relY: 6.29, rotation: 0 },
      // Vanity: 48"W x 21"D, right side
      { type: 'vanity', relX: 4, relY: 8.13, rotation: 0, properties: { vanityWidth: 48, sinkCount: 1, hasBacksplash: true, backsplashHeight: 4 } },
      // Door: bottom area (wider 36" for ADA)
      { type: 'door', relX: 4.67, relY: 7.67, rotation: 0 },
    ],
  },
  {
    // ┌──────── 6 ft ────────┐
    // │ TOILET │ NEO-ANGLE   │ ← back wall
    // │        │  (38x38)  / │
    // │        │         /   │ ← diagonal glass+door
    // │ VANITY │       ╱    │
    // │ (30)   │ DOOR →     │
    // └────────────────────┘  6 ft
    id: 'corner_neo_angle',
    name: 'Corner Neo-Angle (6x6)',
    description: 'Neo-angle corner shower (38x38), compact layout.',
    widthFt: 6,
    depthFt: 6,
    fixtures: [
      // Neo-angle shower: 38"x38", flush to back+right corner
      { type: 'shower', relX: 4.42, relY: 1.58, rotation: 0,
        dimensions: { width: 38, height: 38 },
        properties: {
          showerFloorType: 'tile',
          showerWallCount: 2,
          showerTileHeight: 77,
          showerLayout: 'neo_angle',
          showerDoorType: 'neo_angle_pivot',
          nicheCount: 1,
          curbHeight: 4,
        },
      },
      // Toilet: left side
      { type: 'toilet', relX: 1.25, relY: 1.71, rotation: 0 },
      // Vanity: 30"W x 21"D, bottom-left
      { type: 'vanity', relX: 1.25, relY: 5.13, rotation: 0,
        properties: { vanityWidth: 30, sinkCount: 1, hasBacksplash: true, backsplashHeight: 4 },
      },
      // Door: bottom-right
      { type: 'door', relX: 4.67, relY: 4.67, rotation: 0 },
    ],
  },
];
