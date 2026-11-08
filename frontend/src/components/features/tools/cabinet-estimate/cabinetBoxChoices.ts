/**
 * What a cabinet box can be changed to, shared by the Edit tab's box
 * tables and the sketch's right-click panel: its door patterns, the other
 * sizes and specialties of the same cabinet in the catalog, and how one
 * change (a code, a custom size, glass, a pattern) carries through the
 * rest of the box. Pure, so the catalog is passed in.
 */

import type { CabType, DoorPattern, SpecialtyType } from '@/types/cabinetEstimate';

export const PLAIN_DOOR = 'plain';

export interface DoorPatternOption {
  label: string;
  /** What the narrow table cell shows once picked. */
  short: string;
  value: DoorPattern | typeof PLAIN_DOOR;
}

export const DOOR_PATTERN_OPTIONS: DoorPatternOption[] = [
  { label: 'Plain', short: 'Plain', value: PLAIN_DOOR },
  { label: 'Diamond lattice', short: 'Lattice', value: 'lattice' },
  { label: 'Lattice + oval band', short: 'Oval band', value: 'lattice_band' },
  { label: 'Glass with mullions (grid)', short: 'Mullion', value: 'mullion' },
];
/** Mullions hold glass, and only wall and base boxes have a Glass tick. */
export const TALL_DOOR_PATTERN_OPTIONS = DOOR_PATTERN_OPTIONS.filter((o) => o.value !== 'mullion');

/** Boxes with no door to put a pattern or glass in: all drawers, or an open bay. */
export const NO_DOOR_SPECIALTIES: SpecialtyType[] = [
  'drawer_base',
  'trash_pullout',
  'microwave_drawer_base',
  'range_base_slide_in',
  'range_base_drop_in',
];

export const hasDoors = (specialty?: SpecialtyType | null) => !specialty || !NO_DOOR_SPECIALTIES.includes(specialty);
/** Only wall and base boxes take a glass insert (the Edit tab has no Glass column for talls). */
export const takesGlass = (cabType: CabType, specialty?: SpecialtyType | null) =>
  (cabType === 'wall' || cabType === 'base') && hasDoors(specialty);

export interface CatalogEntry {
  cab_type: CabType;
  width: number;
  height: number;
  specialty?: SpecialtyType;
  label: string;
}
export type Catalog = Record<string, CatalogEntry>;

