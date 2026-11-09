import { describe, expect, it } from 'vitest';
import { toPublicListing, toPublicListings, isLicenseCurrent, type ListingRow } from '../src/shared/directory';

const today = '2026-11-09';

function row(overrides: Partial<ListingRow> = {}, licenses: unknown[] = []): ListingRow {
  return {
    id: 'l1',
    slug: 'acme-adjusting',
    status: 'verified',
    business_name: 'Acme Adjusting',
    contact_name: 'Pat',
    email: 'pat@example.test',
    phone: null,
    website: null,
    office_city: 'Richmond',
    office_state: 'VA',
    loss_types: '["water","fire","not-a-type"]',
    bio: 'bio',
    approved_on: '2026-11-01',
    licenses_json: JSON.stringify(licenses),
    ...overrides,
  };
}

const goodVa = { id: 1, state: 'VA', license_number: 'VA1', expires_on: '2027-01-01', verified_on: '2026-11-01' };

describe('public directory rules', () => {
  it('shows a verified listing with a verified, current license', () => {
    const l = toPublicListing(row({}, [goodVa]), today);
    expect(l).not.toBeNull();
    expect(l!.states).toEqual(['VA']);
    expect(l!.licenses[0]).toEqual({ state: 'VA', number: 'VA1', expiresOn: '2027-01-01', verifiedOn: '2026-11-01' });
    expect(l!.lossTypes).toEqual(['water', 'fire']);
    expect(l!.fixture).toBe(false);
  });

  it('never shows pending, rejected, or unlisted listings', () => {
    for (const status of ['pending', 'rejected', 'unlisted']) {
      expect(toPublicListing(row({ status }, [goodVa]), today)).toBeNull();
    }
  });

  it('never shows a listing without a slug', () => {
    expect(toPublicListing(row({ slug: null }, [goodVa]), today)).toBeNull();
  });

  it('drops unverified and expired licenses, and hides the listing if none remain', () => {
    const unverified = { ...goodVa, state: 'MD', verified_on: null };
    const expired = { ...goodVa, state: 'DC', expires_on: '2026-11-08' };
    const l = toPublicListing(row({}, [goodVa, unverified, expired]), today);
    expect(l!.states).toEqual(['VA']);
    expect(toPublicListing(row({}, [unverified, expired]), today)).toBeNull();
  });

  it('treats a license expiring today as current, and a future verified date as not verified', () => {
    expect(isLicenseCurrent({ ...goodVa, expires_on: today }, today)).toBe(true);
    expect(isLicenseCurrent({ ...goodVa, verified_on: '2026-12-01' }, today)).toBe(false);
    expect(isLicenseCurrent({ ...goodVa, state: 'PA' }, today)).toBe(false);
  });

  it('sorts listings alphabetically, never by anything else', () => {
    const rows = [row({ id: 'b', slug: 'b', business_name: 'beta' }, [goodVa]), row({ id: 'a', slug: 'a', business_name: 'Alpha' }, [goodVa])];
    expect(toPublicListings(rows, today).map((l) => l.slug)).toEqual(['a', 'b']);
  });

  it('survives malformed JSON in stored columns', () => {
    expect(toPublicListing(row({ licenses_json: 'not json' }), today)).toBeNull();
    expect(toPublicListing(row({ loss_types: '{' }, [goodVa]), today)!.lossTypes).toEqual([]);
  });
});
