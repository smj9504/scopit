// Seeds the demo company into the local video stack and records the app
// screens R1-R7. Needs the stack from docker-compose.yml on :8001 and the
// frontend dev server on :3001. Run from this folder:
//   node record_screens.mjs
// Raw videos and timing marks land in build/raw; cut_screens.py turns them
// into screens/R*.mp4.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:8001/api';
const APP = 'http://localhost:3001';
const MAILPIT = 'http://localhost:58025/api/v1';
const RAW = join(here, 'build', 'raw');
const PHOTOS = join(here, '../../backend/app/domains/tools/modules/packing/demo/photos');
const ROOM_PHOTOS = ['basement_1.jpg', 'basement_4.jpg'];

const DANA = { email: 'dana@northline.example.com', password: 'NorthlineDemo2026!', fullName: 'Dana Brooks' };
const COMPANY = {
  name: 'Northline Restoration',
  phone: '(555) 014-2290',
  email: 'office@northline.example.com',
  address_line1: '220 Mill Street',
  city: 'Columbus',
  state: 'OH',
  zipcode: '43215',
};
const TOM = {
  name: 'Tom Miller',
  email: 'tom.miller@example.com',
  phone: '(555) 019-4471',
  address_line1: '1428 Alder Lane',
  city: 'Columbus',
  state: 'OH',
  zipcode: '43214',
};
const CONTRACT_NAME = 'Contents Pack-out Agreement';
const TABLET = { width: 1180, height: 820 };
const PHONE = { width: 390, height: 844 };
const STORY_TIME = '6:12 PM';

mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── API seeding ────────────────────────────────────────────────────────────

async function api(path, { token, method = 'GET', body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function psql(sql) {
  execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'scopit', '-d', 'scopit_video', '-c', sql], {
    cwd: here,
    stdio: 'pipe',
  });
}

async function contractPdf(browser) {
  const page = await browser.newPage();
  const html = readFileSync(join(here, 'contract.html'), 'utf8');
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  await page.close();
  return pdf;
}

// Field boxes in inches on the 8.5 x 11 page, matching contract.html.
const IN = (x, y, w, h) => ({ x: x / 8.5, y: y / 11, width: w / 8.5, height: h / 11 });
const CONTRACT_FIELDS = [
  { key: 'company.name', label: 'Company name', type: 'text', page: 1, ...IN(0.75, 0.74, 4.5, 0.32),
    data_binding: { mode: 'prefilled', source_entity: 'company', source_field: 'name' } },
  { key: 'company.full_address', label: 'Company address', type: 'text', page: 1, ...IN(0.75, 1.08, 5.5, 0.24),
    data_binding: { mode: 'prefilled', source_entity: 'company', source_field: 'full_address' } },
  { key: 'customer.name', label: 'Customer name', type: 'text', page: 1, ...IN(0.75, 2.47, 4.5, 0.3),
    data_binding: { mode: 'prefilled', source_entity: 'customer', source_field: 'name' } },
  { key: 'customer.full_address', label: 'Property address', type: 'text', page: 1, ...IN(0.75, 3.07, 6.5, 0.26),
    data_binding: { mode: 'prefilled', source_entity: 'customer', source_field: 'full_address' } },
  { key: 'sig.customer', label: 'Customer signature', type: 'signature', page: 1, ...IN(0.75, 8.62, 3.4, 0.62),
    data_binding: { mode: 'signer_input' }, signer_role: 'customer', required: true },
];

async function seed(browser) {
  try {
    await api('/auth/register', {
      method: 'POST',
      body: { email: DANA.email, password: DANA.password, company_name: COMPANY.name, full_name: DANA.fullName },
    });
  } catch (err) {
    if (err.status !== 400 && err.status !== 409) throw err;
  }
  psql(`UPDATE users SET is_verified = true WHERE email = '${DANA.email}'`);
  const login = await api('/auth/login', { method: 'POST', body: { email: DANA.email, password: DANA.password } });
  const token = login.access_token;

  await api('/company', { token, method: 'PUT', body: COMPANY });

  const customers = await api('/customers', { token });
  const list = Array.isArray(customers) ? customers : customers.items || customers.customers || [];
  let tom = list.find((c) => c.name === TOM.name);
  if (!tom) tom = await api('/customers', { token, method: 'POST', body: TOM });

  const docs = await api('/tools/pdf-editor/documents', { token });
  const docList = Array.isArray(docs) ? docs : docs.items || docs.documents || [];
  let doc = docList.find((d) => d.name === CONTRACT_NAME);
  if (!doc) {
    const form = new FormData();
    form.append('file', new Blob([await contractPdf(browser)], { type: 'application/pdf' }), 'contents-pack-out-agreement.pdf');
    form.append('name', CONTRACT_NAME);
    doc = await api('/tools/pdf-editor/documents/upload', { token, method: 'POST', form });
  }
  await api(`/tools/pdf-editor/documents/${doc.id}/fields`, { token, method: 'PUT', body: { fields: CONTRACT_FIELDS } });

  return { login, tom, doc };
}

