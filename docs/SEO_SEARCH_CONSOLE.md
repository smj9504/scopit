# Getting Scopit indexed — Google Search Console guide

This is the step-by-step for registering `www.scopit.work` with Google Search
Console (GSC), submitting the sitemap, and requesting indexing for the packing
pages. On-page SEO (titles, content, sitemap, structured data) is already in the
codebase — this guide covers the part that happens in Google's console, which
only a human with account access can do.

**Canonical origin:** `https://www.scopit.work` (always `https`, always `www`).

---

## 0. Before you start — confirm redirects

Google should see exactly one address for the site. In your **Vercel** project
→ **Settings → Domains**, make sure:

- `scopit.work` (apex) **redirects to** `www.scopit.work`, and
- `http://` redirects to `https://`.

If both non-www and www resolve with `200`, Google can split ranking signals
between them. The whole site is built around the `www` host, so `www` should be
the primary and everything else should 301-redirect to it.

---

## 1. Add the property in Search Console

1. Go to <https://search.google.com/search-console> and sign in with the Google
   account that should own the site's search data.
2. Click **Add property**. You get two choices:
   - **Domain** (recommended) — covers every subdomain and both `http`/`https`.
     Verified with one DNS record.
   - **URL prefix** — covers only `https://www.scopit.work`. More verification
     options (HTML tag, file, Google Analytics, etc.).
3. Recommended: choose **Domain** and enter `scopit.work`.

### Verify a Domain property (DNS TXT)

1. GSC shows a `TXT` record like `google-site-verification=xxxxxxxx`.
2. In **Vercel → your project → Settings → Domains** (or wherever `scopit.work`'s
   DNS is managed), add a **TXT** record:
   - **Name/Host:** `@` (the apex)
   - **Value:** the full `google-site-verification=…` string
3. Save, wait a few minutes for DNS to propagate, then click **Verify** in GSC.

### Alternative: verify a URL-prefix property (HTML tag)

If DNS is awkward, add a URL-prefix property for `https://www.scopit.work` and
pick the **HTML tag** method. It gives you a
`<meta name="google-site-verification" content="…">` tag. Send me that token and
I'll add it to `frontend/index.html` (site-wide `<head>`); once it deploys,
click **Verify**. The tag can stay in place permanently.

---

## 2. Submit the sitemap

1. In GSC, open the property → **Sitemaps** (left nav, under "Indexing").
2. Under **Add a new sitemap**, enter `sitemap.xml` and **Submit**.
   (Full URL: `https://www.scopit.work/sitemap.xml`.)
3. Status should become **Success** with the number of discovered URLs. It's
   already referenced from `robots.txt`, so Google will also find it on its own,
   but submitting it here is faster and lets you watch coverage.

---

## 3. Request indexing for the key pages

Sitemaps tell Google the pages exist; **URL Inspection** asks it to crawl them
now. Do this once per important URL:

1. Paste a URL into the **search bar at the top** of GSC ("Inspect any URL").
2. Wait for the check, then click **Request indexing**.
3. Repeat for each URL below.

Priority order (hub + spokes first):

```
https://www.scopit.work/packing-calculator
https://www.scopit.work/pack-out-estimate
https://www.scopit.work/insurance-packing-estimate
https://www.scopit.work/packing-report
https://www.scopit.work/demo/packing
https://www.scopit.work/packing-estimate
https://www.scopit.work/
```

Notes:
- There's a daily quota on manual "Request indexing" (roughly a dozen URLs/day) —
  the list above fits well within it.
- Requesting indexing does **not** guarantee or speed up ranking; it only gets
  the page crawled and considered. Initial indexing typically takes anywhere from
  a day to a couple of weeks.

---

## 4. Confirm the pages are indexable (spot-check)

For each page in URL Inspection, look for:

- **"URL is on Google"** (after it's indexed), or **"URL is available to Google"**
  before you request indexing.
- **Coverage → Indexing allowed? Yes.**
- **Page indexing → Referring sitemaps** lists your sitemap.
- Click **View crawled page → More info** and confirm the **title** and
  **description** match the page (the prerendered shell bakes these in, so even
  Google's non-JS pass sees the right values).
- Use **Test live URL → View tested page** and check the rendered HTML has the
  page's real `<h1>` and content.

To check structured data (FAQ / Breadcrumb rich results), run the page through
the **Rich Results Test**: <https://search.google.com/test/rich-results>.

---

## 5. Monitor (check back weekly, then monthly)

- **Pages** (Indexing) — how many URLs are indexed vs. excluded, and why. Watch
  for "Crawled – currently not indexed" or "Discovered – not indexed" on the new
  pages; that usually resolves as the site gains a little authority.
- **Performance → Search results** — the queries you actually appear for, plus
  impressions, clicks, and average position. This is where you'll see whether
  "packing calculator", "pack-out estimate", etc. start showing your pages. Add
  the target terms as filters to track them.
- **Enhancements** — FAQ / Breadcrumb rich-result eligibility and any errors.

---

## 6. Bonus: Bing Webmaster Tools (5 minutes, real traffic)

Bing powers Bing + a share of other search surfaces and is much easier to rank
on for a new site.

1. Go to <https://www.bing.com/webmasters> and sign in.
2. **Import** the site directly from Google Search Console (one click), or add
   `https://www.scopit.work` and verify.
3. Submit `https://www.scopit.work/sitemap.xml`.

---

## Realistic expectations

On-site SEO — which is what's in the repo — is necessary but not sufficient:

- **Indexing:** days to ~2 weeks after requesting.
- **Ranking:** weeks to months, and competitive head terms like "packing
  calculator" are hard. Expect **brand + long-tail** queries to land first
  (e.g. "scopit packing calculator", "restoration pack-out estimate software",
  "insurance contents packing breakdown").
- **What moves the needle next:** genuinely useful content (done), internal links
  (done — hub/spoke cluster + landing footer), and over time **external links**
  and mentions from real sites. Backlinks are the single biggest off-site factor
  and can't be set in code.

---

## What's already handled in the codebase (for reference)

- `frontend/public/sitemap.xml` — lists all indexable public URLs.
- `frontend/public/robots.txt` — allows public paths, disallows private ones,
  points at the sitemap.
- `frontend/index.html` — site-wide meta + `SoftwareApplication` JSON-LD.
- `frontend/scripts/prerender-seo.mjs` — bakes per-route title/description/
  canonical into static shells so non-JS crawlers see correct metadata.
- Packing topic cluster: `/packing-calculator` (hub) + `/pack-out-estimate`,
  `/insurance-packing-estimate`, `/packing-report` (spokes), each with its own
  content, FAQ, and `BreadcrumbList` + `FAQPage` structured data.
