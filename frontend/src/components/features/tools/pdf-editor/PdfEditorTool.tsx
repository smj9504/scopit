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
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi, type PreviewCover } from './pdfEditorApi';
import type {
  PdfDocument,
  SignRequest,
  Annotation,
  CropBoxes,
  CropMargins,
  PageImage,
  TextSearchMatch,
} from './types';
import type { PdfTextLayer } from './pdfTextRuns';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius, shadows } from '@/styles/theme';
import { useFocusMode } from '@/hooks/useFocusMode';
import PdfCanvas from './PdfCanvas';
import PageSidebar from './PageSidebar';
import AnnotationLayer, {
  DEFAULT_CHECK_SIZE,
  TEXT_COVER_SUFFIX,
  isImageCover,
  isTextCoverId,
  type ImagePick,
} from './AnnotationLayer';
import Toolbar, { headerButtonStyle, ZOOM_MAX, ZOOM_MIN } from './Toolbar';
import PropertyPanel from './PropertyPanel';
import MergeModal from './MergeModal';
import ToolsMenu, { type ToolsMenuAction } from './ToolsMenu';
import OrganizePagesView from './OrganizePagesView';
import InsertPagesModal, { type InsertSource } from './InsertPagesModal';
import ExtractPagesModal from './ExtractPagesModal';
import ProtectModal from './ProtectModal';
import RedactBar, { type RedactApplyOptions } from './RedactBar';
import EditBar from './EditBar';
import PageNavBar, { PAGE_NAV_BAR_CLEARANCE } from './PageNavBar';
import { usePinchZoom } from './usePinchZoom';
import { useHoverTip } from './useHoverTip';
import RedactSearchModal from './RedactSearchModal';
import { CropBar, CropOverlay, type CropRect } from './CropOverlay';
import { usePdfPassword, apiErrorMessage } from './pdfPassword';
import ImportModal, { type ImportTabKey } from './ImportModal';
import SendForSignModal from './SendForSignModal';
import FieldMappingModal from './FieldMappingModal';
import SignRequestDetail from './SignRequestDetail';
import ImageUploadPreview from './ImageUploadPreview';
import SignatureModal from './SignatureModal';
import CustomerCopiesModal from './CustomerCopiesModal';

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

