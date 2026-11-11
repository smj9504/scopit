/**
 * Scopit - Bathroom Estimate (SEO landing page)
 * Route: /bathroom-estimate  (public, indexable)
 *
 * Targets "bathroom estimate software / bathroom remodel estimate / water
 * damage bathroom estimate" search and AI-answer intent. Every claim maps to
 * the real Bathroom Estimator (/app/tools/bathroom_estimate): draw the room on
 * a floor plan (walls, fixtures, tile zones, damage marks) with a 3D view;
 * priced in seven phases (PHASE_LABELS: demo & disposal, plumbing &
 * electrical, substrate & waterproofing, tile & flooring, fixtures install,
 * paint & trim, punch & cleanup) including water-damage repairs and detach &
 * reset; insurance restoration with upgrade options, or a remodel priced
 * against the current layout (moved plumbing and walls); detailed or clean PDF
 * with the sketch, customer proposal of every option; any estimate or option
 * becomes a Scopit estimate. Keep this in step with public/llms.txt.
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
    h: 'Draw the bathroom on a floor plan',
    body:
      'Lay out the walls, place the tub or shower, toilet, vanity and other fixtures, and mark the tile zones and the damage. Scopit shows the room in 3D as you draw, and the estimate takes its measurements from the plan instead of a separate takeoff.',
  },
  {
    h: 'Priced phase by phase, demo to punch list',
    body:
      'Every bathroom estimate is laid out in the seven phases the job runs in: demo & disposal, plumbing & electrical, substrate & waterproofing, tile & flooring, fixtures install, paint & trim, and punch & cleanup. The homeowner and the adjuster can see where the money goes.',
  },
  {
    h: 'Water-damage restorations, with upgrade options',
    body:
      'On a water loss, price the repairs and the detach & reset the claim covers, then add upgrade options and compare each one against the restoration.',
  },
  {
    h: 'Remodels priced against the current layout',
    body:
      'For a remodel, Scopit prices the new bathroom against the one that’s there now, so moving the plumbing or a wall shows up as real work on the estimate instead of a surprise later.',
  },
  {
    h: 'A PDF with the sketch, and a proposal of every option',
    body:
      'Export a detailed or a clean PDF with the floor plan on it, or a customer proposal that lays out every option. When the homeowner picks one, turn it into a Scopit estimate and invoice from there.',
  },
];

const STEPS: LandingStep[] = [
  { n: 1, h: 'Draw the floor plan', body: 'Walls, fixtures, tile zones and damage marks — checked in 3D.' },
  { n: 2, h: 'Price the seven phases', body: 'From demo & disposal to punch & cleanup, including water-damage repairs.' },
  { n: 3, h: 'Add options', body: 'Upgrade options on an insurance job, or a remodel priced against the current layout.' },
  { n: 4, h: 'Send the PDF or proposal', body: 'A detailed or clean PDF with the sketch, or a proposal of every option.' },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What phases does a bathroom estimate cover?',
    a: 'Seven: demo & disposal, plumbing & electrical, substrate & waterproofing, tile & flooring, fixtures install, paint & trim, and punch & cleanup.',
  },
  {
    q: 'Can I estimate a water-damaged bathroom for an insurance claim?',
    a: 'Yes. Mark the damage on the floor plan and price the water-damage repairs and detach & reset as a restoration, then add upgrade options the homeowner can choose.',
  },
  {
    q: 'Does it handle bathroom remodels?',
    a: 'Yes. A remodel is priced against the current layout, so moved plumbing and moved walls are counted as work on the estimate.',
  },
  {
    q: 'Do I need to measure everything by hand?',
    a: 'No separate takeoff. Draw the bathroom on the floor plan and the estimate takes its measurements from the drawing.',
  },
  {
    q: 'What can I send the homeowner?',
    a: 'A detailed or a clean PDF with the sketch, or a customer proposal of every option. Any estimate or option can also become a Scopit estimate you invoice from.',
  },
  {
    q: 'How much does it cost?',
    a: 'Scopit is free through December 31, 2026 during the beta, with every tool included — the Bathroom Estimator, the Cabinet Estimator, packing estimates, e-signature and the rest.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Kitchen cabinet estimate', to: '/kitchen-cabinet-estimate' },
  { label: 'Water damage contents estimate', to: '/water-damage-contents-estimate' },
  { label: 'In-person contract signing', to: '/in-person-contract-signing' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
];

const BathroomEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/bathroom-estimate"
    title="Bathroom Estimate Software for Contractors | Scopit"
    description="Draw the bathroom on a floor plan and price it in seven phases, demo to punch list. Water-damage restorations, upgrade options and remodels, with a PDF."
    breadcrumbName="Bathroom Estimate"
    eyebrow="Bathroom estimating for restoration & remodel contractors"
    h1="Bathroom estimates, drawn and priced phase by phase"
    subhead="Draw the bathroom on a floor plan, and Scopit prices it in seven phases from demo to punch list — for water-damage restorations with upgrade options, and for remodels."
    sections={SECTIONS}
    steps={STEPS}
    stepsHeading="How a bathroom estimate works"
    faqHeading="Bathroom estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Price your next bathroom from the floor plan"
    bottomCtaBody="Draw it once, price every phase. Free through December 31, 2026 during the beta."
    related={RELATED}
    primaryCta={{ label: 'Start free', to: '/register' }}
    secondaryCta={{ label: 'See all tools', to: '/' }}
    heroNote="Free through December 31, 2026 during the beta. 3D view · PDF with the sketch."
  />
);

export default BathroomEstimatePage;
