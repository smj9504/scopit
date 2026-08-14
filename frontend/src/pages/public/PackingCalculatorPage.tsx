/**
 * Scopit - Packing Calculator (SEO hub page)
 * Route: /packing-calculator  (public, indexable)
 *
 * The hub of the packing topic cluster. Targets "packing calculator" and links
 * out to the keyword-specific spokes (/pack-out-estimate,
 * /insurance-packing-estimate, /packing-report). Content is supplied to the
 * shared PackingLandingLayout; every claim maps to a real Scopit feature.
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
    h: 'A photo-based packing calculator',
    body:
      'Snap a few photos of each room and Scopit’s AI identifies the contents, then calculates the packing estimate for you — box counts, material, and crew labor hours. No spreadsheets, no guessing cube counts by hand. It’s the fastest way to turn a walkthrough into a defensible number.',
  },
  {
    h: 'Pack-in and pack-out estimates',
    body:
      'Restoration jobs need both directions: the pack-out (contents boxed, inventoried, and moved to storage) and the pack-back / pack-in (returned and unpacked once the structure is dry). Scopit prices pack-out and pack-back together, with storage months, crew size, and staging all adjustable, so your pack-in pack-out estimate reflects the real scope.',
  },
  {
    h: 'An insurance-ready packing estimate breakdown',
    body:
      'Adjusters want line items, not a lump sum. Scopit produces an itemized insurance packing estimate breakdown — labor hours, materials, storage, and overhead & profit split out per room and per item — so the estimate reads clearly against the claim and holds up in review.',
  },
  {
    h: 'A professional packing report',
    body:
      'Export a clean packing report as a PDF or Excel file to send to the client, the carrier, or your crew. The report carries your company branding, the room-by-room inventory, and the full cost breakdown — a document you can hand over without reformatting anything.',
  },
];

const STEPS: LandingStep[] = [
  { n: 1, h: 'Photograph each room', body: 'Upload room photos — the AI detects the contents and their volume automatically.' },
  { n: 2, h: 'Review the auto-built estimate', body: 'Scopit calculates pack-out and pack-back labor, materials, and storage. Adjust anything.' },
  { n: 3, h: 'Export your packing report', body: 'Download a branded PDF/Excel packing report with the full insurance-ready breakdown.' },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is a packing calculator?',
    a: 'A packing calculator estimates what it costs to pack a property — box counts, packing materials, and crew labor hours. Scopit does this from room photos, so instead of counting boxes by hand you get an itemized estimate in minutes.',
  },
  {
    q: 'Does Scopit handle both pack-out and pack-back?',
    a: 'Yes. Scopit estimates the pack-out (packing and moving contents to storage) and the pack-back / pack-in (returning and unpacking) in one place, with adjustable storage months, crew size, and staging.',
  },
  {
    q: 'Can I produce an insurance packing estimate breakdown?',
    a: 'Yes. Every estimate is itemized — labor, materials, storage, and overhead & profit are broken out per room and per item — so it reads clearly against an insurance claim rather than as a single lump sum.',
  },
  {
    q: 'What’s included in the packing report?',
    a: 'The packing report is a branded PDF or Excel export with the room-by-room inventory and the full cost breakdown, ready to send to a client, adjuster, or crew.',
  },
  {
    q: 'Is it free?',
    a: 'Scopit is free during the beta. You can try the live demo with no signup, or get a free itemized packing estimate from your own photos.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
  { label: 'Packing report', to: '/packing-report' },
];

const PackingCalculatorPage: React.FC = () => (
  <PackingLandingLayout
    path="/packing-calculator"
    title="Packing Calculator & Pack-Out Estimate | Scopit"
    description="Scopit's packing calculator builds itemized pack-out and pack-back estimates from room photos — insurance-ready breakdowns and a shareable packing report."
    breadcrumbName="Packing Calculator"
    eyebrow="For restoration & moving pros"
    h1="The packing calculator that turns room photos into a pack-out estimate"
    subhead="Photograph each room and Scopit builds an itemized pack-in / pack-out estimate — an insurance-ready breakdown of labor, materials, and storage — then exports it as a professional packing report."
    sections={SECTIONS}
    steps={STEPS}
    stepsHeading="How the packing calculator works"
    faqHeading="Packing calculator FAQ"
    faqs={FAQS}
    bottomCtaHeading="Build your first packing estimate free"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized packing estimate with a full insurance-ready breakdown."
    related={RELATED}
  />
);

export default PackingCalculatorPage;
