/**
 * /admin — the listing verification tool. One Pages Function, server-rendered
 * HTML, no JavaScript, no cookies.
 *
 * Access: HTTP Basic auth with ADMIN_USER / ADMIN_PASSWORD (secrets). If
 * either is unset, /admin returns 404. Put Cloudflare Access in front of
 * /admin* as a second layer (see docs/ADMIN.md).
 *
 * Every POST must come from this site (Origin check) because browsers resend
 * Basic credentials on cross-site requests.
 */
import { basePath, siteUrl, type Env } from './env';
import { isAllowedOrigin, sha256Hex } from './http';
import { cleanLine, cleanText, isEmail, normalizeWebsite } from './validate';
import {
  adminAddLicense,
  adminDeleteLicense,
  adminGetListing,
  adminListInquiries,
  adminListListings,
  adminSetLicenseVerified,
  adminSetStatus,
  adminUpdateLicense,
  adminUpdateListing,
  slugExists,
  type AdminLicense,
  type AdminListing,
} from './store';
import { createEmailSender } from './email';
import { listingLive } from './email-templates';
import { LIMITS, LOSS_TYPES, LOSS_TYPE_CODES, RESERVED_SLUGS, STATE_CODES, stateName } from '../shared/constants';
import { isIsoDate, todayIso } from '../shared/dates';
import { isLicenseCurrent, toPublicListing, type ListingRow } from '../shared/directory';
import { LICENSE_LOOKUPS } from '../shared/license-lookups';

export interface AdminDeps {
  now?: Date;
  fetch?: typeof fetch;
  waitUntil?: (p: Promise<unknown>) => void;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

/* ---------------- Auth ---------------- */

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const userOk = await timingSafeEqual(decoded.slice(0, sep), env.ADMIN_USER || '');
  const passOk = await timingSafeEqual(decoded.slice(sep + 1), env.ADMIN_PASSWORD || '');
  return userOk && passOk;
}

/* ---------------- Helpers ---------------- */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const e = escapeHtml;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: SECURITY_HEADERS });
}

