# Structured data (JSON-LD) blocks for Scopit

Copy the closest block, fill in the bracketed parts, and embed it as
`<script type="application/ld+json">…</script>` in `frontend/index.html` (site-wide)
or via the `<Seo>` component (per route). Only mark up content that is actually
visible on the page — inventing offers, prices, or ratings is a structured-data
policy violation and can get rich results suppressed.

All URLs use the canonical origin `https://www.scopit.work`.

## SoftwareApplication (site-wide — this is the primary one, already in index.html)

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Scopit",
  "url": "https://www.scopit.work/",
  "description": "Simple estimating and invoicing software for restoration contractors. Create professional estimates, convert them to invoices, and manage customers.",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Free beta access"
  },
  "provider": {
    "@type": "Organization",
    "name": "Scopit",
    "url": "https://www.scopit.work/",
    "email": "hello@scopit.work"
  }
}
```

Keep `offers.price` in sync with reality — while the product is a free beta, `"0"`
is correct. When pricing launches, update it or remove `offers` rather than
leaving a stale price.

## Organization (optional, for brand/knowledge-panel signals)

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Scopit",
  "url": "https://www.scopit.work/",
  "email": "hello@scopit.work",
  "logo": "https://www.scopit.work/og-image.png",
  "sameAs": [
    "[LinkedIn URL if any]",
    "[X/Twitter URL if any]"
  ]
}
```

Drop `sameAs` entirely if there are no real profiles — don't ship empty or
placeholder URLs.

## FAQPage (only if the page actually renders these Q&As)

Useful on the landing page or a pricing/FAQ section. Every `Question` here MUST
appear as visible text on the page, or Google treats it as spam.

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "[Visible question text]",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "[Visible answer text]"
      }
    }
  ]
}
```

## BreadcrumbList (for deeper public pages, e.g. a demo under a section)

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://www.scopit.work/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "[Page name]",
      "item": "https://www.scopit.work/[path]"
    }
  ]
}
```

## Validation

After adding or editing JSON-LD:
- Confirm it parses as JSON (a trailing comma or unquoted key will silently break
  the whole block).
- Sanity-check that `@type` matches the page and that no marked-up field claims
  something the page doesn't show.
- Point the user to Google's Rich Results Test (search.google.com/test/rich-results)
  and the Schema Markup Validator (validator.schema.org) for a live check — these
  need the deployed URL.
