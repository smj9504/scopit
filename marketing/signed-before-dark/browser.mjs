// Shared Playwright launcher. Uses the frontend's Playwright install and falls
// back to the newest Chromium already downloaded under ms-playwright when the
// exact build Playwright expects is missing.
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../frontend/package.json'));
const { chromium } = require('@playwright/test');

function installedChromium() {
  const root = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const exe = join(root, b, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export async function launch(options = {}) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    const executablePath = installedChromium();
    if (!executablePath) throw err;
    return chromium.launch({ ...options, executablePath });
  }
}