/** A specialty in words: "Sink base", "Lazy susan". */
export const specialtyName = (s: SpecialtyType) => {
  const words = s.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const prefixOf = (code: string) => /^[A-Z]+/.exec(code)?.[0] ?? '';

export interface Choice<T> {
  value: T;
  code: string;
  label: string;
}

/**
 * The catalog codes a box can switch to without becoming another kind of
 * cabinet: other widths at its height, other heights at its width (same
 * specialty, and the same code family — W, B, SB… — where the catalog has
 * one), and the specialties made at its size. Null for a custom box, which
 * is sized by typing.
 */
export function boxChoices(
  code: string,
  catalog: Catalog
): { widths: Choice<number>[]; heights: Choice<number>[]; specialties: Choice<SpecialtyType | null>[] } | null {
  const cur = catalog[code];
  if (!cur) return null;
  const kin = Object.entries(catalog).filter(
    ([, e]) => e.cab_type === cur.cab_type && (e.specialty ?? null) === (cur.specialty ?? null)
  );
  const family = kin.filter(([c]) => prefixOf(c) === prefixOf(code));
  const pool = family.length > 0 ? family : kin;
  const byValue = (entries: [string, CatalogEntry][], pick: (e: CatalogEntry) => number): Choice<number>[] => {
    const seen = new Map<number, string>();
    for (const [c, e] of entries) if (!seen.has(pick(e)) || c === code) seen.set(pick(e), c);
    return Array.from(seen, ([value, c]) => ({ value, code: c, label: `${value}"` })).sort((a, b) => a.value - b.value);
  };
  const widths = byValue(pool.filter(([, e]) => e.height === cur.height), (e) => e.width);
  const heights = byValue(pool.filter(([, e]) => e.width === cur.width), (e) => e.height);

  const sameSize = Object.entries(catalog).filter(
    ([, e]) => e.cab_type === cur.cab_type && e.width === cur.width && e.height === cur.height
  );
  const named = sameSize.map(([c, e]) => ({ value: e.specialty ?? null, code: c, label: e.specialty ? specialtyName(e.specialty) : 'None' }));
  // Two codes with the same specialty at this size say which is which.
  const specialties = named.map((n) =>
    named.filter((m) => m.label === n.label).length > 1 ? { ...n, label: `${n.label} (${n.code})` } : n
  );
  specialties.sort((a, b) => (a.value === null ? -1 : b.value === null ? 1 : a.label.localeCompare(b.label)));
  return { widths, heights, specialties };
}

/**
 * A cabinet kind: one catalog line in all its sizes — the same section,
 * specialty and code family (W, WEA, SB…). Null for a code not in the catalog.
 */
export const kindOf = (code: string, catalog: Catalog): string | null => {
  const e = catalog[code];
  return e ? `${e.cab_type}|${e.specialty ?? ''}|${prefixOf(code)}` : null;
};

const SECTION_NAMES: Partial<Record<CabType, string>> = { base: 'Base', wall: 'Wall', tall: 'Tall' };

/**
 * A kind in words: the label without its sizes ("Angle End Wall 3-Door",
 * "Range Base (Slide-in)"); a plain upper, labelled by size alone, is "Wall".
 */
export function kindName(entry: CatalogEntry): string {
  const name = entry.label
    .replace(/\s*\([^)]*\d"[^)]*\)/g, '') // "(17" door)"
    .replace(/\d+(?:\.\d+)?"\s*[WH]?(?:\s*x\s*\d+(?:\.\d+)?"\s*[WH]?)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || SECTION_NAMES[entry.cab_type] || entry.label;
}

export interface KindOption {
  /** The kind (kindOf). */
  value: string;
  label: string;
  /** The kind's codes in the list, in its order. */
  codes: string[];
}

/**
 * A cabinet list (grouped as in the toolbar picker) as one entry per kind,
 * in the order the kinds first appear: the panel's Cabinet picks the kind
 * and its Width and Height the size, so the sizes aren't listed again.
 */
export function cabinetKinds(groups: { options: { value: string }[] }[], catalog: Catalog): KindOption[] {
  const kinds = new Map<string, KindOption>();
  for (const group of groups) {
    for (const { value: code } of group.options) {
      const kind = kindOf(code, catalog);
      if (!kind) continue;
      const known = kinds.get(kind);
      if (known) known.codes.push(code);
      else kinds.set(kind, { value: kind, label: kindName(catalog[code]), codes: [code] });
    }
  }
  return Array.from(kinds.values());
}

/**
 * The code a box takes when its kind is picked: at the box's height if the
 * kind is made in it, or else at the kind's main height (the one most of its
 * codes have, the nearer of a tie) — a 30" upper turned into a Wall on the
 * 36" list is a 36" one, not a 27" short one — with the nearest width.
 */
export function codeForKind(
  codes: string[],
  size: { width_inches: number; height_inches: number },
  catalog: Catalog
): string {
  const count = new Map<number, number>();
  for (const c of codes) count.set(catalog[c].height, (count.get(catalog[c].height) ?? 0) + 1);
  const height = count.has(size.height_inches)
    ? size.height_inches
    : Array.from(count).reduce((best, h) =>
        h[1] > best[1] ||
        (h[1] === best[1] && Math.abs(h[0] - size.height_inches) < Math.abs(best[0] - size.height_inches))
          ? h
          : best
      )[0];
  const atHeight = codes.filter((c) => catalog[c].height === height);
  const off = (c: string) => Math.abs(catalog[c].width - size.width_inches);
  return atHeight.reduce((best, c) => (off(c) < off(best) ? c : best));
}

/** The fields of a box a change touches. */
export interface BoxFields {
  code: string;
  cab_type: CabType;
  width_inches: number;
  height_inches: number;
  is_specialty: boolean;
  specialty_type: SpecialtyType | null;
  has_glass_door: boolean;
  door_pattern: DoorPattern | null;
  range_panel_count?: number | null;
}

/** One change to a box: another catalog code, a custom size, glass, a door pattern, or a slide-in range's panels. */
export interface BoxChange {
  code?: string;
  width?: number;
  height?: number;
  has_glass_door?: boolean;
  door_pattern?: DoorPattern | null;
  /** Finished end panels beside a slide-in range's opening, 0–2. */
  range_panel_count?: number;
}

/**
 * The box after one change, the way the Edit tab makes it: a new code
 * brings its size and specialty (and drops glass and pattern if it has no
 * door); a custom size makes it a CUSTOM box with no specialty; mullions
 * bring their glass, and taking the glass out takes the mullions with it.
 */
export function changedBox(box: BoxFields, change: BoxChange, catalog: Catalog): BoxFields {
  let next = { ...box };
  if (change.code !== undefined) {
    const preset = catalog[change.code];
    if (preset) {
      next = {
        ...next,
        code: change.code,
        cab_type: preset.cab_type,
        width_inches: preset.width,
        height_inches: preset.height,
        is_specialty: !!preset.specialty,
        specialty_type: preset.specialty ?? null,
        range_panel_count: preset.specialty === 'range_base_slide_in' ? 2 : null,
      };
    }
  }
  if (change.width !== undefined || change.height !== undefined) {
    next = {
      ...next,
      code: 'CUSTOM',
      width_inches: change.width ?? next.width_inches,
      height_inches: change.height ?? next.height_inches,
      is_specialty: false,
      specialty_type: null,
      range_panel_count: null,
    };
  }
  // Only a slide-in range has panels.
  if (change.range_panel_count !== undefined && next.specialty_type === 'range_base_slide_in') {
    next.range_panel_count = change.range_panel_count;
  }
  if (change.has_glass_door !== undefined) {
    next.has_glass_door = change.has_glass_door;
    if (!change.has_glass_door && next.door_pattern === 'mullion') next.door_pattern = null;
  }
  if (change.door_pattern !== undefined) {
    next.door_pattern = change.door_pattern;
    if (change.door_pattern === 'mullion') next.has_glass_door = true;
  }
  if (!hasDoors(next.specialty_type)) {
    next.has_glass_door = false;
    next.door_pattern = null;
  } else if (!takesGlass(next.cab_type, next.specialty_type)) {
    next.has_glass_door = false;
    if (next.door_pattern === 'mullion') next.door_pattern = null;
  }
  return next;
}
