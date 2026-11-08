/**
 * A real kitchen plan, drawn in the Cabinet Estimator's Sketch tab for an
 * insurance job (the address is left out). Generated from the saved sketch
 * with the app's own layout helpers (corner footprints, the island top, the
 * sink layout, where each wall's length goes), so it matches the plan the
 * app draws. Units are sketch pixels: 20 = 1 ft.
 */

export interface PlanCabinet {
  t: 'base' | 'tall' | 'wall';
  /** Back-left corner and turn, as on the canvas; the door side faces local +y. */
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  /** A corner unit's own outline (flat x, y list), when it isn't a box. */
  o?: number[];
  /** The door side. */
  f: number[];
  glass?: boolean;
  pattern?: boolean;
  label?: { text: string; x: number; y: number; flip: boolean };
}

export interface PlanAppliance {
  code: string;
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  burners: boolean;
  roomy: boolean;
  labelY: number;
  flip: boolean;
}

export interface PlanWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  /** Length, feet. */
  len: number;
  lx: number;
  ly: number;
  lr: number;
}

/** Label size, plan units (the app's 11px label). */
export const PLAN_LABEL = 8.5;
/** The app's pixel in plan units, for label offsets. */
export const PLAN_PX = 0.773;

export const PLAN_FRAME = {x: 116, y: 80.3, w: 348.9, h: 434.8};
export const PLAN_GRID = 20;

export const PLAN_WALLS: PlanWall[] = [
  {x1: 398.4,y1: 388,x2: 398.4,y2: 431.1, t: 4, len: 2.2, lx: 409.2, ly: 409.6, lr: 90},
  {x1: 398.4,y1: 431.1,x2: 294,y2: 431.1, t: 4, len: 5.2, lx: 346.2, ly: 441.9, lr: 360},
  {x1: 336.6,y1: 387.1,x2: 336.6,y2: 431.1, t: 4, len: 2.2, lx: 347.4, ly: 409.1, lr: 90},
  {x1: 336.6,y1: 431.1,x2: 336.6,y2: 475.1, t: 4, len: 2.2, lx: 347.4, ly: 453.1, lr: 90},
  {x1: 336.6,y1: 475.1,x2: 294.4,y2: 475.1, t: 4, len: 2.1, lx: 315.5, ly: 485.9, lr: 360},
  {x1: 425,y1: 120.3,x2: 425,y2: 163.1, t: 4, len: 2.1, lx: 435.8, ly: 141.7, lr: 90},
  {x1: 156,y1: 121,x2: 425,y2: 120.3, t: 4, len: 13.4, lx: 290.5, ly: 109.8, lr: -0.1},
  {x1: 156,y1: 121,x2: 156.4,y2: 358.8, t: 4, len: 11.9, lx: 145.4, ly: 239.9, lr: 89.9},
  {x1: 156.4,y1: 358.8,x2: 218.2,y2: 359, t: 4, len: 3.1, lx: 187.3, ly: 369.7, lr: 0.2},
  {x1: 260.5,y1: 430.8,x2: 156.7,y2: 430.8, t: 4, len: 5.2, lx: 208.6, ly: 441.6, lr: 360},
  {x1: 218.2,y1: 434.6,x2: 218.2,y2: 474.6, t: 4, len: 2, lx: 207.4, ly: 454.6, lr: 90},
  {x1: 218.2,y1: 474.6,x2: 261.5,y2: 474.6, t: 4, len: 2.2, lx: 239.9, ly: 485.4, lr: 0},
];

export const PLAN_ISLAND_TOP: number[][] = [
  [278.1,297.5,278.1,235,423.1,235,423.1,297.5],
];

