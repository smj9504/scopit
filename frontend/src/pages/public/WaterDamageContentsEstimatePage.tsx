/**
 * Scopit - Water Damage Contents Estimate (SEO spoke page)
 * Route: /water-damage-contents-estimate  (public, indexable)
 *
 * Targets water-damage contents / pack-out search intent. Content is genuinely
 * scenario-specific (drying timeline, moisture-driven pack-out, storage while
 * the structure dries) rather than a clone of the generic packing pages — every
 * claim maps to a real Scopit feature (photo-based itemized packing estimate).
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'Why water damage jobs need a fast contents estimate',
    body:
      'On a water loss the clock matters — contents have to be moved out so the structure can be dried before secondary damage sets in. That means pricing the pack-out on day one, often during the same walkthrough as the moisture mapping. Scopit builds the contents estimate from room photos on the spot, so the pack-out isn’t the thing that holds up mitigation.',
  },
  {
    h: 'Pack-out to storage while the structure dries',
    body:
      'Water damage contents usually leave the property while dehumidifiers and air movers run. Scopit prices the pack-out, the storage months the drying will take, and the eventual pack-back — so the whole contents portion of the water loss is estimated together, not bolted on later as a change order.',
  },
  {
    h: 'Separate salvageable from non-salvageable contents',
    body:
      'Not everything survives a water loss. Photograph each room and itemize what gets cleaned and stored versus what’s a total loss, with per-item pricing an adjuster can review. The result is a defensible water-damage contents estimate rather than a lump-sum guess.',
  },
  {
    h: 'An itemized breakdown for the water claim',
    body:
      'Scopit splits labor, materials, storage, and overhead & profit per room and per item, so the contents estimate reads clearly alongside the mitigation and structural portions of the water damage claim.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is a water damage contents estimate?',
    a: 'It’s the cost to pack, move, store, and return a property’s contents during a water loss so the structure can be dried and repaired — plus pricing for cleaning salvageable items and documenting non-salvageable ones. Scopit builds it from room photos.',
  },
  {
    q: 'How fast can I produce one on-site?',
    a: 'Minutes. Photograph each room during the walkthrough and Scopit itemizes the contents and pack-out, so you can price it while you’re still mapping moisture.',
  },
  {
    q: 'Does it include storage while the structure dries?',
    a: 'Yes. You set the storage months the drying will take, and Scopit prices the pack-out, storage, and pack-back together.',
  },
  {
    q: 'Can I document non-salvageable contents?',
    a: 'Yes. The itemized, per-room breakdown lets you separate cleaned/stored items from total losses, so the water damage claim is clear and defensible.',
  },
  {
    q: 'Do I need an account to try it?',
    a: 'No. Try the live demo with sample rooms — no signup — or upload your own photos for a free water-damage contents estimate.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Fire damage contents estimate', to: '/fire-damage-contents-estimate' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
];

const WaterDamageContentsEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/water-damage-contents-estimate"
    title="Water Damage Contents Estimate Software | Scopit"
    description="Price the pack-out and contents on a water loss from room photos — storage while the structure dries, salvageable vs total loss, itemized for the claim."
    breadcrumbName="Water Damage Contents Estimate"
    eyebrow="For water mitigation & restoration"
    h1="Water damage contents estimates, built from room photos"
    subhead="Price the pack-out, storage, and pack-back for a water loss on the same walkthrough as your moisture mapping — itemized per room so mitigation never waits on the contents number."
    sections={SECTIONS}
    faqHeading="Water damage contents estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Estimate a water-damage pack-out in minutes"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized water-damage contents estimate."
    related={RELATED}
  />
);

export default WaterDamageContentsEstimatePage;
