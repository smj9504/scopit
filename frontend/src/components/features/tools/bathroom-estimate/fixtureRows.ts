/**
 * Lights and wall cabinets, kind by kind.
 *
 * A bathroom can have a 3-light bar over the vanity, recessed cans and a
 * sconce or two; a mirrored medicine cabinet and a wall cabinet over the
 * toilet. Each kind is a row on the estimate (electrical_spec.lights,
 * accessories_spec.cabinets) and a line of its own when priced
 * (backend lights.py / cabinets.py).
 *
 * Rows come from the plan — every light or cabinet drawn on it — or are typed
 * on the estimate page. A kind drawn on the plan takes over the typed rows of
 * that kind; a typed row of a kind the plan doesn't have stays.
 */

import type { BECabinetType, BEDimensions, BEFixture, BELightType } from '@/types/bathroomSketch';

export type ItemAction = 'replace' | 'detach_reset';

export interface FixtureRow {
  type: string;
  count: number;
  /** A vanity bar's lights ("3-light") */
  bulbs?: number | null;
  action?: ItemAction;
  /** Counted from the plan: its type and count change there, not on the estimate */
  from_sketch?: boolean;
}

// ── Lights ──

export type LightKind = 'vanity_bar' | 'sconce' | 'ceiling' | 'pendant' | 'recessed';

export interface KindInfo<T extends string> {
  value: T;
  label: string;
}

export const LIGHT_KINDS: (KindInfo<LightKind> & { mount: 'wall' | 'ceiling'; sketchType: BELightType })[] = [
  { value: 'vanity_bar', label: 'Vanity light bar', mount: 'wall', sketchType: 'vanity_bar' },
  { value: 'sconce', label: 'Wall sconce', mount: 'wall', sketchType: 'sconce' },
  { value: 'ceiling', label: 'Ceiling fixture', mount: 'ceiling', sketchType: 'standard' },
  { value: 'pendant', label: 'Pendant', mount: 'ceiling', sketchType: 'pendant' },
  { value: 'recessed', label: 'Recessed can', mount: 'ceiling', sketchType: 'recessed' },
];

/** The kind of light a plan fixture is ("standard" is a ceiling fixture; one of several cans is a can) */
export function lightKindOf(lightType?: BELightType | string | null): LightKind {
  if (!lightType || lightType === 'standard') return 'ceiling';
  if (lightType === 'recessed_multi') return 'recessed';
  return (LIGHT_KINDS.some((k) => k.value === lightType) ? lightType : 'ceiling') as LightKind;
}

export function isWallLight(lightType?: BELightType | string | null): boolean {
  return LIGHT_KINDS.find((k) => k.value === lightKindOf(lightType))!.mount === 'wall';
}

export const DEFAULT_BAR_BULBS = 3;

/** Plan size of a light: a bar about 8" a light along the wall, a sconce, a can, a fixture */
export function lightPlanSize(lightType?: BELightType | string | null, bulbs?: number | null): BEDimensions {
  switch (lightKindOf(lightType)) {
    case 'vanity_bar': return { width: Math.max(6, 8 * (bulbs || DEFAULT_BAR_BULBS)), height: 5 };
    case 'sconce': return { width: 6, height: 5 };
    case 'recessed': return { width: 6, height: 6 };
    case 'pendant': return { width: 12, height: 12 };
    default: return { width: 12, height: 12 };
  }
}

/** "3-light vanity bar", "Recessed can"… */
export function lightRowName(row: Pick<FixtureRow, 'type' | 'bulbs'>): string {
  const kind = LIGHT_KINDS.find((k) => k.value === row.type);
  if (row.type === 'vanity_bar' && row.bulbs) return `${row.bulbs}-light vanity bar`;
  return kind?.label ?? row.type;
}

// ── Cabinets ──

export const CABINET_KINDS: (KindInfo<BECabinetType> & { size: BEDimensions; heightIn: number; mirrored: boolean })[] = [
  { value: 'medicine_cabinet', label: 'Medicine cabinet, mirrored', size: { width: 24, height: 5 }, heightIn: 30, mirrored: true },
  { value: 'medicine_cabinet_recessed', label: 'Medicine cabinet, mirrored, recessed', size: { width: 16, height: 4 }, heightIn: 26, mirrored: true },
  { value: 'wall_cabinet', label: 'Wall cabinet', size: { width: 24, height: 8 }, heightIn: 30, mirrored: false },
];

