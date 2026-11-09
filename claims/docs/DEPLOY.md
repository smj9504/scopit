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
| Node.js version | from `claims/.nvmrc` (22.23.4). The v3 build image reads `.nvmrc` and ships Node 22.23.4 by default |
| Build system | v3 (the default for new projects; a Wrangler config file needs v2 or later) |

Because `wrangler.toml` exists, it is the source of truth: Cloudflare reads the D1 binding and all non-secret variables from it, and the dashboard shows those fields read-only. Edit them in the file. Secrets are the exception: add them in the dashboard (Settings > Variables and Secrets > Add > **Encrypt**) or with `wrangler pages secret put`.

To stop the Scopit app's commits from rebuilding this site, set **Build watch paths** (Settings > Builds) to include `claims/*`.

## 3. Environment variables

### Build time

Cloudflare's docs don't promise that `wrangler.toml` `[vars]` reach the build step, so the build reads them itself: on a Cloudflare build (`CF_PAGES=1`), `scripts/build-env.mjs` loads `[env.production.vars]` when the branch is `main` (or `CLAIMS_PRODUCTION_BRANCH`) and `[env.preview.vars]` otherwise, plus that environment's D1 `database_id`. Values already set in the environment take precedence. The build log shows `[claims] Cloudflare build: using wrangler.toml env "production"`.

Non-secret build settings, in `wrangler.toml` under `[env.production.vars]` and `[env.preview.vars]`:

| Name | Production value | Notes |
| --- | --- | --- |
| `CLAIMS_SITE` | `https://claims.scopit.work` | Public origin for canonical URLs, Open Graph, the sitemap, and email links |
| `CLAIMS_BASE` | `""` | Empty for claims.scopit.work. Only `/claims` if the site ever moves to a sub-path (section 7) |
| `CLAIMS_ENV` | `production` | Production builds refuse fixtures and require the D1 source |
| `CLAIMS_DIRECTORY_SOURCE` | `d1` | Where directory pages come from |
| `PUBLIC_TURNSTILE_SITE_KEY` | from section 4 | Public value; **fill this in before the first deploy** |
| `PUBLIC_PLAUSIBLE_DOMAIN` | `claims.scopit.work` | Empty means no analytics script |
| `PUBLIC_CONTACT_EMAIL` | `hello@scopit.work` | Shown on Contact and in form fallbacks |

Encrypted secrets for the build (dashboard > Settings > Variables and Secrets > Add > **Encrypt**, for both Production and Preview):

| Name | Notes |
| --- | --- |
| `CF_D1_API_TOKEN` | My Profile > API Tokens > Create custom token with only **Account > D1 > Read** for this account |
| `CF_ACCOUNT_ID` | Your Cloudflare account id (not secret, but stored as a secret because the config file owns plain variables) |

On the first production deploy, check the build log for `Loaded N verified listing row(s) from D1.` If the token or ids are wrong, the build **fails** rather than publishing an empty or stale directory. Cloudflare's docs say dashboard variables reach the build and imply secrets do too. If a build reports a missing `CF_D1_API_TOKEN` even though it is set, check the variable is defined for the right environment (Production vs Preview).

### Runtime secrets (Pages > Settings > Variables and Secrets, type "Secret", or `npx wrangler pages secret put NAME`)

| Name | Notes |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | From the Turnstile widget |
| `RESEND_API_KEY` | Resend > API Keys, "Sending access" for the claims domain only |
| `EMAIL_FROM` | e.g. `Scopit Claims <claims@mail.scopit.work>` on the Resend-verified domain |
| `ADMIN_NOTIFY_EMAIL` | Where new application notices go |
| `BUTTONDOWN_API_KEY` | Buttondown > Settings > API |
| `BUTTONDOWN_TAGS` | Optional, default `scopit-claims-adjuster-notes` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | `/admin` sign-in. Use a long random password (`openssl rand -base64 24`). Without both, `/admin` is off (404) |
| `IP_HASH_SALT` | Random string (`openssl rand -hex 32`) for rate-limit hashing |
| `PAGES_DEPLOY_HOOK_URL` | Section 5. Lets `/admin` rebuild the directory after approvals |

