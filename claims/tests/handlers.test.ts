import { describe, expect, it, beforeEach } from 'vitest';
import { handleApply, handleInquiry, handleNewsletter } from '../src/server/handlers';
import type { Env } from '../src/server/env';
import { INQUIRY_CONSENT } from '../src/shared/constants';
import { createTestDb } from './helpers/d1-shim';
import { createFakeFetch } from './helpers/fake-fetch';
import { seedListing } from './helpers/seed';

const ORIGIN = 'https://claims.scopit.work';
const NOW = new Date('2026-11-09T15:00:00Z');

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

let db: ReturnType<typeof createTestDb>;
let env: Env;
let ids: number;

beforeEach(() => {
  db = createTestDb();
  env = {
    DB: db,
    CLAIMS_ENV: 'production',
    CLAIMS_SITE: ORIGIN,
    TURNSTILE_SECRET_KEY: 'secret',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Scopit Claims <claims@send.scopit.work>',
    ADMIN_NOTIFY_EMAIL: 'admin@scopit.test',
    BUTTONDOWN_API_KEY: 'bd_test',
    IP_HASH_SALT: 'salt',
  };
  ids = 0;
});

const deps = (f: ReturnType<typeof createFakeFetch>) => ({ now: NOW, fetch: f.fetch, newId: () => `id-${++ids}` });

const inquiry = {
  name: 'Jordan Homeowner',
  email: 'jordan@example.com',
  phone: '703-555-0199',
  location: 'Arlington',
  propertyState: 'VA',
  lossType: 'water',
  repairStatus: 'done',
  message: 'Pipe burst in the basement two weeks ago and the plumber already fixed it.',
  adjusters: ['va-adjuster'],
  consent: 'yes',
  'cf-turnstile-response': 'token',
};

