/**
 * Scopit - Fire Damage Contents Estimate (SEO spoke page)
 * Route: /fire-damage-contents-estimate  (public, indexable)
 *
 * Targets fire/smoke-damage contents search intent. Scenario-specific content
 * (soot/smoke cleaning vs replacement, off-site content cleaning pack-out,
 * odor) — not a clone of the water-damage or generic packing pages. Every
 * claim maps to a real Scopit feature (photo-based itemized contents estimate).
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'Fire and smoke losses are a contents-heavy job',
    body:
      'After a fire, much of the claim is contents: soot and smoke reach items in rooms the flames never touched. Pricing that means going room by room and deciding what can be cleaned and deodorized versus what’s a total loss. Scopit turns room photos into an itemized contents estimate so the fire job’s biggest, most tedious piece gets done fast.',
  },
  {
    h: 'Clean-and-store vs replace, itemized',
    body:
      'Some contents are restorable with cleaning and odor treatment; others are gone. Photograph each room and Scopit itemizes the contents so you can separate clean-and-return from non-salvageable, with per-item pricing an adjuster can follow on a fire claim.',
  },
  {
    h: 'Pack-out for off-site content cleaning',
    body:
      'Fire contents are often packed out to a facility for cleaning, deodorizing, and storage, then returned. Scopit prices the pack-out, the storage duration, and the pack-back together, so the contents-cleaning workflow is estimated as one job.',
  },
  {
    h: 'An itemized breakdown for the fire claim',
    body:
      'Scopit splits labor, materials, storage, and overhead & profit per room and per item, so your fire-damage contents estimate reads clearly alongside the structural and cleaning portions of the claim.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is a fire damage contents estimate?',
    a: 'It’s the cost to handle a property’s contents after a fire — packing out, cleaning and deodorizing salvageable items, storing them, returning them, and documenting non-salvageable losses. Scopit builds it from room photos.',
  },
  {
    q: 'Does it handle smoke/soot cleaning vs replacement?',
    a: 'Yes. The itemized, per-room breakdown lets you separate clean-and-return contents from total losses, which is where most of a fire contents estimate is decided.',
  },
  {
    q: 'Can I price an off-site contents pack-out?',
    a: 'Yes. Scopit prices the pack-out for off-site cleaning, the storage months, and the pack-back together, so the whole fire contents workflow is one estimate.',
  },
  {
    q: 'Is the estimate itemized for insurance?',
    a: 'Yes. Labor, materials, storage, and overhead & profit are broken out per room and per item so the fire claim reads clearly rather than as a lump sum.',
  },
  {
    q: 'Do I need an account to try it?',
    a: 'No. Try the live demo with sample rooms — no signup — or upload your own photos for a free fire-damage contents estimate.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Water damage contents estimate', to: '/water-damage-contents-estimate' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
];

const FireDamageContentsEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/fire-damage-contents-estimate"
    title="Fire Damage Contents Estimate Software | Scopit"
    description="Price fire & smoke contents from room photos — clean-and-store vs total loss, off-site cleaning pack-out, storage, itemized per room for the claim."
    breadcrumbName="Fire Damage Contents Estimate"
    eyebrow="For fire & smoke restoration"
    h1="Fire damage contents estimates, built from room photos"
    subhead="Price the contents side of a fire loss fast — clean-and-store vs total loss, the off-site cleaning pack-out, and storage — itemized per room so the biggest part of the claim isn’t done by hand."
    sections={SECTIONS}
    faqHeading="Fire damage contents estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Estimate a fire contents job in minutes"
    bottomCtaBody="Try the live demo with sample rooms, or upload your own photos for a free, itemized fire-damage contents estimate."
    related={RELATED}
  />
);

export default FireDamageContentsEstimatePage;
