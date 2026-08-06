/**
 * Scopit - PDF Editor Import Modal
 *
 * Three-tab modal for importing PDFs into the editor from:
 *   - Estimates  (with template selector)
 *   - Invoices   (with template selector)
 *   - Company Documents
 *
 * Usage:
 *   <ImportModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onImport={(doc) => openDocument(doc)}
 *     importing={false}
 *   />
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Tabs,
  Select,
  Input,
  Button,
  Spin,
  Empty,
  Typography,
  Alert,
  Tag,
} from 'antd';
import {
  SearchOutlined,
  FileTextOutlined,
  ContainerOutlined,
  FolderOpenOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument, CompanyDocument } from './types';
import type { PdfTemplateId } from '@/types/entities';
import { colors, fonts, borderRadius, fontSizes } from '@/styles/theme';

const { Text } = Typography;

// ── Types ──────────────────────────────────────────────────────────────────────

// Minimal shapes returned by the estimate/invoice list endpoints
interface EstimateRow {
  id: string;
  estimate_number: string;
  customer_name?: string;
  total?: number;
  estimate_date?: string;
  status?: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_name?: string;
  total?: number;
  invoice_date?: string;
  status?: string;
}

export interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (doc: PdfDocument) => void;
  importing: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATE_OPTIONS: { value: PdfTemplateId; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Modern' },
  { value: 'professional', label: 'Professional' },
  { value: 'detailed', label: 'Detailed' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value?: number): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Section Label ─────────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text
    style={{
      fontSize: fontSizes.xs,
      fontWeight: 600,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      display: 'block',
      marginBottom: 8,
      fontFamily: fonts.body,
    }}
  >
    {children}
  </Text>
);

// ── Shared List Container ─────────────────────────────────────────────────────

const ListBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      border: `1px solid ${colors.border}`,
      borderRadius: borderRadius.md,
      maxHeight: 340,
      overflowY: 'auto',
    }}
  >
    {children}
  </div>
);

// ── Loading / Error / Empty states ────────────────────────────────────────────

const LoadingState: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
    <Spin size="small" />
  </div>
);

const ErrorState: React.FC<{ message?: string }> = ({ message = 'Failed to load items' }) => (
  <Alert type="error" message={message} showIcon style={{ margin: 12 }} />
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <Empty
    image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={
      <Text style={{ fontSize: fontSizes.sm, color: colors.textMuted, fontFamily: fonts.body }}>
        {text}
      </Text>
    }
    style={{ padding: '24px 0' }}
  />
);

// ── Divider ───────────────────────────────────────────────────────────────────

const RowDivider: React.FC = () => (
  <div style={{ height: 1, background: colors.border, margin: '0 12px' }} />
);

// ── Estimate Row ──────────────────────────────────────────────────────────────

interface EstimateListRowProps {
  item: EstimateRow;
  onImport: (id: string) => void;
  isImporting: boolean;
}

const EstimateListRow: React.FC<EstimateListRowProps> = ({ item, onImport, isImporting }) => (
  <div
    style={{
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}
  >
    {/* Icon */}
    <FileTextOutlined
      style={{
        color: colors.textMuted,
        fontSize: 15,
        marginTop: 2,
        flexShrink: 0,
      }}
    />

    {/* Info */}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text
          style={{
            fontSize: fontSizes.sm,
            fontWeight: 600,
            color: colors.textPrimary,
            fontFamily: fonts.body,
          }}
        >
          {item.estimate_number}
        </Text>
        {item.status && (
          <Tag
            style={{
              fontSize: 11,
              lineHeight: '16px',
              padding: '0 6px',
              background: colors.bgLight,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
              borderRadius: borderRadius.full,
              fontFamily: fonts.body,
            }}
          >
            {item.status}
          </Tag>
        )}
      </div>
      {item.customer_name && (
        <Text
          style={{
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            fontFamily: fonts.body,
            display: 'block',
            marginTop: 2,
          }}
        >
          {item.customer_name}
        </Text>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        {item.total != null && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
            {formatCurrency(item.total)}
          </Text>
        )}
        {item.estimate_date && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
            {formatDate(item.estimate_date)}
          </Text>
        )}
      </div>
    </div>

    {/* Import button */}
    <Button
      size="small"
      icon={<ImportOutlined />}
      loading={isImporting}
      onClick={() => onImport(item.id)}
      style={{
        fontFamily: fonts.body,
        fontSize: fontSizes.xs,
        flexShrink: 0,
        borderColor: colors.border,
        color: colors.textPrimary,
      }}
    >
      Import
    </Button>
  </div>
);

