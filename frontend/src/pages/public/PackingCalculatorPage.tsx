/**
 * Scopit - Packing Calculator (SEO content page)
 * Route: /packing-calculator  (public, indexable)
 *
 * A content-rich marketing page targeting the searches restoration pros use to
 * find a tool like Scopit: "packing calculator", "pack-in / pack-out estimate",
 * "insurance packing estimate breakdown", and "packing report". Every claim
 * here maps to a real Scopit feature (photo AI, pack-out/pack-back math,
 * itemized insurance-style breakdown, and PDF/Excel/Report export), so the copy
 * and the structured data stay honest. CTAs route to the live demo and the free
 * estimate form.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from 'antd';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Seo } from '@/components/Seo';

const CONTACT_EMAIL = 'hello@scopit.work';
const ORIGIN = 'https://www.scopit.work';

const TITLE = 'Packing Calculator & Pack-Out Estimate | Scopit';
const DESCRIPTION =
  "Scopit's packing calculator builds itemized pack-out and pack-back estimates from room photos — insurance-ready breakdowns and a shareable packing report.";

interface Feature {
  h: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    h: 'A photo-based packing calculator',
    body:
      'Snap a few photos of each room and Scopit’s AI identifies the contents, then calculates the packing estimate for you — box counts, material, and crew labor hours. No spreadsheets, no guessing cube counts by hand. It’s the fastest way to turn a walkthrough into a defensible number.',
  },
  {
    h: 'Pack-in and pack-out estimates',
    body:
      'Restoration jobs need both directions: the pack-out (contents boxed, inventoried, and moved to storage) and the pack-back / pack-in (returned and unpacked once the structure is dry). Scopit prices pack-out and pack-back together, with storage months, crew size, and staging all adjustable, so your pack-in pack-out estimate reflects the real scope.',
  },
  {
    h: 'An insurance-ready packing estimate breakdown',
    body:
      'Adjusters want line items, not a lump sum. Scopit produces an itemized insurance packing estimate breakdown — labor hours, materials, storage, and overhead & profit split out per room and per item — so the estimate reads clearly against the claim and holds up in review.',
  },
  {
    h: 'A professional packing report',
    body:
      'Export a clean packing report as a PDF or Excel file to send to the client, the carrier, or your crew. The report carries your company branding, the room-by-room inventory, and the full cost breakdown — a document you can hand over without reformatting anything.',
  },
];

const STEPS: { n: number; h: string; body: string }[] = [
  {
    n: 1,
    h: 'Photograph each room',
    body: 'Upload room photos — the AI detects the contents and their volume automatically.',
  },
  {
    n: 2,
    h: 'Review the auto-built estimate',
    body: 'Scopit calculates pack-out and pack-back labor, materials, and storage. Adjust anything.',
  },
  {
    n: 3,
    h: 'Export your packing report',
    body: 'Download a branded PDF/Excel packing report with the full insurance-ready breakdown.',
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is a packing calculator?',
    a: 'A packing calculator estimates what it costs to pack a property — box counts, packing materials, and crew labor hours. Scopit does this from room photos, so instead of counting boxes by hand you get an itemized estimate in minutes.',
  },
  {
    q: 'Does Scopit handle both pack-out and pack-back?',
    a: 'Yes. Scopit estimates the pack-out (packing and moving contents to storage) and the pack-back / pack-in (returning and unpacking) in one place, with adjustable storage months, crew size, and staging.',
  },
  {
    q: 'Can I produce an insurance packing estimate breakdown?',
    a: 'Yes. Every estimate is itemized — labor, materials, storage, and overhead & profit are broken out per room and per item — so it reads clearly against an insurance claim rather than as a single lump sum.',
  },
  {
    q: 'What’s included in the packing report?',
    a: 'The packing report is a branded PDF or Excel export with the room-by-room inventory and the full cost breakdown, ready to send to a client, adjuster, or crew.',
  },
  {
    q: 'Is it free?',
    a: 'Scopit is free during the beta. You can try the live demo with no signup, or get a free itemized packing estimate from your own photos.',
  },
];

const PackingCalculatorPage: React.FC = () => {
  const isMobile = useIsMobile();

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Packing Calculator', item: `${ORIGIN}/packing-calculator` },
    ],
  };

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const sectionMaxWidth = 820;
  const h2Style: React.CSSProperties = {
    fontFamily: fonts.heading,
    fontSize: isMobile ? 22 : 26,
    fontWeight: 700,
    color: colors.textPrimary,
    margin: '0 0 12px',
  };
  const bodyStyle: React.CSSProperties = {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 1.7,
    color: colors.textSecondary,
    margin: 0,
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgLight, fontFamily: fonts.body }}>
      <Seo title={TITLE} description={DESCRIPTION} path="/packing-calculator" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
      </Helmet>

      {/* Header */}
      <header
        style={{
          padding: '20px 24px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Link to="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.primary }}>
            Scopit
          </span>
        </Link>
      </header>

      <main>
        {/* Hero */}
        <section
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            padding: isMobile ? '48px 20px 24px' : '72px 24px 32px',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontFamily: fonts.body,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: colors.textMuted,
              margin: '0 0 12px',
            }}
          >
            For restoration &amp; moving pros
          </p>
          <h1
            style={{
              fontFamily: fonts.heading,
              fontSize: isMobile ? 30 : 44,
              fontWeight: 800,
              lineHeight: 1.15,
              color: colors.textPrimary,
              margin: '0 0 16px',
            }}
          >
            The packing calculator that turns room photos into a pack-out estimate
          </h1>
          <p
            style={{
              fontFamily: fonts.body,
              fontSize: isMobile ? 16 : 18,
              lineHeight: 1.6,
              color: colors.textSecondary,
              margin: '0 auto 28px',
              maxWidth: 620,
            }}
          >
            Photograph each room and Scopit builds an itemized pack-in / pack-out estimate — an
            insurance-ready breakdown of labor, materials, and storage — then exports it as a
            professional packing report.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link to="/demo/packing">
              <Button type="primary" size="large" style={{ fontWeight: 600, background: colors.primary }}>
                Try the live demo
              </Button>
            </Link>
            <Link to="/packing-estimate">
              <Button size="large" style={{ fontWeight: 600 }}>
                Get a free packing estimate
              </Button>
            </Link>
          </div>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: '16px 0 0' }}>
            Free during beta — no signup required to try the demo.
          </p>
        </section>

        {/* Feature sections */}
        <section
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            padding: isMobile ? '16px 20px' : '24px',
          }}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            {FEATURES.map((f) => (
              <article
                key={f.h}
                style={{
                  background: colors.bgWhite,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.lg,
                  padding: isMobile ? 24 : 32,
                }}
              >
                <h2 style={h2Style}>{f.h}</h2>
                <p style={bodyStyle}>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            padding: isMobile ? '32px 20px' : '48px 24px',
          }}
        >
          <h2 style={{ ...h2Style, textAlign: 'center', marginBottom: 28 }}>
            How the packing calculator works
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: 16,
            }}
          >
            {STEPS.map((s) => (
              <div
                key={s.n}
                style={{
                  background: colors.bgWhite,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.lg,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: borderRadius.full,
                    background: colors.primary,
                    color: colors.textWhite,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: fonts.heading,
                    fontWeight: 700,
                    fontSize: 15,
                    marginBottom: 14,
                  }}
                >
                  {s.n}
                </div>
                <h3 style={{ fontFamily: fonts.heading, fontSize: 17, fontWeight: 700, color: colors.textPrimary, margin: '0 0 6px' }}>
                  {s.h}
                </h3>
                <p style={{ ...bodyStyle, fontSize: 15 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            padding: isMobile ? '16px 20px 40px' : '24px 24px 64px',
          }}
        >
          <h2 style={{ ...h2Style, textAlign: 'center', marginBottom: 24 }}>
            Packing calculator FAQ
          </h2>
          <div
            style={{
              background: colors.bgWhite,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: isMobile ? 8 : 16,
            }}
          >
            {FAQS.map((f, i) => (
              <div
                key={f.q}
                style={{
                  padding: isMobile ? '16px 12px' : '20px 16px',
                  borderBottom: i < FAQS.length - 1 ? `1px solid ${colors.border}` : 'none',
                }}
              >
                <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 700, color: colors.textPrimary, margin: '0 0 8px' }}>
                  {f.q}
                </h3>
                <p style={{ ...bodyStyle, fontSize: 15 }}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            padding: isMobile ? '0 20px 56px' : '0 24px 80px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              background: colors.primary,
              borderRadius: borderRadius.lg,
              padding: isMobile ? 28 : 40,
            }}
          >
            <h2 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 22 : 26, fontWeight: 700, color: colors.textWhite, margin: '0 0 10px' }}>
              Build your first packing estimate free
            </h2>
            <p style={{ fontFamily: fonts.body, fontSize: 15, color: '#d1d5db', margin: '0 auto 24px', maxWidth: 520, lineHeight: 1.6 }}>
              Try the live demo with sample rooms, or upload your own photos for a free,
              itemized packing estimate with a full insurance-ready breakdown.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/demo/packing">
                <Button size="large" style={{ fontWeight: 600, background: colors.bgWhite, borderColor: colors.bgWhite }}>
                  Try the live demo
                </Button>
              </Link>
              <Link to="/packing-estimate">
                <Button size="large" ghost style={{ fontWeight: 600, color: colors.textWhite, borderColor: '#4b5563' }}>
                  Get a free estimate
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          padding: '28px 24px',
        }}
      >
        <div
          style={{
            maxWidth: sectionMaxWidth,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontFamily: fonts.heading, fontWeight: 700, color: colors.primary }}>Scopit</span>
          <nav style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
            <Link to="/" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Home</Link>
            <Link to="/demo/packing" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Packing demo</Link>
            <Link to="/packing-estimate" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Free estimate</Link>
            <Link to="/privacy" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Privacy</Link>
            <Link to="/terms" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Terms</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: colors.textSecondary, textDecoration: 'none' }}>Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default PackingCalculatorPage;
