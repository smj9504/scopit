/**
 * D1 queries. All SQL uses bound parameters.
 */
import type { D1Like } from './d1';
import type { ApplicationInput, InquiryInput } from './validate';
import { LISTING_TERMS_VERSION, INQUIRY_CONSENT, INQUIRY_RETENTION_DAYS } from '../shared/constants';
import {
  VERIFIED_LISTINGS_SQL,
  toPublicListing,
  parseLicenses,
  type ListingRow,
  type LicenseRow,
  type PublicListing,
} from '../shared/directory';

/* ---------------- Applications ---------------- */

export async function hasOpenApplication(db: D1Like, email: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM listings WHERE email = ? AND status IN ('pending', 'verified') LIMIT 1")
    .bind(email)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function insertApplication(
  db: D1Like,
  input: ApplicationInput,
  opts: { id: string; now: Date; ipHash: string },
): Promise<void> {
  const nowIso = opts.now.toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO listings (id, status, business_name, contact_name, email, phone, website, office_city, office_state,
           loss_types, bio, terms_version, agreements, agreed_at, created_at, updated_at, ip_hash)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        opts.id,
        input.businessName,
        input.contactName,
        input.email,
        input.phone,
        input.website,
        input.officeCity,
        input.officeState,
        JSON.stringify(input.lossTypes),
        input.bio,
        LISTING_TERMS_VERSION,
        JSON.stringify(input.agreements),
        nowIso,
        nowIso,
        nowIso,
        opts.ipHash,
      ),
    ...input.licenses.map((l) =>
      db
        .prepare('INSERT INTO listing_licenses (listing_id, state, license_number, expires_on) VALUES (?, ?, ?, ?)')
        .bind(opts.id, l.state, l.number, l.expiresOn),
    ),
  ];
  await db.batch(statements);
}

/* ---------------- Directory (request-time checks) ---------------- */

export interface ContactableListing {
  listing: PublicListing;
  email: string;
}

/**
 * Listings that may receive an inquiry right now: admin-verified with a
 * current verified license. Uses the same rules as the public directory.
 */
export async function getContactableListings(db: D1Like, slugs: string[], today: string): Promise<ContactableListing[]> {
  const { results } = await db.prepare(VERIFIED_LISTINGS_SQL).all<ListingRow>();
  const wanted = new Set(slugs);
  const out: ContactableListing[] = [];
  for (const row of results) {
    if (!row.slug || !wanted.has(row.slug)) continue;
    const listing = toPublicListing(row, today);
    if (listing) out.push({ listing, email: row.email });
  }
  return out;
}

/* ---------------- Inquiries ---------------- */

export async function insertInquiry(
  db: D1Like,
  input: InquiryInput,
  recipients: ContactableListing[],
  opts: { id: string; now: Date; ipHash: string },
): Promise<void> {
  const nowIso = opts.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO inquiries (id, created_at, name, email, phone, location, property_state, loss_type, repair_status,
           message, consent_text, consent_at, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        opts.id,
        nowIso,
        input.name,
        input.email,
        input.phone,
        input.location,
        input.propertyState,
        input.lossType,
        input.repairStatus,
        input.message,
        INQUIRY_CONSENT,
        nowIso,
        opts.ipHash,
      ),
    ...recipients.map((r) =>
      db
        .prepare('INSERT INTO inquiry_recipients (inquiry_id, listing_id, business_name) VALUES (?, ?, ?)')
        .bind(opts.id, r.listing.id, r.listing.businessName),
    ),
  ]);
}

export async function setRecipientStatus(
  db: D1Like,
  inquiryId: string,
  listingId: string,
  status: 'sent' | 'failed',
  providerId: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE inquiry_recipients SET delivery_status = ?, provider_message_id = ? WHERE inquiry_id = ? AND listing_id = ?')
    .bind(status, providerId, inquiryId, listingId)
    .run();
}

/** Deletes inquiries past the retention period. Runs on each new inquiry. */
export async function purgeOldInquiries(db: D1Like, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - INQUIRY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM inquiry_recipients WHERE inquiry_id IN (SELECT id FROM inquiries WHERE created_at < ?)').bind(cutoff),
    db.prepare('DELETE FROM inquiries WHERE created_at < ?').bind(cutoff),
  ]);
}

/* ---------------- Admin ---------------- */

export interface AdminListing {
  id: string;
  slug: string | null;
  status: 'pending' | 'verified' | 'rejected' | 'unlisted';
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  website: string | null;
  office_city: string | null;
  office_state: string | null;
  loss_types: string;
  bio: string;
  terms_version: string;
  agreements: string;
  agreed_at: string;
  created_at: string;
  updated_at: string;
  approved_on: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
}

export interface AdminLicense extends LicenseRow {
  verified_note: string | null;
}

