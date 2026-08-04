/**
 * ScopeIt - Settings Page
 */
import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  Card,
  Tabs,
  Form,
  Input,
  InputNumber,
  Button,
  Upload,
  App,
  Divider,
  Badge,
  Table,
  Modal,
  ColorPicker,
  Switch,
  Popconfirm,
  Tooltip,
  Empty,
  Spin,
  Collapse,
} from 'antd';
import type { DragEndEvent } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  UploadOutlined,
  SaveOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
  CheckCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { colors, fonts, shadows } from '@/styles/theme';
import { settingsService } from '@/services/settingsService';
import { companyService } from '@/services/companyService';
import { authService } from '@/services/authService';
import { StatusMigrationModal, type StatusType } from '@/components/settings/StatusMigrationModal';
import CompanyDocumentsSettings from '@/components/settings/CompanyDocumentsSettings';
import { TemplatePreviewModal } from '@/components/features/TemplatePreviewModal';
import type {
  EstimateStatusConfig,
  InvoiceStatusConfig,
  LineItemCategory,
  StatusConfigCreate,
  CategoryCreate,
  StatusUsageResponse,
  PdfTemplateId,
} from '@/types/entities';
import type { ColumnsType } from 'antd/es/table';

// Predefined color palette for easy selection
const colorPresets = [
  '#6b7280', // Gray
  '#ef4444', // Red
  '#f59e0b', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#10b981', // Emerald
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
];

// Resolve an AntD ColorPicker form value (string | AggregationColor | undefined) to a
// plain #RRGGBB hex string. None of our color fields support transparency, so an 8-digit
// #RRGGBBAA value (e.g. from an alpha slider) is normalized down to 6 digits.
const resolveColorHex = (value: unknown, fallback: string): string => {
  let hex = fallback;
  if (typeof value === 'string') {
    hex = value;
  } else if (value && typeof (value as { toHexString?: () => string }).toHexString === 'function') {
    hex = (value as { toHexString: () => string }).toHexString();
  }
  return /^#[0-9a-fA-F]{8}$/.test(hex) ? hex.slice(0, 7) : hex;
};

// Derive a lighter accent tint from the brand color, for subtitles/borders in PDFs.
// Blends the brand color toward white so any hue stays clear and bright rather than muddy.
const deriveSecondaryColor = (primaryHex: string): string => {
  const hex = primaryHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const mixToward = (channel: number, target: number) => Math.round(channel + (target - channel) * 0.5);
  const [mr, mg, mb] = [mixToward(r, 255), mixToward(g, 255), mixToward(b, 255)];
  return `#${mr.toString(16).padStart(2, '0')}${mg.toString(16).padStart(2, '0')}${mb.toString(16).padStart(2, '0')}`;
};

// Helper to generate lighter background color
const generateBgColor = (color: string): string => {
  // Convert hex to RGB and add alpha for lighter version
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Mix with white for lighter shade
  const lightR = Math.round(r + (255 - r) * 0.85);
  const lightG = Math.round(g + (255 - g) * 0.85);
  const lightB = Math.round(b + (255 - b) * 0.85);
  return `#${lightR.toString(16).padStart(2, '0')}${lightG.toString(16).padStart(2, '0')}${lightB.toString(16).padStart(2, '0')}`;
};

// Sortable Row Component for drag-and-drop
interface SortableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  'data-row-key': string;
}

const SortableRow: React.FC<SortableRowProps> = (props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-row-key'],
  });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999, background: colors.bgWhite, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } : {}),
  };

  return (
    <tr {...props} ref={setNodeRef} style={style} {...attributes}>
      {React.Children.map(props.children, (child) => {
        if (React.isValidElement(child) && (child as React.ReactElement<{ dataIndex?: string }>).props?.dataIndex === 'drag') {
          return React.cloneElement(child as React.ReactElement, {
            children: (
              <HolderOutlined
                {...listeners}
                style={{ cursor: 'grab', color: colors.textMuted, fontSize: 16 }}
              />
            ),
          });
        }
        return child;
      })}
    </tr>
  );
};

// ==================== Estimate Statuses Tab ====================
const EstimateStatusesSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EstimateStatusConfig | null>(null);
  const [form] = Form.useForm();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Fetch statuses
  const { data: statuses = [], isLoading } = useQuery({
    queryKey: ['estimateStatuses'],
    queryFn: () => settingsService.estimateStatuses.list(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: StatusConfigCreate) => settingsService.estimateStatuses.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      message.success('Status created');
      handleCloseModal();
    },
    onError: () => message.error('Failed to create status'),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusConfigCreate> }) =>
      settingsService.estimateStatuses.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      message.success('Status updated');
      handleCloseModal();
    },
    onError: () => message.error('Failed to update status'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsService.estimateStatuses.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      message.success('Status deleted');
    },
    onError: () => message.error('Failed to delete status. It may be in use.'),
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.estimateStatuses.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
    },
    onError: () => message.error('Failed to reorder statuses'),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = statuses.findIndex((item) => item.id === active.id);
      const newIndex = statuses.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(statuses, oldIndex, newIndex);
      // Optimistic update
      queryClient.setQueryData(['estimateStatuses'], newOrder);
      reorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const colorValue = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#6b7280';
      const payload: StatusConfigCreate = {
        name: values.name,
        label: values.name,
        color: colorValue,
        bg_color: generateBgColor(colorValue),
        is_default: values.isDefault || false,
      };

      if (editingItem) {
        updateMutation.mutate({ id: editingItem.id, data: payload });
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    form.resetFields();
  };

  const handleEdit = (record: EstimateStatusConfig) => {
    setEditingItem(record);
    form.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setModalOpen(true);
  };

  const columns: ColumnsType<EstimateStatusConfig> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null, // Handled by SortableRow
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: record.color,
              background: record.bgColor,
            }}
          >
            {text}
          </span>
          {record.isDefault && (
            <Tooltip title="Default status for new estimates">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) => (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: color,
            border: `1px solid ${colors.border}`,
          }}
        />
      ),
    },
    {
      title: 'In Use',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title="Delete this status?"
            description={
              record.usageCount && record.usageCount > 0
                ? `This status is used by ${record.usageCount} estimate(s). Delete anyway?`
                : 'This action cannot be undone.'
            }
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            disabled={record.isSystem}
          >
            <Button
              type="text"
              icon={<DeleteOutlined />}
              danger
              disabled={record.isSystem}
            />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Estimate Statuses
          </h2>
          <p style={{ color: colors.textSecondary, margin: 0 }}>
            Customize the statuses available for your estimates. Drag to reorder.
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ background: colors.primary }}
        >
          Add Status
        </Button>
      </div>

      <Spin spinning={isLoading}>
        {statuses.length === 0 ? (
          <Empty description="No statuses configured" />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <Table
                className="compact-table"
                columns={columns}
                dataSource={statuses}
                rowKey="id"
                pagination={false}
                components={{
                  body: {
                    row: SortableRow,
                  },
                }}
              />
            </SortableContext>
          </DndContext>
        )}
      </Spin>

      <Modal
        title={editingItem ? 'Edit Status' : 'Add Status'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={handleCloseModal}
        okText={editingItem ? 'Save Changes' : 'Add Status'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: createMutation.isPending || updateMutation.isPending,
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Status Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Pending Review" />
          </Form.Item>
          <Form.Item name="color" label="Color" rules={[{ required: true, message: 'Please select a color' }]}>
            <ColorPicker
              showText
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default status will be automatically assigned to new estimates.
          </p>
        </Form>
      </Modal>
    </div>
  );
};

