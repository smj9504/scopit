/**
 * Scopit - Estimate Detail Page
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Button, Tag, Descriptions, Table, Dropdown, Space, Divider,
  Spin, Modal, Form, Input, InputNumber, Select, DatePicker, App, Tooltip
} from 'antd';
import {
  EditOutlined,
  SendOutlined,
  DownloadOutlined,
  MoreOutlined,
  ArrowLeftOutlined,
  CopyOutlined,
  SwapOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  DollarOutlined,
  DownOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { useEstimateStatuses, getStatusDisplay } from '@/hooks/useSettings';
import { estimateService } from '@/services/estimateService';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';
import { useBackNav } from '@/hooks/useHeaderNav';
import type { EstimateStatus, Adjustment, EstimatePayment } from '@/types/entities';

const EstimateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();
  const { modal, message } = App.useApp();
  const [paymentForm] = Form.useForm();
  const [adjustmentForm] = Form.useForm();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);

  useBackNav('Back to Estimates', '/app/estimates');

  // Fetch estimate data
  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => estimateService.getById(id!),
    enabled: !!id,
  });

  // Fetch estimate statuses
  const { data: statusConfigs, isLoading: isLoadingStatuses } = useEstimateStatuses();
  const statusInfo = estimate ? getStatusDisplay(estimate.status as EstimateStatus, statusConfigs || []) : { label: '', color: '', bg: '' };
  const currentStatusConfig = statusConfigs?.find((s) => s.id === estimate?.statusId);
  
  // Ensure statusId exists in statusConfigs before rendering Select
  const statusOptions = (statusConfigs || [])
    .map((s) => ({
      value: s.id,
      label: s.label,
    }));
  
  const hasValidStatus = estimate?.statusId && statusOptions.some((opt) => opt.value === estimate.statusId);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => estimateService.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      message.success('Estimate deleted');
      navigate('/app/estimates');
    },
    onError: () => {
      message.error('Failed to delete estimate');
    },
  });

  // Convert to invoice mutation
  const convertMutation = useMutation({
    mutationFn: () => estimateService.convert(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      message.success(`Invoice ${data.invoiceNumber} created`);
      navigate(`/app/invoices/${data.id}`);
    },
    onError: () => {
      message.error('Failed to convert to invoice');
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (statusId: string) => estimateService.updateStatus(id!, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Status updated');
    },
    onError: () => {
      message.error('Failed to update status');
    },
  });

  // Update dates mutation
  const updateDatesMutation = useMutation({
    mutationFn: (dates: { estimate_date?: string; valid_until?: string }) =>
      estimateService.updateDates(id!, dates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Date updated');
    },
    onError: () => {
      message.error('Failed to update date');
    },
  });

  // Add payment mutation
  const addPaymentMutation = useMutation({
    mutationFn: (data: { amount: number; paymentMethod?: string; paymentDate?: string; notes?: string }) =>
      estimateService.payments.add(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Payment recorded');
      setPaymentModalOpen(false);
      paymentForm.resetFields();
    },
    onError: () => {
      message.error('Failed to record payment');
    },
  });

  // Delete payment mutation
  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: string) => estimateService.payments.delete(id!, paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Payment deleted');
    },
    onError: () => {
      message.error('Failed to delete payment');
    },
  });

  // Add adjustment mutation
  const addAdjustmentMutation = useMutation({
    mutationFn: (data: { type: 'premium' | 'discount'; name: string; percentage: number }) =>
      estimateService.adjustments.add(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
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
    mutationFn: (adjustmentId: string) => estimateService.adjustments.delete(id!, adjustmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Adjustment deleted');
    },
    onError: () => {
      message.error('Failed to delete adjustment');
    },
  });

  const handleDelete = () => {
    modal.confirm({
      title: 'Delete Estimate',
      icon: <ExclamationCircleOutlined />,
      content: 'Are you sure you want to delete this estimate? This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => deleteMutation.mutate(),
    });
  };

  const handleConvertToInvoice = () => {
    modal.confirm({
      title: 'Convert to Invoice',
      icon: <SwapOutlined />,
      content: 'This will create a new invoice from this estimate. The estimate status will be changed to "Converted".',
      okText: 'Convert',
      cancelText: 'Cancel',
      onOk: () => convertMutation.mutate(),
    });
  };

  const handleAddPayment = (values: { amount: number; paymentMethod?: string; paymentDate?: dayjs.Dayjs; notes?: string }) => {
    addPaymentMutation.mutate({
      amount: values.amount,
      paymentMethod: values.paymentMethod,
      paymentDate: values.paymentDate?.format('YYYY-MM-DD'),
      notes: values.notes,
    });
  };

  const handleAddAdjustment = (values: { type: 'premium' | 'discount'; name: string; percentage: number }) => {
    addAdjustmentMutation.mutate(values);
  };

  const handleDeletePayment = (paymentId: string) => {
    modal.confirm({
      title: 'Delete Payment',
      icon: <ExclamationCircleOutlined />,
      content: 'Are you sure you want to delete this payment?',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => deletePaymentMutation.mutate(paymentId),
    });
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

  const allItemColumns = [
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
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      mobileHidden: true,
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
    },
    {
      title: 'Price',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 100,
      align: 'right' as const,
      render: (price: number) => formatCurrency(Number(price || 0)),
      mobileHidden: true,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (total: number) => <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>{formatCurrency(Number(total || 0))}</span>,
    },
  ];

  const itemColumns = isMobile
    ? allItemColumns.filter((col) => !(col as any).mobileHidden)
    : allItemColumns;

  const moreMenuItems = [
    { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
    {
      key: 'convert',
      icon: <SwapOutlined />,
      label: 'Convert to Invoice',
      disabled: estimate?.status === 'converted',
    },
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
    {
      key: 'convert',
      icon: <SwapOutlined />,
      label: 'Convert to Invoice',
      disabled: estimate?.status === 'converted',
    },
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
  ];

  const handleDownloadPdf = async () => {
    try {
      const blob = await estimateService.getPdf(id!);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${estimate?.estimateNumber || 'estimate'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('PDF downloaded successfully');
    } catch {
      message.error('Failed to download PDF');
    }
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case 'download':
        handleDownloadPdf();
        break;
      case 'send':
        message.info('Send feature coming soon');
        break;
      case 'edit':
        navigate(`/app/estimates/${id}/edit`);
        break;
      case 'duplicate':
        message.info('Duplicate feature coming soon');
        break;
      case 'convert':
        handleConvertToInvoice();
        break;
      case 'delete':
        handleDelete();
        break;
    }
  };

  if (isLoading) {
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          <span style={{ color: colors.textMuted, fontSize: 14 }}>Loading estimate...</span>
        </div>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <h2>Estimate not found</h2>
        <Button onClick={() => navigate('/app/estimates')}>Back to Estimates</Button>
      </div>
    );
  }

  // Sections already contain items from the backend
  const sectionsWithItems = estimate.sections || [];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
                {estimate.estimateNumber}
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
                  selectedKeys: estimate.statusId ? [estimate.statusId] : [],
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
            <div style={{ color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{estimate.title}</div>
          </div>

          {/* Mobile: Record Payment button + Actions dropdown */}
          {isMobile ? (
            <Space style={{ flexShrink: 0 }}>
              <Button
                icon={<DollarOutlined />}
                type="primary"
                style={{ background: colors.primary, minWidth: 44, height: 40 }}
                onClick={() => setPaymentModalOpen(true)}
              >
                Pay
              </Button>
              <Dropdown menu={{ items: mobileActionMenuItems, onClick: handleMenuClick }} trigger={['click']}>
                <Button icon={<MoreOutlined />} style={{ minWidth: 44, height: 40 }} />
              </Dropdown>
            </Space>
          ) : (
            /* Desktop: All buttons visible */
            <Space>
              <Button icon={<DownloadOutlined />} onClick={handleDownloadPdf}>Download PDF</Button>
              <Button icon={<SendOutlined />}>Send</Button>
              <Button
                icon={<DollarOutlined />}
                type="primary"
                style={{ background: colors.primary }}
                onClick={() => setPaymentModalOpen(true)}
              >
                Record Payment
              </Button>
              <Button icon={<EditOutlined />} onClick={() => navigate(`/app/estimates/${id}/edit`)}>
                Edit
              </Button>
              <Dropdown menu={{ items: moreMenuItems, onClick: handleMenuClick }} trigger={['click']}>
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
            <Descriptions column={{ xs: 1, sm: 1, md: 1, lg: 2, xl: 3 }}>
              <Descriptions.Item label="Customer">
                <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                  <div style={{ fontWeight: 600 }}>{estimate.customerName || '—'}</div>
                  {estimate.customerEmail && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>{estimate.customerEmail}</div>
                  )}
                  {estimate.customerAddress && (
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>{estimate.customerAddress}</div>
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
                      selectedKeys: estimate.statusId ? [estimate.statusId] : [],
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
              <Descriptions.Item label="Estimate Date">
                <DatePicker
                  value={estimate.estimateDate ? dayjs(estimate.estimateDate) : null}
                  format="MMMM D, YYYY"
                  allowClear={false}
                  variant="borderless"
                  style={{ padding: 0 }}
                  onChange={(d) => {
                    if (d) {
                      updateDatesMutation.mutate({
                        estimate_date: d.format('YYYY-MM-DD'),
                      });
                    }
                  }}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Valid Until">
                <DatePicker
                  value={estimate.validUntil ? dayjs(estimate.validUntil) : null}
                  format="MMMM D, YYYY"
                  variant="borderless"
                  style={{ padding: 0 }}
                  onChange={(d) => {
                    updateDatesMutation.mutate({
                      valid_until: d ? d.format('YYYY-MM-DD') : undefined,
                    });
                  }}
                />
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Line Items by Section */}
          {sectionsWithItems.length > 0 ? (
            sectionsWithItems.map((section) => (
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
                    dataSource={section.items}
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

          {/* Notes */}
          {estimate.notes && (
            <Card style={{ borderRadius: 12 }}>
              <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Notes</h3>
              <p style={{ color: colors.textSecondary, margin: 0 }}>{estimate.notes}</p>
            </Card>
          )}
        </div>

        {/* Summary Sidebar - Responsive */}
        <Card style={{ borderRadius: 12, width: isNarrow ? '100%' : 'auto', flex: isNarrow ? '1 1 auto' : '0 0 300px', flexShrink: 0, alignSelf: 'flex-start', minWidth: isNarrow ? 'auto' : 300, boxShadow: shadows.card }}>
          <h3 style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 600, marginBottom: 16, letterSpacing: '-0.01em' }}>Summary</h3>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: colors.textSecondary }}>Subtotal</span>
            <span>{formatCurrency(Number(estimate.subtotal || 0))}</span>
          </div>

          {/* Adjustments */}
          {(estimate.adjustments || []).length > 0 && (
            <>
              {estimate.adjustments.map((adj: Adjustment) => (
                <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-start', flexWrap: 'wrap', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ color: adj.type === 'premium' ? '#16a34a' : '#dc2626' }}>
                      {adj.name} ({adj.type === 'premium' ? '+' : '-'}{Number(adj.percentage).toFixed(1)}%)
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
              {estimate.taxLabel || 'Tax'} ({Number(estimate.taxRate || 0)}%)
            </span>
            <span>{formatCurrency(Number(estimate.taxAmount || 0))}</span>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Total</span>
            <span style={{ fontWeight: 700, fontSize: 20, fontFamily: fonts.heading, letterSpacing: '-0.02em' }}>
              {formatCurrency(Number(estimate.total || 0))}
            </span>
          </div>

          {/* Payments Section */}
          {(estimate.payments || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Payments</div>
              <div style={{ marginBottom: 8 }}>
                {estimate.payments.map((payment: EstimatePayment, index: number) => (
                  <div key={payment.id} style={{ fontSize: 13, padding: '4px 0', borderTop: index > 0 ? `1px solid ${colors.border}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: colors.textSecondary }}>
                        {payment.paymentDate ? dayjs(payment.paymentDate).format('MMM D, YYYY') : 'No date'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#16a34a', fontWeight: 500 }}>-{formatCurrency(Number(payment.amount || 0))}</span>
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeletePayment(payment.id)}
                          style={{ padding: 0, height: 'auto', fontSize: 12 }}
                        />
                      </div>
                    </div>
                    {(payment.paymentMethod || payment.notes) && (
                      <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                        {payment.paymentMethod && <span>{payment.paymentMethod}</span>}
                        {payment.paymentMethod && payment.notes && <span> · </span>}
                        {payment.notes && <span>{payment.notes}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Divider style={{ margin: '8px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: colors.textSecondary }}>Amount Paid</span>
            <span style={{ color: '#16a34a' }}>{formatCurrency(Number(estimate.amountPaid || 0))}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600 }}>Balance Due</span>
            <span style={{ fontWeight: 700, color: Number(estimate.balanceDue || 0) > 0 ? '#dc2626' : '#16a34a' }}>
              {formatCurrency(Number(estimate.balanceDue || 0))}
            </span>
          </div>
        </Card>
      </div>

      {/* Payment Modal */}
      <Modal
        title="Record Payment"
        open={paymentModalOpen}
        onCancel={() => {
          setPaymentModalOpen(false);
          paymentForm.resetFields();
        }}
        onOk={() => paymentForm.submit()}
        confirmLoading={addPaymentMutation.isPending}
      >
        <Form form={paymentForm} layout="vertical" onFinish={handleAddPayment}>
          <Form.Item
            name="amount"
            label="Amount"
            rules={[{ required: true, message: 'Please enter the payment amount' }]}
          >
            <InputNumber
              prefix="$"
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="0.00"
            />
          </Form.Item>
          <Form.Item name="paymentMethod" label="Payment Method">
            <Select placeholder="Select method" allowClear>
              <Select.Option value="cash">Cash</Select.Option>
              <Select.Option value="check">Check</Select.Option>
              <Select.Option value="credit_card">Credit Card</Select.Option>
              <Select.Option value="bank_transfer">Bank Transfer</Select.Option>
              <Select.Option value="other">Other</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="paymentDate" label="Payment Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Optional notes" />
          </Form.Item>
        </Form>
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
    </motion.div>
  );
};

export default EstimateDetailPage;
