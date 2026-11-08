/**
 * The finishes the 3D view's realistic look draws the kitchen in — cabinet
 * colour and door style, countertop, backsplash, sink, faucet, hardware
 * and floor — saved with the sketch (overlay_data.finish) and put into
 * words for the AI photo.
 *
 * Plain data, no three.js, so the Sketch tab's toolbar can offer the
 * choices without loading the 3D view; finishMaterials.ts turns them into
 * materials.
 */

import type { CabinetSketchFinish } from '@/types/cabinetSketch';

export interface FinishChoice {
  key: string;
  label: string;
  /** Swatch colour for the picker; for a painted finish, also its paint. */
  swatch: string;
  /** How the AI photo's prompt names it. */
  words: string;
}

export interface CabinetColorChoice extends FinishChoice {
  /** Stained wood rather than paint: drawn with a grain. */
  wood?: boolean;
}

export const CABINET_COLORS: CabinetColorChoice[] = [
  { key: 'white', label: 'White', swatch: '#f1efea', words: 'white painted' },
  { key: 'cream', label: 'Antique white', swatch: '#e8dfcc', words: 'antique white (warm cream) painted' },
  { key: 'light_gray', label: 'Light gray', swatch: '#c8c6c0', words: 'light warm gray painted' },
  { key: 'gray', label: 'Gray', swatch: '#868b8e', words: 'medium gray painted' },
  { key: 'sage', label: 'Sage green', swatch: '#95a088', words: 'sage green painted' },
  { key: 'navy', label: 'Navy', swatch: '#2c3a50', words: 'navy blue painted' },
  { key: 'black', label: 'Black', swatch: '#2a2a2b', words: 'matte black painted' },
  { key: 'oak', label: 'Natural oak', swatch: '#c39a6b', words: 'natural white oak wood', wood: true },
  { key: 'walnut', label: 'Walnut', swatch: '#6a4a34', words: 'dark walnut wood', wood: true },
];

export const DOOR_STYLES: FinishChoice[] = [
  { key: 'shaker', label: 'Shaker', swatch: '#f1efea', words: 'shaker-style (five-piece recessed panel)' },
  { key: 'raised', label: 'Raised panel', swatch: '#f1efea', words: 'traditional raised-panel' },
  { key: 'arched', label: 'Arched raised panel', swatch: '#f1efea', words: 'traditional arched-top (cathedral) raised-panel' },
  { key: 'slab', label: 'Flat (slab)', swatch: '#f1efea', words: 'flat slab (frameless, modern)' },
];

export const COUNTERTOPS: FinishChoice[] = [
  { key: 'white_quartz', label: 'White quartz', swatch: '#efede8', words: 'white quartz countertops' },
  { key: 'marble', label: 'White marble', swatch: '#f2f0ec', words: 'white marble countertops with soft gray veining' },
  { key: 'gray_quartz', label: 'Gray quartz', swatch: '#9b9993', words: 'gray quartz countertops' },
  { key: 'black_granite', label: 'Black granite', swatch: '#232325', words: 'polished black granite countertops' },
  { key: 'butcher_block', label: 'Butcher block', swatch: '#b8875a', words: 'butcher block wood countertops' },
  { key: 'laminate', label: 'Laminate', swatch: '#d9d6cf', words: 'light stone-look laminate countertops' },
];

export const BACKSPLASHES: FinishChoice[] = [
  { key: 'none', label: 'None (painted wall)', swatch: '#ece8e1', words: 'no tile backsplash, a painted wall between the countertop and the upper cabinets' },
  { key: 'white_subway', label: 'White subway tile', swatch: '#f4f3ef', words: 'white glossy 3x6 subway tile backsplash' },
  { key: 'gray_subway', label: 'Gray subway tile', swatch: '#b9bcbd', words: 'light gray glossy 3x6 subway tile backsplash' },
  { key: 'marble_slab', label: 'Marble slab', swatch: '#efede9', words: 'full-height white marble slab backsplash' },
];

export const SINKS: FinishChoice[] = [
  { key: 'stainless', label: 'Stainless steel', swatch: '#c3c8cc', words: 'stainless steel undermount sink' },
  { key: 'white_fireclay', label: 'White fireclay', swatch: '#f3f2ee', words: 'white fireclay sink' },
  { key: 'black_composite', label: 'Black composite', swatch: '#2b2b2d', words: 'black granite composite sink' },
];

