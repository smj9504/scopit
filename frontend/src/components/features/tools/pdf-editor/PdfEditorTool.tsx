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
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument, SignRequest, Annotation } from './types';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius, shadows } from '@/styles/theme';
import PdfCanvas from './PdfCanvas';
import PageSidebar from './PageSidebar';
import AnnotationLayer from './AnnotationLayer';
import Toolbar from './Toolbar';
import PropertyPanel from './PropertyPanel';
import MergeModal from './MergeModal';
import ImportModal from './ImportModal';
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
  onOpenImport: () => void;
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
      const blob = await pdfEditorApi.downloadDocument(doc.id);
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
    beforeUpload: (_file, fileList) => {
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
                    onClick: () => onOpenImport(),
                  },
                  {
                    key: 'invoice',
                    label: 'From Invoice',
                    icon: <ImportOutlined />,
                    onClick: () => onOpenImport(),
                  },
                  {
                    key: 'company-doc',
                    label: 'From Company Document',
                    icon: <ImportOutlined />,
                    onClick: () => onOpenImport(),
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
    onSuccess: () => message.success('Sign request voided'),
    onError: () => message.error('Failed to void request'),
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
          {(req.status === 'draft' || req.status === 'sent' || req.status === 'viewed' || req.status === 'partially_signed') && (
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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isPdfPageReady, setIsPdfPageReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [drawColor, setDrawColor] = useState('#111827');
  const [drawWidth, setDrawWidth] = useState(2);

  // ── Sidebar & mobile state ──────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

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
  const pushUndo = useCallback((current: Annotation[]) => {
    setUndoStack((prev) => [...prev.slice(-19), current]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, annotations]);
      setAnnotations(prev);
      return stack.slice(0, -1);
    });
  }, [annotations]);

  const handleRedo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, annotations]);
      setAnnotations(next);
      return stack.slice(0, -1);
    });
  }, [annotations]);

  // ── Annotation handlers ───────────────────────────────────────────────────
  const handleAnnotationAdd = useCallback((ann: Annotation) => {
    setAnnotations((prev) => {
      pushUndo(prev);
      return [...prev, ann];
    });
    setIsDirty(true);
  }, [pushUndo]);

  const handleAnnotationUpdate = useCallback((updated: Annotation) => {
    setAnnotations((prev) => {
      pushUndo(prev);
      return prev.map((a) => (a.id === updated.id ? updated : a));
    });
    setIsDirty(true);
  }, [pushUndo]);

  // Lightweight update from PropertyPanel — no undo push, instant feedback
  const handleAnnotationQuickUpdate = useCallback((updated: Annotation) => {
    setAnnotations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setIsDirty(true);
  }, []);

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => {
      pushUndo(prev);
      return prev.filter((a) => a.id !== id);
    });
    setSelectedAnnotationId(null);
    setIsDirty(true);
  }, [pushUndo]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      await pdfEditorApi.saveAnnotations(documentId, annotations);
      setIsDirty(false);
      message.success('Saved');
    } catch {
      message.error('Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [documentId, annotations, message]);

  // Auto-save every 5 seconds when dirty
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 5000);
    return () => clearTimeout(timer);
  }, [isDirty, annotations, handleSave]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      // Ctrl+Z = Undo
      if (isMeta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z or Ctrl+Y = Redo
      if (isMeta && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl+S = Save
      if (isMeta && e.key === 's') {
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
  const handleExport = useCallback(async () => {
    try {
      const blob = await pdfEditorApi.downloadDocument(documentId, true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc?.name
        ? doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`
        : 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Export failed');
    }
  }, [documentId, doc, message]);

  // ── Page operations ───────────────────────────────────────────────────────
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);

  const handlePagesReorder = useCallback(async (newOrder: number[]) => {
    try {
      await pdfEditorApi.reorderPages(documentId, newOrder);
      queryClient.invalidateQueries({ queryKey: ['pdf-document', documentId] });
      setPdfRefreshKey((k) => k + 1);
    } catch {
      message.error('Reorder failed');
    }
  }, [documentId, queryClient, message]);

  const handlePagesDelete = useCallback(async (pages: number[]) => {
    try {
      await pdfEditorApi.deletePages(documentId, pages);
      queryClient.invalidateQueries({ queryKey: ['pdf-document', documentId] });
      if (pages.includes(currentPage)) setCurrentPage(1);
      setPdfRefreshKey((k) => k + 1);
    } catch {
      message.error('Delete failed');
    }
  }, [documentId, queryClient, currentPage, message]);

  const handlePagesRotate = useCallback(async (rotations: Record<string, number>) => {
    try {
      await pdfEditorApi.rotatePages(documentId, rotations);
      queryClient.invalidateQueries({ queryKey: ['pdf-document', documentId] });
      setPdfRefreshKey((k) => k + 1);
    } catch {
      message.error('Rotate failed');
    }
  }, [documentId, queryClient, message]);

  // ── Derived values ────────────────────────────────────────────────────────
  const pageCount = doc?.pageCount ?? 1;
  const docName = doc?.name ?? 'Loading...';

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
        onSave={handleSave}
        onExport={handleExport}
        isSaving={isSaving}
        isDirty={isDirty}
        documentName={docName}
        onBack={onBack}
        drawColor={drawColor}
        drawWidth={drawWidth}
        onDrawColorChange={setDrawColor}
        onDrawWidthChange={setDrawWidth}
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
            />
          </div>
        )}
      </div>

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
            onOpenImport={() => setImportModalOpen(true)}
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
      />
    </div>
  );
};

export default PdfEditorTool;