// ==================== Invoice Statuses Tab ====================
const InvoiceStatusesSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceStatusConfig | null>(null);
  const [form] = Form.useForm();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Fetch statuses
  const { data: statuses = [], isLoading } = useQuery({
    queryKey: ['invoiceStatuses'],
    queryFn: () => settingsService.invoiceStatuses.list(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: StatusConfigCreate) => settingsService.invoiceStatuses.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      message.success('Status created');
      handleCloseModal();
    },
    onError: () => message.error('Failed to create status'),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusConfigCreate> }) =>
      settingsService.invoiceStatuses.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      message.success('Status updated');
      handleCloseModal();
    },
    onError: () => message.error('Failed to update status'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsService.invoiceStatuses.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      message.success('Status deleted');
    },
    onError: () => message.error('Failed to delete status. It may be in use.'),
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.invoiceStatuses.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
    },
    onError: () => message.error('Failed to reorder statuses'),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = statuses.findIndex((item) => item.id === active.id);
      const newIndex = statuses.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(statuses, oldIndex, newIndex);
      queryClient.setQueryData(['invoiceStatuses'], newOrder);
      reorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const colorValue = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#6b7280';
      const payload: StatusConfigCreate = {
        name: values.name,
        label: values.name,
        color: colorValue,
        bg_color: generateBgColor(colorValue),
        is_default: values.isDefault || false,
      };

      if (editingItem) {
        updateMutation.mutate({ id: editingItem.id, data: payload });
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    form.resetFields();
  };

  const handleEdit = (record: InvoiceStatusConfig) => {
    setEditingItem(record);
    form.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setModalOpen(true);
  };

  const columns: ColumnsType<InvoiceStatusConfig> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: record.color,
              background: record.bgColor,
            }}
          >
            {text}
          </span>
          {record.isDefault && (
            <Tooltip title="Default status for new invoices">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) => (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: color,
            border: `1px solid ${colors.border}`,
          }}
        />
      ),
    },
    {
      title: 'In Use',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title="Delete this status?"
            description={
              record.usageCount && record.usageCount > 0
                ? `This status is used by ${record.usageCount} invoice(s). Delete anyway?`
                : 'This action cannot be undone.'
            }
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            disabled={record.isSystem}
          >
            <Button
              type="text"
              icon={<DeleteOutlined />}
              danger
              disabled={record.isSystem}
            />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Invoice Statuses
          </h2>
          <p style={{ color: colors.textSecondary, margin: 0 }}>
            Customize the statuses available for your invoices. Drag to reorder.
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ background: colors.primary }}
        >
          Add Status
        </Button>
      </div>

      <Spin spinning={isLoading}>
        {statuses.length === 0 ? (
          <Empty description="No statuses configured" />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <Table
                className="compact-table"
                columns={columns}
                dataSource={statuses}
                rowKey="id"
                pagination={false}
                components={{
                  body: {
                    row: SortableRow,
                  },
                }}
              />
            </SortableContext>
          </DndContext>
        )}
      </Spin>

      <Modal
        title={editingItem ? 'Edit Status' : 'Add Status'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={handleCloseModal}
        okText={editingItem ? 'Save Changes' : 'Add Status'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: createMutation.isPending || updateMutation.isPending,
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Status Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Under Review" />
          </Form.Item>
          <Form.Item name="color" label="Color" rules={[{ required: true, message: 'Please select a color' }]}>
            <ColorPicker
              showText
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default status will be automatically assigned to new invoices.
          </p>
        </Form>
      </Modal>
    </div>
  );
};

// ==================== Line Item Categories Tab ====================
const CategoriesSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItemCategory | null>(null);
  const [form] = Form.useForm();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Fetch categories
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['lineItemCategories'],
    queryFn: () => settingsService.categories.list(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CategoryCreate) => settingsService.categories.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category created');
      handleCloseModal();
    },
    onError: () => message.error('Failed to create category'),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CategoryCreate> }) =>
      settingsService.categories.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category updated');
      handleCloseModal();
    },
    onError: () => message.error('Failed to update category'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsService.categories.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category deleted');
    },
    onError: () => message.error('Failed to delete category. It may be in use.'),
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.categories.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
    },
    onError: () => message.error('Failed to reorder categories'),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = categories.findIndex((item) => item.id === active.id);
      const newIndex = categories.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(categories, oldIndex, newIndex);
      queryClient.setQueryData(['lineItemCategories'], newOrder);
      reorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const colorValue = values.color
        ? typeof values.color === 'string'
          ? values.color
          : values.color?.toHexString?.() || undefined
        : undefined;
      const payload: CategoryCreate = {
        name: values.name,
        color: colorValue,
        is_default: values.isDefault || false,
      };

      if (editingItem) {
        updateMutation.mutate({ id: editingItem.id, data: payload });
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    form.resetFields();
  };

  const handleEdit = (record: LineItemCategory) => {
    setEditingItem(record);
    form.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setModalOpen(true);
  };

  const columns: ColumnsType<LineItemCategory> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {record.color && (
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: record.color,
              }}
            />
          )}
          <span style={{ fontWeight: 500 }}>{text}</span>
          {record.isDefault && (
            <Tooltip title="Default category for new line items">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) =>
        color ? (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: color,
              border: `1px solid ${colors.border}`,
            }}
          />
        ) : (
          <span style={{ color: colors.textMuted }}>-</span>
        ),
    },
    {
      title: 'Line Items',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 100,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm
            title="Delete this category?"
            description={
              record.usageCount && record.usageCount > 0
                ? `This category is used by ${record.usageCount} line item(s). Delete anyway?`
                : 'This action cannot be undone.'
            }
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Line Item Categories
          </h2>
          <p style={{ color: colors.textSecondary, margin: 0 }}>
            Organize your line items with custom categories. Drag to reorder.
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ background: colors.primary }}
        >
          Add Category
        </Button>
      </div>

      <Spin spinning={isLoading}>
        {categories.length === 0 ? (
          <Empty description="No categories configured" />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <Table
                className="compact-table"
                columns={columns}
                dataSource={categories}
                rowKey="id"
                pagination={false}
                components={{
                  body: {
                    row: SortableRow,
                  },
                }}
              />
            </SortableContext>
          </DndContext>
        )}
      </Spin>

      <Modal
        title={editingItem ? 'Edit Category' : 'Add Category'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={handleCloseModal}
        okText={editingItem ? 'Save Changes' : 'Add Category'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: createMutation.isPending || updateMutation.isPending,
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Category Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Demolition" />
          </Form.Item>
          <Form.Item name="color" label="Color (Optional)">
            <ColorPicker
              showText
              allowClear
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default category will be pre-selected when creating new line items.
          </p>
        </Form>
      </Modal>
    </div>
  );
};

