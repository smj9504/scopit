/**
 * Values shared by the static pages (Astro) and the server functions
 * (Cloudflare Pages Functions). Keep this file free of runtime-specific code.
 */

export const STATES = [
  { code: 'VA', name: 'Virginia' },
  { code: 'MD', name: 'Maryland' },
  { code: 'DC', name: 'District of Columbia' },
] as const;

export type StateCode = (typeof STATES)[number]['code'];
export const STATE_CODES = STATES.map((s) => s.code) as StateCode[];

export function stateName(code: string): string {
  return STATES.find((s) => s.code === code)?.name ?? code;
}

export const LOSS_TYPES = [
  { code: 'water', label: 'Water' },
  { code: 'fire', label: 'Fire and smoke' },
  { code: 'wind-hail', label: 'Wind and hail' },
  { code: 'contents', label: 'Contents' },
] as const;

export type LossTypeCode = (typeof LOSS_TYPES)[number]['code'];
export const LOSS_TYPE_CODES = LOSS_TYPES.map((l) => l.code) as LossTypeCode[];

export function lossTypeLabel(code: string): string {
  return LOSS_TYPES.find((l) => l.code === code)?.label ?? code;
}

/** Inquiry form: what the homeowner says about repairs so far. */
export const REPAIR_STATUSES = [
  { code: 'not-started', label: 'Not started' },
  { code: 'in-progress', label: 'In progress' },
  { code: 'done', label: 'Already done' },
  { code: 'unsure', label: 'Not sure' },
] as const;
export type RepairStatusCode = (typeof REPAIR_STATUSES)[number]['code'];

/** The one disclosure line. Never hide or reword it without a decision. */
export const DISCLOSURE =
  'Run by Scopit. Free to use. Scopit does not receive payment from listed adjusters.';

export const GENERAL_DISCLAIMER =
  'General information only. This is not legal or insurance advice. Scopit is not an insurer, insurance agent, adjuster, or law firm.';

/** Exact consent text the homeowner agrees to. Stored with each inquiry. */
export const INQUIRY_CONSENT =
  'I agree to share this information with the adjusters I selected. Scopit does not charge for this.';

/**
 * Version of the PA Listing Terms an applicant agrees to. Bump it when
 * src/content/legal/listing-terms.md changes in substance; it is stored with
 * each application.
 */
export const LISTING_TERMS_VERSION = '2026-11-09-draft';

/** Statements an applicant must tick. Stored by key with each application. */
export const APPLICATION_AGREEMENTS = [
  {
    key: 'listingTerms',
    label: 'I have read and agree to the PA Listing Terms.',
  },
  {
    key: 'noFees',
    label:
      'I understand the listing is free. I will not pay Scopit any fee, including per-lead, success, referral, or ranking fees, and Scopit will not ask for one.',
  },
  {
    key: 'solicitation',
    label: "I will follow my state's solicitation rules and contract requirements for public adjusters.",
  },
  {
    key: 'accuracy',
    label:
      'The license details above are accurate. I will tell Scopit if a license lapses, is suspended, or changes.',
  },
] as const;
export type AgreementKey = (typeof APPLICATION_AGREEMENTS)[number]['key'];

export const LIMITS = {
  nameMax: 120,
  emailMax: 254,
  phoneMax: 40,
  locationMax: 80,
  messageMin: 20,
  messageMax: 1500,
  bioMin: 40,
  bioMax: 800,
  licenseNumberMax: 40,
  urlMax: 200,
  /** Most adjusters a homeowner can write to in one inquiry. */
  maxAdjustersPerInquiry: 3,
} as const;

/** How long inquiries are kept before they are deleted (see Privacy). */
export const INQUIRY_RETENTION_DAYS = 180;

/** Directory profile slugs that would collide with fixed routes. */
export const RESERVED_SLUGS = ['inquiry', 'contact', 'apply', 'sent', 'index', 'admin', 'api'];
