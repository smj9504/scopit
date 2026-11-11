#!/usr/bin/env node
/**
 * Render the Scopit Community logo and icons in theme/brand/ from the claims
 * site's own Plex fonts and favicon, so "Scopit [COMMUNITY]" matches the
 * claims site's "Scopit [CLAIMS]" header exactly.
 *
 * Needs Playwright with Chromium (not a dependency of this repo):
 *   node community/scripts/render-brand.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = join(root, '..', 'claims', 'public', 'fonts');
const out = join(root, 'theme', 'brand');
const font = (name) => 'data:font/woff2;base64,' + readFileSync(join(fonts, name)).toString('base64');

const css = `
@font-face{font-family:Plex;src:url(${font('ibm-plex-sans-latin-700-normal.woff2')});font-weight:700}
@font-face{font-family:PlexMono;src:url(${font('ibm-plex-mono-latin-500-normal.woff2')});font-weight:500}
html,body{margin:0;background:transparent}
.logo{display:inline-flex;align-items:center;gap:9px;padding:2px 1px;height:32px;box-sizing:border-box;color:#15201b}
.name{font:700 26px/1 Plex;letter-spacing:-0.02em;position:relative;top:-1px}
.tag{font:500 13px/1 PlexMono;text-transform:uppercase;letter-spacing:0.08em;background:#f4da4a;border:1.5px solid #15201b;border-radius:2px;padding:4px 6px 3px}
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });
await page.setContent(`<style>${css}</style><span class="logo"><span class="name">Scopit</span><span class="tag">Community</span></span>`);
await page.evaluate(() => document.fonts.ready);
await page.locator('.logo').screenshot({ path: join(out, 'logo.png'), omitBackground: true });

const svg = readFileSync(join(root, '..', 'claims', 'public', 'favicon.svg'), 'utf8');
for (const [name, size] of [['favicon.png', 48], ['square-icon.png', 192]]) {
  const icon = await browser.newPage({ viewport: { width: size, height: size } });
  await icon.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await icon.screenshot({ path: join(out, name), omitBackground: true });
}
await browser.close();
console.log('wrote', out);
