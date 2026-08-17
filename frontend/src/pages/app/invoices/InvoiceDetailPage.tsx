/**
 * Scopit - Invoice Detail Page
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Tag, Descriptions, Table, Dropdown, Space, Divider, App, Modal, Form, InputNumber, DatePicker, Select, Input, Tooltip, Spin } from 'antd';
import {
  EditOutlined,
  SendOutlined,
  DownloadOutlined,
  MoreOutlined,
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  DollarOutlined,
  StopOutlined,
  PlusOutlined,
  ExclamationCircleOutlined,
  DownOutlined,
  FileTextOutlined,
  EyeOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import dayjs from 'dayjs';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { invoiceService } from '@/services/invoiceService';
import { getErrorMessage } from '@/services/api';
import { useInvoiceStatuses, getStatusDisplay } from '@/hooks/useSettings';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';
import { useBackNav } from '@/hooks/useHeaderNav';
import type { InvoiceStatus, PaymentMethod, Adjustment, Payment, PdfTemplateInfo } from '@/types/entities';
import { ReceiptPreviewModal } from '@/components/features/ReceiptPreviewModal';

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

const InvoiceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();
  const { message, modal } = App.useApp();
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendForm] = Form.useForm();

  useBackNav('Back to Invoices', '/app/invoices');
  const [receiptPreviewPayment, setReceiptPreviewPayment] = useState<Payment | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentListVisible, setPaymentListVisible] = useState(false);
  const [paymentForm] = Form.useForm();
  const [adjustmentForm] = Form.useForm();

  // Fetch invoice statuses
  const { data: statusConfigs, isLoading: isLoadingStatuses } = useInvoiceStatuses();

  // Fetch PDF templates for receipt preview
  const { data: pdfTemplates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['invoiceTemplates'],
    queryFn: () => invoiceService.getTemplates(),
  });

  // Fetch invoice data
  const { data: invoice, isLoading, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoiceService.getById(id!),
    enabled: !!id,
  });

  // Add adjustment mutation
  const addAdjustmentMutation = useMutation({
    mutationFn: (data: { type: 'premium' | 'discount'; name: string; percentage: number }) =>
      invoiceService.adjustments.add(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      message.success('Adjustment added');
      setAdjustmentModalOpen(false);
      adjustmentForm.resetFields();
    },
    onError: () => {
      message.error('Failed to add adjustment');
    },
  });

  // Delete adjustment mutation
  const deleteAdjustmentMutation = useMutation({
    mutationFn: (adjustmentId: string) => invoiceService.adjustments.delete(id!, adjustmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      message.success('Adjustment deleted');
    },
    onError: () => {
      message.error('Failed to delete adjustment');
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (statusId: string) => invoiceService.updateStatus(id!, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      message.success('Status updated');
    },
    onError: () => {
      message.error('Failed to update status');
    },
  });

  // Send invoice mutation
  const sendMutation = useMutation({
    mutationFn: (data: { toEmail: string; ccEmails?: string[]; message?: string }) =>
      invoiceService.send(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      message.success('Invoice sent');
      setSendModalOpen(false);
      sendForm.resetFields();
    },
    onError: (err) => {
      message.error(getErrorMessage(err));
    },
  });

  // Handlers
  const handleDownloadPdf = async () => {
    try {
      const blob = await invoiceService.getPdf(id!);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice?.invoiceNumber || 'invoice'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('PDF downloaded successfully');
    } catch (error: any) {
      console.error('PDF download error:', error);
      message.error('Failed to download PDF');
    }
  };

  const handleSend = () => {
    sendForm.setFieldsValue({
      toEmail: customerEmail,
    });
    setSendModalOpen(true);
  };

  const handleSendInvoice = (values: { toEmail: string; ccEmails?: string; message?: string }) => {
    sendMutation.mutate({
      toEmail: values.toEmail,
      ccEmails: values.ccEmails
        ? values.ccEmails.split(',').map((e) => e.trim()).filter(Boolean)
        : undefined,
      message: values.message,
    });
  };

  const handleRecordPayment = async (values: any) => {
    try {
      const paymentData = {
        amount: values.amount,
        paymentMethod: values.paymentMethod,
        paymentDate: values.paymentDate ? values.paymentDate.format('YYYY-MM-DD') : undefined,
        referenceNumber: values.referenceNumber,
        notes: values.notes,
      };
      if (editingPayment) {
        await invoiceService.payments.update(id!, editingPayment.id, paymentData);
        message.success('Payment updated successfully');
      } else {
        await invoiceService.payments.record(id!, paymentData);
        message.success('Payment recorded successfully');
      }
      setPaymentModalVisible(false);
      setEditingPayment(null);
      paymentForm.resetFields();
      refetch();
    } catch (error) {
      message.error(editingPayment ? 'Failed to update payment' : 'Failed to record payment');
    }
  };

  const handleEditPayment = (payment: Payment) => {
    setEditingPayment(payment);
    paymentForm.setFieldsValue({
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentDate: payment.paymentDate ? dayjs(payment.paymentDate) : null,
      referenceNumber: payment.referenceNumber,
      notes: payment.notes,
    });
    setPaymentModalVisible(true);
  };

  const handleDeletePayment = async (paymentId: string) => {
    modal.confirm({
      title: 'Delete Payment',
      content: 'Are you sure you want to delete this payment?',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await invoiceService.payments.delete(id!, paymentId);
          message.success('Payment deleted');
          refetch();
        } catch (error) {
          message.error('Failed to delete payment');
        }
      },
    });
  };

  const handleDelete = async () => {
    try {
      await invoiceService.delete(id!);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      message.success('Invoice deleted successfully');
      navigate('/app/invoices');
    } catch (error) {
      message.error('Failed to delete invoice');
    }
  };

  const handleCancel = async () => {
    modal.confirm({
      title: 'Cancel Invoice',
      content: 'Are you sure you want to cancel this invoice? This action cannot be undone.',
      okText: 'Cancel Invoice',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await invoiceService.cancel(id!);
          message.success('Invoice canceled');
          refetch();
        } catch (error) {
          message.error('Failed to cancel invoice');
        }
      },
    });
  };

  const handleAddAdjustment = (values: { type: 'premium' | 'discount'; name: string; percentage: number }) => {
    addAdjustmentMutation.mutate(values);
  };

  const handleDeleteAdjustment = (adjustmentId: string) => {
    modal.confirm({
      title: 'Delete Adjustment',
      icon: <ExclamationCircleOutlined />,
      content: 'Are you sure you want to delete this adjustment?',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => deleteAdjustmentMutation.mutate(adjustmentId),
    });
  };

  if (isLoading) {
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          <span style={{ color: colors.textMuted, fontSize: 14 }}>Loading invoice...</span>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <h2>Invoice not found</h2>
        <Button onClick={() => navigate('/app/invoices')}>Back to Invoices</Button>
      </div>
    );
  }

  // Extract invoice fields
  const invoiceNumber = invoice.invoiceNumber || '';
  const customerName = invoice.customerName || '';
  const customerEmail = invoice.customerEmail || '';
  const customerAddressLine1 = invoice.customerAddressLine1 || '';
  const customerAddressLine2 = invoice.customerAddressLine2 || '';
  const customerCity = invoice.customerCity || '';
  const customerState = invoice.customerState || '';
  const customerZipcode = invoice.customerZipcode || '';
  const invoiceDate = invoice.invoiceDate;
  const dueDate = invoice.dueDate;
  const subtotal = Number(invoice.subtotal || 0);
  const taxRate = Number(invoice.taxRate || 0);
  const taxLabel = invoice.taxLabel || 'Tax';
  const taxAmount = Number(invoice.taxAmount || 0);
  const total = Number(invoice.total || 0);
  const amountPaid = Number(invoice.amountPaid ?? 0);
  const balanceDue = invoice.balanceDue != null ? Number(invoice.balanceDue) : Math.round((total - amountPaid) * 100) / 100;
  const sections = invoice.sections || [];
  const payments = invoice.payments || [];
  const adjustments = invoice.adjustments || [];

  const statusInfo = getStatusDisplay(invoice.status as InvoiceStatus, statusConfigs || []);
  const currentStatusConfig = statusConfigs?.find((s) => s.id === invoice.statusId);
  
  // Ensure statusId exists in statusConfigs before rendering Select
  const statusOptions = (statusConfigs || [])
    .map((s) => ({
      value: s.id,
      label: s.label,
    }));
  
  const hasValidStatus = invoice.statusId && statusOptions.some((opt) => opt.value === invoice.statusId);

  // Check if invoice can receive payments (not paid or canceled)
  const statusName = currentStatusConfig?.name?.toLowerCase() || invoice.status?.toLowerCase() || '';
  const canRecordPayment = !['paid', 'canceled'].includes(statusName) && balanceDue > 0;
  const isCanceled = statusName === 'canceled';

  const itemColumns = [
    {
      title: 'Description',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => {
        const desc = record.description;
        const notes = record.notes;
        const hasExtra = desc || (notes && notes.length > 0);
        if (!hasExtra) return name;
        const tooltipContent = (
          <div style={{ maxWidth: 300 }}>
            {desc && <div style={{ marginBottom: notes?.length ? 6 : 0 }}>{desc}</div>}
            {notes?.map((n: string, i: number) => (
              <div key={i} style={{ fontSize: 12, color: '#d1d5db', borderTop: i === 0 && desc ? '1px solid rgba(255,255,255,0.15)' : undefined, paddingTop: i === 0 && desc ? 4 : 0 }}>{n}</div>
            ))}
          </div>
        );
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {name}
            <Tooltip title={tooltipContent} placement="topLeft">
              <InfoCircleOutlined style={{ fontSize: 13, color: colors.textMuted, cursor: 'pointer' }} />
            </Tooltip>
          </span>
        );
      },
    },
    ...(!isMobile ? [
      {
        title: 'Unit',
        dataIndex: 'unit',
        key: 'unit',
        width: 80,
      },
    ] : []),
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      ...(isMobile ? {} : { width: 80 }),
      align: 'right' as const,
      render: (quantity: number) => Number(quantity || 0).toFixed(2),
    },
    ...(!isMobile ? [
      {
        title: 'Price',
        dataIndex: 'unitPrice',
        key: 'unitPrice',
        width: 100,
        align: 'right' as const,
        render: (price: number) => formatCurrency(Number(price || 0)),
      },
    ] : []),
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      ...(isMobile ? {} : { width: 120 }),
      align: 'right' as const,
      render: (total: number) => <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>{formatCurrency(Number(total || 0))}</span>,
    },
  ];

  const paymentColumns = [
    {
      title: 'Date',
      dataIndex: 'paymentDate',
      key: 'paymentDate',
      render: (date: string) => date ? dayjs(date).format('MMM D, YYYY') : '—',
    },
    ...(!isMobile ? [
      {
        title: 'Method',
        dataIndex: 'paymentMethod',
        key: 'paymentMethod',
        render: (method: PaymentMethod) => paymentMethodLabels[method],
      },
      {
        title: 'Reference',
        dataIndex: 'referenceNumber',
        key: 'referenceNumber',
        render: (ref?: string) => ref || '—',
      },
    ] : []),
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      render: (amount: number) => <span style={{ fontWeight: 600 }}>{formatCurrency(Number(amount || 0))}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      align: 'center' as const,
      render: (_: any, record: Payment) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'view', icon: <EyeOutlined />, label: 'View Receipt' },
              { key: 'download', icon: <DownloadOutlined />, label: 'Download Receipt' },
              { key: 'edit', icon: <EditOutlined />, label: 'Edit Payment' },
              { type: 'divider' as const },
              { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
            ],
            onClick: async ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'view') {
                setReceiptPreviewPayment(record);
              } else if (key === 'download') {
                try {
                  const blob = await invoiceService.payments.getReceiptPdf(id!, record.id);
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const paymentDateStr = record.paymentDate
                    ? dayjs(record.paymentDate).format('YYYYMMDD')
                    : 'NoDate';
                  a.download = `Receipt_${record.id.substring(0, 8).toUpperCase()}_${paymentDateStr}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(url);
                  message.success('Receipt downloaded');
                } catch {
                  message.error('Failed to download receipt');
                }
              } else if (key === 'edit') {
                handleEditPayment(record);
              } else if (key === 'delete') {
                handleDeletePayment(record.id);
              }
            },
          }}
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
            style={{ color: colors.textMuted }}
          />
        </Dropdown>
      ),
    },
  ];

  const moreMenuItems = [
    { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
    ...(!isCanceled ? [
      { key: 'cancel', icon: <StopOutlined />, label: 'Cancel Invoice', danger: true },
    ] : []),
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
  ];

  // Mobile action menu - combines all actions except Record Payment
  const mobileActionMenuItems = [
    { key: 'download', icon: <DownloadOutlined />, label: 'Download PDF' },
    { key: 'send', icon: <SendOutlined />, label: 'Send' },
    { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
    { type: 'divider' as const },
    { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
    ...(!isCanceled ? [
      { key: 'cancel', icon: <StopOutlined />, label: 'Cancel Invoice', danger: true },
    ] : []),
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
  ];

  const handleMobileMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case 'download':
        handleDownloadPdf();
        break;
      case 'send':
        handleSend();
        break;
      case 'edit':
        navigate(`/app/invoices/${id}/edit`);
        break;
      case 'duplicate':
        message.info('Duplicate feature coming soon');
        break;
      case 'cancel':
        handleCancel();
        break;
      case 'delete':
        setDeleteModalVisible(true);
        break;
    }
  };

  const handleMoreMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case 'duplicate':
        message.info('Duplicate feature coming soon');
        break;
      case 'cancel':
        handleCancel();
        break;
      case 'delete':
        setDeleteModalVisible(true);
        break;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
                {invoiceNumber}
              </h1>
              <Dropdown
                menu={{
                  items: (statusConfigs || [])
                    .filter((s) => s.isActive)
                    .map((s) => ({
                      key: s.id,
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: s.color,
                            }}
                          />
                          {s.label}
                        </div>
                      ),
                    })),
                  onClick: ({ key }) => updateStatusMutation.mutate(key),
                  selectedKeys: invoice.statusId ? [invoice.statusId] : [],
                }}
                trigger={['click']}
              >
                <Tag
                  style={{
                    color: statusInfo.color,
                    background: statusInfo.bg,
                    border: 'none',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {statusInfo.label}
                </Tag>
              </Dropdown>
            </div>
            <div style={{ color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invoice.title || 'No title'}</div>
          </div>

          {/* Mobile: Record Payment button + Actions dropdown */}
          {isMobile ? (
            <Space style={{ flexShrink: 0 }}>
              {canRecordPayment && (
                <Button
                  icon={<DollarOutlined />}
                  type="primary"
                  style={{ background: colors.primary, minWidth: 44, height: 40 }}
                  onClick={() => { setEditingPayment(null); paymentForm.setFieldsValue({ amount: balanceDue, paymentMethod: 'check', paymentDate: dayjs(), referenceNumber: undefined, notes: undefined }); setPaymentModalVisible(true); }}
                >
                  Pay
                </Button>
              )}
              <Dropdown menu={{ items: mobileActionMenuItems, onClick: handleMobileMenuClick }} trigger={['click']}>
                <Button icon={<MoreOutlined />} style={{ minWidth: 44, height: 40 }} />
              </Dropdown>
            </Space>
          ) : (
            /* Desktop: All buttons visible */
            <Space>
              <Button icon={<DownloadOutlined />} onClick={handleDownloadPdf}>
                Download PDF
              </Button>
              <Button icon={<SendOutlined />} onClick={handleSend}>
                Send
              </Button>
              {canRecordPayment && (
                <Button
                  icon={<DollarOutlined />}
                  type="primary"
                  style={{ background: colors.primary }}
                  onClick={() => { setEditingPayment(null); paymentForm.setFieldsValue({ amount: balanceDue, paymentMethod: 'check', paymentDate: dayjs(), referenceNumber: undefined, notes: undefined }); setPaymentModalVisible(true); }}
                >
                  Record Payment
                </Button>
              )}
              <Button icon={<EditOutlined />} onClick={() => navigate(`/app/invoices/${id}/edit`)}>
                Edit
              </Button>
              <Dropdown menu={{ items: moreMenuItems, onClick: handleMoreMenuClick }} trigger={['click']}>
                <Button icon={<MoreOutlined />} />
              </Dropdown>
            </Space>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: isNarrow ? 16 : 24, flexWrap: 'wrap', flexDirection: isNarrow ? 'column' : 'row' }}>
        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Customer & Dates */}
          <Card style={{ borderRadius: 12, marginBottom: 12, overflow: 'hidden', boxShadow: shadows.card }}>
            <style>{`
              .invoice-header-descriptions .ant-descriptions-item-container {
                align-items: center !important;
              }
              .invoice-header-descriptions .ant-descriptions-item-content .ant-picker {
                padding: 0 !important;
              }
              .invoice-header-descriptions .ant-descriptions-item-content .ant-picker-input > input {
                line-height: 22px;
              }
            `}</style>
            <Descriptions className="invoice-header-descriptions" column={{ xs: 1, sm: 1, md: 1, lg: 2, xl: 3 }}>
              <Descriptions.Item label="Customer">
                <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                  <div style={{ fontWeight: 600 }}>{customerName || '—'}</div>
                  {customerEmail && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>{customerEmail}</div>
                  )}
                  {customerAddressLine1 && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>{customerAddressLine1}</div>
                  )}
                  {customerAddressLine2 && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>{customerAddressLine2}</div>
                  )}
                  {(customerCity || customerState || customerZipcode) && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {[customerCity, [customerState, customerZipcode].filter(Boolean).join(' ')]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  )}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                {statusOptions.length > 0 ? (
                  <Dropdown
                    menu={{
                      items: statusOptions.map((opt) => {
                        const status = statusConfigs?.find((s) => s.id === opt.value);
                        return {
                          key: opt.value,
                          label: (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: status?.color || '#999',
                                }}
                              />
                              {opt.label}
                            </div>
                          ),
                        };
                      }),
                      onClick: ({ key }) => updateStatusMutation.mutate(key),
                      selectedKeys: invoice.statusId ? [invoice.statusId] : [],
                    }}
                    trigger={['click']}
                  >
                    <Tag
                      style={{
                        color: statusInfo.color,
                        background: statusInfo.bg,
                        border: 'none',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.2s ease',
                        userSelect: 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.8';
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      {statusInfo.label}
                      <DownOutlined style={{ fontSize: 10 }} />
                    </Tag>
                  </Dropdown>
                ) : (
                  <Tag
                    style={{
                      color: statusInfo.color,
                      background: statusInfo.bg,
                      border: 'none',
                      fontWeight: 500,
                    }}
                  >
                    {statusInfo.label}
                  </Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Invoice Date">
                <span style={{ whiteSpace: 'nowrap' }}>
                  {invoiceDate ? dayjs(invoiceDate).format('MMMM D, YYYY') : '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Due Date">
                <span style={{ whiteSpace: 'nowrap' }}>
                  {dueDate ? dayjs(dueDate).format('MMMM D, YYYY') : '—'}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Line Items by Section */}
          {sections.length > 0 ? (
            sections.map((section) => (
              <Card key={section.id} style={{ borderRadius: 12, marginBottom: 12, boxShadow: shadows.card }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
                  <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {section.name}
                  </h3>
                  <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 14, flexShrink: 0, letterSpacing: '-0.01em' }}>{formatCurrency(Number(section.subtotal || 0))}</span>
                </div>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <Table
                    columns={itemColumns}
                    dataSource={section.items || []}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    style={{ minWidth: isMobile ? 320 : undefined }}
                  />
                </div>
              </Card>
            ))
          ) : (
            <Card style={{ borderRadius: 12, marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: 24, color: colors.textSecondary }}>
                No line items added yet
              </div>
            </Card>
          )}

          {/* Payment History */}
          {payments.length > 0 && (
            <Card style={{ borderRadius: 12, marginBottom: 12, boxShadow: shadows.card }}>
              <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 600, marginBottom: 14, letterSpacing: '-0.01em' }}>
                Payment History
              </h3>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <Table
                  columns={paymentColumns}
                  dataSource={payments}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  style={{ minWidth: isMobile ? 280 : undefined }}
                  onRow={(record) => ({
                    onClick: () => setReceiptPreviewPayment(record),
                    style: { cursor: 'pointer' },
                  })}
                />
              </div>
            </Card>
          )}

          {/* Notes */}
          {invoice.notes && (
            <Card style={{ borderRadius: 12 }}>
              <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Notes</h3>
              <p style={{ color: colors.textSecondary, margin: 0 }}>{invoice.notes}</p>
            </Card>
          )}
        </div>

        {/* Summary Sidebar - Responsive */}
        <Card style={{ borderRadius: 12, width: isNarrow ? '100%' : 'auto', flex: isNarrow ? '1 1 auto' : '0 0 300px', flexShrink: 0, alignSelf: 'flex-start', minWidth: isNarrow ? 'auto' : 300, boxShadow: shadows.card }}>
          <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 600, marginBottom: 16, letterSpacing: '-0.01em' }}>Summary</h3>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: colors.textSecondary }}>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>

          {/* Adjustments */}
          {adjustments.length > 0 && (
            <>
              {adjustments.map((adj: Adjustment) => (
                <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <span style={{ color: colors.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {adj.name}{Number(adj.percentage) > 0 ? ` (${adj.type === 'premium' ? '+' : '-'}${Number(adj.percentage).toFixed(1)}%)` : ''}
                    </span>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteAdjustment(adj.id)}
                      style={{ padding: 0, height: 'auto' }}
                    />
                  </div>
                  <span style={{ color: adj.type === 'premium' ? '#16a34a' : '#dc2626' }}>
                    {adj.type === 'premium' ? '+' : '-'}{formatCurrency(Number(adj.amount || 0))}
                  </span>
                </div>
              ))}
            </>
          )}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setAdjustmentModalOpen(true)}
            style={{ width: '100%', marginBottom: 8, height: 40 }}
          >
            Add Premium/Discount
          </Button>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: colors.textSecondary }}>
              {taxLabel} ({taxRate}%)
            </span>
            <span>{formatCurrency(taxAmount)}</span>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Total</span>
            <span style={{ fontWeight: 700, fontSize: 20, fontFamily: fonts.heading, letterSpacing: '-0.02em' }}>
              {formatCurrency(total)}
            </span>
          </div>

          {/* Payment Schedule */}
          {invoice.paymentSchedule && invoice.paymentSchedule.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0 8px' }} />
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: colors.textPrimary }}>Payment Schedule</div>
                {invoice.paymentSchedule.map((step: any, idx: number) => {
                  const stepAmount = Number(step.amount || 0);
                  const stepPaid = amountPaid >= invoice.paymentSchedule!.slice(0, idx + 1).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        padding: '6px 8px',
                        marginBottom: 4,
                        background: stepPaid ? '#f0fdf4' : '#f9fafb',
                        borderRadius: 6,
                        border: `1px solid ${stepPaid ? '#bbf7d0' : colors.border}`,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {step.label}
                          <span style={{ color: colors.textMuted, fontWeight: 400, marginLeft: 4 }}>({step.percentage}%)</span>
                        </div>
                        {(step.dueDescription || step.due_description) && (
                          <div style={{ fontSize: 11, color: colors.textMuted }}>{step.dueDescription || step.due_description}</div>
                        )}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                        {formatCurrency(stepAmount)}
                        {stepPaid && <span style={{ color: '#059669', fontSize: 11, marginLeft: 4 }}>Paid</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div
            style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, cursor: payments.length > 0 ? 'pointer' : 'default', padding: '4px 0', borderRadius: 4 }}
            onClick={() => { if (payments.length > 0) setPaymentListVisible(true); }}
          >
            <span style={{ color: colors.textSecondary }}>
              Amount Paid
              {payments.length > 0 && (
                <span style={{ fontSize: 11, marginLeft: 4, color: '#9ca3af' }}>
                  ({payments.length})
                </span>
              )}
            </span>
            <span style={{ color: '#059669', fontWeight: 600, textDecoration: payments.length > 0 ? 'underline' : 'none' }}>
              -{formatCurrency(amountPaid)}
            </span>
          </div>

          <Divider style={{ margin: '8px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Balance Due</span>
            <span style={{
              fontWeight: 700,
              fontSize: 20,
              fontFamily: fonts.heading,
              color: balanceDue > 0 ? '#dc2626' : '#059669'
            }}>
              {formatCurrency(balanceDue)}
            </span>
          </div>
        </Card>
      </div>

      {/* Payment List Modal (read-only) */}
      <Modal
        title="Payment History"
        open={paymentListVisible}
        onCancel={() => setPaymentListVisible(false)}
        footer={<Button onClick={() => setPaymentListVisible(false)}>Close</Button>}
        width={520}
      >
        {payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: colors.textSecondary }}>
            No payments recorded
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payments.map((payment) => (
              <div
                key={payment.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: '#f9fafb',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{formatCurrency(Number(payment.amount))}</div>
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                    {paymentMethodLabels[payment.paymentMethod] || payment.paymentMethod}
                    {payment.paymentDate && ` · ${dayjs(payment.paymentDate).format('MMM D, YYYY')}`}
                    {payment.referenceNumber && ` · ${payment.referenceNumber}`}
                  </div>
                  {payment.notes && (
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{payment.notes}</div>
                  )}
                </div>
              </div>
            ))}
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
              <span>Total Paid</span>
              <span style={{ color: '#059669' }}>{formatCurrency(amountPaid)}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Record/Edit Payment Modal */}
      <Modal
        title={editingPayment ? "Edit Payment" : "Record Payment"}
        open={paymentModalVisible}
        onCancel={() => {
          setPaymentModalVisible(false);
          setEditingPayment(null);
          paymentForm.resetFields();
        }}
        onOk={() => paymentForm.submit()}
        okText={editingPayment ? "Update Payment" : "Record Payment"}
      >
        <Form
          form={paymentForm}
          layout="vertical"
          onFinish={handleRecordPayment}
          initialValues={{
            paymentDate: dayjs(),
            paymentMethod: 'check',
            amount: balanceDue,
          }}
        >
          <Form.Item
            label="Amount"
            name="amount"
            rules={[
              { required: true, message: 'Please enter amount' },
              { type: 'number', min: 0.01, message: 'Amount must be greater than 0' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              prefix="$"
              precision={2}
              min={0}
            />
          </Form.Item>

          <Form.Item
            label="Payment Method"
            name="paymentMethod"
            rules={[{ required: true, message: 'Please select payment method' }]}
          >
            <Select>
              <Select.Option value="cash">Cash</Select.Option>
              <Select.Option value="check">Check</Select.Option>
              <Select.Option value="credit_card">Credit Card</Select.Option>
              <Select.Option value="bank_transfer">Bank Transfer</Select.Option>
              <Select.Option value="other">Other</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="Payment Date"
            name="paymentDate"
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="Reference Number" name="referenceNumber">
            <Input placeholder="Check number, transaction ID, etc." />
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Optional payment notes" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        title="Delete Invoice"
        open={deleteModalVisible}
        onCancel={() => setDeleteModalVisible(false)}
        onOk={handleDelete}
        okText="Delete"
        okButtonProps={{ danger: true }}
      >
        <p>Are you sure you want to delete this invoice? This action cannot be undone.</p>
      </Modal>

      {/* Adjustment Modal */}
      <Modal
        title="Add Premium/Discount"
        open={adjustmentModalOpen}
        onCancel={() => {
          setAdjustmentModalOpen(false);
          adjustmentForm.resetFields();
        }}
        onOk={() => adjustmentForm.submit()}
        confirmLoading={addAdjustmentMutation.isPending}
      >
        <Form form={adjustmentForm} layout="vertical" onFinish={handleAddAdjustment}>
          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true, message: 'Please select the type' }]}
          >
            <Select placeholder="Select type">
              <Select.Option value="premium">Premium (+%)</Select.Option>
              <Select.Option value="discount">Discount (-%)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input placeholder="e.g., Holiday Premium, Volume Discount" />
          </Form.Item>
          <Form.Item
            name="percentage"
            label="Percentage"
            rules={[{ required: true, message: 'Please enter the percentage' }]}
          >
            <InputNumber
              suffix="%"
              style={{ width: '100%' }}
              min={0}
              max={100}
              precision={2}
              placeholder="10.00"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Send Modal */}
      <Modal
        title="Send Invoice"
        open={sendModalOpen}
        onCancel={() => {
          setSendModalOpen(false);
          sendForm.resetFields();
        }}
        onOk={() => sendForm.submit()}
        okText="Send"
        confirmLoading={sendMutation.isPending}
      >
        <Form form={sendForm} layout="vertical" onFinish={handleSendInvoice}>
          <Form.Item
            name="toEmail"
            label="Customer Email"
            rules={[
              { required: true, message: 'Please enter the customer email' },
              { type: 'email', message: 'Please enter a valid email address' },
            ]}
          >
            <Input placeholder="customer@example.com" />
          </Form.Item>
          <Form.Item
            name="ccEmails"
            label="Cc (optional)"
            tooltip="Separate multiple addresses with commas"
          >
            <Input placeholder="you@example.com, another@example.com" />
          </Form.Item>
          <Form.Item name="message" label="Message (optional)">
            <Input.TextArea rows={3} placeholder="Add a note for the customer..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Receipt Preview Modal */}
      {receiptPreviewPayment && (
        <ReceiptPreviewModal
          open={!!receiptPreviewPayment}
          onClose={() => setReceiptPreviewPayment(null)}
          invoiceId={id!}
          invoiceNumber={invoiceNumber}
          payment={receiptPreviewPayment}
          customerName={customerName}
          templates={pdfTemplates}
          templatesLoading={templatesLoading}
        />
      )}
    </motion.div>
  );
};

export default InvoiceDetailPage;
