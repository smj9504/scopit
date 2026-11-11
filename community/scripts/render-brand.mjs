#!/usr/bin/env node
/**
 * Render theme/brand/: the header logo (the theme's sphere plus "Scopit
 * Community"), the favicon, and the app icon. They are drawn with the theme's
 * own CSS (.sc-orb in theme/custom.css) and font, so they match the site.
 *
 * Needs Playwright with Chromium (not a dependency of this repo) and the
 * Pretendard files that scripts/fetch-fonts.sh installs:
 *   PRETENDARD_DIR=<answer data>/uploads/branding/fonts/pretendard \
 *   node community/scripts/render-brand.mjs
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = process.env.PRETENDARD_DIR;
if (!fontDir) {
  console.error('Set PRETENDARD_DIR to the folder scripts/fetch-fonts.sh filled.');
  process.exit(1);
}
const out = join(root, 'theme', 'brand');
const theme = await readFile(join(root, 'theme', 'custom.css'), 'utf8');
const fonts = await readFile(join(root, 'theme', 'head.html'), 'utf8');

// Serve the page from a made-up origin so the font URLs in head.html
// (/uploads/branding/fonts/pretendard/...) resolve to PRETENDARD_DIR.
const origin = 'http://brand.local';
const fontPrefix = '/uploads/branding/fonts/pretendard/';

const css = `
html,body{margin:0;background:transparent!important}
.brand{display:inline-flex;align-items:center;height:32px;padding:0 2px;font-family:var(--sc-font);font-size:21px;line-height:1;letter-spacing:-0.02em}
.brand .sc-orb{--orb:22px;margin-right:9px}
.brand__name{font-weight:650;color:var(--sc-ink)}
.brand__sub{font-weight:400;color:var(--sc-muted);margin-left:5px}
.icon{display:grid;place-items:center}
`;
const doc = (body) => `<!doctype html><html><head>${fonts}<style>${theme}</style><style>${css}</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();

async function open(options) {
  const context = await browser.newContext(options);
  await context.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith(fontPrefix)) {
      const file = normalize(pathname.slice(fontPrefix.length)).replace(/^(\.\.[/\\])+/, '');
      return route.fulfill({ body: await readFile(join(fontDir, file)), contentType: 'font/woff2' });
    }
    return route.fulfill({ body: '<!doctype html><title>brand</title>', contentType: 'text/html' });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  return page;
}

const logo = await open({ deviceScaleFactor: 3 });
await logo.setContent(
  doc('<span class="brand"><span class="sc-orb"></span><span class="brand__name">Scopit</span><span class="brand__sub">Community</span></span>'),
);
await logo.evaluate(() => document.fonts.ready);
await logo.locator('.brand').screenshot({ path: join(out, 'logo.png'), omitBackground: true });

// Favicon: the sphere alone on transparent. App icon: the sphere on the cream
// stage color, since phones do not keep transparency in home screen icons.
for (const [name, size, orb, background] of [
  ['favicon.png', 48, 44, 'transparent'],
  ['square-icon.png', 192, 124, 'var(--sc-stage)'],
]) {
  const icon = await open({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await icon.setContent(
    doc(`<div class="icon" style="width:${size}px;height:${size}px;background:${background}"><span class="sc-orb" style="--orb:${orb}px"></span></div>`),
  );
  await icon.screenshot({ path: join(out, name), omitBackground: true });
}

await browser.close();
console.log('wrote', out);
