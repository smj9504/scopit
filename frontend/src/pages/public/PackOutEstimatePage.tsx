/**
 * Scopit - Pack-Out Estimate (SEO spoke page)
 * Route: /pack-out-estimate  (public, indexable)
 *
 * Targets "pack-in pack-out estimate" and the restoration pack-out/pack-back
 * workflow. Distinct intent from the hub: the moving/storage side of a contents
 * job, not the calculator mechanics. Content maps to real Scopit features
 * (pack-out + pack-back pricing, storage months, crew size, staging).
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'What a pack-out estimate covers',
    body:
      'A pack-out is the labor and materials to box, wrap, inventory, and move a property’s contents off-site so the structure can be dried and repaired. Scopit builds the pack-out estimate from room photos — cartons, packing paper, bubble, and the crew hours to pack and load — so nothing gets missed on the front end of the job.',
  },
  {
    h: 'Pack-back and pack-in, priced together',
    body:
      'Every pack-out eventually becomes a pack-back (also called pack-in): the contents come out of storage, return to the property, and get unpacked and placed. Scopit prices the return trip alongside the pack-out so your pack-in pack-out estimate is complete from day one, not a surprise change order later.',
  },
  {
    h: 'Storage, crew size, and staging you control',
    body:
      'Contents jobs vary — a few months in storage or many, a two-person crew or a full team, on-site staging or a warehouse. Scopit lets you set storage months, crew size, and staging so the pack-out estimate matches how you actually run the job and region.',
  },
  {
    h: 'From walkthrough photos to a defensible number',
    body:
      'Instead of eyeballing cube counts on a clipboard, photograph each room and let the AI detect the contents and volume. You get a pack-out estimate you can stand behind in front of an adjuster or a homeowner in minutes, not hours.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is a pack-out estimate?',
    a: 'A pack-out estimate is the cost to pack, inventory, and move a property’s contents off-site during a restoration job — cartons and packing materials plus the crew labor to pack and load. Scopit builds it from room photos.',
  },
  {
    q: 'What’s the difference between pack-out and pack-back (pack-in)?',
    a: 'Pack-out is moving contents out to storage so the structure can be repaired; pack-back — also called pack-in — is returning and unpacking them once the property is ready. Scopit prices both together.',
  },
  {
    q: 'Can I adjust storage duration and crew size?',
    a: 'Yes. Storage months, crew size, and staging are all adjustable, so the pack-out estimate reflects how the job actually runs rather than a fixed template.',
  },
  {
    q: 'Is the pack-out estimate itemized for insurance?',
    a: 'Yes. The estimate breaks out labor, materials, storage, and overhead & profit per room and per item, so it reads clearly against a contents claim.',
  },
  {
    q: 'Do I need an account to try it?',
    a: 'No. You can try the live demo with sample rooms — no signup — or upload your own photos for a free pack-out estimate.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
  { label: 'Packing report', to: '/packing-report' },
];

const PackOutEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/pack-out-estimate"
    title="Pack-Out & Pack-Back Estimate Software | Scopit"
    description="Build pack-in / pack-out estimates from room photos. Scopit prices the pack-out and the pack-back together — storage, crew, and staging — for restoration jobs."
    breadcrumbName="Pack-Out Estimate"
    eyebrow="For restoration contractors"
    h1="Pack-out & pack-back estimates, built from room photos"
    subhead="Estimate the whole contents job in one place — the pack-out to storage and the pack-back / pack-in — with storage months, crew size, and staging you control."
    sections={SECTIONS}
    faqHeading="Pack-out estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Estimate your next pack-out in minutes"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized pack-out and pack-back estimate."
    related={RELATED}
  />
);

export default PackOutEstimatePage;
