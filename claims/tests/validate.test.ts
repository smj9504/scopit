import { describe, expect, it } from 'vitest';
import { validateApplication, validateInquiry, validateNewsletter, normalizeWebsite } from '../src/server/validate';

const today = '2026-11-09';

const goodInquiry = {
  name: 'Jordan Homeowner',
  email: 'Jordan@Example.com ',
  phone: '',
  location: 'Arlington',
  propertyState: 'VA',
  lossType: 'water',
  repairStatus: 'not-started',
  message: 'A supply line burst under the kitchen sink last night.',
  adjusters: ['acme-adjusting'],
  consent: 'yes',
  'cf-turnstile-response': 'ok',
};

describe('inquiry validation', () => {
  it('accepts a complete inquiry and normalizes the email', () => {
    const r = validateInquiry(goodInquiry);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe('jordan@example.com');
      expect(r.value.phone).toBeNull();
    }
  });

  it('requires consent', () => {
    const r = validateInquiry({ ...goodInquiry, consent: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.consent).toBeTruthy();
  });

  it('requires at least one and at most three adjusters, by valid slug', () => {
    const none = validateInquiry({ ...goodInquiry, adjusters: [] });
    const many = validateInquiry({ ...goodInquiry, adjusters: ['a', 'b', 'c', 'd'] });
    const bad = validateInquiry({ ...goodInquiry, adjusters: ['../etc'] });
    expect(!none.ok && none.errors.adjusters).toBeTruthy();
    expect(!many.ok && many.errors.adjusters).toBeTruthy();
    expect(!bad.ok && bad.errors.adjusters).toBeTruthy();
  });

  it('accepts a single adjuster sent as a string', () => {
    const r = validateInquiry({ ...goodInquiry, adjusters: 'acme-adjusting' });
    expect(r.ok).toBe(true);
  });

  it('rejects states outside VA, MD, DC and bad emails', () => {
    const r = validateInquiry({ ...goodInquiry, propertyState: 'PA', email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.propertyState).toBeTruthy();
      expect(r.errors.email).toBeTruthy();
    }
  });

  it('limits message length', () => {
    const short = validateInquiry({ ...goodInquiry, message: 'help' });
    const long = validateInquiry({ ...goodInquiry, message: 'x'.repeat(2000) });
    expect(!short.ok && short.errors.message).toBeTruthy();
    expect(!long.ok && long.errors.message).toBeTruthy();
  });
});

const goodApplication = {
  businessName: 'Acme Adjusting LLC',
  contactName: 'Pat Adjuster',
  email: 'pat@acme.example',
  phone: '(703) 555-0100',
  website: 'acme.example',
  officeCity: 'Richmond',
  officeState: 'VA',
  lossTypes: ['water', 'fire'],
  bio: 'We handle residential water and fire claims across Virginia and Maryland.',
  license_VA: 'yes',
  license_VA_number: 'VA-123456',
  license_VA_expires: '2027-06-30',
  agree_listingTerms: 'yes',
  agree_noFees: 'yes',
  agree_solicitation: 'yes',
  agree_accuracy: 'yes',
  'cf-turnstile-response': 'ok',
};

describe('application validation', () => {
  it('accepts a complete application', () => {
    const r = validateApplication(goodApplication, today);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.licenses).toEqual([{ state: 'VA', number: 'VA-123456', expiresOn: '2027-06-30' }]);
      expect(r.value.website).toBe('https://acme.example/');
    }
  });

  it('requires at least one license', () => {
    const r = validateApplication({ ...goodApplication, license_VA: undefined }, today);
    expect(!r.ok && r.errors.licenses).toBeTruthy();
  });

  it('rejects expired licenses and missing license numbers', () => {
    const r = validateApplication({ ...goodApplication, license_VA_expires: '2026-11-08', license_MD: 'yes' }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.license_VA_expires).toMatch(/expired/);
      expect(r.errors.license_MD_number).toBeTruthy();
      expect(r.errors.license_MD_expires).toBeTruthy();
    }
  });

  it('requires every agreement, including no fees and solicitation rules', () => {
    const r = validateApplication({ ...goodApplication, agree_noFees: undefined, agree_solicitation: '' }, today);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.agree_noFees).toBeTruthy();
      expect(r.errors.agree_solicitation).toBeTruthy();
    }
  });

  it('keeps links out of the bio', () => {
    const r = validateApplication({ ...goodApplication, bio: 'Visit https://spam.example for the best adjusting anywhere.' }, today);
    expect(!r.ok && r.errors.bio).toBeTruthy();
  });

  it('normalizes websites and rejects junk', () => {
    expect(normalizeWebsite('example.com')).toBe('https://example.com/');
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
    expect(normalizeWebsite('localhost')).toBeNull();
  });
});

describe('newsletter validation', () => {
  it('needs a valid email', () => {
    expect(validateNewsletter({ email: 'a@b.co' }).ok).toBe(true);
    expect(validateNewsletter({ email: 'a@b' }).ok).toBe(false);
  });
});
