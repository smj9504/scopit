#!/usr/bin/env node
/**
 * Apply Scopit Community settings to a running Apache Answer (2.0.x) site
 * through its admin API, so the look and rules are reproducible instead of
 * clicked together by hand.
 *
 * Usage (Node 20+, no dependencies):
 *   ANSWER_URL=http://127.0.0.1:9080 \
 *   ANSWER_ADMIN_EMAIL=admin@example.com \
 *   ANSWER_ADMIN_PASSWORD=... \
 *   SITE_URL=https://community.example.com \
 *   CONTACT_EMAIL=claims@scopit.work \
 *   [SMTP_PASSWORD=...] \
 *   node community/scripts/apply-settings.mjs
 *
 * Safe to re-run: settings are overwritten, tags are created only if missing.
 * The deploy workflow runs it after every release, so changes made by hand in
 * Admin to anything listed in settings.json are replaced; change the file.
 */
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const base = requireEnv('ANSWER_URL').replace(/\/$/, '');
const adminEmail = requireEnv('ANSWER_ADMIN_EMAIL');
const adminPassword = requireEnv('ANSWER_ADMIN_PASSWORD');
const siteUrl = requireEnv('SITE_URL');
const contactEmail = requireEnv('CONTACT_EMAIL');

const settings = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'));

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 200) {
    throw new Error(`${method} ${path} failed: HTTP ${res.status} ${json.msg ?? ''} ${JSON.stringify(json.data ?? '')}`);
  }
  return json.data;
}

const login = await call('POST', '/answer/api/v1/user/login/email', { e_mail: adminEmail, pass: adminPassword });
const token = login.access_token;
const admin = (method, path, body) => call(method, `/answer/admin/api${path}`, body, token);
const api = (method, path, body) => call(method, `/answer/api/v1${path}`, body, token);

await admin('PUT', '/siteinfo/general', { ...settings.general, site_url: siteUrl, contact_email: contactEmail });
console.log('general: ok');
await admin('PUT', '/siteinfo/interface', settings.interface);
console.log('interface: ok');
await admin('PUT', '/siteinfo/theme', settings.theme);
console.log('theme: ok');

// Branding images go through Answer's upload endpoint, then into the
// branding settings. Re-running uploads fresh copies; Answer deletes the
// unused old ones in its orphan-file cleanup.
async function uploadBranding(relPath) {
  const form = new FormData();
  form.append('source', 'branding');
  form.append('file', new Blob([await readFile(join(root, relPath))], { type: 'image/png' }), basename(relPath));
  const res = await fetch(`${base}/answer/api/v1/file`, { method: 'POST', headers: { Authorization: token }, body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 200) {
    throw new Error(`upload ${relPath} failed: HTTP ${res.status} ${json.msg ?? ''}`);
  }
  return json.data;
}
const brandingUrls = {};
for (const key of ['logo', 'mobile_logo', 'square_icon', 'favicon']) {
  brandingUrls[key] = await uploadBranding(settings.branding[key]);
}
await admin('PUT', '/siteinfo/branding', brandingUrls);
console.log('branding: ok');
await admin('PUT', '/siteinfo/users-settings', settings.usersSettings);
console.log('users settings: ok');
await admin('PUT', '/siteinfo/login', settings.login);
console.log('login: ok');
await admin('PUT', '/siteinfo/security', settings.security);
console.log('security: ok');
await admin('PUT', '/siteinfo/question', settings.question);
console.log('question: ok');

for (const tag of settings.tags) {
  let exists = false;
  try {
    const info = await api('GET', `/tag?name=${encodeURIComponent(tag.slug_name)}`);
    exists = Boolean(info?.tag_id);
  } catch {
    exists = false;
  }
  if (exists) {
    console.log(`tag ${tag.slug_name}: exists`);
    continue;
  }
  await api('POST', '/tag', {
    slug_name: tag.slug_name,
    display_name: tag.display_name,
    original_text: tag.description,
  });
  console.log(`tag ${tag.slug_name}: created`);
}

const rooms = settings.tags.filter((t) => t.room).map((t) => ({ slug_name: t.slug_name, display_name: t.display_name }));
await admin('PUT', '/siteinfo/tag', {
  reserved_tags: [],
  recommend_tags: rooms,
  required_tag: settings.tagSettings.required_tag,
});
console.log('tag settings: ok');

// Plugins compiled into this build (see the README) are turned on. A plain
// Answer build without them only gets a warning.
const installed = (await admin('GET', '/plugins?status=')) ?? [];
for (const slug of settings.plugins ?? []) {
  if (!installed.some((p) => p.slug_name === slug)) {
    console.warn(`plugin ${slug}: not in this Answer build, skipped`);
    continue;
  }
  await admin('PUT', '/plugin/status', { plugin_slug_name: slug, enabled: true });
  console.log(`plugin ${slug}: on`);
}

// Outgoing email, needed for sign-up verification. Only applied when
// SMTP_PASSWORD (for Resend, an API key) is set.
if (process.env.SMTP_PASSWORD) {
  await admin('PUT', '/setting/smtp', { ...settings.smtp, smtp_password: process.env.SMTP_PASSWORD });
  console.log('smtp: ok');
} else {
  console.log('smtp: skipped (no SMTP_PASSWORD)');
}

const files = settings.customCssHtml;
const read = (p) => readFile(join(root, p), 'utf8');
await admin('PUT', '/siteinfo/custom-css-html', {
  custom_head: await read(files.head),
  custom_css: await read(files.css),
  custom_header: await read(files.header),
  custom_footer: await read(files.footer),
  custom_sidebar: await read(files.sidebar),
});
console.log('custom CSS and HTML: ok');
console.log('Done.');