// Where a document came from, under its name in the list
const SOURCE_LABEL: Record<string, string> = {
  estimate: 'From estimate',
  invoice: 'From invoice',
  merge: 'Combined files',
  extract: 'Extracted pages',
  convert: 'Converted to PDF',
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
  const [copiesTarget, setCopiesTarget] = useState<PdfDocument | null>(null);
  const PAGE_SIZE = 10;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pdf-editor-documents', page, search],
    queryFn: () => pdfEditorApi.listDocuments((page - 1) * PAGE_SIZE, PAGE_SIZE, search || undefined),
    placeholderData: (prev) => prev,
  });

  // A password-protected PDF asks for its password, then uploads again
  const withPdfPassword = usePdfPassword();
  const uploadMutation = useMutation({
    mutationFn: ({ file, rotation }: { file: File; rotation?: number }) =>
      withPdfPassword(
        (password) => pdfEditorApi.uploadDocument(file, undefined, rotation || 0, password),
        file.name,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Upload failed')),
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
      // A customer's copy is already one customer's; copies come from the original
      ...(doc.customerId ? [] : [{
        key: 'customer-copies',
        label: 'Copy for customers…',
        onClick: () => setCopiesTarget(doc),
      }]),
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
          {doc.customer ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <UserOutlined style={{ marginRight: 4 }} />
                For {doc.customer.name}
              </Text>
            </div>
          ) : doc.sourceType && doc.sourceType !== 'upload' && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {SOURCE_LABEL[doc.sourceType] ?? 'From template'}
              </Text>
            </div>
          )}
          {!doc.customerId && !!doc.customerCopyCount && (
            <div>
              <Button
                type="link"
                size="small"
                icon={<TeamOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  setCopiesTarget(doc);
                }}
                style={{ padding: 0, height: 'auto', fontSize: 12 }}
              >
                {doc.customerCopyCount} customer cop{doc.customerCopyCount === 1 ? 'y' : 'ies'}
              </Button>
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
        // The menu renders in a portal, but React still bubbles its clicks
        // up this tree to the row, whose onClick opens the editor
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown
            menu={{ items: getRowActions(doc) }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              style={{ color: colors.textSecondary }}
            />
          </Dropdown>
        </span>
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

      <CustomerCopiesModal
        open={!!copiesTarget}
        onClose={() => setCopiesTarget(null)}
        document={copiesTarget}
        onOpenDocument={(id) => {
          setCopiesTarget(null);
          onOpenEditor(id);
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

// Space beside the page on a phone, each side
const MOBILE_PAGE_GUTTER = 8;

/** Fills the whole window: the Tools page puts the app in focus mode while
 * it's open, and SendForSignModal shows it in a full-screen Modal. */
export interface EditorViewProps {
  documentId: string;
  onBack: () => void;
  /** Open another document in the editor (a combined or extracted one) */
  onOpenDocument?: (id: string) => void;
}

export const EditorView: React.FC<EditorViewProps> = ({
  documentId,
  onBack,
  onOpenDocument,
}) => {
  const { message, modal } = App.useApp();
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
  // The page as last drawn: its size on screen, and the zoom it was drawn at
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, zoom: 1 });
  const [isPdfPageReady, setIsPdfPageReady] = useState(false);
  const [textLayer, setTextLayer] = useState<PdfTextLayer | null>(null);
  // Edit Text covers whose words the page on screen has erased
  const [erasedCoverIds, setErasedCoverIds] = useState<ReadonlySet<string>>(() => new Set());
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
  const [pageOpBusy, setPageOpBusy] = useState(false);

  // ── Page tools (Organize, Insert, Extract, Crop, Combine, Protect, Redact) ──
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [extractPages, setExtractPages] = useState<number[] | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const [redactSearchOpen, setRedactSearchOpen] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  // What the pages showed before the last crop (or Remove crop), until
  // another page operation: Undo puts it back once the edits made since
  // are undone
  const [cropUndo, setCropUndo] = useState<CropBoxes | null>(null);
  const cropUndoRef = React.useRef<() => void>(() => {});
  const withPdfPassword = usePdfPassword();

  // The crop area belongs to the page it was drawn on (pages differ in size)
  useEffect(() => {
    setCropRect(null);
  }, [activeTool, currentPage]);

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
  const { data: doc, isError: docMissing } = useQuery({
    queryKey: ['pdf-document', documentId],
    queryFn: () => pdfEditorApi.getDocument(documentId),
  });

  // A link (?doc=) to a document that has since been deleted
  useEffect(() => {
    if (!docMissing) return;
    message.error('This document could not be opened');
    onBack();
  }, [docMissing, message, onBack]);

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
    if (undoStack.length === 0) {
      cropUndoRef.current();
      return;
    }
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
    // One placement per tool pick; freehand drawing and redaction marking
    // stay on for more
    if (ann.type !== 'drawing' && ann.type !== 'redact') setActiveTool('select');
  }, [commitAnnotations]);

  // Edit Text: the cover box and its replacement text are one undo step.
  // Edit stays on for the next text until it's turned off.
  const handleTextReplace = useCallback((added: Annotation[]) => {
    if (added.length) commitAnnotations([...annotationsRef.current, ...added]);
  }, [commitAnnotations]);

  // Edit: some of the page's own images -- one clicked, or those a dragged
  // box touched -- picked up to move, resize, replace or delete. A cover
  // takes each original off the page (the export removes it from the
  // page's content) and an image annotation of it, with the id the layer
  // gave it, takes its place: one undo step, like an Edit Text pair -- the
  // same one as the text the box took, if it took some (`withText`). The
  // layer selects them once they're on the canvas.
  const pickingImageRef = React.useRef(false);
  const handleImagePick = useCallback(async (picks: ImagePick[], withText: boolean) => {
    if (pickingImageRef.current) return;
    pickingImageRef.current = true;
    const page = currentPage;
    const hide = message.loading(picks.length > 1 ? 'Picking up images…' : 'Picking up image…', 0);
    try {
      const results = await Promise.allSettled(
        picks.map((p) => pdfEditorApi.getEmbeddedImage(documentId, page, p.image.index)),
      );
      const added: Annotation[] = [];
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const picked = result.value;
        const { id } = picks[i];
        const box = {
          x: picked.x,
          y: picked.y,
          width: picked.width,
          height: picked.height,
          rotation: picked.rotation,
        };
        added.push(
          {
            id: id + TEXT_COVER_SUFFIX,
            type: 'shape',
            page,
            ...box,
            content: 'rect',
            style: { backgroundColor: '#ffffff', color: '#ffffff', borderWidth: 0 },
          },
          {
            id,
            type: 'image',
            page,
            ...box,
            content: picked.dataUrl,
            style: { opacity: 1 },
          },
        );
      });
      if (added.length) commitAnnotations([...annotationsRef.current, ...added], !withText);

      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length === 1 && picks.length === 1) {
        message.error(apiErrorMessage(failed[0].reason, 'This image can’t be edited'));
      } else if (failed.length) {
        message.error(`${failed.length} of ${picks.length} images can’t be edited`);
      }
    } finally {
      hide();
      pickingImageRef.current = false;
    }
  }, [currentPage, documentId, commitAnnotations, message]);

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

  // Deleting an Edit Text replacement empties it: its cover keeps the
  // original words erased (Restore original brings them back). The empty
  // text keeps its top-left corner, where typing into it again starts.
  const handleAnnotationDelete = useCallback((id: string) => {
    const list = annotationsRef.current;
    const isReplacement = list.some((a) => a.id === id + TEXT_COVER_SUFFIX);
    const emptied = (a: Annotation): Annotation => {
      const r = ((a.rotation || 0) * Math.PI) / 180;
      const height = (a.style?.fontSize ?? 16) * 1.13; // one fabric line
      const dx = -a.width / 2;
      const dy = (height - a.height) / 2;
      return {
        ...a,
        content: '',
        x: a.x + dx * Math.cos(r) - dy * Math.sin(r),
        y: a.y + dx * Math.sin(r) + dy * Math.cos(r),
        width: 0,
        height,
      };
    };
    commitAnnotations(isReplacement
      ? list.map((a) => {
        if (a.id !== id) return a;
        // A picked-up image just goes; its cover keeps the original off the page
        return a.type === 'image' ? { ...a, content: '' } : emptied(a);
      })
      : list.filter((a) => a.id !== id));
    setSelectedAnnotationId(null);
  }, [commitAnnotations]);

  const handleRestoreOriginal = useCallback((id: string) => {
    commitAnnotations(annotationsRef.current.filter((a) => a.id !== id && a.id !== id + TEXT_COVER_SUFFIX));
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

  // A customer's copy links back to that customer's page
  const navigate = useNavigate();
  const handleOpenCustomer = useCallback(async (customerId: string) => {
    if ((isDirty || isSaving) && !(await handleSave(true))) return;
    navigate(`/app/customers/${customerId}`);
  }, [isDirty, isSaving, handleSave, navigate]);

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
      // Escape = back to select tool -- unless it's closing a dialog or menu,
      // or leaving a field (a crop margin, a search box)
      const inOverlay = !!(e.target as HTMLElement | null)?.closest?.(
        '.ant-modal-wrap, .ant-drawer, .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown',
      );
      if (e.key === 'Escape' && !isTyping && !inOverlay) {
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
  const [customerCopiesOpen, setCustomerCopiesOpen] = useState(false);

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

  // Redaction marks never reach a download: say so before one leaves with
  // marks still unapplied
  const confirmUnappliedMarks = useCallback(() => {
    const marks = annotationsRef.current.filter((a) => a.type === 'redact').length;
    if (!marks) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: 'Redactions aren’t applied yet',
        content: `${marks} marked area${marks === 1 ? ' is' : 's are'} still readable in the download. `
          + 'Apply redactions first to remove what’s under them.',
        okText: 'Download anyway',
        cancelText: 'Go back',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [modal]);

  const handleExport = useCallback(async () => {
    if (!(await confirmUnappliedMarks())) return;
    if ((isDirty || isSaving) && !(await handleSave(true))) return;
    try {
      downloadBlob(await pdfEditorApi.downloadDocument(documentId, true));
    } catch {
      message.error('Export failed');
    }
  }, [documentId, isDirty, isSaving, message, handleSave, downloadBlob, confirmUnappliedMarks]);

  const handleExportOriginal = useCallback(async () => {
    try {
      downloadBlob(await pdfEditorApi.downloadDocument(documentId, false), ' (original)');
    } catch {
      message.error('Download failed');
    }
  }, [documentId, message, downloadBlob]);

  // The protected copy includes the edits, so they're saved first
  const beforeProtectedDownload = useCallback(async () => {
    if (!(await confirmUnappliedMarks())) return false;
    return (isDirty || isSaving) ? handleSave(true) : true;
  }, [isDirty, isSaving, handleSave, confirmUnappliedMarks]);

  // ── Page operations ───────────────────────────────────────────────────────
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);

  // The server moves/rotates/drops annotations together with their pages, so
  // unsaved edits are saved first and the editor then takes the server's
  // copy (undo history no longer matches the pages, so it's cleared).
  // `operation` may resolve null (the user cancelled, e.g. a password
  // prompt). Resolves whether the operation went through.
  const runPageOperation = useCallback(async (
    label: string,
    operation: () => Promise<PdfDocument | null>,
    pageAfter?: (updated: PdfDocument) => number,
  ): Promise<boolean> => {
    if ((isDirty || isSaving) && !(await handleSave(true))) return false;
    pageOpRef.current = true;
    setPageOpBusy(true);
    try {
      const updated = await operation();
      if (!updated) return false;
      setCropUndo(null);
      queryClient.setQueryData(['pdf-document', documentId], updated);
      const fresh = updated.annotations ?? [];
      annotationsRef.current = fresh;
      setAnnotations(fresh);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedAnnotationId(null);
      setIsDirty(false);
      if (pageAfter) setCurrentPage(Math.max(1, Math.min(pageAfter(updated), updated.pageCount)));
      return true;
    } catch (err) {
      const detail = apiErrorMessage(err, '');
      message.error(detail ? `${label} failed: ${detail}` : `${label} failed`);
      return false;
    } finally {
      pageOpRef.current = false;
      setPageOpBusy(false);
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

  // Insert pages: blank, from a file (a protected PDF asks for its
  // password), or from a document -- this one too. Opens the first new page.
  const handleInsert = useCallback((after: number, source: InsertSource) => runPageOperation(
    'Insert',
    () => (source.kind === 'file'
      ? withPdfPassword(
        (password) => pdfEditorApi.insertPages(documentId, after, { ...source, password }),
        source.file.name,
      )
      : pdfEditorApi.insertPages(documentId, after, source)),
    () => after + 1,
  ), [runPageOperation, documentId, withPdfPassword]);

  // Duplicate: each run of pages right after the last of them
  const handleDuplicate = useCallback((pages: number[]) => {
    const sorted = [...pages].sort((a, b) => a - b);
    const last = sorted[sorted.length - 1];
    return runPageOperation(
      'Duplicate',
      () => pdfEditorApi.insertPages(documentId, last, { kind: 'document', documentId, pages: sorted }),
      () => last + 1,
    );
  }, [runPageOperation, documentId]);

  // Switching to another document saves this one first, like going back
  // does. Read through refs: the Open link in a toast outlives this render.
  const unsavedRef = React.useRef(false);
  unsavedRef.current = isDirty || isSaving;
  const saveRef = React.useRef(handleSave);
  saveRef.current = handleSave;
  const openDocument = useCallback(async (id: string) => {
    if (!onOpenDocument) return;
    if (unsavedRef.current && !(await saveRef.current(true))) return;
    onOpenDocument(id);
  }, [onOpenDocument]);

  const openDocumentLink = useCallback((created: PdfDocument) => (
    onOpenDocument ? (
      <>
        {' '}
        <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => openDocument(created.id)}>
          Open
        </Button>
      </>
    ) : null
  ), [onOpenDocument, openDocument]);

  // Extract: new documents from these pages (with their edits); with
  // deleteAfter they also leave this one, which is a page operation
  const handleExtract = useCallback(async (
    pages: number[],
    options: { separate: boolean; deleteAfter: boolean; name?: string },
  ): Promise<boolean> => {
    let created: PdfDocument[] = [];
    const extract = async () => {
      const result = await pdfEditorApi.extractPages(documentId, pages, options);
      created = result.documents;
      return result.source;
    };
    let ok: boolean;
    if (options.deleteAfter) {
      // Stay on the page being viewed, as deleting pages does
      ok = await runPageOperation('Extract', extract, () => currentPage - pages.filter((p) => p < currentPage).length);
    } else {
      if ((isDirty || isSaving) && !(await handleSave(true))) return false;
      try {
        await extract();
        ok = true;
      } catch (err) {
        message.error(`Extract failed${apiErrorMessage(err, '') ? `: ${apiErrorMessage(err, '')}` : ''}`);
        ok = false;
      }
    }
    if (ok && created.length) {
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      message.success(
        <span>
          {created.length === 1
            ? <>Extracted to &ldquo;{created[0].name}&rdquo;.</>
            : <>Extracted into {created.length} documents.</>}
          {created.length === 1 && openDocumentLink(created[0])}
        </span>,
        6,
      );
    }
    return ok;
  }, [documentId, runPageOperation, currentPage, isDirty, isSaving, handleSave, message, queryClient, openDocumentLink]);

  // Crop: the same margins on each chosen page, as the pages are shown.
  // A crop, or removing one, can be undone: from the toast it shows, or
  // with Undo (Ctrl+Z) once the edits made after it are undone.
  const offerCropUndo = useCallback((previous: CropBoxes, done: string) => {
    const pages = Object.keys(previous);
    if (!pages.length) return;
    setCropUndo(previous);
    message.success({
      key: 'crop-undo',
      content: (
        <span>
          {done} {pages.length === 1 ? `page ${pages[0]}` : `${pages.length} pages`}.{' '}
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => {
              message.destroy('crop-undo');
              cropUndoRef.current();
            }}
          >
            Undo
          </Button>
        </span>
      ),
      duration: 8,
    });
  }, [message]);

  const runCrop = useCallback(async (
    label: string,
    options: Parameters<typeof pdfEditorApi.cropPages>[1],
  ): Promise<CropBoxes | null> => {
    let previous: CropBoxes = {};
    const ok = await runPageOperation(label, async () => {
      const result = await pdfEditorApi.cropPages(documentId, options);
      previous = result.previousCropBoxes;
      return result;
    });
    return ok ? previous : null;
  }, [runPageOperation, documentId]);

  const handleCropApply = useCallback(async (margins: CropMargins, pages: number[] | undefined) => {
    const previous = await runCrop('Crop', { pageNumbers: pages, margins });
    if (!previous) return;
    setActiveTool('select');
    offerCropUndo(previous, 'Cropped');
  }, [runCrop, offerCropUndo]);

  const handleCropReset = useCallback(async (pages: number[] | undefined) => {
    const previous = await runCrop('Remove crop', { pageNumbers: pages, reset: true });
    if (!previous) return;
    setCropRect(null);
    offerCropUndo(previous, 'Removed the crop on');
  }, [runCrop, offerCropUndo]);

  // Put back what the pages showed before the last crop
  const handleCropUndo = useCallback(async () => {
    if (!cropUndo || pageOpRef.current) return;
    if (await runCrop('Undo crop', { boxes: cropUndo })) {
      setCropRect(null);
      message.success('Crop undone');
    }
  }, [cropUndo, runCrop, message]);
  cropUndoRef.current = handleCropUndo;

  // Combine files: a new document, opened right away when possible
  const combineMutation = useMutation({
    mutationFn: ({ ids, name }: { ids: string[]; name: string }) => pdfEditorApi.mergeDocuments(ids, name),
    onSuccess: (merged) => {
      setCombineOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pdf-editor-documents'] });
      if (onOpenDocument) {
        openDocument(merged.id);
      } else {
        message.success(<span>Combined into &ldquo;{merged.name}&rdquo;.</span>);
      }
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Combine failed')),
  });

  const handleCombine = useCallback(async (ids: string[], name: string) => {
    // The open document goes in with its latest edits
    if (ids.includes(documentId) && (isDirty || isSaving) && !(await handleSave(true))) return;
    combineMutation.mutate({ ids, name });
  }, [documentId, isDirty, isSaving, handleSave, combineMutation]);

  // ── Redact ────────────────────────────────────────────────────────────────
  const redactMarks = annotations.filter((a) => a.type === 'redact');

  const addMarks = useCallback((boxes: Omit<Annotation, 'id' | 'type' | 'content' | 'style'>[]) => {
    if (!boxes.length) return;
    const marks: Annotation[] = boxes.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      type: 'redact',
      content: '',
      style: {},
    }));
    commitAnnotations([...annotationsRef.current, ...marks]);
  }, [commitAnnotations]);

  const handleMarkMatches = useCallback((matches: TextSearchMatch[]) => {
    addMarks(matches.flatMap((m) => m.boxes.map((box) => ({ ...box, page: m.page }))));
    const pages = new Set(matches.map((m) => m.page));
    message.success(
      `Marked ${matches.length} result${matches.length === 1 ? '' : 's'} on ${pages.size} page${pages.size === 1 ? '' : 's'}`,
    );
    setActiveTool('redact');
  }, [addMarks, message]);

  const handleMarkPage = useCallback(() => {
    // The page's size in page units, with a point to spare at each edge
    const w = canvasSize.width / zoom;
    const h = canvasSize.height / zoom;
    if (!w || !h) return;
    addMarks([{ page: currentPage, x: w / 2, y: h / 2, width: w + 2, height: h + 2, rotation: 0 }]);
  }, [addMarks, canvasSize, zoom, currentPage]);

  const handleClearMarks = useCallback(() => {
    commitAnnotations(annotationsRef.current.filter((a) => a.type !== 'redact'));
    setSelectedAnnotationId(null);
  }, [commitAnnotations]);

  const handleApplyRedactions = useCallback(async (options: RedactApplyOptions) => {
    let removedImages = 0;
    const ok = await runPageOperation('Redact', async () => {
      const result = await pdfEditorApi.applyRedactions(documentId, options);
      removedImages = result.removedImages;
      return result.document;
    });
    if (!ok) return;
    setActiveTool('select');
    message.success('Redactions applied. What was under them is gone from the PDF.');
    if (removedImages) {
      message.warning(
        `${removedImages} image${removedImages === 1 ? '' : 's'} under a marked area couldn’t be `
        + 'partly blacked out and were removed whole.',
        8,
      );
    }
  }, [runPageOperation, documentId, message]);

  // ── All tools menu (Acrobat's Edit panel) ─────────────────────────────────
  const handleToolsAction = useCallback((action: ToolsMenuAction) => {
    switch (action) {
      case 'edit': setOrganizeOpen(false); setActiveTool('edit_text'); break;
      case 'crop': setOrganizeOpen(false); setActiveTool('crop'); break;
      case 'redact': setOrganizeOpen(false); setActiveTool('redact'); break;
      case 'organize':
      case 'reorder':
      case 'rotate':
        setActiveTool('select');
        setOrganizeOpen(true);
        break;
      case 'insert': setInsertAfter(currentPage); break;
      case 'extract': setExtractPages([currentPage]); break;
      case 'combine': setCombineOpen(true); break;
      case 'protect': setProtectOpen(true); break;
    }
  }, [currentPage]);

  // ── Derived values ────────────────────────────────────────────────────────
  const pageCount = doc?.pageCount ?? 1;
  const docName = doc?.name ?? 'Loading...';
  // A customer's copy is sent to that customer, their details filled in
  const docCustomer = doc?.customer;
  const signCustomer = useMemo(
    () => (docCustomer
      ? { customerId: docCustomer.id, name: docCustomer.name, email: docCustomer.email ?? undefined }
      : undefined),
    [docCustomer],
  );

  // Never point at a page the document no longer has
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  // Annotations visible on the current page (for AnnotationLayer)
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);
  // Edit covers on this page, each with what it takes off the page
  const pageCovers: PreviewCover[] = useMemo(
    () => pageAnnotations
      .filter((a) => isTextCoverId(a.id))
      .map(({ id, x, y, width, height, rotation }) => ({
        id, x, y, width, height, rotation,
        kind: isImageCover({ id } as Annotation, pageAnnotations) ? 'image' as const : 'text' as const,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotations, currentPage],
  );

  // The page's own images, for Edit to pick up (only while it's on)
  const { data: pageImages = null } = useQuery({
    queryKey: ['pdf-page-images', documentId, currentPage, pdfRefreshKey],
    queryFn: () => pdfEditorApi.listPageImages(documentId, currentPage),
    enabled: activeTool === 'edit_text',
    staleTime: Infinity,
  });

  const selectedAnnotation = selectedAnnotationId
    ? annotations.find((a) => a.id === selectedAnnotationId) ?? null
    : null;
  const selectedIsReplacement = !!selectedAnnotationId
    && annotations.some((a) => a.id === selectedAnnotationId + TEXT_COVER_SUFFIX);
  // The page in page units, for crop
  const pageSize = { width: canvasSize.width / canvasSize.zoom, height: canvasSize.height / canvasSize.zoom };
  // Until the first page is drawn the canvas is a blank 300×150, not a page,
  // so there's no page card to show yet
  const pageDrawn = canvasSize.width > 0;

  // ── Phone: the page fitted to the screen, pinched to zoom ────────────────
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [viewerWidth, setViewerWidth] = useState(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const observer = new ResizeObserver(() => setViewerWidth(viewer.clientWidth));
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [organizeOpen]);
  // A phone shows the page as wide as the screen -- the next page too, or
  // the phone turned -- until it's zoomed
  const [fitWidth, setFitWidth] = useState(true);
  const fitZoom = isMobile && viewerWidth > 0 && pageSize.width > 0
    ? Math.floor(((viewerWidth - 2 * MOBILE_PAGE_GUTTER) / pageSize.width) * 100) / 100
    : null;
  useEffect(() => {
    // A step off is fitted already: each zoom draws the page a pixel wider
    // or narrower, which can tip the fit a step either way
    if (fitWidth && fitZoom && Math.abs(fitZoom - zoom) > 0.015) setZoom(fitZoom);
  }, [fitWidth, fitZoom, zoom]);
  const clampZoom = useCallback(
    (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100))) / 100,
    [],
  );
  const pinch = usePinchZoom({
    viewerRef,
    pageRef,
    zoom,
    clamp: clampZoom,
    onZoom: (next) => {
      // Pinched smaller than the screen's width: fitted to it again
      if (fitZoom && next <= fitZoom) {
        setFitWidth(true);
        setZoom(fitZoom);
        return fitZoom;
      }
      const z = clampZoom(next);
      setFitWidth(false);
      setZoom(z);
      return z;
    },
  });
  const tip = useHoverTip();
  // Shown only if the page takes a while: a page turn is quicker
  const pageSpinner = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <Spin delay={400} />
    </div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // A phone's browser bars cover the bottom of 100vh
        height: isMobile ? '100dvh' : '100vh',
        overflow: 'hidden',
        background: colors.bgLight,
      }}
    >
      {/* Toolbar – full width */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={(tool) => {
          // A tool works on the page, so it leaves the page organizer
          setOrganizeOpen(false);
          setActiveTool(tool);
        }}
        zoom={Math.round(zoom * 100)}
        onZoomChange={(pct) => {
          setFitWidth(false);
          setZoom(pct / 100);
        }}
        currentPage={currentPage}
        pageCount={pageCount}
        onPageChange={setCurrentPage}
        canUndo={undoStack.length > 0 || !!cropUndo}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        showNav={!isMobile}
        onSave={() => handleSave()}
        onExport={handleExport}
        onExportOriginal={handleExportOriginal}
        onExportProtected={() => setProtectOpen(true)}
        isSaving={isSaving}
        isDirty={isDirty}
        documentName={docName}
        onBack={handleBack}
        headerMenu={<ToolsMenu onAction={handleToolsAction} compact={isMobile} />}
        headerActions={
          <>
            {isMobile && selectedAnnotation && (
              <Button
                icon={<SlidersOutlined />}
                onClick={() => setMobilePropsOpen(true)}
                size="small"
                style={headerButtonStyle}
                aria-label="Edit selected element"
              >
                Edit
              </Button>
            )}
            {/* Standalone editor only (it can open another document): the
                customer this copy is for, or copies of it for customers.
                Icon-only on mobile so the row fits. */}
            {onOpenDocument && doc?.customer && (
              <Tooltip {...tip} title={`Open ${doc.customer.name}'s customer page`}>
                <Button
                  icon={<UserOutlined />}
                  onClick={() => handleOpenCustomer(doc.customer!.id)}
                  size="small"
                  style={{ ...headerButtonStyle, maxWidth: 200 }}
                  aria-label={`Customer: ${doc.customer.name}`}
                >
                  {!isMobile && (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.customer.name}</span>
                  )}
                </Button>
              </Tooltip>
            )}
            {onOpenDocument && doc && !doc.customerId && (
              <Button
                icon={<TeamOutlined />}
                onClick={() => setCustomerCopiesOpen(true)}
                size="small"
                style={headerButtonStyle}
                aria-label="Copy for customers"
              >
                {!isMobile && 'Copy for Customers'}
              </Button>
            )}
            <Button
              onClick={() => setFieldMappingOpen(true)}
              size="small"
              style={headerButtonStyle}
            >
              {isMobile ? 'Fields' : 'Define Fields'}
            </Button>
            {/* Icon-only on mobile, like Save / Export, so the row fits */}
            <Button
              icon={<SendOutlined />}
              onClick={() => setSendForSignOpen(true)}
              size="small"
              style={headerButtonStyle}
              aria-label="Send for Signature"
            >
              {!isMobile && 'Send for Signature'}
            </Button>
          </>
        }
        toolsLeading={
          <Button
            type="text"
            icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              height: isMobile ? 32 : 30,
              padding: isMobile ? '0 6px' : '0 8px',
              fontSize: 12,
              fontFamily: fonts.body,
              color: colors.textSecondary,
              flexShrink: 0,
            }}
            aria-label={sidebarOpen ? 'Hide pages' : 'Show pages'}
            disabled={organizeOpen}
          >
            {!isMobile && 'Pages'}
          </Button>
        }
        drawColor={drawColor}
        drawWidth={drawWidth}
        onDrawColorChange={setDrawColor}
        onDrawWidthChange={setDrawWidth}
        checkSize={checkSize}
        onCheckSizeChange={setCheckSize}
      />

      {/* Mode bars: edit / crop / redact */}
      {activeTool === 'edit_text' && !organizeOpen && (
        <EditBar onDone={() => setActiveTool('select')} compact={isMobile} />
      )}
      {activeTool === 'crop' && !organizeOpen && (
        <CropBar
          pageWidth={pageSize.width}
          pageHeight={pageSize.height}
          rect={cropRect}
          onRectChange={setCropRect}
          currentPage={currentPage}
          pageCount={pageCount}
          busy={pageOpBusy}
          onApply={handleCropApply}
          onReset={handleCropReset}
          onCancel={() => setActiveTool('select')}
        />
      )}
      {(activeTool === 'redact' || redactMarks.length > 0) && !organizeOpen && (
        <RedactBar
          active={activeTool === 'redact'}
          markCount={redactMarks.length}
          busy={pageOpBusy}
          onToggle={() => setActiveTool(activeTool === 'redact' ? 'select' : 'redact')}
          onFindText={() => setRedactSearchOpen(true)}
          onMarkPage={handleMarkPage}
          onClearMarks={handleClearMarks}
          onApply={handleApplyRedactions}
        />
      )}

      {/* Organize pages: the page grid in place of the editor */}
      {organizeOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: colors.bgLight }}>
          <OrganizePagesView
            documentId={documentId}
            documentName={docName}
            pageCount={pageCount}
            currentPage={currentPage}
            refreshKey={pdfRefreshKey}
            busy={pageOpBusy}
            onClose={() => setOrganizeOpen(false)}
            onOpenPage={(page) => {
              setCurrentPage(page);
              setOrganizeOpen(false);
            }}
            onReorder={handlePagesReorder}
            onRotate={handlePagesRotate}
            onDelete={handlePagesDelete}
            onDuplicate={handleDuplicate}
            onInsert={(after) => setInsertAfter(after)}
            onExtract={(pages) => setExtractPages(pages)}
          />
        </div>
      ) : (
      /* Three-column body */
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
              onOrganize={() => {
                setActiveTool('select');
                setOrganizeOpen(true);
              }}
              onInsertAfter={(page) => setInsertAfter(page)}
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
          ref={viewerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#e5e7eb',
            display: 'flex',
            alignItems: 'flex-start',
            padding: isMobile
              ? `12px ${MOBILE_PAGE_GUTTER}px calc(${PAGE_NAV_BAR_CLEARANCE}px + env(safe-area-inset-bottom))`
              : '24px 16px',
            WebkitOverflowScrolling: 'touch',
            // Fingers scroll it; a pinch zooms the editor, not the browser
            touchAction: 'pan-x pan-y',
            position: 'relative',
          }}
        >
          <div
            ref={pageRef}
            style={{
              position: 'relative',
              display: 'inline-block',
              // Centered while it fits; wider, it scrolls from its left edge
              margin: '0 auto',
              boxShadow: pageDrawn ? '0 4px 24px rgba(0,0,0,0.12)' : 'none',
              borderRadius: 4,
              background: pageDrawn ? '#fff' : 'transparent',
              // A page loading into a fresh canvas (back from Organize
              // pages) holds the last page's size instead of a blank canvas's
              ...(!isPdfPageReady && pageDrawn
                ? { minWidth: canvasSize.width, minHeight: canvasSize.height }
                : {}),
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
              onCanvasResize={(w, h, drawnAt) => {
                setCanvasSize({ width: w, height: h, zoom: drawnAt });
                pinch.pageDrawn(drawnAt);
              }}
              onPageReady={setIsPdfPageReady}
              onTextLayer={setTextLayer}
              textCovers={pageCovers}
              onCoversErased={setErasedCoverIds}
            />
            {pageDrawn && canvasSize.height > 0 && (
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
                  textLayer={textLayer}
                  erasedCoverIds={erasedCoverIds}
                  onTextReplace={handleTextReplace}
                  pageImages={activeTool === 'edit_text' ? pageImages : null}
                  onImagePick={handleImagePick}
                />
              </div>
            )}
            {activeTool === 'crop' && isPdfPageReady && pageDrawn && (
              <CropOverlay
                pageWidth={pageSize.width}
                pageHeight={pageSize.height}
                zoom={zoom}
                rect={cropRect}
                onChange={setCropRect}
              />
            )}
            {!isPdfPageReady && pageDrawn && pageSpinner}
          </div>
          {/* The first page: no card yet, so the spinner centers in the viewer */}
          {!isPdfPageReady && !pageDrawn && pageSpinner}
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
              onRestoreOriginal={selectedIsReplacement ? handleRestoreOriginal : undefined}
            />
          </div>
        )}

        {/* Undo and the page arrows – over the page on a phone */}
        {isMobile && (
          <PageNavBar
            canUndo={undoStack.length > 0 || !!cropUndo}
            canRedo={redoStack.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            currentPage={currentPage}
            pageCount={pageCount}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
      )}

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
            fullWidth
            selectedAnnotation={selectedAnnotation}
            onAnnotationUpdate={handleAnnotationQuickUpdate}
            onAnnotationDelete={(id) => {
              handleAnnotationDelete(id);
              setMobilePropsOpen(false);
            }}
            onBringToFront={handleBringToFront}
            onSendToBack={handleSendToBack}
            onRestoreOriginal={selectedIsReplacement ? (id) => {
              handleRestoreOriginal(id);
              setMobilePropsOpen(false);
            } : undefined}
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
        initialCustomer={signCustomer}
      />

      {/* Copies of this document for customers */}
      {onOpenDocument && (
        <CustomerCopiesModal
          open={customerCopiesOpen}
          onClose={() => setCustomerCopiesOpen(false)}
          document={doc ?? null}
          onOpenDocument={async (id) => {
            setCustomerCopiesOpen(false);
            if ((isDirty || isSaving) && !(await handleSave(true))) return;
            onOpenDocument(id);
          }}
        />
      )}

      {/* Sign (insert own signature) Modal */}
      <SignatureModal
        open={signModalOpen}
        onClose={() => setSignModalOpen(false)}
        onInsert={handleSignInsert}
      />

      {/* Page tools */}
      <InsertPagesModal
        open={insertAfter !== null}
        onClose={() => setInsertAfter(null)}
        documentId={documentId}
        pageCount={pageCount}
        defaultAfter={insertAfter ?? currentPage}
        onInsert={handleInsert}
      />
      <ExtractPagesModal
        open={extractPages !== null}
        onClose={() => setExtractPages(null)}
        pageCount={pageCount}
        documentName={docName}
        defaultPages={extractPages ?? [currentPage]}
        onExtract={handleExtract}
      />
      <MergeModal
        open={combineOpen}
        onClose={() => setCombineOpen(false)}
        onMerge={handleCombine}
        merging={combineMutation.isPending}
        initialDocumentIds={[documentId]}
        title="Combine files"
      />
      <ProtectModal
        open={protectOpen}
        onClose={() => setProtectOpen(false)}
        documentId={documentId}
        documentName={docName}
        beforeDownload={beforeProtectedDownload}
      />
      <RedactSearchModal
        open={redactSearchOpen}
        onClose={() => setRedactSearchOpen(false)}
        documentId={documentId}
        onMark={handleMarkMatches}
        onGoToPage={setCurrentPage}
      />
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const PdfEditorTool: React.FC<ToolComponentProps> = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('editor');
  // The open document lives in the URL (?doc=), so other pages (a customer's
  // documents) can link straight into the editor and a reload keeps it open.
  // Opened from such a page, its `returnTo` state is where Back goes.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const editingDocumentId = searchParams.get('doc');
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const setEditingDocumentId = useCallback((id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('doc', id);
      else next.delete('doc');
      return next;
    }, { state: location.state });
  }, [setSearchParams, location.state]);
  const closeEditor = useCallback(() => {
    if (returnTo) navigate(returnTo);
    else setEditingDocumentId(null);
  }, [returnTo, navigate, setEditingDocumentId]);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<ImportTabKey>('estimates');
  const [signRequestDetailId, setSignRequestDetailId] = useState<string | null>(null);

  // An open document gets the whole window, as in Acrobat: no app sidebar
  // or header around the editor
  useFocusMode(!!editingDocumentId);

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
    [queryClient, setEditingDocumentId],
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
        key={editingDocumentId}
        documentId={editingDocumentId}
        onBack={closeEditor}
        onOpenDocument={setEditingDocumentId}
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