export function cabinetKind(type?: string | null) {
  return CABINET_KINDS.find((k) => k.value === type) ?? CABINET_KINDS[0];
}

// ── From the plan ──

const order = (kinds: { value: string }[], t: string) => {
  const i = kinds.findIndex((k) => k.value === t);
  return i < 0 ? kinds.length : i;
};

function group(keys: { type: string; bulbs?: number | null }[], kinds: { value: string }[]): FixtureRow[] {
  const rows = new Map<string, FixtureRow>();
  for (const k of keys) {
    const id = `${k.type}|${k.bulbs ?? ''}`;
    const row = rows.get(id);
    if (row) row.count += 1;
    else rows.set(id, { type: k.type, count: 1, ...(k.bulbs ? { bulbs: k.bulbs } : {}), from_sketch: true });
  }
  return [...rows.values()].sort((a, b) => order(kinds, a.type) - order(kinds, b.type) || (a.bulbs ?? 0) - (b.bulbs ?? 0));
}

/** Each light on the plan, by kind; a vanity bar by its number of lights */
export function lightsFromSketch(fixtures: BEFixture[]): FixtureRow[] {
  return group(
    fixtures
      .filter((f) => f.type === 'light')
      .map((f) => {
        const type = lightKindOf(f.properties.lightType);
        return { type, bulbs: type === 'vanity_bar' ? (f.properties.lightBulbs || DEFAULT_BAR_BULBS) : null };
      }),
    LIGHT_KINDS,
  );
}

export function cabinetsFromSketch(fixtures: BEFixture[]): FixtureRow[] {
  return group(
    fixtures.filter((f) => f.type === 'cabinet').map((f) => ({ type: cabinetKind(f.properties.cabinetType).value })),
    CABINET_KINDS,
  );
}

/**
 * The estimate's rows after the plan changed: the plan's rows (each keeping
 * the New / D&R it had, or a typed row of its kind had), then the typed rows
 * of kinds the plan doesn't have.
 */
export function mergeFromSketch(current: FixtureRow[] | null | undefined, fromSketch: FixtureRow[]): FixtureRow[] {
  const rows = current ?? [];
  const drawn = new Set(fromSketch.map((r) => r.type));
  const actionFor = (r: FixtureRow): ItemAction =>
    rows.find((c) => c.from_sketch && c.type === r.type && (c.bulbs ?? null) === (r.bulbs ?? null))?.action
    ?? rows.find((c) => c.type === r.type)?.action
    ?? 'replace';
  return [
    ...fromSketch.map((r) => ({ ...r, action: actionFor(r) })),
    ...rows.filter((c) => !c.from_sketch && !drawn.has(c.type)),
  ];
}

// ── Estimates saved before the rows ──

/**
 * The light rows of an estimate saved with one vanity light (the
 * replace / D&R flags) and one ceiling light (electrical_spec.ceiling_fixture),
 * priced the same way they were; null when it has its rows already.
 */
export function lightsFromLegacy(est: Record<string, any>): FixtureRow[] | null {
  const elec = est.electrical_spec || {};
  if (Array.isArray(elec.lights)) return null;
  const rows: FixtureRow[] = [];
  const vanity = Number(elec.vanity_lights) || 0;
  if (est.replace_vanity_light) rows.push({ type: 'vanity_bar', count: vanity || 1, action: 'replace' });
  else if (est.detach_reset_vanity_light) rows.push({ type: 'vanity_bar', count: vanity || 1, action: 'detach_reset' });
  else if (vanity > 0) rows.push({ type: 'vanity_bar', count: vanity, action: 'replace' });
  const ceiling = elec.ceiling_fixture;
  if (ceiling === 'recessed_multi') rows.push({ type: 'recessed', count: Number(elec.recessed_can_count) || 4, action: 'replace' });
  else if (ceiling === 'recessed') rows.push({ type: 'recessed', count: 1, action: 'replace' });
  else if (ceiling) rows.push({ type: 'ceiling', count: 1, action: 'replace' });
  return rows;
}

/** `est` with its lights as rows and the old light fields gone (they'd be ignored next to the rows) */
export function withLightRows(est: Record<string, any>): Record<string, any> {
  const rows = lightsFromLegacy(est);
  if (!rows) return est;
  const { ceiling_fixture: _c, recessed_can_count: _n, vanity_lights: _v, ...elec } = est.electrical_spec || {};
  return {
    ...est,
    replace_vanity_light: false,
    detach_reset_vanity_light: false,
    electrical_spec: { ...elec, lights: rows },
  };
}
