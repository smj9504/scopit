/**
 * Scopit - Packing Report (SEO spoke page)
 * Route: /packing-report  (public, indexable)
 *
 * Targets "packing report". Distinct intent: the deliverable/export — the
 * document you hand to a client, carrier, or crew — not the calculator or the
 * moving workflow. Every claim maps to a real Scopit feature (branded PDF/Excel
 * export, room-by-room inventory, full cost breakdown).
 */
import React from 'react';
import PackingLandingLayout, {
  type LandingSection,
  type LandingFaq,
  type RelatedLink,
} from '@/components/PackingLandingLayout';

const SECTIONS: LandingSection[] = [
  {
    h: 'A report you can hand over as-is',
    body:
      'The packing report is the deliverable at the end of the estimate — a clean, professional document you can send to the client, the insurance carrier, or your own crew without reformatting anything. Everything the estimate produced is laid out in one place.',
  },
  {
    h: 'Room-by-room inventory and full cost breakdown',
    body:
      'The report lists the contents room by room and shows the complete cost breakdown — labor, materials, storage, and overhead & profit — so whoever receives it can see both what’s being packed and what it costs, line by line.',
  },
  {
    h: 'PDF or Excel, with your branding',
    body:
      'Export the packing report as a PDF to send or print, or as an Excel file to work with the numbers further. Either way it carries your company name and details, so it goes out looking like your document, not a generic printout.',
  },
  {
    h: 'Generated straight from the photos',
    body:
      'Because the report is built from the same room photos that produced the estimate, the inventory and the numbers always match. Photograph the rooms, review the estimate, and the packing report is ready to export.',
  },
];

const FAQS: LandingFaq[] = [
  {
    q: 'What is a packing report?',
    a: 'A packing report is the finished document from a packing estimate — a room-by-room contents inventory plus the full cost breakdown, formatted to send to a client, adjuster, or crew.',
  },
  {
    q: 'What formats can I export?',
    a: 'You can export the packing report as a branded PDF or as an Excel file, depending on whether you want to send/print it or keep working with the numbers.',
  },
  {
    q: 'Is my company branding on the report?',
    a: 'Yes. The report carries your company name and details so it goes out as your document rather than a generic printout.',
  },
  {
    q: 'What’s included in the report?',
    a: 'The room-by-room inventory and the full itemized cost breakdown — labor, materials, storage, and overhead & profit — the same figures the estimate produced.',
  },
  {
    q: 'Can I see a packing report before signing up?',
    a: 'Yes. The live demo lets you generate and export a real packing report from sample rooms with no signup.',
  },
];

const RELATED: RelatedLink[] = [
  { label: 'Packing calculator', to: '/packing-calculator' },
  { label: 'Pack-out estimate', to: '/pack-out-estimate' },
  { label: 'Insurance packing estimate', to: '/insurance-packing-estimate' },
];

const PackingReportPage: React.FC = () => (
  <PackingLandingLayout
    path="/packing-report"
    title="Packing Report — PDF & Excel Export | Scopit"
    description="Generate a professional packing report from room photos — a branded PDF or Excel with the room-by-room inventory and full cost breakdown for clients and carriers."
    breadcrumbName="Packing Report"
    eyebrow="The deliverable"
    h1="Packing reports you can hand to the client or carrier"
    subhead="Turn a packing estimate into a branded PDF or Excel packing report — the room-by-room inventory and the full cost breakdown, ready to send without reformatting."
    sections={SECTIONS}
    faqHeading="Packing report FAQ"
    faqs={FAQS}
    bottomCtaHeading="Generate a packing report free"
    bottomCtaBody="Try the live demo with sample rooms and export a real packing report, or upload your own photos for a free estimate and report."
    related={RELATED}
  />
);

export default PackingReportPage;