export const FAUCETS: FinishChoice[] = [
  { key: 'stainless', label: 'Stainless steel', swatch: '#c9cdd0', words: 'stainless steel gooseneck pull-down faucet' },
  { key: 'black', label: 'Matte black', swatch: '#202020', words: 'matte black gooseneck pull-down faucet' },
  { key: 'brass', label: 'Brushed brass', swatch: '#c4a05a', words: 'brushed brass gooseneck pull-down faucet' },
];

/** The hardware's metal; its shape is HARDWARE_STYLES. */
export const HARDWARE: FinishChoice[] = [
  { key: 'nickel', label: 'Brushed nickel', swatch: '#c6c6c1', words: 'brushed nickel' },
  { key: 'black', label: 'Matte black', swatch: '#202020', words: 'matte black' },
  { key: 'brass', label: 'Brushed brass', swatch: '#c4a05a', words: 'brushed brass' },
];

export const HARDWARE_STYLES: FinishChoice[] = [
  { key: 'bar', label: 'Bar pulls', swatch: '#c6c6c1', words: 'bar pulls' },
  { key: 'knob', label: 'Knobs', swatch: '#c6c6c1', words: 'round knobs' },
  { key: 'cup', label: 'Knobs + cup pulls', swatch: '#c6c6c1', words: 'round knobs on the doors and cup pulls on the drawers' },
  // Push-to-open or finger-pull fronts: nothing on the doors and drawers
  { key: 'none', label: 'None (no knobs)', swatch: '#c6c6c1', words: 'no visible hardware (push-to-open)' },
];

export const FLOORS: FinishChoice[] = [
  { key: 'light_oak', label: 'Light oak', swatch: '#c9a77c', words: 'light oak hardwood floor' },
  { key: 'walnut', label: 'Dark walnut', swatch: '#5f4331', words: 'dark walnut hardwood floor' },
  { key: 'gray_tile', label: 'Gray tile', swatch: '#b5b3ae', words: 'large-format light gray porcelain tile floor' },
];

export const DEFAULT_FINISH: CabinetSketchFinish = {
  cabinet_color: 'white',
  door_style: 'shaker',
  countertop: 'white_quartz',
  backsplash: 'white_subway',
  sink: 'stainless',
  faucet: 'stainless',
  hardware: 'nickel',
  hardware_style: 'bar',
  floor: 'light_oak',
};

/** Each finish choice, with the default for one that is missing or no longer offered. */
export function finishOf(saved?: Partial<CabinetSketchFinish> | null): CabinetSketchFinish {
  const known = (choices: FinishChoice[], field: keyof CabinetSketchFinish) => {
    const key = saved?.[field];
    return choices.some((c) => c.key === key) ? (key as string) : DEFAULT_FINISH[field];
  };
  return {
    cabinet_color: known(CABINET_COLORS, 'cabinet_color'),
    door_style: known(DOOR_STYLES, 'door_style'),
    countertop: known(COUNTERTOPS, 'countertop'),
    backsplash: known(BACKSPLASHES, 'backsplash'),
    sink: known(SINKS, 'sink'),
    faucet: known(FAUCETS, 'faucet'),
    hardware: known(HARDWARE, 'hardware'),
    hardware_style: known(HARDWARE_STYLES, 'hardware_style'),
    floor: known(FLOORS, 'floor'),
  };
}

export const choiceOf = <T extends FinishChoice>(choices: T[], key: string): T =>
  choices.find((c) => c.key === key) ?? choices[0];

/** The hardware in words: its metal and shape, or that there is none. */
export function hardwareWords(finish: CabinetSketchFinish): string {
  const style = choiceOf(HARDWARE_STYLES, finish.hardware_style);
  return style.key === 'none' ? style.words : `${choiceOf(HARDWARE, finish.hardware).words} ${style.words}`;
}

/** The finish in words, for the AI photo's prompt. */
export function finishWords(finish: CabinetSketchFinish): string {
  return [
    `${choiceOf(CABINET_COLORS, finish.cabinet_color).words} ${choiceOf(DOOR_STYLES, finish.door_style).words} cabinet doors and drawer fronts`,
    hardwareWords(finish),
    choiceOf(COUNTERTOPS, finish.countertop).words,
    choiceOf(BACKSPLASHES, finish.backsplash).words,
    choiceOf(SINKS, finish.sink).words,
    choiceOf(FAUCETS, finish.faucet).words,
    choiceOf(FLOORS, finish.floor).words,
  ].join(', ');
}
