// Runs after `vite build`. This is a client-rendered SPA served from one
// index.html shell, so every route's raw HTML (before React mounts) shows
// the homepage's title/description/canonical. Googlebot's initial crawl
// reads that raw HTML and saw /demo/packing declare itself a canonical
// duplicate of "/", which kept it out of the index ("Crawled - currently
// not indexed") even though usePageSEO corrects the tags client-side.
//
// This writes a per-route copy of the shell with the real meta baked in,
// so routes listed here get correct signals before any JS runs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const template = readFileSync(join(distDir, 'index.html'), 'utf-8');

const SITE_URL = 'https://www.scopit.work';

// Load the build-time SSR bundle (vite.config.ssr.ts -> dist-ssr/entrySeo.js).
// It renders the body of the pure content pages to static HTML so crawlers see
// real headings/copy, not an empty SPA shell. Optional: if the bundle is
// missing (e.g. SSR build skipped), fall back to meta-only prerendering.
let renderRoute = () => null;
try {
  const ssr = await import(pathToFileURL(join(__dirname, '..', 'dist-ssr', 'entrySeo.js')).href);
  renderRoute = ssr.renderRoute;
} catch (err) {
  console.warn('[prerender-seo] SSR bundle not found — falling back to meta-only shells.', err?.message ?? err);
}

const routes = [
  {
    path: '/packing-calculator',
    title: 'Packing Calculator & Pack-Out Estimate | Scopit',
    description:
      "Scopit's packing calculator builds itemized pack-out and pack-back estimates from room photos — insurance-ready breakdowns and a shareable packing report.",
  },
  {
    path: '/pack-out-estimate',
    title: 'Pack-Out & Pack-Back Estimate Software | Scopit',
    description:
      'Build pack-in / pack-out estimates from room photos. Scopit prices the pack-out and the pack-back together — storage, crew, and staging — for restoration jobs.',
  },
  {
    path: '/insurance-packing-estimate',
    title: 'Insurance Packing Estimate Breakdown | Scopit',
    description:
      'Produce an itemized insurance packing estimate breakdown from room photos — labor, materials, storage, and O&P split per room and per item for contents claims.',
  },
  {
    path: '/packing-report',
    title: 'Packing Report — PDF & Excel Export | Scopit',
    description:
      'Generate a professional packing report from room photos — a branded PDF or Excel with the room-by-room inventory and full cost breakdown for clients and carriers.',
  },
  {
    path: '/xactimate-packing-estimate',
    title: 'Xactimate Packing Estimate Alternative | Scopit',
    description:
      'Price restoration packing & contents fast with photo-based estimates — an itemized breakdown to run alongside Xactimate. ESX export is on our roadmap.',
  },
  {
    path: '/demo/packing',
    title: 'Free Packing Estimate Demo | Scopit',
    description:
      "Try Scopit's AI packing calculator free — snap room photos for an instant pack-out estimate with an insurance-ready breakdown and packing report. No signup.",
  },
  {
    path: '/packing-estimate',
    title: 'Free Packing Estimate | Scopit',
    description:
      'Get a free, itemized packing estimate from room photos — a pack-out and pack-back breakdown built for insurance claims, exportable as a packing report.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy | Scopit',
    description:
      'How Scopit collects, uses, shares, and protects your information, and the privacy rights available to you, including U.S. state privacy rights.',
  },
  {
    path: '/terms',
    title: 'Terms of Service | Scopit',
    description:
      "The terms and conditions that govern your use of Scopit's estimating and invoicing software, including beta terms, acceptable use, and liability.",
  },
];

function setMetaContent(html, attrMatch, value) {
  const re = new RegExp(`(<meta[^>]*${attrMatch}[^>]*content=")[^"]*(")`);
  return html.replace(re, `$1${value}$2`);
}

// The site-wide FAQ JSON-LD in index.html mirrors the FAQ that only renders on
// the landing page ("/"). Baking it into every sub-page shell would mark up
// Q&As that aren't visible on those pages, so strip that one block from the
// per-route copies (the root "/" index.html is left untouched).
function stripLandingFaqJsonLd(html) {
  return html.replace(
    /\n?\s*<!-- Structured Data: FAQ[\s\S]*?<\/script>/,
    ''
  );
}

for (const route of routes) {
  const url = `${SITE_URL}${route.path}`;
  let html = stripLandingFaqJsonLd(template);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`);
  html = setMetaContent(html, 'name="title"', route.title);
  html = setMetaContent(html, 'name="description"', route.description);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  html = setMetaContent(html, 'property="og:url"', url);
  html = setMetaContent(html, 'property="og:title"', route.title);
  html = setMetaContent(html, 'property="og:description"', route.description);
  html = setMetaContent(html, 'name="twitter:url"', url);
  html = setMetaContent(html, 'name="twitter:title"', route.title);
  html = setMetaContent(html, 'name="twitter:description"', route.description);

  // For SSR-eligible content pages, bake the rendered body into #root and add
  // the page's Breadcrumb/FAQ JSON-LD. The client still mounts normally on top.
  let rendered = null;
  try {
    rendered = renderRoute(route.path);
  } catch (err) {
    console.warn(`[prerender-seo] render failed for ${route.path}:`, err?.message ?? err);
  }
  if (rendered) {
    html = html.replace(
      /<div id="root"><\/div>/,
      `<div id="root">${rendered.appHtml}</div>`,
    );
    if (rendered.jsonLd) {
      html = html.replace('</head>', `${rendered.jsonLd}\n  </head>`);
    }
  }

  const outDir = join(distDir, route.path.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  console.log(
    `Prerendered SEO shell${rendered ? ' + SSR body' : ''}: ${route.path} -> ${join(outDir, 'index.html')}`,
  );
}
