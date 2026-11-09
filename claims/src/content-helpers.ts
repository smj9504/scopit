import { getCollection, type CollectionEntry } from 'astro:content';
import { toIsoDate } from './shared/dates';

export type Guide = CollectionEntry<'guides'>;
export type Note = CollectionEntry<'notes'>;
export type Adjuster = CollectionEntry<'adjusters'>;

export function guidePath(guide: Guide): string {
  return guide.data.permalink ?? `/guides/${guide.id}/`;
}

export function notePath(note: Note): string {
  return `/for-adjusters/notes/${note.id}/`;
}

export function guideOgImage(guide: Guide): string {
  return `/og/guides/${guide.id}.png`;
}

export function noteOgImage(note: Note): string {
  return `/og/notes/${note.id}.png`;
}

export async function getGuides(): Promise<Guide[]> {
  const all = await getCollection('guides');
  return all.sort((a, b) => a.data.order - b.data.order);
}

export async function getNotes(): Promise<Note[]> {
  const all = await getCollection('notes');
  return all.sort((a, b) => a.data.order - b.data.order);
}

export async function getAdjusters(): Promise<Adjuster[]> {
  const all = await getCollection('adjusters');
  return all.sort((a, b) =>
    a.data.businessName.localeCompare(b.data.businessName, 'en', { sensitivity: 'base' }),
  );
}

/** Placeholder and draft pages are noindexed and left out of the sitemap. */
export function isIndexable(entry: { data: { status: string } }): boolean {
  return entry.data.status === 'published';
}

export function iso(date: Date): string {
  return toIsoDate(date);
}

/** Two-digit row number: 1 -> "01". */
export function rowNumber(i: number): string {
  return String(i + 1).padStart(2, '0');
}
