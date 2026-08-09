/**
 * Scopit - Packing Lead Result Page
 * Route: /packing-estimate/result/:token (no authentication required)
 *
 * Polls background AI analysis status. Once ready, shows a pricing-free
 * teaser plus a "Free during beta" register/login CTA. If the visitor is
 * already authenticated (e.g. reopening a previous link), skips straight to
 * claiming the lead into a real tool session.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, App } from 'antd';
import axios from 'axios';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePageSEO } from '@/hooks/usePageSEO';
import { useAuthStore } from '@/stores/authStore';
import { usePendingActionStore } from '@/stores/pendingActionStore';
import { packingLeadService } from '@/services/packingLeadService';
import { getErrorMessage } from '@/services/api';
import type { PackingLeadStatusResponse } from '@/types/packingLead';

const CONTACT_EMAIL = 'hello@scopit.work';
const POLL_INTERVAL_MS = 3500;

const PENDING_STATUSES = new Set(['pending_verification', 'analyzing']);

const ContactFooter: React.FC = () => (
  <p style={{ textAlign: 'center', marginTop: 32, color: colors.textSecondary, fontSize: 14 }}>
    Need another one?{' '}
    <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: colors.textPrimary, fontWeight: 600 }}>
      Get in touch
    </a>
  </p>
);

const PageShell: React.FC<{ children: React.ReactNode; isMobile: boolean }> = ({ children, isMobile }) => (
  <div style={{ minHeight: '100vh', background: colors.bgLight, fontFamily: fonts.body }}>
    <header
      style={{
        padding: '20px 24px',
        background: colors.bgWhite,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <span style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.primary }}>
        Scopit
      </span>
    </header>
    <main style={{ maxWidth: 560, margin: '0 auto', padding: isMobile ? '32px 16px 64px' : '64px 24px 80px' }}>
      <div
        style={{
          background: colors.bgWhite,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: isMobile ? 24 : 40,
          textAlign: 'center',
        }}
      >
        {children}
      </div>
      <ContactFooter />
    </main>
  </div>
);

const PackingLeadResultPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setPendingAction = usePendingActionStore((s) => s.setPendingAction);

  usePageSEO({
    title: 'Your Packing Estimate | Scopit',
    description: 'View the status of your free AI-powered packing estimate.',
    path: '/packing-estimate/result',
  });

  const [autoClaiming, setAutoClaiming] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Edge case: an already-registered visitor opens this link directly.
  // Skip the teaser/CTA entirely and drop them into the real session.
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    setAutoClaiming(true);
    packingLeadService
      .claim(token)
      .then(({ tool_session_id }) => {
        navigate(`/app/tools/packing?sessionId=${tool_session_id}`);
      })
      .catch((error) => {
        message.error(getErrorMessage(error));
        navigate('/app/dashboard');
      });
  }, [token, isAuthenticated, navigate, message]);

  const query = useQuery<PackingLeadStatusResponse>({
    queryKey: ['packing-lead-status', token],
    queryFn: () => packingLeadService.getStatus(token as string),
    enabled: !!token && !isAuthenticated,
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return POLL_INTERVAL_MS;
      return PENDING_STATUSES.has(data.status) ? POLL_INTERVAL_MS : false;
    },
  });

  const handleRetry = async () => {
    if (!token) return;
    setRetrying(true);
    try {
      await packingLeadService.retry(token);
      await query.refetch();
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setRetrying(false);
    }
  };

  const goToAuth = (destination: '/register' | '/login') => {
    if (!token) return;
    setPendingAction({
      type: 'packing-claim',
      token,
      returnPath: `/packing-estimate/result/${token}`,
    });
    navigate(destination);
  };

  if (isAuthenticated || autoClaiming) {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          Loading your estimate…
        </h1>
      </PageShell>
    );
  }

  // 404 / unknown or expired token
  const is404 = axios.isAxiosError(query.error) && query.error.response?.status === 404;
  if (query.isError && is404) {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 8 }}>
          This estimate has expired or wasn't found
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 24 }}>
          The link may be too old, or already used. Start a new one below.
        </p>
        <Link to="/packing-estimate">
          <Button type="primary" style={{ background: colors.primary }}>
            Start a new estimate
          </Button>
        </Link>
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>{getErrorMessage(query.error)}</p>
      </PageShell>
    );
  }

  if (!query.data) {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          Loading…
        </h1>
      </PageShell>
    );
  }

  const data = query.data;

  if (data.status === 'pending_verification' || data.status === 'analyzing') {
    const label = data.status === 'pending_verification' ? 'Getting ready' : 'Analyzing your rooms';
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 8 }}>
          {label}…
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>
          This usually takes a few minutes. Feel free to leave this tab open — we'll have your estimate ready shortly.
        </p>
      </PageShell>
    );
  }

  if (data.status === 'failed') {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 8 }}>
          We couldn't finish your estimate
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 24 }}>
          {data.error_message || 'Something went wrong during analysis.'}
        </p>
        {data.can_retry ? (
          <Button
            type="primary"
            loading={retrying}
            onClick={handleRetry}
            style={{ background: colors.primary }}
          >
            Retry analysis
          </Button>
        ) : (
          <p style={{ color: colors.textSecondary, fontSize: 14 }}>
            Get in touch below and we'll help you out.
          </p>
        )}
      </PageShell>
    );
  }

  if (data.status !== 'ready') {
    // Exhaustive per PackingLeadStatusResponse — unreachable given the checks
    // above, but narrows `data` to PackingLeadStatusReady for TS below (an
    // equality check against a single-literal member narrows reliably,
    // whereas eliminating a multi-literal member field by exclusion alone
    // does not).
    return null;
  }

  if (data.already_claimed) {
    return (
      <PageShell isMobile={isMobile}>
        <h1 style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 8 }}>
          This estimate has already been claimed
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 24 }}>
          Log in to the account that claimed it to view the full estimate.
        </p>
        <Button type="primary" onClick={() => goToAuth('/login')} style={{ background: colors.primary }}>
          Log in
        </Button>
      </PageShell>
    );
  }

  return (
    <PageShell isMobile={isMobile}>
      <h1 style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0, marginBottom: 4 }}>
        Your estimate is ready!
      </h1>
      <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 24 }}>
        Here's a quick look — create a free account to see the full breakdown and pricing.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 28,
        }}
      >
        {[
          { label: 'Rooms', value: data.teaser.room_count },
          { label: 'Items found', value: data.teaser.item_count },
          { label: 'Size', value: data.teaser.size_category },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: colors.bgSunken,
              borderRadius: borderRadius.md,
              padding: '16px 8px',
            }}
          >
            <div style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.textPrimary }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <Button
        type="primary"
        size="large"
        block
        onClick={() => goToAuth('/register')}
        style={{ fontWeight: 600, background: colors.primary, marginBottom: 12 }}
      >
        Free during beta — first estimate on us. Create your account to view it.
      </Button>
      <Button type="link" onClick={() => goToAuth('/login')} style={{ color: colors.textSecondary }}>
        Already have an account? Log in
      </Button>
    </PageShell>
  );
};

export default PackingLeadResultPage;
