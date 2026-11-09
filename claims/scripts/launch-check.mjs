#!/usr/bin/env node
/**
 * Launch gate. Lists everything that must be resolved before Scopit Claims
 * goes live, and exits 1 while any blocker remains. Warnings do not block.
 *
 *   npm run launch-check
 *
 * Blockers:
 *   - guides or notes still marked placeholder or draft
 *   - guides or legal pages with attorney review pending
 *   - state-rule rows not yet marked verified
 *   - placeholder D1 database ids in wrangler.toml
 * Warnings:
 *   - photo slots with no real photo yet (// TODO: real photo)
 *   - Cloudflare secrets that cannot be checked from the repository
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';

const ROOT = new URL('..', import.meta.url).pathname;
const blockers = [];
const warnings = [];

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}
const field = (fm, name) => fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');

for (const collection of ['guides', 'notes', 'legal']) {
  const dir = join(ROOT, 'src/content', collection);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    const text = await readFile(join(dir, file), 'utf8');
    const fm = frontMatter(text);
    const where = `src/content/${collection}/${file}`;
    const status = field(fm, 'status');
    if (status && status !== 'published') blockers.push(`${where}: status is "${status}" (needs final text, then status: published)`);
    if (field(fm, 'attorneyReview') === 'pending') blockers.push(`${where}: needs attorney review before launch`);
    const unverifiedRules = (fm.match(/^\s+verified:\s*false\s*$/gm) ?? []).length;
    if (unverifiedRules) blockers.push(`${where}: ${unverifiedRules} state-rule row(s) not verified`);
    if ((collection === 'guides' || collection === 'notes') && !/^photo:/m.test(fm)) {
      warnings.push(`${where}: no real job-site photo yet (placeholder shown)`);
    }
  }
}

const wrangler = await readFile(join(ROOT, 'wrangler.toml'), 'utf8');
if (/database_id = "00000000-0000-0000-0000-00000000000[01]"/.test(wrangler)) {
  blockers.push('wrangler.toml: replace the placeholder D1 database_id values (see docs/DEPLOY.md)');
}
const prodVars = parse(wrangler).env?.production?.vars ?? {};
for (const key of ['PUBLIC_TURNSTILE_SITE_KEY', 'CLAIMS_SITE', 'PUBLIC_CONTACT_EMAIL']) {
  if (!prodVars[key]) blockers.push(`wrangler.toml [env.production.vars]: ${key} is empty`);
}
if (prodVars.CLAIMS_ENV !== 'production') blockers.push('wrangler.toml [env.production.vars]: CLAIMS_ENV must be "production"');

warnings.push('src/pages/index.astro: home hero photo slot has no real photo yet (// TODO: real photo)');

warnings.push('Cloudflare secrets cannot be checked from here: CF_D1_API_TOKEN, CF_ACCOUNT_ID (build) and the runtime secrets in docs/DEPLOY.md section 3');

console.log('Scopit Claims launch check\n');
if (blockers.length) console.log(`BLOCKERS (${blockers.length})\n- ${blockers.join('\n- ')}\n`);
if (warnings.length) console.log(`Warnings (${warnings.length})\n- ${warnings.join('\n- ')}\n`);
console.log('Manual items are in docs/LAUNCH_CHECKLIST.md.');
if (blockers.length) {
  console.log('\nNot ready to launch.');
  process.exit(1);
}
console.log('\nNo blockers found by this script.');
