import { describe, it, expect } from 'vitest';
import { CABINET_PRESETS } from '@/components/features/tools/cabinet-estimate/CabinetBoxEditor';
import { boxChoices, cabinetKinds, changedBox, codeForKind, kindName, kindOf, type BoxFields } from '@/components/features/tools/cabinet-estimate/cabinetBoxChoices';
import { getOptionsForType } from '@/components/features/tools/cabinet-estimate/CabinetBoxEditor';

const box = (code: string, over: Partial<BoxFields> = {}): BoxFields => {
  const p = CABINET_PRESETS[code];
  return {
    code,
    cab_type: p?.cab_type ?? 'base',
    width_inches: p?.width ?? 30,
    height_inches: p?.height ?? 34.5,
    is_specialty: !!p?.specialty,
    specialty_type: p?.specialty ?? null,
    has_glass_door: false,
    door_pattern: null,
    ...over,
  };
};

describe('boxChoices', () => {
  it('lists an upper\'s other widths at its height and other heights at its width, in its own family', () => {
    const c = boxChoices('W3036', CABINET_PRESETS)!;
    expect(c.widths.map((w) => w.value)).toContain(36);
    expect(c.widths.find((w) => w.value === 36)!.code).toBe('W3636');
    expect(c.widths.every((w) => CABINET_PRESETS[w.code].height === 36 && w.code.startsWith('W'))).toBe(true);
    expect(c.heights.map((h) => h.value)).toEqual(expect.arrayContaining([30, 36, 42]));
    expect(c.heights.find((h) => h.value === 42)!.code).toBe('W3042');
    // Sorted, and the box's own code stands for its own size.
    expect(c.widths.map((w) => w.value)).toEqual([...c.widths.map((w) => w.value)].sort((a, b) => a - b));
    expect(c.widths.find((w) => w.value === 30)!.code).toBe('W3036');
  });

  it('offers the specialties made at a base\'s size, None first', () => {
    const c = boxChoices('B36', CABINET_PRESETS)!;
    expect(c.specialties[0]).toMatchObject({ value: null, label: 'None', code: 'B36' });
    const sink = c.specialties.find((s) => s.value === 'sink_base');
    expect(sink?.code).toBe('SB36');
    expect(sink?.label).toBe('Sink base');
    // Every one is the same size.
    for (const s of c.specialties) {
      expect(CABINET_PRESETS[s.code].width).toBe(36);
      expect(CABINET_PRESETS[s.code].cab_type).toBe('base');
    }
  });

  it('keeps a specialty when changing size: a sink base\'s widths are sink bases', () => {
    const c = boxChoices('SB36', CABINET_PRESETS)!;
    expect(c.widths.length).toBeGreaterThan(1);
    expect(c.widths.every((w) => CABINET_PRESETS[w.code].specialty === 'sink_base')).toBe(true);
  });

  it('has none for a custom box', () => {
    expect(boxChoices('CUSTOM', CABINET_PRESETS)).toBeNull();
  });
});

describe('changedBox', () => {
  it('takes a new code\'s size and specialty, keeping glass and pattern', () => {
    const next = changedBox(box('B36', { has_glass_door: true, door_pattern: 'lattice' }), { code: 'SB36' }, CABINET_PRESETS);
    expect(next).toMatchObject({ code: 'SB36', specialty_type: 'sink_base', is_specialty: true, has_glass_door: true, door_pattern: 'lattice' });
  });

  it('drops glass and pattern on a box with no door', () => {
    const next = changedBox(box('B24', { has_glass_door: true, door_pattern: 'lattice' }), { code: 'DB24' }, CABINET_PRESETS);
    expect(next).toMatchObject({ specialty_type: 'drawer_base', has_glass_door: false, door_pattern: null });
  });

  it('makes a typed size a custom box with no specialty', () => {
    const next = changedBox(box('SB36'), { width: 34 }, CABINET_PRESETS);
    expect(next).toMatchObject({ code: 'CUSTOM', width_inches: 34, height_inches: 34.5, specialty_type: null, is_specialty: false });
  });

  it('ties mullions to their glass', () => {
    const withMullions = changedBox(box('W3036'), { door_pattern: 'mullion' }, CABINET_PRESETS);
    expect(withMullions).toMatchObject({ door_pattern: 'mullion', has_glass_door: true });
    expect(changedBox(withMullions, { has_glass_door: false }, CABINET_PRESETS)).toMatchObject({ door_pattern: null, has_glass_door: false });
    // A lattice keeps its pattern without glass.
    const lattice = changedBox(box('W3036', { has_glass_door: true }), { door_pattern: 'lattice' }, CABINET_PRESETS);
    expect(changedBox(lattice, { has_glass_door: false }, CABINET_PRESETS).door_pattern).toBe('lattice');
  });

  it('gives a tall no glass and no mullions', () => {
    const next = changedBox(box('T2484'), { door_pattern: 'mullion' }, CABINET_PRESETS);
    expect(next).toMatchObject({ has_glass_door: false, door_pattern: null });
    expect(changedBox(box('T2484'), { door_pattern: 'lattice' }, CABINET_PRESETS).door_pattern).toBe('lattice');
  });

  it('sets a slide-in range base\'s panels', () => {
    const next = changedBox(box('B30'), { code: 'RB30S' }, CABINET_PRESETS);
    expect(next.range_panel_count).toBe(2);
  });

  it('changes a slide-in range\'s panels, and gives no other box any', () => {
    expect(changedBox(box('RB30S', { range_panel_count: 2 }), { range_panel_count: 1 }, CABINET_PRESETS).range_panel_count).toBe(1);
    expect(changedBox(box('RB30S', { range_panel_count: 2 }), { range_panel_count: 0 }, CABINET_PRESETS).range_panel_count).toBe(0);
    expect(changedBox(box('B30', { range_panel_count: null }), { range_panel_count: 1 }, CABINET_PRESETS).range_panel_count).toBeNull();
  });
});

