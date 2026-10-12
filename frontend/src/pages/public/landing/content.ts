/**
 * Landing page copy that is data rather than layout.
 *
 * FAQ entries are mirrored in the FAQPage JSON-LD in frontend/index.html —
 * update both together.
 */

export const BETA_END_LABEL = 'December 31, 2026';

export const FAQS: { q: string; a: string }[] = [
  { q: 'Can I use just one tool?', a: 'Yes. Use only the tools your jobs need.' },
  {
    q: 'Can I try it without signing up?',
    a: 'The packing demo runs on a sample room. Everything else needs a free account.',
  },
  { q: 'Is my data backed up?', a: 'Yes, automatically, every day.' },
  {
    q: 'What happens after the beta?',
    a: `The beta runs through ${BETA_END_LABEL}. Your estimates, invoices and customers stay, and beta users get special pricing at launch.`,
  },
];

/**
 * Real customer proof only. The proof band renders nothing while these are
 * empty, so placeholders never reach the live page.
 */
export const TESTIMONIALS: { quote: string; name: string; role: string }[] = [];
export const PROOF_STATS: { value: string; label: string }[] = [];

/** Sample estimate shown in the "Every tool lands here" section (illustrative). */
export const SAMPLE_ESTIMATE = {
  number: 'EST-1042',
  context: 'Water damage · Interior',
  rows: [
    { label: 'Contents pack-out', amount: 4011.4, source: 'From Packing Estimator' },
    { label: 'Drywall — tear out & replace', amount: 2180 },
    { label: 'Seal & paint walls', amount: 940 },
  ] as { label: string; amount: number; source?: string }[],
};

export const SAMPLE_ESTIMATE_TOTAL = SAMPLE_ESTIMATE.rows.reduce((sum, r) => sum + r.amount, 0);

export const formatUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
