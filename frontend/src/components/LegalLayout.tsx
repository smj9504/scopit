import React from 'react';
import { colors, fonts } from '@/styles/theme';

/**
 * Shared layout for public legal pages (Privacy Policy, Terms of Service).
 * A simple, readable single-column document with a minimal header/footer.
 */
interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

const LegalLayout: React.FC<LegalLayoutProps> = ({ title, lastUpdated, children }) => {
  return (
    <div style={{ minHeight: '100vh', background: colors.bgLight, fontFamily: fonts.body }}>
      <style>{`
        .legal-prose h2 {
          font-family: ${fonts.heading};
          font-size: 20px;
          font-weight: 700;
          color: ${colors.textPrimary};
          margin: 36px 0 12px;
        }
        .legal-prose h3 {
          font-size: 16px;
          font-weight: 600;
          color: ${colors.textPrimary};
          margin: 24px 0 8px;
        }
        .legal-prose p, .legal-prose li {
          font-size: 15px;
          line-height: 1.7;
          color: ${colors.textSecondary};
        }
        .legal-prose p { margin: 0 0 14px; }
        .legal-prose ul { margin: 0 0 14px; padding-left: 22px; }
        .legal-prose li { margin: 0 0 6px; }
        .legal-prose a { color: ${colors.accent}; }
        .legal-prose strong { color: ${colors.textPrimary}; }
      `}</style>

      {/* Header */}
      <header
        style={{
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
          padding: '16px 20px',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <a href="/" style={{ textDecoration: 'none' }}>
            <span
              className="headline"
              style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary }}
            >
              Scopit
            </span>
          </a>
        </div>
      </header>

      {/* Document */}
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px 64px' }}>
        <h1
          style={{
            fontFamily: fonts.heading,
            fontSize: 32,
            fontWeight: 800,
            color: colors.textPrimary,
            margin: '0 0 8px',
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 14, color: colors.textMuted, margin: '0 0 32px' }}>
          Last updated: {lastUpdated}
        </p>

        <div className="legal-prose">{children}</div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          padding: '24px 20px',
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 14,
            color: colors.textMuted,
          }}
        >
          <span>© 2026 Scopit. All rights reserved.</span>
          <span style={{ display: 'flex', gap: 20 }}>
            <a href="/privacy" style={{ color: colors.textSecondary, textDecoration: 'none' }}>
              Privacy
            </a>
            <a href="/terms" style={{ color: colors.textSecondary, textDecoration: 'none' }}>
              Terms
            </a>
            <a href="mailto:hello@scopit.work" style={{ color: colors.textSecondary, textDecoration: 'none' }}>
              hello@scopit.work
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default LegalLayout;