function redirect(env: Env, path: string, msg?: string): Response {
  const location = basePath(env, path) + (msg ? `?msg=${encodeURIComponent(msg)}` : '');
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

const MESSAGES: Record<string, string> = {
  saved: 'Changes saved.',
  verified: 'License marked as verified.',
  unverified: 'License verification removed.',
  'license-updated': 'License updated. If the number or expiry changed, verify it again.',
  'license-added': 'License added. Verify it before it can show publicly.',
  'license-deleted': 'License deleted.',
  approved: 'Listing approved. The directory rebuild has been requested.',
  'approved-no-hook': 'Listing approved. PAGES_DEPLOY_HOOK_URL is not set, so rebuild the site to publish it.',
  rejected: 'Application rejected.',
  unlisted: 'Listing removed from the directory. The rebuild has been requested.',
  rebuild: 'Directory rebuild requested.',
  'rebuild-no-hook': 'PAGES_DEPLOY_HOOK_URL is not set. Redeploy from the Cloudflare dashboard.',
};

async function requestRebuild(env: Env, deps: AdminDeps): Promise<boolean> {
  if (!env.PAGES_DEPLOY_HOOK_URL) return false;
  const run = (deps.fetch ?? fetch)(env.PAGES_DEPLOY_HOOK_URL, { method: 'POST' })
    .then((r) => {
      if (!r.ok) console.error(`[admin] deploy hook returned ${r.status}`);
    })
    .catch((err) => console.error('[admin] deploy hook failed', err));
  if (deps.waitUntil) deps.waitUntil(run);
  else await run;
  return true;
}

function page(env: Env, title: string, content: string, msg?: string | null, error?: string | null): string {
  const flash = msg && MESSAGES[msg] ? `<p class="flash">${e(MESSAGES[msg])}</p>` : '';
  const err = error ? `<p class="flash flash--error" role="alert">${e(error)}</p>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${e(title)} · Scopit Claims admin</title>
<style>
  body{margin:0;background:#f5f4ee;color:#15201b;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  header{border-bottom:1.5px solid #15201b;padding:12px 20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}
  header strong{font-size:18px} header a{color:#15201b}
  main{padding:20px;max-width:1100px}
  h1{font-size:26px;margin:8px 0 16px} h2{font-size:19px;margin:28px 0 8px;border-top:1.5px solid #15201b;padding-top:12px}
  table{border-collapse:collapse;width:100%;background:#fcfbf7;margin:8px 0}
  th,td{border:1px solid #d6d3c6;padding:6px 8px;text-align:left;vertical-align:top;font-size:15px}
  th{font:500 13px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.04em}
  a{color:#1e5a46} .mono{font-family:ui-monospace,Menlo,monospace;font-size:14px}
  .flash{border:1.5px solid #15201b;border-left-width:6px;background:#fcfbf7;padding:10px 14px}
  .flash--error{border-color:#9b2a1a;background:#fbeee9}
  .badge{display:inline-block;border:1px solid #15201b;padding:0 6px;font:500 12px ui-monospace,Menlo,monospace;text-transform:uppercase}
  .b-pending{background:#f4da4a} .b-verified{background:#1e5a46;color:#fff;border-color:#1e5a46} .b-warn{background:#fbeee9;border-color:#9b2a1a;color:#9b2a1a}
  form.inline{display:inline} fieldset{border:1.5px solid #15201b;background:#fcfbf7;margin:12px 0;padding:12px 14px}
  label{display:block;font-weight:600;margin:8px 0 2px} input[type=text],input[type=email],input[type=date],select,textarea{width:100%;max-width:520px;box-sizing:border-box;padding:7px 8px;border:1.5px solid #15201b;border-radius:2px;font:inherit;background:#fff}
  label>input[type=text],label>input[type=email],label>input[type=date],label>select,label>textarea{display:block;margin-top:4px;font-weight:400}
  textarea{min-height:110px} .checks label{font-weight:400;display:inline-block;margin-right:14px}
  button{min-height:40px;padding:6px 14px;border:1.5px solid #15201b;border-radius:2px;background:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}
  button.primary{background:#1e5a46;border-color:#1e5a46;color:#fff} button.danger{border-color:#9b2a1a;color:#9b2a1a}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end} .muted{color:#4a5750}
  :focus-visible{outline:3px solid #15201b;outline-offset:2px}
</style></head><body>
<header><strong>Scopit Claims admin</strong>
<a href="${e(basePath(env, '/admin/'))}">Listings</a>
<a href="${e(basePath(env, '/admin/inquiries'))}">Inquiries</a>
<a href="${e(siteUrl(env, '/find-an-adjuster/'))}">Public directory</a></header>
<main>${flash}${err}${content}</main></body></html>`;
}

function licensesFromJson(value: string | null): ListingRow['licenses_json'] {
  return value;
}

function statusBadge(status: string, publicOk: boolean): string {
  if (status === 'verified' && !publicOk) return '<span class="badge b-warn">verified · hidden (no current license)</span>';
  return `<span class="badge b-${e(status)}">${e(status)}</span>`;
}

/* ---------------- Views ---------------- */

async function viewDashboard(env: Env, msg: string | null, deps: AdminDeps): Promise<Response> {
  const rows = await adminListListings(env.DB);
  const today = todayIso(deps.now);
  const groups: Record<string, string[]> = { pending: [], verified: [], other: [] };
  for (const r of rows) {
    const asRow = { ...r, licenses_json: licensesFromJson(r.licenses_json) } as unknown as ListingRow;
    const pub = toPublicListing(asRow, today);
    const licenses = JSON.parse(r.licenses_json || '[]') as AdminLicense[];
    const lic = licenses
      .map(
        (l) =>
          `${e(l.state)} <span class="mono">${e(l.license_number)}</span> exp ${e(l.expires_on)} · ${
            l.verified_on ? `verified ${e(l.verified_on)}` : '<strong>not verified</strong>'
          }${isLicenseCurrent(l, today) ? '' : l.verified_on ? ' <span class="badge b-warn">not current</span>' : ''}`,
      )
      .join('<br>');
    const line = `<tr><td><a href="${e(basePath(env, `/admin/listings/${r.id}`))}">${e(r.business_name)}</a><br><span class="muted">${e(r.contact_name)} · ${e(r.email)}</span></td>
      <td>${statusBadge(r.status, Boolean(pub))}</td><td>${lic}</td><td class="mono">${e(r.created_at.slice(0, 10))}</td></tr>`;
    (groups[r.status === 'pending' ? 'pending' : r.status === 'verified' ? 'verified' : 'other'] as string[]).push(line);
  }
  const table = (lines: string[], empty: string) =>
    lines.length
      ? `<table><thead><tr><th>Business</th><th>Status</th><th>Licenses</th><th>Applied</th></tr></thead><tbody>${lines.join('')}</tbody></table>`
      : `<p class="muted">${e(empty)}</p>`;
  const hook = env.PAGES_DEPLOY_HOOK_URL ? 'configured' : 'not set';
  const content = `<h1>Listings</h1>
  <p class="muted">A listing is public only while its status is verified and at least one license has a verified date and has not expired. Directory pages rebuild after approve, unlist, and edits to live listings (deploy hook: ${hook}).</p>
  <form method="post" action="${e(basePath(env, '/admin/rebuild'))}" class="inline"><button type="submit">Rebuild directory now</button></form>
  <h2>Waiting for review (${groups.pending!.length})</h2>${table(groups.pending!, 'No applications waiting.')}
  <h2>Verified (${groups.verified!.length})</h2>${table(groups.verified!, 'No verified listings yet.')}
  <h2>Rejected or unlisted (${groups.other!.length})</h2>${table(groups.other!, 'None.')}`;
  return html(page(env, 'Listings', content, msg));
}

async function viewListing(env: Env, id: string, msg: string | null, deps: AdminDeps, error: string | null = null, status = 200): Promise<Response> {
  const found = await adminGetListing(env.DB, id);
  if (!found) return html(page(env, 'Not found', '<h1>Listing not found</h1>'), 404);
  const { listing: l, licenses } = found;
  const today = todayIso(deps.now);
  const action = (p: string) => e(basePath(env, `/admin/listings/${l.id}/${p}`));
  const lossTypes = (JSON.parse(l.loss_types || '[]') as string[]) ?? [];
  const agreements = JSON.parse(l.agreements || '{}') as Record<string, boolean>;
  const currentCount = licenses.filter((x) => isLicenseCurrent(x, today)).length;

  const licenseRows = licenses
    .map((x) => {
      const lookup = LICENSE_LOOKUPS[x.state as keyof typeof LICENSE_LOOKUPS];
      const current = isLicenseCurrent(x, today);
      return `<tr>
      <td><strong>${e(stateName(x.state))}</strong><br><a href="${e(lookup?.url)}" rel="noopener noreferrer" target="_blank">${e(lookup?.label)}</a></td>
      <td>
        <form method="post" action="${action(`licenses/${x.id}/update`)}">
          <label>Number<input type="text" name="number" value="${e(x.license_number)}" required maxlength="${LIMITS.licenseNumberMax}"></label>
          <label>Expires<input type="date" name="expires" value="${e(x.expires_on)}" required></label>
          <div class="row"><button type="submit">Save license</button></div>
        </form>
        <form method="post" action="${action(`licenses/${x.id}/delete`)}" class="inline"><button type="submit" class="danger">Delete license</button></form>
      </td>
      <td>${
        x.verified_on
          ? `Verified on <strong>${e(x.verified_on)}</strong>${current ? '' : ' <span class="badge b-warn">not current</span>'}<br><span class="muted">${e(x.verified_note)}</span>
             <form method="post" action="${action(`licenses/${x.id}/unverify`)}"><button type="submit">Remove verification</button></form>`
          : `<form method="post" action="${action(`licenses/${x.id}/verify`)}">
              <label>Checked on<input type="date" name="verified_on" value="${e(today)}" max="${e(today)}" required></label>
              <label>How you checked it<input type="text" name="note" required maxlength="300" placeholder="e.g. SCC lookup: status Active, name and number match"></label>
              <div class="row"><button type="submit" class="primary">Mark license verified</button></div>
            </form>`
      }</td></tr>`;
    })
    .join('');

  const content = `<p><a href="${e(basePath(env, '/admin/'))}">← All listings</a></p>
  <h1>${e(l.business_name)} ${statusBadge(l.status, l.status === 'verified' && currentCount > 0)}</h1>
  <p class="muted">Applied ${e(l.created_at)} · Terms ${e(l.terms_version)} agreed ${e(l.agreed_at)} · Agreed: ${e(
    Object.entries(agreements)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'none',
  )}${l.slug ? ` · Public page: <a href="${e(siteUrl(env, `/find-an-adjuster/${l.slug}/`))}">/find-an-adjuster/${e(l.slug)}/</a>` : ''}</p>

  <h2>1. Verify each license</h2>
  <p class="muted">Open the state lookup, search the license number and name, and confirm it is a public adjuster license, active, and expires on the date entered. Only then mark it verified. The date you enter is shown publicly as “License verified on [date]”.</p>
  <table><thead><tr><th>State</th><th>License (as entered)</th><th>Verification</th></tr></thead><tbody>${licenseRows || '<tr><td colspan="3">No licenses.</td></tr>'}</tbody></table>
  <details><summary>Add a license</summary>
    <form method="post" action="${action('licenses/add')}">
      <label>State<select name="state">${STATE_CODES.map((s) => `<option value="${s}">${e(stateName(s))}</option>`).join('')}</select></label>
      <label>Number<input type="text" name="number" required maxlength="${LIMITS.licenseNumberMax}"></label>
      <label>Expires<input type="date" name="expires" required></label>
      <div class="row"><button type="submit">Add license</button></div>
    </form>
  </details>

  <h2>2. Decide</h2>
  <div class="row">
    <form method="post" action="${action('approve')}">
      <label>Public URL slug<input type="text" name="slug" value="${e(l.slug || slugify(l.business_name))}" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="60"></label>
      <button type="submit" class="primary"${currentCount ? '' : ' disabled'}>${l.status === 'verified' ? 'Save slug and republish' : 'Approve and publish'}</button>
      ${currentCount ? '' : '<p class="muted">Verify at least one current license first.</p>'}
    </form>
  </div>
  <div class="row">
    ${
      l.status === 'verified'
        ? `<form method="post" action="${action('unlist')}"><button type="submit" class="danger">Remove from directory</button></form>`
        : ''
    }
    ${
      l.status === 'pending'
        ? `<form method="post" action="${action('reject')}"><label>Reason (internal)<input type="text" name="note" maxlength="500"></label><button type="submit" class="danger">Reject application</button></form>`
        : ''
    }
  </div>

  <h2>3. Edit details</h2>
  <form method="post" action="${action('edit')}">
    <label>Business name<input type="text" name="business_name" value="${e(l.business_name)}" required maxlength="${LIMITS.nameMax}"></label>
    <label>Contact name<input type="text" name="contact_name" value="${e(l.contact_name)}" required maxlength="${LIMITS.nameMax}"></label>
    <label>Email (private)<input type="email" name="email" value="${e(l.email)}" required maxlength="${LIMITS.emailMax}"></label>
    <label>Phone<input type="text" name="phone" value="${e(l.phone)}" maxlength="${LIMITS.phoneMax}"></label>
    <label>Website<input type="text" name="website" value="${e(l.website)}" maxlength="${LIMITS.urlMax}"></label>
    <label>Office city<input type="text" name="office_city" value="${e(l.office_city)}" maxlength="${LIMITS.locationMax}"></label>
    <label>Office state<input type="text" name="office_state" value="${e(l.office_state)}" maxlength="2"></label>
    <fieldset class="checks"><legend>Loss types</legend>${LOSS_TYPES.map(
      (t) => `<label><input type="checkbox" name="loss_types" value="${t.code}"${lossTypes.includes(t.code) ? ' checked' : ''}> ${e(t.label)}</label>`,
    ).join('')}</fieldset>
    <label>Description (public)<textarea name="bio" maxlength="${LIMITS.bioMax}" required>${e(l.bio)}</textarea></label>
    <label>Admin note (internal only)<textarea name="admin_note" maxlength="2000">${e(l.admin_note)}</textarea></label>
    <div class="row"><button type="submit">Save details</button></div>
  </form>`;
  return html(page(env, l.business_name, content, msg, error), status);
}

async function viewInquiries(env: Env): Promise<Response> {
  const rows = await adminListInquiries(env.DB);
  const body = rows
    .map((r) => {
      const recipients = JSON.parse(r.recipients || '[]') as { business_name: string; status: string }[];
      return `<tr><td class="mono">${e(r.created_at.replace('T', ' ').slice(0, 16))}</td><td>${e(r.property_state)}</td><td>${e(r.loss_type)}</td>
      <td>${recipients.map((x) => `${e(x.business_name)} <span class="badge ${x.status === 'failed' ? 'b-warn' : ''}">${e(x.status)}</span>`).join('<br>')}</td></tr>`;
    })
    .join('');
  const content = `<h1>Inquiries</h1>
  <p class="muted">Delivery status only. Homeowner names, contact details, and messages are not shown here; they go only to the adjusters the homeowner chose. Rows are deleted after the retention period.</p>
  ${body ? `<table><thead><tr><th>Sent (UTC)</th><th>State</th><th>Loss</th><th>Adjusters</th></tr></thead><tbody>${body}</tbody></table>` : '<p class="muted">No inquiries yet.</p>'}`;
  return html(page(env, 'Inquiries', content));
}

/* ---------------- Actions ---------------- */

async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return new URLSearchParams();
  const text = await request.text();
  if (text.length > 20_000) return new URLSearchParams();
  return new URLSearchParams(text);
}

