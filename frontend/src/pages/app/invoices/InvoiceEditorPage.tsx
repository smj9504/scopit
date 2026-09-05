/**
 * Scopit - Invoice Editor Page
 * Section-based line item management with multi-select, copy/paste, drag & drop
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Input,
  InputNumber,
  Select,
  Checkbox,
  Dropdown,
  Modal,
  Form,
  DatePicker,
  App,
  Divider,
  Tooltip,
  Tag,
  Spin,
  List,
  AutoComplete,
  Space,
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  MoreOutlined,
  HolderOutlined,
  DeleteOutlined,
  CopyOutlined,
  ScissorOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CloseOutlined,
  FileTextOutlined,
  SearchOutlined,
  EyeOutlined,
  EditOutlined,
  CameraOutlined,
  PaperClipOutlined,
  UploadOutlined,
  AppstoreAddOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, fonts, shadows } from '@/styles/theme';
import { formatCurrency } from '@/utils/formatters';
import { CustomerSelector, CustomerData } from '@/components/features/CustomerSelector';
import { invoiceService } from '@/services/invoiceService';
import { lineItemService } from '@/services/lineItemService';
import { settingsService } from '@/services/settingsService';
import { useInvoiceStatuses, getStatusDisplay } from '@/hooks/useSettings';
import { useIsMobile, useIsNarrow } from '@/hooks/useIsMobile';
import { useBackNav } from '@/hooks/useHeaderNav';
import { MobileLineItemDrawer, MobileLineItemCard } from '@/components/common/MobileLineItemDrawer';
import { PdfPreviewModal } from '@/components/features/PdfPreviewModal';
import type { InvoiceStatus, InvoiceCreate, InvoiceUpdate, Invoice, LineItem, Payment, PaymentMethod, PdfTemplateInfo, PdfTemplateId } from '@/types/entities';

// Types
interface LineItemImage {
  filename: string;
  data: string;
}

interface LineItemData {
  id: string;
  sectionId: string;
  lineItemId?: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  isTaxable: boolean;
  orderIndex: number;
  notes?: string[];
  images?: LineItemImage[];
  saveToLibrary?: boolean;
}

interface SectionData {
  id: string;
  name: string;
  isCollapsed: boolean;
  orderIndex: number;
}

// Payment terms options
const paymentTermsOptions = [
  { value: 0, label: 'Due on Receipt' },
  { value: 7, label: 'Net 7' },
  { value: 15, label: 'Net 15' },
  { value: 30, label: 'Net 30' },
  { value: 45, label: 'Net 45' },
  { value: 60, label: 'Net 60' },
];

// Generate unique ID
const generateId = () => Math.random().toString(36).substr(2, 9);

// Sortable Line Item Row
const SortableLineItem: React.FC<{
  item: LineItemData;
  isSelected: boolean;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<LineItemData>) => void;
  onDelete: () => void;
  onManageNotes: () => void;
  onManagePhotos: () => void;
  onEdit: () => void;
}> = ({ item, isSelected, onToggleSelect, onUpdate, onDelete, onManageNotes, onManagePhotos, onEdit }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const isNarrow = useIsNarrow();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const total = item.quantity * item.unitPrice;
  const hasNotes = item.notes && item.notes.length > 0;
  const hasPhotos = item.images && item.images.length > 0;

  // On narrow/iPad screens shrink numeric column widths to fit
  const qtyWidth = isNarrow ? 68 : 80;
  const unitWidth = isNarrow ? 64 : 80;
  const priceWidth = isNarrow ? 90 : 100;
  const totalWidth = isNarrow ? 84 : 100;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: isNarrow ? 4 : 8,
        padding: '8px 12px',
        background: isSelected ? colors.accentSubtle : colors.bgWhite,
        borderBottom: `1px solid ${colors.border}`,
        transition: 'background 0.15s ease',
      }}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: colors.textMuted, padding: 4, flexShrink: 0 }}
      >
        <HolderOutlined />
      </div>

      {/* Checkbox */}
      <Checkbox checked={isSelected} onChange={onToggleSelect} style={{ flexShrink: 0 }} />

      {/* Name */}
      <div style={{ flex: 2, minWidth: 0 }}>
        <Input
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Item name"
          variant="borderless"
          style={{ fontWeight: 500 }}
        />
        {item.description && (
          <div style={{ fontSize: 12, color: colors.textSecondary, paddingLeft: 11 }}>
            {item.description}
          </div>
        )}
      </div>

      {/* Notes Button */}
      <Tooltip title={hasNotes ? `${item.notes!.length} note(s) attached` : 'Add notes'}>
        <Button
          type="text"
          size="small"
          icon={<FileTextOutlined />}
          onClick={onManageNotes}
          style={{ color: hasNotes ? colors.primary : colors.textMuted, flexShrink: 0 }}
        >
          {hasNotes ? item.notes!.length : ''}
        </Button>
      </Tooltip>

      {/* Photos Button */}
      <Tooltip title={hasPhotos ? `${item.images!.length} photo(s) attached` : 'Add photos'}>
        <Button
          type="text"
          size="small"
          icon={<CameraOutlined />}
          onClick={onManagePhotos}
          style={{ color: hasPhotos ? colors.primary : colors.textMuted, flexShrink: 0 }}
        >
          {hasPhotos ? item.images!.length : ''}
        </Button>
      </Tooltip>

      {/* Quantity */}
      <div style={{ width: qtyWidth, flexShrink: 0 }}>
        <InputNumber
          value={item.quantity}
          onChange={(val) => onUpdate({ quantity: val ?? 0 })}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          inputMode="decimal"
        />
      </div>

      {/* Unit */}
      <div style={{ width: unitWidth, flexShrink: 0 }}>
        <AutoComplete
          value={item.unit}
          onChange={(val) => onUpdate({ unit: val })}
          style={{ width: '100%' }}
          options={[
            { value: 'EA', label: 'EA' },
            { value: 'SF', label: 'SF' },
            { value: 'LF', label: 'LF' },
            { value: 'HR', label: 'HR' },
            { value: 'DAY', label: 'DAY' },
          ]}
          filterOption={(input, option) =>
            option?.label?.toString().toLowerCase().includes(input.toLowerCase()) ?? false
          }
        />
      </div>

      {/* Unit Price */}
      <div style={{ width: priceWidth, flexShrink: 0 }}>
        <InputNumber
          value={item.unitPrice}
          onChange={(val) => onUpdate({ unitPrice: val ?? 0 })}
          min={0}
          precision={2}
          prefix="$"
          style={{ width: '100%' }}
          inputMode="decimal"
        />
      </div>

      {/* Total */}
      <div style={{ width: totalWidth, textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 600 }}>{formatCurrency(total)}</div>
        {!item.isTaxable && (
          <div style={{ fontSize: 10, color: colors.textMuted }}>Non-tax</div>
        )}
      </div>

    </div>
  );
};

