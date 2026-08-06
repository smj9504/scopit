/**
 * Scopit - Dashboard Page
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Button, Empty, Skeleton } from 'antd';
import OnboardingWizard from '@/components/common/OnboardingWizard';
import {
  FileTextOutlined,
  DollarOutlined,
  UserOutlined,
  PlusOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { dashboardService, DashboardData } from '@/services/dashboardService';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const [showOnboarding, setShowOnboarding] = useState(() =>
    user ? !localStorage.getItem(`onboarding_${user.id}`) : false
  );

  // Fetch dashboard data
  const { data: dashboardData, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: dashboardService.getDashboard,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

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

  const StatCard = ({
    icon,
    title,
    value,
    suffix,
    onClick,
    accent,
  }: {
    icon: React.ReactNode;
    title: string;
    value: number | string;
    suffix?: string;
    onClick?: () => void;
    accent?: string;
  }) => (
    <motion.div variants={itemVariants}>
      <div
        onClick={onClick}
        style={{
          background: colors.bgWhite,
          borderRadius: 12,
          border: `1px solid ${colors.border}`,
          padding: isMobile ? '16px' : '20px',
          cursor: onClick ? 'pointer' : 'default',
          boxShadow: shadows.card,
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          if (onClick) {
            e.currentTarget.style.boxShadow = shadows.cardHover;
            e.currentTarget.style.borderColor = colors.borderDark;
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = shadows.card;
          e.currentTarget.style.borderColor = colors.border;
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: accent ? `${accent}10` : colors.bgSunken,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              color: accent || colors.textSecondary,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: colors.textSecondary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{
            fontFamily: fonts.heading,
            fontSize: isMobile ? 24 : 28,
            fontWeight: 700,
            color: colors.textPrimary,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
          {suffix && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: colors.textMuted,
                marginLeft: 4,
              }}
            >
              {suffix}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );

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
    return (
      <div>
        <Skeleton.Input active style={{ width: 220, height: 28, marginBottom: 8 }} />
        <Skeleton.Input active style={{ width: 300, height: 16, marginBottom: 24 }} />
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <Skeleton.Button active style={{ width: 140, height: 36 }} />
          <Skeleton.Button active style={{ width: 120, height: 36 }} />
        </div>
        <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
          {[1, 2, 3, 4].map((i) => (
            <Col xs={24} sm={12} lg={6} key={i}>
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                <Skeleton active paragraph={{ rows: 1 }} />
              </div>
            </Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          {[1, 2].map((i) => (
            <Col xs={24} lg={12} key={i}>
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
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

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <OnboardingWizard
        userId={user?.id || ''}
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />
      {/* Header */}
      <motion.div variants={itemVariants} style={{ marginBottom: isMobile ? 20 : 28 }}>
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
          Here's what's happening with your business today.
        </p>
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={itemVariants} style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/app/estimates/new')}
            style={{
              background: colors.primary,
              fontWeight: 600,
              borderRadius: 8,
              height: 36,
              flex: isMobile ? '1 1 auto' : undefined,
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
              height: 36,
              flex: isMobile ? '1 1 auto' : undefined,
            }}
          >
            New Invoice
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 28 }}>
        <Col xs={12} sm={12} lg={6}>
          <StatCard
            icon={<FileTextOutlined />}
            title="Estimates"
            value={stats.estimatesThisMonth}
            accent={colors.accent}
            onClick={() => navigate('/app/estimates')}
          />
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <StatCard
            icon={<DollarOutlined />}
            title="Invoices"
            value={stats.invoicesThisMonth}
            accent={colors.success}
            onClick={() => navigate('/app/invoices')}
          />
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <StatCard
            icon={<UserOutlined />}
            title="Customers"
            value={stats.totalCustomers}
            accent="#7c3aed"
            onClick={() => navigate('/app/customers')}
          />
        </Col>
        <Col xs={12} sm={12} lg={6}>
          <StatCard
            icon={<ClockCircleOutlined />}
            title="Pending"
            value={formatCurrency(stats.pendingPayments)}
            accent={colors.warning}
          />
        </Col>
      </Row>

      {/* Recent Activity */}
      <Row gutter={[12, 12]}>
        {/* Recent Estimates */}
        <Col xs={24} lg={12}>
          <motion.div variants={itemVariants}>
            <Card
              title={
                <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 15 }}>
                  Recent Estimates
                </span>
              }
              extra={
                <Button
                  type="link"
                  onClick={() => navigate('/app/estimates')}
                  style={{ color: colors.textMuted, padding: 0, fontSize: 13, fontWeight: 500 }}
                >
                  View all <ArrowRightOutlined style={{ fontSize: 10, marginLeft: 4 }} />
                </Button>
              }
              style={{ borderRadius: 12, boxShadow: shadows.card }}
              styles={{ body: { padding: 0 }, header: { borderBottom: `1px solid ${colors.borderLight}`, padding: '14px 20px' } }}
            >
              {stats.recentEstimates.length > 0 ? (
                <div>
                  {stats.recentEstimates.map((est, idx) => (
                    <div
                      key={est.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: isMobile ? '10px 16px' : '12px 20px',
                        borderBottom: idx < stats.recentEstimates.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        gap: 12,
                      }}
                      onClick={() => navigate(`/app/estimates/${est.id}`)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = colors.primarySubtle;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
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
                          {est.estimate_number}
                        </div>
                        <div style={{ fontSize: 13, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {est.customer_name || 'No customer'}
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
                          }}
                        >
                          {formatCurrency(est.total)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: getStatusColor(est.status),
                            textTransform: 'capitalize',
                          }}
                        >
                          {est.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No estimates yet"
                  style={{ padding: 40 }}
                />
              )}
            </Card>
          </motion.div>
        </Col>

        {/* Recent Invoices */}
        <Col xs={24} lg={12}>
          <motion.div variants={itemVariants}>
            <Card
              title={
                <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 15 }}>
                  Recent Invoices
                </span>
              }
              extra={
                <Button
                  type="link"
                  onClick={() => navigate('/app/invoices')}
                  style={{ color: colors.textMuted, padding: 0, fontSize: 13, fontWeight: 500 }}
                >
                  View all <ArrowRightOutlined style={{ fontSize: 10, marginLeft: 4 }} />
                </Button>
              }
              style={{ borderRadius: 12, boxShadow: shadows.card }}
              styles={{ body: { padding: 0 }, header: { borderBottom: `1px solid ${colors.borderLight}`, padding: '14px 20px' } }}
            >
              {stats.recentInvoices.length > 0 ? (
                <div>
                  {stats.recentInvoices.map((inv, idx) => (
                    <div
                      key={inv.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: isMobile ? '10px 16px' : '12px 20px',
                        borderBottom: idx < stats.recentInvoices.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        gap: 12,
                      }}
                      onClick={() => navigate(`/app/invoices/${inv.id}`)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = colors.primarySubtle;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
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
                          {inv.invoice_number}
                        </div>
                        <div style={{ fontSize: 13, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inv.customer_name || 'No customer'}
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
                          }}
                        >
                          {formatCurrency(inv.total)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: getStatusColor(inv.status),
                            textTransform: 'capitalize',
                          }}
                        >
                          {inv.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No invoices yet"
                  style={{ padding: 40 }}
                />
              )}
            </Card>
          </motion.div>
        </Col>
      </Row>
    </motion.div>
  );
};

export default DashboardPage;