export const PLAN_CABINETS: PlanCabinet[] = [
  {t: 'base', x: 218, y: 123, r: 0, w: 20, h: 40, f: [0,40,20,40], label: {text: 'B12', x: 10, y: 31.9, flip: false}},
  {t: 'base', x: 278, y: 123, r: 0, w: 60, h: 40, f: [0,40,60,40], label: {text: 'SB36', x: 30, y: 31.9, flip: false}},
  {t: 'base', x: 158, y: 123, r: 0, w: 60, h: 60, o: [0,0,60,0,60,40,40,40,40,60,0,60], f: [60,40,40,40,40,60], label: {text: 'LS36', x: 30, y: 31.9, flip: false}},
  {t: 'tall', x: 158, y: 298, r: 270, w: 55, h: 40, f: [0,40,55,40], label: {text: 'OC3390', x: 27.5, y: 31.9, flip: false}},
  {t: 'base', x: 338, y: 123, r: 0, w: 25, h: 40, f: [0,40,25,40], label: {text: 'B15', x: 12.5, y: 31.9, flip: false}},
  {t: 'base', x: 363, y: 123, r: 0, w: 60, h: 40, f: [0,40,60,40], label: {text: 'B36', x: 30, y: 31.9, flip: false}},
  {t: 'wall', x: 158, y: 243, r: 270, w: 60, h: 20, f: [0,20,60,20], label: {text: 'W3636', x: 30, y: 5.8, flip: false}},
  {t: 'base', x: 158, y: 243, r: 270, w: 60, h: 40, f: [0,40,60,40], label: {text: 'B36', x: 30, y: 31.9, flip: false}},
  {t: 'wall', x: 158, y: 183, r: 270, w: 20, h: 20, f: [0,20,20,20]},
  {t: 'wall', x: 158, y: 123, r: 0, w: 40, h: 40, o: [0,0,40,0,40,20,20,40,0,40], f: [40,20,20,40]},
  {t: 'wall', x: 198, y: 123, r: 0, w: 20, h: 20, f: [0,20,20,20]},
  {t: 'wall', x: 218, y: 123, r: 0, w: 20, h: 20, o: [0,0,20,0,20,11.7,11.7,20,0,20], f: [0,20,11.7,20,20,11.7,20,0]},
  {t: 'wall', x: 422.8, y: 123.5, r: 90, w: 20, h: 20, o: [0,0,20,0,20,11.7,11.7,20,0,20], f: [0,20,11.7,20,20,11.7,20,0]},
  {t: 'base', x: 390.6, y: 277.5, r: -180, w: 25, h: 40, f: [0,40,25,40]},
  {t: 'base', x: 420.6, y: 277.5, r: -180, w: 30, h: 40, f: [0,40,30,40], label: {text: 'B18', x: 15, y: 31.9, flip: true}},
  {t: 'base', x: 365.6, y: 277.5, r: -180, w: 55, h: 40, f: [0,40,55,40], label: {text: 'B33', x: 27.5, y: 31.9, flip: true}},
  {t: 'base', x: 310.6, y: 277.5, r: -180, w: 30, h: 40, f: [0,40,30,40], label: {text: 'DB18', x: 15, y: 31.9, flip: true}},
  {t: 'base', x: 398, y: 428.8, r: 180, w: 60, h: 40, f: [0,40,60,40], label: {text: 'B36', x: 30, y: 31.9, flip: true}},
  {t: 'wall', x: 398, y: 428.8, r: 180, w: 60, h: 20, f: [0,20,60,20], label: {text: 'W3636', x: 30, y: 5.8, flip: true}},
  {t: 'base', x: 220.2, y: 473.1, r: -90, w: 40, h: 40, f: [0,40,40,40], label: {text: 'B24', x: 20, y: 31.9, flip: false}},
  {t: 'base', x: 334.4, y: 433.4, r: 90, w: 40, h: 40, f: [0,40,40,40], label: {text: 'B24', x: 20, y: 31.9, flip: false}},
  {t: 'wall', x: 220.2, y: 473.1, r: -90, w: 40, h: 20, f: [0,20,40,20], glass: true, pattern: true, label: {text: 'W2436', x: 20, y: 5.8, flip: false}},
  {t: 'wall', x: 334.4, y: 433.4, r: 90, w: 40, h: 20, f: [0,20,40,20], glass: true, pattern: true, label: {text: 'W2436', x: 20, y: 5.8, flip: false}},
  {t: 'tall', x: 158, y: 358, r: 270, w: 60, h: 40, f: [0,40,60,40], pattern: true, label: {text: 'RC3690', x: 30, y: 31.9, flip: false}},
];

export const PLAN_SINKS = [
  {x: 278, y: 123, r: 0, rim: [5,6.7,50,30], bowls: [[7.1,8.8,45.8,25.8]], faucet: [30,4.2], k: 1.7},
];

export const PLAN_APPLIANCES: PlanAppliance[] = [
  {code: 'REF', x: 158, y: 358, r: 270, w: 60, h: 50, burners: false, roomy: true,labelY: 27.5, flip: false},
  {code: 'CT', x: 363.7, y: 275.1, r: 180, w: 50, h: 35, burners: true, roomy: true,labelY: 19.3, flip: true},
  {code: 'DW', x: 238, y: 123, r: 0, w: 40, h: 40, burners: false, roomy: true,labelY: 22, flip: false},
  {code: 'OVEN', x: 158, y: 298, r: 270, w: 55, h: 40, burners: false, roomy: true,labelY: 22, flip: false},
];
