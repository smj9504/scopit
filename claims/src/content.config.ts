/**
 * Typed content collections.
 *   guides     — homeowner guides (src/content/guides/*.md)
 *   notes      — adjuster estimating notes (src/content/notes/*.md)
 *   legal      — Privacy, Terms, Disclaimer, PA Listing Terms (src/content/legal/*.md)
 *   adjusters  — directory profiles. Loaded from Cloudflare D1 at build time;
 *                only license-verified listings ever reach this collection.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { STATE_CODES, LOSS_TYPE_CODES } from './shared/constants';
import { directoryLoader } from './directory/loader';

const stateCode = z.enum(STATE_CODES as [string, ...string[]]);
const lossType = z.enum(LOSS_TYPE_CODES as [string, ...string[]]);

const source = z.object({
  title: z.string(),
  publisher: z.string(),
  url: z.url({ protocol: /^https$/ }),
});

/** Publication status. Anything but "published" is noindexed and blocks launch. */
const status = z.enum(['placeholder', 'draft', 'published']);

const faq = z.object({ question: z.string(), answer: z.string() });

/**
 * A state-specific rule. Every rule must carry its own source link and a
 * last-reviewed date (legal guardrail: no uncited state rules).
 */
const stateRule = z.object({
  state: stateCode,
  topic: z.string(),
  /** Plain-language statement of the rule. Leave as "Pending review" until verified. */
  rule: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  lastReviewed: z.coerce.date(),
  /** False until an attorney (or the owner, for non-legal facts) has confirmed the row. */
  verified: z.boolean().default(false),
});

const photo = z.object({ src: z.string(), alt: z.string().min(10) });

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string().max(80),
    /** Meta description: 50–160 characters. */
    description: z.string().min(50).max(160),
    /** Plain-language summary shown at the top of the guide. */
    summary: z.string().min(40),
    date: z.coerce.date(),
    lastReviewed: z.coerce.date(),
    states: z.array(stateCode).min(1),
    lossTypes: z.array(lossType).default([]),
    sources: z.array(source).min(1),
    status,
    /** "pending" shows a review flag and blocks launch. */
    attorneyReview: z.enum(['not-needed', 'pending', 'done']).default('not-needed'),
    /** Only real questions answered on the page. Emits FAQPage schema when published. */
    faq: z.array(faq).default([]),
    /** Slugs (file names) of related guides. */
    related: z.array(z.string()).default([]),
    /** Sort order on lists. */
    order: z.number().int(),
    /** Set to serve the guide outside /guides/, e.g. "/what-is-a-public-adjuster/". */
    permalink: z.string().regex(/^\/[a-z0-9-/]+\/$/).optional(),
    /** Real job-site photo. Leave unset to show the neutral placeholder. */
    photo: photo.optional(),
    stateRules: z.array(stateRule).default([]),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string().max(90),
    description: z.string().min(50).max(160),
    summary: z.string().min(40),
    date: z.coerce.date(),
    lastReviewed: z.coerce.date(),
    sources: z.array(source).default([]),
    status,
    tags: z.array(z.string()).default([]),
    lossTypes: z.array(lossType).default([]),
    related: z.array(z.string()).default([]),
    order: z.number().int(),
    photo: photo.optional(),
  }),
});

const legal = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: z.string().min(50).max(160),
    lastUpdated: z.coerce.date(),
    /** Every legal page needs attorney review before launch. */
    attorneyReview: z.enum(['pending', 'done']),
    /** Shown to homeowners, adjusters, or both. */
    section: z.enum(['homeowners', 'adjusters', 'shared']).default('shared'),
  }),
});

const license = z.object({
  state: stateCode,
  number: z.string(),
  expiresOn: z.string(),
  verifiedOn: z.string(),
});

const adjusters = defineCollection({
  loader: directoryLoader(),
  schema: z.object({
    id: z.string(),
    slug: z.string(),
    businessName: z.string(),
    contactName: z.string(),
    officeCity: z.string().nullable(),
    officeState: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    lossTypes: z.array(lossType),
    bio: z.string(),
    listedOn: z.string().nullable(),
    licenses: z.array(license).min(1),
    states: z.array(stateCode).min(1),
    fixture: z.boolean(),
  }),
});

export const collections = { guides, notes, legal, adjusters };
