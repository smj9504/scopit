/**
 * Scopit - In-Person Contract Signing (SEO landing page)
 * Route: /in-person-contract-signing  (public, indexable)
 *
 * Targets "sign a contract in person / on-site e-signature for contractors"
 * search and AI-answer intent, framed for restoration contractors. Every claim
 * maps to the real PDF & E-Sign tool: Direct Link requests opened on the
 * contractor's own device (there is no separate kiosk mode), email requests,
 * user-uploaded forms with auto-fill from customer/company records, drawn or
 * typed signatures, consent + IP/device/timestamp audit trail, and a signed
 * PDF emailed to every party. Scopit ships no contract templates — copy says
 * "your own" forms on purpose.
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
      'On a water or fire loss the homeowner is standing right there — that’s the moment to get the work authorization signed, not two days later over email. Create a direct signing link in Scopit, open it on your phone or tablet, and hand the device over. The homeowner reviews the document and draws or types their signature on the screen. No app to install and no account to create.',
  },
  {
    h: 'Your own forms, filled in from your records',
    body:
      'Upload the PDFs you already use — work authorization, service contract, direction to pay, change order — and place the fields once. After that, the customer’s name, address, phone and email and your company details fill themselves in, so on-site you only pick the customer and hand over the device. You can also turn a Scopit estimate or invoice into a PDF and send it for signature.',
  },
  {
    h: 'Not on-site? Send the same document by email',
    body:
      'When the homeowner, a co-owner or a property manager isn’t at the loss, send the request by email instead. Each signer gets their own link and sees only their own fields. Set an expiry, send reminders, and void a request if the scope changes.',
  },
  {
    h: 'A record of who signed, and when',
    body:
      'Each signer agrees to sign electronically before signing. Scopit records when the document was viewed and signed, along with the signer’s IP address and device, in an audit timeline on the request. When everyone has signed, the completed PDF is emailed to you and to every signer — ready for the job file or the carrier.',
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
    body: 'Customer and company details fill in automatically. Add anything job-specific before sending.',
  },
  {
    n: 3,
    h: 'Hand over your device',
    body: 'Open the direct signing link on your phone or tablet, or email it if the signer isn’t there.',
  },
  {
    n: 4,
    h: 'Everyone gets the signed PDF',
    body: 'The completed document is emailed to you and every signer, with the audit timeline kept in Scopit.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'Can a homeowner sign a contract in person on my phone or tablet?',
    a: 'Yes. Create the signing request as a direct link, open it on your own phone or tablet, and hand it to the homeowner. They review the document, agree to sign electronically, and draw or type their signature on the screen.',
  },
  {
    q: 'Does the homeowner need an account or an app?',
    a: 'No. Signing happens in the web browser from the signing link — the homeowner doesn’t install anything or create an account.',
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
    a: 'Yes. Add each signer — for example two homeowners, or a homeowner and a property manager — with their own role. Each gets their own link and fields, and the document is complete once everyone has signed.',
  },
  {
    q: 'What do I get after it’s signed?',
    a: 'A completed PDF with the signatures and a date stamp, emailed to you and every signer and downloadable from Scopit, plus an audit timeline showing when the document was sent, viewed and signed.',
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
    description="Get work authorizations signed on-site: open the signing link on your phone or tablet and hand it to the homeowner. No app or account needed."
    breadcrumbName="In-Person Contract Signing"
    eyebrow="E-signature for restoration contractors"
    h1="Get contracts signed in person, on your phone or tablet"
    subhead="Hand the homeowner your device at the loss and get the work authorization signed on the spot — your own forms, filled in from your records, with a signed PDF emailed to everyone."
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
