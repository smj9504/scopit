/**
 * Scopit - Xactimate Packing Estimate (SEO spoke page)
 * Route: /xactimate-packing-estimate  (public, indexable)
 *
 * Targets "xactimate packing estimate" / "xactimate contents" / "xactimate
 * alternative for packing" search intent. Positioning is HONEST about the
 * current product: Scopit is a fast, photo-based packing/contents estimator
 * that runs ALONGSIDE Xactimate (not a replacement for the structural
 * estimate). Direct ESX export to Xactimate is NOT built yet — it is described
 * only as a roadmap item, never as an existing feature. When ESX export ships,
 * update the roadmap section + FAQ to claim the integration.
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'Xactimate is the standard — contents is where it drags',
    body:
      'Xactimate is the industry standard for the structural estimate, and it stays that way. The slow part is contents: pricing a pack-out line by line, room by room, is tedious hand work. Scopit takes that piece off your plate so your Xactimate structural estimate and your packing estimate both get done faster.',
  },
  {
    h: 'Build the packing estimate from room photos',
    body:
      'Instead of counting cartons on a clipboard, photograph each room and let Scopit’s AI detect the contents and volume. In minutes you get an itemized packing and pack-out estimate — cartons, materials, crew hours, storage — for the contents side of the claim.',
  },
  {
    h: 'An itemized breakdown adjusters recognize',
    body:
      'Scopit splits labor, materials, storage, and overhead & profit per room and per item — the same itemized shape an adjuster expects. It reads clearly next to your Xactimate structural estimate rather than as a lump-sum contents guess.',
  },
  {
    h: 'ESX export to Xactimate — on our roadmap',
    body:
      'Direct .ESX export into Xactimate is on the Scopit roadmap; it is not available yet. Today you can export a branded PDF or Excel packing report to attach to the claim or hand to your team, and re-key the totals into Xactimate if needed. When native ESX export ships, this page will be updated.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'Does Scopit integrate with Xactimate?',
    a: 'Not yet. Direct .ESX export to Xactimate is on our roadmap, not a current feature. Today Scopit exports a branded PDF or Excel packing report you can attach alongside your Xactimate estimate.',
  },
  {
    q: 'Is Scopit a replacement for Xactimate?',
    a: 'No. Xactimate remains the standard for the structural estimate. Scopit speeds up the packing and contents side — building an itemized pack-out estimate from photos — to run alongside it.',
  },
  {
    q: 'Can I use Scopit’s packing numbers in an insurance claim?',
    a: 'Yes. Every estimate is itemized — labor, materials, storage, and overhead & profit per room and per item — so it reads clearly against a contents claim.',
  },
  {
    q: 'How fast is a packing estimate in Scopit?',
    a: 'Minutes. Photograph each room, let the AI itemize the contents, adjust storage and crew, and export the packing report — instead of pricing contents by hand.',
  },
  {
    q: 'Do I need an account to try it?',
    a: 'No. You can try the live demo with sample rooms — no signup — or upload your own photos for a free, itemized packing estimate.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
];

const XactimatePackingEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/xactimate-packing-estimate"
    title="Xactimate Packing Estimate Alternative | Scopit"
    description="Price restoration packing & contents fast with photo-based estimates — an itemized breakdown to run alongside Xactimate. ESX export is on our roadmap."
    breadcrumbName="Xactimate Packing Estimate"
    eyebrow="For restoration & contents pros"
    h1="Fast packing & contents estimates for Xactimate workflows"
    subhead="Scopit builds the packing and pack-out estimate from room photos, so the contents side gets done in minutes — an itemized breakdown to run alongside your Xactimate structural estimate."
    sections={SECTIONS}
    faqHeading="Xactimate packing estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Estimate the contents side in minutes"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized packing estimate you can run alongside Xactimate."
    related={RELATED}
  />
);

export default XactimatePackingEstimatePage;
