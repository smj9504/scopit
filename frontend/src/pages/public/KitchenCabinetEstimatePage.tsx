/**
 * Scopit - Kitchen Cabinet Estimate (SEO landing page)
 * Route: /kitchen-cabinet-estimate  (public, indexable)
 *
 * Targets "kitchen cabinet estimate software / cabinet estimating for
 * contractors" search and AI-answer intent, framed for restoration and remodel
 * contractors. Every claim maps to the real Cabinet Estimator
 * (/app/tools/cabinet_estimate): sketch walls, cabinets and appliances with
 * front elevations and a 3D view; Tier sets the uppers' starting height (Stock
 * 30", Semi-Custom 36", Custom 42"); prices cabinets plus demo, install,
 * countertop, backsplash, plumbing, appliance detach & reset, trim and permit
 * on insurance-claim or remodel rates the company can replace with its own;
 * restoration + upgrade options compared side by side; outputs a PDF quote, a
 * design quote with drawings, a customer proposal of every option and a
 * supplier purchase order (Excel); any estimate or option becomes a Scopit
 * estimate. Keep this in step with public/llms.txt.
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
    h: 'Sketch the kitchen once, price every box from it',
    body:
      'Lay out the walls, then place the base, wall and tall cabinets, the island and the appliances. Scopit draws the front elevation of each wall and a 3D view of the room as you go, so you can check the layout with the homeowner before you price it. The estimate reads its cabinet count and sizes straight off the sketch — no separate takeoff.',
  },
  {
    h: 'Everything around the cabinets, on the same estimate',
    body:
      'A cabinet job is never just cabinets. Scopit prices the demo, the install, the countertop, the backsplash, the plumbing, appliance detach & reset, trim and the permit alongside the boxes, so the number you hand over covers the whole kitchen.',
  },
  {
    h: 'Restoration and upgrade options, side by side',
    body:
      'On an insurance job, price the like-kind restoration the carrier pays for, then add upgrade options — a higher cabinet tier or a different countertop — and compare them side by side. The homeowner sees exactly what each upgrade adds over the restoration before they decide.',
  },
  {
    h: 'Your prices, not ours',
    body:
      'Pick insurance-claim or remodel rates to start, and the Tier (Stock, Semi-Custom or Custom) sets the uppers at 30″, 36″ or 42″. Replace any of Scopit’s prices with your company’s own, and every new estimate uses them.',
  },
  {
    h: 'A quote for the homeowner and an order for the supplier',
    body:
      'Export a PDF quote, a design quote with the drawings, or a customer proposal of every option. Send the supplier a purchase order in Excel. When the homeowner says yes, turn the estimate or the option they picked into a Scopit estimate and invoice it from there.',
  },
];

const STEPS: LandingStep[] = [
  { n: 1, h: 'Sketch the kitchen', body: 'Draw the walls and place the cabinets, island and appliances. Check it in elevation and 3D.' },
  { n: 2, h: 'Pick the tier and rates', body: 'Choose Stock, Semi-Custom or Custom and insurance or remodel rates — or your own prices.' },
  { n: 3, h: 'Add upgrade options', body: 'Price the restoration, then compare upgrade options side by side.' },
  { n: 4, h: 'Send the quote and order', body: 'Export the PDF quote or proposal for the homeowner and the purchase order for the supplier.' },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What does the kitchen cabinet estimate include?',
    a: 'The cabinets themselves plus the work around them: demo, install, countertop, backsplash, plumbing, appliance detach & reset, trim and permit. Everything is priced off the kitchen you sketch.',
  },
  {
    q: 'Can I use it for insurance claims?',
    a: 'Yes. Start on insurance-claim rates and price the like-kind restoration, then add upgrade options the homeowner can pay the difference for. Each option is compared side by side with the restoration.',
  },
  {
    q: 'Does it work for remodels too?',
    a: 'Yes. Switch to remodel rates and price the kitchen the homeowner wants. The same sketch, options and exports apply.',
  },
  {
    q: 'Can I use my own prices?',
    a: 'Yes. Scopit starts with insurance-claim and remodel rates, and your company can replace any of them with its own prices.',
  },
  {
    q: 'What cabinet tiers does it support?',
    a: 'Stock, Semi-Custom and Custom. The tier also starts the upper cabinets at a typical height — 30″, 36″ or 42″ — which you can change.',
  },
  {
    q: 'What can I export?',
    a: 'A PDF quote, a design quote with the drawings, a customer proposal of every option, and a supplier purchase order in Excel. Any estimate or option can also become a Scopit estimate you invoice from.',
  },
  {
    q: 'How much does it cost?',
    a: 'Scopit is free through December 31, 2026 during the beta, with every tool included — the Cabinet Estimator, the Bathroom Estimator, packing estimates, e-signature and the rest.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Bathroom estimate', to: '/bathroom-estimate' },
  { label: 'In-person contract signing', to: '/in-person-contract-signing' },
  { label: 'Water damage contents estimate', to: '/water-damage-contents-estimate' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
];

const KitchenCabinetEstimatePage: React.FC = () => (
  <PackingLandingLayout
    path="/kitchen-cabinet-estimate"
    title="Kitchen Cabinet Estimate Software for Contractors | Scopit"
    description="Sketch the kitchen and price cabinets, countertop, demo, plumbing and install. Insurance restoration and upgrade options side by side, with a PDF quote."
    breadcrumbName="Kitchen Cabinet Estimate"
    eyebrow="Cabinet estimating for restoration & remodel contractors"
    h1="Kitchen cabinet estimates, priced from your sketch"
    subhead="Sketch the kitchen, and Scopit prices the cabinets, countertop, demo, plumbing and install from it — with restoration and upgrade options side by side for insurance jobs."
    sections={SECTIONS}
    steps={STEPS}
    stepsHeading="How a cabinet estimate works"
    faqHeading="Kitchen cabinet estimate FAQ"
    faqs={FAQS}
    bottomCtaHeading="Price your next kitchen from the sketch"
    bottomCtaBody="Sketch it once, quote every option. Free through December 31, 2026 during the beta."
    related={RELATED}
    primaryCta={{ label: 'Start free', to: '/register' }}
    secondaryCta={{ label: 'See all tools', to: '/' }}
    heroNote="Free through December 31, 2026 during the beta. 3D view · PDF quote · Purchase order."
  />
);

export default KitchenCabinetEstimatePage;
