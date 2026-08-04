# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Office and admin staff at small restoration contracting companies. They create estimates, convert them to invoices, manage customers, and track contents/packing jobs from a desk environment. Field technicians may use the packing tool's photo capture on-site, but the primary workflow is office-based.

## Product Purpose

ScopeIt is estimating and invoicing software for restoration contractors. It lets users quickly create detailed estimates with line items, convert estimates to invoices, manage customer records, and run specialized tools like AI-powered contents packing inventories. Success means a restoration company can produce professional estimates and invoices faster and with less friction than legacy industry tools.

## Positioning

An affordable, simple alternative to enterprise restoration estimating platforms like Xactimate and CoreLogic. ScopeIt targets small contractors who need professional output without enterprise complexity or pricing. The value is speed and simplicity — get a clean estimate out the door without training or overhead.

## Operating Context

- Office-based workflow: estimate creation, line item selection, customer lookup, invoice generation, PDF export
- Estimates contain categorized line items (labor, materials, equipment) with quantities, unit prices, and tax handling
- Estimates convert directly to invoices with payment tracking
- Company-wide line item library shared across users, with private items per creator
- Packing tool: AI photo analysis identifies room contents for packout inventories, generates professional reports
- PDF generation for estimates, invoices, and packing reports with multiple template options
- Multi-user companies with role-based access

## Capabilities and Constraints

**Confirmed capabilities:**
- Full estimate CRUD with line items, categories, tax calculation, and adjustments
- Estimate-to-invoice conversion with payment schedules and status tracking
- Customer management with contact details
- Company-wide and private line item libraries with AI-powered recommendations
- Packing tool with AI photo analysis (Anthropic Vision), item taxonomy, and professional PDF reports
- PDF generation with multiple templates (classic, modern, professional, detailed)
- Dashboard with business metrics and charts
- JWT authentication with refresh tokens
- Feature gate system (Free/Pro plans, currently bypassed in beta)
- Drag-and-drop ordering, signature capture

**Technical stack:**
- Frontend: React 18 + TypeScript, Vite, Ant Design 5, Zustand, TanStack Query
- Backend: FastAPI (Python), SQLAlchemy 2.0, PostgreSQL 15, Alembic migrations
- AI: Anthropic Claude (vision), sentence-transformers + FAISS (recommendations)
- Deployment: Render (backend) + Vercel (frontend) + Neon (database)

**Undecided:**
- Subscription pricing tiers and feature gate specifics
- Email notifications (Phase 2, not yet implemented)
- Stripe payment integration (Phase 2, not yet implemented)

## Brand Commitments

- Name: ScopeIt
- Current aesthetic: clean, minimal, monochromatic with dark primary (#111827)
- Typography: Plus Jakarta Sans (headings), Inter (body)
- UI library: Ant Design 5 with custom theme overrides
- The name and current minimal aesthetic are binding constraints

## Evidence on Hand

- Working application with early users testing the product
- No published testimonials, case studies, or marketing materials yet
- No logo assets beyond the text name
- Real usage data from early adopters exists but is not documented for marketing

## Product Principles

1. **Speed over ceremony** — Getting an estimate out the door fast matters more than covering every edge case
2. **Familiar simplicity** — The interface should feel immediately usable without training or onboarding
3. **Professional output** — PDFs, invoices, and reports must look polished and credible to property owners and insurance adjusters
4. **Affordable access** — Small contractors shouldn't need enterprise budgets for professional estimating tools
5. **Smart defaults** — AI and recommendations should reduce manual work, not add complexity

## Accessibility & Inclusion

No specific accessibility requirements established beyond standard web accessibility practices. The office-based context suggests standard desktop browser usage with keyboard and mouse as primary input methods.
