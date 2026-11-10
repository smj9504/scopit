# Running the directory: license verification

(Korean quick guide: `OPERATIONS.ko.md`.)

The directory only shows a public adjuster after a person at Scopit has checked their license with the state. This page is the procedure.

## Access

- URL: `https://claims.scopit.work/admin` (or `/claims/admin` under a sub-path).
- Sign in with `ADMIN_USER` and `ADMIN_PASSWORD` (Cloudflare Pages secrets). If either is unset, `/admin` returns 404.
- Use a long random password and share it only with the people who verify licenses. [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) could add staff-only sign-in on top, but it generally needs the domain's DNS in Cloudflare, and `scopit.work` is on Namecheap DNS (see DEPLOY.md section 11).
- `/admin` has no JavaScript and no cookies. Every change is a form POST checked against the site's own origin.

## When an application arrives

The applicant gets an automatic confirmation email. `ADMIN_NOTIFY_EMAIL` gets a notice with a link to the application.

1. Open the application. Read the business details, the description, and which agreements were ticked. All four are required, so they will always be there.
2. **Verify each license, one at a time:**
   - Click the state lookup link next to the license:
     - Virginia: SCC producer search, `https://www.scc.virginia.gov/boi/consumerinquiry/`
     - Maryland: MIA Company and Producer search, `https://www.apps.insurance.maryland.gov/CompanyProducerInfo/`
     - DC: DISB license verification (links to the NAIC lookup), `https://disb.dc.gov/service/verify-financial-institution-or-representative-licensed-disb`
   - Search by license number and name. Confirm all of the following:
     - It is a **public adjuster** license, not an independent or company adjuster or another producer license.
     - Status is **active**.
     - The name matches the applicant (person or firm).
     - The expiration date matches what they entered.
   - If anything is off, edit the license number or expiration in the form (this clears any earlier verification), or email the applicant.
   - Enter the date you checked and a short note on how (for example, "SCC lookup: PA, active, name and expiry match"). Click **Mark license verified**. The date is shown publicly as "License verified on [date]". The note is internal.
3. **Decide:**
   - **Approve and publish** is enabled once at least one current license is verified. Check the URL slug, then approve. The adjuster gets a "your listing is live" email, and the site rebuilds through the deploy hook in about 1–3 minutes.
   - **Reject application**: for pending applications only. Add an internal reason. No email is sent; reply personally if appropriate.
4. Only verified, unexpired licenses show. A listing whose licenses are all unverified or expired is hidden automatically, even if its status is "verified". The dashboard flags these.

## Keeping listings current

- Licenses past their expiration date drop off at the next rebuild (nightly, and on every change). When a PA renews, update the expiration date in `/admin`. That clears the old verification, so look the license up again and re-verify.
- **Remove from directory** (unlist) takes a live listing down. Use it when a PA asks, or when a license is suspended, revoked, or can't be verified.
- Edits to a live listing trigger a rebuild automatically.
- **Rebuild directory now** on the dashboard triggers a rebuild by hand.

## Inquiries

The Inquiries page shows only delivery status: when a message was sent, the state, the loss type, which adjusters, and whether each email was sent. Homeowner names, contact details, and messages are not shown in `/admin`. They exist only in the emails to the selected adjusters and in D1 for 180 days, after which they are deleted automatically.

## Fallback: D1 SQL

If `/admin` is unavailable, the same steps work with `wrangler` (requires Cloudflare access to the account):

```bash
# list pending applications
npx wrangler d1 execute scopit-claims --remote --command \
  "SELECT id, business_name, email, created_at FROM listings WHERE status = 'pending' ORDER BY created_at"

# show licenses for one listing
npx wrangler d1 execute scopit-claims --remote --command \
  "SELECT id, state, license_number, expires_on, verified_on FROM listing_licenses WHERE listing_id = '<LISTING_ID>'"

# mark a license verified (after checking the state lookup)
npx wrangler d1 execute scopit-claims --remote --command \
  "UPDATE listing_licenses SET verified_on = '2026-11-09', verified_note = 'SCC lookup: PA, active' WHERE id = <LICENSE_ID>"

# approve and publish
npx wrangler d1 execute scopit-claims --remote --command \
  "UPDATE listings SET status = 'verified', slug = 'business-name', approved_on = '2026-11-09', reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = '<LISTING_ID>'"

# unlist
npx wrangler d1 execute scopit-claims --remote --command \
  "UPDATE listings SET status = 'unlisted', updated_at = datetime('now') WHERE id = '<LISTING_ID>'"
```

Then trigger a rebuild (Pages dashboard > Deployments > Retry, or the deploy hook). The SQL route sends no "listing live" email; email the adjuster yourself.