// ── Recording helpers ──────────────────────────────────────────────────────

// A soft touch indicator, since recorded video has no pointer.
const TOUCH_SCRIPT = `
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:2147483647;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;' +
      'background:rgba(37,99,235,.28);border:2px solid rgba(37,99,235,.65);pointer-events:none;left:-100px;top:-100px;' +
      'transition:transform .12s ease, opacity .2s;opacity:0';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; dot.style.opacity = 1; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.72)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
  });
`;

function clock() {
  const t0 = Date.now();
  const marks = {};
  return {
    mark(name) {
      marks[name] = (Date.now() - t0) / 1000;
      console.log(`  mark ${name} @ ${marks[name].toFixed(2)}s`);
    },
    marks,
  };
}

async function tap(page, locator, { pause = 250 } = {}) {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  // Modals animate in; wait until the element stops moving before aiming.
  let box = await locator.boundingBox();
  for (let i = 0; i < 20; i++) {
    await sleep(80);
    const next = await locator.boundingBox();
    const still = next && box && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5
      && Math.abs(next.width - box.width) < 0.5;
    box = next;
    if (still) break;
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 14 });
  await sleep(pause);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

// Pick Tom in a CustomerSelector inside `scope`, retrying until the pick
// lands (the dropdown sometimes swallows the first one).
async function pickCustomer(page, scope) {
  const picked = async () =>
    (await scope.getByText(TOM.email).first().isVisible().catch(() => false)) ||
    (await scope.locator(`input[value="${TOM.name}"]`).first().isVisible().catch(() => false));
  for (let attempt = 0; attempt < 4 && !(await picked()); attempt++) {
    const select = scope.locator('.ant-select').filter({ hasText: 'Search customers' }).first();
    await tap(page, select);
    await sleep(300);
    await page.keyboard.type('Tom', { delay: 70 });
    // The list shows every customer until the search returns; let it settle.
    await page.waitForFunction(
      (name) => {
        const opts = [...document.querySelectorAll('.ant-select-item-option')];
        return opts.length > 0 && opts.every((o) => o.textContent.includes(name));
      },
      TOM.name,
      { timeout: 8000 },
    ).catch(() => {});
    await sleep(400);
    const option = page.locator('.ant-select-item-option').filter({ hasText: TOM.name }).first();
    if (await option.waitFor({ timeout: 8000 }).then(() => true, () => false)) await tap(page, option);
    await sleep(800);
  }
  if (!(await picked())) throw new Error('Could not select Tom Miller');
}

async function slowScroll(page, distance, ms) {
  const steps = Math.max(1, Math.round(ms / 30));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await sleep(30);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: join(RAW, `debug_${name}.png`) });
}

// ── Tablet run: R1 Photo AI -> R2 estimate -> R3/R4 send -> R5 sign ─────────

