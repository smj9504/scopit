# Deploying Scopit Claims

Scopit Claims deploys on its own, to a separate Cloudflare Pages project. Nothing here touches the Scopit app (Vercel frontend, Render backend, Neon database).

```
GitHub (this repo, claims/)
  └─ Cloudflare Pages project "scopit-claims"
       ├─ static site  (astro build → dist/)
       ├─ Pages Functions  /api/inquiry, /api/apply, /api/newsletter, /admin
       ├─ D1 database "scopit-claims"  (+ "scopit-claims-preview")
       └─ custom domain claims.scopit.work
External services: Resend (email), Buttondown (newsletter), Plausible (analytics),
Cloudflare Turnstile (spam), Google Search Console.
```

## 1. Create the D1 databases

```bash
cd claims
npx wrangler login
npx wrangler d1 create scopit-claims
npx wrangler d1 create scopit-claims-preview
```

Copy each printed `database_id` into `wrangler.toml`: `scopit-claims` goes in the top-level and `[env.production]` blocks, `scopit-claims-preview` in `[env.preview]`. Then apply the schema:

```bash
npx wrangler d1 migrations apply scopit-claims --remote
npx wrangler d1 migrations apply scopit-claims-preview --remote
```

New migrations go in `migrations/` as `0002_*.sql`, and so on. Apply them the same way before deploying code that needs them.

## 2. Create the Pages project

Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git > select this repository.

| Setting | Value |
| --- | --- |
| Project name | `scopit-claims` (must match `name` in `wrangler.toml`) |
| Production branch | `main` |
| Framework preset | None (Astro works too) |
| Root directory | `claims` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | from `claims/.nvmrc` (22.23.4); set `NODE_VERSION=22.23.4` if the build image ignores it |

Because `wrangler.toml` exists, Cloudflare reads the D1 binding and the non-secret runtime variables (`[vars]`, `[env.preview.vars]`, `[env.production.vars]`) from it. Edit them in the file, not the dashboard.

To stop the Scopit app's commits from rebuilding this site, set **Build watch paths** (Settings > Builds) to include `claims/*`.

## 3. Environment variables

### Build time (Pages > Settings > Variables and Secrets, Production and Preview)

| Name | Example | Secret? | Notes |
| --- | --- | --- | --- |
| `CLAIMS_SITE` | `https://claims.scopit.work` | no | Public origin used for canonical URLs, Open Graph, and the sitemap |
| `CLAIMS_BASE` | `/` | no | `/claims` only for the sub-path setup (section 7) |
| `CLAIMS_ENV` | `production` | no | Production builds refuse fixtures and require `CLAIMS_DIRECTORY_SOURCE=d1` |
| `CLAIMS_DIRECTORY_SOURCE` | `d1` | no | Where directory pages come from |
| `CF_ACCOUNT_ID` | `abc123…` | no | Cloudflare account id |
| `CF_D1_DATABASE_ID` | the production D1 id | no | Use the preview id in the Preview environment |
| `CF_D1_API_TOKEN` | API token | **yes** | Create at My Profile > API Tokens > Custom token with only **Account > D1 > Read** |
| `PUBLIC_TURNSTILE_SITE_KEY` | `0x4AAA…` | no | From the Turnstile widget (section 4) |
| `PUBLIC_PLAUSIBLE_DOMAIN` | `claims.scopit.work` | no | Leave empty to load no analytics script |
| `PUBLIC_CONTACT_EMAIL` | `hello@scopit.work` | no | Shown on Contact and in form fallbacks |
| `PUBLIC_GSC_VERIFICATION` | | no | Optional; DNS verification is better |

On the first production deploy, check the build log for `Loaded N verified listing row(s) from D1.` If the token or ids are wrong, the build **fails** rather than publishing an empty or stale directory.

### Runtime secrets (Pages > Settings > Variables and Secrets, type "Secret", or `npx wrangler pages secret put NAME`)

