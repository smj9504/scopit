/**
 * Scopit - Insurance Packing Estimate Breakdown (SEO spoke page)
 * Route: /insurance-packing-estimate  (public, indexable)
 *
 * Targets "insurance packing estimate breakdown". Distinct intent: how the
 * estimate is structured for a contents claim and an adjuster's review, not the
 * calculator mechanics or the moving workflow. Every claim maps to a real
 * Scopit feature (itemized per-room/per-item breakdown, O&P, storage, exports).
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'Line items, not a lump sum',
    body:
      'A contents claim gets reviewed line by line, so a single number rarely survives. Scopit produces an itemized insurance packing estimate breakdown — labor hours, packing materials, storage, and overhead & profit — split per room and per item so the adjuster can see exactly what each figure represents.',
  },
  {
    h: 'Per-room and per-item detail',
    body:
      'Every room is inventoried and every item carries its own quantity and handling, so the breakdown ties the cost back to the actual contents in the home. That level of detail is what makes an estimate defensible when a claim is questioned.',
  },
  {
    h: 'Overhead, profit, and storage broken out',
    body:
      'O&P, material rates, and storage months are shown as their own lines rather than baked into a blended total. You can adjust the rates to your market and region, and the breakdown updates so the estimate reflects your real costs.',
  },
  {
    h: 'Photo documentation behind every number',
    body:
      'Because the estimate is built from room photos, the inventory is backed by images of the actual contents. That documentation trail supports the breakdown and speeds up review with the carrier.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is an insurance packing estimate breakdown?',
    a: 'It’s a packing estimate itemized the way an adjuster reviews a contents claim — labor, materials, storage, and overhead & profit shown as separate line items per room and per item, rather than one lump sum.',
  },
  {
    q: 'Does Scopit separate overhead & profit and storage?',
    a: 'Yes. O&P, material rates, and storage months are broken out as their own lines and are adjustable to your market, so the estimate reflects your real costs.',
  },
  {
    q: 'Is the estimate detailed per room and per item?',
    a: 'Yes. Each room is inventoried and each item carries its own quantity and handling, so every figure in the breakdown ties back to specific contents.',
  },
  {
    q: 'Can I export the breakdown to send to an adjuster?',
    a: 'Yes. Export a branded PDF or Excel packing report with the full itemized breakdown to send to the carrier or client.',
  },
  {
    q: 'Is it free to try?',
    a: 'Scopit is free during the beta. Try the live demo with no signup, or upload your own photos for a free itemized estimate.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Packing report', to: '/packing-report' },
];

const InsurancePackingEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/insurance-packing-estimate"
    title="Insurance Packing Estimate Breakdown | Scopit"
    description="Produce an itemized insurance packing estimate breakdown from room photos — labor, materials, storage, and O&P split per room and per item for contents claims."
    breadcrumbName="Insurance Packing Estimate"
    eyebrow="For contents claims & adjusters"
    h1="Insurance packing estimate breakdown, itemized per room"
    subhead="Turn room photos into a contents estimate an adjuster can read line by line — labor, materials, storage, and overhead & profit broken out per room and per item."
    sections={SECTIONS}
    faqHeading="Insurance packing estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Build a claim-ready packing estimate free"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized insurance packing estimate breakdown."
    related={RELATED}
  />
);

export default InsurancePackingEstimatePage;
