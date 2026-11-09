import type { DatabaseSync } from 'node:sqlite';

/** Inserts a listing directly (test data only). */
export function seedListing(
  raw: DatabaseSync,
  opts: {
    id: string;
    slug: string | null;
    status?: string;
    name?: string;
    email?: string;
    licenses: { state: string; number?: string; expires: string; verified: string | null }[];
  },
) {
  const now = '2026-11-01T00:00:00.000Z';
  raw
    .prepare(
      `INSERT INTO listings (id, slug, status, business_name, contact_name, email, phone, website, office_city, office_state,
         loss_types, bio, terms_version, agreements, agreed_at, created_at, updated_at, approved_on)
       VALUES (?, ?, ?, ?, 'Test Contact', ?, '7035550100', NULL, 'Testville', 'VA', '["water"]', 'Test bio for a test listing.',
         'test', '{}', ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.slug,
      opts.status ?? 'verified',
      opts.name ?? `Test ${opts.id}`,
      opts.email ?? `${opts.id}@example.test`,
      now,
      now,
      now,
      (opts.status ?? 'verified') === 'verified' ? '2026-11-01' : null,
    );
  for (const l of opts.licenses) {
    raw
      .prepare('INSERT INTO listing_licenses (listing_id, state, license_number, expires_on, verified_on) VALUES (?, ?, ?, ?, ?)')
      .run(opts.id, l.state, l.number ?? `${l.state}-123`, l.expires, l.verified);
  }
}
