/**
 * Scopit - PDF Editor Merge Modal
 *
 * Allows the user to select existing PDF documents, arrange them in order
 * via drag-and-drop, name the result, and trigger a merge.
 *
 * Usage:
 *   <MergeModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onMerge={(ids, name) => mergeMutation.mutate({ ids, name })}
 *     merging={mergeMutation.isPending}
 *   />
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Input,
  Checkbox,
  Spin,
  Typography,
  Button,
  Empty,
  Alert,
} from 'antd';
import {
  HolderOutlined,
  FileTextOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { PdfDocument } from './types';
import { colors, fonts, borderRadius, fontSizes } from '@/styles/theme';

const { Text } = Typography;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MergeModalProps {
  open: boolean;
  onClose: () => void;
  onMerge: (documentIds: string[], name: string) => void;
  merging: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Sortable Merge Item ───────────────────────────────────────────────────────

interface SortableMergeItemProps {
  doc: PdfDocument;
  index: number;
  onRemove: (id: string) => void;
}

const SortableMergeItem: React.FC<SortableMergeItemProps> = ({ doc, index, onRemove }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        background: isDragging ? colors.bgLight : colors.bgWhite,
        border: `1px solid ${isDragging ? colors.borderDark : colors.border}`,
        borderRadius: borderRadius.base,
        marginBottom: 4,
        userSelect: 'none',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            color: colors.textMuted,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            touchAction: 'none',
          }}
        >
          <HolderOutlined style={{ fontSize: 14 }} />
        </span>

        {/* Index badge */}
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: borderRadius.full,
            background: colors.primary,
            color: colors.textWhite,
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontFamily: fonts.body,
          }}
        >
          {index + 1}
        </span>

        {/* Doc icon */}
        <FileTextOutlined style={{ color: colors.textMuted, fontSize: 13, flexShrink: 0 }} />

        {/* Name */}
        <Text
          ellipsis
          style={{
            flex: 1,
            fontSize: fontSizes.sm,
            color: colors.textPrimary,
            fontFamily: fonts.body,
          }}
        >
          {doc.name}
        </Text>

        {/* Page count */}
        <Text
          style={{
            fontSize: fontSizes.xs,
            color: colors.textMuted,
            fontFamily: fonts.body,
            flexShrink: 0,
          }}
        >
          {doc.pageCount}p
        </Text>

        {/* Remove */}
        <button
          onClick={() => onRemove(doc.id)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: borderRadius.sm,
            color: colors.textMuted,
            fontSize: 12,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = colors.error;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted;
          }}
          title="Remove from merge"
        >
          &times;
        </button>
    </div>
  );
};

// ── Document Checkbox Row ─────────────────────────────────────────────────────

interface DocRowProps {
  doc: PdfDocument;
  checked: boolean;
  onChange: (id: string, checked: boolean) => void;
}