async function uniqueSlug(env: Env, wanted: string, id: string): Promise<string> {
  const base = RESERVED_SLUGS.includes(wanted) ? `${wanted}-adjusting` : wanted;
  let slug = base;
  for (let i = 2; await slugExists(env.DB, slug, id); i++) slug = `${base}-${i}`;
  return slug;
}

async function act(request: Request, env: Env, id: string, rest: string[], deps: AdminDeps): Promise<Response> {
  const now = deps.now ?? new Date();
  const today = todayIso(now);
  const found = await adminGetListing(env.DB, id);
  if (!found) return html(page(env, 'Not found', '<h1>Listing not found</h1>'), 404);
  const { listing } = found;
  const form = await readForm(request);
  const fail = (message: string) => viewListing(env, id, null, deps, message, 400);
  const licenseId = rest[0] === 'licenses' && rest[1] && rest[1] !== 'add' ? Number(rest[1]) : NaN;
  const license = Number.isFinite(licenseId) ? found.licenses.find((x) => x.id === licenseId) : undefined;
  const isLive = listing.status === 'verified';
  const key = rest.join('/');

  if (key === 'edit') {
    const email = cleanLine(form.get('email')).toLowerCase();
    const websiteRaw = cleanLine(form.get('website'));
    const website = websiteRaw ? normalizeWebsite(websiteRaw) : null;
    const lossTypes = form.getAll('loss_types').filter((x) => (LOSS_TYPE_CODES as string[]).includes(x));
    const edit = {
      business_name: cleanLine(form.get('business_name')),
      contact_name: cleanLine(form.get('contact_name')),
      email,
      phone: cleanLine(form.get('phone')) || null,
      website,
      office_city: cleanLine(form.get('office_city')) || null,
      office_state: cleanLine(form.get('office_state')).toUpperCase() || null,
      loss_types: lossTypes,
      bio: cleanText(form.get('bio')),
      admin_note: cleanText(form.get('admin_note')) || null,
    };
    if (!edit.business_name || !edit.contact_name || !edit.bio) return fail('Business name, contact name, and description are required.');
    if (!isEmail(email)) return fail('Enter a valid email address.');
    if (websiteRaw && !website) return fail('Enter a valid website or leave it blank.');
    await adminUpdateListing(env.DB, id, edit, now);
    if (isLive) await requestRebuild(env, deps);
    return redirect(env, `/admin/listings/${id}`, 'saved');
  }

  if (rest[0] === 'licenses' && rest[1] === 'add') {
    const state = cleanLine(form.get('state'));
    const number = cleanLine(form.get('number'));
    const expires = cleanLine(form.get('expires'));
    if (!(STATE_CODES as string[]).includes(state)) return fail('Choose VA, MD, or DC.');
    if (!number || number.length > LIMITS.licenseNumberMax) return fail('Enter the license number.');
    if (!isIsoDate(expires)) return fail('Enter the expiration date.');
    if (found.licenses.some((x) => x.state === state)) return fail(`This listing already has a ${state} license. Edit it instead.`);
    await adminAddLicense(env.DB, id, state, number, expires);
    return redirect(env, `/admin/listings/${id}`, 'license-added');
  }

  if (rest[0] === 'licenses' && license) {
    if (rest[2] === 'verify') {
      const verifiedOn = cleanLine(form.get('verified_on'));
      const note = cleanLine(form.get('note'));
      if (!isIsoDate(verifiedOn) || verifiedOn > today) return fail('Enter the date you checked the license (today or earlier).');
      if (!note) return fail('Say how you checked the license, for the record.');
      if (license.expires_on < today) return fail('This license has expired. Ask the adjuster for the renewed license details.');
      await adminSetLicenseVerified(env.DB, id, license.id, verifiedOn, note.slice(0, 300));
      if (isLive) await requestRebuild(env, deps);
      return redirect(env, `/admin/listings/${id}`, 'verified');
    }
    if (rest[2] === 'unverify') {
      await adminSetLicenseVerified(env.DB, id, license.id, null, null);
      if (isLive) await requestRebuild(env, deps);
      return redirect(env, `/admin/listings/${id}`, 'unverified');
    }
    if (rest[2] === 'update') {
      const number = cleanLine(form.get('number'));
      const expires = cleanLine(form.get('expires'));
      if (!number || number.length > LIMITS.licenseNumberMax) return fail('Enter the license number.');
      if (!isIsoDate(expires)) return fail('Enter the expiration date.');
      await adminUpdateLicense(env.DB, id, license.id, number, expires);
      if (isLive) await requestRebuild(env, deps);
      return redirect(env, `/admin/listings/${id}`, 'license-updated');
    }
    if (rest[2] === 'delete') {
      await adminDeleteLicense(env.DB, id, license.id);
      if (isLive) await requestRebuild(env, deps);
      return redirect(env, `/admin/listings/${id}`, 'license-deleted');
    }
  }

  if (key === 'approve') {
    const current = found.licenses.filter((x) => isLicenseCurrent(x, today));
    if (current.length === 0) return fail('Verify at least one current license before approving.');
    const wanted = slugify(cleanLine(form.get('slug')) || listing.business_name);
    if (!wanted) return fail('Enter a URL slug using letters, numbers, and dashes.');
    const slug = await uniqueSlug(env, wanted, id);
    const wasLive = isLive;
    await adminSetStatus(env.DB, id, 'verified', { now, slug, approvedOn: today });
    const hooked = await requestRebuild(env, deps);
    if (!wasLive) {
      const send = (async () => {
        try {
          const sender = createEmailSender(env, deps.fetch);
          await sender.send({
            to: listing.email,
            ...listingLive(listing.contact_name, listing.business_name, siteUrl(env, `/find-an-adjuster/${slug}/`)),
            idempotencyKey: `listing-live-${id}-${slug}`,
          });
        } catch (err) {
          console.error('[admin] listing-live email failed', err);
        }
      })();
      if (deps.waitUntil) deps.waitUntil(send);
      else await send;
    }
    return redirect(env, `/admin/listings/${id}`, hooked ? 'approved' : 'approved-no-hook');
  }

  if (key === 'reject') {
    if (listing.status !== 'pending') return fail('Only pending applications can be rejected. Use Remove from directory for live listings.');
    await adminSetStatus(env.DB, id, 'rejected', { now, note: cleanText(form.get('note')) || null });
    return redirect(env, `/admin/listings/${id}`, 'rejected');
  }

  if (key === 'unlist') {
    await adminSetStatus(env.DB, id, 'unlisted', { now });
    await requestRebuild(env, deps);
    return redirect(env, `/admin/listings/${id}`, 'unlisted');
  }

  return html(page(env, 'Not found', '<h1>Unknown action</h1>'), 404);
}

