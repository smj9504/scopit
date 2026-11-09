/**
 * Simple per-IP rate limit stored in D1. Turnstile is the main spam control;
 * this only caps repeated submissions from one address.
 */
import type { D1Like } from './d1';

export const RATE_LIMITS = {
  inquiry: { max: 5, windowMinutes: 60 },
  apply: { max: 3, windowMinutes: 60 },
  newsletter: { max: 5, windowMinutes: 60 },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

/** Records the attempt and returns false if the address is over its limit. */
export async function allowRequest(db: D1Like, bucket: RateBucket, ipHash: string, now: Date = new Date()): Promise<boolean> {
  const { max, windowMinutes } = RATE_LIMITS[bucket];
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND ip_hash = ? AND created_at > ?')
    .bind(bucket, ipHash, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= max) return false;

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO rate_events (bucket, ip_hash, created_at) VALUES (?, ?, ?)').bind(bucket, ipHash, now.toISOString()),
    db.prepare('DELETE FROM rate_events WHERE created_at < ?').bind(dayAgo),
  ]);
  return true;
}