| Name | Notes |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | From the Turnstile widget |
| `RESEND_API_KEY` | Resend > API Keys, "Sending access" for the claims domain only |
| `EMAIL_FROM` | e.g. `Scopit Claims <claims@send.scopit.work>` on the Resend-verified domain |
| `ADMIN_NOTIFY_EMAIL` | Where new application notices go |
| `BUTTONDOWN_API_KEY` | Buttondown > Settings > API |
| `BUTTONDOWN_TAGS` | Optional, default `scopit-claims-adjuster-notes` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | `/admin` sign-in. Use a long random password (`openssl rand -base64 24`). Without both, `/admin` is off (404) |
| `IP_HASH_SALT` | Random string (`openssl rand -hex 32`) for rate-limit hashing |
| `PAGES_DEPLOY_HOOK_URL` | Section 5. Lets `/admin` rebuild the directory after approvals |

Non-secret runtime values (`CLAIMS_ENV`, `CLAIMS_SITE`, `CLAIMS_BASE`, `EMAIL_PROVIDER`, `NEWSLETTER_PROVIDER`) are in `wrangler.toml`. Production uses `EMAIL_PROVIDER=resend` and `NEWSLETTER_PROVIDER=buttondown`. The `log` providers are refused when `CLAIMS_ENV=production`, so a missing key fails loudly (HTTP 503) instead of silently dropping mail.

## 4. Turnstile

Dashboard > Turnstile > Add widget. Name it `scopit-claims`, add hostnames `claims.scopit.work` and `scopit-claims.pages.dev` (plus `www.scopit.work` for the sub-path setup), mode **Managed**. Put the site key in `PUBLIC_TURNSTILE_SITE_KEY` (build) and the secret in `TURNSTILE_SECRET_KEY` (runtime).

Locally, the code falls back to Cloudflare's always-pass test keys, so forms work without a real widget.

## 5. Deploy hook and nightly rebuild

Pages > Settings > Builds > Deploy hooks > Add: name `admin-and-nightly`, branch `main`. Copy the URL into:

- the `PAGES_DEPLOY_HOOK_URL` runtime secret, so `/admin` rebuilds after approvals and removals
- the GitHub repository secret `CLAIMS_PAGES_DEPLOY_HOOK_URL`, which `.github/workflows/claims-nightly-rebuild.yml` calls daily so expired licenses drop off the directory

Treat the hook URL like a password: anyone with it can trigger builds.

## 6. Custom domain: claims.scopit.work (recommended)

Pages > Custom domains > Set up a domain > `claims.scopit.work`. `scopit.work` is on Cloudflare DNS, so Cloudflare adds the CNAME record itself. Nothing changes on the Vercel or Render side.

## 7. Alternative: www.scopit.work/claims/

Use this only if the site must live under the main domain. The main site is on Vercel, so the Scopit frontend has to proxy `/claims/*` to Pages:

1. Build with `CLAIMS_SITE=https://www.scopit.work` and `CLAIMS_BASE=/claims`, and set `CLAIMS_SITE`/`CLAIMS_BASE` in `wrangler.toml` `[env.production.vars]` the same way.
2. In `frontend/vercel.json`, add these rewrites **before** the SPA catch-all:
   ```json
   { "source": "/claims", "destination": "https://scopit-claims.pages.dev/" },
   { "source": "/claims/:path*", "destination": "https://scopit-claims.pages.dev/:path*" }
   ```
3. Add `Sitemap: https://www.scopit.work/claims/sitemap.xml` to the main site's `robots.txt`. Crawlers only read `/robots.txt` at the domain root.
4. Add `www.scopit.work` to the Turnstile widget's hostnames.

Downsides: the main frontend's deploys now depend on this rewrite; requests reach Pages through Vercel, so the visitor IP that Cloudflare sees (and the per-IP rate limit) is Vercel's; and `/admin` sits behind two hosts. This is why the subdomain is recommended.

## 8. Email: Resend and the sending domain

