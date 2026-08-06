/**
 * ScopeIt - Company Documents Settings Tab
 *
 * Allows users to upload, browse, edit, and delete company document templates
 * (contracts, W9s, insurance certificates, scope templates, warranties, etc.)
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Button,
  Table,
  Input,
  Select,
  Modal,
  Form,
  Tag,
  App,
  Popconfirm,
  Spin,
  Empty,
  Space,
  Upload,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile, UploadProps, RcFile } from 'antd/es/upload';
import {
  UploadOutlined,
  DownloadOutlined,
  EditOutlined,
  DeleteOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileTextOutlined,
  SearchOutlined,
  PlusOutlined,
  FormOutlined,
  SendOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { pdfEditorApi } from '@/components/features/tools/pdf-editor/pdfEditorApi';
import FieldMappingModal from '@/components/features/tools/pdf-editor/FieldMappingModal';
import SendForSignModal from '@/components/features/tools/pdf-editor/SendForSignModal';
import type { CompanyDocument, PdfDocument } from '@/components/features/tools/pdf-editor/types';
import { useTools } from '@/hooks/useTools';
import { colors, fonts } from '@/styles/theme';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'contract', label: 'Contract' },
  { value: 'w9', label: 'W-9' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'scope_template', label: 'Scope Template' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'lien_waiver', label: 'Lien Waiver' },
  { value: 'other', label: 'Other' },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCategoryLabel(value: string | null): string {
  if (!value) return 'Other';
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function getFileIcon(mimeType: string): React.ReactNode {
  if (mimeType === 'application/pdf') {
    return <FilePdfOutlined style={{ fontSize: 18, color: colors.textMuted }} />;
  }
  if (mimeType.startsWith('image/')) {
    return <FileImageOutlined style={{ fontSize: 18, color: colors.textMuted }} />;
  }
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return <FileTextOutlined style={{ fontSize: 18, color: colors.textMuted }} />;
  }
  return <FileOutlined style={{ fontSize: 18, color: colors.textMuted }} />;
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

interface EditDocModalProps {
  open: boolean;
  document: CompanyDocument | null;
  onClose: () => void;
  onSave: (values: { name: string; description?: string; category?: string; tags: string[] }) => void;
  saving: boolean;
}

const EditDocModal: React.FC<EditDocModalProps> = ({ open, document, onClose, onSave, saving }) => {
  const [form] = Form.useForm();
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // Sync form when document changes
  React.useEffect(() => {
    if (document && open) {
      form.setFieldsValue({
        name: document.name,
        description: document.description ?? '',
        category: document.category ?? 'other',
      });
      setTags(document.tags ?? []);
    }
  }, [document, open, form]);

  const handleClose = () => {
    form.resetFields();
    setTagInput('');
    setTags([]);
    onClose();
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onSave({ ...values, tags });
    } catch {
      // validation error - do nothing
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <Modal
      title="Edit Document"
      open={open}
      onOk={handleOk}
      onCancel={handleClose}
      okText="Save Changes"
      okButtonProps={{ style: { background: colors.primary }, loading: saving }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
        <Form.Item
          name="name"
          label="Document Name"
          rules={[{ required: true, message: 'Please enter a name' }]}
        >
          <Input placeholder="e.g., Roofing Contract 2024" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional description" />
        </Form.Item>

        <Form.Item name="category" label="Category">
          <Select options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
        </Form.Item>

        <Form.Item label="Tags">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {tags.map((tag) => (
              <Tag
                key={tag}
                closable
                onClose={() => removeTag(tag)}
                style={{
                  borderRadius: 4,
                  fontSize: 12,
                  background: colors.bgLight,
                  borderColor: colors.border,
                  color: colors.textSecondary,
                }}
              >
                {tag}
              </Tag>
            ))}
          </div>
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onPressEnter={addTag}
            placeholder="Type a tag and press Enter"
            suffix={
              <Button type="link" size="small" onClick={addTag} style={{ padding: 0 }}>
                Add
              </Button>
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ── Upload Modal ──────────────────────────────────────────────────────────────

interface UploadDocModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (
    file: File,
    values: { name: string; description?: string; category?: string; tags: string[] },
  ) => void;
  uploading: boolean;
}

const UploadDocModal: React.FC<UploadDocModalProps> = ({ open, onClose, onUpload, uploading }) => {
  const [form] = Form.useForm();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleClose = () => {
    form.resetFields();
    setSelectedFile(null);
    setTagInput('');
    setTags([]);
    setFileList([]);
    onClose();
  };

  const handleOk = async () => {
    if (!selectedFile) return;
    try {
      const values = await form.validateFields();
      onUpload(selectedFile, { ...values, tags });
    } catch {
      // validation error
    }
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file: RcFile) => {
    setSelectedFile(file);
    setFileList([file as unknown as UploadFile]);
    // Pre-fill name from filename (strip extension)
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    form.setFieldValue('name', nameWithoutExt);
    return false; // prevent auto-upload
  };

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <Modal
      title="Upload Document"
      open={open}
      onOk={handleOk}
      onCancel={handleClose}
      okText="Upload"
      okButtonProps={{
        style: { background: colors.primary },
        loading: uploading,
        disabled: !selectedFile,
      }}
      destroyOnHidden
    >
      <div style={{ marginTop: 24 }}>
        {/* File picker */}
        <Upload
          accept={ACCEPTED_MIME_TYPES.join(',')}
          beforeUpload={beforeUpload}
          fileList={fileList}
          onRemove={() => {
            setSelectedFile(null);
            setFileList([]);
            form.setFieldValue('name', '');
          }}
          maxCount={1}
        >
          <Button icon={<UploadOutlined />} style={{ marginBottom: 20, width: '100%' }}>
            {selectedFile ? 'Change File' : 'Select File (PDF, DOCX, Image)'}
          </Button>
        </Upload>

        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Document Name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input placeholder="e.g., Roofing Contract 2024" />
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>

          <Form.Item name="category" label="Category" initialValue="other">
            <Select options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          </Form.Item>

          <Form.Item label="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {tags.map((tag) => (
                <Tag
                  key={tag}
                  closable
                  onClose={() => removeTag(tag)}
                  style={{
                    borderRadius: 4,
                    fontSize: 12,
                    background: colors.bgLight,
                    borderColor: colors.border,
                    color: colors.textSecondary,
                  }}
                >
                  {tag}
                </Tag>
              ))}
            </div>
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onPressEnter={addTag}
              placeholder="Type a tag and press Enter"
              suffix={
                <Button type="link" size="small" onClick={addTag} style={{ padding: 0 }}>
                  Add
                </Button>
              }
            />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
};