export async function adminListListings(db: D1Like): Promise<(AdminListing & { licenses_json: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT l.*, (SELECT json_group_array(json_object('id', x.id, 'state', x.state, 'license_number', x.license_number,
                 'expires_on', x.expires_on, 'verified_on', x.verified_on))
                FROM listing_licenses x WHERE x.listing_id = l.id) AS licenses_json
         FROM listings l
        ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END, l.created_at DESC`,
    )
    .all<AdminListing & { licenses_json: string }>();
  return results;
}

export async function adminGetListing(db: D1Like, id: string): Promise<{ listing: AdminListing; licenses: AdminLicense[] } | null> {
  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first<AdminListing>();
  if (!listing) return null;
  const { results } = await db
    .prepare(
      "SELECT id, state, license_number, expires_on, verified_on, verified_note FROM listing_licenses WHERE listing_id = ? ORDER BY CASE state WHEN 'VA' THEN 0 WHEN 'MD' THEN 1 ELSE 2 END",
    )
    .bind(id)
    .all<AdminLicense>();
  return { listing, licenses: results };
}

export interface ListingEdit {
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  website: string | null;
  office_city: string | null;
  office_state: string | null;
  loss_types: string[];
  bio: string;
  admin_note: string | null;
}

export async function adminUpdateListing(db: D1Like, id: string, edit: ListingEdit, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE listings SET business_name = ?, contact_name = ?, email = ?, phone = ?, website = ?, office_city = ?,
         office_state = ?, loss_types = ?, bio = ?, admin_note = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      edit.business_name,
      edit.contact_name,
      edit.email,
      edit.phone,
      edit.website,
      edit.office_city,
      edit.office_state,
      JSON.stringify(edit.loss_types),
      edit.bio,
      edit.admin_note,
      now.toISOString(),
      id,
    )
    .run();
}

export async function adminSetLicenseVerified(
  db: D1Like,
  listingId: string,
  licenseId: number,
  verifiedOn: string | null,
  note: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE listing_licenses SET verified_on = ?, verified_note = ? WHERE id = ? AND listing_id = ?')
    .bind(verifiedOn, note, licenseId, listingId)
    .run();
}

/** Changing a license number or expiry clears its verification. */
export async function adminUpdateLicense(
  db: D1Like,
  listingId: string,
  licenseId: number,
  number: string,
  expiresOn: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE listing_licenses
          SET verified_on = CASE WHEN license_number = ?1 AND expires_on = ?2 THEN verified_on ELSE NULL END,
              verified_note = CASE WHEN license_number = ?1 AND expires_on = ?2 THEN verified_note ELSE NULL END,
              license_number = ?1, expires_on = ?2
        WHERE id = ?3 AND listing_id = ?4`,
    )
    .bind(number, expiresOn, licenseId, listingId)
    .run();
}

export async function adminAddLicense(db: D1Like, listingId: string, state: string, number: string, expiresOn: string): Promise<void> {
  await db
    .prepare('INSERT INTO listing_licenses (listing_id, state, license_number, expires_on) VALUES (?, ?, ?, ?)')
    .bind(listingId, state, number, expiresOn)
    .run();
}

export async function adminDeleteLicense(db: D1Like, listingId: string, licenseId: number): Promise<void> {
  await db.prepare('DELETE FROM listing_licenses WHERE id = ? AND listing_id = ?').bind(licenseId, listingId).run();
}

export async function adminSetStatus(
  db: D1Like,
  id: string,
  status: AdminListing['status'],
  opts: { now: Date; slug?: string; approvedOn?: string; note?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE listings SET status = ?, reviewed_at = ?, updated_at = ?,
              slug = COALESCE(?, slug), approved_on = COALESCE(approved_on, ?),
              admin_note = COALESCE(?, admin_note)
        WHERE id = ?`,
    )
    .bind(status, opts.now.toISOString(), opts.now.toISOString(), opts.slug ?? null, opts.approvedOn ?? null, opts.note ?? null, id)
    .run();
}

export async function slugExists(db: D1Like, slug: string, exceptId: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM listings WHERE slug = ? AND id != ?').bind(slug, exceptId).first();
  return Boolean(row);
}

export interface AdminInquiryRow {
  id: string;
  created_at: string;
  property_state: string;
  loss_type: string;
  recipients: string; // JSON
}

/** Inquiry metadata only. The admin view does not show homeowner messages or contact details. */
export async function adminListInquiries(db: D1Like, limit = 100): Promise<AdminInquiryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.created_at, i.property_state, i.loss_type,
              (SELECT json_group_array(json_object('business_name', r.business_name, 'status', r.delivery_status))
                 FROM inquiry_recipients r WHERE r.inquiry_id = i.id) AS recipients
         FROM inquiries i ORDER BY i.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<AdminInquiryRow>();
  return results;
}

export { parseLicenses };