async function recordTablet(browser, { login, tom }) {
  const context = await browser.newContext({
    viewport: TABLET,
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: TABLET },
  });
  const user = login.user;
  const authState = {
    state: {
      accessToken: login.access_token,
      refreshToken: login.refresh_token,
      user: {
        id: user.id, email: user.email, fullName: user.full_name, companyId: user.company_id,
        role: user.role, isActive: true, isSuperuser: false, createdAt: user.created_at,
      },
      isAuthenticated: true,
    },
    version: 0,
  };
  await context.addInitScript(([auth, uid]) => {
    localStorage.setItem('scopit-auth', auth);
    localStorage.setItem(`onboarding_${uid}`, 'done');
  }, [JSON.stringify(authState), user.id]);
  await context.addInitScript(TOUCH_SCRIPT);

  const page = await context.newPage();
  const { mark, marks } = clock();
  page.setDefaultTimeout(30000);
  let signUrl;

  try {
    // R1: Photo AI
    await page.goto(`${APP}/app/tools/packing`);
    await page.getByRole('button', { name: /New Estimate|^New$/ }).first().waitFor();
    await sleep(800);
    mark('R1.start');
    await tap(page, page.getByRole('button', { name: /New Estimate|^New$/ }).first());
    await tap(page, page.locator('.ant-modal').getByText('Photo AI', { exact: true }).first());
    await sleep(600);

    // Details: pick Tom Miller
    await pickCustomer(page, page.locator('body'));
    await sleep(500);
    await tap(page, page.getByRole('button', { name: /^Next/ }).last());
    await sleep(500);

    // Rooms: add the basement with photos
    await tap(page, page.getByText('Add a room...').first());
    await tap(page, page.locator('.ant-select').filter({ hasText: 'Select a room' }).last());
    await page.keyboard.type('Basement', { delay: 60 });
    await tap(page, page.locator('.ant-select-item-option').filter({ hasText: /^Basement/ }).first());
    await page.locator('input[type=file][accept="image/*"]').last().setInputFiles(ROOM_PHOTOS.map((f) => join(PHOTOS, f)));
    await sleep(900);
    await tap(page, page.getByRole('button', { name: /Add \(\d+\)/ }).last());
    await sleep(700);
    mark('R1.analyze');
    await tap(page, page.getByRole('button', { name: /Analyze Room|Analyze All/ }).first());
    await page.getByText(/Detected Items \(\d+\)/).first().waitFor({ timeout: 300000 });
    await sleep(400);
    mark('R1.items');
    await slowScroll(page, 260, 1400);
    await sleep(900);
    mark('R1.end');
    await shot(page, 'R1');

    // Review -> Generate (off camera). The Scopit estimate is then made through
    // the API so it is linked to Tom; the UI button only passes his name.
    const sessionCreated = page.waitForResponse(
      (r) => /\/tools\/sessions$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
      { timeout: 60000 },
    );
    await tap(page, page.getByRole('button', { name: /^Next/ }).last());
    await tap(page, page.getByRole('button', { name: /Generate Estimate|Recalculate Estimate/ }).first());
    const session = await (await sessionCreated).json();
    await page.getByRole('button', { name: /Create Scopit Estimate/ }).first().waitFor();
    await sleep(2500); // let the editor finish saving the session
    const created = await api(`/tools/sessions/${session.id}/create-estimate`, {
      token: login.access_token,
      method: 'POST',
      body: { customer_id: tom.id, title: 'Packing & Moving - 1428 Alder Lane' },
    });
    await page.goto(`${APP}/app/estimates/${created.estimate_id || created.estimateId}`);
    await page.getByText('Total', { exact: true }).first().waitFor();
    await sleep(700);

    // R2: the estimate, sections beside the total
    mark('R2.start');
    await sleep(3600);
    mark('R2.end');
    await shot(page, 'R2');

    // R3: the contract fills itself in
    await page.goto(`${APP}/app/tools/pdf_editor`);
    await page.getByText(CONTRACT_NAME).first().waitFor();
    await sleep(600);
    await tap(page, page.getByText(CONTRACT_NAME).first());
    await page.getByRole('button', { name: /Send for Signature/ }).first().waitFor();
    await sleep(1200);
    mark('R3.start');
    await tap(page, page.getByRole('button', { name: /Send for Signature/ }).first());
    const modal = page.locator('.ant-modal').filter({ hasText: 'Send for Signature' }).last();
    await modal.waitFor();
    await modal.getByText(COMPANY.name).first().waitFor();
    mark('R3.preview');
    await sleep(1800);
    await tap(page, modal.locator('button').filter({ hasText: /^\s*Next\s*$/ }));
    await sleep(500);
    await pickCustomer(page, modal);
    await sleep(400);
    await tap(page, page.getByText('Direct Link', { exact: true }).first());
    const emailInput = page.locator('.ant-modal input[placeholder="Email address"]').first();
    if (!(await emailInput.inputValue())) {
      await tap(page, emailInput);
      await page.keyboard.type(TOM.email, { delay: 40 });
    }
    await sleep(400);
    await tap(page, modal.locator('button').filter({ hasText: /^\s*Review\s*$/ }));
    await page.getByText(/Auto-filled values/i).first().waitFor();
    await sleep(500);
    mark('R3.autofilled');
    await sleep(1800);
    mark('R3.end');
    await shot(page, 'R3');

    // R4: send as a direct link
    mark('R4.start');
    const sent = page.waitForResponse((r) => /\/sign\/requests\/[^/]+\/send$/.test(r.url()) && r.request().method() === 'POST');
    await tap(page, modal.locator('button').filter({ hasText: /^\s*Send\s*$/ }));
    const sendJson = await (await sent).json();
    signUrl = Object.values(sendJson.signUrls || {})[0];
    await page.getByText('Signature request sent').first().waitFor();
    await sleep(900);
    await tap(page, page.getByRole('button', { name: /Copy/ }).first());
    await sleep(1200);
    mark('R4.end');
    await shot(page, 'R4');
    if (!signUrl) throw new Error('No sign URL in the send response');

    // R5: Tom signs on the tablet
    await page.goto(signUrl);
    const sigField = page.getByRole('button', { name: /Customer signature/ }).first();
    await sigField.waitFor({ timeout: 60000 });
    await sleep(1500);
    mark('R5.start');
    await tap(page, sigField);
    await page.getByText('Draw your signature in the box below').waitFor();
    await sleep(400);
    mark('R5.draw');
    await drawSignature(page, page.locator('.ant-modal canvas').first());
    await sleep(500);
    await tap(page, page.getByRole('button', { name: /Apply Signature/ }));
    await sleep(900);
    mark('R5.applied');
    await tap(page, page.getByRole('button', { name: /Review & Submit/ }).first());
    await sleep(600);
    await tap(page, page.getByRole('checkbox').first());
    await sleep(500);
    await tap(page, page.getByRole('button', { name: /Submit Signature/ }));
    await page.getByText('Document Signed').first().waitFor({ timeout: 60000 });
    await sleep(2200);
    mark('R5.end');
    await shot(page, 'R5');
  } catch (err) {
    await shot(page, 'failure').catch(() => {});
    throw err;
  } finally {
    const video = page.video();
    await context.close();
    if (video) renameSync(await video.path(), join(RAW, 'tablet.webm'));
  }
  return { marks, signUrl };
}

