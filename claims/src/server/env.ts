/**
 * Bindings and variables available to the Pages Functions.
 * Secrets are set with `wrangler pages secret put` or in the Cloudflare
 * dashboard, never in the repo. Local values go in .dev.vars (gitignored).
 */
import type { D1Like } from './d1';

export interface Env {
  /** D1 binding (wrangler.toml: [[d1_databases]] binding = "DB"). */
  DB: D1Like;

  /** "production" turns on strict checks: real Turnstile and real email are required. */
  CLAIMS_ENV?: string;
  /** Public origin, e.g. https://claims.scopit.work. Used in email links and Origin checks. */
  CLAIMS_SITE?: string;
  /** Base path when served under a sub-path, e.g. "/claims". Empty for a subdomain. */
  CLAIMS_BASE?: string;

  TURNSTILE_SECRET_KEY?: string;

  /** "resend" (default) or "log" (local only: prints emails instead of sending). */
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  /** "Scopit Claims <claims@scopit.work>" — scopit.work is verified in Scopit's Resend account. */
  EMAIL_FROM?: string;
  /** Where application notices go, e.g. claims-admin@scopit.work. */
  ADMIN_NOTIFY_EMAIL?: string;

  /** "buttondown" (default) or "log" (local only). */
  NEWSLETTER_PROVIDER?: string;
  BUTTONDOWN_API_KEY?: string;
  /** Comma-separated Buttondown tags for adjuster-notes subscribers. */
  BUTTONDOWN_TAGS?: string;

  /** /admin is disabled (404) unless both are set. */
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;

  /** Cloudflare Pages deploy hook. Called after approve/unlist so the directory rebuilds. */
  PAGES_DEPLOY_HOOK_URL?: string;

  /** Random string used to hash IP addresses for rate limiting. */
  IP_HASH_SALT?: string;
}

export function isProduction(env: Env): boolean {
  return (env.CLAIMS_ENV || '').toLowerCase() === 'production';
}

/** Public URL for a site path, for use in emails. */
export function siteUrl(env: Env, path: string): string {
  const origin = (env.CLAIMS_SITE || 'https://claims.scopit.work').replace(/\/+$/, '');
  const base = (env.CLAIMS_BASE || '').replace(/\/+$/, '');
  return `${origin}${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Path including the base, for links inside function-rendered pages. */
export function basePath(env: Env, path: string): string {
  const base = (env.CLAIMS_BASE || '').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ConfigError extends Error {}
