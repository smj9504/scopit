/**
 * Scopit - PDF Editor: My stamps
 *
 * Picture stamps (a company seal, a PAID stamp, a logo) saved for reuse,
 * kept in localStorage per signed-in user like saved signatures, so a
 * shared browser never offers one person's stamps to another.
 */

export interface SavedStamp {
  id: string;
  name: string;
  /** PNG data URL, background already taken out if that was wanted */
  dataUrl: string;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = 'scopit-stamps';
/** A placed picture stamp fits in this box (page units: 2 inches) */
const STAMP_BOX = 144;

export function stampStorageKey(userId: string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}:${userId || 'anonymous'}`;
}

export function loadStamps(storageKey: string): SavedStamp[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((s) => s && typeof s.dataUrl === 'string' && typeof s.id === 'string')
      : [];
  } catch {
    return [];
  }
}

/** False if the browser refused the write (storage full or blocked) */
export function saveStamps(storageKey: string, stamps: SavedStamp[]): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(stamps));
    return true;
  } catch {
    return false;
  }
}

export function newStampId(): string {
  return `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The size a picture of `w` x `h` pixels is placed at as a stamp */
export function stampSize(w: number, h: number): { width: number; height: number } {
  if (!w || !h) return { width: STAMP_BOX, height: STAMP_BOX };
  const scale = Math.min(STAMP_BOX / w, STAMP_BOX / h);
  return { width: w * scale, height: h * scale };
}
