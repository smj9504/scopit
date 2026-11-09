// @ts-check
import { defineConfig } from 'astro/config';
import { loadBuildEnv } from './scripts/build-env.mjs';

// On Cloudflare Pages, take this environment's settings from wrangler.toml.
const cfEnvironment = loadBuildEnv();
if (cfEnvironment) console.log(`[claims] Cloudflare build: using wrangler.toml env "${cfEnvironment}"`);

/**
 * Where the site is served. Both are build-time settings so the same code can
 * run at https://claims.scopit.work/ (recommended) or at
 * https://www.scopit.work/claims/ behind a rewrite. See docs/DEPLOY.md.
 */
const site = process.env.CLAIMS_SITE || 'https://claims.scopit.work';
const base = process.env.CLAIMS_BASE || '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Small CSS is inlined so the first paint needs no extra request.
    inlineStylesheets: 'always',
  },
  devToolbar: { enabled: false },
  vite: {
    build: {
      // Keep scripts as files so the Content-Security-Policy can stay strict.
      assetsInlineLimit: 0,
    },
    ssr: {
      external: ['@resvg/resvg-js'],
    },
  },
});
