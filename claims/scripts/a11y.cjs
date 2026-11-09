#!/usr/bin/env node
/**
 * Accessibility pass: serves dist/ locally and runs axe-core (WCAG 2.0/2.1/2.2
 * A and AA rules) on every page at phone and desktop widths, and checks for
 * horizontal scrolling at 360px. Uses the Playwright + Chromium already on the
 * machine (`require('playwright')`); it is not a dependency of the site.
 *
 *   npm run build && node scripts/a11y.cjs
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(DIST, p);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(fs.readFileSync(path.join(DIST, '404.html')));
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve(server));
  });
}

function pages(dir = DIST, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) pages(full, out);
    else if (e.name === 'index.html') out.push('/' + path.relative(DIST, path.dirname(full)).split(path.sep).join('/') + (dir === DIST ? '' : '/'));
  }
  return out.map((p) => p.replace(/\/+/g, '/'));
}

(async () => {
  const server = await serve();
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  let problems = 0;
  for (const [width, height] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    // Third-party scripts (Turnstile, analytics) are not part of this check.
    await ctx.route(/challenges\.cloudflare\.com|plausible\.io/, (r) => r.abort());
    const page = await ctx.newPage();
    for (const p of pages()) {
      await page.goto(base + p, { waitUntil: 'load' });
      await page.addScriptTag({ content: AXE });
      const result = await page.evaluate(async () =>
        // eslint-disable-next-line no-undef
        axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
      );
      for (const v of result.violations) {
        problems++;
        console.log(`[${width}px] ${p} — ${v.id} (${v.impact}): ${v.help}`);
        for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(' ')}`);
      }
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollW > width) {
        problems++;
        console.log(`[${width}px] ${p} — horizontal scroll (${scrollW}px wide)`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(problems ? `\na11y: ${problems} problem(s)` : `\na11y: no axe violations, no horizontal scroll`);
  process.exit(problems ? 1 : 0);
})();