// ── Invoice Row ───────────────────────────────────────────────────────────────

interface InvoiceListRowProps {
  item: InvoiceRow;
  onImport: (id: string) => void;
  isImporting: boolean;
}

const InvoiceListRow: React.FC<InvoiceListRowProps> = ({ item, onImport, isImporting }) => (
  <div
    style={{
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}
  >
    <ContainerOutlined
      style={{
        color: colors.textMuted,
        fontSize: 15,
        marginTop: 2,
        flexShrink: 0,
      }}
    />

    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text
          style={{
            fontSize: fontSizes.sm,
            fontWeight: 600,
            color: colors.textPrimary,
            fontFamily: fonts.body,
          }}
        >
          {item.invoice_number}
        </Text>
        {item.status && (
          <Tag
            style={{
              fontSize: 11,
              lineHeight: '16px',
              padding: '0 6px',
              background: colors.bgLight,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
              borderRadius: borderRadius.full,
              fontFamily: fonts.body,
            }}
          >
            {item.status}
          </Tag>
        )}
      </div>
      {item.customer_name && (
        <Text
          style={{
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            fontFamily: fonts.body,
            display: 'block',
            marginTop: 2,
          }}
        >
          {item.customer_name}
        </Text>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        {item.total != null && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
            {formatCurrency(item.total)}
          </Text>
        )}
        {item.invoice_date && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
            {formatDate(item.invoice_date)}
          </Text>
        )}
      </div>
    </div>

    <Button
      size="small"
      icon={<ImportOutlined />}
      loading={isImporting}
      onClick={() => onImport(item.id)}
      style={{
        fontFamily: fonts.body,
        fontSize: fontSizes.xs,
        flexShrink: 0,
        borderColor: colors.border,
        color: colors.textPrimary,
      }}
    >
      Import
    </Button>
  </div>
);

// ── Company Doc Row ───────────────────────────────────────────────────────────

interface CompanyDocRowProps {
  doc: CompanyDocument;
  onImport: (id: string) => void;
  isImporting: boolean;
}

const CompanyDocRow: React.FC<CompanyDocRowProps> = ({ doc, onImport, isImporting }) => (
  <div
    style={{
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}
  >
    <FolderOpenOutlined
      style={{
        color: colors.textMuted,
        fontSize: 15,
        marginTop: 2,
        flexShrink: 0,
      }}
    />

    <div style={{ flex: 1, minWidth: 0 }}>
      <Text
        style={{
          fontSize: fontSizes.sm,
          fontWeight: 600,
          color: colors.textPrimary,
          fontFamily: fonts.body,
          display: 'block',
        }}
      >
        {doc.name}
      </Text>
      {doc.description && (
        <Text
          ellipsis
          style={{
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            fontFamily: fonts.body,
            display: 'block',
            marginTop: 2,
          }}
        >
          {doc.description}
        </Text>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
          {doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''}
        </Text>
        <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
          {formatFileSize(doc.fileSize)}
        </Text>
        {doc.category && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
            {doc.category}
          </Text>
        )}
      </div>
    </div>

    <Button
      size="small"
      icon={<ImportOutlined />}
      loading={isImporting}
      onClick={() => onImport(doc.id)}
      style={{
        fontFamily: fonts.body,
        fontSize: fontSizes.xs,
        flexShrink: 0,
        borderColor: colors.border,
        color: colors.textPrimary,
      }}
    >
      Import
    </Button>
  </div>
);

// ── Estimates Tab ─────────────────────────────────────────────────────────────

interface EstimatesTabProps {
  template: PdfTemplateId;
  onImport: (id: string) => void;
  importingId: string | null;
}

const EstimatesTab: React.FC<EstimatesTabProps> = ({ template, onImport, importingId }) => {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['import-estimates'],
    queryFn: async () => {
      const res = await api.get<{ items: EstimateRow[]; total: number }>('/estimates', {
        params: { skip: 0, limit: 50 },
      });
      return res.data.items ?? (res.data as unknown as EstimateRow[]);
    },
    staleTime: 60_000,
  });

  const items = Array.isArray(data) ? data : (data ?? []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (e) =>
        e.estimate_number?.toLowerCase().includes(q) ||
        e.customer_name?.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <>
      <Input
        prefix={<SearchOutlined style={{ color: colors.textMuted, fontSize: 13 }} />}
        placeholder="Search estimates..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 10, fontFamily: fonts.body, fontSize: fontSizes.sm }}
      />
      <ListBox>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message="Failed to load estimates" />
        ) : filtered.length === 0 ? (
          <EmptyState text={search ? 'No estimates match your search' : 'No estimates found'} />
        ) : (
          filtered.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 && <RowDivider />}
              <EstimateListRow
                item={item}
                onImport={onImport}
                isImporting={importingId === item.id}
              />
            </React.Fragment>
          ))
        )}
      </ListBox>
    </>
  );
};