// ==================== Unified Customization Settings Tab ====================
const CustomizationSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // ===== Estimate Statuses State =====
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [editingEstimateStatus, setEditingEstimateStatus] = useState<EstimateStatusConfig | null>(null);
  const [estimateForm] = Form.useForm();

  // ===== Invoice Statuses State =====
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoiceStatus, setEditingInvoiceStatus] = useState<InvoiceStatusConfig | null>(null);
  const [invoiceForm] = Form.useForm();

  // ===== Categories State =====
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LineItemCategory | null>(null);
  const [categoryForm] = Form.useForm();

  // ===== Migration Modal State =====
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationStatusType, setMigrationStatusType] = useState<StatusType>('estimate');
  const [statusToDelete, setStatusToDelete] = useState<EstimateStatusConfig | InvoiceStatusConfig | null>(null);
  const [usageInfo, setUsageInfo] = useState<StatusUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [migrationLoading, setMigrationLoading] = useState(false);

  // ===== Queries =====
  const { data: estimateStatuses = [], isLoading: estimateStatusesLoading } = useQuery({
    queryKey: ['estimateStatuses'],
    queryFn: () => settingsService.estimateStatuses.list(),
  });

  const { data: invoiceStatuses = [], isLoading: invoiceStatusesLoading } = useQuery({
    queryKey: ['invoiceStatuses'],
    queryFn: () => settingsService.invoiceStatuses.list(),
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['lineItemCategories'],
    queryFn: () => settingsService.categories.list(),
  });

  // ===== Estimate Status Mutations =====
  const estimateCreateMutation = useMutation({
    mutationFn: (data: StatusConfigCreate) => settingsService.estimateStatuses.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      message.success('Status created');
      setEstimateModalOpen(false);
      setEditingEstimateStatus(null);
      estimateForm.resetFields();
    },
    onError: () => message.error('Failed to create status'),
  });

  const estimateUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusConfigCreate> }) =>
      settingsService.estimateStatuses.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      message.success('Status updated');
      setEstimateModalOpen(false);
      setEditingEstimateStatus(null);
      estimateForm.resetFields();
    },
    onError: () => message.error('Failed to update status'),
  });

  const estimateDeleteMutation = useMutation({
    mutationFn: ({ id, migrateToId }: { id: string; migrateToId?: string }) =>
      settingsService.estimateStatuses.delete(id, migrateToId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      message.success('Status deleted');
      closeMigrationModal();
    },
    onError: () => message.error('Failed to delete status. It may be in use.'),
  });

  const estimateReorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.estimateStatuses.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimateStatuses'] });
    },
    onError: () => message.error('Failed to reorder statuses'),
  });

  // ===== Invoice Status Mutations =====
  const invoiceCreateMutation = useMutation({
    mutationFn: (data: StatusConfigCreate) => settingsService.invoiceStatuses.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      message.success('Status created');
      setInvoiceModalOpen(false);
      setEditingInvoiceStatus(null);
      invoiceForm.resetFields();
    },
    onError: () => message.error('Failed to create status'),
  });

  const invoiceUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusConfigCreate> }) =>
      settingsService.invoiceStatuses.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      message.success('Status updated');
      setInvoiceModalOpen(false);
      setEditingInvoiceStatus(null);
      invoiceForm.resetFields();
    },
    onError: () => message.error('Failed to update status'),
  });

  const invoiceDeleteMutation = useMutation({
    mutationFn: ({ id, migrateToId }: { id: string; migrateToId?: string }) =>
      settingsService.invoiceStatuses.delete(id, migrateToId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      message.success('Status deleted');
      closeMigrationModal();
    },
    onError: () => message.error('Failed to delete status. It may be in use.'),
  });

  const invoiceReorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.invoiceStatuses.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceStatuses'] });
    },
    onError: () => message.error('Failed to reorder statuses'),
  });

  // ===== Category Mutations =====
  const categoryCreateMutation = useMutation({
    mutationFn: (data: CategoryCreate) => settingsService.categories.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category created');
      setCategoryModalOpen(false);
      setEditingCategory(null);
      categoryForm.resetFields();
    },
    onError: () => message.error('Failed to create category'),
  });

  const categoryUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CategoryCreate> }) =>
      settingsService.categories.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category updated');
      setCategoryModalOpen(false);
      setEditingCategory(null);
      categoryForm.resetFields();
    },
    onError: () => message.error('Failed to update category'),
  });

  const categoryDeleteMutation = useMutation({
    mutationFn: (id: string) => settingsService.categories.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
      message.success('Category deleted');
    },
    onError: () => message.error('Failed to delete category. It may be in use.'),
  });

  const categoryReorderMutation = useMutation({
    mutationFn: (ids: string[]) => settingsService.categories.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineItemCategories'] });
    },
    onError: () => message.error('Failed to reorder categories'),
  });

  // ===== Drag & Drop Handlers =====
  const handleEstimateDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = estimateStatuses.findIndex((item) => item.id === active.id);
      const newIndex = estimateStatuses.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(estimateStatuses, oldIndex, newIndex);
      queryClient.setQueryData(['estimateStatuses'], newOrder);
      estimateReorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  const handleInvoiceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = invoiceStatuses.findIndex((item) => item.id === active.id);
      const newIndex = invoiceStatuses.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(invoiceStatuses, oldIndex, newIndex);
      queryClient.setQueryData(['invoiceStatuses'], newOrder);
      invoiceReorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = categories.findIndex((item) => item.id === active.id);
      const newIndex = categories.findIndex((item) => item.id === over.id);
      const newOrder = arrayMove(categories, oldIndex, newIndex);
      queryClient.setQueryData(['lineItemCategories'], newOrder);
      categoryReorderMutation.mutate(newOrder.map((item) => item.id));
    }
  };

  // ===== Migration Modal Handlers =====
  const closeMigrationModal = () => {
    setMigrationModalOpen(false);
    setStatusToDelete(null);
    setUsageInfo(null);
    setMigrationLoading(false);
  };

  const handleDeleteEstimateStatus = async (record: EstimateStatusConfig) => {
    // If no usage or usage is 0, delete directly
    if (!record.usageCount || record.usageCount === 0) {
      estimateDeleteMutation.mutate({ id: record.id });
      return;
    }

    // Fetch detailed usage info and show migration modal
    setUsageLoading(true);
    try {
      const usage = await settingsService.estimateStatuses.getUsage(record.id);
      setStatusToDelete(record);
      setUsageInfo(usage);
      setMigrationStatusType('estimate');
      setMigrationModalOpen(true);
    } catch {
      message.error('Failed to get status usage information');
    } finally {
      setUsageLoading(false);
    }
  };

  const handleDeleteInvoiceStatus = async (record: InvoiceStatusConfig) => {
    // If no usage or usage is 0, delete directly
    if (!record.usageCount || record.usageCount === 0) {
      invoiceDeleteMutation.mutate({ id: record.id });
      return;
    }

    // Fetch detailed usage info and show migration modal
    setUsageLoading(true);
    try {
      const usage = await settingsService.invoiceStatuses.getUsage(record.id);
      setStatusToDelete(record);
      setUsageInfo(usage);
      setMigrationStatusType('invoice');
      setMigrationModalOpen(true);
    } catch {
      message.error('Failed to get status usage information');
    } finally {
      setUsageLoading(false);
    }
  };

  const handleMigrationConfirm = async (migrateToId: string) => {
    if (!statusToDelete) return;

    setMigrationLoading(true);
    if (migrationStatusType === 'estimate') {
      estimateDeleteMutation.mutate({ id: statusToDelete.id, migrateToId });
    } else {
      invoiceDeleteMutation.mutate({ id: statusToDelete.id, migrateToId });
    }
  };

  // ===== Save Handlers =====
  const handleSaveEstimateStatus = async () => {
    try {
      const values = await estimateForm.validateFields();
      const colorValue = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#6b7280';
      const payload: StatusConfigCreate = {
        name: values.name,
        label: values.name,
        color: colorValue,
        bg_color: generateBgColor(colorValue),
        is_default: values.isDefault || false,
      };

      if (editingEstimateStatus) {
        estimateUpdateMutation.mutate({ id: editingEstimateStatus.id, data: payload });
      } else {
        estimateCreateMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  const handleSaveInvoiceStatus = async () => {
    try {
      const values = await invoiceForm.validateFields();
      const colorValue = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#6b7280';
      const payload: StatusConfigCreate = {
        name: values.name,
        label: values.name,
        color: colorValue,
        bg_color: generateBgColor(colorValue),
        is_default: values.isDefault || false,
      };

      if (editingInvoiceStatus) {
        invoiceUpdateMutation.mutate({ id: editingInvoiceStatus.id, data: payload });
      } else {
        invoiceCreateMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  const handleSaveCategory = async () => {
    try {
      const values = await categoryForm.validateFields();
      const colorValue = values.color
        ? typeof values.color === 'string'
          ? values.color
          : values.color?.toHexString?.() || undefined
        : undefined;
      const payload: CategoryCreate = {
        name: values.name,
        color: colorValue,
        is_default: values.isDefault || false,
      };

      if (editingCategory) {
        categoryUpdateMutation.mutate({ id: editingCategory.id, data: payload });
      } else {
        categoryCreateMutation.mutate(payload);
      }
    } catch {
      // Validation error
    }
  };

  // ===== Edit Handlers =====
  const handleEditEstimateStatus = (record: EstimateStatusConfig) => {
    setEditingEstimateStatus(record);
    estimateForm.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setEstimateModalOpen(true);
  };

  const handleEditInvoiceStatus = (record: InvoiceStatusConfig) => {
    setEditingInvoiceStatus(record);
    invoiceForm.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setInvoiceModalOpen(true);
  };

  const handleEditCategory = (record: LineItemCategory) => {
    setEditingCategory(record);
    categoryForm.setFieldsValue({
      name: record.name,
      color: record.color,
      isDefault: record.isDefault,
    });
    setCategoryModalOpen(true);
  };

  // ===== Table Columns =====
  const estimateStatusColumns: ColumnsType<EstimateStatusConfig> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: colors.textPrimary,
              background: record.bgColor,
            }}
          >
            {text.charAt(0).toUpperCase() + text.slice(1)}
          </span>
          {record.isDefault && (
            <Tooltip title="Default status for new estimates">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) => (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: color,
            border: `1px solid ${colors.border}`,
          }}
        />
      ),
    },
    {
      title: 'In Use',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => {
        const isConvertedStatus = record.name.toLowerCase() === 'converted';
        const canDelete = !record.isSystem && !isConvertedStatus;
        const hasUsage = record.usageCount && record.usageCount > 0;

        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <Button type="text" icon={<EditOutlined />} onClick={() => handleEditEstimateStatus(record)} />
            {hasUsage ? (
              // Status is in use - show button that opens migration modal
              <Tooltip title={isConvertedStatus ? 'Cannot delete: Required for invoice conversion' : undefined}>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  danger
                  disabled={!canDelete}
                  loading={usageLoading && statusToDelete?.id === record.id}
                  onClick={() => handleDeleteEstimateStatus(record)}
                />
              </Tooltip>
            ) : (
              // Status not in use - show simple popconfirm
              <Popconfirm
                title="Delete this status?"
                description="This action cannot be undone."
                onConfirm={() => estimateDeleteMutation.mutate({ id: record.id })}
                okText="Delete"
                okButtonProps={{ danger: true }}
                disabled={!canDelete}
              >
                <Tooltip title={isConvertedStatus ? 'Cannot delete: Required for invoice conversion' : undefined}>
                  <Button
                    type="text"
                    icon={<DeleteOutlined />}
                    danger
                    disabled={!canDelete}
                  />
                </Tooltip>
              </Popconfirm>
            )}
          </div>
        );
      },
    },
  ];

  const invoiceStatusColumns: ColumnsType<InvoiceStatusConfig> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: colors.textPrimary,
              background: record.bgColor,
            }}
          >
            {text.charAt(0).toUpperCase() + text.slice(1)}
          </span>
          {record.isDefault && (
            <Tooltip title="Default status for new invoices">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) => (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: color,
            border: `1px solid ${colors.border}`,
          }}
        />
      ),
    },
    {
      title: 'In Use',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 80,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => {
        const canDelete = !record.isSystem;
        const hasUsage = record.usageCount && record.usageCount > 0;

        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <Button type="text" icon={<EditOutlined />} onClick={() => handleEditInvoiceStatus(record)} />
            {hasUsage ? (
              // Status is in use - show button that opens migration modal
              <Button
                type="text"
                icon={<DeleteOutlined />}
                danger
                disabled={!canDelete}
                loading={usageLoading && statusToDelete?.id === record.id}
                onClick={() => handleDeleteInvoiceStatus(record)}
              />
            ) : (
              // Status not in use - show simple popconfirm
              <Popconfirm
                title="Delete this status?"
                description="This action cannot be undone."
                onConfirm={() => invoiceDeleteMutation.mutate({ id: record.id })}
                okText="Delete"
                okButtonProps={{ danger: true }}
                disabled={!canDelete}
              >
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  danger
                  disabled={!canDelete}
                />
              </Popconfirm>
            )}
          </div>
        );
      },
    },
  ];

  const categoryColumns: ColumnsType<LineItemCategory> = [
    {
      key: 'drag',
      dataIndex: 'drag',
      width: 40,
      render: () => null,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 500 }}>{text}</span>
          {record.isDefault && (
            <Tooltip title="Default category for new line items">
              <CheckCircleOutlined style={{ color: colors.success }} />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color) =>
        color ? (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: color,
              border: `1px solid ${colors.border}`,
            }}
          />
        ) : (
          <span style={{ color: colors.textMuted }}>-</span>
        ),
    },
    {
      title: 'Line Items',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 100,
      render: (count) => <span style={{ color: colors.textSecondary }}>{count || 0}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEditCategory(record)} />
          <Popconfirm
            title="Delete this category?"
            description={
              record.usageCount && record.usageCount > 0
                ? `This category is used by ${record.usageCount} line item(s). Delete anyway?`
                : 'This action cannot be undone.'
            }
            onConfirm={() => categoryDeleteMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </div>
      ),
    },
  ];

  // ===== Collapse Items =====
  const collapseItems = [
    {
      key: 'estimate-statuses',
      label: (
        <div>
          <div style={{ fontFamily: fonts.heading, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: colors.textPrimary }}>
            Estimate Statuses
          </div>
          {!isMobile && (
            <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
              Customize the statuses available for your estimates
            </div>
          )}
        </div>
      ),
      extra: (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setEstimateModalOpen(true);
          }}
          style={{ background: colors.primary }}
        >
          {isMobile ? 'Add' : 'Add Status'}
        </Button>
      ),
      children: (
        <Spin spinning={estimateStatusesLoading}>
          {estimateStatuses.length === 0 ? (
            <Empty description="No statuses configured" />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleEstimateDragEnd}>
              <SortableContext items={estimateStatuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <Table
                  className="compact-table"
                  columns={estimateStatusColumns}
                  dataSource={estimateStatuses}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  components={{
                    body: {
                      row: SortableRow,
                    },
                  }}
                />
              </SortableContext>
            </DndContext>
          )}
        </Spin>
      ),
    },
    {
      key: 'invoice-statuses',
      label: (
        <div>
          <div style={{ fontFamily: fonts.heading, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: colors.textPrimary }}>
            Invoice Statuses
          </div>
          {!isMobile && (
            <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
              Customize the statuses available for your invoices
            </div>
          )}
        </div>
      ),
      extra: (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setInvoiceModalOpen(true);
          }}
          style={{ background: colors.primary }}
        >
          {isMobile ? 'Add' : 'Add Status'}
        </Button>
      ),
      children: (
        <Spin spinning={invoiceStatusesLoading}>
          {invoiceStatuses.length === 0 ? (
            <Empty description="No statuses configured" />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleInvoiceDragEnd}>
              <SortableContext items={invoiceStatuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <Table
                  className="compact-table"
                  columns={invoiceStatusColumns}
                  dataSource={invoiceStatuses}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  components={{
                    body: {
                      row: SortableRow,
                    },
                  }}
                />
              </SortableContext>
            </DndContext>
          )}
        </Spin>
      ),
    },
    {
      key: 'categories',
      label: (
        <div>
          <div style={{ fontFamily: fonts.heading, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: colors.textPrimary }}>
            Line Item Categories
          </div>
          {!isMobile && (
            <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
              Organize your line items with custom categories
            </div>
          )}
        </div>
      ),
      extra: (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setCategoryModalOpen(true);
          }}
          style={{ background: colors.primary }}
        >
          {isMobile ? 'Add' : 'Add Category'}
        </Button>
      ),
      children: (
        <Spin spinning={categoriesLoading}>
          {categories.length === 0 ? (
            <Empty description="No categories configured" />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
              <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <Table
                  className="compact-table"
                  columns={categoryColumns}
                  dataSource={categories}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  components={{
                    body: {
                      row: SortableRow,
                    },
                  }}
                />
              </SortableContext>
            </DndContext>
          )}
        </Spin>
      ),
    },
  ];

  return (
    <div>
      <Collapse
        defaultActiveKey={['estimate-statuses', 'invoice-statuses', 'categories']}
        bordered={false}
        items={collapseItems}
        style={{ background: 'transparent' }}
      />

      {/* Estimate Status Modal */}
      <Modal
        title={editingEstimateStatus ? 'Edit Status' : 'Add Status'}
        open={estimateModalOpen}
        onOk={handleSaveEstimateStatus}
        onCancel={() => {
          setEstimateModalOpen(false);
          setEditingEstimateStatus(null);
          estimateForm.resetFields();
        }}
        okText={editingEstimateStatus ? 'Save Changes' : 'Add Status'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: estimateCreateMutation.isPending || estimateUpdateMutation.isPending,
        }}
      >
        <Form form={estimateForm} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Status Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Pending Review" />
          </Form.Item>
          <Form.Item name="color" label="Color" rules={[{ required: true, message: 'Please select a color' }]}>
            <ColorPicker
              showText
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default status will be automatically assigned to new estimates.
          </p>
        </Form>
      </Modal>

      {/* Invoice Status Modal */}
      <Modal
        title={editingInvoiceStatus ? 'Edit Status' : 'Add Status'}
        open={invoiceModalOpen}
        onOk={handleSaveInvoiceStatus}
        onCancel={() => {
          setInvoiceModalOpen(false);
          setEditingInvoiceStatus(null);
          invoiceForm.resetFields();
        }}
        okText={editingInvoiceStatus ? 'Save Changes' : 'Add Status'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: invoiceCreateMutation.isPending || invoiceUpdateMutation.isPending,
        }}
      >
        <Form form={invoiceForm} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Status Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Under Review" />
          </Form.Item>
          <Form.Item name="color" label="Color" rules={[{ required: true, message: 'Please select a color' }]}>
            <ColorPicker
              showText
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default status will be automatically assigned to new invoices.
          </p>
        </Form>
      </Modal>

      {/* Category Modal */}
      <Modal
        title={editingCategory ? 'Edit Category' : 'Add Category'}
        open={categoryModalOpen}
        onOk={handleSaveCategory}
        onCancel={() => {
          setCategoryModalOpen(false);
          setEditingCategory(null);
          categoryForm.resetFields();
        }}
        okText={editingCategory ? 'Save Changes' : 'Add Category'}
        okButtonProps={{
          style: { background: colors.primary },
          loading: categoryCreateMutation.isPending || categoryUpdateMutation.isPending,
        }}
      >
        <Form form={categoryForm} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Category Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Demolition" />
          </Form.Item>
          <Form.Item name="color" label="Color (Optional)">
            <ColorPicker
              showText
              allowClear
              presets={[{ label: 'Recommended', colors: colorPresets }]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="Set as Default" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: -12 }}>
            Default category will be pre-selected when creating new line items.
          </p>
        </Form>
      </Modal>

      {/* Status Migration Modal */}
      <StatusMigrationModal
        open={migrationModalOpen}
        onClose={closeMigrationModal}
        onConfirm={handleMigrationConfirm}
        loading={migrationLoading}
        statusType={migrationStatusType}
        statusToDelete={statusToDelete}
        usageInfo={usageInfo}
        availableStatuses={migrationStatusType === 'estimate' ? estimateStatuses : invoiceStatuses}
      />
    </div>
  );
};

