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
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const template = readFileSync(join(distDir, 'index.html'), 'utf-8');

const SITE_URL = 'https://www.scopit.work';

const routes = [
  {
    path: '/demo/packing',
    title: 'Free Packing Estimate Demo | Scopit',
    description:
      "Try Scopit's AI-powered packing estimator free, no signup required. Snap room photos and get a professional packing estimate in minutes.",
  },
];

function setMetaContent(html, attrMatch, value) {
  const re = new RegExp(`(<meta[^>]*${attrMatch}[^>]*content=")[^"]*(")`);
  return html.replace(re, `$1${value}$2`);
}

for (const route of routes) {
  const url = `${SITE_URL}${route.path}`;
  let html = template;
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

  const outDir = join(distDir, route.path.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`Prerendered SEO shell: ${route.path} -> ${join(outDir, 'index.html')}`);
}
