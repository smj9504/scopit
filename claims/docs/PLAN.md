# Scopit Claims: plan and decisions

Built from the "Build Scopit Claims (production website)" brief. This records what was built, the decisions taken where the brief left a choice, and what still needs a decision.

## Stack

| Area | Choice | Why |
| --- | --- | --- |
| Framework | Astro 7, static output, TypeScript strict | Static-first as asked; content collections with typed front matter |
| Styling | Plain CSS with custom properties (`src/styles/global.css`). Same look as Scopit Community (redesigned 2026-11-11): warm white, light-weight headings, black and white pill buttons, cream panels, hairlines, color only in small spheres | The design is bespoke; Tailwind would add a build step without saving much |
| Fonts | Inter, self-hosted Latin subset (300 to 600), metric-matched fallback | Same family as the community (its Pretendard is Inter plus Hangul); no third-party font requests; no layout shift on font swap |
| Hosting | Cloudflare Pages + Pages Functions | As asked. Form logic is portable `Request → Response` code in `src/server/` |
| Storage | **Cloudflare D1** (not KV) | Listings, licenses, and inquiries are relational; verification needs queries like "verified and not expired". D1 is SQLite, so the same SQL runs on Turso if you move to Vercel |
| Spam | Cloudflare Turnstile + per-IP rate limit (salted hash) + Origin check | |
| Email | Resend via one adapter (`src/server/email.ts`) | Swappable; a log provider is used locally and is refused in production |
| Newsletter | Buttondown via one adapter (`src/server/newsletter.ts`) | Buttondown applies double opt-in to every API signup by default, and the adapter never bypasses it |
| Analytics | **Search Console only** (decided 2026-11-10, to keep running costs at $0). Plausible can be switched on later with one setting | **No cookie banner needed**: no cookies, no trackers, nothing that requires consent |
| Admin | **Password-protected `/admin`** (one Pages Function, no JS) + documented D1 SQL fallback | Lighter to run day to day than SQL by hand; tiny attack surface; Cloudflare Access can be added on top if `scopit.work`'s DNS ever moves to Cloudflare (it is on Namecheap) |
| Email address | **claims@scopit.work** for both sending (`EMAIL_FROM`) and the public contact address (decided 2026-11-10) | One address for the claims site, separate from the app's `hello@`/`no-reply@`. Replies arrive through a Namecheap email forwarder. Emails and pages keep saying Scopit is not an insurer or adjuster, since a `claims@` address could suggest otherwise |
| Domain | **claims.scopit.work** (decided 2026-11-09) | Own Pages project and DNS record; no change to the Vercel frontend. The base path stays configurable (`CLAIMS_BASE`) |
| Directory data | D1 is the source of truth; pages are built from it at build time via the D1 REST API | Keeps every public page static; approvals trigger a rebuild; a nightly rebuild drops expired licenses |

## Legal guardrails, and where each is enforced

| Guardrail | Where |
| --- | --- |
| Disclosure line on every page that mentions a PA or the directory | Footer of every page, plus inline on directory, profile, inquiry, adjuster, apply, about, and legal pages. `verify-dist` fails if any page lacks it |
| Never show unverified listings | `src/shared/directory.ts` (one rule used by the build and by the inquiry function); tests in `tests/directory.test.ts` |
| "License verified on [date]" shown publicly | Profile and directory license lines |
| No fees or payments | No payment code anywhere; agreements on the application; PA Listing Terms |
| Inquiry goes only to selected PAs, with consent | `handleInquiry` emails each selected PA separately (reply-to = homeowner); exact consent text stored; tested |
| PA must be licensed where the property is | Inquiry is refused unless each selected PA has a verified, current license in that state |
| No fake data in production | Dev fixture is labeled, noindexed, and refused on Cloudflare and production builds; postbuild fails if "DEV FIXTURE" appears in a production build |
| State rules cite a source and show a review date | `stateRules` schema requires `sourceUrl` and `lastReviewed` per row; unverified rows show "Pending review" |
| Legal pages are drafts until reviewed | `attorneyReview: pending` shows a banner, noindexes the page, and blocks `launch-check` |
| No email beyond confirmations and inquiries | Only five templates exist (`src/server/email-templates.ts`) |

## Phases (all done in this branch)

1. Scaffold, tokens, layout, header and footer
2. Homeowner pages, guide template, four starter guides (placeholders)
3. Adjuster pages, newsletter, listing application, storage
4. Directory, profiles, inquiry flow, `/admin` verification
5. Legal drafts, SEO (OG images, sitemap, robots, JSON-LD), security headers, accessibility and performance passes
6. Deployment guide, launch checklist, CI

Checks at the end: `astro check` 0 errors; 51 unit and integration tests; 22 pages pass `verify-dist`; axe-core finds no violations at 360px or 1280px; Lighthouse mobile scores 100 for Performance, Accessibility, and Best Practices, and 100 for SEO on indexable pages (CLS 0). End to end on `wrangler pages dev` with local D1: apply, verify, approve, inquiry.

## Open questions (need a decision)

1. **"Xactimate" in a note title.** The Scopit product brief (PRODUCT.md) says marketing should not name competitors. The claims brief asked for "Xactimate habits that save a supplement". I kept your title and added a trademark note in the file. Keep it, or retitle to "Estimate-writing habits that save a supplement"?
2. **Home page copy.** The "Before the plumber leaves" checklist and the hero, about strip, About, and Contact copy are written and live (not placeholders). Please review the wording.
3. **Retention.** Inquiries are deleted after 180 days (`INQUIRY_RETENTION_DAYS`). Confirm with counsel.
4. **Max adjusters per inquiry.** Set to 3. Change `LIMITS.maxAdjustersPerInquiry` if you want more.
5. **"Listing is live" email to the PA** on approval. It is a confirmation to the applicant, not to a homeowner, but confirm you want it.
6. **Rejections** send no automatic email. Reply personally, or should there be a template?

## For the attorney

- Privacy, Terms, Disclaimer, PA Listing Terms (`src/content/legal/`): drafts. Each has a TODO comment listing specific questions (applicable state privacy laws, governing law, liability cap, solicitation rules).
- `can-you-file-a-claim-after-repairs` and `what-is-a-public-adjuster`: state-rule tables need the rule text written and verified (`verified: true`). Sources are linked per row.
- Inquiry consent wording (`INQUIRY_CONSENT` in `src/shared/constants.ts`) and application agreements (`APPLICATION_AGREEMENTS`).
- Whether directory messages raise any solicitation-timing issue under VA § 38.2-1845.x, MD Ins. § 10-4xx, or D.C. Code § 31-1631.08 (the homeowner always initiates).
