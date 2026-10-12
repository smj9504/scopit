# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Office and admin staff at small restoration contracting companies remain the primary users. They create estimates, convert them to invoices, manage customers, prepare documents for signature, and run the specialized tools from a desk environment. Field staff (project managers, technicians) are secondary users: they capture room photos for the packing tool on-site and collect signatures, but the main workflow is office-based.

## Product Purpose

Scopit is a toolkit of work tools for restoration contractors. Each tool stands on its own and serves the job types it belongs to; the results land in Scopit estimates and invoices, which are the shared home base of the product. Success means a company gets each kind of job priced, signed, and invoiced with less re-typing and less friction than juggling separate tools.

Users do three separate kinds of jobs, and tools map to them:
- Interior restoration (water, fire): Packing & Moving Estimator (contents pack-out), Item Recommender, PDF & E-Sign, estimates/invoices
- Roofing: Roof Analyzer, Item Recommender, PDF & E-Sign, estimates/invoices
- Moving and storage only: Packing & Moving Estimator, PDF & E-Sign, estimates/invoices

Pack-out and roof work never belong to the same job; do not present them as one job's workflow.

## Positioning

A set of job-specific tools that feed one estimate. Scopit is not positioned against or alongside any named estimating platform; marketing surfaces do not mention Xactimate or other competitors by name. The value is the connection between tools and the estimate/invoice home base, plus speed and simplicity for small contractors without enterprise overhead.

## Operating Context

- Office-based workflow: estimate creation, line item selection, customer lookup, invoice generation, PDF export
- Estimates contain categorized line items (labor, materials, equipment) with quantities, unit prices, and tax handling
- Estimates convert directly to invoices with payment tracking
- Company-wide line item library shared across users, with private items per creator; Excel import
- Packing & Moving Estimator: room presets or AI photo analysis identify contents; prices packing labor, materials (in catalog sell units), moving (van by workday and weight), and off-site storage (by the unit sizes a facility stocks); PDF and Excel reports; a session can become a Scopit estimate
- Roof Analyzer: reads EagleView roof reports and shows roof faces, slopes, and areas
- Item Recommender: searches line items by work type and groups recommendations into pre-work, main, materials, trim, and post-work
- PDF Editor & E-Sign: annotate and merge PDFs, auto-fill templates from customer and company data, send documents for signature via a public signing link
- Multi-user companies with role-based access

## Capabilities and Constraints

**Confirmed capabilities:**
- Full estimate CRUD with line items, categories, tax calculation, and adjustments
- Estimate-to-invoice conversion with payment schedules and status tracking
- Customer management with contact details
- Company-wide and private line item libraries with AI-powered recommendations
- Packing tool with AI photo analysis (Anthropic Vision, beta), item taxonomy, and PDF/Excel reports; packing session to estimate
- Roof Analyzer (EagleView report upload, faces, slopes, areas)
- Item Recommender (grouped line item recommendations by work type)
- PDF editor with field-mapping templates and e-signature requests
- PDF generation with multiple templates (classic, modern, professional, detailed)
- Dashboard with business metrics and charts
- Daily automated data backups (confirmed by the owner, 2026-10-12)
- JWT authentication with refresh tokens
- Feature gate system (Free/Pro plans, currently bypassed in beta)

**Coming soon (not shipped; may be shown only as "Coming soon"):**
- Priced roof estimate built from Roof Analyzer measurements
- Adding recommended line items from Item Recommender directly to an estimate

**Technical stack:**
- Frontend: React 18 + TypeScript, Vite, Ant Design 5, Zustand, TanStack Query; framer-motion (app), GSAP + @gsap/react (marketing motion)
- Backend: FastAPI (Python), SQLAlchemy 2.0, PostgreSQL 15, Alembic migrations
- AI: Anthropic Claude (vision), sentence-transformers + FAISS (recommendations)
- Deployment: Render (backend) + Vercel (frontend) + Neon (database)

**Undecided:**
- Subscription pricing tiers and feature gate specifics (the beta, free with every tool, runs through December 31, 2026; confirmed 2026-10-12)
- Email notifications (Phase 2, not yet implemented); estimate/invoice "viewed" status is set manually, not tracked automatically
- Stripe payment integration (Phase 2, not yet implemented)
- Whether marketing may name the source of the Item Recommender's line item data

## Brand Commitments

- Name: Scopit
- Typography: Plus Jakarta Sans (headings), Inter (body)
- Color: dark primary #111827 with blue accent #2563eb (frontend/src/styles/theme.ts)
- Name, typography, and color are binding. Layout, composition, and visual motifs on marketing surfaces may be bolder than the in-app minimal aesthetic (confirmed 2026-10-12).
- UI library in the app: Ant Design 5 with custom theme overrides

## Evidence on Hand

- Working application with beta users
- Beta user testimonials exist; exact quotes, names, and attribution rules are not yet supplied and must not be invented (use placeholders until provided)
- Shareable usage numbers exist; exact figures are not yet supplied and must not be invented (use placeholders until provided)
- Daily backups are confirmed and may be stated
- No logo assets beyond the text name

## Product Principles

1. **Tools feed the estimate** — Each tool's output should land in an estimate or invoice without re-typing
2. **Speed over ceremony** — Getting an estimate out the door fast matters more than covering every edge case
3. **Familiar simplicity** — The interface should feel immediately usable without training or onboarding
4. **Professional output** — PDFs, invoices, and reports must look polished and credible to property owners and insurance adjusters
5. **Honest about what ships** — Unreleased capabilities are labelled as coming soon, never implied as available

## Accessibility & Inclusion

No specific accessibility requirements established beyond standard web accessibility practices (WCAG 2.1 AA). The office-based context suggests desktop browser usage with keyboard and mouse as primary input; field staff use phones for photo capture and signing.
