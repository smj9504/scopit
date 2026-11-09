/**
 * Dates on this site are calendar dates (YYYY-MM-DD) in the Eastern time zone,
 * where all three jurisdictions are. License expiry and "verified on" dates are
 * compared as strings in this format.
 */
export const SITE_TIME_ZONE = 'America/New_York';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in the site's time zone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A YYYY-MM-DD string from a Date that came from front matter (UTC midnight). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "November 9, 2026" from YYYY-MM-DD or a front-matter Date. */
export function formatDate(value: string | Date): string {
  const iso = typeof value === 'string' ? value : toIsoDate(value);
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/** "Nov 9, 2026" */
export function formatDateShort(value: string | Date): string {
  const iso = typeof value === 'string' ? value : toIsoDate(value);
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
