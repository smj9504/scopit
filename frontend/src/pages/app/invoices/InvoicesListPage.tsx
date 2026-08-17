/**
 * Scopit - Invoices List Page
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Input, Select, Tag, Card, Dropdown, App } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DollarOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { invoiceService } from '@/services/invoiceService';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { useInvoiceStatuses, getStatusDisplay } from '@/hooks/useSettings';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ImportExcelModal } from '@/components/common/ImportExcelModal';
import { ColumnVisibilityControl } from '@/components/common/ColumnVisibilityControl';
import type { Invoice, InvoiceStatus, ExcelParsedSection } from '@/types/entities';
import type { ColumnsType } from 'antd/es/table';

const HIDDEN_COLUMNS_KEY = 'invoices_hidden_columns';
const COLUMN_OPTIONS = [
  { key: 'customerName', label: 'Customer' },
  { key: 'address', label: 'Address' },
  { key: 'invoiceDate', label: 'Date' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total' },
  { key: 'balanceDue', label: 'Balance' },
];

const formatAddress = (record: Invoice) => {
  const line1 = record.customerAddressLine1;
  const cityState = [record.customerCity, [record.customerState, record.customerZipcode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [line1, cityState].filter(Boolean).join(', ');
};

const InvoicesListPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
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

  // Fetch invoice statuses
  const { data: statusConfigs } = useInvoiceStatuses();

  // Import from Excel mutation
  const importMutation = useMutation({
    mutationFn: (sections: ExcelParsedSection[]) =>
      invoiceService.create({ sections } as any),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      message.success('Invoice imported successfully');
      setImportModalOpen(false);
      navigate(`/app/invoices/${invoice.id}/edit`);
    },
    onError: () => {
      message.error('Failed to create invoice from import');
    },
  });

  // Fetch invoices from API
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', { search, status: statusFilter }],
    queryFn: () =>
      invoiceService.getList({
        search: search || undefined,
        status: statusFilter,
        limit: 100,
      }),
  });

  const allColumns: ColumnsType<Invoice> = [
    {
      title: 'Number',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      width: 100,
      ellipsis: true,
      render: (text) => (
        <span style={{ fontWeight: 600, color: colors.textPrimary, cursor: 'pointer' }}>
          {text}
        </span>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 140,
      ellipsis: true,
      render: (text) => text || <span style={{ color: colors.textMuted }}>-</span>,
    },
    {
      title: 'Address',
      key: 'address',
      width: 200,
      ellipsis: true,
      responsive: ['md'] as const,
      render: (_, record) => {
        const address = formatAddress(record);
        return <span style={{ color: address ? undefined : colors.textMuted }}>{address || '—'}</span>;
      },
    },
    {
      title: 'Date',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      width: 110,
      responsive: ['sm'] as const,
      render: (date) => dayjs(date).format('MMM D, YYYY'),
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 110,
      responsive: ['md'] as const,
      render: (date) => dayjs(date).format('MMM D, YYYY'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: InvoiceStatus) => {
        const config = getStatusDisplay(status, statusConfigs || []);
        return (
          <Tag style={{ color: config.color, background: config.bg, border: 'none', fontWeight: 500 }}>
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 100,
      align: 'right',
      render: (total) => <span style={{ fontWeight: 600 }}>{formatCurrency(total || 0)}</span>,
    },
    {
      title: 'Balance',
      dataIndex: 'balanceDue',
      key: 'balanceDue',
      width: 100,
      align: 'right',
      responsive: ['lg'] as const,
      render: (balance) => (
        <span style={{ fontWeight: 600, color: (balance || 0) > 0 ? colors.error : colors.success }}>
          {formatCurrency(balance || 0)}
        </span>
      ),
    },
  ];

  const columns = allColumns.filter((col) => !hiddenColumns.includes(col.key as string));

  const invoices = data?.items || [];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
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
        <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
          Invoices
        </h1>
        <Dropdown.Button
          type="primary"
          onClick={() => navigate('/app/invoices/new')}
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
          <PlusOutlined /> New Invoice
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
          placeholder="Search invoices..."
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
        ) : invoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <DollarOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
            <h3
              style={{
                fontFamily: fonts.heading,
                fontSize: 18,
                fontWeight: 600,
                color: colors.textPrimary,
                margin: '0 0 8px',
              }}
            >
              No invoices yet
            </h3>
            <p
              style={{
                color: colors.textSecondary,
                marginBottom: 24,
                maxWidth: 320,
                margin: '0 auto 24px',
              }}
            >
              Convert an estimate to an invoice or create one from scratch.
            </p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/app/invoices/new')}
              style={{ background: colors.primary, fontWeight: 600, width: '100%' }}
            >
              Create Invoice
            </Button>
          </div>
        ) : (
          invoices.map((record) => {
            const config = getStatusDisplay(record.status || '', statusConfigs || []);
            return (
              <div
                key={record.id}
                className="mobile-card"
                onClick={() => navigate(`/app/invoices/${record.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="mobile-card-header">
                  <span className="mobile-card-title">{record.invoiceNumber}</span>
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
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Date</span>
                  <span className="mobile-card-value">{dayjs(record.invoiceDate).format('MMM D, YYYY')}</span>
                </div>
                {record.dueDate && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Due</span>
                    <span className="mobile-card-value">{dayjs(record.dueDate).format('MMM D, YYYY')}</span>
                  </div>
                )}
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Total</span>
                  <span className="mobile-card-value" style={{ fontWeight: 700 }}>{formatCurrency(record.total || 0)}</span>
                </div>
                <div className="mobile-card-row" style={{ borderBottom: 'none' }}>
                  <span className="mobile-card-label">Balance</span>
                  <span
                    className="mobile-card-value"
                    style={{ fontWeight: 600, color: (record.balanceDue || 0) > 0 ? colors.error : colors.success }}
                  >
                    {formatCurrency(record.balanceDue || 0)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        {invoices.length > 0 && (
          <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: 13, padding: '8px 0 4px' }}>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Desktop table */}
      <Card className="desktop-table" style={{ borderRadius: 12, boxShadow: shadows.card, overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={invoices}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 560 }}
          pagination={{
            total: data?.total || 0,
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `${total} invoices`,
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/app/invoices/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: (
              <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                <DollarOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
                <h3
                  style={{
                    fontFamily: fonts.heading,
                    fontSize: 18,
                    fontWeight: 600,
                    color: colors.textPrimary,
                    margin: '0 0 8px',
                  }}
                >
                  No invoices yet
                </h3>
                <p
                  style={{
                    color: colors.textSecondary,
                    marginBottom: 24,
                    maxWidth: 320,
                    margin: '0 auto 24px',
                  }}
                >
                  Convert an estimate to an invoice or create one from scratch.
                </p>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/app/invoices/new')}
                  style={{ background: colors.primary, fontWeight: 600 }}
                >
                  Create Invoice
                </Button>
              </div>
            ),
          }}
        />
      </Card>

      <ImportExcelModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={(sections) => importMutation.mutate(sections)}
        documentType="invoice"
        onDownloadTemplate={invoiceService.downloadExcelTemplate}
        onParseFile={invoiceService.parseExcelFile}
        importing={importMutation.isPending}
      />
    </motion.div>
  );
};

export default InvoicesListPage;
