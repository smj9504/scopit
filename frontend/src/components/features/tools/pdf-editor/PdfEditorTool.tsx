/**
 * Scopit - PDF Editor Tool
 *
 * Two modes:
 *   1. List mode  – document library + sign request tabs (existing)
 *   2. Editor mode – full 3-column PDF editor (new)
 *
 * Usage (auto-registered in registry.ts):
 *   const PdfEditorTool = lazy(() => import('./pdf-editor/PdfEditorTool'));
 */
import React, { useState, useCallback, useEffect } from 'react';
import { createAnnotationSaver } from './annotationSaver';
import {
  Button,
  Card,
  Table,
  Space,
  Typography,
  Tabs,
  Upload,
  Empty,
  Spin,
  Dropdown,
  Tag,
  Tooltip,
  App,
  Input,
  Modal,
  Drawer,
} from 'antd';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  CopyOutlined,
  MoreOutlined,
  FileTextOutlined,
  SendOutlined,
  SearchOutlined,
  InboxOutlined,
  ImportOutlined,
  MergeCellsOutlined,
  EyeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument, SignRequest, Annotation } from './types';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius, shadows } from '@/styles/theme';
import PdfCanvas from './PdfCanvas';
import PageSidebar from './PageSidebar';
import AnnotationLayer, { DEFAULT_CHECK_SIZE } from './AnnotationLayer';
import Toolbar from './Toolbar';
import PropertyPanel from './PropertyPanel';
import MergeModal from './MergeModal';
import ImportModal, { type ImportTabKey } from './ImportModal';
import SendForSignModal from './SendForSignModal';
import FieldMappingModal from './FieldMappingModal';
import SignRequestDetail from './SignRequestDetail';
import ImageUploadPreview from './ImageUploadPreview';
import SignatureModal from './SignatureModal';

const { Text, Title } = Typography;
const { Dragger } = Upload;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const SIGN_STATUS_COLOR: Record<string, string> = {
  draft: colors.textMuted,
  sent: colors.textSecondary,
  viewed: '#6366f1',
  partially_signed: colors.warning,
  signed: colors.success,
  declined: colors.error,
  expired: colors.warning,
  cancelled: colors.textMuted,
};

const SIGN_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_signed: 'Partially Signed',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Voided',
};

// ── Document Thumbnail ────────────────────────────────────────────────────────

