/**
 * Scopit - Add Customer Document Modal
 *
 * From a customer's page: pick a document from the PDF editor's library and
 * get this customer's own copy of it, to fill in or sign. The library
 * document stays as it is, to copy for the next customer.
 *
 * Usage:
 *   <AddCustomerDocumentModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     customer={{ id: customer.id, name: customer.name }}
 *     onCreated={(doc) => openEditor(doc.id)}
 *   />
 */
import { useEffect, useState } from 'react';
import { Modal, Input, Typography, App, Spin, Empty } from 'antd';
import { RightOutlined, FilePdfOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument } from './types';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

const { Text, Title } = Typography;

export interface AddCustomerDocumentModalProps {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name: string };
  /** The customer's new copy, ready to open */
  onCreated: (doc: PdfDocument) => void;
}

export default function AddCustomerDocumentModal({
  open,
  onClose,
  customer,
  onCreated,
}: AddCustomerDocumentModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  // Library documents only: another customer's copy isn't something to copy from
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pdf-editor-documents', 'customer-picker', debouncedSearch],
    queryFn: () => pdfEditorApi.listDocuments(0, 50, debouncedSearch || undefined, { hasCustomer: false }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const documents = data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (documentId: string) => pdfEditorApi.createCustomerCopies(documentId, [customer.id]),
    onSuccess: ([created]) => {
      queryClient.invalidateQueries({ queryKey: ['customer-documents', customer.id] });
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      queryClient.invalidateQueries({ queryKey: ['pdf-customer-copies'] });
      onCreated(created);
    },
    onError: () => message.error('Failed to create the document'),
  });
  const creatingId = createMutation.isPending ? createMutation.variables : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: fontSizes.md, color: colors.textPrimary }}>
          Add Document
        </Title>
      }
      footer={null}
      width={520}
      styles={{
        body: { padding: '4px 24px 20px' },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        content: { borderRadius: borderRadius.lg, fontFamily: fonts.body },
      }}
    >
      <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, margin: '12px 0' }}>
        Pick a PDF to make {customer.name}'s own copy, then fill it in or sign it in the editor. The original
        stays as it is for your other customers.
      </Text>

      <Input
        placeholder="Search documents..."
        prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 12 }}
      />

      <Spin spinning={isLoading || (isFetching && !creatingId)}>
        {!isLoading && documents.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>
                {debouncedSearch ? 'No documents match your search' : 'No documents yet. Upload one in the PDF Editor.'}
              </Text>
            }
            style={{ padding: '32px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
            {documents.map((doc) => {
              const creating = creatingId === doc.id;
              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => !creatingId && createMutation.mutate(doc.id)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !creatingId) {
                      e.preventDefault();
                      createMutation.mutate(doc.id);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    cursor: creatingId ? 'default' : 'pointer',
                    opacity: creatingId && !creating ? 0.5 : 1,
                  }}
                >
                  <FilePdfOutlined style={{ fontSize: 18, color: colors.textMuted, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        display: 'block',
                        fontSize: fontSizes.sm,
                        fontWeight: 500,
                        color: colors.textPrimary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {doc.name}
                    </Text>
                    <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
                      {doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''}
                      {doc.customerCopyCount
                        ? ` · ${doc.customerCopyCount} customer cop${doc.customerCopyCount === 1 ? 'y' : 'ies'}`
                        : ''}
                    </Text>
                  </div>
                  {creating ? <Spin size="small" /> : <RightOutlined style={{ color: colors.textMuted, fontSize: 12, flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}
      </Spin>
    </Modal>
  );
}