// ── Invoices Tab ──────────────────────────────────────────────────────────────

interface InvoicesTabProps {
  template: PdfTemplateId;
  onImport: (id: string) => void;
  importingId: string | null;
}

const InvoicesTab: React.FC<InvoicesTabProps> = ({ template, onImport, importingId }) => {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['import-invoices'],
    queryFn: async () => {
      const res = await api.get<{ items: InvoiceRow[]; total: number }>('/invoices', {
        params: { skip: 0, limit: 50 },
      });
      return res.data.items ?? (res.data as unknown as InvoiceRow[]);
    },
    staleTime: 60_000,
  });

  const items = Array.isArray(data) ? data : (data ?? []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (inv) =>
        inv.invoice_number?.toLowerCase().includes(q) ||
        inv.customer_name?.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <>
      <Input
        prefix={<SearchOutlined style={{ color: colors.textMuted, fontSize: 13 }} />}
        placeholder="Search invoices..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 10, fontFamily: fonts.body, fontSize: fontSizes.sm }}
      />
      <ListBox>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message="Failed to load invoices" />
        ) : filtered.length === 0 ? (
          <EmptyState text={search ? 'No invoices match your search' : 'No invoices found'} />
        ) : (
          filtered.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 && <RowDivider />}
              <InvoiceListRow
                item={item}
                onImport={onImport}
                isImporting={importingId === item.id}
              />
            </React.Fragment>
          ))
        )}
      </ListBox>
    </>
  );
};

// ── Company Docs Tab ──────────────────────────────────────────────────────────

interface CompanyDocsTabProps {
  onImport: (id: string) => void;
  importingId: string | null;
}

const CompanyDocsTab: React.FC<CompanyDocsTabProps> = ({ onImport, importingId }) => {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['import-company-docs'],
    queryFn: () => pdfEditorApi.listCompanyDocs(0, 50),
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <>
      <Input
        prefix={<SearchOutlined style={{ color: colors.textMuted, fontSize: 13 }} />}
        placeholder="Search company documents..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 10, fontFamily: fonts.body, fontSize: fontSizes.sm }}
      />
      <ListBox>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message="Failed to load company documents" />
        ) : filtered.length === 0 ? (
          <EmptyState
            text={search ? 'No documents match your search' : 'No company documents found'}
          />
        ) : (
          filtered.map((doc, i) => (
            <React.Fragment key={doc.id}>
              {i > 0 && <RowDivider />}
              <CompanyDocRow
                doc={doc}
                onImport={onImport}
                isImporting={importingId === doc.id}
              />
            </React.Fragment>
          ))
        )}
      </ListBox>
    </>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────

