---
name: seo
description: >-
  Audit and improve SEO for the Scopit frontend (Vite + React SPA). Use this
  skill whenever the user touches anything that affects search visibility or
  social sharing — editing frontend/index.html, adding or renaming a public
  route, writing meta tags / title / description, adding Open Graph or Twitter
  cards, adding JSON-LD structured data, updating sitemap.xml or robots.txt, or
  setting up per-page (react-helmet) metadata. Trigger it even when the user
  only says things like "SEO 점검", "메타태그 확인", "구조화 데이터 추가",
  "sitemap 업데이트", "왜 카톡/링크 공유하면 미리보기가 안 떠", "이 페이지 검색에
  노출되게 해줘", or asks whether a page is indexable. Prefer this skill over
  ad-hoc edits so the site's SEO stays consistent with Scopit's conventions.
---

# Scopit SEO

Keep Scopit's search visibility and social-sharing metadata correct and
consistent. Scopit is a **Vite + React SPA** (single static `index.html`, client
rendered), so most site-wide SEO lives in one file and per-route metadata needs
a deliberate mechanism. This skill encodes the project's conventions so every
change stays coherent instead of drifting.

## Project constants (use these exact values)

These are the source of truth. If a task conflicts with one, flag it rather than
silently diverging.

- **Canonical origin**: `https://www.scopit.work` — always `https`, always the
  `www` host, no trailing slash except the root `/`. Every absolute URL
  (canonical, `og:url`, sitemap `<loc>`) uses this origin.
- **Brand name**: `Scopit`. Product one-liner: *estimating and invoicing
  software for restoration contractors*.
- **Contact email**: `hello@scopit.work`.
- **Social share image**: `https://www.scopit.work/og-image.png`, **1200×630**,
  PNG. Always pair it with `og:image:alt` / `twitter:image:alt`.
- **Primary structured-data type**: `SoftwareApplication`
  (`applicationCategory: BusinessApplication`). See
  `references/structured-data.md` for ready-to-use JSON-LD blocks.

Key files:
- `frontend/index.html` — site-wide `<head>` (title, meta, OG, Twitter, JSON-LD).
- `frontend/public/sitemap.xml` — list of indexable public URLs.
- `frontend/public/robots.txt` — crawl rules + sitemap pointer.
- `frontend/src/App.tsx` — the route table (source of truth for what URLs exist).

## How to route a request

- **"Check / audit SEO"**, reviewing a diff, or "is this page indexable?" →
  run the **Audit checklist** below and report findings.
- **"Add / generate meta tags or structured data for a page"** → **Generate
  metadata** section + `references/structured-data.md`.
- **"Update / regenerate sitemap or robots"** → **Sitemap & robots** section.
- **"Make per-page titles/meta change as you navigate"** → **Per-route metadata**
  section + `references/react-helmet.md`.

Most tasks touch more than one area — e.g. adding a public page means metadata
*and* sitemap *and* robots. Handle the whole chain rather than one piece.

## Audit checklist

Walk these in order. For each item, report ✅ pass, ⚠️ improvement, or ❌ problem,
with the file/line and a concrete fix. Ground every finding in the project
constants above — don't invent a different domain, image size, or brand voice.

**Indexability & identity**
1. **`<html lang>`** is set (currently `en`) and matches the content language.
2. **`robots` meta / policy** matches the page's intent: public marketing pages
   are `index, follow`; anything under `/app/`, `/admin/`, auth flows, and
   token'd links (`/sign/:token`, `/packing-estimate/verify|result/:token`) must
   NOT be indexable. In this SPA the single `index.html` says `index, follow`, so
   private routes are kept out via `robots.txt` `Disallow` — verify that holds.
3. **Canonical** (`<link rel="canonical">`) is absolute, uses the canonical
   origin, and points at the *self* URL of the page (no cross-page canonicals).

**Title & description**
4. **`<title>`** ≤ ~60 chars, leads with the page's specific value, includes
   `Scopit`. Avoid duplicate titles across distinct pages.