Non-secret runtime values (`CLAIMS_ENV`, `CLAIMS_SITE`, `CLAIMS_BASE`, `EMAIL_PROVIDER`, `NEWSLETTER_PROVIDER`) are in `wrangler.toml`. Because `vars` and `d1_databases` are non-inheritable, both are repeated in each environment block; keep them that way or deploys fail validation. Production uses `EMAIL_PROVIDER=resend` and `NEWSLETTER_PROVIDER=buttondown`. The `log` providers are refused when `CLAIMS_ENV=production`, so a missing key fails loudly (HTTP 503) instead of silently dropping mail.

## 4. Turnstile

Dashboard > Turnstile > Add widget. Name it `scopit-claims`, add hostnames `claims.scopit.work` and `scopit-claims.pages.dev`, mode **Managed**. Put the site key in `PUBLIC_TURNSTILE_SITE_KEY` (build) and the secret in `TURNSTILE_SECRET_KEY` (runtime).

Locally, the code falls back to Cloudflare's always-pass test keys, so forms work without a real widget.

## 5. Deploy hook and nightly rebuild

Pages > Settings > Builds > Deploy hooks > Add: name `admin-and-nightly`, branch to build `main` (the production branch, so each call is a production deploy). The URL looks like `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<id>` and takes a plain POST. Copy it into:

- the `PAGES_DEPLOY_HOOK_URL` runtime secret, so `/admin` rebuilds after approvals and removals
- the GitHub repository secret `CLAIMS_PAGES_DEPLOY_HOOK_URL`, which `.github/workflows/claims-nightly-rebuild.yml` calls daily so expired licenses drop off the directory

Treat the hook URL like a password: anyone with it can trigger builds.

## 6. Custom domain: claims.scopit.work

Pages > Custom domains > Set up a domain > `claims.scopit.work`. `scopit.work` is on Cloudflare DNS, so Cloudflare adds the CNAME record itself. Nothing changes on the Vercel or Render side.

## 7. Reference only: serving under www.scopit.work/claims/

The site is served at **claims.scopit.work** (decided 2026-11-09). The base path stays configurable, so if that ever changes, the steps are below. The main site is on Vercel, so the Scopit frontend would have to proxy `/claims/*` to Pages:

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

1. Resend > Domains > Add `mail.scopit.work`. Resend recommends sending from a subdomain, which also keeps claims mail reputation separate from the root domain.
2. Add the DNS records Resend shows in Cloudflare DNS. For a subdomain they are typically an `MX` and an SPF `TXT` on `send.mail` (the bounce/Return-Path host) and a DKIM `TXT` on `resend._domainkey.mail`. Some accounts are shown `CNAME` records instead. Use exactly what Resend shows, with the proxy **off** (DNS only). Wait for "Verified".
3. If `scopit.work` has no DMARC record yet, add `_dmarc.scopit.work TXT "v=DMARC1; p=none; rua=mailto:dmarc@scopit.work"`, then tighten it to `quarantine` once reports look clean.
4. Set `EMAIL_FROM` to an address on that domain. Replies to inquiry emails go to the homeowner (reply-to); replies to confirmations go to `EMAIL_FROM`, so make sure that mailbox exists or forwards somewhere.

The site sends only: an inquiry to each selected adjuster, one confirmation to the homeowner who sent it, an application confirmation to the PA, an application notice to `ADMIN_NOTIFY_EMAIL`, and a "listing is live" notice to the PA on approval.

## 9. Newsletter: Buttondown

1. Create the newsletter (for example "Scopit estimating notes").
2. Settings > API: create a key and set `BUTTONDOWN_API_KEY`.
3. Double opt-in needs no setting: Buttondown sends a confirmation email to every subscriber created through the API and keeps them "unactivated" until they click it. It is skipped only when a request sends `type: "regular"`, which this site never does.
4. From the live `/for-adjusters/` page, subscribe a test address and check that the confirmation email arrives and the address stays unconfirmed until you click it.
5. The site sends the visitor's IP (`ip_address`) with each signup, as Buttondown recommends, so its firewall does not flag repeated signups from Cloudflare's IPs. Buttondown's default API rate limit is 100 requests a day; ask them to raise it if signups ever approach that.

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
