/**
 * Scopit - In-Person Contract Signing (SEO landing page)
 * Route: /in-person-contract-signing  (public, indexable)
 *
 * Targets "sign a contract in person / on-site e-signature for contractors"
 * search and AI-answer intent, framed for restoration contractors. Every claim
 * maps to the real PDF & E-Sign tool: Sign in Person (/app/sign-in-person) on
 * the contractor's own device -- pick or add the customer, pick one or more
 * mapped forms, answer only what isn't on record, hand over the device; the
 * signer draws or types once and taps each line; nothing is saved until they
 * finish; the signed PDFs are emailed from the finish screen, in one email.
 * Also email requests (own link per signer, expiry, reminders, void, signed
 * PDF to every party on completion), auto-fill from customer/company records,
 * consent + IP/device/timestamp audit trail. Scopit ships no contract
 * templates -- copy says "your own" forms on purpose.
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingStep,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'Get the work authorization signed before you leave the driveway',
    body:
      'On a water or fire loss the homeowner is standing right there — that’s the moment to get the work authorization signed, not two days later over email. Open Sign in Person in Scopit, pick the customer or add them on the spot, choose the forms, and hand over your phone or tablet. The homeowner reads each document with their details already filled in, then signs it on the screen. No link to send, no app to install and no account to create.',
  },
  {
    h: 'Your own forms, filled in from your records',
    body:
      'Upload the PDFs you already use — work authorization, service contract, direction to pay, change order — and place the fields once. After that, the customer’s name, address, phone and email, your company details and the signing date fill themselves in. On-site, Scopit asks only for what isn’t on record yet, before you hand over the device. You can also turn a Scopit estimate or invoice into a PDF and send it for signature.',
  },
  {
    h: 'Every form and every signer in one hand-off',
    body:
      'Pick the work authorization, the direction to pay and whatever else the job needs, and the homeowner signs them one after another. They draw or type their signature once, then tap each line to place it, and Scopit won’t finish until every line is signed. Two homeowners sign their own lines on the same device. Nothing is saved until they finish, so a half-signed form never lands in the job file.',
  },
  {
    h: 'Not on-site? Send the same document by email',
    body:
      'When the homeowner, a co-owner or a property manager isn’t at the loss, send the request by email instead. Each signer gets their own link and sees only their own fields. Set an expiry, send reminders, and void a request if the scope changes.',
  },
  {
    h: 'A record of who signed, and when',
    body:
      'Each signer agrees to sign electronically before signing. Scopit records when the document was signed, along with the IP address and device, in an audit timeline on the request. After an in-person signing, email the homeowner every signed PDF in one email before you leave; an emailed request sends the completed PDF to you and every signer. Either way it’s ready for the job file or the carrier.',
  },
];

const STEPS: LandingStep[] = [
  {
    n: 1,
    h: 'Set up your form once',
    body: 'Upload your work authorization or contract PDF and place the signature, initials, date and text fields.',
  },
  {
    n: 2,
    h: 'Pick the customer',
    body: 'Pick an existing customer or add a new one. Their details and yours fill in; Scopit asks only for what’s missing.',
  },
  {
    n: 3,
    h: 'Hand over your device',
    body: 'The homeowner reads each form, agrees to sign electronically, and signs every line on your phone or tablet.',
  },
  {
    n: 4,
    h: 'Send the signed PDFs',
    body: 'Each signed form is saved to the customer, and you can email the homeowner all their copies in one email.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'Can a homeowner sign a contract in person on my phone or tablet?',
    a: 'Yes. Open Sign in Person from the PDF Editor or the customer’s page, pick the forms, and hand over your device. The homeowner reads each document, agrees to sign electronically, draws or types their signature once, and taps each signature line to place it.',
  },
  {
    q: 'Does the homeowner need an account or an app?',
    a: 'No. In person, they sign right on your phone or tablet. For an emailed request, they sign in their web browser from the link — nothing to install and no account to create.',
  },
  {
    q: 'Can I add a new customer on-site?',
    a: 'Yes. If the homeowner isn’t in Scopit yet, enter their name, email, phone and address during the visit. The customer is saved together with the signed documents when signing finishes.',
  },
  {
    q: 'Which documents can restoration contractors use?',
    a: 'Any PDF you already use — work authorizations, service contracts, direction-to-pay forms, change orders — plus estimates and invoices created in Scopit. Scopit doesn’t supply contract templates; you upload your own forms and set up their fields once.',
  },
  {
    q: 'Are electronic signatures legally binding?',
    a: 'In the U.S., the federal ESIGN Act and state UETA laws generally give electronic signatures the same effect as handwritten ones for most contracts. Scopit asks every signer to consent to signing electronically and records the time, IP address and device. Some documents, such as assignment-of-benefits forms in certain states, have extra rules — confirm requirements with your attorney.',
  },
  {
    q: 'Can more than one person sign the same document?',
    a: 'Yes. Each signer has their own role and fields. In person, two homeowners sign one after the other on the same device; by email, each gets their own link. The document is complete once everyone has signed.',
  },
  {
    q: 'What do I get after it’s signed?',
    a: 'A completed PDF with the signatures and a date stamp, saved on the customer’s Signatures tab and downloadable from Scopit, plus an audit timeline of the signing. After an in-person signing you can email the homeowner every signed PDF in one email; an emailed request sends the completed PDF to you and every signer automatically.',
  },
  {
    q: 'How much does it cost?',
    a: 'Scopit is free through December 31, 2026 during the beta, with every tool included — e-signature, packing estimates and the rest.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Water damage contents estimate', to: '/water-damage-contents-estimate' },
  { label: 'Fire damage contents estimate', to: '/fire-damage-contents-estimate' },
  { label: 'Packing calculator', to: '/packing-calculator' },
];

const InPersonContractSigningPage: React.FC = () => (
  <PackingLandingLayout
    path="/in-person-contract-signing"
    title="In-Person Contract Signing for Restoration | Scopit"
    description="Get work authorizations signed on-site: your forms fill in from your records and the homeowner signs on your phone or tablet. No app or account needed."
    breadcrumbName="In-Person Contract Signing"
    eyebrow="E-signature for restoration contractors"
    h1="Get contracts signed in person, on your phone or tablet"
    subhead="Hand the homeowner your device at the loss and get the work authorization signed on the spot — your own forms, filled in from your records, with the signed PDF ready to email before you leave."
    sections={SECTIONS}
    steps={STEPS}
    stepsHeading="How on-site signing works"
    faqHeading="In-person contract signing FAQ"
    faqs={FAQS}
    bottomCtaHeading="Get your next work authorization signed on-site"
    bottomCtaBody="Set up your form once, then get it signed at every loss. Free through December 31, 2026 during the beta."
    related={RELATED}
    primaryCta={{ label: 'Start free', to: '/register' }}
    secondaryCta={{ label: 'See all tools', to: '/' }}
    heroNote="Free through December 31, 2026 during the beta. Homeowners sign without an account."
  />
);

export default InPersonContractSigningPage;