5. **`meta[name=description]`** ≤ ~155 chars, specific and benefit-led (mirror the
   landing copy's voice: "Create professional restoration estimates in minutes,
   not hours."). One per page; no keyword stuffing.

**Social sharing (Open Graph + Twitter)**
6. **Open Graph** present and self-consistent: `og:type`, `og:url` (= canonical),
   `og:site_name` (`Scopit`), `og:locale` (`en_US`), `og:title`, `og:description`,
   `og:image` (the 1200×630 PNG), `og:image:width/height`, `og:image:alt`.
7. **Twitter** card present: `twitter:card=summary_large_image`, `twitter:url`,
   `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt`.
8. OG/Twitter titles & descriptions shouldn't contradict the primary `<title>` /
   description — small variations for tone are fine, factual drift is not.

**Structured data**
9. **JSON-LD** parses as valid JSON, `@context` is `https://schema.org`, and the
   `@type` fits the page (site-wide: `SoftwareApplication`; see
   `references/structured-data.md` for `Organization`, `FAQPage`, `BreadcrumbList`
   options). Every claim in the markup must match what's visibly on the page —
   never mark up prices, ratings, or offers that aren't shown.

**Semantic HTML & accessibility (these are ranking + a11y wins)**
10. Exactly **one `<h1>`** per page; headings nest without skipping levels.
11. Landmark structure (`<main>`, `<nav>`, `<header>`, `<footer>`) is present and
    used once where appropriate.
12. **Images have meaningful `alt`** (empty `alt=""` only for decorative ones);
    links have descriptive text (no bare "click here").

**Crawl plumbing**
13. **`sitemap.xml`** lists every indexable public route and *only* those — no
    `/app`, `/admin`, auth, or token'd URLs. `<lastmod>` is a real date.
14. **`robots.txt`** allows public paths, disallows private ones, and ends with a
    correct `Sitemap:` line pointing at the canonical origin.
15. **Route ↔ sitemap ↔ robots agreement**: cross-check `App.tsx` public routes
    against `sitemap.xml` and `robots.txt`. A public, indexable route missing
    from the sitemap (or a private route accidentally crawlable) is a ❌.
16. **Prerender coverage** for public non-root pages: any route that should have
    correct link previews needs an entry in `frontend/scripts/prerender-seo.mjs`
    AND a matching `frontend/vercel.json` rewrite, with title/description equal to
    the page's `<Seo>` component. A public page with a `<Seo>` but no prerender
    entry gets right previews only from JS-rendering crawlers, not social
    scrapers. (See the per-route section below.)

Finish an audit with a short prioritized summary: ❌ first (breaks indexing or
sharing), then ⚠️ (improvements), then ✅ (what's already good). Offer to apply
the fixes.

## Generate metadata

When adding or rewriting metadata for a page:

1. Confirm the page's **canonical URL** from `App.tsx` (build it on the canonical
   origin).
2. Write **title** and **description** to the length/voice rules above.
3. Emit a **complete, self-consistent set**: primary meta + OG + Twitter, reusing
   the canonical URL and the 1200×630 share image (unless the user provides a
   page-specific image — then keep 1200×630 and set a matching `*:image:alt`).
4. Add **JSON-LD** only if it reflects real on-page content — copy the closest
   block from `references/structured-data.md` and fill it in.
5. For a **site-wide** change, edit `frontend/index.html`. For **per-route**
   metadata, use the react-helmet mechanism (next section) rather than duplicating
   a second static head.

Mirror the existing ordering and comment style in `index.html` (Primary Meta →
Open Graph → Twitter → Structured Data) so diffs stay readable.

## Sitemap & robots

`sitemap.xml` and `robots.txt` must agree with the real route table.

1. Read public routes from `frontend/src/App.tsx` (routes NOT under `/app` or
   `/admin`, and not auth/token'd).
2. **Decide indexability per route.** Indexable: durable, standalone,
   content-bearing public pages (`/`, `/demo/packing`, and public lead forms you
   want found). Not indexable: auth pages, OAuth callback, and any URL with a
   per-customer token (`/sign/:token`, `/packing-estimate/verify|result/:token`) —
   these are private and must never enter the sitemap.
3. **sitemap.xml**: one `<url>` per indexable route with absolute `<loc>`, a real
   `<lastmod>` (today for changed pages — get it with `date +%F`), sensible
   `changefreq`, and `priority` (`1.0` for `/`, lower for secondary pages).
4. **robots.txt**: `Allow` the public paths, `Disallow` the private groups
   (`/app/`, `/admin/`, auth routes, `/sign/`), and keep the trailing
   `Sitemap: https://www.scopit.work/sitemap.xml` line.
5. After editing, re-run checklist item 15 to confirm routes, sitemap, and robots
   are mutually consistent.

## Per-route metadata (react-helmet + prerender)

This is a client-rendered SPA with a single `index.html`, so per-route metadata
uses **two cooperating mechanisms** — both already set up in the project:

1. **`react-helmet-async`** (installed) — the reusable `<Seo>` component at
   `frontend/src/components/Seo.tsx` overrides title/description/OG/Twitter per
   route once JS runs. Good for users and JS-rendering crawlers (Googlebot).
2. **Build-time prerender** — `frontend/scripts/prerender-seo.mjs` (runs after
   `vite build`) bakes each listed route's real meta into a static
   `dist/<path>/index.html`, and `frontend/vercel.json` rewrites the path to it.
   This is what fixes **link previews for non-JS scrapers** (KakaoTalk, iMessage,
   Slack, etc.), which never see helmet's client-side updates.

**These must stay in sync.** When adding or changing a public indexable route,
update the `<Seo>` component AND the prerender route entry with the *same*
title/description, plus the `vercel.json` rewrite, sitemap, and robots. Full
step-by-step (and the verify command) is in `references/react-helmet.md`.

The landing page (`/`) intentionally keeps its metadata in the static
`index.html`, since that's the default shell non-JS scrapers read first. Token'd/
private routes must NOT be prerendered — give them a `noindex` `<Seo>` and a
`robots.txt` Disallow.

## Reference files

- `references/structured-data.md` — copy-paste JSON-LD blocks
  (`SoftwareApplication`, `Organization`, `FAQPage`, `BreadcrumbList`) with
  Scopit's values pre-filled.
- `references/react-helmet.md` — step-by-step per-route metadata setup and the
  SPA prerendering caveat.
