/**
 * Scopit - Estimates List Page
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Input,
  Select,
  Tag,
  Card,
  Dropdown,
  message,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  FileTextOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { estimateService } from '@/services/estimateService';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { useEstimateStatuses, getStatusDisplay } from '@/hooks/useSettings';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ImportExcelModal } from '@/components/common/ImportExcelModal';
import { ColumnVisibilityControl } from '@/components/common/ColumnVisibilityControl';
import type { Estimate, EstimateStatus, ExcelParsedSection } from '@/types/entities';
import type { ColumnsType } from 'antd/es/table';

const HIDDEN_COLUMNS_KEY = 'estimates_hidden_columns';
const COLUMN_OPTIONS = [
  { key: 'customerName', label: 'Customer' },
  { key: 'address', label: 'Address' },
  { key: 'title', label: 'Title' },
  { key: 'estimateDate', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total' },
];

const formatAddress = (record: Estimate) => {
  const line1 = record.customerAddressLine1;
  const cityState = [record.customerCity, [record.customerState, record.customerZipcode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [line1, cityState].filter(Boolean).join(', ');
};

const EstimatesListPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const isMobile = useIsMobile();

  const handleHiddenColumnsChange = (keys: string[]) => {
    setHiddenColumns(keys);
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(keys));
  };

  // Fetch estimate statuses
  const { data: statusConfigs } = useEstimateStatuses();

  // Import from Excel mutation
  const importMutation = useMutation({
    mutationFn: (sections: ExcelParsedSection[]) =>
      estimateService.create({ sections } as any),
    onSuccess: (estimate) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      message.success('Estimate imported successfully');
      setImportModalOpen(false);
      navigate(`/app/estimates/${estimate.id}/edit`);
    },
    onError: () => {
      message.error('Failed to create estimate from import');
    },
  });

  // Fetch estimates
  const { data, isLoading } = useQuery({
    queryKey: ['estimates', { search, status: statusFilter }],
    queryFn: () =>
      estimateService.getList({
        search: search || undefined,
        status: statusFilter,
        limit: 100,
      }),
  });

  const allColumns: ColumnsType<Estimate> = [
    {
      title: 'Number',
      dataIndex: 'estimateNumber',
      key: 'estimateNumber',
      width: 110,
      render: (text, record) => (
        <span
          style={{ fontWeight: 600, fontSize: 14, color: colors.textPrimary, cursor: 'pointer' }}
          onClick={() => navigate(`/app/estimates/${record.id}`)}
        >
          {text}
        </span>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 150,
      ellipsis: true,
      render: (text) => (
        <span style={{ color: text ? colors.textPrimary : colors.textMuted, fontSize: 14 }}>
          {text || '\u2014'}
        </span>
      ),
    },
    {
      title: 'Address',
      key: 'address',
      width: 200,
      ellipsis: true,
      responsive: ['md'] as const,
      render: (_, record) => {
        const address = formatAddress(record);
        return (
          <span style={{ color: address ? colors.textSecondary : colors.textMuted, fontSize: 14 }}>
            {address || '—'}
          </span>
        );
      },
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: 160,
      ellipsis: true,
      responsive: ['md'] as const,
      render: (text) => (
        <span style={{ color: text ? colors.textSecondary : colors.textMuted, fontSize: 14 }}>
          {text || 'Untitled'}
        </span>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'estimateDate',
      key: 'estimateDate',
      width: 110,
      responsive: ['sm'] as const,
      render: (date) => (
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>
          {dayjs(date).format('MMM D, YYYY')}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: EstimateStatus) => {
        const config = getStatusDisplay(status, statusConfigs || []);
        return (
          <Tag
            style={{
              color: config.color,
              background: config.bg,
              border: 'none',
              fontWeight: 500,
              fontSize: 12,
            }}
          >
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 110,
      align: 'right',
      render: (total) => (
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>
          {formatCurrency(total)}
        </span>
      ),
    },
  ];

  const columns = allColumns.filter((col) => !hiddenColumns.includes(col.key as string));

  const estimates = data?.items || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          marginBottom: 20,
          gap: 12,
        }}
      >
        <h1
          style={{
            fontFamily: fonts.heading,
            fontSize: isMobile ? 20 : 22,
            fontWeight: 700,
            color: colors.textPrimary,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Estimates
        </h1>
        <Dropdown.Button
          type="primary"
          onClick={() => navigate('/app/estimates/new')}
          menu={{
            items: [
              {
                key: 'import-excel',
                label: 'Import from Excel',
                icon: <UploadOutlined />,
              },
            ],
            onClick: ({ key }) => {
              if (key === 'import-excel') setImportModalOpen(true);
            },
          }}
          style={isMobile ? { width: '100%' } : { flexShrink: 0 }}
          buttonsRender={([leftButton, rightButton]) => [
            React.cloneElement(leftButton as React.ReactElement, {
              style: {
                background: colors.primary,
                fontWeight: 600,
                borderRadius: '8px 0 0 8px',
                flex: isMobile ? 1 : undefined,
              },
            }),
            React.cloneElement(rightButton as React.ReactElement, {
              style: {
                background: colors.primary,
                borderRadius: '0 8px 8px 0',
              },
            }),
          ]}
        >
          <PlusOutlined /> New Estimate
        </Dropdown.Button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Input
          placeholder="Search estimates..."
          prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: isMobile ? undefined : 1, maxWidth: isMobile ? '100%' : 320 }}
          allowClear
        />
        <Select
          placeholder="All statuses"
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: isMobile ? '100%' : 160 }}
          allowClear
          options={(statusConfigs || []).map((status) => ({
            value: status.name,
            label: status.name.charAt(0).toUpperCase() + status.name.slice(1),
          }))}
        />
        {!isMobile && (
          <ColumnVisibilityControl
            options={COLUMN_OPTIONS}
            hiddenKeys={hiddenColumns}
            onChange={handleHiddenColumnsChange}
          />
        )}
      </div>

      {/* Mobile card view */}
      <div className="mobile-card-view">
        {isLoading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: colors.textMuted }}>
            Loading...
          </div>
        ) : estimates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <FileTextOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
            <h3
              style={{
                fontFamily: fonts.heading,
                fontSize: 18,
                fontWeight: 600,
                color: colors.textPrimary,
                margin: '0 0 8px',
              }}
            >
              No estimates yet
            </h3>
            <p
              style={{
                color: colors.textSecondary,
                marginBottom: 24,
                maxWidth: 320,
                margin: '0 auto 24px',
              }}
            >
              Create your first estimate to get started. Add line items, set prices, and send to customers.
            </p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/app/estimates/new')}
              style={{ background: colors.primary, fontWeight: 600, width: '100%' }}
            >
              Create Your First Estimate
            </Button>
          </div>
        ) : (
          estimates.map((record) => {
            const config = getStatusDisplay(record.status || '', statusConfigs || []);
            return (
              <div
                key={record.id}
                className="mobile-card"
                onClick={() => navigate(`/app/estimates/${record.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="mobile-card-header">
                  <span className="mobile-card-title">{record.estimateNumber}</span>
                  <Tag style={{ color: config.color, background: config.bg, border: 'none', fontWeight: 500 }}>
                    {config.label}
                  </Tag>
                </div>
                {record.customerName && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Customer</span>
                    <span className="mobile-card-value">{record.customerName}</span>
                  </div>
                )}
                {record.title && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Title</span>
                    <span className="mobile-card-value" style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {record.title}
                    </span>
                  </div>
                )}
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Date</span>
                  <span className="mobile-card-value">{dayjs(record.estimateDate).format('MMM D, YYYY')}</span>
                </div>
                <div className="mobile-card-row" style={{ borderBottom: 'none' }}>
                  <span className="mobile-card-label">Total</span>
                  <span className="mobile-card-value" style={{ fontWeight: 700 }}>{formatCurrency(record.total)}</span>
                </div>
              </div>
            );
          })
        )}
        {/* Mobile pagination info */}
        {estimates.length > 0 && (
          <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: 13, padding: '8px 0 4px' }}>
            {estimates.length} estimate{estimates.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Desktop table */}
      <Card className="desktop-table" style={{ borderRadius: 12, boxShadow: shadows.card, overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={estimates}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 560 }}
          pagination={{
            total: data?.total || 0,
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `${total} estimates`,
          }}
          locale={{
            emptyText: (
              <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                <FileTextOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
                <h3
                  style={{
                    fontFamily: fonts.heading,
                    fontSize: 18,
                    fontWeight: 600,
                    color: colors.textPrimary,
                    margin: '0 0 8px',
                  }}
                >
                  No estimates yet
                </h3>
                <p
                  style={{
                    color: colors.textSecondary,
                    marginBottom: 24,
                    maxWidth: 320,
                    margin: '0 auto 24px',
                  }}
                >
                  Create your first estimate to get started. Add line items, set prices, and send to customers.
                </p>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/app/estimates/new')}
                  style={{ background: colors.primary, fontWeight: 600 }}
                >
                  Create Your First Estimate
                </Button>
              </div>
            ),
          }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => navigate(`/app/estimates/${record.id}`),
          })}
        />
      </Card>

      <ImportExcelModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={(sections) => importMutation.mutate(sections)}
        documentType="estimate"
        onDownloadTemplate={estimateService.downloadExcelTemplate}
        onParseFile={estimateService.parseExcelFile}
        importing={importMutation.isPending}
      />
    </motion.div>
  );
};

export default EstimatesListPage;
