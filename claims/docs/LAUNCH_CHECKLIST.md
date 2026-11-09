# Launch checklist

Run `npm run launch-check` first. It catches the content and config blockers automatically. Everything below is the full list, including the manual items.

## Content

- [ ] Final text pasted into the four guides; `status: published` set on each
- [ ] Final text for the four estimating notes; `status: published`
- [ ] State-rule rows written and checked; `verified: true` on each; `lastReviewed` updated
- [ ] FAQ entries added only where the page really answers them
- [ ] Every guide still has a summary, sources, a last-reviewed date, and the disclaimer (the template adds the disclaimer)
- [ ] Real job-site photos added (`photo:` in front matter, and the home hero in `src/pages/index.astro`), with useful alt text. No stock people
- [ ] Home page, checklist, About, and Contact copy reviewed
- [ ] Decision on the "Xactimate" note title (docs/PLAN.md, open question 3)

## Legal (attorney)

- [ ] Privacy, Terms, Disclaimer, and PA Listing Terms reviewed; `attorneyReview: done` set; TODO comments removed
- [ ] Guides with `attorneyReview: pending` reviewed and set to `done`
- [ ] Consent text and application agreements approved (`src/shared/constants.ts`). If the Listing Terms change, bump `LISTING_TERMS_VERSION`
- [ ] Retention period (180 days) approved

## Cloudflare

- [ ] D1 databases created; real `database_id` values in `wrangler.toml`; migrations applied to production and preview
- [ ] Pages project connected with root directory `claims`, build command `npm run build`, output `dist`
- [ ] Build variables set, including `CLAIMS_ENV=production`, `CLAIMS_DIRECTORY_SOURCE=d1`, and the D1 read token
- [ ] Runtime secrets set: `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `BUTTONDOWN_API_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD` (long and random), `IP_HASH_SALT` (long and random), `PAGES_DEPLOY_HOOK_URL`
- [ ] Turnstile widget created for the production hostname; site key in `PUBLIC_TURNSTILE_SITE_KEY`
- [ ] Custom domain attached; HTTPS works
- [ ] Cloudflare Access policy on `/admin*`
- [ ] GitHub secret `CLAIMS_PAGES_DEPLOY_HOOK_URL` set for the nightly rebuild

## Email and newsletter

- [ ] Sending domain verified in Resend (SPF and DKIM records added); `EMAIL_FROM` uses it
- [ ] DMARC record exists for the sending domain
- [ ] Buttondown: double opt-in (confirmation) turned on; API key created; a test signup from the live site sends a confirmation email
- [ ] Test inquiry and test application on production send exactly the expected emails, then delete the test rows

## Search and analytics

- [ ] Plausible site added; `PUBLIC_PLAUSIBLE_DOMAIN` set
- [ ] Search Console property verified (DNS TXT); sitemap submitted
- [ ] If served under `www.scopit.work/claims/`: the main site's `robots.txt` lists the claims sitemap
- [ ] Share a page in Slack or iMessage; the preview image and title look right

## Final checks on the production URL

- [ ] `npm run ci` passes on the release commit
- [ ] Lighthouse (mobile) 95+ on home, a guide, the directory, and the apply page
- [ ] `/admin` asks for a password; wrong password is refused
- [ ] Directory shows only verified listings; the disclosure line is visible on every page
- [ ] No DEV FIXTURE text anywhere (the production build fails if there is)
- [ ] 404 page shows for a made-up URL