// Section Component
const Section: React.FC<{
  section: SectionData;
  items: LineItemData[];
  selectedIds: Set<string>;
  clipboardCount: number;
  onToggleCollapse: () => void;
  onUpdateSection: (updates: Partial<SectionData>) => void;
  onDeleteSection: () => void;
  onAddItem: () => void;
  onAddFromLibrary: () => void;
  onPasteHere: () => void;
  onToggleSelect: (itemId: string) => void;
  onSelectAllInSection: () => void;
  onUpdateItem: (itemId: string, updates: Partial<LineItemData>) => void;
  onDeleteItem: (itemId: string) => void;
  onManageItemNotes: (itemId: string) => void;
  onManageItemPhotos: (itemId: string) => void;
  // Mobile props
  isMobile?: boolean;
  onMobileAddItem?: () => void;
  onMobileEditItem?: (item: LineItemData) => void;
}> = ({
  section,
  items,
  selectedIds,
  clipboardCount,
  onToggleCollapse,
  onUpdateSection,
  onDeleteSection,
  onAddItem,
  onAddFromLibrary,
  onPasteHere,
  onToggleSelect,
  onSelectAllInSection,
  onUpdateItem,
  onDeleteItem,
  onManageItemNotes,
  onManageItemPhotos,
  isMobile = false,
  onMobileAddItem,
  onMobileEditItem,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100) / 100, 0);
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const someSelected = items.some((item) => selectedIds.has(item.id));

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: section.id, data: { type: 'section' } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        style={{
          borderRadius: 8,
          marginBottom: 12,
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Section Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: colors.bgLight,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            style={{ cursor: 'grab', color: colors.textMuted }}
          >
            <HolderOutlined />
          </div>

          {/* Select All Checkbox */}
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onChange={onSelectAllInSection}
          />

          {/* Collapse Toggle */}
          <Button
            type="text"
            size="small"
            icon={section.isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
            onClick={onToggleCollapse}
          />

          {/* Section Name */}
          {isEditing ? (
            <Input
              value={section.name}
              onChange={(e) => onUpdateSection({ name: e.target.value })}
              onBlur={() => setIsEditing(false)}
              onPressEnter={() => setIsEditing(false)}
              autoFocus
              style={{ width: 200, minWidth: 0 }}
            />
          ) : (
            // Ellipsis rather than wrap: on a phone this row is already tight,
            // and a wrapping name collapses it into a tall one-word column.
            <span
              title={section.name}
              style={{
                fontFamily: fonts.heading,
                fontWeight: 600,
                cursor: 'pointer',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setIsEditing(true)}
            >
              {section.name}
            </span>
          )}

          {/* Subtotal */}
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontWeight: 600 }}>
            {formatCurrency(subtotal)}
          </span>

          {/* Add Item Button */}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'new',
                  icon: <PlusOutlined />,
                  label: 'Add Custom Item',
                  onClick: isMobile && onMobileAddItem ? onMobileAddItem : onAddItem,
                },
                {
                  key: 'library',
                  icon: <AppstoreAddOutlined />,
                  label: 'Add from Library',
                  onClick: onAddFromLibrary,
                },
                ...(clipboardCount > 0
                  ? [
                      { type: 'divider' as const },
                      {
                        key: 'paste',
                        icon: <CopyOutlined />,
                        label: `Paste ${clipboardCount} item${clipboardCount !== 1 ? 's' : ''} here`,
                        onClick: onPasteHere,
                      },
                    ]
                  : []),
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<PlusOutlined />} size="small">
              Add Item
            </Button>
          </Dropdown>

          {/* More Menu */}
          <Dropdown
            menu={{
              items: [
                { key: 'rename', label: 'Rename Section', onClick: () => setIsEditing(true) },
                { type: 'divider' },
                { key: 'delete', label: 'Delete Section', danger: true, onClick: onDeleteSection },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} size="small" />
          </Dropdown>
        </div>

        {/* Section Items */}
        {!section.isCollapsed && (
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.length > 0 ? (
              isMobile ? (
                // Mobile: Card-based items with tap to edit
                items.map((item) => (
                  <MobileLineItemCard
                    key={item.id}
                    item={item as any}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={() => onToggleSelect(item.id)}
                    onTap={() => onMobileEditItem?.(item)}
                  />
                ))
              ) : (
                // Desktop: Inline editable items
                items.map((item) => (
                  <SortableLineItem
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    onToggleSelect={() => onToggleSelect(item.id)}
                    onUpdate={(updates) => onUpdateItem(item.id, updates)}
                    onDelete={() => onDeleteItem(item.id)}
                    onManageNotes={() => onManageItemNotes(item.id)}
                    onManagePhotos={() => onManageItemPhotos(item.id)}
                    onEdit={() => onMobileEditItem?.(item)}
                  />
                ))
              )
            ) : (
              <div
                style={{
                  padding: 32,
                  textAlign: 'center',
                  color: colors.textMuted,
                }}
              >
                No items in this section.{' '}
                <Button type="link" onClick={isMobile ? onMobileAddItem : onAddItem} style={{ padding: 0 }}>
                  Add one
                </Button>
              </div>
            )}
          </SortableContext>
        )}
      </Card>
    </div>
  );
};

// Bulk Action Bar
const BulkActionBar: React.FC<{
  selectedCount: number;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onMove: () => void;
  onSaveToLibrary: () => void;
  onDeselect: () => void;
  isMobile?: boolean;
  savingToLibrary?: boolean;
}> = ({ selectedCount, onCopy, onCut, onDelete, onMove, onSaveToLibrary, onDeselect, isMobile, savingToLibrary }) => {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        style={{
          position: 'fixed',
          // On mobile: sit above the fixed save bar (approx 72px tall incl safe area)
          bottom: isMobile ? 80 : 24,
          left: isMobile ? 16 : '50%',
          right: isMobile ? 16 : 'auto',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          background: '#111827',
          borderRadius: 12,
          padding: isMobile ? '10px 12px' : '12px 20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'flex-start',
          gap: isMobile ? 8 : 16,
          zIndex: 1000,
        }}
      >
        <span style={{ color: '#fff', fontWeight: 600, fontSize: isMobile ? 13 : 14, whiteSpace: 'nowrap' }}>
          {selectedCount} selected
        </span>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />

        <Tooltip title="Copy (Ctrl+C)">
          <Button
            type="text"
            icon={<CopyOutlined style={{ color: '#fff' }} />}
            onClick={onCopy}
            size={isMobile ? 'small' : 'middle'}
          />
        </Tooltip>

        <Tooltip title="Cut (Ctrl+X)">
          <Button
            type="text"
            icon={<ScissorOutlined style={{ color: '#fff' }} />}
            onClick={onCut}
            size={isMobile ? 'small' : 'middle'}
          />
        </Tooltip>

        <Tooltip title="Move to Section">
          <Button
            type="text"
            onClick={onMove}
            style={{ color: '#fff', padding: isMobile ? '0 4px' : undefined }}
            size={isMobile ? 'small' : 'middle'}
          >
            Move
          </Button>
        </Tooltip>

        <Tooltip title="Delete">
          <Button
            type="text"
            icon={<DeleteOutlined style={{ color: '#ef4444' }} />}
            onClick={onDelete}
            size={isMobile ? 'small' : 'middle'}
          />
        </Tooltip>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />

        <Tooltip title="Save selected items to library">
          <Button
            type="text"
            icon={<SaveOutlined style={{ color: '#10b981' }} />}
            onClick={onSaveToLibrary}
            loading={savingToLibrary}
            size={isMobile ? 'small' : 'middle'}
            style={{ color: '#10b981', fontWeight: 600 }}
          >
            {!isMobile && 'Save'}
          </Button>
        </Tooltip>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />

        <Button
          type="text"
          icon={<CloseOutlined style={{ color: '#fff' }} />}
          onClick={onDeselect}
          size={isMobile ? 'small' : 'middle'}
        />
      </motion.div>
    </AnimatePresence>
  );
};

