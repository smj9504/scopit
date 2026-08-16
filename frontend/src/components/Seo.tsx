import { Helmet } from 'react-helmet-async';

/**
 * Per-route <head> metadata for public pages.
 *
 * Scopit is a client-rendered SPA, so index.html ships a single static head
 * (the landing-page defaults). This component overrides title/description/OG/
 * Twitter per route once React has mounted.
 *
 * Caveat: Helmet updates tags client-side. JS-rendering crawlers (e.g. Google)
 * usually see the overrides, but many social/link-preview scrapers do not run
 * JS and will still read the static index.html. Reliable per-route link
 * previews require prerendering/SSG — see .claude/skills/seo/references/react-helmet.md.
 */

const ORIGIN = 'https://www.scopit.work';
const DEFAULT_IMAGE = `${ORIGIN}/og-image.png`;
const DEFAULT_IMAGE_ALT = 'Scopit - Estimating & invoicing for restoration contractors';

interface SeoProps {
  /** Full document title, shown as-is (include " - Scopit"). */
  title: string;
  /** Meta description, ~155 chars max. */
  description: string;
  /** Route path, e.g. "/demo/packing". Combined with the canonical origin. */
  path: string;
  /** Absolute image URL for social cards. Defaults to the 1200x630 share image. */
  image?: string;
  imageAlt?: string;
  /** Keep this route out of the index (token'd/private public pages). */
  noindex?: boolean;
}

export function Seo({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  imageAlt = DEFAULT_IMAGE_ALT,
  noindex,
}: SeoProps) {
  const url = `${ORIGIN}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content="Scopit" />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={imageAlt} />
    </Helmet>
  );
}

export default Seo;