describe('cabinet kinds', () => {
  it('names a kind by its label without the sizes', () => {
    const name = (code: string) => kindName(CABINET_PRESETS[code]);
    expect(name('WEA3D1236')).toBe('Angle End Wall 3-Door');
    expect(name('WEA2D1230')).toBe('Angle End Wall 2-Door');
    expect(name('WTD3036')).toBe('3-Door End Corner');
    expect(name('WDC24')).toBe('Diagonal Corner');
    expect(name('RB30S')).toBe('Range Base (Slide-in)');
    expect(name('T1884')).toBe('Tall');
    expect(name('SB36')).toBe('Sink Base');
    expect(name('W3036')).toBe('Wall');
  });

  it('lists each kind once, its codes kept for the size pick', () => {
    const kinds = cabinetKinds(getOptionsForType('wall', 'all'), CABINET_PRESETS);
    const labels = kinds.map((k) => k.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe('Wall');
    expect(labels).toEqual(
      expect.arrayContaining(['Angle End Wall', 'Angle End Wall 2-Door', 'Angle End Wall 3-Door', 'Blind Corner Wall'])
    );
    const three = kinds.find((k) => k.label === 'Angle End Wall 3-Door')!;
    expect(three.value).toBe(kindOf('WEA3D2742', CABINET_PRESETS));
    expect(three.codes).toHaveLength(18);
    // The custom-size entry isn't a kind.
    expect(kinds.every((k) => k.codes.every((c) => CABINET_PRESETS[c]))).toBe(true);
  });

  it('keeps one-door, two-door and three-door angle ends apart', () => {
    const k = (c: string) => kindOf(c, CABINET_PRESETS);
    expect(new Set([k('WEA1236'), k('WEA2D1236'), k('WEA3D1236')]).size).toBe(3);
    expect(k('WEA3D1236')).toBe(k('WEA3D2730'));
    expect(k('CUSTOM')).toBeNull();
  });

  it("picks the kind at the box's size, or the nearest one at its height", () => {
    const kinds = cabinetKinds(getOptionsForType('wall', 'all'), CABINET_PRESETS);
    const codes = (label: string) => kinds.find((o) => o.label === label)!.codes;
    const size = (code: string) => box(code);
    expect(codeForKind(codes('Blind Corner Wall'), size('W3036'), CABINET_PRESETS)).toBe('WBC3036');
    expect(codeForKind(codes('Angle End Wall 3-Door'), size('W3036'), CABINET_PRESETS)).toBe('WEA3D2736');
    expect(codeForKind(codes('Angle End Wall 3-Door'), size('W1542'), CABINET_PRESETS)).toBe('WEA3D1542');
    expect(codeForKind(codes('Wall'), size('WEA3D2136'), CABINET_PRESETS)).toBe('W2136');
    // Made only 18" high: its own height, whatever the box's.
    expect(codeForKind(codes('OTR Microwave'), size('W3030'), CABINET_PRESETS)).toBe('WMW30');
    // A short upper's height is kept where the kind has it.
    expect(codeForKind(codes('Wall'), size('WRD36'), CABINET_PRESETS)).toBe('W3624');
    // Not made at the box's height: the main height, the nearer of a tie.
    const doubleOven = Object.keys(CABINET_PRESETS).filter((c) => c.startsWith('DOC'));
    expect(codeForKind(doubleOven, size('T3696'), CABINET_PRESETS)).toBe('DOC3390');
  });

  it("keeps an upper on the height filter's list", () => {
    const kinds = cabinetKinds(getOptionsForType('wall', 36), CABINET_PRESETS);
    const wall = kinds.find((o) => o.label === 'Wall')!;
    // Short uppers (over a fridge or microwave) stay on every filter.
    expect(wall.codes.every((c) => [36, 12, 15, 18, 24, 27].includes(CABINET_PRESETS[c].height))).toBe(true);
    expect(wall.codes).not.toContain('W3030');
    expect(codeForKind(wall.codes, box('W3030'), CABINET_PRESETS)).toBe('W3036');
  });
});
