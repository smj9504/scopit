/**
 * Server-side validation for the three public forms. Forms post flat JSON
 * whose keys match the form field names, so every error maps straight back
 * to a field on the page.
 */
import {
  APPLICATION_AGREEMENTS,
  LIMITS,
  LOSS_TYPE_CODES,
  REPAIR_STATUSES,
  STATE_CODES,
  type AgreementKey,
  type LossTypeCode,
  type RepairStatusCode,
  type StateCode,
} from '../shared/constants';
import { isIsoDate } from '../shared/dates';
import type { FieldErrors } from './http';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

type Raw = Record<string, unknown>;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Collapse whitespace and strip control characters from a one-line value. */
export function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Keep line breaks in a multi-line value, strip other control characters. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return (
    value
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value) return [value];
  return [];
}

function isChecked(value: unknown): boolean {
  return value === true || value === 'yes' || value === 'on' || value === 'true';
}

export function isEmail(value: string): boolean {
  return value.length <= LIMITS.emailMax && EMAIL_RE.test(value);
}

export function normalizeWebsite(value: string): string | null {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function checkPhone(value: string, errors: FieldErrors, field: string, required: boolean) {
  if (!value) {
    if (required) errors[field] = 'Enter a phone number.';
    return;
  }
  const digits = value.replace(/\D/g, '');
  if (value.length > LIMITS.phoneMax || digits.length < 10 || digits.length > 15) {
    errors[field] = 'Enter a phone number with area code, for example 703-555-0123.';
  }
}

function requireLine(raw: Raw, field: string, label: string, max: number, errors: FieldErrors): string {
  const v = cleanLine(raw[field]);
  if (!v) errors[field] = `Enter ${label}.`;
  else if (v.length > max) errors[field] = `Keep ${label} under ${max} characters.`;
  return v;
}

/* ---------------- Inquiry (homeowner → selected adjusters) ---------------- */

export interface InquiryInput {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  propertyState: StateCode;
  lossType: LossTypeCode | 'other';
  repairStatus: RepairStatusCode;
  message: string;
  adjusters: string[];
  turnstileToken: string;
}

export function validateInquiry(raw: Raw): Result<InquiryInput> {
  const errors: FieldErrors = {};
  const name = requireLine(raw, 'name', 'your name', LIMITS.nameMax, errors);
  const email = cleanLine(raw.email).toLowerCase();
  if (!email) errors.email = 'Enter your email address.';
  else if (!isEmail(email)) errors.email = 'Enter an email address like name@example.com.';

  const phone = cleanLine(raw.phone);
  checkPhone(phone, errors, 'phone', false);

  const location = cleanLine(raw.location);
  if (location.length > LIMITS.locationMax) errors.location = `Keep this under ${LIMITS.locationMax} characters.`;

  const propertyState = cleanLine(raw.propertyState);
  if (!(STATE_CODES as string[]).includes(propertyState)) errors.propertyState = 'Choose the state where the property is.';

  const lossType = cleanLine(raw.lossType);
  if (!([...LOSS_TYPE_CODES, 'other'] as string[]).includes(lossType)) errors.lossType = 'Choose the type of damage.';

  const repairStatus = cleanLine(raw.repairStatus);
  if (!(REPAIR_STATUSES.map((r) => r.code) as string[]).includes(repairStatus)) {
    errors.repairStatus = 'Choose where repairs stand.';
  }

  const message = cleanText(raw.message);
  if (message.length < LIMITS.messageMin) {
    errors.message = `Tell the adjuster a little about what happened (at least ${LIMITS.messageMin} characters).`;
  } else if (message.length > LIMITS.messageMax) {
    errors.message = `Keep the message under ${LIMITS.messageMax} characters.`;
  }

  const adjusters = [...new Set(asArray(raw.adjusters).map((s) => s.trim()))].filter((s) => SLUG_RE.test(s));
  if (adjusters.length === 0) errors.adjusters = 'Choose at least one adjuster.';
  else if (adjusters.length > LIMITS.maxAdjustersPerInquiry) {
    errors.adjusters = `Choose up to ${LIMITS.maxAdjustersPerInquiry} adjusters.`;
  }

  if (!isChecked(raw.consent)) errors.consent = 'Check the box to agree before sending.';

  const turnstileToken = cleanLine(raw['cf-turnstile-response']);

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      email,
      phone: phone || null,
      location: location || null,
      propertyState: propertyState as StateCode,
      lossType: lossType as LossTypeCode | 'other',
      repairStatus: repairStatus as RepairStatusCode,
      message,
      adjusters,
      turnstileToken,
    },
  };
}