// Line Item Picker Modal
const LineItemPickerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (lineItem: LineItem, selectedNotes: string[]) => void;
}> = ({ open, onClose, onSelect }) => {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [selectedItem, setSelectedItem] = useState<LineItem | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());

  // Fetch line items
  const { data: lineItemsData, isLoading } = useQuery({
    queryKey: ['lineItems', { search, category: categoryFilter }],
    queryFn: () => lineItemService.list({ search: search || undefined, category: categoryFilter }),
    enabled: open,
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['lineItemCategories'],
    queryFn: () => settingsService.categories.list(),
    enabled: open,
    staleTime: 30000,
  });

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setCategoryFilter(undefined);
      setSelectedItem(null);
      setSelectedNotes(new Set());
    }
  }, [open]);

  const handleSelectItem = (item: LineItem) => {
    setSelectedItem(item);
    // Pre-select all notes by default
    if (item.notes && item.notes.length > 0) {
      setSelectedNotes(new Set(item.notes.map((n) => n.content)));
    } else {
      setSelectedNotes(new Set());
    }
  };

  const handleToggleNote = (noteContent: string) => {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteContent)) {
        next.delete(noteContent);
      } else {
        next.add(noteContent);
      }
      return next;
    });
  };

  const handleAdd = () => {
    if (selectedItem) {
      onSelect(selectedItem, Array.from(selectedNotes));
      setSelectedItem(null);
      setSelectedNotes(new Set());
      setSearch('');
      setCategoryFilter(undefined);
      onClose();
    }
  };

  return (
    <Modal
      title="Add from Line Item Library"
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 800}
      footer={null}
      styles={{ body: { paddingTop: 20 } }}
    >
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, minHeight: isMobile ? 300 : 400 }}>
        {/* Left: Search and List */}
        <div style={{
          flex: 1,
          borderRight: isMobile ? 'none' : `1px solid ${colors.border}`,
          borderBottom: isMobile ? `1px solid ${colors.border}` : 'none',
          paddingRight: isMobile ? 0 : 16,
          paddingBottom: isMobile ? 16 : 0,
        }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <Input
              placeholder="Search line items..."
              prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
              allowClear
            />
            <Select
              placeholder="All categories"
              value={categoryFilter}
              onChange={setCategoryFilter}
              style={{ width: 140 }}
              allowClear
              options={categories.map((cat) => ({ value: cat.name, label: cat.name }))}
            />
          </div>

          {/* Line Items List */}
          <Spin spinning={isLoading}>
            {lineItemsData?.items && lineItemsData.items.length > 0 ? (
              <List
                dataSource={lineItemsData.items}
                style={{ maxHeight: isMobile ? 200 : 350, overflow: 'auto' }}
                renderItem={(item: LineItem) => (
                  <List.Item
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    style={{
                      cursor: 'pointer',
                      padding: '12px',
                      borderRadius: 8,
                      marginBottom: 4,
                      background: selectedItem?.id === item.id ? '#eff6ff' : 'transparent',
                      border: selectedItem?.id === item.id ? `1px solid ${colors.primary}` : '1px solid transparent',
                    }}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                        <span style={{ fontWeight: 600 }}>{formatCurrency(Number(item.unitPrice || 0))}</span>
                      </div>
                      {item.includes && (
                        <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                          {item.includes}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {item.cat && (
                          <Tag style={{ border: 'none', background: colors.bgLight, fontSize: 11 }}>
                            {item.cat}
                          </Tag>
                        )}
                        {item.notes && item.notes.length > 0 && (
                          <Tag style={{ border: 'none', background: '#dbeafe', color: colors.primary, fontSize: 11 }}>
                            <FileTextOutlined /> {item.notes.length} notes
                          </Tag>
                        )}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 32, color: colors.textMuted }}>
                {isLoading ? 'Loading...' : 'No line items found'}
              </div>
            )}
          </Spin>
        </div>

        {/* Right: Selected Item Details */}
        <div style={{ width: isMobile ? '100%' : 320 }}>
          {selectedItem ? (
            <>
              <h4 style={{ fontFamily: fonts.heading, fontWeight: 600, marginBottom: 8 }}>
                {selectedItem.name}
              </h4>
              {selectedItem.includes && (
                <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
                  {selectedItem.includes}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: colors.textSecondary }}>Unit:</span>
                <span>{selectedItem.unit || 'EA'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ color: colors.textSecondary }}>Unit Price:</span>
                <span style={{ fontWeight: 600 }}>{formatCurrency(Number(selectedItem.unitPrice || 0))}</span>
              </div>

              {selectedItem.notes && selectedItem.notes.length > 0 && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <h5 style={{ fontWeight: 600, marginBottom: 8 }}>
                    Select Notes to Include:
                  </h5>
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {selectedItem.notes.map((note) => (
                      <div
                        key={note.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          padding: '8px',
                          background: colors.bgLight,
                          borderRadius: 6,
                          marginBottom: 6,
                        }}
                      >
                        <Checkbox
                          checked={selectedNotes.has(note.content)}
                          onChange={() => handleToggleNote(note.content)}
                        />
                        <span style={{ fontSize: 13 }}>{note.content}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Button
                type="primary"
                block
                onClick={handleAdd}
                style={{ marginTop: 16, background: colors.primary }}
              >
                Add to Invoice
              </Button>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: colors.textMuted, marginTop: 100 }}>
              Select an item from the list
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

// Item Notes Modal
const ItemNotesModal: React.FC<{
  open: boolean;
  item: LineItemData | null;
  onClose: () => void;
  onSave: (notes: string[]) => void;
}> = ({ open, item, onClose, onSave }) => {
  const [notes, setNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const isMobile = useIsMobile();

  useEffect(() => {
    if (item) {
      setNotes(item.notes || []);
    }
  }, [item]);

  const handleAddNote = () => {
    if (newNote.trim()) {
      setNotes([...notes, newNote.trim()]);
      setNewNote('');
    }
  };

  const handleDeleteNote = (index: number) => {
    setNotes(notes.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(notes);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && newNote.trim()) {
      e.preventDefault();
      handleAddNote();
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <FileTextOutlined style={{ flexShrink: 0 }} />
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            Notes: {item?.name}
          </span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} style={{ flex: isMobile ? 1 : undefined }}>Cancel</Button>
          <Button type="primary" onClick={handleSave} style={{ background: colors.primary, flex: isMobile ? 1 : undefined }}>
            Save Notes
          </Button>
        </div>
      }
      width={isMobile ? '100%' : 500}
      style={isMobile ? { top: 20, maxWidth: 'calc(100vw - 32px)', margin: '0 auto' } : undefined}
      styles={isMobile ? { body: { padding: '16px', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } } : undefined}
    >
      <div style={{ marginBottom: 20 }}>
        <Input.TextArea
          placeholder="Add a note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          style={{ marginBottom: 8 }}
        />
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? 12 : 8
        }}>
          <span style={{ fontSize: 12, color: colors.textSecondary, order: isMobile ? 2 : 1 }}>
            Notes will appear on the invoice for this item.
          </span>
          {newNote.trim() && (
            <Button
              type="primary"
              size={isMobile ? 'middle' : 'small'}
              onClick={handleAddNote}
              style={{ background: colors.primary, order: isMobile ? 1 : 2, flexShrink: 0 }}
            >
              Add Note
            </Button>
          )}
        </div>
      </div>

      {notes.length > 0 && (
        <>
          <Divider style={{ margin: '0 0 16px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map((note, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  background: colors.bgLight,
                  borderRadius: 8,
                  padding: '12px 16px',
                }}
              >
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                  {note}
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => handleDeleteNote(index)}
                  style={{ marginLeft: 8, flexShrink: 0 }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {notes.length === 0 && (
        <div style={{ textAlign: 'center', color: colors.textSecondary, padding: '20px 0' }}>
          No notes added yet.
        </div>
      )}
    </Modal>
  );
};

// Item Photos Modal
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ItemPhotosModal: React.FC<{
  open: boolean;
  item: LineItemData | null;
  onClose: () => void;
  onSave: (images: LineItemImage[]) => void;
}> = ({ open, item, onClose, onSave }) => {
  const { message } = App.useApp();
  const [images, setImages] = useState<LineItemImage[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const isMobile = useIsMobile();

  useEffect(() => {
    if (item) {
      setImages(item.images || []);
    }
  }, [item]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const resizeImage = (dataUrl: string, maxWidth = 1920): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.width <= maxWidth) {
          resolve(dataUrl);
          return;
        }
        const canvas = document.createElement('canvas');
        const ratio = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid: LineItemImage[] = [];

    for (const file of fileArray) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        message.warning(`${file.name}: Only JPEG, PNG, WebP allowed`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        message.warning(`${file.name}: Max 5MB per image`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        const resized = await resizeImage(base64);
        valid.push({ filename: file.name, data: resized });
      } catch {
        message.error(`Failed to process ${file.name}`);
      }
    }
    if (valid.length > 0) {
      setImages(prev => [...prev, ...valid]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDeleteImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(images);
    onClose();
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <CameraOutlined style={{ flexShrink: 0 }} />
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            Photos: {item?.name}
          </span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} style={{ flex: isMobile ? 1 : undefined }}>Cancel</Button>
          <Button type="primary" onClick={handleSave} style={{ background: colors.primary, flex: isMobile ? 1 : undefined }}>
            Save Photos
          </Button>
        </div>
      }
      width={isMobile ? '100%' : 600}
      style={isMobile ? { top: 20, maxWidth: 'calc(100vw - 32px)', margin: '0 auto' } : undefined}
      styles={isMobile ? { body: { padding: '16px', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } } : undefined}
    >
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        style={{
          border: '2px dashed #d9d9d9',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 20,
          background: '#fafafa',
          transition: 'border-color 0.2s',
        }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/jpeg,image/png,image/webp';
          input.multiple = true;
          input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (files) handleFiles(files);
          };
          input.click();
        }}
      >
        <UploadOutlined style={{ fontSize: 24, color: colors.textSecondary, marginBottom: 8 }} />
        <div style={{ color: colors.textSecondary, fontSize: 13 }}>
          Click or drag photos here
        </div>
        <div style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>
          JPEG, PNG, WebP — Max 5MB each
        </div>
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <>
          <Divider style={{ margin: '0 0 16px 0' }} />
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr',
            gap: 12,
          }}>
            {images.map((img, index) => (
              <div
                key={index}
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: `1px solid ${colors.border}`,
                  background: '#f5f5f5',
                }}
              >
                <img
                  src={img.data}
                  alt={img.filename}
                  style={{
                    width: '100%',
                    height: 120,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                {editingIndex === index ? (
                  <Input
                    size="small"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onPressEnter={() => {
                      if (editingName.trim()) {
                        setImages(prev => prev.map((img2, i) => i === index ? { ...img2, filename: editingName.trim() } : img2));
                      }
                      setEditingIndex(null);
                    }}
                    onBlur={() => {
                      if (editingName.trim()) {
                        setImages(prev => prev.map((img2, i) => i === index ? { ...img2, filename: editingName.trim() } : img2));
                      }
                      setEditingIndex(null);
                    }}
                    autoFocus
                    style={{ fontSize: 11, margin: '2px 4px', width: 'calc(100% - 8px)' }}
                  />
                ) : (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIndex(index);
                      setEditingName(img.filename);
                    }}
                    title="Click to rename"
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      color: colors.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                  >
                    <EditOutlined style={{ marginRight: 4, fontSize: 10 }} />
                    {img.filename}
                  </div>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteImage(index);
                  }}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(255,255,255,0.85)',
                    borderRadius: 4,
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {images.length === 0 && (
        <div style={{ textAlign: 'center', color: colors.textSecondary, padding: '20px 0' }}>
          No photos attached yet.
        </div>
      )}
    </Modal>
  );
};

// Main Invoice Editor Page
const InvoiceEditorPage: React.FC = () => {
  const { id } = useParams();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const isMobile = useIsMobile();

  useBackNav('Back to Invoices', '/app/invoices');

  // Fetch invoice statuses
  const { data: statusConfigs } = useInvoiceStatuses();

  // Form state
  const [customerData, setCustomerData] = useState<CustomerData>({
    customerId: undefined,
    name: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipcode: '',
  });
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<InvoiceStatus>('draft');
  const [invoiceDate, setInvoiceDate] = useState(dayjs());
  const [paymentTerms, setPaymentTerms] = useState(30);
  const [dueDate, setDueDate] = useState(dayjs().add(30, 'days'));
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState('');

  // Adjustments (premiums / fixed charges from estimate)
  interface AdjustmentData { id: string; name: string; amount: number; percentage: number; type: 'premium' | 'discount' }
  const [adjustments, setAdjustments] = useState<AdjustmentData[]>([]);

  // Payment schedule (milestone-based installments)
  interface ScheduleItem { label: string; percentage: number; amount: number; dueDescription: string }
  const [paymentSchedule, setPaymentSchedule] = useState<ScheduleItem[]>([]);

  // Sections and Items
  const [sections, setSections] = useState<SectionData[]>([
    { id: generateId(), name: 'General', isCollapsed: false, orderIndex: 0 },
  ]);
  const [items, setItems] = useState<LineItemData[]>([]);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ items: LineItemData[]; operation: 'copy' | 'cut' | null }>({
    items: [],
    operation: null,
  });

  // Modal state
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [notesTargetItem, setNotesTargetItem] = useState<LineItemData | null>(null);
  const [photosModalOpen, setPhotosModalOpen] = useState(false);
  const [photosTargetItem, setPhotosTargetItem] = useState<LineItemData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lineItemPickerOpen, setLineItemPickerOpen] = useState(false);
  const [pickerTargetSectionId, setPickerTargetSectionId] = useState<string | null>(null);

  // Mobile drawer state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileEditItem, setMobileEditItem] = useState<LineItemData | null>(null);
  const [isNewMobileItem, setIsNewMobileItem] = useState(false);
  const [mobileEditSectionId, setMobileEditSectionId] = useState<string | null>(null);

  // PDF Preview state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Save-to-library preference for custom items
  const [saveToLibraryDefault, setSaveToLibraryDefault] = useState<boolean>(() => {
    const stored = localStorage.getItem('scopit-save-custom-to-library');
    return stored === 'true';
  });
  const [hasAskedSavePreference, setHasAskedSavePreference] = useState(() => {
    return localStorage.getItem('scopit-save-custom-to-library') !== null;
  });

  // Payment management state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentListModalOpen, setPaymentListModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentForm] = Form.useForm();
  const queryClient = useQueryClient();

  const paymentMethodLabels: Record<PaymentMethod, string> = {
    cash: 'Cash',
    check: 'Check',
    credit_card: 'Credit Card',
    bank_transfer: 'Bank Transfer',
    other: 'Other',
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Fetch invoice data in edit mode
  const { data: invoiceData, isLoading: isLoadingInvoice } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoiceService.getById(id!),
    enabled: isEditing,
    retry: 1,
  });

  // Fetch PDF templates
  const { data: pdfTemplates = [], isLoading: isLoadingTemplates } = useQuery({
    queryKey: ['invoice-templates'],
    queryFn: () => invoiceService.getTemplates(),
  });

  // Load invoice data in edit mode
  useEffect(() => {
    if (invoiceData) {
      // Customer data
      setCustomerData({
        customerId: invoiceData.customerId,
        name: invoiceData.customerName || '',
        email: invoiceData.customerEmail || '',
        phone: '',
        addressLine1: invoiceData.customerAddressLine1 || '',
        addressLine2: invoiceData.customerAddressLine2 || '',
        city: invoiceData.customerCity || '',
        state: invoiceData.customerState || '',
        zipcode: invoiceData.customerZipcode || '',
      });

      // Invoice details
      setTitle(invoiceData.title || '');
      setStatus(invoiceData.status || 'draft');
      setInvoiceDate(dayjs(invoiceData.invoiceDate));

      if (invoiceData.dueDate) {
        setDueDate(dayjs(invoiceData.dueDate));
        // Calculate payment terms from dates
        const diffDays = dayjs(invoiceData.dueDate).diff(dayjs(invoiceData.invoiceDate), 'days');
        setPaymentTerms(diffDays);
      }

      setTaxRate(Number(invoiceData.taxRate) || 0);
      setNotes(invoiceData.notes || '');

      // Adjustments
      if (invoiceData.adjustments && invoiceData.adjustments.length > 0) {
        setAdjustments(invoiceData.adjustments.map((a) => ({
          id: a.id,
          name: a.name,
          amount: Number(a.amount),
          percentage: Number(a.percentage),
          type: a.type,
        })));
      }

      // Payment schedule
      if (invoiceData.paymentSchedule) {
        setPaymentSchedule(invoiceData.paymentSchedule.map((s: any) => ({
          label: s.label || '',
          percentage: s.percentage || 0,
          amount: s.amount || 0,
          dueDescription: s.dueDescription || s.due_description || '',
        })));
      }

      // Sections and items
      if (invoiceData.sections && invoiceData.sections.length > 0) {
        const loadedSections: SectionData[] = invoiceData.sections.map((section) => ({
          id: section.id,
          name: section.name,
          isCollapsed: section.isCollapsed,
          orderIndex: section.orderIndex,
        }));
        setSections(loadedSections);

        const loadedItems: LineItemData[] = invoiceData.sections.flatMap((section) =>
          section.items.map((item) => ({
            id: item.id,
            sectionId: section.id,
            lineItemId: item.lineItemId,
            name: item.name,
            description: item.description,
            unit: item.unit,
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            isTaxable: item.isTaxable,
            orderIndex: item.orderIndex,
            notes: item.notes,
            images: item.images,
          }))
        );
        setItems(loadedItems);
      } else if (invoiceData.items && invoiceData.items.length > 0) {
        // Fallback: items without sections (use default General section)
        const loadedItems: LineItemData[] = invoiceData.items.map((item) => ({
          id: item.id,
          sectionId: sections[0].id,
          lineItemId: item.lineItemId,
          name: item.name,
          description: item.description,
          unit: item.unit,
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          isTaxable: item.isTaxable,
          orderIndex: item.orderIndex,
          notes: item.notes,
          images: item.images,
        }));
        setItems(loadedItems);
      }
    }
  }, [invoiceData]);

  // Update due date when payment terms or invoice date changes
  useEffect(() => {
    setDueDate(invoiceDate.add(paymentTerms, 'days'));
  }, [paymentTerms, invoiceDate]);

  // Calculate totals (round each line item to 2 decimals to avoid floating point drift)
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = round2(items.reduce((sum, item) => sum + round2(item.quantity * item.unitPrice), 0));
  const taxableSubtotal = round2(items
    .filter((item) => item.isTaxable)
    .reduce((sum, item) => sum + round2(item.quantity * item.unitPrice), 0));
  const adjustmentsTotal = round2(adjustments.reduce((sum, a) => {
    if (a.percentage > 0) {
      // Percentage-based (e.g., O&P)
      return sum + round2(subtotal * (a.percentage / 100)) * (a.type === 'discount' ? -1 : 1);
    }
    // Fixed amount (e.g., supplements)
    return sum + a.amount * (a.type === 'discount' ? -1 : 1);
  }, 0));
  const adjustedSubtotal = round2(subtotal + adjustmentsTotal);
  const taxAmount = round2(taxableSubtotal > 0 && subtotal > 0
    ? adjustedSubtotal * (taxableSubtotal / subtotal) * (taxRate / 100)
    : 0);
  const total = round2(adjustedSubtotal + taxAmount);

  // Recalculate payment schedule amounts when total changes
  // (but NOT when user manually edits an amount)
  const prevTotalRef = useRef(total);
  useEffect(() => {
    if (prevTotalRef.current !== total && paymentSchedule.length > 0) {
      setPaymentSchedule((prev) =>
        prev.map((s) => ({ ...s, amount: Math.round(total * (s.percentage / 100) * 100) / 100 }))
      );
    }
    prevTotalRef.current = total;
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Payment data from server
  const payments: Payment[] = invoiceData?.payments || [];
  const amountPaid = Number(invoiceData?.amountPaid ?? 0);
  const balanceDue = round2(total - amountPaid);

  // Payment handlers
  const handleRecordPayment = async (values: any) => {
    if (!id) return;
    try {
      const paymentData = {
        amount: values.amount,
        paymentMethod: values.paymentMethod,
        paymentDate: values.paymentDate ? values.paymentDate.format('YYYY-MM-DD') : undefined,
        referenceNumber: values.referenceNumber,
        notes: values.notes,
      };
      if (editingPayment) {
        await invoiceService.payments.update(id, editingPayment.id, paymentData);
        message.success('Payment updated');
      } else {
        await invoiceService.payments.record(id, paymentData);
        message.success('Payment recorded');
      }
      setPaymentModalOpen(false);
      setEditingPayment(null);
      paymentForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    } catch {
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
    setPaymentModalOpen(true);
  };

  const handleDeletePayment = (paymentId: string) => {
    if (!id) return;
    Modal.confirm({
      title: 'Delete Payment',
      content: 'Are you sure you want to delete this payment?',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await invoiceService.payments.delete(id, paymentId);
          message.success('Payment deleted');
          queryClient.invalidateQueries({ queryKey: ['invoice', id] });
        } catch {
          message.error('Failed to delete payment');
        }
      },
    });
  };

  const openNewPaymentModal = () => {
    setEditingPayment(null);
    paymentForm.setFieldsValue({
      amount: balanceDue > 0 ? balanceDue : 0,
      paymentMethod: 'check',
      paymentDate: dayjs(),
      referenceNumber: undefined,
      notes: undefined,
    });
    setPaymentModalOpen(true);
  };

  // Selection handlers
  const toggleSelect = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const selectAllInSection = useCallback((sectionId: string) => {
    const sectionItems = items.filter((i) => i.sectionId === sectionId);
    const allSelected = sectionItems.every((i) => selectedIds.has(i.id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      sectionItems.forEach((item) => {
        if (allSelected) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
      });
      return next;
    });
  }, [items, selectedIds]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Section handlers
  const addSection = useCallback(() => {
    const newSection: SectionData = {
      id: generateId(),
      name: 'New Section',
      isCollapsed: false,
      orderIndex: sections.length,
    };
    setSections((prev) => [...prev, newSection]);
  }, [sections.length]);

  const updateSection = useCallback((sectionId: string, updates: Partial<SectionData>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, ...updates } : s))
    );
  }, []);

  const deleteSection = useCallback((sectionId: string) => {
    // Delete section and its items
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    setItems((prev) => prev.filter((i) => i.sectionId !== sectionId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      items.filter((i) => i.sectionId === sectionId).forEach((i) => next.delete(i.id));
      return next;
    });
  }, [items]);

  // Item handlers
  const openLineItemPicker = useCallback((sectionId: string) => {
    setPickerTargetSectionId(sectionId);
    setLineItemPickerOpen(true);
  }, []);

  const addItemFromLibrary = useCallback((lineItem: LineItem, selectedNotes: string[]) => {
    if (!pickerTargetSectionId) return;

    const sectionItems = items.filter((i) => i.sectionId === pickerTargetSectionId);
    const newItem: LineItemData = {
      id: generateId(),
      sectionId: pickerTargetSectionId,
      lineItemId: lineItem.id || undefined,
      name: lineItem.name || '',
      description: lineItem.includes || undefined,
      unit: lineItem.unit || 'EA',
      quantity: 1,
      unitPrice: Number(lineItem.unitPrice) || 0,
      isTaxable: lineItem.isTaxable ?? true,
      orderIndex: sectionItems.length,
      notes: selectedNotes.length > 0 ? selectedNotes : undefined,
    };
    setItems((prev) => [...prev, newItem]);
    setPickerTargetSectionId(null);
  }, [items, pickerTargetSectionId]);

  const doAddItem = useCallback((sectionId: string, saveToLibrary: boolean) => {
    const sectionItems = items.filter((i) => i.sectionId === sectionId);
    const newItem: LineItemData = {
      id: generateId(),
      sectionId,
      name: '',
      unit: 'EA',
      quantity: 1,
      unitPrice: 0,
      isTaxable: true,
      orderIndex: sectionItems.length,
      saveToLibrary,
    };
    setItems((prev) => [...prev, newItem]);
  }, [items]);

  const addItem = useCallback((sectionId: string) => {
    if (!hasAskedSavePreference) {
      Modal.confirm({
        title: 'Save custom items to library?',
        icon: null,
        content: 'Would you like to automatically save custom line items to your library for future use? You can change this per item.',
        okText: 'Yes, always save',
        cancelText: 'No, don\'t save',
        okButtonProps: { style: { background: colors.primary, borderColor: colors.primary } },
        onOk: () => {
          localStorage.setItem('scopit-save-custom-to-library', 'true');
          setSaveToLibraryDefault(true);
          setHasAskedSavePreference(true);
          doAddItem(sectionId, true);
        },
        onCancel: () => {
          localStorage.setItem('scopit-save-custom-to-library', 'false');
          setSaveToLibraryDefault(false);
          setHasAskedSavePreference(true);
          doAddItem(sectionId, false);
        },
      });
    } else {
      doAddItem(sectionId, saveToLibraryDefault);
    }
  }, [hasAskedSavePreference, saveToLibraryDefault, doAddItem]);

  const updateItem = useCallback((itemId: string, updates: Partial<LineItemData>) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...updates } : i))
    );
  }, []);

  const deleteItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  // Bulk actions
  const copySelected = useCallback(() => {
    const selectedItems = items.filter((i) => selectedIds.has(i.id));
    setClipboard({ items: selectedItems, operation: 'copy' });
    message.success(`${selectedItems.length} items copied`);
  }, [items, selectedIds]);

  const cutSelected = useCallback(() => {
    const selectedItems = items.filter((i) => selectedIds.has(i.id));
    setClipboard({ items: selectedItems, operation: 'cut' });
    message.success(`${selectedItems.length} items cut`);
  }, [items, selectedIds]);

  const deleteSelected = useCallback(() => {
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setSelectedIds(new Set());
    message.success('Items deleted');
  }, [selectedIds]);

  const moveSelected = useCallback((targetSectionId: string) => {
    setItems((prev) =>
      prev.map((item) =>
        selectedIds.has(item.id) ? { ...item, sectionId: targetSectionId } : item
      )
    );
    setSelectedIds(new Set());
    setMoveModalOpen(false);
    message.success('Items moved');
  }, [selectedIds]);

  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const saveSelectedToLibrary = useCallback(async () => {
    const selectedItems = items.filter((i) => selectedIds.has(i.id) && i.name);
    if (selectedItems.length === 0) {
      message.warning('No items to save');
      return;
    }
    setSavingToLibrary(true);
    try {
      let savedCount = 0;
      for (const item of selectedItems) {
        await lineItemService.create({
          name: item.name,
          includes: item.description || '',
          unit: item.unit || 'EA',
          unitPrice: item.unitPrice,
          isTaxable: item.isTaxable,
        });
        savedCount++;
      }
      message.success(`${savedCount} item${savedCount > 1 ? 's' : ''} saved to library`);
      setSelectedIds(new Set());
    } catch {
      message.error('Failed to save items to library');
    } finally {
      setSavingToLibrary(false);
    }
  }, [items, selectedIds, message]);

  const pasteItems = useCallback((targetSectionId: string) => {
    if (!clipboard.items.length) return;

    if (clipboard.operation === 'copy') {
      // Copy: create new items with new IDs
      const newItems = clipboard.items.map((item) => ({
        ...item,
        id: generateId(),
        sectionId: targetSectionId,
      }));
      setItems((prev) => [...prev, ...newItems]);
      message.success(`${newItems.length} items pasted`);
    } else if (clipboard.operation === 'cut') {
      // Cut: move existing items
      setItems((prev) =>
        prev.map((item) =>
          clipboard.items.some((ci) => ci.id === item.id)
            ? { ...item, sectionId: targetSectionId }
            : item
        )
      );
      setClipboard({ items: [], operation: null });
      message.success('Items moved');
    }
  }, [clipboard]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === 'c' && selectedIds.size > 0) {
        e.preventDefault();
        copySelected();
      }
      if (modifier && e.key === 'x' && selectedIds.size > 0) {
        e.preventDefault();
        cutSelected();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'Escape') {
        deselectAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, copySelected, cutSelected, deleteSelected, deselectAll]);

  // Drag and drop handler
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Check if dragging a section
    const isSection = active.data?.current?.type === 'section';
    if (isSection) {
      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setSections((prev) => arrayMove(prev, oldIndex, newIndex));
      }
      return;
    }

    // Otherwise dragging a line item
    const activeItem = items.find((i) => i.id === active.id);
    const overItem = items.find((i) => i.id === over.id);

    if (activeItem && overItem) {
      const oldIndex = items.indexOf(activeItem);
      const newIndex = items.indexOf(overItem);

      if (activeItem.sectionId === overItem.sectionId) {
        setItems((prev) => arrayMove(prev, oldIndex, newIndex));
      } else {
        setItems((prev) =>
          prev.map((item) =>
            item.id === activeItem.id
              ? { ...item, sectionId: overItem.sectionId }
              : item
          )
        );
      }
    } else if (activeItem && !overItem) {
      // Dragging over an empty section (over.id is a section id, not an item id)
      const overSection = sections.find((s) => s.id === over.id);
      if (overSection && activeItem.sectionId !== overSection.id) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === activeItem.id
              ? { ...item, sectionId: overSection.id }
              : item
          )
        );
      }
    }
  };

  // Notes modal handlers
  const openNotesModal = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      setNotesTargetItem(item);
      setNotesModalOpen(true);
    }
  };

  const handleSaveNotes = (updatedNotes: string[]) => {
    if (notesTargetItem) {
      updateItem(notesTargetItem.id, { notes: updatedNotes.length > 0 ? updatedNotes : undefined });
    }
  };

  // Photos modal handlers
  const openPhotosModal = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      setPhotosTargetItem(item);
      setPhotosModalOpen(true);
    }
  };

  const handleSavePhotos = (updatedImages: LineItemImage[]) => {
    if (photosTargetItem) {
      updateItem(photosTargetItem.id, { images: updatedImages.length > 0 ? updatedImages : undefined });
    }
  };

  // Mobile drawer handlers
  const openMobileDrawerForNew = (sectionId: string) => {
    setMobileEditSectionId(sectionId);
    setMobileEditItem(null);
    setIsNewMobileItem(true);
    setMobileDrawerOpen(true);
  };

  const openMobileDrawerForEdit = (item: LineItemData) => {
    setMobileEditItem(item);
    setMobileEditSectionId(item.sectionId);
    setIsNewMobileItem(false);
    setMobileDrawerOpen(true);
  };

  const handleMobileDrawerSave = (updates: Partial<LineItemData>) => {
    if (isNewMobileItem && mobileEditSectionId) {
      // Create new item
      const sectionItems = items.filter((i) => i.sectionId === mobileEditSectionId);
      const newItem: LineItemData = {
        id: generateId(),
        sectionId: mobileEditSectionId,
        name: updates.name || '',
        description: updates.description,
        unit: updates.unit || 'EA',
        quantity: updates.quantity || 1,
        unitPrice: updates.unitPrice || 0,
        isTaxable: updates.isTaxable ?? true,
        orderIndex: sectionItems.length,
      };
      setItems((prev) => [...prev, newItem]);
      message.success('Item added');
    } else if (mobileEditItem) {
      // Update existing item
      updateItem(mobileEditItem.id, updates);
      message.success('Item updated');
    }
    setMobileDrawerOpen(false);
    setMobileEditItem(null);
    setMobileEditSectionId(null);
  };

  const handleMobileDrawerDelete = () => {
    if (mobileEditItem) {
      deleteItem(mobileEditItem.id);
      message.success('Item deleted');
    }
  };

  // Save handler
  const handleSave = async () => {
    // Validate customer data
    if (!customerData.name) {
      message.error('Please select a customer or enter customer details');
      return;
    }

    setIsSaving(true);

    try {
      // Build API payload
      const payload: InvoiceCreate | InvoiceUpdate = {
        customerId: customerData.customerId || null,
        customerName: customerData.name || null,
        customerEmail: customerData.email || null,
        customerAddressLine1: customerData.addressLine1 || null,
        customerAddressLine2: customerData.addressLine2 || null,
        customerCity: customerData.city || null,
        customerState: customerData.state || null,
        customerZipcode: customerData.zipcode || null,
        invoiceDate: invoiceDate.format('YYYY-MM-DD'),
        dueDate: dueDate.format('YYYY-MM-DD'),
        title: title || undefined,
        taxRate,
        notes: notes || undefined,
        paymentSchedule: paymentSchedule.length > 0 ? paymentSchedule : null,
        sections: sections.map((section) => ({
          name: section.name,
          orderIndex: section.orderIndex,
          items: items
            .filter((item) => item.sectionId === section.id)
            .map((item) => ({
              lineItemId: item.lineItemId,
              name: item.name,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              isTaxable: item.isTaxable,
              orderIndex: item.orderIndex,
              notes: item.notes,
              images: item.images,
            })),
        })),
      };

      let result: Invoice;

      if (isEditing) {
        result = await invoiceService.update(id!, payload);
        message.success('Invoice updated successfully');
      } else {
        result = await invoiceService.create(payload);
        message.success('Invoice created successfully');
      }

      // Save custom items to library if flagged
      const customItemsToSave = items.filter((item) => !item.lineItemId && item.saveToLibrary && item.name);
      for (const item of customItemsToSave) {
        try {
          await lineItemService.create({
            name: item.name,
            includes: item.description,
            unit: item.unit || 'EA',
            unitPrice: item.unitPrice,
            isTaxable: item.isTaxable,
          });
        } catch {
          // Silent fail for individual items — don't block navigation
        }
      }
      if (customItemsToSave.length > 0) {
        // Update preference based on last state
        const lastSaveState = customItemsToSave.length > 0;
        localStorage.setItem('scopit-save-custom-to-library', String(lastSaveState));
        setSaveToLibraryDefault(lastSaveState);
      }

      // Invalidate cached invoice data so Detail page shows fresh data
      queryClient.invalidateQueries({ queryKey: ['invoice', result.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });

      navigate(`/app/invoices/${result.id}`);
    } catch (error: any) {
      console.error('Failed to save invoice:', error);

      // Show user-friendly error message
      const errorMessage = error.response?.data?.detail || error.message || 'An error occurred';
      message.error(`Failed to save invoice: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Show loading spinner in edit mode
  if (isEditing && isLoadingInvoice) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" tip="Loading invoice..." />
      </div>
    );
  }

  // Show not found message
  if (isEditing && !isLoadingInvoice && !invoiceData) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Card style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ fontFamily: fonts.heading, marginBottom: 16 }}>Invoice Not Found</h2>
          <p style={{ color: colors.textSecondary, marginBottom: 24 }}>
            The invoice you're looking for doesn't exist or you don't have permission to access it.
          </p>
          <Button type="primary" onClick={() => navigate('/app/invoices')}>
            Back to Invoices
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: isMobile ? 80 : 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
            <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 24, fontWeight: 700, margin: 0 }}>
              {isEditing ? 'Edit Invoice' : 'New Invoice'}
            </h1>
            {isEditing && statusConfigs && (
              <Tag style={{
                color: getStatusDisplay(status, statusConfigs).color,
                background: getStatusDisplay(status, statusConfigs).bg,
                border: 'none',
                fontWeight: 500,
                flexShrink: 0,
              }}>
                {getStatusDisplay(status, statusConfigs).label}
              </Tag>
            )}
          </div>
          {/* Action buttons: only shown in header on non-mobile */}
          {!isMobile && (
            <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
              {isEditing && (
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => setPreviewModalOpen(true)}
                  style={{ fontWeight: 600, borderRadius: 8 }}
                >
                  Preview PDF
                </Button>
              )}
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={isSaving}
                disabled={isSaving}
                style={{ background: colors.primary, fontWeight: 600, borderRadius: 8 }}
              >
                {isEditing ? 'Save Changes' : 'Create Invoice'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Stacked layout must not wrap: a wrapping column flex line grows to its
          widest child's min-content width, which pushed the editor past the
          viewport and out of reach of the ancestor's overflow-x: hidden. */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, flexWrap: isMobile ? 'nowrap' : 'wrap' }}>
        {/* Main Editor */}
        <div style={{ flex: 1, minWidth: isMobile ? 0 : 600, maxWidth: '100%' }}>
          {/* Customer Selection */}
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontFamily: fonts.heading, fontWeight: 600, marginBottom: 12 }}>
              Customer
            </h3>
            <CustomerSelector
              value={customerData}
              onChange={setCustomerData}
            />
          </div>

          {/* Invoice Details */}
          <Card style={{ borderRadius: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: isMobile ? 'nowrap' : 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
              <Form.Item label="Invoice Date" style={{ marginBottom: 0, flex: isMobile ? 'none' : '1 1 auto', minWidth: isMobile ? 'auto' : 150 }}>
                <DatePicker
                  value={invoiceDate}
                  onChange={(d) => d && setInvoiceDate(d)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Payment Terms" style={{ marginBottom: 0, flex: isMobile ? 'none' : '1 1 auto', minWidth: isMobile ? 'auto' : 150 }}>
                <Select
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  style={{ width: '100%' }}
                  options={paymentTermsOptions}
                />
              </Form.Item>
              <Form.Item label="Due Date" style={{ marginBottom: 0, flex: isMobile ? 'none' : '1 1 auto', minWidth: isMobile ? 'auto' : 150 }}>
                <DatePicker
                  value={dueDate}
                  onChange={(d) => d && setDueDate(d)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </div>

            <Form.Item label="Title" style={{ marginTop: 16, marginBottom: 0 }}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Water Damage Restoration - Basement"
              />
            </Form.Item>
          </Card>

          {/* Sections */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {sections.map((section) => (
                <Section
                  key={section.id}
                  section={section}
                  items={items
                    .filter((i) => i.sectionId === section.id)
                    .sort((a, b) => a.orderIndex - b.orderIndex)}
                  selectedIds={selectedIds}
                  clipboardCount={clipboard.items.length}
                  onToggleCollapse={() =>
                    updateSection(section.id, { isCollapsed: !section.isCollapsed })
                  }
                  onUpdateSection={(updates) => updateSection(section.id, updates)}
                  onDeleteSection={() => deleteSection(section.id)}
                  onAddItem={() => addItem(section.id)}
                  onAddFromLibrary={() => openLineItemPicker(section.id)}
                  onPasteHere={() => { pasteItems(section.id); deselectAll(); }}
                  onToggleSelect={toggleSelect}
                  onSelectAllInSection={() => selectAllInSection(section.id)}
                  onUpdateItem={updateItem}
                  onDeleteItem={deleteItem}
                  onManageItemNotes={openNotesModal}
                  onManageItemPhotos={openPhotosModal}
                  // Mobile props
                  isMobile={isMobile}
                  onMobileAddItem={() => openMobileDrawerForNew(section.id)}
                  onMobileEditItem={openMobileDrawerForEdit}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add Section Button */}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addSection}
            block
            style={{ marginBottom: 16 }}
          >
            Add Section
          </Button>

          {/* Notes */}
          <Card style={{ borderRadius: 12 }}>
            <h3 style={{ fontFamily: fonts.heading, fontWeight: 600, marginBottom: 12 }}>Notes</h3>
            <Input.TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Payment is due within the specified terms. Please include the invoice number with your payment."
            />
          </Card>
        </div>

        {/* Summary Sidebar - Responsive */}
        <Card style={{ borderRadius: 12, width: isMobile ? '100%' : 'auto', flex: isMobile ? 1 : '0 0 280px', flexShrink: 0, alignSelf: 'flex-start', position: isMobile ? 'static' : 'sticky', top: isMobile ? 'auto' : 88, minWidth: isMobile ? 'auto' : 280 }}>
            <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Summary</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: colors.textSecondary }}>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: colors.textSecondary }}>Taxable</span>
              <span>{formatCurrency(taxableSubtotal)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: colors.textSecondary }}>Tax Rate</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <InputNumber
                  value={taxRate}
                  onChange={(val) => setTaxRate(val || 0)}
                  min={0}
                  max={100}
                  precision={2}
                  style={{ width: 70 }}
                  size="small"
                />
                <span style={{ color: colors.textSecondary }}>%</span>
              </div>
            </div>

            {/* Adjustments */}
            {adjustments.length > 0 && (
              <>
                <Divider style={{ margin: '12px 0 8px' }} />
                {adjustments.map((adj, idx) => (
                  <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: colors.textSecondary, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {adj.name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: adj.type === 'discount' ? '#dc2626' : '#16a34a', fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>
                        {adj.type === 'discount' ? '-' : '+'}{formatCurrency(
                          adj.percentage > 0 ? round2(subtotal * (adj.percentage / 100)) : adj.amount
                        )}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<CloseOutlined style={{ fontSize: 10 }} />}
                        onClick={() => setAdjustments((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ padding: 0, height: 18, width: 18, minWidth: 18 }}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, marginTop: adjustments.length > 0 ? 8 : 0 }}>
              <span style={{ color: colors.textSecondary }}>Tax Amount</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 700, fontSize: 20, fontFamily: fonts.heading }}>
                {formatCurrency(total)}
              </span>
            </div>

            {/* Payment Schedule (installments) */}
            <Divider style={{ margin: '16px 0' }} />
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: colors.textPrimary }}>Payment Schedule</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    if (paymentSchedule.length === 0) {
                      // Default: 2-step (50% deposit + 50% balance)
                      setPaymentSchedule([
                        { label: 'Deposit', percentage: 50, amount: Math.round(total * 0.5 * 100) / 100, dueDescription: 'Due upon signing' },
                        { label: 'Final Payment', percentage: 50, amount: Math.round(total * 0.5 * 100) / 100, dueDescription: 'Due upon completion' },
                      ]);
                    } else {
                      // Add new step
                      setPaymentSchedule([...paymentSchedule, { label: `Payment ${paymentSchedule.length + 1}`, percentage: 0, amount: 0, dueDescription: '' }]);
                    }
                  }}
                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                >
                  {paymentSchedule.length === 0 ? '+ Add Schedule' : '+ Add Step'}
                </Button>
              </div>

              {paymentSchedule.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {paymentSchedule.map((step, idx) => {
                    const paidForStep = (payments || [])
                      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
                    return (
                      <div key={idx} style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 10px', border: `1px solid ${colors.border}` }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <AutoComplete
                            value={step.label}
                            onChange={(val) => {
                              const dueMap: Record<string, string> = {
                                'Deposit': 'Due upon signing',
                                '1st Payment': 'Due upon signing',
                                'Progress Payment': 'Due upon milestone completion',
                                'Milestone Payment': 'Due upon milestone completion',
                                '2nd Payment': 'Due upon progress',
                                '3rd Payment': 'Due upon progress',
                                'Final Payment': 'Due upon completion',
                              };
                              const updated = [...paymentSchedule];
                              const autoDesc = dueMap[val];
                              updated[idx] = {
                                ...updated[idx],
                                label: val,
                                ...(autoDesc && (!step.dueDescription || Object.values(dueMap).includes(step.dueDescription))
                                  ? { dueDescription: autoDesc }
                                  : {}),
                              };
                              setPaymentSchedule(updated);
                            }}
                            options={[
                              { value: 'Deposit' },
                              { value: 'Progress Payment' },
                              { value: 'Milestone Payment' },
                              { value: 'Final Payment' },
                              { value: '1st Payment' },
                              { value: '2nd Payment' },
                              { value: '3rd Payment' },
                            ].filter((o) => !paymentSchedule.some((s, i) => i !== idx && s.label === o.value))}
                            placeholder="Label"
                            size="small"
                            style={{ flex: 1 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <InputNumber
                              value={step.percentage}
                              onChange={(val) => {
                                const pct = val || 0;
                                const updated = [...paymentSchedule];
                                updated[idx] = { ...updated[idx], percentage: pct, amount: Math.round(total * (pct / 100) * 100) / 100 };
                                setPaymentSchedule(updated);
                              }}
                              min={0}
                              max={100}
                              precision={0}
                              style={{ width: 52 }}
                              size="small"
                            />
                            <span style={{ fontSize: 12, color: colors.textSecondary }}>%</span>
                          </div>
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => setPaymentSchedule(paymentSchedule.filter((_, i) => i !== idx))}
                            style={{ color: colors.textMuted, padding: '0 4px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Input
                            value={step.dueDescription}
                            onChange={(e) => {
                              const updated = [...paymentSchedule];
                              updated[idx] = { ...updated[idx], dueDescription: e.target.value };
                              setPaymentSchedule(updated);
                            }}
                            placeholder="e.g. Due upon signing"
                            size="small"
                            variant="borderless"
                            style={{ flex: 1, fontSize: 12, color: colors.textSecondary, padding: '0 4px' }}
                          />
                          <InputNumber
                            value={step.amount}
                            onChange={(val) => {
                              const amt = val || 0;
                              const updated = [...paymentSchedule];
                              const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
                              updated[idx] = { ...updated[idx], amount: amt, percentage: pct };
                              setPaymentSchedule(updated);
                            }}
                            min={0}
                            precision={2}
                            prefix="$"
                            size="small"
                            style={{ width: 110, fontWeight: 600, fontSize: 13 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {/* Remaining balance after schedule */}
                  {(() => {
                    const scheduleTotal = paymentSchedule.reduce((sum, s) => sum + s.amount, 0);
                    const remaining = Math.round((total - scheduleTotal) * 100) / 100;
                    if (Math.abs(remaining) > 0.01) {
                      return (
                        <div style={{ fontSize: 12, color: remaining > 0 ? colors.error : '#b45309', textAlign: 'right' }}>
                          {remaining > 0 ? `Unallocated: ${formatCurrency(remaining)}` : `Over-allocated: ${formatCurrency(Math.abs(remaining))}`}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
            </div>

            {/* Payment Status (for editing existing invoices) */}
            {isEditing && (
              <>
                <Divider style={{ margin: '16px 0' }} />
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, cursor: 'pointer', padding: '4px 0', borderRadius: 4 }}
                  onClick={() => setPaymentListModalOpen(true)}
                >
                  <span style={{ color: colors.textSecondary }}>
                    Amount Paid
                    {payments.length > 0 && (
                      <span style={{ fontSize: 11, marginLeft: 4, color: colors.textMuted }}>
                        ({payments.length} payment{payments.length > 1 ? 's' : ''})
                      </span>
                    )}
                  </span>
                  <span style={{ color: colors.success, textDecoration: 'underline' }}>
                    -{formatCurrency(amountPaid)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>Balance Due</span>
                  <span style={{ fontWeight: 700, color: balanceDue > 0 ? colors.error : colors.success }}>
                    {formatCurrency(balanceDue)}
                  </span>
                </div>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={openNewPaymentModal}
                  style={{ width: '100%', marginTop: 8, height: 40 }}
                >
                  Record Payment
                </Button>
              </>
            )}
          </Card>
      </div>

      {/* Fixed bottom action bar — mobile only */}
      {isMobile && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: colors.bgWhite,
            borderTop: `1px solid ${colors.border}`,
            padding: '12px 16px',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            display: 'flex',
            gap: 12,
            zIndex: 900,
            boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {isEditing && (
            <Button
              icon={<EyeOutlined />}
              onClick={() => setPreviewModalOpen(true)}
              style={{ flex: 1, height: 44, fontWeight: 600, borderRadius: 8 }}
            >
              Preview
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving}
            style={{
              background: colors.primary,
              flex: 2,
              height: 44,
              fontWeight: 600,
              borderRadius: 8,
            }}
          >
            {isEditing ? 'Save Changes' : 'Create Invoice'}
          </Button>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onCopy={copySelected}
          onCut={cutSelected}
          onDelete={deleteSelected}
          onMove={() => setMoveModalOpen(true)}
          onSaveToLibrary={saveSelectedToLibrary}
          savingToLibrary={savingToLibrary}
          onDeselect={deselectAll}
          isMobile={isMobile}
        />
      )}

      {/* Move to Section Modal */}
      <Modal
        title="Move to Section"
        open={moveModalOpen}
        onCancel={() => setMoveModalOpen(false)}
        footer={null}
        width={400}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {sections.map((section) => (
            <Button
              key={section.id}
              block
              onClick={() => moveSelected(section.id)}
              style={{ textAlign: 'left', height: 'auto', padding: '12px 16px' }}
            >
              {section.name}
              <span style={{ marginLeft: 'auto', color: colors.textMuted }}>
                {items.filter((i) => i.sectionId === section.id).length} items
              </span>
            </Button>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              addSection();
              setMoveModalOpen(false);
            }}
          >
            Create New Section & Move
          </Button>
        </div>
      </Modal>

      {/* Item Notes Modal */}
      <ItemNotesModal
        open={notesModalOpen}
        item={notesTargetItem}
        onClose={() => {
          setNotesModalOpen(false);
          setNotesTargetItem(null);
        }}
        onSave={handleSaveNotes}
      />

      {/* Item Photos Modal */}
      <ItemPhotosModal
        open={photosModalOpen}
        item={photosTargetItem}
        onClose={() => {
          setPhotosModalOpen(false);
          setPhotosTargetItem(null);
        }}
        onSave={handleSavePhotos}
      />

      {/* Line Item Picker Modal */}
      <LineItemPickerModal
        open={lineItemPickerOpen}
        onClose={() => {
          setLineItemPickerOpen(false);
          setPickerTargetSectionId(null);
        }}
        onSelect={addItemFromLibrary}
      />

      {/* Line Item Edit Drawer (works on both desktop and mobile) */}
      <MobileLineItemDrawer
        open={mobileDrawerOpen}
        item={mobileEditItem}
        isNew={isNewMobileItem}
        onClose={() => {
          setMobileDrawerOpen(false);
          setMobileEditItem(null);
          setMobileEditSectionId(null);
        }}
        onSave={handleMobileDrawerSave}
        onDelete={handleMobileDrawerDelete}
        onManageNotes={mobileEditItem ? () => openNotesModal(mobileEditItem.id) : undefined}
        onManagePhotos={mobileEditItem ? () => openPhotosModal(mobileEditItem.id) : undefined}
      />

      {/* Payment List Modal */}
      <Modal
        title="Payments"
        open={paymentListModalOpen}
        onCancel={() => setPaymentListModalOpen(false)}
        footer={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPaymentListModalOpen(false); openNewPaymentModal(); }} style={{ background: colors.primary }}>
            Record Payment
          </Button>
        }
        width={600}
      >
        {payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: colors.textSecondary }}>
            No payments recorded yet
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
                  <div style={{ fontWeight: 600 }}>{formatCurrency(Number(payment.amount))}</div>
                  <div style={{ fontSize: 12, color: colors.textSecondary }}>
                    {paymentMethodLabels[payment.paymentMethod] || payment.paymentMethod}
                    {payment.paymentDate && ` · ${dayjs(payment.paymentDate).format('MMM D, YYYY')}`}
                    {payment.referenceNumber && ` · ${payment.referenceNumber}`}
                  </div>
                </div>
                <Space size="small">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => { setPaymentListModalOpen(false); handleEditPayment(payment); }}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeletePayment(payment.id)}
                  />
                </Space>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Record/Edit Payment Modal */}
      <Modal
        title={editingPayment ? 'Edit Payment' : 'Record Payment'}
        open={paymentModalOpen}
        onCancel={() => {
          setPaymentModalOpen(false);
          setEditingPayment(null);
          paymentForm.resetFields();
        }}
        onOk={() => paymentForm.submit()}
        okText={editingPayment ? 'Update Payment' : 'Record Payment'}
      >
        <Form
          form={paymentForm}
          layout="vertical"
          onFinish={handleRecordPayment}
          initialValues={{
            paymentDate: dayjs(),
            paymentMethod: 'check',
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
            <InputNumber style={{ width: '100%' }} prefix="$" precision={2} min={0} />
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
          <Form.Item label="Payment Date" name="paymentDate">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Reference Number" name="referenceNumber">
            <Input placeholder="Check number, transaction ID, etc." />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} placeholder="Optional payment notes" />
          </Form.Item>
        </Form>
      </Modal>

      {/* PDF Preview Modal */}
      {isEditing && id && (
        <PdfPreviewModal
          open={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          documentType="invoice"
          documentId={id}
          documentNumber={invoiceData?.invoiceNumber || ''}
          customerName={invoiceData?.customerName}
          isPaid={Number(invoiceData?.total ?? 0) > 0 && Number(invoiceData?.balanceDue ?? 1) <= 0.01}
          fetchPreview={invoiceService.getPreview}
          fetchPdf={invoiceService.getPdf}
          templates={pdfTemplates}
          templatesLoading={isLoadingTemplates}
        />
      )}
    </div>
  );
};

export default InvoiceEditorPage;