/* ---------------- Router ---------------- */

export async function handleAdmin(request: Request, env: Env, deps: AdminDeps = {}): Promise<Response> {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return new Response('Not Found', { status: 404 });
  if (!(await isAuthorized(request, env))) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Scopit Claims admin", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const base = (env.CLAIMS_BASE || '').replace(/\/+$/, '');
  let path = url.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length);
  const parts = path.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  const msg = url.searchParams.get('msg');

  try {
    if (request.method === 'GET') {
      if (parts.length === 0) return await viewDashboard(env, msg, deps);
      if (parts[0] === 'inquiries' && parts.length === 1) return await viewInquiries(env);
      if (parts[0] === 'listings' && parts[1] && parts.length === 2) return await viewListing(env, parts[1], msg, deps);
      return html(page(env, 'Not found', '<h1>Not found</h1>'), 404);
    }
    if (request.method === 'POST') {
      if (!isAllowedOrigin(request, env)) return new Response('Forbidden', { status: 403 });
      if (parts[0] === 'rebuild' && parts.length === 1) {
        const ok = await requestRebuild(env, deps);
        return redirect(env, '/admin/', ok ? 'rebuild' : 'rebuild-no-hook');
      }
      if (parts[0] === 'listings' && parts[1] && parts.length >= 3) return await act(request, env, parts[1], parts.slice(2), deps);
      return html(page(env, 'Not found', '<h1>Not found</h1>'), 404);
    }
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (err) {
    console.error('[admin] error', err);
    return html(page(env, 'Error', '<h1>Something went wrong</h1><p>Check the Functions logs in the Cloudflare dashboard.</p>'), 500);
  }
}

export type { AdminListing };
