# Scopit Claims

A free educational site and license-verified public adjuster directory for property insurance claims in Virginia, Maryland, and DC. Run by Scopit.

This folder is a **separate site**. It does not import anything from `../frontend` or `../backend`, has its own `package.json` and lockfile, builds on its own, and deploys to its own Cloudflare Pages project. You can move it into its own repository with `git subtree split --prefix claims`.

- Homeowner side: `/`, `/guides/`, `/what-is-a-public-adjuster/`, `/find-an-adjuster/`
- Adjuster side: `/for-adjusters/`, `/for-adjusters/notes/`, `/for-adjusters/apply/`
- Shared: `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/disclaimer/`, `/listing-terms/`, 404
- Admin: `/admin` (license verification; Basic auth)

## Quick start

```bash
cd claims
npm install
npm run dev              # http://localhost:4321, empty directory
npm run dev:fixtures     # same, with the labeled DEV FIXTURE adjusters
```

To run the forms and `/admin` locally (Pages Functions + local D1):

```bash
cp .dev.vars.example .dev.vars          # test Turnstile secret, admin password, log-only email
npm run db:migrate:local
npm run build
npm run preview                          # http://localhost:8788, /admin uses ADMIN_USER / ADMIN_PASSWORD from .dev.vars
```

Locally, emails are printed to the terminal (`EMAIL_PROVIDER=log`) instead of sent.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run ci` | Type check, unit tests, build, and built-site checks. Run before every push. |
| `npm run check` | `astro check` (TypeScript across pages, server code, functions, tests) |
| `npm test` | Vitest: validation, directory rules, form handlers, admin workflow (real SQL on an in-memory SQLite) |
| `npm run build` | `astro build`, then `scripts/postbuild.mjs` (sitemap, robots.txt, `_headers`, guards) |
| `npm run verify` | `scripts/verify-dist.mjs`: titles, descriptions, canonicals, one h1, disclosure on every page, links, alt text |
| `npm run a11y` | axe-core on every built page at 360px and 1280px, plus horizontal-scroll check (uses the machine's Playwright) |
| `npm run launch-check` | Lists launch blockers (placeholder text, pending attorney review, unverified state rules, placeholder D1 ids). Exits 1 until clear. |
| `npm run preview` | `wrangler pages dev dist` with Functions and local D1 |
| `npm run db:migrate:local` / `:remote` / `:preview` | Apply `migrations/` to the local, production, or preview D1 |

## How it fits together

```
claims/
├── astro.config.mjs        # site + base path from CLAIMS_SITE / CLAIMS_BASE
├── wrangler.toml           # Pages config: D1 binding, non-secret vars per environment
├── migrations/             # D1 schema (listings, licenses, inquiries, rate limits)
├── functions/              # Cloudflare Pages Functions (thin wrappers)
│   ├── api/inquiry.ts      # POST: homeowner message to selected adjusters
│   ├── api/apply.ts        # POST: PA listing application
│   ├── api/newsletter.ts   # POST: adjuster-notes signup (double opt-in at Buttondown)
│   └── admin/[[path]].ts   # /admin verification tool
├── public/                 # fonts (self-hosted Inter), favicon
├── scripts/                # postbuild, verify-dist, launch-check, a11y
├── src/
│   ├── content/            # Markdown: guides/, notes/, legal/
│   ├── content.config.ts   # typed collections (guides, notes, legal, adjusters)
│   ├── directory/          # build-time loader: verified listings from D1 (REST API)
│   ├── dev-fixtures/       # DEV FIXTURE adjusters, local only, refused on Cloudflare
│   ├── server/             # handlers, validation, D1 queries, email, newsletter, admin
│   ├── shared/             # constants and rules used by both pages and functions
│   ├── components/ layouts/ pages/ styles/ scripts/
│   └── site.ts             # site settings, href() for base-path-safe links
└── tests/                  # Vitest
```

**Static first.** Every page is static HTML. The directory pages are built from D1 at build time, using only listings an admin verified. After an approval or removal, `/admin` calls the Pages deploy hook to rebuild. A nightly GitHub Action rebuilds too, so expired licenses drop off (`.github/workflows/claims-nightly-rebuild.yml`). Inquiries re-check the license against D1 at send time, so an unlisted or expired adjuster can never receive a message.

**Portable.** The form logic lives in `src/server/` as plain `Request → Response` functions. `functions/` only adapts them to Cloudflare. To move to Vercel, wrap the same handlers in Vercel functions and replace D1 with a SQLite-compatible database such as Turso; the schema and SQL stay the same. See `docs/DEPLOY.md`.

## Content

Guides, notes, and legal pages are Markdown with typed front matter (see `src/content.config.ts`). Keep the `##` headings; they build the table of contents.

| Field | Meaning |
| --- | --- |
| `status` | `placeholder`, `draft`, or `published`. Anything but `published` shows a banner, is noindexed, is left out of the sitemap, and blocks launch. |
| `lastReviewed` | Shown on the page and in lists. Update it whenever you re-check the page and its sources. |
| `sources` | At least one per guide. `https` URLs only. |
| `stateRules` | Every state deadline or rule goes here, each with `sourceUrl` and `lastReviewed`. Rows with `verified: false` show "Pending review" instead of the rule text. |
| `attorneyReview` | `pending` shows "Needs attorney review before launch" and blocks launch. |
| `faq` | Only real questions answered on the page. Emits FAQPage schema once the guide is published. |
| `photo` | `{ src, alt }` for a real job-site photo. Without it a neutral placeholder is shown (`// TODO: real photo`). |

Verified official source links for VA, MD, and DC are listed in `docs/SOURCES.md`.

## Docs

- `docs/OPERATIONS.ko.md`: 한국어 운영 요약 (할 일 순서, 평소 운영, 문제 해결)
- `docs/PLAN.md`: plan, decisions, and open questions
- `docs/DEPLOY.md`: Cloudflare setup, environment variables, DNS, email domain, Turnstile, Buttondown, Search Console
- `docs/ADMIN.md`: how to verify a public adjuster license and run the directory
- `docs/LAUNCH_CHECKLIST.md`: everything to finish before launch
- `docs/SOURCES.md`: official sources checked on 2026-11-09
