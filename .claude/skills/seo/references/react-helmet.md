# Per-route metadata with react-helmet-async

Scopit is a client-rendered Vite + React SPA: `frontend/index.html` is the only
static head, so every route ships the same `<title>` and meta by default. To give
distinct public pages their own title/description/OG, add a head-management layer.

**Propose this to the user before installing** — it adds a dependency and touches
app bootstrap. Don't do it silently.

## The SPA caveat (say this up front)

`react-helmet-async` updates `<head>` **in the browser, after JS runs**. Google's
main crawler renders JS and will usually see the updated tags, but:

- Many **social/link-preview scrapers** (iMessage, KakaoTalk, Slack, some
  Facebook/LinkedIn fetches) do **not** run JS — they read the raw
  `index.html`. So OG previews for a route will still show the site-wide image/
  title unless the HTML is prerendered.
- For reliable per-route sharing and best-case indexing, the durable fixes are
  **prerendering / static generation** (e.g. `vite-plugin-ssr`/`vike`,
  `react-snap`, or generating a static HTML file per public route) or SSR.

So: helmet is a real improvement for in-app titles and JS-rendering crawlers, but
if the goal is correct link previews, flag that prerendering is the complete
solution and let the user choose how far to go.

## Setup steps

1. **Install** (from `frontend/`):
   ```bash
   npm install react-helmet-async
   ```

2. **Wrap the app** in `HelmetProvider`. In `frontend/src/main.tsx`, wrap the
   root (outside the router):
   ```tsx
   import { HelmetProvider } from 'react-helmet-async';
   // …
   <HelmetProvider>
     {/* existing <RouterProvider .../> or <App /> */}
   </HelmetProvider>
   ```

3. **Add a reusable `<Seo>` component** at `frontend/src/components/Seo.tsx`. It
   centralizes the canonical origin and the OG/Twitter defaults so pages only pass
   what differs:
   ```tsx
   import { Helmet } from 'react-helmet-async';

   const ORIGIN = 'https://www.scopit.work';
   const DEFAULT_IMAGE = `${ORIGIN}/og-image.png`;

   interface SeoProps {
     title: string;              // page-specific, will be shown as-is
     description: string;        // <= ~155 chars
     path: string;               // route path, e.g. "/demo/packing"
     image?: string;             // absolute URL; defaults to the 1200x630 share image
     imageAlt?: string;
     noindex?: boolean;
   }

   export function Seo({ title, description, path, image = DEFAULT_IMAGE, imageAlt = 'Scopit - Estimating & invoicing for restoration contractors', noindex }: SeoProps) {
     const url = `${ORIGIN}${path}`;
     return (
       <Helmet>
         <title>{title}</title>
         <meta name="description" content={description} />
         <link rel="canonical" href={url} />
         {noindex && <meta name="robots" content="noindex, nofollow" />}

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

         <meta name="twitter:card" content="summary_large_image" />
         <meta name="twitter:url" content={url} />
         <meta name="twitter:title" content={title} />
         <meta name="twitter:description" content={description} />
         <meta name="twitter:image" content={image} />
         <meta name="twitter:image:alt" content={imageAlt} />
       </Helmet>
     );
   }
   ```

4. **Use it per public page.** At the top of a page component's returned JSX:
   ```tsx
   <Seo
     title="Packing Demo - Scopit"
     description="See how Scopit builds a packing estimate in minutes for restoration jobs."
     path="/demo/packing"
   />
   ```
   For pages that must stay out of the index (token'd or auth pages), pass
   `noindex`. Note the site-wide `index.html` still says `index, follow`, so the
   authoritative block for private routes remains `robots.txt` Disallow — keep
   both in mind.

5. **Keep `index.html` as the sensible default.** The static head should hold the
   landing-page (`/`) metadata, since that's what non-JS scrapers read first.

## After setup

- Re-run the SEO **Audit checklist** against the pages you added `<Seo>` to.
- If link previews for non-root routes matter to the user, revisit the
  prerendering options above.
