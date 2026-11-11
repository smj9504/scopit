/**
 * Site-wide settings for the static build. Values that change between
 * environments come from environment variables (see .env.example).
 */

export const SITE = {
  name: 'Scopit Claims',
  shortName: 'Scopit Claims',
  publisher: 'Scopit',
  publisherUrl: 'https://www.scopit.work',
  description:
    'Free, plain-language guides to home insurance claims in Virginia, Maryland, and DC, and a directory of license-verified public adjusters. Run by Scopit.',
  locale: 'en_US',
  contactEmail: import.meta.env.PUBLIC_CONTACT_EMAIL || 'claims@scopit.work',
  /** Scopit Community (homeowner Q&A). Linked from the header and footer once set; leave empty until it is live. */
  communityUrl: '',
};

export const PUBLIC_CONFIG = {
  /** Cloudflare Turnstile site key. The default is Cloudflare's always-pass test key for local work. */
  turnstileSiteKey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
  /** Plausible: leave empty to load no analytics at all. */
  plausibleDomain: import.meta.env.PUBLIC_PLAUSIBLE_DOMAIN || '',
  plausibleSrc: import.meta.env.PUBLIC_PLAUSIBLE_SRC || 'https://plausible.io/js/script.js',
  /** Google Search Console HTML-tag verification token (optional; DNS verification is preferred). */
  gscVerification: import.meta.env.PUBLIC_GSC_VERIFICATION || '',
};

const rawBase = import.meta.env.BASE_URL || '/';
/** Base path without a trailing slash: "" or "/claims". */
export const BASE_PATH = rawBase.replace(/\/+$/, '');

/**
 * Turn a site path ("/guides/") into a link that includes the base path.
 * Always use this for internal links so the site can move under /claims/.
 */
export function href(path: string): string {
  if (/^(https?:|mailto:|tel:|#)/.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}

/** Absolute URL for canonical links, Open Graph, sitemap, and JSON-LD. */
export function absoluteUrl(path: string): string {
  const site = (import.meta.env.SITE || 'https://claims.scopit.work').replace(/\/+$/, '');
  return `${site}${href(path)}`;
}

/** Which side of the site a page belongs to. Homeowner and adjuster content never share a page. */
export type Section = 'homeowners' | 'adjusters' | 'shared';

/**
 * Prefix root-relative links in rendered Markdown with the base path, so
 * content can link to "/contact/" and still work under /claims/.
 */
export function withBaseLinks(html: string): string {
  if (!BASE_PATH) return html;
  return html.replace(/(\s(?:href|src)=")\/(?!\/)/g, `$1${BASE_PATH}/`);
}
