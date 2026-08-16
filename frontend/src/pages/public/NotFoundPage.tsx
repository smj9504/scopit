import React from 'react';
import { Link } from 'react-router-dom';
import { colors, fonts } from '@/styles/theme';
import { Seo } from '@/components/Seo';

/**
 * 404 page for unknown routes. Renders a real "not found" page with a
 * `noindex` tag instead of silently redirecting to "/", which produced a
 * soft-404 (unknown URLs returning the homepage with a 200) that search
 * engines penalize.
 */
const NotFoundPage: React.FC = () => {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: colors.bgLight,
        fontFamily: fonts.body,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px',
      }}
    >
      <Seo
        title="Page Not Found | Scopit"
        description="The page you were looking for could not be found."
        path="/404"
        noindex
      />
      <div
        style={{
          fontFamily: fonts.heading,
          fontSize: 64,
          fontWeight: 800,
          color: colors.textPrimary,
          lineHeight: 1,
        }}
      >
        404
      </div>
      <h1
        style={{
          fontFamily: fonts.heading,
          fontSize: 22,
          fontWeight: 700,
          color: colors.textPrimary,
          margin: '16px 0 8px',
        }}
      >
        Page not found
      </h1>
      <p style={{ fontSize: 15, color: colors.textSecondary, maxWidth: 420, margin: '0 0 24px' }}>
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <Link
        to="/"
        style={{
          display: 'inline-block',
          background: colors.primary,
          color: colors.textWhite,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 15,
          padding: '10px 20px',
          borderRadius: 8,
        }}
      >
        Go to homepage
      </Link>
    </div>
  );
};

export default NotFoundPage;