1. Resend > Domains > Add `send.scopit.work`. A subdomain keeps claims mail reputation separate from the root domain.
2. Add the DNS records Resend shows (SPF `TXT` and `MX` on the bounce subdomain, DKIM `TXT`) in Cloudflare DNS, set to **DNS only**. Wait for "Verified".
3. If `scopit.work` has no DMARC record yet, add `_dmarc.scopit.work TXT "v=DMARC1; p=none; rua=mailto:dmarc@scopit.work"`, then tighten it to `quarantine` once reports look clean.
4. Set `EMAIL_FROM` to an address on that domain. Replies to inquiry emails go to the homeowner (reply-to); replies to confirmations go to `EMAIL_FROM`, so make sure that mailbox exists or forwards somewhere.

The site sends only: an inquiry to each selected adjuster, one confirmation to the homeowner who sent it, an application confirmation to the PA, an application notice to `ADMIN_NOTIFY_EMAIL`, and a "listing is live" notice to the PA on approval.

## 9. Newsletter: Buttondown

1. Create the newsletter (for example "Scopit estimating notes").
2. Settings > Subscribing: turn on **double opt-in** (subscribers must confirm).
3. Settings > API: create a key and set `BUTTONDOWN_API_KEY`.
4. From the live `/for-adjusters/` page, subscribe a test address and confirm a confirmation email arrives **before** the address shows as active. If the test address is added without confirming, fix the Buttondown setting before launch.

To switch providers, implement `NewsletterProvider` in `src/server/newsletter.ts`; nothing else changes.

## 10. Analytics and Search Console

- **Plausible:** add the site `claims.scopit.work` and set `PUBLIC_PLAUSIBLE_DOMAIN`. The script loads only when that variable is set, and `postbuild` adds Plausible to the CSP automatically. Plausible sets no cookies, so no cookie banner is needed.
- **Search Console:** add a Domain property for `scopit.work` (DNS TXT record in Cloudflare), or a URL-prefix property for `https://claims.scopit.work/`. Submit `https://claims.scopit.work/sitemap.xml`. The sitemap lists only pages that are published (not placeholder, draft, or pending legal review).

## 11. Protect /admin with Cloudflare Access (recommended)

Zero Trust > Access > Applications > Add > Self-hosted: domain `claims.scopit.work`, path `admin*`. Policy: Allow, emails ending in `@scopit.work` (or a list of staff addresses). Keep the Basic-auth password too.

## 12. Deploy and smoke test

Push to `main` (or click Retry deployment). Then:

```bash
curl -sI https://claims.scopit.work/ | grep -i content-security-policy
curl -s https://claims.scopit.work/robots.txt
curl -s -o /dev/null -w "%{http_code}\n" https://claims.scopit.work/admin   # 401 (or Access login)
curl -s -o /dev/null -w "%{http_code}\n" https://claims.scopit.work/api/apply  # 405 for GET
```

Submit one real test application and one test inquiry (to a test listing you verified and approved), check the emails, then remove the test rows:

```bash
npx wrangler d1 execute scopit-claims --remote --command "DELETE FROM listings WHERE email = 'you+test@scopit.work'"
npx wrangler d1 execute scopit-claims --remote --command "DELETE FROM inquiries WHERE email = 'you+test@scopit.work'"
```

Then work through `docs/LAUNCH_CHECKLIST.md`.

## Moving to Vercel later

- Static site: Astro builds the same `dist/`. Set `CLAIMS_SITE`/`CLAIMS_BASE` the same way.
- Functions: create `api/inquiry.ts`, `api/apply.ts`, `api/newsletter.ts`, and `api/admin/[...path].ts` that call the same handlers in `src/server/handlers.ts` and `src/server/admin.ts` with an `Env` object.
- Database: D1 is SQLite. Use Turso/libSQL (also SQLite), run `migrations/*.sql` there, and write a small adapter implementing `D1Like` (`src/server/d1.ts`). The SQL does not change.
- Build-time directory: point `src/directory/loader.ts` at the new database instead of the D1 REST API.
- `_headers` (CSP and security headers) moves to `vercel.json` `headers`.