type TabKey = 'estimates' | 'invoices' | 'company';

const ImportModal: React.FC<ImportModalProps> = ({ open, onClose, onImport, importing }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('estimates');
  const [template, setTemplate] = useState<PdfTemplateId>('classic');
  const [importingId, setImportingId] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setActiveTab('estimates');
      setTemplate('classic');
      setImportingId(null);
    }
  }, [open]);

  // Reset importingId when outer `importing` state clears
  useEffect(() => {
    if (!importing) setImportingId(null);
  }, [importing]);

  // ── Import handlers ──

  const handleImportEstimate = async (id: string) => {
    setImportingId(id);
    try {
      const doc = await pdfEditorApi.importEstimate(id, template);
      onImport(doc);
    } finally {
      setImportingId(null);
    }
  };

  const handleImportInvoice = async (id: string) => {
    setImportingId(id);
    try {
      const doc = await pdfEditorApi.importInvoice(id, template);
      onImport(doc);
    } finally {
      setImportingId(null);
    }
  };

  const handleImportCompanyDoc = async (id: string) => {
    setImportingId(id);
    try {
      const doc = await pdfEditorApi.importCompanyDoc(id);
      onImport(doc);
    } finally {
      setImportingId(null);
    }
  };

  const showTemplateSelector = activeTab === 'estimates' || activeTab === 'invoices';

  const tabItems = [
    {
      key: 'estimates' as TabKey,
      label: (
        <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}>
          <FileTextOutlined style={{ marginRight: 6 }} />
          Estimates
        </span>
      ),
      children: (
        <EstimatesTab
          template={template}
          onImport={handleImportEstimate}
          importingId={importingId}
        />
      ),
    },
    {
      key: 'invoices' as TabKey,
      label: (
        <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}>
          <ContainerOutlined style={{ marginRight: 6 }} />
          Invoices
        </span>
      ),
      children: (
        <InvoicesTab
          template={template}
          onImport={handleImportInvoice}
          importingId={importingId}
        />
      ),
    },
    {
      key: 'company' as TabKey,
      label: (
        <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}>
          <FolderOpenOutlined style={{ marginRight: 6 }} />
          Company Docs
        </span>
      ),
      children: (
        <CompanyDocsTab
          onImport={handleImportCompanyDoc}
          importingId={importingId}
        />
      ),
    },
  ];

  const footerEl = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        paddingTop: 4,
      }}
    >
      <Button
        onClick={onClose}
        disabled={!!importingId}
        style={{ fontFamily: fonts.body }}
      >
        Cancel
      </Button>
    </div>
  );

  return (
    <Modal
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: fontSizes.md }}>
          Import Document
        </span>
      }
      open={open}
      onCancel={onClose}
      width={560}
      footer={footerEl}
      maskClosable={!importingId}
      closable={!importingId}
      styles={{
        body: { padding: '0', fontFamily: fonts.body },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        footer: { padding: '12px 24px 16px', borderTop: `1px solid ${colors.border}` },
      }}
    >
      {/* Template selector - shown above the list for estimate/invoice tabs */}
      {showTemplateSelector && (
        <div
          style={{
            padding: '12px 24px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text
            style={{
              fontSize: fontSizes.sm,
              color: colors.textSecondary,
              fontFamily: fonts.body,
              flexShrink: 0,
            }}
          >
            Template:
          </Text>
          <Select<PdfTemplateId>
            value={template}
            onChange={setTemplate}
            options={TEMPLATE_OPTIONS}
            size="small"
            style={{ width: 140, fontFamily: fonts.body }}
          />
        </div>
      )}

      {/* Tabs */}
      <div style={{ padding: '0 24px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={tabItems}
          size="small"
          style={{ fontFamily: fonts.body }}
          tabBarStyle={{ marginBottom: 12 }}
        />
      </div>

      {/* Bottom spacer */}
      <div style={{ height: 4 }} />
    </Modal>
  );
};

export default ImportModal;