// A cursive-ish "Tom Miller" scrawl drawn as a few strokes.
async function drawSignature(page, canvas) {
  const box = await canvas.boundingBox();
  const at = (u, v) => [box.x + box.width * u, box.y + box.height * v];
  const strokes = [
    // T
    [[0.08, 0.3], [0.2, 0.26], [0.32, 0.25]],
    [[0.2, 0.27], [0.18, 0.5], [0.15, 0.72], [0.12, 0.78]],
    // om
    sample((t) => [0.24 + 0.05 * Math.cos(t * 2 * Math.PI) + t * 0.02, 0.6 + 0.12 * Math.sin(t * 2 * Math.PI)], 18)
      .concat(sample((t) => [0.33 + t * 0.14, 0.7 - 0.16 * Math.abs(Math.sin(t * 3 * Math.PI))], 22)),
    // M
    [[0.52, 0.78], [0.55, 0.3], [0.6, 0.62], [0.65, 0.28], [0.68, 0.78]],
    // iller with a trailing flourish
    sample((t) => [0.7 + t * 0.24, 0.72 - 0.34 * Math.pow(Math.sin(t * 4 * Math.PI), 2) * (t < 0.75 ? 1 : 0.4)], 46),
    [[0.66, 0.86], [0.8, 0.84], [0.95, 0.8]],
  ];
  for (const s of strokes) {
    const [x0, y0] = at(...s[0]);
    await page.mouse.move(x0, y0, { steps: 6 });
    await page.mouse.down();
    for (const p of s.slice(1)) {
      const [x, y] = at(...p);
      await page.mouse.move(x, y, { steps: 5 });
    }
    await page.mouse.up();
    await sleep(120);
  }
}

function sample(fn, n) {
  return Array.from({ length: n + 1 }, (_, i) => fn(i / n));
}

// ── Phone run: R6/R7 from the emails Mailpit caught ────────────────────────