// ==================== Company Settings Tab ====================
const CompanySettings: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const primaryColorValue = Form.useWatch('primaryColor', form);
  const derivedSecondaryColor = deriveSecondaryColor(resolveColorHex(primaryColorValue, '#111827'));

  // Fetch company data
  const { data: company, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: companyService.get,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: companyService.update,
    onSuccess: () => {
      message.success('Settings saved successfully');
      queryClient.invalidateQueries({ queryKey: ['company'] });
    },
    onError: () => {
      message.error('Failed to save settings');
    },
  });

  // Populate form when company data loads
  React.useEffect(() => {
    if (company) {
      form.setFieldsValue({
        name: company.name,
        email: company.email,
        phone: company.phone,
        addressLine1: company.addressLine1,
        city: company.city,
        state: company.state,
        zipcode: company.zipcode,
        primaryColor: company.primaryColor || '#111827',
      });
    }
  }, [company, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // Convert the picked color to a hex string, then auto-derive the accent color from it
      const primaryColor = resolveColorHex(values.primaryColor, '#111827');
      const secondaryColor = deriveSecondaryColor(primaryColor);

      updateMutation.mutate({
        ...values,
        primaryColor,
        secondaryColor,
      });
    } catch {
      message.error('Please fill in all required fields');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 24 }}>
        Company Information
      </h2>

      <Form form={form} layout="vertical" style={{ maxWidth: 500 }}>
        <Form.Item name="name" label="Company Name" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="ABC Restoration" />
        </Form.Item>

        <Form.Item name="email" label="Email">
          <Input placeholder="info@abcrestoration.com" />
        </Form.Item>

        <Form.Item name="phone" label="Phone">
          <Input placeholder="555-0100" />
        </Form.Item>

        <Form.Item name="addressLine1" label="Address">
          <Input placeholder="123 Main St" />
        </Form.Item>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
          <Form.Item name="city" label="City" style={{ flex: 1 }}>
            <Input placeholder="New York" />
          </Form.Item>
          <Form.Item name="state" label="State" style={{ width: isMobile ? '100%' : 100 }}>
            <Input placeholder="NY" />
          </Form.Item>
          <Form.Item name="zipcode" label="ZIP" style={{ width: isMobile ? '100%' : 100 }}>
            <Input placeholder="10001" />
          </Form.Item>
        </div>

        <Divider />

        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Branding</h3>

        <Form.Item name="logo" label="Logo" valuePropName="fileList" getValueFromEvent={(e) => e?.fileList}>
          <Upload maxCount={1} beforeUpload={() => false}>
            <Button icon={<UploadOutlined />}>Upload Logo</Button>
          </Upload>
        </Form.Item>

        <Divider />

        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          PDF Theme Color
        </h3>
        <p style={{ color: colors.textSecondary, marginBottom: 16, fontSize: 13 }}>
          Pick your brand color and we'll use it in your PDF documents — headings, section bars, and
          borders. A softer accent shade for subtitles and dividers is generated from it automatically.
        </p>

        <Form.Item name="primaryColor" label="Brand Color" style={{ marginBottom: 24 }}>
          <ColorPicker
            showText
            disabledAlpha
            presets={[{ label: 'Recommended', colors: colorPresets }]}
          />
        </Form.Item>

        {/* Color Preview */}
        <div
          style={{
            background: colors.bgLight,
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            border: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>Preview</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div
              style={{
                width: 80,
                height: 40,
                borderRadius: 6,
                background: resolveColorHex(primaryColorValue, '#111827'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Brand
            </div>
            <div
              style={{
                width: 80,
                height: 40,
                borderRadius: 6,
                background: derivedSecondaryColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.textPrimary,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Accent
            </div>
          </div>
        </div>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={updateMutation.isPending}
          style={{ background: colors.primary }}
        >
          Save Changes
        </Button>
      </Form>
    </div>
  );
};

// ==================== Tax & Defaults Tab ====================
const TaxSettings: React.FC = () => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Fetch company data
  const { data: company, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: companyService.get,
  });

  // Update company mutation
  const updateMutation = useMutation({
    mutationFn: companyService.update,
    onSuccess: () => {
      message.success('Settings saved successfully');
      queryClient.invalidateQueries({ queryKey: ['company'] });
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to save settings');
    },
  });

  // Populate form when company data is loaded
  React.useEffect(() => {
    if (company) {
      form.setFieldsValue({
        defaultTaxRate: company.defaultTaxRate,
        defaultTaxLabel: company.defaultTaxLabel,
        estimatePrefix: company.estimatePrefix,
        nextEstimateNumber: company.nextEstimateNumber,
        invoicePrefix: company.invoicePrefix,
        nextInvoiceNumber: company.nextInvoiceNumber,
        defaultEstimateValidityDays: company.defaultEstimateValidityDays,
        defaultInvoiceDueDays: company.defaultInvoiceDueDays,
      });
    }
  }, [company, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      updateMutation.mutate(values);
    } catch {
      message.error('Please fill in all required fields');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 24 }}>
        Tax & Defaults
      </h2>

      <Form form={form} layout="vertical" style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
          <Form.Item name="defaultTaxRate" label="Default Tax Rate (%)" style={{ width: isMobile ? '100%' : 180 }}>
            <InputNumber min={0} max={100} precision={2} placeholder="8.25" style={{ width: '100%' }} inputMode="decimal" />
          </Form.Item>
          <Form.Item name="defaultTaxLabel" label="Tax Label" style={{ flex: 1 }}>
            <Input placeholder="Sales Tax" />
          </Form.Item>
        </div>

        <Divider />

        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Document Numbering
        </h3>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
          <Form.Item
            name="estimatePrefix"
            label="Estimate Prefix"
            style={{ width: isMobile ? '100%' : 140 }}
            rules={[
              { required: true, message: 'Required' },
              { whitespace: true, message: 'Cannot be empty' },
            ]}
          >
            <Input placeholder="EST" maxLength={10} />
          </Form.Item>
          <Form.Item
            name="nextEstimateNumber"
            label="Next Number"
            style={{ width: isMobile ? '100%' : 130 }}
            rules={[
              { required: true, message: 'Required' },
              { type: 'number', min: 1, message: 'Min 1' },
            ]}
          >
            <InputNumber min={1} placeholder="1001" style={{ width: '100%' }} inputMode="numeric" />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
          <Form.Item
            name="invoicePrefix"
            label="Invoice Prefix"
            style={{ width: isMobile ? '100%' : 140 }}
            rules={[
              { required: true, message: 'Required' },
              { whitespace: true, message: 'Cannot be empty' },
            ]}
          >
            <Input placeholder="INV" maxLength={10} />
          </Form.Item>
          <Form.Item
            name="nextInvoiceNumber"
            label="Next Number"
            style={{ width: isMobile ? '100%' : 130 }}
            rules={[
              { required: true, message: 'Required' },
              { type: 'number', min: 1, message: 'Min 1' },
            ]}
          >
            <InputNumber min={1} placeholder="1001" style={{ width: '100%' }} inputMode="numeric" />
          </Form.Item>
        </div>

        <Divider />

        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Default Terms
        </h3>

        <Form.Item name="defaultEstimateValidityDays" label="Estimate Valid For (days)">
          <InputNumber min={1} placeholder="30" style={{ width: isMobile ? '100%' : 120 }} inputMode="numeric" />
        </Form.Item>

        <Form.Item name="defaultInvoiceDueDays" label="Invoice Due In (days)">
          <InputNumber min={1} placeholder="30" style={{ width: isMobile ? '100%' : 120 }} inputMode="numeric" />
        </Form.Item>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={updateMutation.isPending}
          style={{ background: colors.primary }}
        >
          Save Changes
        </Button>
      </Form>
    </div>
  );
};

// ==================== Subscription Tab ====================
const SubscriptionSettings: React.FC = () => {
  return (
    <div>
      <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 24 }}>
        Subscription
      </h2>

      <Badge.Ribbon text="Beta" color={colors.primary}>
        <div
          style={{
            background: colors.bgLight,
            borderRadius: 12,
            padding: 24,
            border: `1px solid ${colors.border}`,
            maxWidth: 500,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.textPrimary, marginBottom: 8 }}>
            Free Beta Access
          </div>
          <div style={{ color: colors.textSecondary, marginBottom: 16 }}>
            You have access to all features during the beta period.
          </div>
          <ul style={{ color: colors.textSecondary, paddingLeft: 20, marginBottom: 0 }}>
            <li>Unlimited estimates & invoices</li>
            <li>Unlimited customers & line items</li>
            <li>PDF export & email</li>
            <li>Priority support</li>
          </ul>
        </div>
      </Badge.Ribbon>

      <div style={{ marginTop: 24, padding: 20, background: '#fefce8', borderRadius: 8, maxWidth: 500 }}>
        <div style={{ fontWeight: 600, color: '#854d0e', marginBottom: 4 }}>Beta ends June 30, 2026</div>
        <div style={{ color: '#a16207', fontSize: 14 }}>
          You'll receive special pricing as a beta user when we launch.
        </div>
      </div>
    </div>
  );
};

