/**
 * Scopit - Dashboard Page
 */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Row, Col, Button, Skeleton } from 'antd';
import OnboardingWizard from '@/components/common/OnboardingWizard';
import { PlusOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useRecentToolSessions } from '@/hooks/useTools';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { dashboardService, DashboardData } from '@/services/dashboardService';
import type { ToolSession } from '@/types/tools';
import type { PackingSessionData } from '@/components/features/tools/packing/types';
import { deriveHistoryStatus } from '@/components/features/tools/packing/sessionStatus';
import {
  ORDERED_TOOL_META,
  TOOL_META,
  TOOL_TINT,
  formatRelativeShort,
} from '@/components/features/tools/toolMeta';

const RECENT_TOOL_WORK_COUNT = 5;

// ── Recent tool work helpers ──────────────────────────────────────────────────

interface SessionChip {
  label: string;
  /** Shorter form for mobile rows. */
  shortLabel: string;
  tone: 'accent' | 'neutral';
}

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * Status chip from what the session list actually carries. List responses are
 * summaries (server-side strip_heavy_data): only status, client_info, link
 * fields, room_count and grand_total survive.
 */
function getSessionChip(session: ToolSession): SessionChip {
  const d = session.data;
  const estimateNumber = readString(d.linked_estimate_number);
  if (estimateNumber) {
    return { label: `Estimate ${estimateNumber}`, shortLabel: estimateNumber, tone: 'accent' };
  }
  const invoiceNumber = readString(d.linked_invoice_number);
  if (invoiceNumber) {
    return { label: `Invoice ${invoiceNumber}`, shortLabel: invoiceNumber, tone: 'accent' };
  }
  if (session.toolId === 'packing') {
    const status = deriveHistoryStatus(d as unknown as PackingSessionData);
    const label = status === 'completed' ? 'Completed' : 'Draft';
    return { label, shortLabel: label, tone: 'neutral' };
  }
  if (session.toolId === 'roof_analyzer') {
    // A roof session is an uploaded EagleView report; nothing else to report.
    return { label: 'Report saved', shortLabel: 'Saved', tone: 'neutral' };
  }
  return { label: 'Saved', shortLabel: 'Saved', tone: 'neutral' };
}

function getSessionName(session: ToolSession): string {
  const clientInfo = session.data.client_info as { name?: unknown } | undefined;
  return session.name || readString(clientInfo?.name) || 'Untitled';
}

function getSessionDetail(session: ToolSession): string | undefined {
  if (session.toolId !== 'packing') return undefined;
  const rooms = session.data.room_count;
  if (typeof rooms !== 'number' || rooms <= 0) return undefined;
  return `${rooms} ${rooms === 1 ? 'room' : 'rooms'}`;
}

const sessionTime = (s: ToolSession) => s.updatedAt ?? s.createdAt;

// ── Shared bits ───────────────────────────────────────────────────────────────

const sectionHeadingStyle: React.CSSProperties = {
  fontFamily: fonts.heading,
  fontSize: 15,
  fontWeight: 700,
  color: colors.textPrimary,
  margin: 0,
  letterSpacing: '-0.01em',
};

const viewAllLinkStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.textSecondary,
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 32,
};

