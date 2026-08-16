/**
 * Scopit - Customer Detail Page
 *
 * Shows customer info (editable inline) and all related documents
 * (estimates, invoices, sign requests) in a tabbed layout.
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  Button,
  Tabs,
  Table,
  Tag,
  Typography,
  Spin,
  App,
  Space,
  Modal,
  Popover,
  Tooltip,
  Drawer,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  DeleteOutlined,
  SendOutlined,
  LockOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '@/services/api';
import { colors, fonts, fontSizes, borderRadius, shadows } from '@/styles/theme';
import { useTools } from '@/hooks/useTools';
import RequestSignatureModal from '@/components/features/tools/pdf-editor/RequestSignatureModal';
import SignRequestDetail from '@/components/features/tools/pdf-editor/SignRequestDetail';
import type { CustomerData } from '@/components/features/CustomerSelector';

const { Title, Text } = Typography;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CustomerDetail {
  id: string;
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  notes?: string;
}

interface CustomerFormValues {
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  notes?: string;
}

interface EstimateDoc {
  id: string;
  estimate_number: string;
  status?: string;
  status_label?: string;
  total: number;
  created_at: string;
}

interface InvoiceDoc {
  id: string;
  invoice_number: string;
  status?: string;
  status_label?: string;
  total: number;
  created_at: string;
}

interface SignatureRecipientSummary {
  role: string;
  name: string;
  email: string;
  status: string;
}

interface SignatureDoc {
  id: string;
  document_name?: string;
  recipients: SignatureRecipientSummary[];
  status: string;
  created_at: string;
  sent_at?: string;
  signed_at?: string;
}

interface CustomerDocuments {
  estimates: EstimateDoc[];
  invoices: InvoiceDoc[];
  sign_requests: SignatureDoc[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMoney(value: number): string {
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSignatureTagProps(status: string): { color: string; label: string } {
  switch (status) {
    case 'signed':
      return { color: 'success', label: 'Signed' };
    case 'partially_signed':
      return { color: 'warning', label: 'Partially Signed' };
    case 'declined':
      return { color: 'error', label: 'Declined' };
    case 'expired':
      return { color: 'warning', label: 'Expired' };
    case 'sent':
      return { color: 'processing', label: 'Sent' };
    case 'viewed':
      return { color: 'processing', label: 'Viewed' };
    case 'cancelled':
      return { color: 'default', label: 'Voided' };
    default:
      return { color: 'default', label: capitalizeFirst(status || 'draft') };
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface InfoRowProps {
  label: string;
  value?: string;
  multiline?: boolean;
}

function InfoRow({ label, value, multiline }: InfoRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        marginBottom: 16,
      }}
    >
      <Text
        style={{
          fontSize: fontSizes.xs,
          color: colors.textMuted,
          fontFamily: fonts.body,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: fontSizes.sm,
          color: value ? colors.textPrimary : colors.textMuted,
          fontFamily: fonts.body,
          whiteSpace: multiline ? 'pre-wrap' : undefined,
        }}
      >
        {value || '—'}
      </Text>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [requestSignOpen, setRequestSignOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('estimates');
  const [signDetailId, setSignDetailId] = useState<string | null>(null);
  const [form] = Form.useForm<CustomerFormValues>();

  const { data: tools } = useTools();
  const pdfEditorTool = tools?.find((t) => t.id === 'pdf_editor');
  const canESign = pdfEditorTool?.hasAccess ?? true; // default open while tools are loading

  // Fetch customer
  const {
    data: customer,
    isLoading: isLoadingCustomer,
    error: customerError,
  } = useQuery<CustomerDetail>({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.get<CustomerDetail>(`/customers/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  // Fetch documents
  const { data: documents, isLoading: isLoadingDocs } = useQuery<CustomerDocuments>({
    queryKey: ['customer-documents', id],
    queryFn: async () => {
      const res = await api.get<CustomerDocuments>(`/customers/${id}/documents`);
      return res.data;
    },
    enabled: !!id,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const res = await api.put<CustomerDetail>(`/customers/${id}`, values);
      return res.data;
    },
    onSuccess: () => {
      message.success('Customer updated successfully');
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setIsEditing(false);
    },
    onError: () => {
      message.error('Failed to update customer');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/customers/${id}`);
    },
    onSuccess: () => {
      message.success('Customer deleted');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/app/customers');
    },
    onError: () => {
      message.error('Failed to delete customer');
      setDeleteModalOpen(false);
    },
  });

  const handleEditClick = () => {
    if (customer) {
      form.setFieldsValue({
        name: customer.name,
        contact_name: customer.contact_name,
        email: customer.email,
        phone: customer.phone,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        city: customer.city,
        state: customer.state,
        zipcode: customer.zipcode,
        notes: customer.notes,
      });
    }
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    form.resetFields();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      updateMutation.mutate(values);
    } catch {
      // Validation errors shown inline by Ant Design
    }
  };

  // Closing the sign request detail drawer may follow actions (void, etc.)
  // that change what this page's own Signatures table should show.
  const closeSignDetail = () => {
    setSignDetailId(null);
    queryClient.invalidateQueries({ queryKey: ['customer-documents', id] });
  };

  // ─── Table columns ──────────────────────────────────────────────────────────

  const estimateColumns: ColumnsType<EstimateDoc> = [
    {
      title: 'Number',
      dataIndex: 'estimate_number',
      key: 'estimate_number',
      render: (text: string) => (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
            fontWeight: 600,
            color: colors.textPrimary,
          }}
        >
          {text}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (_: unknown, record: EstimateDoc) => (
        <Tag color="default" style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}>
          {record.status_label || capitalizeFirst(record.status || 'draft')}
        </Tag>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      align: 'right' as const,
      render: (value: number) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textPrimary }}>
          {formatMoney(value)}
        </Text>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
          {formatDate(date)}
        </Text>
      ),
    },
  ];

  const invoiceColumns: ColumnsType<InvoiceDoc> = [
    {
      title: 'Number',
      dataIndex: 'invoice_number',
      key: 'invoice_number',
      render: (text: string) => (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
            fontWeight: 600,
            color: colors.textPrimary,
          }}
        >
          {text}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (_: unknown, record: InvoiceDoc) => (
        <Tag color="default" style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}>
          {record.status_label || capitalizeFirst(record.status || 'draft')}
        </Tag>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      align: 'right' as const,
      render: (value: number) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textPrimary }}>
          {formatMoney(value)}
        </Text>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
          {formatDate(date)}
        </Text>
      ),
    },
  ];

  const signatureColumns: ColumnsType<SignatureDoc> = [
    {
      title: 'Document',
      dataIndex: 'document_name',
      key: 'document_name',
      render: (text: string) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textPrimary }}>
          {text || 'Untitled'}
        </Text>
      ),
    },
    {
      title: 'Recipients',
      key: 'recipient',
      render: (_: unknown, record: SignatureDoc) => {
        const [first, ...rest] = record.recipients ?? [];
        if (!first) return <Text type="secondary" style={{ fontSize: fontSizes.sm }}>—</Text>;
        const content = (
          <div>
            {record.recipients.map((r) => (
              <div key={`${r.email}-${r.role}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: fontSizes.xs, fontFamily: fonts.body, padding: '2px 0' }}>
                <span style={{ color: colors.textPrimary }}>{r.name} <span style={{ color: colors.textMuted }}>({r.role})</span></span>
                <Tag color={getSignatureTagProps(r.status).color} style={{ margin: 0, fontSize: 11 }}>
                  {getSignatureTagProps(r.status).label}
                </Tag>
              </div>
            ))}
          </div>
        );
        return (
          <div>
            <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textPrimary, display: 'block' }}>
              {first.name}
              {rest.length > 0 && (
                <Popover content={content} title="Recipients" trigger="hover">
                  <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, marginLeft: 6, cursor: 'default' }}>
                    +{rest.length} more
                  </Text>
                </Popover>
              )}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}>
              {first.email}
            </Text>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: string) => {
        const { color, label } = getSignatureTagProps(status);
        return (
          <Tag color={color} style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}>
            {label}
          </Tag>
        );
      },
    },
    {
      title: 'Sent',
      dataIndex: 'sent_at',
      key: 'sent_at',
      width: 110,
      render: (date: string | null) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
          {date ? formatDate(date) : '—'}
        </Text>
      ),
    },
    {
      title: 'Signed',
      dataIndex: 'signed_at',
      key: 'signed_at',
      width: 110,
      render: (date: string | null) => (
        <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
          {date ? formatDate(date) : '—'}
        </Text>
      ),
    },
  ];

  // ─── Counts for tab labels ──────────────────────────────────────────────────

  const estimateCount = documents?.estimates?.length ?? 0;
  const invoiceCount = documents?.invoices?.length ?? 0;
  const signatureCount = documents?.sign_requests?.length ?? 0;

  const tabItems = [
    {
      key: 'estimates',
      label: `Estimates${estimateCount > 0 ? ` (${estimateCount})` : ''}`,
      children: (
        <Table<EstimateDoc>
          columns={estimateColumns}
          dataSource={documents?.estimates || []}
          rowKey="id"
          size="middle"
          loading={isLoadingDocs}
          pagination={false}
          onRow={(record) => ({
            onClick: () => navigate(`/app/estimates/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: (
              <div style={{ padding: '32px 0', color: colors.textMuted, fontFamily: fonts.body, fontSize: fontSizes.sm }}>
                No estimates found
              </div>
            ),
          }}
          style={{ fontFamily: fonts.body }}
        />
      ),
    },
    {
      key: 'invoices',
      label: `Invoices${invoiceCount > 0 ? ` (${invoiceCount})` : ''}`,
      children: (
        <Table<InvoiceDoc>
          columns={invoiceColumns}
          dataSource={documents?.invoices || []}
          rowKey="id"
          size="middle"
          loading={isLoadingDocs}
          pagination={false}
          onRow={(record) => ({
            onClick: () => navigate(`/app/invoices/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: (
              <div style={{ padding: '32px 0', color: colors.textMuted, fontFamily: fonts.body, fontSize: fontSizes.sm }}>
                No invoices found
              </div>
            ),
          }}
          style={{ fontFamily: fonts.body }}
        />
      ),
    },
    {
      key: 'signatures',
      label: `Signatures${signatureCount > 0 ? ` (${signatureCount})` : ''}`,
      children: (
        <Table<SignatureDoc>
          columns={signatureColumns}
          dataSource={documents?.sign_requests || []}
          rowKey="id"
          size="middle"
          loading={isLoadingDocs}
          pagination={false}
          onRow={(record) => ({
            onClick: () => setSignDetailId(record.id),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText: (
              <div style={{ padding: '32px 0', color: colors.textMuted, fontFamily: fonts.body, fontSize: fontSizes.sm }}>
                No sign requests found
              </div>
            ),
          }}
          style={{ fontFamily: fonts.body }}
        />
      ),
    },
  ];

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (isLoadingCustomer) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  // ─── 404 / error state ──────────────────────────────────────────────────────

  if (customerError || !customer) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
          gap: 16,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.heading,
            fontSize: fontSizes.xl,
            fontWeight: 600,
            color: colors.textPrimary,
          }}
        >
          Customer not found
        </Text>
        <Text style={{ fontFamily: fonts.body, color: colors.textSecondary }}>
          This customer may have been deleted or you don't have access to it.
        </Text>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/app/customers')}
          style={{ fontFamily: fonts.body }}
        >
          Back to Customers
        </Button>
      </div>
    );
  }

  const customerData: CustomerData = {
    customerId: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.address_line1,
    addressLine2: customer.address_line2,
    city: customer.city,
    state: customer.state,
    zipcode: customer.zipcode,
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: fonts.body }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/app/customers')}
            style={{
              color: colors.textSecondary,
              fontFamily: fonts.body,
              fontSize: fontSizes.sm,
              padding: '4px 8px',
              flexShrink: 0,
            }}
          >
            Customers
          </Button>
          <span style={{ color: colors.border, flexShrink: 0 }}>/</span>
          <Title
            level={4}
            style={{
              margin: 0,
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: colors.textPrimary,
              fontSize: fontSizes.xl,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {customer.name}
          </Title>
        </div>

        <Space size={8}>
          {isEditing ? (
            <>
              <Button
                icon={<CloseOutlined />}
                onClick={handleCancelEdit}
                style={{ fontFamily: fonts.body, borderRadius: borderRadius.base }}
              >
                Cancel
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={updateMutation.isPending}
                onClick={handleSave}
                style={{
                  background: colors.primary,
                  fontFamily: fonts.body,
                  borderRadius: borderRadius.base,
                }}
              >
                Save
              </Button>
            </>
          ) : (
            <>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => setDeleteModalOpen(true)}
                style={{ fontFamily: fonts.body, borderRadius: borderRadius.base }}
              >
                Delete
              </Button>
              <Button
                icon={<EditOutlined />}
                onClick={handleEditClick}
                style={{ fontFamily: fonts.body, borderRadius: borderRadius.base }}
              >
                Edit
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {/* ── Left column: Customer Info ── */}
        <div style={{ width: 360, flexShrink: 0, minWidth: 0 }}>
          <Card
            style={{
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              boxShadow: shadows.sm,
            }}
            styles={{ body: { padding: '24px' } }}
          >
            <Text
              style={{
                display: 'block',
                fontFamily: fonts.heading,
                fontSize: fontSizes.md,
                fontWeight: 600,
                color: colors.textPrimary,
                marginBottom: 20,
              }}
            >
              Customer Info
            </Text>

            {isEditing ? (
              <Form form={form} layout="vertical" style={{ fontFamily: fonts.body }}>
                <Form.Item
                  name="name"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Name
                    </span>
                  }
                  rules={[{ required: true, message: 'Name is required' }]}
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="ABC Corporation" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <Form.Item
                  name="contact_name"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Contact Name
                    </span>
                  }
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="John Smith" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <Form.Item
                  name="email"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Email
                    </span>
                  }
                  rules={[{ type: 'email', message: 'Enter a valid email' }]}
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="john@example.com" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <Form.Item
                  name="phone"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Phone
                    </span>
                  }
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="555-0100" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <Form.Item
                  name="address_line1"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Address Line 1
                    </span>
                  }
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="123 Main St" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <Form.Item
                  name="address_line2"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Apt/Suite/Unit
                    </span>
                  }
                  style={{ marginBottom: 12 }}
                >
                  <Input placeholder="Apt 4B (optional)" style={{ borderRadius: borderRadius.base }} />
                </Form.Item>

                <div style={{ display: 'flex', gap: 10 }}>
                  <Form.Item
                    name="city"
                    label={
                      <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                        City
                      </span>
                    }
                    style={{ flex: 1, marginBottom: 12 }}
                  >
                    <Input placeholder="New York" style={{ borderRadius: borderRadius.base }} />
                  </Form.Item>
                  <Form.Item
                    name="state"
                    label={
                      <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                        State
                      </span>
                    }
                    style={{ width: 76, marginBottom: 12 }}
                  >
                    <Input placeholder="NY" style={{ borderRadius: borderRadius.base }} />
                  </Form.Item>
                  <Form.Item
                    name="zipcode"
                    label={
                      <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                        ZIP
                      </span>
                    }
                    style={{ width: 90, marginBottom: 12 }}
                  >
                    <Input placeholder="10001" style={{ borderRadius: borderRadius.base }} />
                  </Form.Item>
                </div>

                <Form.Item
                  name="notes"
                  label={
                    <span style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textSecondary }}>
                      Notes
                    </span>
                  }
                  style={{ marginBottom: 0 }}
                >
                  <Input.TextArea
                    placeholder="Additional notes about this customer..."
                    autoSize={{ minRows: 10, maxRows: 20 }}
                    style={{ borderRadius: borderRadius.base, resize: 'vertical' }}
                  />
                </Form.Item>
              </Form>
            ) : (
              <div>
                <InfoRow label="Name" value={customer.name} />
                <InfoRow label="Contact Name" value={customer.contact_name} />
                <InfoRow label="Email" value={customer.email} />
                <InfoRow label="Phone" value={customer.phone} />

                {(customer.address_line1 || customer.city) ? (
                  <div style={{ marginBottom: 16 }}>
                    <Text
                      style={{
                        display: 'block',
                        fontSize: fontSizes.xs,
                        color: colors.textMuted,
                        fontFamily: fonts.body,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: 500,
                        marginBottom: 2,
                      }}
                    >
                      Address
                    </Text>
                    {customer.address_line1 && (
                      <Text style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body }}>
                        {customer.address_line1}
                      </Text>
                    )}
                    {customer.address_line2 && (
                      <Text style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body }}>
                        {customer.address_line2}
                      </Text>
                    )}
                    {(customer.city || customer.state || customer.zipcode) && (
                      <Text style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body }}>
                        {[customer.city, customer.state].filter(Boolean).join(', ')}
                        {customer.zipcode ? ` ${customer.zipcode}` : ''}
                      </Text>
                    )}
                  </div>
                ) : (
                  <InfoRow label="Address" value={undefined} />
                )}

                <InfoRow label="Notes" value={customer.notes} multiline />
              </div>
            )}
          </Card>
        </div>

        {/* ── Right column: Documents ── */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <Card
            style={{
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              boxShadow: shadows.sm,
            }}
            styles={{ body: { padding: '0 0 8px' } }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={tabItems}
              style={{ fontFamily: fonts.body }}
              tabBarStyle={{
                padding: '0 24px',
                marginBottom: 0,
                fontFamily: fonts.body,
                fontSize: fontSizes.sm,
              }}
              tabBarExtraContent={
                activeTab === 'signatures' ? (
                  <Tooltip title={canESign ? undefined : `Requires the ${pdfEditorTool?.requiredPlan ?? 'pro'} plan`}>
                    <Button
                      type="primary"
                      icon={canESign ? <SendOutlined /> : <LockOutlined />}
                      disabled={!canESign}
                      onClick={() => setRequestSignOpen(true)}
                      style={{ background: colors.primary, borderColor: colors.primary, fontFamily: fonts.body, borderRadius: borderRadius.base }}
                    >
                      Request Signature
                    </Button>
                  </Tooltip>
                ) : undefined
              }
            />
          </Card>
        </div>
      </div>

      {/* Request Signature -- template picker, hands off into SendForSignModal
          with this customer pre-selected. */}
      <RequestSignatureModal
        open={requestSignOpen}
        onClose={() => setRequestSignOpen(false)}
        customer={customerData}
        onSent={() => {
          queryClient.invalidateQueries({ queryKey: ['customer-documents', id] });
        }}
      />

      {/* Sign request detail -- audit history, reminders, signed-copy email, download */}
      <Drawer
        open={!!signDetailId}
        onClose={closeSignDetail}
        width={640}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        {signDetailId && (
          <SignRequestDetail requestId={signDetailId} onBack={closeSignDetail} showBackButton={false} />
        )}
      </Drawer>

      {/* Delete confirmation modal */}
      <Modal
        title="Delete Customer"
        open={deleteModalOpen}
        onCancel={() => setDeleteModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDeleteModalOpen(false)} style={{ fontFamily: fonts.body }}>
            Cancel
          </Button>,
          <Button
            key="delete"
            danger
            type="primary"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            style={{ fontFamily: fonts.body }}
          >
            Delete
          </Button>,
        ]}
      >
        <p style={{ fontFamily: fonts.body, color: colors.textPrimary }}>
          <strong>{customer.name}</strong> 고객을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
        </p>
      </Modal>
    </div>
  );
}
