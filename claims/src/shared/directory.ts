/**
 * Rules for what may appear in the public directory. Used at build time (to
 * render pages) and at request time (to accept an inquiry), so both always
 * agree.
 *
 * A listing is public only when:
 *   - an admin set its status to "verified", and
 *   - it has a public slug, and
 *   - at least one license has a "verified on" date set by an admin and has
 *     not expired.
 * Only licenses that are verified and unexpired are shown. Unverified or
 * expired licenses are dropped, and so are the states they cover.
 */
import { STATE_CODES, LOSS_TYPE_CODES, type StateCode, type LossTypeCode } from './constants';
import { isIsoDate } from './dates';

/** A row as stored in D1 (see migrations/0001_init.sql), joined with its licenses. */
export interface ListingRow {
  id: string;
  slug: string | null;
  status: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  website: string | null;
  office_city: string | null;
  office_state: string | null;
  loss_types: string; // JSON array
  bio: string;
  approved_on: string | null;
  /** JSON array of license objects, built with json_group_array in SQL. */
  licenses_json: string | null;
}

export interface LicenseRow {
  id: number;
  state: string;
  license_number: string;
  expires_on: string;
  verified_on: string | null;
}

export interface PublicLicense {
  state: StateCode;
  number: string;
  expiresOn: string;
  verifiedOn: string;
}

export interface PublicListing {
  id: string;
  slug: string;
  businessName: string;
  contactName: string;
  officeCity: string | null;
  officeState: string | null;
  phone: string | null;
  website: string | null;
  lossTypes: LossTypeCode[];
  bio: string;
  listedOn: string | null;
  licenses: PublicLicense[];
  /** States with a verified, unexpired license. */
  states: StateCode[];
  /** True only for the labeled dev fixture. Never true in production. */
  fixture: boolean;
}

/**
 * SELECT used both by the build (Cloudflare D1 REST API) and by functions
 * (D1 binding). Returns every listing marked verified; filter with
 * toPublicListing() before showing anything.
 */
export const VERIFIED_LISTINGS_SQL = `
SELECT l.id, l.slug, l.status, l.business_name, l.contact_name, l.email, l.phone,
       l.website, l.office_city, l.office_state, l.loss_types, l.bio, l.approved_on,
       (SELECT json_group_array(json_object(
                 'id', x.id, 'state', x.state, 'license_number', x.license_number,
                 'expires_on', x.expires_on, 'verified_on', x.verified_on))
          FROM listing_licenses x WHERE x.listing_id = l.id) AS licenses_json
  FROM listings l
 WHERE l.status = 'verified'
 ORDER BY l.business_name COLLATE NOCASE`;

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseLicenses(value: string | null | undefined): LicenseRow[] {
  return parseJsonArray(value).filter(
    (x): x is LicenseRow =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as LicenseRow).state === 'string' &&
      typeof (x as LicenseRow).license_number === 'string' &&
      typeof (x as LicenseRow).expires_on === 'string',
  );
}

export function isLicenseCurrent(license: Pick<LicenseRow, 'verified_on' | 'expires_on' | 'state'>, today: string): boolean {
  return (
    typeof license.verified_on === 'string' &&
    isIsoDate(license.verified_on) &&
    license.verified_on <= today &&
    isIsoDate(license.expires_on) &&
    license.expires_on >= today &&
    (STATE_CODES as string[]).includes(license.state)
  );
}

/** Returns the public view of a listing, or null if it must not be shown. */
export function toPublicListing(row: ListingRow, today: string, fixture = false): PublicListing | null {
  if (row.status !== 'verified' || !row.slug) return null;
  const licenses: PublicLicense[] = parseLicenses(row.licenses_json)
    .filter((l) => isLicenseCurrent(l, today))
    .map((l) => ({
      state: l.state as StateCode,
      number: l.license_number,
      expiresOn: l.expires_on,
      verifiedOn: l.verified_on as string,
    }))
    .sort((a, b) => STATE_CODES.indexOf(a.state) - STATE_CODES.indexOf(b.state));
  if (licenses.length === 0) return null;

  const lossTypes = parseJsonArray(row.loss_types).filter((x): x is LossTypeCode =>
    (LOSS_TYPE_CODES as unknown[]).includes(x),
  );

  return {
    id: row.id,
    slug: row.slug,
    businessName: row.business_name,
    contactName: row.contact_name,
    officeCity: row.office_city,
    officeState: row.office_state,
    phone: row.phone,
    website: row.website,
    lossTypes,
    bio: row.bio,
    listedOn: row.approved_on,
    licenses,
    states: [...new Set(licenses.map((l) => l.state))],
    fixture,
  };
}

export function toPublicListings(rows: ListingRow[], today: string, fixture = false): PublicListing[] {
  return rows
    .map((r) => toPublicListing(r, today, fixture))
    .filter((x): x is PublicListing => x !== null)
    .sort((a, b) => a.businessName.localeCompare(b.businessName, 'en', { sensitivity: 'base' }));
}
