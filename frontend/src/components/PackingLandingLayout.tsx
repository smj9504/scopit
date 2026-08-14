/**
 * Scopit - Packing SEO landing layout
 *
 * Shared presentation for the packing topic-cluster pages (a hub at
 * /packing-calculator plus keyword-specific spokes). Each page supplies its own
 * copy as data so the pages stay genuinely distinct (not duplicate/doorway
 * content) while sharing one validated layout, header/footer, CTAs, and the
 * BreadcrumbList + FAQPage structured data. Every claim in the supplied copy
 * must map to a real Scopit feature — the layout doesn't invent any.
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
const SECTION_MAX_WIDTH = 820;

export interface LandingSection {
  h: string;
  body: string;
}

export interface LandingStep {
  n: number;
  h: string;
  body: string;
}

export interface LandingFaq {
  q: string;
  a: string;
}

export interface RelatedLink {
  label: string;
  to: string;
}

export interface PackingLandingLayoutProps {
  /** Canonical route path, e.g. "/packing-report". */
  path: string;
  /** <title> and social title. */
  title: string;
  /** Meta description (~155 chars). */
  description: string;
  /** Name used in the BreadcrumbList (Home > breadcrumbName). */
  breadcrumbName: string;
  eyebrow: string;
  h1: string;
  subhead: string;
  sections: LandingSection[];
  steps?: LandingStep[];
  stepsHeading?: string;
  faqHeading: string;
  faqs: LandingFaq[];
  bottomCtaHeading: string;
  bottomCtaBody: string;
  /** Sibling/hub links for internal linking within the cluster. */
  related?: RelatedLink[];
}

const PackingLandingLayout: React.FC<PackingLandingLayoutProps> = ({
  path,
  title,
  description,
  breadcrumbName,
  eyebrow,
  h1,
  subhead,
  sections,
  steps,
  stepsHeading,
  faqHeading,
  faqs,
  bottomCtaHeading,
  bottomCtaBody,
  related,
}) => {
  const isMobile = useIsMobile();

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: breadcrumbName, item: `${ORIGIN}${path}` },
    ],
  };

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

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
      <Seo title={title} description={description} path={path} />
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
            maxWidth: SECTION_MAX_WIDTH,
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
            {eyebrow}
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
            {h1}
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
            {subhead}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
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
          style={{ maxWidth: SECTION_MAX_WIDTH, margin: '0 auto', padding: isMobile ? '16px 20px' : '24px' }}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            {sections.map((s) => (
              <article
                key={s.h}
                style={{
                  background: colors.bgWhite,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.lg,
                  padding: isMobile ? 24 : 32,
                }}
              >
                <h2 style={h2Style}>{s.h}</h2>
                <p style={bodyStyle}>{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works (optional) */}
        {steps && steps.length > 0 && (
          <section
            style={{ maxWidth: SECTION_MAX_WIDTH, margin: '0 auto', padding: isMobile ? '32px 20px' : '48px 24px' }}
          >
            <h2 style={{ ...h2Style, textAlign: 'center', marginBottom: 28 }}>
              {stepsHeading || 'How it works'}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : `repeat(${steps.length}, 1fr)`,
                gap: 16,
              }}
            >
              {steps.map((s) => (
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
        )}

        {/* FAQ */}
        <section
          style={{ maxWidth: SECTION_MAX_WIDTH, margin: '0 auto', padding: isMobile ? '16px 20px 40px' : '24px 24px 48px' }}
        >
          <h2 style={{ ...h2Style, textAlign: 'center', marginBottom: 24 }}>{faqHeading}</h2>
          <div
            style={{
              background: colors.bgWhite,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: isMobile ? 8 : 16,
            }}
          >
            {faqs.map((f, i) => (
              <div
                key={f.q}
                style={{
                  padding: isMobile ? '16px 12px' : '20px 16px',
                  borderBottom: i < faqs.length - 1 ? `1px solid ${colors.border}` : 'none',
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

        {/* Related pages (internal linking within the cluster) */}
        {related && related.length > 0 && (
          <section
            style={{ maxWidth: SECTION_MAX_WIDTH, margin: '0 auto', padding: isMobile ? '0 20px 32px' : '0 24px 40px', textAlign: 'center' }}
          >
            <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textMuted, margin: '0 0 12px' }}>
              Related
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {related.map((r) => (
                <Link
                  key={r.to}
                  to={r.to}
                  style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.full,
                    background: colors.bgWhite,
                    color: colors.textPrimary,
                    textDecoration: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Bottom CTA */}
        <section
          style={{
            maxWidth: SECTION_MAX_WIDTH,
            margin: '0 auto',
            padding: isMobile ? '0 20px 56px' : '0 24px 80px',
            textAlign: 'center',
          }}
        >
          <div style={{ background: colors.primary, borderRadius: borderRadius.lg, padding: isMobile ? 28 : 40 }}>
            <h2 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 22 : 26, fontWeight: 700, color: colors.textWhite, margin: '0 0 10px' }}>
              {bottomCtaHeading}
            </h2>
            <p style={{ fontFamily: fonts.body, fontSize: 15, color: '#d1d5db', margin: '0 auto 24px', maxWidth: 520, lineHeight: 1.6 }}>
              {bottomCtaBody}
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
      <footer style={{ borderTop: `1px solid ${colors.border}`, background: colors.bgWhite, padding: '28px 24px' }}>
        <div
          style={{
            maxWidth: SECTION_MAX_WIDTH,
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
            <Link to="/packing-calculator" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Packing calculator</Link>
            <Link to="/demo/packing" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Packing demo</Link>
            <Link to="/packing-estimate" style={{ color: colors.textSecondary, textDecoration: 'none' }}>Free estimate</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: colors.textSecondary, textDecoration: 'none' }}>Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default PackingLandingLayout;