// ==================== Account Tab ====================
const AccountSettings: React.FC = () => {
  const { user, setUser } = useAuthStore();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [selectedTemplate, setSelectedTemplate] = React.useState<string>(user?.defaultPdfTemplate || 'classic');
  const [previewTemplate, setPreviewTemplate] = React.useState<PdfTemplateId | null>(null);
  const isMobile = useIsMobile();

  // PDF Template options
  const templateOptions = [
    {
      value: 'classic',
      label: 'Classic',
      description: 'Traditional serif design with clean borders',
    },
    {
      value: 'modern',
      label: 'Modern',
      description: 'Contemporary sans-serif with bold accents',
    },
    {
      value: 'professional',
      label: 'Professional',
      description: 'Corporate design with structured layout',
    },
    {
      value: 'detailed',
      label: 'Detailed',
      description: 'Section-based layout with subtotals and line-item details',
    },
  ];

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: authService.updateProfile,
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      // Update form with new values
      form.setFieldsValue({
        fullName: updatedUser.fullName,
        email: updatedUser.email,
      });
      setSelectedTemplate(updatedUser.defaultPdfTemplate || 'classic');
      message.success('Profile updated successfully');
    },
    onError: () => {
      message.error('Failed to update profile');
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: () => {
      message.success('Password changed successfully');
      passwordForm.resetFields();
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      const detail = error.response?.data?.detail;
      message.error(detail || 'Failed to change password');
    },
  });

  const handleSaveProfile = async () => {
    try {
      const values = await form.validateFields(['fullName']);
      updateProfileMutation.mutate({
        fullName: values.fullName,
        defaultPdfTemplate: selectedTemplate,
      });
    } catch {
      // Validation failed
    }
  };

  const handleChangePassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      if (values.newPassword !== values.confirmPassword) {
        message.error('Passwords do not match');
        return;
      }
      changePasswordMutation.mutate({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
    } catch {
      // Validation failed
    }
  };

  return (
    <div>
      <h2 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 24 }}>
        Account
      </h2>

      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 500 }}
        initialValues={{
          fullName: user?.fullName,
          email: user?.email,
        }}
      >
        <Form.Item
          name="fullName"
          label="Full Name"
          rules={[{ required: true, message: 'Please enter your name' }]}
        >
          <Input placeholder="John Doe" />
        </Form.Item>

        <Form.Item name="email" label="Email">
          <Input placeholder="john@example.com" disabled />
        </Form.Item>

        <Divider />

        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Default PDF Template
        </h3>
        <p style={{ color: colors.textSecondary, marginBottom: 16, fontSize: 13 }}>
          This template will be pre-selected when generating PDFs for estimates and invoices.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {templateOptions.map((template) => {
            const isSelected = selectedTemplate === template.value;
            return (
              <div
                key={template.value}
                onClick={() => setSelectedTemplate(template.value)}
                style={{
                  padding: 14,
                  borderRadius: 8,
                  border: `2px solid ${isSelected ? colors.primary : colors.border}`,
                  background: isSelected ? `${colors.primary}08` : colors.bgWhite,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 4,
                    paddingRight: 20,
                    color: isSelected ? colors.primary : colors.textPrimary,
                  }}
                >
                  {template.label}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }}>
                  {template.description}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewTemplate(template.value as PdfTemplateId);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 10,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    color: isSelected ? colors.primary : colors.textSecondary,
                  }}
                >
                  <EyeOutlined style={{ fontSize: 13 }} />
                  Preview example
                </button>
                {isSelected && (
                  <CheckCircleOutlined
                    style={{
                      position: 'absolute',
                      top: 14,
                      right: 14,
                      color: colors.primary,
                      fontSize: 16,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <TemplatePreviewModal
          open={previewTemplate !== null}
          onClose={() => setPreviewTemplate(null)}
          template={previewTemplate || 'classic'}
          templateName={templateOptions.find((t) => t.value === previewTemplate)?.label || ''}
          isSelected={previewTemplate === selectedTemplate}
          onUseTemplate={(value) => setSelectedTemplate(value)}
        />

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSaveProfile}
          loading={updateProfileMutation.isPending}
          style={{ background: colors.primary }}
        >
          Save Profile
        </Button>
      </Form>

      <Divider />

      <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
        Change Password
      </h3>

      <Form form={passwordForm} layout="vertical" style={{ maxWidth: 500 }}>
        <Form.Item
          name="currentPassword"
          label="Current Password"
          rules={[{ required: true, message: 'Please enter current password' }]}
        >
          <Input.Password placeholder="Enter current password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[
            { required: true, message: 'Please enter new password' },
            { min: 8, message: 'Password must be at least 8 characters' },
          ]}
        >
          <Input.Password placeholder="Enter new password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm Password"
          rules={[{ required: true, message: 'Please confirm password' }]}
        >
          <Input.Password placeholder="Confirm new password" />
        </Form.Item>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleChangePassword}
          loading={changePasswordMutation.isPending}
          style={{ background: colors.primary }}
        >
          Change Password
        </Button>
      </Form>
    </div>
  );
};

