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
- [ ] Decision on the "Xactimate" note title (docs/PLAN.md, open question 1)

## Legal (attorney)

- [ ] Privacy, Terms, Disclaimer, and PA Listing Terms reviewed; `attorneyReview: done` set; TODO comments removed
- [ ] Guides with `attorneyReview: pending` reviewed and set to `done`
- [ ] Consent text and application agreements approved (`src/shared/constants.ts`). If the Listing Terms change, bump `LISTING_TERMS_VERSION`
- [ ] Retention period (180 days) approved

## Cloudflare

- [ ] D1 databases created; real `database_id` values in `wrangler.toml`; migrations applied to production and preview
- [ ] Pages project connected with root directory `claims`, build command `npm run build`, output `dist`
- [ ] `wrangler.toml` production vars filled in (`PUBLIC_TURNSTILE_SITE_KEY`, site URL, contact email); build secrets `CF_D1_API_TOKEN` and `CF_ACCOUNT_ID` set; first build log shows `using wrangler.toml env "production"` and `Loaded N verified listing row(s) from D1`
- [ ] Runtime secrets set: `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `BUTTONDOWN_API_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD` (long and random), `IP_HASH_SALT` (long and random), `PAGES_DEPLOY_HOOK_URL`
- [ ] Turnstile widget created for the production hostname; site key in `PUBLIC_TURNSTILE_SITE_KEY`
- [ ] Custom domain `claims.scopit.work` added in Pages first, then the `claims` CNAME added in Namecheap Advanced DNS; HTTPS works
- [ ] `ADMIN_PASSWORD` is long and random, shared only with the people who verify licenses
- [ ] GitHub secret `CLAIMS_PAGES_DEPLOY_HOOK_URL` set for the nightly rebuild

## Email and newsletter

- [ ] `scopit-claims` API key created in the existing Resend account; `EMAIL_FROM` is `claims@scopit.work`; replies to `claims@scopit.work` reach someone
- [ ] `claims` forwarder added in Namecheap Email Forwarding; a test reply to `claims@scopit.work` arrives
- [ ] Resend shows every `scopit.work` record as Verified (DMARC already exists)
- [ ] Buttondown API key set; a test signup from the live site gets a confirmation email and stays unconfirmed until clicked
- [ ] Test inquiry and test application on production send exactly the expected emails, then delete the test rows

## Search and analytics

- [ ] Search Console property verified (DNS TXT); sitemap submitted
- [ ] Share a page in Slack or iMessage; the preview image and title look right

## Final checks on the production URL

- [ ] `npm run ci` passes on the release commit
- [ ] Lighthouse (mobile) 95+ on home, a guide, the directory, and the apply page
- [ ] `/admin` asks for a password; wrong password is refused
- [ ] Directory shows only verified listings; the disclosure line is visible on every page
- [ ] No DEV FIXTURE text anywhere (the production build fails if there is)
- [ ] 404 page shows for a made-up URL