const panelStyle: React.CSSProperties = {
  background: colors.bgWhite,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  boxShadow: shadows.card,
  overflow: 'hidden',
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const [showOnboarding, setShowOnboarding] = useState(() =>
    user ? !localStorage.getItem(`onboarding_${user.id}`) : false
  );

  // Fetch dashboard data
  const { data: dashboardData, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: dashboardService.getDashboard,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Over-fetch: the unfiltered list can include internal records (e.g. packing
  // company profiles) that are filtered out below.
  const {
    data: toolSessionsData,
    isLoading: toolSessionsLoading,
    isError: toolSessionsError,
    refetch: refetchToolSessions,
  } = useRecentToolSessions(RECENT_TOOL_WORK_COUNT * 2);

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  const headerPadding = isMobile ? '12px 16px' : '14px 20px';
  const rowPadding = isMobile ? '12px 16px' : '12px 20px';

  // Render function, not a nested component: a component defined in render
  // remounts (and replays its entrance animation) on every re-render.
  const renderStatCard = (title: string, value: number | string, to?: string) => {
    const body = (
      <>
        <span
          style={{
            fontSize: isMobile ? 12 : 13,
            fontWeight: 500,
            color: colors.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: fonts.heading,
            fontSize: isMobile ? 22 : 28,
            fontWeight: 700,
            color: colors.textPrimary,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </span>
      </>
    );
    const style: React.CSSProperties = {
      background: colors.bgWhite,
      borderRadius: 12,
      border: `1px solid ${colors.border}`,
      padding: isMobile ? 14 : 20,
      boxShadow: shadows.card,
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? 6 : 10,
      height: '100%',
      minWidth: 0,
    };
    return (
      <motion.div variants={itemVariants} style={{ height: '100%' }}>
        {to ? (
          <Link to={to} className="app-tile" style={style}>
            {body}
          </Link>
        ) : (
          <div style={style}>{body}</div>
        )}
      </motion.div>
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
      case 'paid':
        return colors.success;
      case 'sent':
      case 'viewed':
        return colors.info;
      case 'overdue':
      case 'declined':
        return colors.error;
      default:
        return colors.textMuted;
    }
  };

  // Loading state — skeleton preserves layout shape
  if (isLoading) {
    const box: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' };
    return (
      <div>
        <Skeleton.Input active style={{ width: 220, height: 28, marginBottom: 8 }} />
        <Skeleton.Input active style={{ width: 300, height: 16, marginBottom: 24 }} />
        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          <Skeleton.Button active style={{ width: 140, height: 40 }} />
          <Skeleton.Button active style={{ width: 120, height: 40 }} />
        </div>
        <Row gutter={[12, 12]} style={{ marginBottom: 28 }}>
          {[1, 2, 3, 4].map((i) => (
            <Col xs={12} lg={6} key={i}>
              <div style={{ ...box, padding: 16 }}>
                <Skeleton active avatar={{ shape: 'square', size: 40 }} title={false} paragraph={{ rows: 2 }} />
              </div>
            </Col>
          ))}
        </Row>
        <Row gutter={[12, 12]} style={{ marginBottom: 28 }}>
          {[1, 2, 3, 4].map((i) => (
            <Col xs={12} lg={6} key={i}>
              <div style={{ ...box, padding: 20 }}>
                <Skeleton active paragraph={{ rows: 1 }} />
              </div>
            </Col>
          ))}
        </Row>
        <div style={{ ...box, padding: 24, marginBottom: 28 }}>
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
        <Row gutter={[12, 12]}>
          {[1, 2].map((i) => (
            <Col xs={24} lg={12} key={i}>
              <div style={{ ...box, padding: 24 }}>
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  // Default values for dashboard data
  const stats = {
    estimatesThisMonth: dashboardData?.estimates_this_month ?? 0,
    invoicesThisMonth: dashboardData?.invoices_this_month ?? 0,
    totalCustomers: dashboardData?.total_customers ?? 0,
    pendingPayments: dashboardData?.pending_payments ?? 0,
    recentEstimates: dashboardData?.recent_estimates ?? [],
    recentInvoices: dashboardData?.recent_invoices ?? [],
  };

  // Only user-facing tools — drops internal records stored as sessions under
  // their own tool id (packing_company_profiles).
  const recentToolWork = (toolSessionsData?.sessions ?? [])
    .filter((s) => TOOL_META[s.toolId])
    .sort((a, b) => new Date(sessionTime(b)).getTime() - new Date(sessionTime(a)).getTime())
    .slice(0, RECENT_TOOL_WORK_COUNT);

  const renderPanelHeader = (id: string, title: string, to: string, linkLabel: string) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: headerPadding,
        borderBottom: `1px solid ${colors.borderLight}`,
      }}
    >
      <h2 id={id} style={sectionHeadingStyle}>
        {title}
      </h2>
      <Link to={to} style={viewAllLinkStyle} aria-label={linkLabel}>
        View all
      </Link>
    </div>
  );

  const renderEmpty = (title: string, hint?: string) => (
    <div style={{ padding: isMobile ? '28px 16px' : '36px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>{title}</div>
      {hint && (
        <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
      )}
    </div>
  );

  const renderToolWork = () => {
    if (toolSessionsLoading) {
      return (
        <div style={{ padding: rowPadding }} aria-busy="true" aria-label="Loading recent tool work">
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              active
              avatar={{ shape: 'square', size: 36 }}
              title={{ width: '45%' }}
              paragraph={{ rows: 1, width: '30%' }}
              style={{ marginBottom: i < 3 ? 12 : 0 }}
            />
          ))}
        </div>
      );
    }
    if (toolSessionsError) {
      return (
        <div style={{ padding: isMobile ? '24px 16px' : '28px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 8 }}>
            Couldn't load recent tool work.
          </div>
          <Button onClick={() => refetchToolSessions()} style={{ minHeight: 40 }}>
            Try again
          </Button>
        </div>
      );
    }
    if (recentToolWork.length === 0) {
      return renderEmpty(
        'No tool work yet',
        'Pack-out estimates and roof reports you save in a tool show up here.',
      );
    }
    return recentToolWork.map((session, idx) => {
      const meta = TOOL_META[session.toolId];
      const chip = getSessionChip(session);
      const detail = getSessionDetail(session);
      const when = formatRelativeShort(sessionTime(session));
      const to = meta.sessionPath ? meta.sessionPath(session.id) : `/app/tools/${session.toolId}`;
      const isLast = idx === recentToolWork.length - 1;

      const iconTile = (
        <span
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 9,
            background: TOOL_TINT.bg,
            color: TOOL_TINT.fg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <meta.Icon size={18} />
        </span>
      );
      const chipEl = (
        <span
          style={{
            justifySelf: 'end',
            padding: isMobile ? '3px 8px' : '3px 10px',
            borderRadius: 9999,
            background: chip.tone === 'accent' ? TOOL_TINT.bg : colors.bgSunken,
            color: chip.tone === 'accent' ? TOOL_TINT.fg : '#374151',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {isMobile ? chip.shortLabel : chip.label}
        </span>
      );
      const nameEl = (
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.textPrimary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {getSessionName(session)}
        </span>
      );

      return (
        <Link
          key={session.id}
          to={to}
          className="app-row-link"
          style={{
            display: isMobile ? 'flex' : 'grid',
            gridTemplateColumns: isMobile ? undefined : '40px minmax(0, 2fr) minmax(0, 1.4fr) auto',
            alignItems: 'center',
            gap: isMobile ? 12 : 14,
            padding: rowPadding,
            borderBottom: isLast ? 'none' : `1px solid ${colors.borderLight}`,
            color: colors.textPrimary,
          }}
        >
          {iconTile}
          {isMobile ? (
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {nameEl}
              <span style={{ fontSize: 12, color: colors.textSecondary }}>
                {meta.shortLabel} · {when}
              </span>
            </span>
          ) : (
            <>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                {nameEl}
                <span style={{ fontSize: 13, color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {meta.navLabel}
                  {detail ? ` · ${detail}` : ''}
                </span>
              </span>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>{when}</span>
            </>
          )}
          {chipEl}
        </Link>
      );
    });
  };

  const renderRecordRows = (
    rows: { id: string; number: string; customer: string | null; total: number; status: string }[],
    basePath: string,
    emptyLabel: string,
  ) =>
    rows.length > 0
      ? rows.map((row, idx) => (
          <Link
            key={row.id}
            to={`${basePath}/${row.id}`}
            className="app-row-link"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: rowPadding,
              borderBottom: idx < rows.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
              gap: 12,
              color: colors.textPrimary,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: colors.textPrimary,
                  marginBottom: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.number}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 12 : 13,
                  color: colors.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.customer || 'No customer'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  fontSize: 14,
                  color: colors.textPrimary,
                  marginBottom: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatCurrency(row.total)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: getStatusColor(row.status),
                  textTransform: 'capitalize',
                }}
              >
                {row.status}
              </div>
            </div>
          </Link>
        ))
      : renderEmpty(emptyLabel);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ maxWidth: 1200 }}
    >
      <OnboardingWizard
        userId={user?.id || ''}
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />
      {/* Header + quick actions */}
      <motion.div
        variants={itemVariants}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: isMobile ? 20 : 16,
          marginBottom: isMobile ? 22 : 28,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontFamily: fonts.heading,
              fontSize: isMobile ? 22 : 26,
              fontWeight: 700,
              color: colors.textPrimary,
              margin: 0,
              marginBottom: 4,
              letterSpacing: '-0.02em',
            }}
          >
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.fullName?.split(' ')[0] || 'there'}
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: isMobile ? 13 : 14, margin: 0 }}>
            {isMobile ? "Here's what's happening today." : "Here's what's happening with your business today."}
          </p>
        </div>
        <div
          style={{
            display: isMobile ? 'grid' : 'flex',
            gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : undefined,
            gap: 10,
            width: isMobile ? '100%' : undefined,
          }}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/app/estimates/new')}
            style={{
              background: colors.primary,
              fontWeight: 600,
              borderRadius: 8,
              height: isMobile ? 44 : 40,
            }}
          >
            New Estimate
          </Button>
          <Button
            icon={<PlusOutlined />}
            onClick={() => navigate('/app/invoices/new')}
            style={{
              fontWeight: 600,
              borderRadius: 8,
              height: isMobile ? 44 : 40,
              borderColor: colors.borderDark,
            }}
          >
            New Invoice
          </Button>
        </div>
      </motion.div>

      {/* Tools launch row */}
      <motion.section
        variants={itemVariants}
        aria-labelledby="dash-tools-heading"
        className="dash-tools"
        style={{ marginBottom: isMobile ? 22 : 28 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: isMobile ? 10 : 12,
          }}
        >
          <h2 id="dash-tools-heading" style={{ ...sectionHeadingStyle, fontSize: 16 }}>
            Tools
          </h2>
          <Link to="/app/tools" style={{ ...viewAllLinkStyle, minHeight: isMobile ? 44 : 32 }}>
            All tools
          </Link>
        </div>
        <div className="dash-tools-grid">
          {ORDERED_TOOL_META.map((meta) => (
            <Link
              key={meta.id}
              to={`/app/tools/${meta.id}`}
              className="app-tile"
              style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'flex-start' : 'center',
                gap: isMobile ? 10 : 14,
                padding: isMobile ? 14 : 16,
                background: colors.bgWhite,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                boxShadow: shadows.card,
                color: colors.textPrimary,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: isMobile ? 36 : 40,
                  height: isMobile ? 36 : 40,
                  flexShrink: 0,
                  borderRadius: isMobile ? 9 : 10,
                  background: TOOL_TINT.bg,
                  color: TOOL_TINT.fg,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <meta.Icon size={isMobile ? 18 : 20} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{meta.navLabel}</span>
                <span style={{ fontSize: 12, color: colors.textSecondary }}>{meta.jobLabel}</span>
              </span>
            </Link>
          ))}
        </div>
      </motion.section>

      {/* Stats */}
      <section aria-label="This month">
        <Row gutter={[isMobile ? 10 : 12, isMobile ? 10 : 12]} style={{ marginBottom: isMobile ? 22 : 28 }}>
          <Col xs={12} sm={12} lg={6}>
            {renderStatCard(isMobile ? 'Estimates' : 'Estimates this month', stats.estimatesThisMonth, '/app/estimates')}
          </Col>
          <Col xs={12} sm={12} lg={6}>
            {renderStatCard(isMobile ? 'Invoices' : 'Invoices this month', stats.invoicesThisMonth, '/app/invoices')}
          </Col>
          <Col xs={12} sm={12} lg={6}>
            {renderStatCard('Customers', stats.totalCustomers, '/app/customers')}
          </Col>
          <Col xs={12} sm={12} lg={6}>
            {renderStatCard(isMobile ? 'Pending' : 'Pending payments', formatCurrency(stats.pendingPayments))}
          </Col>
        </Row>
      </section>

      {/* Recent tool work */}
      <motion.section
        variants={itemVariants}
        aria-labelledby="dash-tool-work-heading"
        style={{ ...panelStyle, marginBottom: 12 }}
      >
        {renderPanelHeader('dash-tool-work-heading', 'Recent tool work', '/app/tools', 'View all tools')}
        {renderToolWork()}
      </motion.section>

      {/* Recent Activity */}
      <Row gutter={[12, 12]}>
        {/* Recent Estimates */}
        <Col xs={24} lg={12}>
          <motion.section variants={itemVariants} aria-labelledby="dash-estimates-heading" style={panelStyle}>
            {renderPanelHeader('dash-estimates-heading', 'Recent Estimates', '/app/estimates', 'View all estimates')}
            {renderRecordRows(
              stats.recentEstimates.map((est) => ({
                id: est.id,
                number: est.estimate_number,
                customer: est.customer_name,
                total: est.total,
                status: est.status,
              })),
              '/app/estimates',
              'No estimates yet',
            )}
          </motion.section>
        </Col>

        {/* Recent Invoices */}
        <Col xs={24} lg={12}>
          <motion.section variants={itemVariants} aria-labelledby="dash-invoices-heading" style={panelStyle}>
            {renderPanelHeader('dash-invoices-heading', 'Recent Invoices', '/app/invoices', 'View all invoices')}
            {renderRecordRows(
              stats.recentInvoices.map((inv) => ({
                id: inv.id,
                number: inv.invoice_number,
                customer: inv.customer_name,
                total: inv.total,
                status: inv.status,
              })),
              '/app/invoices',
              'No invoices yet',
            )}
          </motion.section>
        </Col>
      </Row>
    </motion.div>
  );
};

export default DashboardPage;
