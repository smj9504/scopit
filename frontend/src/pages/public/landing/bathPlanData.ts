/**
 * A real bathroom plan, drawn in the Bathroom Estimator's Sketch tab for an
 * insurance job (the address is left out): its room, tile zones, drywall
 * repair mark and fixtures, generated from the saved sketch with the app's own
 * fixture shapes (beFixtureShapes) and plumbing points, so it matches the plan
 * the app draws. Units are sketch pixels: 40 = 1 ft. Fixture paths are
 * the app's, normalised 0-1 over the fixture's box.
 */

export type BathZoneType =
  | 'floor'
  | 'tub_surround'
  | 'tub_deck'
  | 'tub_front_panel'
  | 'shower_walls'
  | 'shower_floor'
  | 'shower_curb'
  | 'shower_glass_panel'
  | 'shower_door';

export interface BathFixture {
  type: string;
  /** Centre and turn, as on the canvas. */
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  /** The app's shape paths, 0-1 over the box; strokes in screen pixels. */
  paths: { d: string; fill: string; stroke: string; sw: number }[];
  /** A tub's or shower's faucet and drain, 0-1 over the box; the edge the faucet is on. */
  plumbing?: { faucet: number[]; edge: string | null; drain: number[]; shower: boolean };
}

export const BATH_PPF = 40;
export const BATH_FRAME = {x: 175, y: -574.3, w: 541.9, h: 333.6};

export const BATH_ROOMS: number[][] = [
  [280,-560,700,-560,700,-255,460,-255,385,-330,185,-330,185,-435,280,-435],
];

export const BATH_ZONES: { type: BathZoneType; pieces: number[][] }[] = [
  {type: 'floor', pieces: [[280,-560,700,-560,700,-255,460,-255,385,-330,185,-330,185,-435,280,-435]]},
  {type: 'tub_surround', pieces: [[706.9,-564.3,706.9,-375,587.3,-375,514.3,-446.6,514.3,-564.3]]},
  {type: 'tub_deck', pieces: [[698.9,-383,592.9,-383,522.3,-452.3,522.3,-556.3,528.3,-556.3,528.3,-454.8,595.4,-389,698.9,-389]]},
  {type: 'tub_front_panel', pieces: [[698.9,-383,698.9,-377,588.7,-377,516.3,-448,516.3,-556.3,522.3,-556.3,522.3,-452.3,592.9,-383]]},
  {type: 'shower_walls', pieces: [[703.8,-384,703.8,-250.7,573.8,-250.7,573.8,-384]]},
  {type: 'shower_floor', pieces: [[698.8,-379,698.8,-255.7,578.8,-255.7,578.8,-379]]},
  {type: 'shower_curb', pieces: [[582.8,-379,582.8,-255.7,578.8,-255.7,578.8,-379]]},
  {type: 'shower_glass_panel', pieces: [[698.8,-383,698.8,-379,578.8,-379,578.8,-383]]},
  {type: 'shower_door', pieces: [[576.8,-368.7,576.8,-266,572.8,-266,572.8,-368.7]]},
];

/** Drywall repair along a wall: from, to. */
export const BATH_DRYWALL: number[][] = [
  [460,-255,575,-255],
];