async function fetchMail(to, subjectRe) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/messages?limit=50`)).json();
    const hit = (list.messages || []).find(
      (m) => (m.To || []).some((t) => t.Address === to) && subjectRe.test(m.Subject),
    );
    if (hit) return (await fetch(`${MAILPIT}/message/${hit.ID}`)).json();
    await sleep(1000);
  }
  throw new Error(`No email to ${to} matching ${subjectRe}`);
}

function mailScreen(msg, { owner }) {
  const from = msg.From?.Name || msg.From?.Address || 'Scopit';
  const att = (msg.Attachments || [])[0];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // The story runs on one evening; show its clock rather than the recording's.
  const time = STORY_TIME;
  const body = String(msg.HTML || '').replace(/\w+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M/, `October 12, 2026 at ${STORY_TIME}`);
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; }
  body { font-family: Inter, sans-serif; background:#fff; color:#111827; width:${PHONE.width}px; height:${PHONE.height}px; overflow:hidden; }
  .bar { height:54px; display:flex; align-items:center; justify-content:space-between; padding:0 22px; font:600 15px Inter; }
  .top { padding:6px 18px 12px; border-bottom:1px solid #e5e7eb; display:flex; align-items:center; gap:10px; font:600 15px Inter; color:#2563eb; }
  .head { padding:16px 18px 10px; }
  .subject { font:700 20px/1.3 Inter; }
  .meta { margin-top:14px; display:flex; gap:10px; align-items:center; }
  .av { width:38px; height:38px; border-radius:50%; background:#111827; color:#fff; display:flex; align-items:center; justify-content:center; font:700 15px Inter; }
  .who { font:600 14px Inter; } .who span { display:block; font:400 12px Inter; color:#6b7280; margin-top:2px; }
  .when { margin-left:auto; font:400 12px Inter; color:#6b7280; }
  .att { margin:12px 18px 4px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; display:flex; gap:10px; align-items:center; }
  .pdf { width:34px; height:40px; border-radius:6px; background:#dc2626; color:#fff; font:700 10px Inter; display:flex; align-items:center; justify-content:center; }
  .att b { display:block; font:600 13px Inter; } .att span { font:400 12px Inter; color:#6b7280; }
  iframe { border:0; width:100%; height:560px; }
</style></head><body>
  <div class="bar"><span>${time}</span><span>&#9679;&#9679;&#9679;</span></div>
  <div class="top">&#8249; Inbox</div>
  <div class="head">
    <div class="subject">${esc(msg.Subject)}</div>
    <div class="meta"><div class="av">S</div>
      <div class="who">${esc(from)}<span>to ${esc(owner)}</span></div>
      <div class="when">${time}</div></div>
  </div>
  ${att ? `<div class="att"><div class="pdf">PDF</div><div><b>${esc(att.FileName)}</b><span>${Math.max(1, Math.round(att.Size / 1024))} KB</span></div></div>` : ''}
  <iframe srcdoc="${esc(body)}" scrolling="no"></iframe>
</body></html>`;
}

async function recordPhone(browser, name, msg, owner) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, recordVideo: { dir: RAW, size: PHONE } });
  const page = await context.newPage();
  const { mark, marks } = clock();
  await page.setContent(mailScreen(msg, { owner }), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  mark(`${name}.start`);
  await sleep(3500);
  mark(`${name}.end`);
  await shot(page, name);
  const video = page.video();
  await context.close();
  renameSync(await video.path(), join(RAW, `${name}.webm`));
  return marks;
}

// ── Main ───────────────────────────────────────────────────────────────────

const browser = await launch();
try {
  for (const f of ['R6.webm', 'R7.webm']) rmSync(join(RAW, f), { force: true });
  // --phone-only re-records R6/R7 from the emails already in Mailpit.
  const phoneOnly = process.argv.includes('--phone-only');
  let tablet;
  if (phoneOnly) {
    tablet = { marks: JSON.parse(readFileSync(join(RAW, 'marks.json'), 'utf8')).tablet };
  } else {
    await fetch(`${MAILPIT}/messages`, { method: 'DELETE' }).catch(() => {});
    console.log('Seeding demo data...');
    const seeded = await seed(browser);
    console.log('Recording tablet (R1-R5)...');
    tablet = await recordTablet(browser, seeded);
  }

  console.log('Recording phone emails (R6, R7)...');
  const tomMail = await fetchMail(TOM.email, /^Your signed copy of/);
  const danaMail = await fetchMail(DANA.email, /signed/);
  const r6 = await recordPhone(browser, 'R6', tomMail, TOM.email);
  const r7 = await recordPhone(browser, 'R7', danaMail, DANA.email);

  writeFileSync(
    join(RAW, 'marks.json'),
    JSON.stringify({ tablet: tablet.marks, R6: r6, R7: r7 }, null, 2),
  );
  console.log(`Done. Raw videos and marks in ${RAW}`);
} finally {
  await browser.close();
}