describe('POST /api/inquiry', () => {
  beforeEach(() => {
    seedListing(db.raw, { id: 'L1', slug: 'va-adjuster', name: 'VA Adjuster Co', email: 'va@adj.test', licenses: [{ state: 'VA', expires: '2027-12-31', verified: '2026-11-01' }] });
    seedListing(db.raw, { id: 'L2', slug: 'md-adjuster', name: 'MD Adjuster Co', email: 'md@adj.test', licenses: [{ state: 'MD', expires: '2027-12-31', verified: '2026-11-01' }] });
    seedListing(db.raw, { id: 'L3', slug: 'pending-adjuster', status: 'pending', email: 'pending@adj.test', licenses: [{ state: 'VA', expires: '2027-12-31', verified: null }] });
    seedListing(db.raw, { id: 'L4', slug: 'expired-adjuster', email: 'expired@adj.test', licenses: [{ state: 'VA', expires: '2026-10-01', verified: '2026-01-01' }] });
  });

  it('sends the message only to the selected adjuster, with reply-to set to the homeowner, and confirms to the homeowner', async () => {
    const f = createFakeFetch();
    const res = await handleInquiry(post('/api/inquiry', inquiry), env, deps(f));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sentTo: ['VA Adjuster Co'], failed: [] });

    const emails = f.emails();
    expect(emails.map((e) => e.to[0])).toEqual(['va@adj.test', 'jordan@example.com']);
    expect(emails[0]!.reply_to).toBe('jordan@example.com');
    expect(emails[0]!.text).toContain('Pipe burst in the basement');
    expect(emails[1]!.text).toContain('VA Adjuster Co');
    expect(emails[1]!.text).not.toContain('md@adj.test');

    const stored = db.raw.prepare('SELECT consent_text, ip_hash FROM inquiries').get() as { consent_text: string; ip_hash: string };
    expect(stored.consent_text).toBe(INQUIRY_CONSENT);
    expect(stored.ip_hash).not.toContain('203.0.113.7');
    const recipients = db.raw.prepare('SELECT listing_id, delivery_status FROM inquiry_recipients').all();
    expect(recipients.map((r) => ({ ...r }))).toEqual([{ listing_id: 'L1', delivery_status: 'sent' }]);
  });

  it('refuses adjusters not licensed (verified) in the property state', async () => {
    const f = createFakeFetch();
    const res = await handleInquiry(post('/api/inquiry', { ...inquiry, adjusters: ['md-adjuster'] }), env, deps(f));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string> };
    expect(body.errors.adjusters).toMatch(/MD Adjuster Co/);
    expect(f.emails()).toHaveLength(0);
  });

  it('refuses pending and expired listings even if their slugs are posted', async () => {
    for (const slug of ['pending-adjuster', 'expired-adjuster', 'no-such-adjuster']) {
      const f = createFakeFetch();
      const res = await handleInquiry(post('/api/inquiry', { ...inquiry, adjusters: [slug] }), env, deps(f));
      expect(res.status).toBe(422);
      expect(f.emails()).toHaveLength(0);
    }
  });

  it('rejects a failed spam check before storing anything', async () => {
    const f = createFakeFetch({ turnstileOk: false });
    const res = await handleInquiry(post('/api/inquiry', inquiry), env, deps(f));
    expect(res.status).toBe(400);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM inquiries').get()).toEqual(expect.objectContaining({ n: 0 }));
    expect(f.emails()).toHaveLength(0);
  });

  it('rejects cross-site posts and non-JSON bodies', async () => {
    const f = createFakeFetch();
    const cross = await handleInquiry(post('/api/inquiry', inquiry, { Origin: 'https://evil.example' }), env, deps(f));
    expect(cross.status).toBe(403);
    const form = new Request(`${ORIGIN}/api/inquiry`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
    expect((await handleInquiry(form, env, deps(f))).status).toBe(415);
  });

  it('reports a delivery failure without claiming success', async () => {
    const f = createFakeFetch({ resendFailFor: ['va@adj.test'] });
    const res = await handleInquiry(post('/api/inquiry', inquiry), env, deps(f));
    expect(res.status).toBe(502);
    const status = db.raw.prepare('SELECT delivery_status FROM inquiry_recipients').get() as { delivery_status: string };
    expect(status.delivery_status).toBe('failed');
  });

  it('rate-limits repeated submissions from one address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const f = createFakeFetch();
      statuses.push((await handleInquiry(post('/api/inquiry', inquiry), env, deps(f))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('deletes inquiries older than the retention period', async () => {
    db.raw.prepare(`INSERT INTO inquiries (id, created_at, name, email, property_state, loss_type, repair_status, message, consent_text, consent_at)
      VALUES ('old', '2026-01-01T00:00:00Z', 'x', 'x@x.test', 'VA', 'water', 'done', 'old message', 'c', '2026-01-01T00:00:00Z')`).run();
    const f = createFakeFetch();
    await handleInquiry(post('/api/inquiry', inquiry), env, deps(f));
    const ids = db.raw.prepare('SELECT id FROM inquiries').all().map((r) => (r as { id: string }).id);
    expect(ids).not.toContain('old');
    expect(ids).toHaveLength(1);
  });

  it('returns 503, not a silent drop, when email is misconfigured in production', async () => {
    const f = createFakeFetch();
    const res = await handleInquiry(post('/api/inquiry', inquiry), { ...env, RESEND_API_KEY: undefined }, deps(f));
    expect(res.status).toBe(503);
  });
});

const application = {
  businessName: 'Acme Adjusting LLC',
  contactName: 'Pat Adjuster',
  email: 'pat@acme.example',
  phone: '703-555-0100',
  website: '',
  officeCity: 'Richmond',
  officeState: 'VA',
  lossTypes: ['water'],
  bio: 'We handle residential water and fire claims across Virginia.',
  license_VA: 'yes',
  license_VA_number: 'VA-123456',
  license_VA_expires: '2027-06-30',
  license_DC: 'yes',
  license_DC_number: 'DC-9',
  license_DC_expires: '2027-01-31',
  agree_listingTerms: 'yes',
  agree_noFees: 'yes',
  agree_solicitation: 'yes',
  agree_accuracy: 'yes',
  'cf-turnstile-response': 'token',
};

describe('POST /api/apply', () => {
  it('stores a pending listing with unverified licenses and sends a confirmation and an admin notice', async () => {
    const f = createFakeFetch();
    const res = await handleApply(post('/api/apply', application), env, deps(f));
    expect(res.status).toBe(200);

    const listing = db.raw.prepare('SELECT status, slug, terms_version, agreements FROM listings').get() as Record<string, string>;
    expect(listing.status).toBe('pending');
    expect(listing.slug).toBeNull();
    expect(JSON.parse(listing.agreements as string)).toEqual({ listingTerms: true, noFees: true, solicitation: true, accuracy: true });
    const licenses = db.raw.prepare('SELECT state, verified_on FROM listing_licenses ORDER BY state').all().map((r) => ({ ...r }));
    expect(licenses).toEqual([
      { state: 'DC', verified_on: null },
      { state: 'VA', verified_on: null },
    ]);
    expect(f.emails().map((e) => e.to[0])).toEqual(['pat@acme.example', 'admin@scopit.test']);
    expect(f.emails()[1]!.text).toContain(`${ORIGIN}/admin/listings/id-1`);
  });

  it('refuses a second open application from the same email', async () => {
    const f = createFakeFetch();
    await handleApply(post('/api/apply', application), env, deps(f));
    const again = await handleApply(post('/api/apply', application), env, deps(createFakeFetch()));
    expect(again.status).toBe(422);
  });
});

describe('POST /api/newsletter', () => {
  it('subscribes through Buttondown with the configured tag', async () => {
    const f = createFakeFetch();
    const res = await handleNewsletter(post('/api/newsletter', { email: 'pa@example.com', 'cf-turnstile-response': 'token' }), env, deps(f));
    expect(res.status).toBe(200);
    const call = f.calls.find((c) => c.url.startsWith('https://api.buttondown.com/'));
    expect(call?.body).toMatchObject({ email_address: 'pa@example.com', tags: ['scopit-claims-adjuster-notes'] });
    expect((call?.init?.headers as Record<string, string>).Authorization).toBe('Token bd_test');
  });

  it('treats an existing subscriber as success', async () => {
    const f = createFakeFetch({ buttondownStatus: 400 });
    const res = await handleNewsletter(post('/api/newsletter', { email: 'pa@example.com', 'cf-turnstile-response': 'token' }), env, deps(f));
    expect(res.status).toBe(200);
  });
});
