/**
 * Build-time settings on Cloudflare Pages.
 *
 * With a wrangler.toml, Cloudflare makes the file the source of truth (the
 * dashboard can no longer edit those fields), and its docs do not promise
 * that [vars] reach the build step. So on a Cloudflare build (CF_PAGES=1) we
 * read the matching environment's vars from wrangler.toml ourselves:
 *   - "production" when CF_PAGES_BRANCH is the production branch
 *     (CLAIMS_PRODUCTION_BRANCH, default "main"), otherwise "preview";
 *   - plus that environment's D1 database_id as CF_D1_DATABASE_ID.
 * Values already in the environment win, so encrypted secrets set in the
 * dashboard (CF_D1_API_TOKEN, CF_ACCOUNT_ID) are used as given.
 * Locally (no CF_PAGES) this does nothing.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

/** @returns {'production' | 'preview' | null} */
export function loadBuildEnv(env = process.env) {
  if (env.CF_PAGES !== '1') return null;
  const productionBranch = env.CLAIMS_PRODUCTION_BRANCH || 'main';
  const name = env.CF_PAGES_BRANCH === productionBranch ? 'production' : 'preview';
  const config = /** @type {any} */ (parse(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')));
  const block = config.env?.[name] ?? {};
  const vars = { ...(block.vars ?? {}) };
  const db = (block.d1_databases ?? []).find((/** @type {any} */ d) => d.binding === 'DB');
  if (db?.database_id) vars.CF_D1_DATABASE_ID = db.database_id;
  for (const [key, value] of Object.entries(vars)) {
    if (env[key] === undefined || env[key] === '') env[key] = String(value);
  }
  return name;
}
