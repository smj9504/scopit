import { beforeEach, describe, expect, it } from 'vitest';
import { handleAdmin, slugify, escapeHtml } from '../src/server/admin';
import type { Env } from '../src/server/env';
import { createTestDb } from './helpers/d1-shim';
import { createFakeFetch } from './helpers/fake-fetch';
import { seedListing } from './helpers/seed';

const ORIGIN = 'https://claims.scopit.work';
const NOW = new Date('2026-11-09T15:00:00Z');
const AUTH = `Basic ${btoa('admin:correct horse battery staple')}`;

let db: ReturnType<typeof createTestDb>;
let env: Env;

beforeEach(() => {
  db = createTestDb();
  env = {
    DB: db,
    CLAIMS_ENV: 'production',
    CLAIMS_SITE: ORIGIN,
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: 'correct horse battery staple',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Scopit Claims <claims@scopit.work>',
    PAGES_DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/test',
  };
  seedListing(db.raw, {
    id: 'P1',
    slug: null,
    status: 'pending',
    name: 'Acme <Adjusting>',
    email: 'pat@acme.test',
    licenses: [{ state: 'VA', expires: '2027-06-30', verified: null }],
  });
});

function get(path: string, auth = AUTH) {
  return new Request(`${ORIGIN}${path}`, { headers: auth ? { Authorization: auth } : {} });
}
function post(path: string, fields: Record<string, string | string[]>, origin = ORIGIN) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x);
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { Authorization: AUTH, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

describe('/admin access', () => {
  it('is disabled (404) when no admin password is configured', async () => {
    const res = await handleAdmin(get('/admin/'), { ...env, ADMIN_PASSWORD: undefined });
    expect(res.status).toBe(404);
  });

  it('asks for credentials and rejects wrong ones', async () => {
    expect((await handleAdmin(get('/admin/', ''), env)).status).toBe(401);
    expect((await handleAdmin(get('/admin/', `Basic ${btoa('admin:wrong')}`), env)).status).toBe(401);
    const ok = await handleAdmin(get('/admin/'), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
  });

  it('escapes stored values in HTML', async () => {
    const res = await handleAdmin(get('/admin/'), env);
    const text = await res.text();
    expect(text).toContain('Acme &lt;Adjusting&gt;');
    expect(text).not.toContain('Acme <Adjusting>');
  });

  it('blocks cross-site POSTs', async () => {
    const res = await handleAdmin(post('/admin/listings/P1/approve', {}, 'https://evil.example'), env);
    expect(res.status).toBe(403);
  });
});

describe('verification workflow', () => {
  it('will not approve until a license is verified', async () => {
    const f = createFakeFetch();
    const res = await handleAdmin(post('/admin/listings/P1/approve', { slug: 'acme' }), env, { now: NOW, fetch: f.fetch });
    expect(res.status).toBe(400);
    const row = db.raw.prepare('SELECT status FROM listings WHERE id = ?').get('P1') as { status: string };
    expect(row.status).toBe('pending');
  });

  it('requires a note and a date not in the future to verify a license', async () => {
    const lic = db.raw.prepare('SELECT id FROM listing_licenses WHERE listing_id = ?').get('P1') as { id: number };
    const noNote = await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/verify`, { verified_on: '2026-11-09', note: '' }), env, { now: NOW });
    expect(noNote.status).toBe(400);
    const future = await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/verify`, { verified_on: '2026-11-10', note: 'x' }), env, { now: NOW });
    expect(future.status).toBe(400);
  });

  it('verifies, approves with a unique slug, rebuilds, and emails the adjuster once', async () => {
    seedListing(db.raw, { id: 'OTHER', slug: 'acme', licenses: [{ state: 'MD', expires: '2027-01-01', verified: '2026-11-01' }] });
    const lic = db.raw.prepare('SELECT id FROM listing_licenses WHERE listing_id = ?').get('P1') as { id: number };
    const f = createFakeFetch();
    const verify = await handleAdmin(
      post(`/admin/listings/P1/licenses/${lic.id}/verify`, { verified_on: '2026-11-09', note: 'SCC lookup: active' }),
      env,
      { now: NOW, fetch: f.fetch },
    );
    expect(verify.status).toBe(303);

    const approve = await handleAdmin(post('/admin/listings/P1/approve', { slug: 'acme' }), env, { now: NOW, fetch: f.fetch });
    expect(approve.status).toBe(303);
    expect(approve.headers.get('Location')).toBe('/admin/listings/P1?msg=approved');
    const row = db.raw.prepare('SELECT status, slug, approved_on FROM listings WHERE id = ?').get('P1') as Record<string, string>;
    expect(row).toEqual(expect.objectContaining({ status: 'verified', slug: 'acme-2', approved_on: '2026-11-09' }));
    expect(f.calls.some((c) => c.url.includes('/pages/webhooks/deploy_hooks/'))).toBe(true);
    expect(f.emails().map((m) => m.to[0])).toEqual(['pat@acme.test']);
    expect(f.emails()[0]!.text).toContain('https://claims.scopit.work/find-an-adjuster/acme-2/');

    // Re-saving a live listing does not email again.
    const again = await handleAdmin(post('/admin/listings/P1/approve', { slug: 'acme-2' }), env, { now: NOW, fetch: f.fetch });
    expect(again.status).toBe(303);
    expect(f.emails()).toHaveLength(1);
  });

  it('clears verification when the license number or expiry is edited', async () => {
    const lic = db.raw.prepare('SELECT id FROM listing_licenses WHERE listing_id = ?').get('P1') as { id: number };
    await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/verify`, { verified_on: '2026-11-09', note: 'ok' }), env, { now: NOW });
    await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/update`, { number: 'VA-NEW', expires: '2027-06-30' }), env, { now: NOW });
    const row = db.raw.prepare('SELECT license_number, verified_on FROM listing_licenses WHERE id = ?').get(lic.id) as Record<string, unknown>;
    expect(row).toEqual(expect.objectContaining({ license_number: 'VA-NEW', verified_on: null }));
  });

  it('keeps verification when the license is re-saved unchanged', async () => {
    const lic = db.raw.prepare('SELECT id, license_number, expires_on FROM listing_licenses WHERE listing_id = ?').get('P1') as {
      id: number;
      license_number: string;
      expires_on: string;
    };
    await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/verify`, { verified_on: '2026-11-09', note: 'ok' }), env, { now: NOW });
    await handleAdmin(post(`/admin/listings/P1/licenses/${lic.id}/update`, { number: lic.license_number, expires: lic.expires_on }), env, { now: NOW });
    const row = db.raw.prepare('SELECT verified_on FROM listing_licenses WHERE id = ?').get(lic.id) as Record<string, unknown>;
    expect(row.verified_on).toBe('2026-11-09');
  });

  it('rejects pending applications and unlists live ones', async () => {
    const rej = await handleAdmin(post('/admin/listings/P1/reject', { note: 'License not found in lookup' }), env, { now: NOW });
    expect(rej.status).toBe(303);
    expect((db.raw.prepare('SELECT status, admin_note FROM listings WHERE id = ?').get('P1') as Record<string, string>)).toEqual(
      expect.objectContaining({ status: 'rejected', admin_note: 'License not found in lookup' }),
    );

    seedListing(db.raw, { id: 'LIVE', slug: 'live', licenses: [{ state: 'DC', expires: '2027-01-01', verified: '2026-11-01' }] });
    const f = createFakeFetch();
    const unlist = await handleAdmin(post('/admin/listings/LIVE/unlist', {}), env, { now: NOW, fetch: f.fetch });
    expect(unlist.status).toBe(303);
    expect((db.raw.prepare('SELECT status FROM listings WHERE id = ?').get('LIVE') as { status: string }).status).toBe('unlisted');
    expect(f.calls.some((c) => c.url.includes('deploy_hooks'))).toBe(true);
  });

  it('shows inquiry delivery status without homeowner details', async () => {
    db.raw.prepare(`INSERT INTO inquiries (id, created_at, name, email, property_state, loss_type, repair_status, message, consent_text, consent_at)
      VALUES ('I1', '2026-11-09T12:00:00Z', 'Secret Name', 'secret@home.test', 'VA', 'water', 'done', 'secret message', 'c', '2026-11-09T12:00:00Z')`).run();
    const res = await handleAdmin(get('/admin/inquiries'), env);
    const text = await res.text();
    expect(text).not.toContain('Secret Name');
    expect(text).not.toContain('secret@home.test');
    expect(text).not.toContain('secret message');
  });
});

describe('helpers', () => {
  it('slugifies business names safely', () => {
    expect(slugify('  Acme & Sons Adjusting, LLC ')).toBe('acme-and-sons-adjusting-llc');
    expect(slugify('Ünïcode Claims')).toBe('unicode-claims');
    expect(slugify('<script>')).toBe('script');
  });
  it('escapes HTML', () => {
    expect(escapeHtml(`"<a href='x'>&`)).toBe('&quot;&lt;a href=&#39;x&#39;&gt;&amp;');
  });
});
