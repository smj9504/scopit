/**
 * Plain-text email bodies. Short, factual, no marketing.
 */
import {
  DISCLOSURE,
  GENERAL_DISCLAIMER,
  INQUIRY_RETENTION_DAYS,
  lossTypeLabel,
  REPAIR_STATUSES,
  stateName,
} from '../shared/constants';
import { formatDate } from '../shared/dates';
import type { ContactableListing } from './store';
import type { ApplicationInput, InquiryInput } from './validate';

export interface Composed {
  subject: string;
  text: string;
}

function lossLabel(code: string): string {
  return code === 'other' ? 'Other' : lossTypeLabel(code);
}

function repairLabel(code: string): string {
  return REPAIR_STATUSES.find((r) => r.code === code)?.label ?? code;
}

export function inquiryToAdjuster(input: InquiryInput, recipient: ContactableListing): Composed {
  const lines = [
    `Hello ${recipient.listing.contactName},`,
    '',
    `A homeowner chose to contact ${recipient.listing.businessName} through the Scopit Claims directory.`,
    'Reply to this email to reach them directly.',
    '',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone ?? 'not given'}`,
    `Property location: ${input.location ? `${input.location}, ` : ''}${stateName(input.propertyState)}`,
    `Type of damage: ${lossLabel(input.lossType)}`,
    `Repairs: ${repairLabel(input.repairStatus)}`,
    '',
    'Message:',
    input.message,
    '',
    '---',
    'The homeowner agreed to share this information only with the adjusters they selected.',
    "Please follow your state's solicitation and contract rules for public adjusters.",
    DISCLOSURE,
  ];
  return {
    subject: `New inquiry from Scopit Claims: ${lossLabel(input.lossType).toLowerCase()} damage in ${input.propertyState}`,
    text: lines.join('\n'),
  };
}

export function inquiryConfirmation(input: InquiryInput, sentTo: ContactableListing[]): Composed {
  const lines = [
    `Hello ${input.name},`,
    '',
    'Your message was sent to:',
    ...sentTo.map((r) => `  - ${r.listing.businessName}`),
    '',
    'They may reply by email or phone. Scopit did not send your information to anyone else,',
    'and we will not contact you about this message again.',
    '',
    'A copy of your message:',
    input.message,
    '',
    '---',
    'Scopit does not charge for this. Scopit is not an insurer, agent, adjuster, or law firm, and',
    'does not receive payment from listed adjusters. Before you sign anything, read the contract and',
    "check the adjuster's license with your state.",
    '',
    `We keep a record of this message for ${INQUIRY_RETENTION_DAYS} days, then delete it.`,
    GENERAL_DISCLAIMER,
  ];
  return { subject: 'Your message was sent (Scopit Claims)', text: lines.join('\n') };
}

export function applicationConfirmation(input: ApplicationInput): Composed {
  const lines = [
    `Hello ${input.contactName},`,
    '',
    `We received the listing application for ${input.businessName}.`,
    '',
    'Next, we check each license you entered against the state’s official license lookup.',
    'We will email you when your listing is live, or if we need anything else.',
    '',
    'Licenses you entered:',
    ...input.licenses.map((l) => `  - ${stateName(l.state)}: ${l.number} (expires ${formatDate(l.expiresOn)})`),
    '',
    'The listing is free. Scopit never asks for per-lead, success, referral, or ranking fees.',
    'If anyone asks you to pay to be listed, it is not us.',
    '',
    DISCLOSURE,
  ];
  return { subject: 'We received your listing application (Scopit Claims)', text: lines.join('\n') };
}

export function applicationAdminNotice(input: ApplicationInput, adminUrl: string): Composed {
  const lines = [
    `New listing application: ${input.businessName}`,
    `Contact: ${input.contactName} <${input.email}>, ${input.phone}`,
    `Office: ${input.officeCity}, ${input.officeState}`,
    '',
    'Licenses to verify:',
    ...input.licenses.map((l) => `  - ${l.state} ${l.number}, expires ${l.expiresOn}`),
    '',
    `Review: ${adminUrl}`,
  ];
  return { subject: `[Scopit Claims] New PA application: ${input.businessName}`, text: lines.join('\n') };
}

export function listingLive(contactName: string, businessName: string, profileUrl: string): Composed {
  const lines = [
    `Hello ${contactName},`,
    '',
    `The listing for ${businessName} is approved and will appear in the directory within a few minutes:`,
    profileUrl,
    '',
    'Your profile shows each license with the date we verified it. Please tell us if a license',
    'lapses, is suspended, or is renewed with a new expiration date, so we can update it.',
    '',
    DISCLOSURE,
  ];
  return { subject: 'Your listing is live (Scopit Claims)', text: lines.join('\n') };
}