/* ---------------- Listing application (PA) ---------------- */

export interface LicenseInput {
  state: StateCode;
  number: string;
  expiresOn: string;
}

export interface ApplicationInput {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string | null;
  officeCity: string;
  officeState: string;
  lossTypes: LossTypeCode[];
  bio: string;
  licenses: LicenseInput[];
  agreements: Record<AgreementKey, true>;
  turnstileToken: string;
}

export function validateApplication(raw: Raw, today: string): Result<ApplicationInput> {
  const errors: FieldErrors = {};
  const businessName = requireLine(raw, 'businessName', 'your business name', LIMITS.nameMax, errors);
  const contactName = requireLine(raw, 'contactName', 'your name', LIMITS.nameMax, errors);

  const email = cleanLine(raw.email).toLowerCase();
  if (!email) errors.email = 'Enter your email address.';
  else if (!isEmail(email)) errors.email = 'Enter an email address like name@example.com.';

  const phone = cleanLine(raw.phone);
  checkPhone(phone, errors, 'phone', true);

  const websiteRaw = cleanLine(raw.website);
  let website: string | null = null;
  if (websiteRaw) {
    website = normalizeWebsite(websiteRaw);
    if (!website || websiteRaw.length > LIMITS.urlMax) errors.website = 'Enter a web address like example.com, or leave it blank.';
  }

  const officeCity = requireLine(raw, 'officeCity', 'the city of your office', LIMITS.locationMax, errors);
  const officeState = cleanLine(raw.officeState).toUpperCase();
  if (!/^[A-Z]{2}$/.test(officeState)) errors.officeState = 'Choose the state of your office.';

  const lossTypes = [...new Set(asArray(raw.lossTypes))].filter((x): x is LossTypeCode =>
    (LOSS_TYPE_CODES as string[]).includes(x),
  );
  if (lossTypes.length === 0) errors.lossTypes = 'Choose at least one type of loss you handle.';

  const bio = cleanText(raw.bio);
  if (bio.length < LIMITS.bioMin) errors.bio = `Write a short description (at least ${LIMITS.bioMin} characters).`;
  else if (bio.length > LIMITS.bioMax) errors.bio = `Keep the description under ${LIMITS.bioMax} characters.`;
  else if (/https?:\/\//i.test(bio)) errors.bio = 'Leave links out of the description. Use the website field instead.';

  const licenses: LicenseInput[] = [];
  for (const state of STATE_CODES) {
    if (!isChecked(raw[`license_${state}`])) continue;
    const number = cleanLine(raw[`license_${state}_number`]);
    const expiresOn = cleanLine(raw[`license_${state}_expires`]);
    if (!number) errors[`license_${state}_number`] = `Enter your ${state} license number.`;
    else if (number.length > LIMITS.licenseNumberMax || !/^[A-Za-z0-9-./ ]+$/.test(number)) {
      errors[`license_${state}_number`] = 'Enter the license number as shown on your license.';
    }
    if (!expiresOn || !isIsoDate(expiresOn)) {
      errors[`license_${state}_expires`] = 'Enter the expiration date.';
    } else if (expiresOn < today) {
      errors[`license_${state}_expires`] = 'This license has expired. Only current licenses can be listed.';
    }
    licenses.push({ state, number, expiresOn });
  }
  if (licenses.length === 0) errors.licenses = 'Add at least one public adjuster license (Virginia, Maryland, or DC).';

  const agreements = {} as Record<AgreementKey, true>;
  for (const a of APPLICATION_AGREEMENTS) {
    if (isChecked(raw[`agree_${a.key}`])) agreements[a.key] = true;
    else errors[`agree_${a.key}`] = 'You must agree to this to be listed.';
  }

  const turnstileToken = cleanLine(raw['cf-turnstile-response']);

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      businessName,
      contactName,
      email,
      phone,
      website,
      officeCity,
      officeState,
      lossTypes,
      bio,
      licenses,
      agreements,
      turnstileToken,
    },
  };
}

/* ---------------- Newsletter ---------------- */

export function validateNewsletter(raw: Raw): Result<{ email: string; turnstileToken: string }> {
  const email = cleanLine(raw.email).toLowerCase();
  if (!email) return { ok: false, errors: { email: 'Enter your email address.' } };
  if (!isEmail(email)) return { ok: false, errors: { email: 'Enter an email address like name@example.com.' } };
  return { ok: true, value: { email, turnstileToken: cleanLine(raw['cf-turnstile-response']) } };
}