// ── Thumbnail Cell ────────────────────────────────────────────────────────────

interface ThumbnailProps {
  doc: CompanyDocument;
}

const DocThumbnail: React.FC<ThumbnailProps> = ({ doc }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!doc.thumbnailUrl) return;
    let cancelled = false;
    let url: string | null = null;

    pdfEditorApi
      .getCompanyDocThumbnail(doc.id)
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
        alt=""
        onError={() => setImgError(true)}
        style={{
          width: 36,
          height: 36,
          objectFit: 'cover',
          borderRadius: 4,
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
        height: 36,
        borderRadius: 4,
        border: `1px solid ${colors.border}`,
        background: colors.bgLight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {getFileIcon(doc.mimeType)}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const CompanyDocumentsSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  // Filter state
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);

  // Modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<CompanyDocument | null>(null);

  // E-signature: field mapping / send, via the persistent linked PdfDocument
  const [fieldMappingTarget, setFieldMappingTarget] = useState<PdfDocument | null>(null);
  const [sendForSignTarget, setSendForSignTarget] = useState<PdfDocument | null>(null);
  const [resolvingFieldsDocId, setResolvingFieldsDocId] = useState<string | null>(null);
  const [resolvingSendDocId, setResolvingSendDocId] = useState<string | null>(null);

  const { data: tools } = useTools();
  const pdfEditorTool = tools?.find((t) => t.id === 'pdf_editor');
  const canESign = pdfEditorTool?.hasAccess ?? true; // default open while tools are loading

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['company-documents', search, categoryFilter],
    queryFn: () => pdfEditorApi.listCompanyDocs(0, 100, search || undefined, categoryFilter),
    staleTime: 30_000,
  });

  const documents = data?.items ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      name,
      description,
      category,
      tags,
    }: {
      file: File;
      name: string;
      description?: string;
      category?: string;
      tags: string[];
    }) => pdfEditorApi.uploadCompanyDoc(file, name, description, category, tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-documents'] });
      message.success('Document uploaded');
      setUploadModalOpen(false);
    },
    onError: () => {
      message.error('Failed to upload document');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; description?: string; category?: string; tags?: string[] };
    }) => pdfEditorApi.updateCompanyDoc(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-documents'] });
      message.success('Document updated');
      setEditModalOpen(false);
      setEditingDoc(null);
    },
    onError: () => {
      message.error('Failed to update document');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pdfEditorApi.deleteCompanyDoc(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-documents'] });
      message.success('Document deleted');
    },
    onError: () => {
      message.error('Failed to delete document');
    },
  });

  const resolveLinkedDocMutation = useMutation({
    mutationFn: (companyDocumentId: string) =>
      pdfEditorApi.getOrCreateLinkedDocument(companyDocumentId),
    onError: () => {
      message.error('Failed to prepare this document for e-signature');
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleDefineFields = useCallback(async (doc: CompanyDocument) => {
    setResolvingFieldsDocId(doc.id);
    try {
      const linked = await resolveLinkedDocMutation.mutateAsync(doc.id);
      setFieldMappingTarget(linked);
    } finally {
      setResolvingFieldsDocId(null);
    }
  }, [resolveLinkedDocMutation]);

  const handleSendForSignature = useCallback(async (doc: CompanyDocument) => {
    setResolvingSendDocId(doc.id);
    try {
      const linked = await resolveLinkedDocMutation.mutateAsync(doc.id);
      setSendForSignTarget(linked);
    } finally {
      setResolvingSendDocId(null);
    }
  }, [resolveLinkedDocMutation]);

  const handleDownload = useCallback(async (doc: CompanyDocument) => {
    try {
      const blob = await pdfEditorApi.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Failed to download document');
    }
  }, [message]);

  const handleEdit = (doc: CompanyDocument) => {
    setEditingDoc(doc);
    setEditModalOpen(true);
  };

  const handleSaveEdit = (values: {
    name: string;
    description?: string;
    category?: string;
    tags: string[];
  }) => {
    if (!editingDoc) return;
    updateMutation.mutate({ id: editingDoc.id, data: values });
  };

  const handleUpload = (
    file: File,
    values: { name: string; description?: string; category?: string; tags: string[] },
  ) => {
    uploadMutation.mutate({ file, ...values });
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const columns: ColumnsType<CompanyDocument> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DocThumbnail doc={record} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 500,
                fontSize: 14,
                color: colors.textPrimary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 260,
              }}
            >
              {record.name}
            </div>
            {record.description && (
              <div
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 260,
                }}
              >
                {record.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (category: string | null) => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            background: colors.bgLight,
            border: `1px solid ${colors.border}`,
            color: colors.textSecondary,
            whiteSpace: 'nowrap',
          }}
        >
          {getCategoryLabel(category)}
        </span>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'fileSize',
      key: 'fileSize',
      width: 90,
      render: (size: number) => (
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>
          {formatFileSize(size)}
        </span>
      ),
    },
    {
      title: 'Pages',
      dataIndex: 'pageCount',
      key: 'pageCount',
      width: 70,
      render: (pages: number) => (
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>
          {pages > 0 ? pages : '—'}
        </span>
      ),
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      width: 180,
      render: (tags: string[]) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(tags ?? []).slice(0, 3).map((tag) => (
            <Tag
              key={tag}
              style={{
                borderRadius: 4,
                fontSize: 11,
                margin: 0,
                background: colors.bgLight,
                borderColor: colors.border,
                color: colors.textMuted,
              }}
            >
              {tag}
            </Tag>
          ))}
          {(tags ?? []).length > 3 && (
            <Tooltip title={(tags ?? []).slice(3).join(', ')}>
              <Tag
                style={{
                  borderRadius: 4,
                  fontSize: 11,
                  margin: 0,
                  background: colors.bgLight,
                  borderColor: colors.border,
                  color: colors.textMuted,
                  cursor: 'default',
                }}
              >
                +{(tags ?? []).length - 3}
              </Tag>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Used',
      dataIndex: 'useCount',
      key: 'useCount',
      width: 60,
      render: (count: number) => (
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>{count ?? 0}</span>
      ),
    },
    {
      title: 'Uploaded',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (date: string) => (
        <span style={{ color: colors.textMuted, fontSize: 13 }}>
          {dayjs(date).format('MMM D, YYYY')}
        </span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_, record) => {
        const fieldsResolving = resolvingFieldsDocId === record.id;
        const sendResolving = resolvingSendDocId === record.id;
        return (
        <Space size={2}>
          <Tooltip title={canESign ? 'Define Fields' : `Requires the ${pdfEditorTool?.requiredPlan ?? 'pro'} plan`}>
            <Button
              type="text"
              size="small"
              icon={canESign ? <FormOutlined style={{ color: colors.textSecondary }} /> : <LockOutlined style={{ color: colors.textMuted }} />}
              loading={fieldsResolving}
              disabled={!canESign}
              onClick={() => handleDefineFields(record)}
            >
              Fields
            </Button>
          </Tooltip>
          <Tooltip title={canESign ? 'Send for Signature' : `Requires the ${pdfEditorTool?.requiredPlan ?? 'pro'} plan`}>
            <Button
              type="text"
              size="small"
              icon={canESign ? <SendOutlined style={{ color: colors.textSecondary }} /> : <LockOutlined style={{ color: colors.textMuted }} />}
              loading={sendResolving}
              disabled={!canESign}
              onClick={() => handleSendForSignature(record)}
            >
              Send
            </Button>
          </Tooltip>
          <Tooltip title="Download">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined style={{ color: colors.textSecondary }} />}
              onClick={() => handleDownload(record)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined style={{ color: colors.textSecondary }} />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete document?"
            description="This action cannot be undone."
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined style={{ color: colors.textSecondary }} />}
                danger
              />
            </Tooltip>
          </Popconfirm>
        </Space>
        );
      },
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: fonts.heading,
              fontSize: 16,
              fontWeight: 600,
              marginBottom: 4,
              color: colors.textPrimary,
            }}
          >
            Company Documents
          </h2>
          <p style={{ color: colors.textSecondary, margin: 0, fontSize: 14 }}>
            Upload and manage reusable document templates — contracts, W-9s, insurance
            certificates, scope templates, and more.
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setUploadModalOpen(true)}
          style={{ background: colors.primary, flexShrink: 0 }}
        >
          Upload Document
        </Button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Input
          prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 240 }}
        />
        <Select
          placeholder="All categories"
          value={categoryFilter}
          onChange={(val) => setCategoryFilter(val)}
          allowClear
          style={{ width: 180 }}
          options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        />
      </div>

      {/* Table */}
      <Spin spinning={isLoading}>
        {!isLoading && documents.length === 0 ? (
          <Empty
            description={
              search || categoryFilter
                ? 'No documents match your filters'
                : 'No documents uploaded yet'
            }
            style={{ padding: '40px 0' }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={documents}
            rowKey="id"
            pagination={
              (data?.total ?? 0) > 20
                ? {
                    total: data?.total,
                    pageSize: 20,
                    showSizeChanger: false,
                    showTotal: (total) => (
                      <span style={{ color: colors.textSecondary, fontSize: 13 }}>
                        {total} document{total !== 1 ? 's' : ''}
                      </span>
                    ),
                  }
                : false
            }
            size="middle"
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          />
        )}
      </Spin>

      {/* Upload Modal */}
      <UploadDocModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUpload={handleUpload}
        uploading={uploadMutation.isPending}
      />

      {/* Edit Modal */}
      <EditDocModal
        open={editModalOpen}
        document={editingDoc}
        onClose={() => {
          setEditModalOpen(false);
          setEditingDoc(null);
        }}
        onSave={handleSaveEdit}
        saving={updateMutation.isPending}
      />

      {/* Define Fields -- operates on the persistent linked PdfDocument,
          so the mapping is reused on every visit to this company document. */}
      {fieldMappingTarget && (
        <FieldMappingModal
          open={!!fieldMappingTarget}
          onClose={() => setFieldMappingTarget(null)}
          documentId={fieldMappingTarget.id}
          documentName={fieldMappingTarget.name}
          pageCount={fieldMappingTarget.pageCount}
          initialFields={fieldMappingTarget.fieldDefinitions}
          onSaved={() => setFieldMappingTarget(null)}
        />
      )}

      {/* Send for Signature -- same linked PdfDocument, so it always sends
          using the fields last saved via Define Fields above. */}
      {sendForSignTarget && (
        <SendForSignModal
          open={!!sendForSignTarget}
          onClose={() => setSendForSignTarget(null)}
          documentId={sendForSignTarget.id}
          documentName={sendForSignTarget.name}
          pageCount={sendForSignTarget.pageCount}
          fieldDefinitions={sendForSignTarget.fieldDefinitions}
        />
      )}
    </div>
  );
};

export default CompanyDocumentsSettings;
