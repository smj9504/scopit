/**
 * ScopeIt - Request Signature Modal
 *
 * Entry point for starting an e-signature request from anywhere in the app
 * (currently: Customer Detail page). Owns the "pick a company document
 * template -> resolve its e-signature-capable linked copy -> hand off into
 * SendForSignModal" flow.
 *
 * Field mapping is intentionally NOT handled here -- templates with no
 * fields defined redirect to Settings > Documents, which is the canonical
 * place to manage document templates and their fields.
 *
 * Usage:
 *   <RequestSignatureModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     customer={customerData}
 *     onSent={() => queryClient.invalidateQueries({ queryKey: ['customer-documents', id] })}
 *   />
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Typography, App, Spin, Empty, Tag } from 'antd';
import { RightOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import SendForSignModal from './SendForSignModal';
import type { PdfDocument, SignRequest, CompanyDocument } from './types';
import type { CustomerData } from '@/components/features/CustomerSelector';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

const { Text, Title } = Typography;

export interface RequestSignatureModalProps {
  open: boolean;
  onClose: () => void;
  customer?: CustomerData;
  onSent?: (result: SignRequest) => void;
}

export default function RequestSignatureModal({
  open,
  onClose,
  customer,
  onSent,
}: RequestSignatureModalProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();

  const [sendTarget, setSendTarget] = useState<PdfDocument | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Always restart at the picker step when the modal is re-opened.
  useEffect(() => {
    if (!open) setSendTarget(null);
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['company-documents-picker'],
    queryFn: () => pdfEditorApi.listCompanyDocs(0, 100),
    staleTime: 30_000,
    enabled: open,
  });
  const documents = data?.items ?? [];

  const resolveLinkedDocMutation = useMutation({
    mutationFn: (companyDocumentId: string) => pdfEditorApi.getOrCreateLinkedDocument(companyDocumentId),
  });

  const goToSettingsDocuments = () => {
    onClose();
    navigate('/app/settings/documents');
  };

  const handleSelectTemplate = async (doc: CompanyDocument) => {
    setResolvingId(doc.id);
    try {
      const linked = await resolveLinkedDocMutation.mutateAsync(doc.id);
      // A template with no fields yet still opens SendForSignModal -- its own
      // Step 1 empty state offers "Define Fields" inline now, so there's no
      // need to bounce out to Settings first.
      setSendTarget(linked);
    } catch {
      message.error('Failed to prepare this document for e-signature');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <>
      <Modal
        open={open && !sendTarget}
        onCancel={onClose}
        title={
          <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: fontSizes.md, color: colors.textPrimary }}>
            Request Signature
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
        <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body, margin: '12px 0' }}>
          Pick a document template to send{customer?.name ? ` to ${customer.name}` : ''} for signature.
        </Text>

        <Spin spinning={isLoading}>
          {!isLoading && documents.length === 0 ? (
            <Empty
              description={
                <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary, fontFamily: fonts.body }}>
                  No document templates yet
                </Text>
              }
              style={{ padding: '32px 0' }}
            >
              <Button type="primary" onClick={goToSettingsDocuments} style={{ background: colors.primary, borderColor: colors.primary }}>
                Go to Settings → Documents
              </Button>
            </Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
              {documents.map((doc) => {
                const resolving = resolvingId === doc.id;
                return (
                  <div
                    key={doc.id}
                    onClick={() => !resolvingId && handleSelectTemplate(doc)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      cursor: resolvingId ? 'default' : 'pointer',
                      opacity: resolvingId && !resolving ? 0.5 : 1,
                      transition: 'background 0.15s ease',
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
                          fontFamily: fonts.body,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {doc.name}
                      </Text>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {doc.category && (
                          <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4, background: colors.bgLight, borderColor: colors.border, color: colors.textMuted }}>
                            {doc.category}
                          </Tag>
                        )}
                        <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
                          {doc.pageCount > 0 ? `${doc.pageCount} page${doc.pageCount !== 1 ? 's' : ''}` : ''}
                        </Text>
                      </div>
                    </div>
                    {resolving ? <Spin size="small" /> : <RightOutlined style={{ color: colors.textMuted, fontSize: 12, flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          )}
        </Spin>
      </Modal>

      {sendTarget && (
        <SendForSignModal
          open={!!sendTarget}
          onClose={() => { setSendTarget(null); onClose(); }}
          documentId={sendTarget.id}
          documentName={sendTarget.name}
          pageCount={sendTarget.pageCount}
          fieldDefinitions={sendTarget.fieldDefinitions}
          initialCustomer={customer}
          onSent={onSent}
        />
      )}
    </>
  );
}
