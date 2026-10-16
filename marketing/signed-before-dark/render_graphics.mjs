// Renders the still graphics the edit needs: placeholder cards for AI shots,
// the supers, the disclaimer, the end card and the device frames that the
// screen recordings sit inside. Run from this folder:
//   node render_graphics.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const cfg = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const W = cfg.width;
const H = cfg.height;
const out = join(here, 'build', 'graphics');
mkdirSync(out, { recursive: true });

// Screen rectangles (in the 1920x1080 frame) that the recordings are scaled
// into. build.py reads these back from devices.json.
const devices = {
  // Kept clear of the bottom ~240px, where the supers sit.
  tablet: { x: 414, y: 58, w: 1092, h: 759, radius: 16, bezel: 24, viewport: [1180, 820] },
  phone: { x: 782, y: 46, w: 356, h: 771, radius: 32, bezel: 14, viewport: [390, 844] },
};
writeFileSync(join(out, 'devices.json'), JSON.stringify(devices, null, 2));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const base = (body, { transparent = false } = {}) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=block" rel="stylesheet">
<style>
  :root { --ink:#111827; --accent:#2563eb; --muted:#9ca3af; }
  * { margin:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:${transparent ? 'transparent' : 'var(--ink)'}; }
  body { font-family: Inter, sans-serif; color:#fff; }
  h1, h2, .display { font-family: 'Plus Jakarta Sans', sans-serif; }
</style></head><body>${body}</body></html>`;

function placeholderCard(shot) {
  const line = shot.line ? `<p class="line">${esc(shot.line)}</p>` : '';
  return base(`
  <style>
    .wrap { position:absolute; inset:0; padding:140px 160px; display:flex; flex-direction:column; justify-content:flex-start;
            background: repeating-linear-gradient(135deg, #1f2937 0 2px, transparent 2px 28px), #111827; }
    .tag { font: 600 26px Inter; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
    .id { font: 800 168px 'Plus Jakarta Sans'; color:#fff; line-height:1; margin:18px 0 34px; }
    .id span { color:var(--accent); }
    .desc { font: 500 44px/1.35 Inter; max-width:1500px; color:#e5e7eb; }
    .line { margin-top:36px; font: italic 500 38px/1.35 Inter; color:#93c5fd; max-width:1500px; }
    .file { position:absolute; right:160px; top:148px; font: 500 24px Inter; color:var(--muted); }
  </style>
  <div class="wrap">
    <div class="tag">AI shot &middot; scene ${shot.scene} &middot; ${shot.dur}s</div>
    <div class="id display">${shot.id}<span>.</span></div>
    <p class="desc">${esc(shot.desc)}</p>
    ${line}
    <div class="file">Replace with clips/${shot.id}.mp4</div>
  </div>`);
}

function screenCard(shot) {
  return base(`
  <style>
    .wrap { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:28px; }
    .id { font: 800 120px 'Plus Jakarta Sans'; }
    .id span { color:var(--accent); }
    .desc { font: 500 40px/1.35 Inter; color:#e5e7eb; max-width:1300px; text-align:center; }
    .file { font: 500 24px Inter; color:var(--muted); }
  </style>
  <div class="wrap">
    <div class="id">${shot.screen}<span>.</span></div>
    <p class="desc">${esc(shot.desc)}</p>
    <div class="file">Screen recording &middot; screens/${shot.screen}.mp4</div>
  </div>`);
}

function superPng(text) {
  return base(`
  <style>
    .shade { position:absolute; left:0; right:0; bottom:0; height:420px;
             background: linear-gradient(to top, rgba(17,24,39,.78), rgba(17,24,39,0)); }
    .super { position:absolute; left:120px; bottom:110px; max-width:1400px; padding-left:34px;
             border-left:8px solid var(--accent);
             font: 700 60px/1.18 'Plus Jakarta Sans'; letter-spacing:-.01em; color:#fff;
             text-shadow: 0 2px 18px rgba(0,0,0,.45); }
  </style>
  <div class="shade"></div><div class="super">${esc(text)}</div>`, { transparent: true });
}

function disclaimerPng(text) {
  return base(`
  <style>
    .d { position:absolute; right:48px; top:40px; font: 500 22px Inter; color:rgba(255,255,255,.78);
         text-shadow: 0 1px 6px rgba(0,0,0,.6); }
  </style><div class="d">${esc(text)}</div>`, { transparent: true });
}

function endCard() {
  return base(`
  <style>
    .wrap { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .brand { display:flex; align-items:center; gap:34px; }
    .mark { width:150px; height:150px; border-radius:30px; background:#fff; color:var(--ink);
            display:flex; align-items:center; justify-content:center; font: 800 96px 'Plus Jakarta Sans'; }
    .word { font: 800 132px 'Plus Jakarta Sans'; letter-spacing:-.03em; }
    .tagline { margin-top:56px; font: 600 48px 'Plus Jakarta Sans'; color:#e5e7eb; }
    .beta { margin-top:34px; padding:16px 30px; border-radius:999px; background:var(--accent);
            font: 600 32px Inter; }
  </style>
  <div class="wrap">
    <div class="brand"><div class="mark">S</div><div class="word">Scopit</div></div>
    <div class="tagline">Job tools for restoration contractors.</div>
    <div class="beta">Free beta through December 31, 2026</div>
  </div>`);
}

// A dark backdrop with a device bezel and a transparent hole where the
// recording shows through.
function deviceFrame(d) {
  const { x, y, w, h, radius, bezel } = d;
  return base(`
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0">
    <defs>
      <radialGradient id="bg" cx="50%" cy="40%" r="75%">
        <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0b1220"/>
      </radialGradient>
      <mask id="hole">
        <rect width="${W}" height="${H}" fill="#fff"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="#000"/>
      </mask>
    </defs>
    <g mask="url(#hole)">
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <rect x="${x - bezel}" y="${y - bezel}" width="${w + bezel * 2}" height="${h + bezel * 2}"
            rx="${radius + bezel}" fill="#0a0a0a" stroke="#374151" stroke-width="2"/>
    </g>
  </svg>`, { transparent: true });
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });

async function shoot(html, file, transparent = false) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, file), omitBackground: transparent });
}

for (const shot of cfg.shots) {
  if (shot.kind === 'ai') await shoot(placeholderCard(shot), `card_${shot.id}.png`);
  if (shot.kind === 'screen') await shoot(screenCard(shot), `card_${shot.id}.png`);
}
for (const [i, s] of cfg.supers.entries()) await shoot(superPng(s.text), `super_${i}.png`, true);
await shoot(disclaimerPng(cfg.disclaimer), 'disclaimer.png', true);
await shoot(endCard(), 'endcard.png');
for (const [name, d] of Object.entries(devices)) await shoot(deviceFrame(d), `frame_${name}.png`, true);

await browser.close();
console.log(`Graphics written to ${out}`);
