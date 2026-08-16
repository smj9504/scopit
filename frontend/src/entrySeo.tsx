/**
 * SSR entry used only at build time by scripts/prerender-seo.mjs.
 *
 * Scopit is a client-rendered SPA, so the raw HTML of every route ships an
 * empty <div id="root">. The prerender step already bakes per-route <head>
 * meta into a static shell; this module additionally renders the *body* of the
 * keyword-targeted packing content pages to static HTML, so search crawlers
 * (and non-JS link scrapers) see the real headings and copy before any JS runs.
 *
 * Only the PackingLandingLayout-based content pages are rendered here — they are
 * pure, data-driven, and SSR-safe (no window/document/data-fetching at render).
 * The interactive pages (demo, lead form) stay meta-only.
 *
 * This bundle is built with vite.config.ssr.ts into dist-ssr/ and is NOT
 * deployed — it is a build-time-only artifact.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { HelmetProvider, type HelmetServerState } from 'react-helmet-async';

import PackingCalculatorPage from './pages/public/PackingCalculatorPage';
import PackOutEstimatePage from './pages/public/PackOutEstimatePage';
import InsurancePackingEstimatePage from './pages/public/InsurancePackingEstimatePage';
import PackingReportPage from './pages/public/PackingReportPage';

const ROUTES: Record<string, React.ComponentType> = {
  '/packing-calculator': PackingCalculatorPage,
  '/pack-out-estimate': PackOutEstimatePage,
  '/insurance-packing-estimate': InsurancePackingEstimatePage,
  '/packing-report': PackingReportPage,
};

/** Routes this SSR entry can render a static body for. */
export const SEO_SSR_ROUTES = Object.keys(ROUTES);

export interface RenderedRoute {
  /** Server-rendered body HTML to inject into <div id="root">. */
  appHtml: string;
  /** JSON-LD <script> tags collected from the page's Helmet (Breadcrumb + FAQ). */
  jsonLd: string;
}

export function renderRoute(path: string): RenderedRoute | null {
  const Page = ROUTES[path];
  if (!Page) return null;

  const helmetContext: { helmet?: HelmetServerState } = {};
  const appHtml = renderToString(
    <HelmetProvider context={helmetContext}>
      <StaticRouter location={path}>
        <Page />
      </StaticRouter>
    </HelmetProvider>,
  );

  // Only the JSON-LD scripts — title/meta/canonical are handled by the shell's
  // string replacement in prerender-seo.mjs, so we don't re-emit those here.
  const jsonLd = helmetContext.helmet?.script.toString() ?? '';

  return { appHtml, jsonLd };
}