const DocRow: React.FC<DocRowProps> = ({ doc, checked, onChange }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      borderRadius: borderRadius.base,
      cursor: 'pointer',
      background: checked ? colors.bgLight : 'transparent',
      transition: 'background 0.15s ease',
    }}
    onMouseEnter={(e) => {
      if (!checked) (e.currentTarget as HTMLElement).style.background = colors.bgLight;
    }}
    onMouseLeave={(e) => {
      if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent';
    }}
  >
    <Checkbox
      checked={checked}
      onChange={(e) => onChange(doc.id, e.target.checked)}
    />
    <FileTextOutlined style={{ color: colors.textMuted, fontSize: 13, flexShrink: 0 }} />
    <Text
      ellipsis
      style={{
        flex: 1,
        fontSize: fontSizes.sm,
        color: colors.textPrimary,
        fontFamily: fonts.body,
      }}
    >
      {doc.name}
    </Text>
    <Text
      style={{
        fontSize: fontSizes.xs,
        color: colors.textMuted,
        fontFamily: fonts.body,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {doc.pageCount} pages &middot; {formatFileSize(doc.fileSize)}
    </Text>
  </label>
);

// ── Main Component ─────────────────────────────────────────────────────────────

const MergeModal: React.FC<MergeModalProps> = ({ open, onClose, onMerge, merging }) => {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeOrder, setMergeOrder] = useState<PdfDocument[]>([]);
  const [mergeName, setMergeName] = useState('Merged Document');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Fetch all documents (up to 100)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pdf-documents-merge'],
    queryFn: () => pdfEditorApi.listDocuments(0, 100),
    enabled: open,
    staleTime: 30_000,
  });

  const allDocs = data?.items ?? [];

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIds([]);
      setMergeOrder([]);
      setMergeName('Merged Document');
    }
  }, [open]);

  // Filtered list for the checkbox panel
  const filteredDocs = search.trim()
    ? allDocs.filter((d) =>
        d.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : allDocs;

  // Toggle selection
  const handleToggle = useCallback(
    (id: string, checked: boolean) => {
      if (checked) {
        setSelectedIds((prev) => [...prev, id]);
        const doc = allDocs.find((d) => d.id === id);
        if (doc) setMergeOrder((prev) => [...prev, doc]);
      } else {
        setSelectedIds((prev) => prev.filter((x) => x !== id));
        setMergeOrder((prev) => prev.filter((d) => d.id !== id));
      }
    },
    [allDocs]
  );

  // Remove from merge order (also deselects)
  const handleRemove = useCallback((id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setMergeOrder((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // Drag end - reorder mergeOrder array
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setMergeOrder((items) => {
        const oldIndex = items.findIndex((d) => d.id === active.id);
        const newIndex = items.findIndex((d) => d.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const totalPages = mergeOrder.reduce((sum, d) => sum + d.pageCount, 0);
  const canMerge = mergeOrder.length >= 2 && mergeName.trim().length > 0;

  const handleMerge = () => {
    if (!canMerge) return;
    onMerge(
      mergeOrder.map((d) => d.id),
      mergeName.trim()
    );
  };

  const footerEl = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        paddingTop: 4,
      }}
    >
      <Button onClick={onClose} disabled={merging} style={{ fontFamily: fonts.body }}>
        Cancel
      </Button>
      <Button
        type="primary"
        onClick={handleMerge}
        loading={merging}
        disabled={!canMerge}
        style={{
          background: canMerge ? colors.primary : undefined,
          borderColor: canMerge ? colors.primary : undefined,
          fontFamily: fonts.body,
          fontWeight: 600,
        }}
      >
        {merging
          ? 'Merging...'
          : `Merge${mergeOrder.length >= 2 ? ` (${mergeOrder.length})` : ''}`}
      </Button>
    </div>
  );

  return (
    <Modal
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: fontSizes.md }}>
          Merge Documents
        </span>
      }
      open={open}
      onCancel={onClose}
      width={560}
      footer={footerEl}
      maskClosable={!merging}
      closable={!merging}
      styles={{
        body: { padding: '16px 0 0', fontFamily: fonts.body },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        footer: { padding: '12px 24px 16px', borderTop: `1px solid ${colors.border}` },
      }}
    >
      {/* ── Section: Select Documents ── */}
      <div style={{ padding: '0 24px' }}>
        <Text
          style={{
            fontSize: fontSizes.xs,
            fontWeight: 600,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 8,
            fontFamily: fonts.body,
          }}
        >
          Select documents to merge
        </Text>

        {/* Search */}
        <Input
          prefix={<SearchOutlined style={{ color: colors.textMuted, fontSize: 13 }} />}
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{
            marginBottom: 8,
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
          }}
        />

        {/* Document list */}
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            maxHeight: 200,
            overflowY: 'auto',
            padding: '4px 6px',
          }}
        >
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <Spin size="small" />
            </div>
          ) : isError ? (
            <Alert
              type="error"
              message="Failed to load documents"
              style={{ margin: 8 }}
              showIcon
            />
          ) : filteredDocs.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>
                  {search ? 'No documents match your search' : 'No documents found'}
                </Text>
              }
              style={{ padding: '16px 0' }}
            />
          ) : (
            filteredDocs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                checked={selectedIds.includes(doc.id)}
                onChange={handleToggle}
              />
            ))
          )}
        </div>

        {selectedIds.length > 0 && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, marginTop: 6, display: 'block' }}>
            {selectedIds.length} document{selectedIds.length !== 1 ? 's' : ''} selected
          </Text>
        )}
      </div>

      {/* ── Section: Merge Order ── */}
      {mergeOrder.length > 0 && (
        <div style={{ padding: '16px 24px 0' }}>
          <Text
            style={{
              fontSize: fontSizes.xs,
              fontWeight: 600,
              color: colors.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'block',
              marginBottom: 8,
              fontFamily: fonts.body,
            }}
          >
            Merge order &mdash; drag to reorder
          </Text>

          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              padding: '6px 6px 2px',
              background: colors.bgLight,
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={mergeOrder.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                {mergeOrder.map((doc, index) => (
                  <SortableMergeItem
                    key={doc.id}
                    doc={doc}
                    index={index}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {/* ── Section: Name + Total ── */}
      <div style={{ padding: '16px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 0 }}>
          <div style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: fontSizes.xs,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: 6,
                fontFamily: fonts.body,
              }}
            >
              Name
            </Text>
            <Input
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              placeholder="Merged Document"
              maxLength={120}
              style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}
            />
          </div>
          {mergeOrder.length >= 2 && (
            <div style={{ paddingTop: 22, flexShrink: 0 }}>
              <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary, fontFamily: fonts.body }}>
                Total:{' '}
                <strong style={{ color: colors.textPrimary }}>
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </strong>
              </Text>
            </div>
          )}
        </div>

        {mergeOrder.length === 1 && (
          <Text
            style={{
              fontSize: fontSizes.xs,
              color: colors.textMuted,
              marginTop: 8,
              display: 'block',
              fontFamily: fonts.body,
            }}
          >
            Select at least 2 documents to merge.
          </Text>
        )}
      </div>

      {/* Spacer so footer doesn't crowd content */}
      <div style={{ height: 16 }} />
    </Modal>
  );
};

export default MergeModal;