// ==================== Main Settings Page ====================
const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const getActiveKey = () => {
    const path = location.pathname;
    if (path === '/app/settings' || path === '/app/settings/') return 'company';
    if (path.includes('/tax')) return 'tax';
    if (path.includes('/customization')) return 'customization';
    if (path.includes('/documents')) return 'documents';
    if (path.includes('/subscription')) return 'subscription';
    if (path.includes('/account')) return 'account';
    return 'company';
  };

  const handleTabChange = (key: string) => {
    switch (key) {
      case 'company':
        navigate('/app/settings');
        break;
      case 'tax':
        navigate('/app/settings/tax');
        break;
      case 'customization':
        navigate('/app/settings/customization');
        break;
      case 'documents':
        navigate('/app/settings/documents');
        break;
      case 'subscription':
        navigate('/app/settings/subscription');
        break;
      case 'account':
        navigate('/app/settings/account');
        break;
    }
  };

  const tabItems = [
    { key: 'company', label: 'Company' },
    { key: 'tax', label: 'Tax & Defaults' },
    { key: 'customization', label: 'Customization' },
    { key: 'documents', label: 'Documents' },
    { key: 'subscription', label: 'Subscription' },
    { key: 'account', label: 'Account' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 22, fontWeight: 700, marginBottom: isMobile ? 16 : 20, letterSpacing: '-0.01em' }}>Settings</h1>

      <Card style={{ borderRadius: 12 }} styles={{ body: { padding: 0 } }}>
        <Tabs
          tabPosition="top"
          activeKey={getActiveKey()}
          onChange={handleTabChange}
          items={tabItems}
          tabBarStyle={{
            padding: isMobile ? '0 0 0 12px' : '0 0 0 20px',
            marginBottom: 0,
            borderBottom: `1px solid ${colors.border}`,
            minHeight: isMobile ? 48 : 56,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
          style={{ width: '100%' }}
        />
        <div style={{ padding: isMobile ? 16 : 24 }}>
          <Routes>
            <Route index element={<CompanySettings />} />
            <Route path="tax" element={<TaxSettings />} />
            <Route path="customization" element={<CustomizationSettings />} />
            <Route path="documents" element={<CompanyDocumentsSettings />} />
            <Route path="subscription" element={<SubscriptionSettings />} />
            <Route path="account" element={<AccountSettings />} />
          </Routes>
        </div>
      </Card>
    </motion.div>
  );
};

export default SettingsPage;