const DocThumbnail: React.FC<{ doc: PdfDocument }> = ({ doc }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!doc.thumbnailUrl) return;
    let cancelled = false;
    let url: string | null = null;

    pdfEditorApi
      .getThumbnail(doc.id)
      .then((objUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objUrl);
          return;
        }
        url = objUrl;
        setObjectUrl(objUrl);
      })
      .catch(() => {
        if (!cancelled) setImgError(true);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, doc.thumbnailUrl]);

  if (objectUrl && !imgError) {
    return (
      <img
        src={objectUrl}
        alt={doc.name}
        onError={() => setImgError(true)}
        style={{
          width: 36,
          height: 48,
          objectFit: 'cover',
          borderRadius: borderRadius.sm,
          border: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 36,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.bgLight,
        borderRadius: borderRadius.sm,
        border: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}
    >
      <FileTextOutlined style={{ fontSize: 18, color: colors.textMuted }} />
    </div>
  );
};

// ── Editor Tab ────────────────────────────────────────────────────────────────

interface EditorTabProps {
  onOpenEditor: (id: string) => void;
  onOpenMerge: () => void;
  onOpenImport: (tab: ImportTabKey) => void;
}

const EditorTab: React.FC<EditorTabProps> = ({ onOpenEditor, onOpenMerge, onOpenImport }) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PdfDocument | null>(null);
  const [renameName, setRenameName] = useState('');
  const [imagePreviewFile, setImagePreviewFile] = useState<File | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const PAGE_SIZE = 10;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pdf-editor-documents', page, search],
    queryFn: () => pdfEditorApi.listDocuments((page - 1) * PAGE_SIZE, PAGE_SIZE, search || undefined),
    placeholderData: (prev) => prev,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, rotation }: { file: File; rotation?: number }) =>
      pdfEditorApi.uploadDocument(file, undefined, rotation || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: () => message.error('Upload failed'),
  });

  const imagesToPdfMutation = useMutation({
    mutationFn: (files: File[]) => pdfEditorApi.imagesToPdf(files),
    onSuccess: () => {
      message.success(`Photos combined into PDF`);
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: () => message.error('Failed to create PDF from images'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pdfEditorApi.deleteDocument(id),
    onSuccess: () => {
      message.success('Document deleted');
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: () => message.error('Delete failed'),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => pdfEditorApi.duplicateDocument(id),
    onSuccess: () => {
      message.success('Document duplicated');
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: () => message.error('Duplicate failed'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      pdfEditorApi.renameDocument(id, name),
    onSuccess: () => {
      message.success('Document renamed');
      setRenameModalOpen(false);
      setRenameTarget(null);
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: () => message.error('Rename failed'),
  });

  const handleDownload = useCallback(async (doc: PdfDocument) => {
    try {
      // With the user's edits burned in, same as the editor's Download PDF
      const blob = await pdfEditorApi.downloadDocument(doc.id, true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Download failed');
    }
  }, [message]);

  const handleDelete = useCallback(
    (doc: PdfDocument) => {
      Modal.confirm({
        title: 'Delete document?',
        content: `"${doc.name}" will be permanently deleted.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => deleteMutation.mutate(doc.id),
      });
    },
    [deleteMutation],
  );

  const openRename = useCallback((doc: PdfDocument) => {
    setRenameTarget(doc);
    setRenameName(doc.name);
    setRenameModalOpen(true);
  }, []);

  const isImageFile = (f: File) =>
    f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|tiff)$/i.test(f.name);

  const handleImagePreviewConfirm = useCallback((file: File, rotation: number) => {
    setImagePreviewOpen(false);
    setImagePreviewFile(null);
    uploadMutation.mutate({ file, rotation });
  }, [uploadMutation]);

  const draggerProps: UploadProps = {
    name: 'file',
    multiple: true,
    accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.docx,application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    showUploadList: false,
    beforeUpload: (file, fileList) => {
      // antd calls this once per file, each time with the whole batch;
      // handle the batch once (on its first file) or it's uploaded N times
      if (file.uid !== fileList[0]?.uid) return false;

      const imageFiles = fileList.filter(f => isImageFile(f as unknown as File));
      const nonImageFiles = fileList.filter(f => !isImageFile(f as unknown as File));

      // Multiple images → combine into one PDF (no preview needed)
      if (imageFiles.length > 1 && nonImageFiles.length === 0) {
        imagesToPdfMutation.mutate(imageFiles as unknown as File[]);
      }
      // Single image → show preview with rotation option
      else if (imageFiles.length === 1 && nonImageFiles.length === 0) {
        setImagePreviewFile(imageFiles[0] as unknown as File);
        setImagePreviewOpen(true);
      }
      // Non-image files (PDF, DOCX) → upload directly
      else {
        for (const f of nonImageFiles) {
          uploadMutation.mutate({ file: f as unknown as File });
        }
        // Also handle any single images in mixed upload
        for (const f of imageFiles) {
          uploadMutation.mutate({ file: f as unknown as File });
        }
      }
      return false;
    },
  };

  const getRowActions = useCallback(
    (doc: PdfDocument) => [
      {
        key: 'download',
        label: 'Download',
        onClick: () => handleDownload(doc),
      },
      {
        key: 'rename',
        label: 'Rename',
        onClick: () => openRename(doc),
      },
      {
        key: 'duplicate',
        label: 'Duplicate',
        onClick: () => duplicateMutation.mutate(doc.id),
      },
      { type: 'divider' as const },
      {
        key: 'delete',
        label: 'Delete',
        danger: true,
        onClick: () => handleDelete(doc),
      },
    ],
    [duplicateMutation, openRename, onOpenEditor, handleDownload, handleDelete],
  );

  const columns: ColumnsType<PdfDocument> = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, doc: PdfDocument) => (
        <div>
          <Text
            strong
            style={{ fontFamily: fonts.body, fontSize: 14, cursor: 'pointer' }}
            onClick={() => onOpenEditor(doc.id)}
          >
            {name}
          </Text>
          {doc.sourceType && doc.sourceType !== 'upload' && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {doc.sourceType === 'estimate'
                  ? 'From estimate'
                  : doc.sourceType === 'invoice'
                  ? 'From invoice'
                  : 'From template'}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Pages',
      dataIndex: 'pageCount',
      width: 80,
      align: 'center' as const,
      render: (count: number) => (
        <Text style={{ fontSize: 14, color: colors.textSecondary }}>{count}</Text>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'fileSize',
      width: 90,
      render: (size: number) => (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>{formatFileSize(size)}</Text>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 130,
      render: (date: string) => (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>{formatDate(date)}</Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      align: 'right' as const,
      render: (_: unknown, doc: PdfDocument) => (
        <Dropdown
          menu={{ items: getRowActions(doc) }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
            style={{ color: colors.textSecondary }}
          />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      {/* Upload area */}
      <Card
        style={{ borderRadius: borderRadius.lg, marginBottom: 20, boxShadow: shadows.sm }}
        styles={{ body: { padding: '20px 24px' } }}
      >
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <Title level={5} style={{ margin: 0, fontFamily: fonts.heading }}>
            Upload Document
          </Title>
          <Space size={8}>
            <Button icon={<MergeCellsOutlined />} onClick={onOpenMerge}>
              Merge
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'estimate',
                    label: 'From Estimate',
                    icon: <ImportOutlined />,
                    onClick: () => onOpenImport('estimates'),
                  },
                  {
                    key: 'invoice',
                    label: 'From Invoice',
                    icon: <ImportOutlined />,
                    onClick: () => onOpenImport('invoices'),
                  },
                  {
                    key: 'company-doc',
                    label: 'From Company Document',
                    icon: <ImportOutlined />,
                    onClick: () => onOpenImport('company'),
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button icon={<ImportOutlined />}>
                Import
              </Button>
            </Dropdown>
          </Space>
        </div>
        <Dragger
          {...draggerProps}
          style={{
            borderRadius: borderRadius.md,
            background: colors.bgLight,
            borderColor: colors.border,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            {(uploadMutation.isPending || imagesToPdfMutation.isPending) ? (
              <Spin />
            ) : (
              <InboxOutlined style={{ fontSize: 40, color: colors.textMuted }} />
            )}
          </div>
          <p style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textPrimary, margin: 0 }}>
            Drag files here or <span style={{ color: colors.primary, fontWeight: 600 }}>click to browse</span>
          </p>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            PDF, Images (JPG, PNG, WEBP, HEIC), Word (DOCX) — auto-converted to PDF
          </p>
        </Dragger>
      </Card>

      {/* Document list */}
      <Card
        style={{ borderRadius: borderRadius.lg, boxShadow: shadows.sm }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Title level={5} style={{ margin: 0, flex: 1, fontFamily: fonts.heading }}>
            Documents
          </Title>
          <Input
            placeholder="Search documents..."
            prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            allowClear
            style={{ width: 220, fontFamily: fonts.body }}
          />
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : !data?.items.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>
                {search ? 'No documents match your search' : 'No documents yet. Upload a PDF to get started.'}
              </Text>
            }
            style={{ padding: '48px 24px' }}
          />
        ) : (
          <Table<PdfDocument>
            columns={columns}
            dataSource={data.items}
            rowKey="id"
            loading={isFetching && !isLoading}
            onRow={(doc) => ({
              onClick: () => onOpenEditor(doc.id),
              style: { cursor: 'pointer' },
            })}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: data.total,
              onChange: (p) => setPage(p),
              showSizeChanger: false,
              showTotal: (total) => `${total} document${total !== 1 ? 's' : ''}`,
              size: 'small',
            }}
            size="middle"
            style={{ fontFamily: fonts.body }}
          />
        )}
      </Card>

      {/* Rename modal */}
      <Modal
        title="Rename Document"
        open={renameModalOpen}
        onOk={() => {
          if (renameTarget && renameName.trim()) {
            renameMutation.mutate({ id: renameTarget.id, name: renameName.trim() });
          }
        }}
        onCancel={() => setRenameModalOpen(false)}
        confirmLoading={renameMutation.isPending}
        okText="Rename"
        okButtonProps={{ disabled: !renameName.trim() }}
        destroyOnHidden
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={() => {
            if (renameTarget && renameName.trim()) {
              renameMutation.mutate({ id: renameTarget.id, name: renameName.trim() });
            }
          }}
          placeholder="Document name"
          style={{ fontFamily: fonts.body }}
          autoFocus
        />
      </Modal>

      {/* Image upload preview with rotation */}
      <ImageUploadPreview
        open={imagePreviewOpen}
        file={imagePreviewFile}
        onConfirm={handleImagePreviewConfirm}
        onCancel={() => {
          setImagePreviewOpen(false);
          setImagePreviewFile(null);
        }}
      />
    </div>
  );
};

// ── Sign Requests Tab ─────────────────────────────────────────────────────────

interface SignRequestsTabProps {
  onViewDetail: (requestId: string) => void;
}

const SignRequestsTab: React.FC<SignRequestsTabProps> = ({ onViewDetail }) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pdf-editor-sign-requests', page, statusFilter],
    queryFn: () =>
      pdfEditorApi.listSignRequests(statusFilter, (page - 1) * PAGE_SIZE, PAGE_SIZE),
    placeholderData: (prev) => prev,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => pdfEditorApi.cancelSignRequest(id),
    onSuccess: () => {
      message.success('Sign request voided');
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-sign-requests'] });
    },
    onError: () => message.error('Failed to void request'),
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (id: string) => pdfEditorApi.deleteDraftSignRequest(id),
    onSuccess: () => {
      message.success('Draft deleted');
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-sign-requests'] });
    },
    onError: () => message.error('Failed to delete draft'),
  });

  const handleDownloadSigned = useCallback(async (req: SignRequest) => {
    try {
      const blob = await pdfEditorApi.downloadSignedDocument(req.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = req.documentName
        ? req.documentName.replace(/\.[^.]+$/, '')
        : `document_${req.id}`;
      a.download = `${baseName}_signed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Download failed');
    }
  }, [message]);

  const STATUS_FILTERS = [
    { key: undefined, label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'sent', label: 'Sent' },
    { key: 'viewed', label: 'Viewed' },
    { key: 'partially_signed', label: 'Partially Signed' },
    { key: 'signed', label: 'Signed' },
    { key: 'declined', label: 'Declined' },
    { key: 'expired', label: 'Expired' },
    { key: 'cancelled', label: 'Voided' },
  ];

  const columns: ColumnsType<SignRequest> = [
    {
      title: 'Document',
      dataIndex: 'documentName',
      render: (name: string | null) => (
        <Text
          style={{ fontFamily: fonts.body, fontSize: 14 }}
        >
          {name || 'Untitled'}
        </Text>
      ),
    },
    {
      title: 'Recipients',
      key: 'recipient',
      render: (_: unknown, req: SignRequest) => {
        const [first, ...rest] = req.recipients;
        if (!first) return <Text type="secondary" style={{ fontSize: 14 }}>—</Text>;
        return (
          <div>
            <Text style={{ fontSize: 14 }}>
              {first.name}
              {rest.length > 0 && ` +${rest.length} more`}
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{first.email}</Text>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (status: string) => (
        <Tag
          style={{
            color: SIGN_STATUS_COLOR[status] || colors.textSecondary,
            borderColor: colors.border,
            background: colors.bgLight,
            fontFamily: fonts.body,
            fontSize: 12,
          }}
        >
          {SIGN_STATUS_LABEL[status] || status}
        </Tag>
      ),
    },
    {
      title: 'Sent',
      dataIndex: 'sentAt',
      width: 120,
      render: (date: string | null) => (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {date ? formatDate(date) : '—'}
        </Text>
      ),
    },
    {
      title: 'Signed',
      dataIndex: 'signedAt',
      width: 120,
      render: (date: string | null) => (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {date ? formatDate(date) : '—'}
        </Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      align: 'right' as const,
      render: (_: unknown, req: SignRequest) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          {req.status === 'signed' && (
            <Tooltip title="Download signed PDF">
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleDownloadSigned(req)}
                style={{ color: colors.textSecondary }}
              />
            </Tooltip>
          )}
          {req.status === 'draft' && (
            <Tooltip title="Delete draft">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={deleteDraftMutation.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: 'Delete this draft?',
                    content: 'The draft was never sent. It will be removed permanently.',
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    onOk: () => deleteDraftMutation.mutate(req.id),
                  })
                }
                style={{ color: colors.textMuted }}
              />
            </Tooltip>
          )}
          {(req.status === 'sent' || req.status === 'viewed' || req.status === 'partially_signed') && (
            <Tooltip title="Void">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={cancelMutation.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: 'Void this sign request?',
                    content: 'No recipient will be able to sign this document after voiding.',
                    okText: 'Void Request',
                    okButtonProps: { danger: true },
                    onOk: () => cancelMutation.mutate(req.id),
                  })
                }
                style={{ color: colors.textMuted }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        style={{ borderRadius: borderRadius.lg, boxShadow: shadows.sm }}
        styles={{ body: { padding: 0 } }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Title level={5} style={{ margin: 0, flex: 1, fontFamily: fonts.heading }}>
            Sign Requests
          </Title>
          <Space size={6} wrap>
            {STATUS_FILTERS.map((f) => (
              <Button
                key={String(f.key)}
                size="small"
                type={statusFilter === f.key ? 'primary' : 'default'}
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                }}
                style={{ fontFamily: fonts.body }}
              >
                {f.label}
              </Button>
            ))}
          </Space>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : !data?.items.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>
                No sign requests yet. Open a document and send it for signature.
              </Text>
            }
            style={{ padding: '48px 24px' }}
          />
        ) : (
          <Table<SignRequest>
            columns={columns}
            dataSource={data.items}
            rowKey="id"
            loading={isFetching && !isLoading}
            onRow={(record) => ({
              onClick: () => onViewDetail(record.id),
              style: { cursor: 'pointer' },
            })}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: data.total,
              onChange: (p) => setPage(p),
              showSizeChanger: false,
              showTotal: (total) => `${total} request${total !== 1 ? 's' : ''}`,
              size: 'small',
            }}
            scroll={{ x: 800 }}
            size="middle"
            style={{ fontFamily: fonts.body }}
          />
        )}
      </Card>
    </div>
  );
};

// ── Editor View ───────────────────────────────────────────────────────────────

export interface EditorViewProps {
  documentId: string;
  onBack: () => void;
  /** Pixels of fixed chrome above this view to subtract from 100vh.
   * Defaults to the app's own top bar (56px) for the standalone Tools page;
   * pass 0 when embedding full-screen inside something with no such bar
   * (e.g. a full-screen Modal). */
  heightOffset?: number;
}

export const EditorView: React.FC<EditorViewProps> = ({ documentId, onBack, heightOffset = 56 }) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  // ── Editor state ──────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [activeTool, setActiveTool] = useState<string>('select');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const annotationsRef = React.useRef(annotations);
  annotationsRef.current = annotations;
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isPdfPageReady, setIsPdfPageReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [drawColor, setDrawColor] = useState('#111827');
  const [drawWidth, setDrawWidth] = useState(2);
  // Size for new check marks; follows the last check the user resized so it
  // sticks for the rest of this editing session
  const [checkSize, setCheckSize] = useState(DEFAULT_CHECK_SIZE);

  // ── Sidebar & mobile state ──────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  // Mobile has no side panel; properties open in a bottom drawer instead
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  // A page operation rewrites the saved annotations on the server; nothing
  // may autosave the editor's old copy over them while it runs
  const pageOpRef = React.useRef(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setSidebarOpen(false);
    };
    onChange(mql);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // ── Document data ─────────────────────────────────────────────────────────
  const { data: doc } = useQuery({
    queryKey: ['pdf-document', documentId],
    queryFn: () => pdfEditorApi.getDocument(documentId),
  });

  // Load annotations from document on first fetch
  useEffect(() => {
    if (doc?.annotations) {
      setAnnotations(doc.annotations);
    }
  }, [doc?.id]); // only re-run if the document itself changes, not on every refetch

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  // Every change goes through commitAnnotations, which reads the latest list
  // from the ref (so back-to-back changes in one tick don't lose each other)
  // and keeps side effects out of state updaters, which React may run twice.
  const commitAnnotations = useCallback((next: Annotation[], recordUndo = true) => {
    const previous = annotationsRef.current;
    if (recordUndo) {
      setUndoStack((stack) => [...stack.slice(-19), previous]);
      setRedoStack([]);
    }
    annotationsRef.current = next;
    setAnnotations(next);
    setIsDirty(true);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const current = annotationsRef.current;
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((stack) => [...stack, current]);
    annotationsRef.current = previous;
    setAnnotations(previous);
    setIsDirty(true);
  }, [undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const current = annotationsRef.current;
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((stack) => [...stack, current]);
    annotationsRef.current = next;
    setAnnotations(next);
    setIsDirty(true);
  }, [redoStack]);

  // ── Annotation handlers ───────────────────────────────────────────────────
  const handleAnnotationAdd = useCallback((ann: Annotation) => {
    commitAnnotations([...annotationsRef.current, ann]);
    // One placement per tool pick; freehand drawing stays on for more strokes
    if (ann.type !== 'drawing') setActiveTool('select');
  }, [commitAnnotations]);

  const rememberCheckSize = useCallback((ann: Annotation) => {
    if (ann.type === 'shape' && ann.content === 'check' && ann.width > 0) {
      setCheckSize(Math.round(ann.width));
    }
  }, []);

  // Canvas edits (move/resize/rotate/typing), possibly several objects at once
  const handleAnnotationUpdate = useCallback((updates: Annotation[]) => {
    const byId = new Map(updates.map((u) => [u.id, u]));
    commitAnnotations(annotationsRef.current.map((a) => byId.get(a.id) ?? a));
    updates.forEach(rememberCheckSize);
  }, [commitAnnotations, rememberCheckSize]);

  // PropertyPanel edits fire continuously (sliders, color drags), so one undo
  // step covers a burst of edits to the same element
  const lastQuickEditRef = React.useRef<{ id: string; at: number } | null>(null);
  const handleAnnotationQuickUpdate = useCallback((updated: Annotation) => {
    const now = Date.now();
    const last = lastQuickEditRef.current;
    const recordUndo = !last || last.id !== updated.id || now - last.at > 1000;
    lastQuickEditRef.current = { id: updated.id, at: now };
    commitAnnotations(
      annotationsRef.current.map((a) => (a.id === updated.id ? updated : a)),
      recordUndo,
    );
    rememberCheckSize(updated);
  }, [commitAnnotations, rememberCheckSize]);

  const handleAnnotationDelete = useCallback((id: string) => {
    commitAnnotations(annotationsRef.current.filter((a) => a.id !== id));
    setSelectedAnnotationId(null);
  }, [commitAnnotations]);

  // Layer order = position in the list (export draws in list order)
  const handleBringToFront = useCallback((id: string) => {
    const list = annotationsRef.current;
    const target = list.find((a) => a.id === id);
    if (!target || list[list.length - 1]?.id === id) return;
    commitAnnotations([...list.filter((a) => a.id !== id), target]);
  }, [commitAnnotations]);

  const handleSendToBack = useCallback((id: string) => {
    const list = annotationsRef.current;
    const target = list.find((a) => a.id === id);
    if (!target || list[0]?.id === id) return;
    commitAnnotations([target, ...list.filter((a) => a.id !== id)]);
  }, [commitAnnotations]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveLatestAnnotations = React.useMemo(() => createAnnotationSaver(
    () => annotationsRef.current,
    async (snapshot) => {
      const saved = await pdfEditorApi.saveAnnotations(documentId, snapshot);
      queryClient.setQueryData(['pdf-document', documentId], saved);
    },
  ), [documentId, queryClient]);

  // Share uploads and include edits made during saving. A failure must stop
  // export/navigation so the editor retains the user's unsaved changes.
  // `silent` = autosave: no toast on success, and a failure is reported once
  // per failure streak rather than every retry.
  const autosaveFailedRef = React.useRef(false);
  const handleSave = useCallback(async (silent = false) => {
    if (pageOpRef.current) return false;
    try {
      setIsSaving(true);
      await saveLatestAnnotations();
      setIsDirty(false);
      autosaveFailedRef.current = false;
      if (!silent) message.success('Saved');
      return true;
    } catch {
      if (!silent || !autosaveFailedRef.current) {
        message.error('Save failed. Your changes are still in the editor. Please try again.');
      }
      if (silent) autosaveFailedRef.current = true;
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [saveLatestAnnotations, message]);

  const handleBack = useCallback(async () => {
    if ((isDirty || isSaving) && !(await handleSave(true))) return;
    onBack();
  }, [isDirty, isSaving, handleSave, onBack]);

  // Auto-save every 5 seconds when dirty
  useEffect(() => {
    if (!isDirty || isSaving) return;
    const timer = setTimeout(() => {
      handleSave(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isDirty, isSaving, annotations, handleSave]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // While typing (a text annotation, a panel input, ...) undo/redo belong
      // to that field, not to the annotation history
      const focused = document.activeElement as HTMLElement | null;
      const focusTag = (focused?.tagName ?? '').toLowerCase();
      const isTyping = focusTag === 'input' || focusTag === 'textarea'
        || focusTag === 'select' || !!focused?.isContentEditable;
      // Ctrl+Z = Undo
      if (isMeta && key === 'z' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z or Ctrl+Y = Redo
      if (isMeta && ((key === 'z' && e.shiftKey) || key === 'y') && !isTyping) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl+S = Save
      if (isMeta && key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape = back to select tool
      if (e.key === 'Escape') {
        setActiveTool('select');
        setSelectedAnnotationId(null);
      }
      // V = switch to select tool (only when not typing in an input/textarea)
      if (e.key === 'v' && !isMeta && !e.shiftKey && !e.altKey) {
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select'
          || (document.activeElement as HTMLElement)?.isContentEditable;
        if (!isEditable) {
          setActiveTool('select');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleSave]);

  // ── Send for Signature ──────────────────────────────────────────────────
  const [sendForSignOpen, setSendForSignOpen] = useState(false);
  const [fieldMappingOpen, setFieldMappingOpen] = useState(false);

  // ── Sign (insert own signature) ────────────────────────────────────────
  const [signModalOpen, setSignModalOpen] = useState(false);
  const signPosRef = React.useRef<{ x: number; y: number } | null>(null);

  const handleSignRequest = useCallback((pos: { x: number; y: number }) => {
    signPosRef.current = pos;
    setSignModalOpen(true);
  }, []);

  const handleSignInsert = useCallback((dataUrl: string) => {
    const pos = signPosRef.current ?? { x: 100, y: 100 };
    signPosRef.current = null;

    // Create an image element to get dimensions
    const img = new Image();
    img.onload = () => {
      const maxW = 200;
      const maxH = 80;
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;

      const ann: Annotation = {
        id: crypto.randomUUID(),
        type: 'image',
        page: currentPage,
        x: pos.x,
        y: pos.y,
        width: w,
        height: h,
        rotation: 0,
        content: dataUrl,
        style: { opacity: 1 },
      };
      handleAnnotationAdd(ann);
    };
    img.src = dataUrl;
  }, [currentPage, handleAnnotationAdd]);

  // ── Export ────────────────────────────────────────────────────────────────
  const downloadBlob = useCallback((blob: Blob, suffix = '') => {
    const base = (doc?.name ?? 'document').replace(/\.pdf$/i, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}${suffix}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  const handleExport = useCallback(async () => {
    if ((isDirty || isSaving) && !(await handleSave(true))) return;
    try {
      downloadBlob(await pdfEditorApi.downloadDocument(documentId, true));
    } catch {
      message.error('Export failed');
    }
  }, [documentId, isDirty, isSaving, message, handleSave, downloadBlob]);

  const handleExportOriginal = useCallback(async () => {
    try {
      downloadBlob(await pdfEditorApi.downloadDocument(documentId, false), ' (original)');
    } catch {
      message.error('Download failed');
    }
  }, [documentId, message, downloadBlob]);

  // ── Page operations ───────────────────────────────────────────────────────
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);

  // The server moves/rotates/drops annotations together with their pages, so
  // unsaved edits are saved first and the editor then takes the server's
  // copy (undo history no longer matches the pages, so it's cleared).
  const runPageOperation = useCallback(async (
    label: string,
    operation: () => Promise<PdfDocument>,
    pageAfter?: (updated: PdfDocument) => number,
  ) => {
    if ((isDirty || isSaving) && !(await handleSave(true))) return;
    pageOpRef.current = true;
    try {
      const updated = await operation();
      queryClient.setQueryData(['pdf-document', documentId], updated);
      const fresh = updated.annotations ?? [];
      annotationsRef.current = fresh;
      setAnnotations(fresh);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedAnnotationId(null);
      setIsDirty(false);
      if (pageAfter) setCurrentPage(Math.max(1, Math.min(pageAfter(updated), updated.pageCount)));
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      message.error(typeof detail === 'string' ? `${label} failed: ${detail}` : `${label} failed`);
    } finally {
      pageOpRef.current = false;
      setPdfRefreshKey((k) => k + 1);
    }
  }, [isDirty, isSaving, handleSave, documentId, queryClient, message]);

  // newOrder: current 1-based page numbers in their new order
  const handlePagesReorder = useCallback((newOrder: number[]) => runPageOperation(
    'Reorder',
    () => pdfEditorApi.reorderPages(documentId, newOrder),
    () => newOrder.indexOf(currentPage) + 1,  // stay on the page you were viewing
  ), [runPageOperation, documentId, currentPage]);

  const handlePagesDelete = useCallback((pages: number[]) => runPageOperation(
    'Delete',
    () => pdfEditorApi.deletePages(documentId, pages),
    () => currentPage - pages.filter((p) => p < currentPage).length,
  ), [runPageOperation, documentId, currentPage]);

  const handlePagesRotate = useCallback((rotations: Record<string, number>) => runPageOperation(
    'Rotate',
    () => pdfEditorApi.rotatePages(documentId, rotations),
  ), [runPageOperation, documentId]);

  // ── Derived values ────────────────────────────────────────────────────────
  const pageCount = doc?.pageCount ?? 1;
  const docName = doc?.name ?? 'Loading...';

  // Never point at a page the document no longer has
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  // Annotations visible on the current page (for AnnotationLayer)
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);

  const selectedAnnotation = selectedAnnotationId
    ? annotations.find((a) => a.id === selectedAnnotationId) ?? null
    : null;

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: `calc(100vh - ${heightOffset}px)`,
        overflow: 'hidden',
        background: colors.bgLight,
      }}
    >
      {/* Toolbar – full width */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={Math.round(zoom * 100)}
        onZoomChange={(pct) => setZoom(pct / 100)}
        currentPage={currentPage}
        pageCount={pageCount}
        onPageChange={setCurrentPage}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={() => handleSave()}
        onExport={handleExport}
        onExportOriginal={handleExportOriginal}
        isSaving={isSaving}
        isDirty={isDirty}
        documentName={docName}
        onBack={handleBack}
        drawColor={drawColor}
        drawWidth={drawWidth}
        onDrawColorChange={setDrawColor}
        onDrawWidthChange={setDrawWidth}
        checkSize={checkSize}
        onCheckSizeChange={setCheckSize}
      />

      {/* Action bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: '#fff',
        gap: 8,
      }}>
        <Button
          type="text"
          size="small"
          icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          onClick={() => setSidebarOpen((v) => !v)}
          style={{ color: colors.textSecondary, flexShrink: 0 }}
          aria-label={sidebarOpen ? 'Hide pages' : 'Show pages'}
        >
          {!isMobile && 'Pages'}
        </Button>
        <Space size={8}>
          {isMobile && selectedAnnotation && (
            <Button
              icon={<SlidersOutlined />}
              onClick={() => setMobilePropsOpen(true)}
              size="small"
              style={{ fontFamily: fonts.body }}
              aria-label="Edit selected element"
            >
              Edit
            </Button>
          )}
          <Button
            onClick={() => setFieldMappingOpen(true)}
            size={isMobile ? 'small' : 'middle'}
            style={{ fontFamily: fonts.body }}
          >
            {isMobile ? 'Fields' : 'Define Fields'}
          </Button>
          <Button
            icon={<SendOutlined />}
            onClick={() => setSendForSignOpen(true)}
            size={isMobile ? 'small' : 'middle'}
            style={{ fontFamily: fonts.body }}
          >
            {isMobile ? 'Sign' : 'Send for Signature'}
          </Button>
        </Space>
      </div>

      {/* Three-column body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Page sidebar – toggleable */}
        {sidebarOpen && (
          <div
            style={{
              width: isMobile ? '100%' : 160,
              maxWidth: isMobile ? '100%' : 160,
              flexShrink: 0,
              borderRight: isMobile ? 'none' : `1px solid ${colors.border}`,
              overflow: 'hidden',
              background: colors.bgWhite,
              ...(isMobile ? {
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 20,
                boxShadow: '4px 0 12px rgba(0,0,0,0.1)',
                width: 180,
              } : {}),
            }}
          >
            <PageSidebar
              documentId={documentId}
              pageCount={pageCount}
              currentPage={currentPage}
              onPageSelect={(page) => {
                setCurrentPage(page);
                if (isMobile) setSidebarOpen(false);
              }}
              onPagesReorder={handlePagesReorder}
              onPagesDelete={handlePagesDelete}
              onPagesRotate={handlePagesRotate}
              refreshKey={pdfRefreshKey}
            />
          </div>
        )}

        {/* Mobile overlay backdrop when sidebar is open */}
        {isMobile && sidebarOpen && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 19,
              background: 'rgba(0,0,0,0.3)',
            }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* PDF canvas + annotation overlay – flex: 1 */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#e5e7eb',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: isMobile ? '12px 4px' : '24px 16px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'inline-block',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              borderRadius: 4,
              background: '#fff',
              maxWidth: isMobile ? '100%' : undefined,
            }}
          >
            <PdfCanvas
              documentId={documentId}
              currentPage={currentPage}
              zoom={zoom}
              pageCount={pageCount}
              onPageChange={setCurrentPage}
              activeTool={activeTool}
              refreshKey={pdfRefreshKey}
              onCanvasResize={(w, h) => setCanvasSize({ width: w, height: h })}
              onPageReady={setIsPdfPageReady}
            />
            {canvasSize.width > 0 && canvasSize.height > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: canvasSize.width,
                  height: canvasSize.height,
                  opacity: isPdfPageReady ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                  pointerEvents: isPdfPageReady ? 'auto' : 'none',
                }}
              >
                <AnnotationLayer
                  width={canvasSize.width}
                  height={canvasSize.height}
                  pageNumber={currentPage}
                  annotations={pageAnnotations}
                  activeTool={activeTool}
                  selectedAnnotationId={selectedAnnotationId}
                  onAnnotationSelect={setSelectedAnnotationId}
                  onAnnotationUpdate={handleAnnotationUpdate}
                  onAnnotationAdd={handleAnnotationAdd}
                  onAnnotationDelete={handleAnnotationDelete}
                  zoom={zoom}
                  drawColor={drawColor}
                  drawWidth={drawWidth}
                  checkSize={checkSize}
                  onSignRequest={handleSignRequest}
                />
              </div>
            )}
          </div>
        </div>

        {/* Property panel – hidden on mobile */}
        {!isMobile && (
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderLeft: `1px solid ${colors.border}`,
              overflow: 'hidden auto',
              background: colors.bgLight,
            }}
          >
            <PropertyPanel
              selectedAnnotation={selectedAnnotation}
              onAnnotationUpdate={handleAnnotationQuickUpdate}
              onAnnotationDelete={handleAnnotationDelete}
              onBringToFront={handleBringToFront}
              onSendToBack={handleSendToBack}
            />
          </div>
        )}
      </div>

      {/* Property panel – bottom drawer on mobile */}
      {isMobile && (
        <Drawer
          placement="bottom"
          open={mobilePropsOpen && !!selectedAnnotation}
          onClose={() => setMobilePropsOpen(false)}
          height="60vh"
          title={null}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          <PropertyPanel
            selectedAnnotation={selectedAnnotation}
            onAnnotationUpdate={handleAnnotationQuickUpdate}
            onAnnotationDelete={(id) => {
              handleAnnotationDelete(id);
              setMobilePropsOpen(false);
            }}
            onBringToFront={handleBringToFront}
            onSendToBack={handleSendToBack}
          />
        </Drawer>
      )}

      {/* Define Fields (template editor) Modal */}
      <FieldMappingModal
        open={fieldMappingOpen}
        onClose={() => setFieldMappingOpen(false)}
        documentId={documentId}
        documentName={docName}
        pageCount={pageCount}
        initialFields={doc?.fieldDefinitions ?? []}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['pdf-document', documentId] })}
      />

      {/* Send for Signature Modal */}
      <SendForSignModal
        open={sendForSignOpen}
        onClose={() => setSendForSignOpen(false)}
        documentId={documentId}
        documentName={docName}
        pageCount={pageCount}
        fieldDefinitions={doc?.fieldDefinitions ?? []}
      />

      {/* Sign (insert own signature) Modal */}
      <SignatureModal
        open={signModalOpen}
        onClose={() => setSignModalOpen(false)}
        onInsert={handleSignInsert}
      />
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const PdfEditorTool: React.FC<ToolComponentProps> = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('editor');
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<ImportTabKey>('estimates');
  const [signRequestDetailId, setSignRequestDetailId] = useState<string | null>(null);

  const mergeMutation = useMutation({
    mutationFn: ({ ids, name }: { ids: string[]; name: string }) =>
      pdfEditorApi.mergeDocuments(ids, name),
    onSuccess: (doc) => {
      message.success('Documents merged');
      setMergeModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      // Open the merged document right away
      setEditingDocumentId(doc.id);
    },
    onError: () => message.error('Merge failed'),
  });

  const handleMerge = useCallback(
    (ids: string[], name: string) => {
      mergeMutation.mutate({ ids, name });
    },
    [mergeMutation],
  );

  const handleImportComplete = useCallback(
    (doc: PdfDocument) => {
      setImportModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      setEditingDocumentId(doc.id);
    },
    [queryClient],
  );

  // ── Sign request detail mode ──────────────────────────────────────────────
  if (signRequestDetailId) {
    return (
      <SignRequestDetail
        requestId={signRequestDetailId}
        onBack={() => setSignRequestDetailId(null)}
      />
    );
  }

  // ── Editor mode ───────────────────────────────────────────────────────────
  if (editingDocumentId) {
    return (
      <EditorView
        documentId={editingDocumentId}
        onBack={() => setEditingDocumentId(null)}
      />
    );
  }

  // ── List mode (existing) ──────────────────────────────────────────────────
  const tabItems = [
    {
      key: 'editor',
      label: (
        <span style={{ fontFamily: fonts.body, fontSize: 14 }}>
          Editor
        </span>
      ),
      children: (
        <div style={{ paddingTop: 20 }}>
          <EditorTab
            onOpenEditor={(id) => setEditingDocumentId(id)}
            onOpenMerge={() => setMergeModalOpen(true)}
            onOpenImport={(tab) => {
              setImportTab(tab);
              setImportModalOpen(true);
            }}
          />
        </div>
      ),
    },
    {
      key: 'sign-requests',
      label: (
        <span style={{ fontFamily: fonts.body, fontSize: 14 }}>
          Sign Requests
        </span>
      ),
      children: (
        <div style={{ paddingTop: 20 }}>
          <SignRequestsTab onViewDetail={(id) => setSignRequestDetailId(id)} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 4,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title
            level={4}
            style={{ margin: 0, fontFamily: fonts.heading, color: colors.textPrimary }}
          >
            PDF Editor
          </Title>
          <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.body }}>
            Upload, annotate, and send PDFs for e-signature
          </Text>
        </div>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={() => {
            setActiveTab('editor');
            setTimeout(() => {
              const dragger = document.querySelector('.ant-upload-drag');
              if (dragger) {
                dragger.scrollIntoView({ behavior: 'smooth' });
                // Trigger file dialog by clicking the upload input
                const input = dragger.querySelector('input[type="file"]') as HTMLInputElement | null;
                if (input) input.click();
              }
            }, 100);
          }}
          style={{ fontFamily: fonts.body, fontWeight: 600 }}
        >
          Upload
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        style={{ fontFamily: fonts.body }}
      />

      <MergeModal
        open={mergeModalOpen}
        onClose={() => setMergeModalOpen(false)}
        onMerge={handleMerge}
        merging={mergeMutation.isPending}
      />

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={handleImportComplete}
        importing={false}
        initialTab={importTab}
      />
    </div>
  );
};

export default PdfEditorTool;
