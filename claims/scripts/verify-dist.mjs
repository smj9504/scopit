#!/usr/bin/env node
/**
 * Checks the built site (dist/) for problems a reviewer would otherwise have
 * to catch by hand. Run after `npm run build`. Exits 1 on any failure.
 *
 *   - every page: one <title>, unique titles, a meta description, a canonical
 *     URL, exactly one <h1>, lang attribute
 *   - every page shows the "Run by Scopit…" disclosure (it lives in the footer)
 *   - every internal link and asset resolves to a built file
 *   - every <img> has an alt attribute; every og:image exists
 *   - no lorem ipsum; no words glued to links by lost whitespace
 *   - homeowner pages never link to adjuster notes in the body, and vice versa
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const DISCLOSURE = 'Run by Scopit. Free to use. Scopit does not receive payment from listed adjusters.';
const failures = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const files = await walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const home = await readFile(join(DIST, 'index.html'), 'utf8');
const canonicalHome = home.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? '';
const basePath = new URL(canonicalHome).pathname.replace(/\/$/, ''); // "" or "/claims"
const origin = new URL(canonicalHome).origin;

async function resolveLink(url) {
  let path = url.split('#')[0].split('?')[0];
  if (!path) return true;
  if (basePath) {
    if (!path.startsWith(`${basePath}/`) && path !== basePath) return false;
    path = path.slice(basePath.length) || '/';
  }
  // Server routes handled by Pages Functions.
  if (path.startsWith('/api/') || path.startsWith('/admin')) return true;
  const target = join(DIST, decodeURIComponent(path));
  if (path.endsWith('/')) return exists(join(target, 'index.html'));
  return exists(target);
}

const titles = new Map();
for (const file of htmlFiles) {
  const rel = relative(DIST, file).split(sep).join('/');
  const html = await readFile(file, 'utf8');
  const titleTags = html.match(/<title>([^<]*)<\/title>/g) ?? [];
  if (titleTags.length !== 1) fail(rel, `expected one <title>, found ${titleTags.length}`);
  const title = titleTags[0] ?? '';
  if (titles.has(title)) fail(rel, `duplicate title also used by ${titles.get(title)}`);
  titles.set(title, rel);

  if (!/<html lang="en"/.test(html)) fail(rel, 'missing lang="en"');
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc || desc.length < 50) fail(rel, 'missing or too-short meta description');
  if (desc && desc.length > 170) fail(rel, `meta description is ${desc.length} characters`);
  if (!/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html)) fail(rel, 'missing canonical');
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length !== 1) fail(rel, `expected one <h1>, found ${h1s.length}`);
  if (!html.includes(DISCLOSURE)) fail(rel, 'missing the "Run by Scopit" disclosure');
  if (/lorem ipsum/i.test(html)) fail(rel, 'contains lorem ipsum');

  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const glued = visible.match(/[A-Za-z,.;:]<a\s[^>]*>/g)?.filter((m) => !/^[>]/.test(m));
  if (glued?.length) fail(rel, `text glued to a link (lost space): ${glued[0].slice(0, 40)}`);

  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    if (!/\salt="/.test(img)) fail(rel, `<img> without alt: ${img.slice(0, 60)}`);
  }

  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!og) fail(rel, 'missing og:image');
  else if (og.startsWith(origin) && !(await resolveLink(new URL(og).pathname))) fail(rel, `og:image not built: ${og}`);

  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:|#)/.test(url)) continue;
    if (!(await resolveLink(url))) fail(rel, `broken internal link: ${url}`);
  }

  const section = html.match(/<body data-section="([a-z]+)"/)?.[1];
  const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? '';
  if (section === 'homeowners' && /href="[^"]*\/for-adjusters\/notes\//.test(main)) fail(rel, 'homeowner page links to adjuster notes');
  if (section === 'adjusters' && /href="[^"]*\/guides\//.test(main)) fail(rel, 'adjuster page links to homeowner guides');
}

for (const required of ['sitemap.xml', 'robots.txt', '_headers', '404.html', 'favicon.svg']) {
  if (!(await exists(join(DIST, required)))) failures.push(`missing dist/${required}`);
}

if (failures.length) {
  console.error(`verify-dist: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`verify-dist: ${htmlFiles.length} pages OK`);
