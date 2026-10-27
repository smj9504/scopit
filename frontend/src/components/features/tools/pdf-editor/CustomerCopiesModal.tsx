/**
 * Scopit - Customer Copies Modal
 *
 * One PDF often has to be filled in or signed once per customer, each result
 * kept on its own. This modal copies a document for the customers picked and
 * lists the copies already made from it, each one opening in the editor.
 *
 * Usage:
 *   <CustomerCopiesModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     document={doc}
 *     onOpenDocument={(id) => openEditor(id)}
 *   />
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Select, Table, Typography, App, Tag, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument } from './types';
import { customerService } from '@/services/customerService';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

const { Text, Title } = Typography;

export interface CustomerCopiesModalProps {
  open: boolean;
  onClose: () => void;
  /** The document to copy for each customer */
  document: Pick<PdfDocument, 'id' | 'name'> | null;
  /** Open one of the copies in the editor */
  onOpenDocument: (id: string) => void;
}

interface PickedCustomer {
  value: string;
  label: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CustomerCopiesModal({
  open,
  onClose,
  document: doc,
  onOpenDocument,
}: CustomerCopiesModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [picked, setPicked] = useState<PickedCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Always start empty when opened for a (possibly different) document
  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setSearch('');
  }, [open, doc?.id]);

  const copiesQuery = useQuery({
    queryKey: ['pdf-customer-copies', doc?.id],
    queryFn: () => pdfEditorApi.listDocuments(0, 100, undefined, { templateId: doc!.id }),
    enabled: open && !!doc,
  });
  const copies = useMemo(
    () => (copiesQuery.data?.items ?? []).filter((c) => c.customerId),
    [copiesQuery.data],
  );
  const customersWithCopy = useMemo(() => new Set(copies.map((c) => c.customerId)), [copies]);

  const customersQuery = useQuery({
    queryKey: ['customers', 'copy-picker', debouncedSearch],
    queryFn: () => customerService.getList({ search: debouncedSearch || undefined, limit: 20, is_active: true }),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (customerIds: string[]) => pdfEditorApi.createCustomerCopies(doc!.id, customerIds),
    onSuccess: (created) => {
      message.success(`${created.length} customer cop${created.length === 1 ? 'y' : 'ies'} created`);
      setPicked([]);
      queryClient.invalidateQueries({ queryKey: ['pdf-customer-copies', doc?.id] });
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      queryClient.invalidateQueries({ queryKey: ['customer-documents'] });
    },
    onError: () => message.error('Failed to create customer copies'),
  });

  // Picked tags show the name; the dropdown also shows the email and
  // whether the customer already has a copy (another one can still be made)
  const options = (customersQuery.data?.items ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    email: c.email,
  }));

  const openCustomer = (customerId: string) => {
    onClose();
    navigate(`/app/customers/${customerId}`);
  };

  const columns: ColumnsType<PdfDocument> = [
    {
      title: 'Customer',
      key: 'customer',
      render: (_: unknown, copy: PdfDocument) => (
        <div style={{ minWidth: 0 }}>
          <Text
            style={{ fontSize: fontSizes.sm, fontWeight: 500, color: colors.textPrimary, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              if (copy.customerId) openCustomer(copy.customerId);
            }}
          >
            {copy.customer?.name ?? 'Customer'}
          </Text>
          <Text
            style={{
              display: 'block',
              fontSize: fontSizes.xs,
              color: colors.textMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {copy.name}
          </Text>
        </div>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 110,
      render: (date: string) => (
        <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>{formatDate(date)}</Text>
      ),
    },
    {
      title: '',
      key: 'open',
      width: 72,
      align: 'right' as const,
      render: (_: unknown, copy: PdfDocument) => (
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDocument(copy.id);
          }}
        >
          Open
        </Button>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: fontSizes.md, color: colors.textPrimary }}>
          Customer copies
        </Title>
      }
      footer={null}
      width={600}
      destroyOnHidden
      styles={{
        body: { padding: '4px 24px 20px' },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        content: { borderRadius: borderRadius.lg, fontFamily: fonts.body },
      }}
    >
      <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, margin: '12px 0' }}>
        Each customer gets their own copy of “{doc?.name}” to fill in or sign, saved on its own and listed on
        their customer page. This document stays as it is.
      </Text>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 20 }}>
        <Select<PickedCustomer[]>
          mode="multiple"
          labelInValue
          value={picked}
          onChange={setPicked}
          options={options}
          optionRender={(option) => (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {option.data.label}
                {option.data.email && <span style={{ color: colors.textMuted }}> · {option.data.email}</span>}
              </span>
              {customersWithCopy.has(String(option.value)) && (
                <Tag style={{ margin: 0, marginLeft: 'auto', fontSize: 11, flexShrink: 0 }}>Has a copy</Tag>
              )}
            </span>
          )}
          showSearch
          filterOption={false}
          searchValue={search}
          onSearch={setSearch}
          // A picked customer clears the search, ready for the next one
          onSelect={() => setSearch('')}
          placeholder="Search customers…"
          notFoundContent={customersQuery.isFetching ? <Spin size="small" /> : 'No customers found'}
          style={{ flex: 1, minWidth: 0 }}
          maxTagCount="responsive"
          aria-label="Customers to copy this document for"
        />
        <Button
          type="primary"
          disabled={picked.length === 0}
          loading={createMutation.isPending}
          onClick={() => createMutation.mutate(picked.map((p) => p.value))}
          style={{ background: colors.primary, borderColor: colors.primary, flexShrink: 0 }}
        >
          {picked.length > 1 ? `Create ${picked.length} copies` : 'Create copy'}
        </Button>
      </div>

      <Text style={{ display: 'block', fontSize: fontSizes.xs, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>
        Copies{copies.length > 0 ? ` (${copies.length})` : ''}
      </Text>
      <Table<PdfDocument>
        columns={columns}
        dataSource={copies}
        rowKey="id"
        size="small"
        loading={copiesQuery.isLoading}
        pagination={false}
        scroll={{ y: 300 }}
        onRow={(copy) => ({
          onClick: () => onOpenDocument(copy.id),
          style: { cursor: 'pointer' },
        })}
        locale={{
          emptyText: (
            <div style={{ padding: '20px 0', color: colors.textMuted, fontSize: fontSizes.sm }}>
              No customer copies yet
            </div>
          ),
        }}
      />
    </Modal>
  );
}
