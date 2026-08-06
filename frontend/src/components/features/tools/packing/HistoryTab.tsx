/**
 * ScopeIt - Packing Tool: History Tab
 * Displays saved packing estimate sessions as a sortable, deletable list.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Card,
  Button,
  Popconfirm,
  Spin,
  Empty,
  Tag,
  Typography,
  Space,
  App,
  Grid,
  Pagination,
} from 'antd';
import {
  DeleteOutlined,
  ThunderboltOutlined,
  CameraOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { toolService } from '@/services/toolService';
import type { ToolSession } from '@/types/tools';
import type { PackingSessionData } from './types';
import { getGrandTotal, deriveHistoryStatus } from './sessionStatus';
import { colors, fonts, borderRadius, fontSizes } from '@/styles/theme';

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoryTabProps {
  onLoadEstimate: (session: ToolSession) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function getSessionData(session: ToolSession): PackingSessionData | null {
  return (session.data as unknown as PackingSessionData) ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 10;

export const HistoryTab: React.FC<HistoryTabProps> = ({ onLoadEstimate }) => {
  const { message } = App.useApp();
  const [sessions, setSessions] = useState<ToolSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const fetchSessions = useCallback(async (targetPage: number, targetPageSize: number) => {
    setLoading(true);
    try {
      // Sessions are already ordered newest-first by the backend
      const { sessions: data, total: count } = await toolService.listSessionsPaged({
        toolId: 'packing',
        skip: (targetPage - 1) * targetPageSize,
        limit: targetPageSize,
      });
      setSessions(data);
      setTotal(count);
    } catch {
      // Empty result is not an error — just show empty state
      setSessions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions(page, pageSize);
  }, [fetchSessions, page, pageSize]);

  const handlePageChange = useCallback((nextPage: number, nextPageSize: number) => {
    setPage(nextPage);
    if (nextPageSize !== pageSize) {
      setPageSize(nextPageSize);
    }
  }, [pageSize]);

  const handleDelete = useCallback(
    async (session: ToolSession) => {
      setDeletingId(session.id);
      try {
        await toolService.deleteSession(session.id);
        // Re-fetch the current page so pagination stays consistent with the server
        const isLastItemOnPage = sessions.length === 1 && page > 1;
        await fetchSessions(isLastItemOnPage ? page - 1 : page, pageSize);
        if (isLastItemOnPage) setPage(page - 1);
        message.success('Estimate deleted');
      } catch {
        message.error('Failed to delete estimate');
      } finally {
        setDeletingId(null);
      }
    },
    [sessions.length, page, pageSize, fetchSessions],
  );

  // ── Desktop table columns ────────────────────────────────────────────────

  const columns: ColumnsType<ToolSession> = [
    {
      title: 'Client',
      dataIndex: 'name',
      key: 'client',
      render: (_: unknown, record: ToolSession) => {
        const d = getSessionData(record);
        const clientName = d?.client_info?.name || record.name || 'Unnamed';
        return (
          <div>
            <Text strong style={{ fontSize: fontSizes.sm, color: colors.textPrimary }}>
              {clientName}
            </Text>
            {d?.client_info?.property_address && (
              <div>
                <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
                  {d.client_info.property_address}
                </Text>
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'date',
      width: 120,
      render: (value: string) => (
        <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>
          {formatDate(value)}
        </Text>
      ),
    },
    {
      title: 'Mode',
      key: 'mode',
      width: 120,
      render: (_: unknown, record: ToolSession) => {
        const d = getSessionData(record);
        const mode = d?.mode ?? 'quick';
        return mode === 'content' ? (
          <Tag
            icon={<CameraOutlined />}
            style={{
              borderRadius: borderRadius.full,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              background: '#eff6ff',
              borderColor: '#bfdbfe',
              color: '#2563eb',
            }}
          >
            Photo AI
          </Tag>
        ) : (
          <Tag
            icon={<ThunderboltOutlined />}
            style={{
              borderRadius: borderRadius.full,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              background: '#f0fdf4',
              borderColor: '#bbf7d0',
              color: '#16a34a',
            }}
          >
            Quick
          </Tag>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, record: ToolSession) => {
        const d = getSessionData(record);
        const status = deriveHistoryStatus(d);
        return status === 'completed' ? (
          <Tag
            style={{
              borderRadius: borderRadius.full,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              background: '#f0fdf4',
              borderColor: '#bbf7d0',
              color: '#16a34a',
              margin: 0,
            }}
          >
            Completed
          </Tag>
        ) : (
          <Tag
            style={{
              borderRadius: borderRadius.full,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              background: colors.bgLight,
              borderColor: colors.border,
              color: colors.textMuted,
              margin: 0,
            }}
          >
            Draft
          </Tag>
        );
      },
    },
    {
      title: 'Total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, record: ToolSession) => {
        const d = getSessionData(record);
        const total = getGrandTotal(d);
        return (
          <Text
            strong
            style={{
              fontSize: fontSizes.sm,
              color: total !== undefined ? colors.textPrimary : colors.textMuted,
              fontFamily: fonts.body,
            }}
          >
            {formatCurrency(total)}
          </Text>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      align: 'center' as const,
      render: (_: unknown, record: ToolSession) => (
        <Popconfirm
          title="Delete this estimate?"
          description="This action cannot be undone."
          onConfirm={(e) => { e?.stopPropagation(); handleDelete(record); }}
          onCancel={(e) => e?.stopPropagation()}
          okText="Delete"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            danger
            loading={deletingId === record.id}
            onClick={(e) => e.stopPropagation()}
            style={{
              borderRadius: borderRadius.base,
              fontSize: fontSizes.xs,
            }}
          />
        </Popconfirm>
      ),
    },
  ];

  // ── Mobile card list ─────────────────────────────────────────────────────

  const MobileCard: React.FC<{ session: ToolSession }> = ({ session }) => {
    const d = getSessionData(session);
    const clientName = d?.client_info?.name || session.name || 'Unnamed';
    const mode = d?.mode ?? 'quick';
    const total = getGrandTotal(d);
    const status = deriveHistoryStatus(d);

    return (
      <Card
        size="small"
        hoverable
        onClick={() => onLoadEstimate(session)}
        style={{
          marginBottom: 12,
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          cursor: 'pointer',
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text
              strong
              style={{
                fontSize: fontSizes.base,
                color: colors.textPrimary,
                display: 'block',
                marginBottom: 2,
              }}
            >
              {clientName}
            </Text>
            {d?.client_info?.property_address && (
              <Text
                style={{
                  fontSize: fontSizes.xs,
                  color: colors.textSecondary,
                  display: 'block',
                  marginBottom: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.client_info.property_address}
              </Text>
            )}
            <Space size={6} wrap>
              {mode === 'content' ? (
                <Tag
                  icon={<CameraOutlined />}
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: fontSizes.xs,
                    background: '#eff6ff',
                    borderColor: '#bfdbfe',
                    color: '#2563eb',
                    margin: 0,
                  }}
                >
                  Photo AI
                </Tag>
              ) : (
                <Tag
                  icon={<ThunderboltOutlined />}
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: fontSizes.xs,
                    background: '#f0fdf4',
                    borderColor: '#bbf7d0',
                    color: '#16a34a',
                    margin: 0,
                  }}
                >
                  Quick
                </Tag>
              )}
              {status === 'draft' && (
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: fontSizes.xs,
                    background: colors.bgLight,
                    borderColor: colors.border,
                    color: colors.textMuted,
                    margin: 0,
                  }}
                >
                  Draft
                </Tag>
              )}
              <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
                {formatDate(session.createdAt)}
              </Text>
            </Space>
          </div>
          <div style={{ textAlign: 'right', marginLeft: 12 }}>
            <Text
              strong
              style={{
                fontSize: fontSizes.md,
                color: total !== undefined ? colors.textPrimary : colors.textMuted,
                display: 'block',
                marginBottom: 8,
                fontFamily: fonts.body,
              }}
            >
              {formatCurrency(total)}
            </Text>
            <Popconfirm
              title="Delete this estimate?"
              description="This action cannot be undone."
              onConfirm={(e) => { e?.stopPropagation(); handleDelete(session); }}
              onCancel={(e) => e?.stopPropagation()}
              okText="Delete"
              cancelText="Cancel"
              okButtonProps={{ danger: true }}
            >
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                danger
                loading={deletingId === session.id}
                onClick={(e) => e.stopPropagation()}
                style={{ borderRadius: borderRadius.base }}
              />
            </Popconfirm>
          </div>
        </div>
      </Card>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 16 }}>
      {/* Content */}
      {loading ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 240,
          }}
        >
          <Spin size="large" />
        </div>
      ) : sessions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div style={{ textAlign: 'center' }}>
              <Text
                style={{
                  fontSize: fontSizes.base,
                  color: colors.textSecondary,
                  fontFamily: fonts.body,
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                No saved estimates yet
              </Text>
              <Text style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>
                Run a Quick or Photo AI estimate to save it here automatically.
              </Text>
            </div>
          }
          style={{ marginTop: 48 }}
        />
      ) : isMobile ? (
        <div>
          {sessions.map((session) => (
            <MobileCard key={session.id} session={session} />
          ))}
          {total > pageSize && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                size="small"
                showSizeChanger={false}
                onChange={handlePageChange}
              />
            </div>
          )}
        </div>
      ) : (
        <Table<ToolSession>
          dataSource={sessions}
          columns={columns}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            size: 'small',
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            onChange: handlePageChange,
          }}
          size="middle"
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            overflow: 'hidden',
          }}
          onRow={(record) => ({
            onClick: () => onLoadEstimate(record),
            style: { cursor: 'pointer' },
          })}
        />
      )}
    </div>
  );
};