export const BATH_FIXTURES: BathFixture[] = [
  {type: 'door', x: 456.3, y: -322.1, r: 45, w: 86.7, h: 86.7, paths: [{d: 'M0,1 L1,1', fill: 'none', stroke: '#444', sw: 2.5},{d: 'M1,1 A1,1 0 0,0 0,0', fill: 'none', stroke: '#999', sw: 0.8},{d: 'M0,1 L0,0', fill: 'none', stroke: '#444', sw: 1.5},{d: 'M0,1 m-0.04,0 a0.04,0.04 0 1,0 0.08,0 a0.04,0.04 0 1,0 -0.08,0', fill: '#444', stroke: '#444', sw: 0.5}]},
  {type: 'toilet', x: 233.4, y: -382.8, r: -90, w: 50, h: 96.7, paths: [{d: 'M0.1,0.02 L0.9,0.02 Q0.95,0.02 0.95,0.06 L0.95,0.26 Q0.95,0.3 0.9,0.3 L0.1,0.3 Q0.05,0.3 0.05,0.26 L0.05,0.06 Q0.05,0.02 0.1,0.02 Z', fill: 'none', stroke: '#444', sw: 1.5},{d: 'M0.08,0.3 L0.92,0.3 Q0.98,0.3 0.98,0.42 L0.98,0.68 Q0.98,0.98 0.5,0.98 Q0.02,0.98 0.02,0.68 L0.02,0.42 Q0.02,0.3 0.08,0.3 Z', fill: 'none', stroke: '#444', sw: 2},{d: 'M0.18,0.34 L0.82,0.34 Q0.88,0.34 0.88,0.44 L0.88,0.64 Q0.88,0.92 0.5,0.92 Q0.12,0.92 0.12,0.64 L0.12,0.44 Q0.12,0.34 0.18,0.34 Z', fill: 'none', stroke: '#999', sw: 0.8},{d: 'M0.1,0.3 L0.9,0.3', fill: 'none', stroke: '#444', sw: 0.5},{d: 'M0.88,0.14 L1.0,0.14', fill: 'none', stroke: '#444', sw: 1}]},
  {type: 'vanity', x: 402.1, y: -523.9, r: 0, w: 240, h: 70, paths: [{d: 'M0,0 L1,0 L1,1 L0,1 Z', fill: 'none', stroke: '#444', sw: 2},{d: 'M0,0.12 L1,0.12', fill: 'none', stroke: '#444', sw: 0.8},{d: 'M0.08,0.18 Q0.08,0.14 0.25,0.14 Q0.42,0.14 0.42,0.18 L0.42,0.52 Q0.42,0.58 0.25,0.58 Q0.08,0.58 0.08,0.52 Z', fill: 'none', stroke: '#444', sw: 1},{d: 'M0.58,0.18 Q0.58,0.14 0.75,0.14 Q0.92,0.14 0.92,0.18 L0.92,0.52 Q0.92,0.58 0.75,0.58 Q0.58,0.58 0.58,0.52 Z', fill: 'none', stroke: '#444', sw: 1},{d: 'M0.22,0.04 L0.28,0.04 L0.28,0.1 L0.22,0.1 Z', fill: '#999', stroke: '#444', sw: 0.5},{d: 'M0.72,0.04 L0.78,0.04 L0.78,0.1 L0.72,0.1 Z', fill: '#999', stroke: '#444', sw: 0.5},{d: 'M0.5,0.65 L0.5,0.95', fill: 'none', stroke: '#999', sw: 0.8},{d: 'M0.18,0.78 L0.26,0.78', fill: 'none', stroke: '#444', sw: 1.2},{d: 'M0.36,0.78 L0.44,0.78', fill: 'none', stroke: '#444', sw: 1.2},{d: 'M0.56,0.78 L0.64,0.78', fill: 'none', stroke: '#444', sw: 1.2},{d: 'M0.74,0.78 L0.82,0.78', fill: 'none', stroke: '#444', sw: 1.2}]},
  {type: 'bathtub', x: 610.6, y: -469.7, r: 90, w: 173.3, h: 176.7, paths: [{d: 'M1,0 L1,0.54 Q1,0.6 0.958,0.642 L0.642,0.958 Q0.6,1 0.54,1 L0,1', fill: 'none', stroke: '#444', sw: 2},{d: 'M0.96,0.04 L0.96,0.51 Q0.96,0.56 0.925,0.595 L0.595,0.925 Q0.56,0.96 0.51,0.96 L0.04,0.96', fill: 'none', stroke: '#999', sw: 0.6},{d: 'M0.08,0.08 L0.88,0.08 L0.88,0.48 L0.48,0.88 L0.08,0.88 Z', fill: 'none', stroke: '#444', sw: 1.5},{d: 'M0.9,0.15 L0.96,0.15', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.9,0.3 L0.96,0.3', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.9,0.45 L0.96,0.45', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.15,0.9 L0.15,0.96', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.3,0.9 L0.3,0.96', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.45,0.9 L0.45,0.96', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0,0 L1,0', fill: 'none', stroke: '#444', sw: 3},{d: 'M0,0 L0,1', fill: 'none', stroke: '#444', sw: 3}], plumbing: {faucet: [0.72,0.52], edge: null, drain: [0.605,0.51], shower: false}},
  {type: 'shower', x: 638.8, y: -317.3, r: 90, w: 123.3, h: 120, paths: [{d: 'M0.33,0.05 L0.33,0.95', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.66,0.05 L0.66,0.95', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.05,0.33 L0.95,0.33', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0.05,0.66 L0.95,0.66', fill: 'none', stroke: '#999', sw: 0.3},{d: 'M0,0 L1,0', fill: 'none', stroke: '#444', sw: 3},{d: 'M1,0 L1,1', fill: 'none', stroke: '#444', sw: 3},{d: 'M0,0 L0,1', fill: 'none', stroke: '#2196f3', sw: 2},{d: 'M0.03,0.2 L0.03,0.8', fill: 'none', stroke: '#90caf9', sw: 0.5},{d: 'M0.068,0.94 L0.52,0.94 L0.52,1 L0.068,1 Z', fill: '#d4eaf7', stroke: '#444', sw: 1.2},{d: 'M0.48,0.94 L0.932,0.94 L0.932,1 L0.48,1 Z', fill: '#d4eaf7', stroke: '#444', sw: 1.2},{d: 'M0.55,0.97 L0.7,0.97', fill: 'none', stroke: '#444', sw: 0.6},{d: 'M0.67,0.95 L0.7,0.97 L0.67,0.99', fill: 'none', stroke: '#444', sw: 0.6}], plumbing: {faucet: [0.5,0], edge: 'north', drain: [0.5,0.5], shower: true}},
];
