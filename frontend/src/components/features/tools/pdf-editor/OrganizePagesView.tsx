/**
 * Scopit - PDF Editor: Organize Pages
 *
 * A full-size grid of the document's pages (Adobe's "Organize pages"):
 * drag to reorder, select one or many (click, Ctrl/Cmd+click, Shift+click)
 * to rotate, delete, extract or duplicate them, and insert pages anywhere.
 * Every change is a page operation the parent runs on the server; when it
 * finishes the parent bumps `refreshKey` and the grid reloads.
 *
 * Usage (in place of the editor's canvas area):
 *   <OrganizePagesView
 *     documentId={documentId}
 *     documentName={doc.name}
 *     pageCount={doc.pageCount}
 *     currentPage={currentPage}
 *     refreshKey={pdfRefreshKey}
 *     busy={pageOpRunning}
 *     onClose={() => setOrganizeOpen(false)}
 *     onOpenPage={(p) => { setCurrentPage(p); setOrganizeOpen(false); }}
 *     onReorder={handlePagesReorder}
 *     onRotate={handlePagesRotate}
 *     onDelete={handlePagesDelete}
 *     onDuplicate={handlePagesDuplicate}
 *     onInsert={(after) => openInsert(after)}
 *     onExtract={(pages) => openExtract(pages)}
 *   />
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { App, Button, Spin, Tooltip, Typography } from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileAddOutlined,
  PlusOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePdfThumbnails } from './PageSidebar';
import { colors, fonts, borderRadius, shadows, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrganizePagesViewProps {
  documentId: string;
  documentName: string;
  pageCount: number;
  currentPage: number;
  /** Bumped after every page operation: thumbnails reload, selection clears */
  refreshKey: number;
  /** A page operation is running */
  busy: boolean;
  onClose: () => void;
  /** Open that page in the editor */
  onOpenPage: (page: number) => void;
  /** Current 1-based page numbers in their new order */
  onReorder: (newOrder: number[]) => void;
  /** {"3": 90} */
  onRotate: (rotations: Record<string, number>) => void;
  /** Already confirmed here */
  onDelete: (pages: number[]) => void;
  onDuplicate: (pages: number[]) => void;
  /** The parent asks what to insert at that position (0 = before page 1) */
  onInsert: (after: number) => void;
  /** The parent asks how to extract these pages */
  onExtract: (pages: number[]) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const THUMB_SCALE = 0.32;  // render scale: a Letter page comes out ~196px wide
const CELL_MIN = 168;      // px, grid column minimum
const GRID_GAP = 28;       // px, room for the "+" between pages
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMobile(e.matches);
    handler(mql);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return mobile;
}

// ── Insert affordance ─────────────────────────────────────────────────────────

const InsertButton: React.FC<{
  after: number;
  side: 'left' | 'right';
  visible: boolean;
  disabled: boolean;
  onInsert: (after: number) => void;
}> = ({ after, side, visible, disabled, onInsert }) => (
  <Tooltip title={after === 0 ? 'Insert before page 1' : `Insert after page ${after}`}>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onInsert(after);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      aria-label={after === 0 ? 'Insert pages before page 1' : `Insert pages after page ${after}`}
      style={{
        position: 'absolute',
        top: '42%',
        [side]: -(GRID_GAP / 2) - 11,
        width: 22,
        height: 22,
        borderRadius: borderRadius.full,
        border: `1px solid ${colors.borderDark}`,
        background: colors.bgWhite,
        color: colors.textSecondary,
        boxShadow: shadows.sm,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.12s ease',
        zIndex: 3,
      }}
      // Keyboard users reach it even while hidden
      onFocus={(e) => { e.currentTarget.style.opacity = '1'; }}
      onBlur={(e) => { if (!visible) e.currentTarget.style.opacity = '0'; }}
    >
      <PlusOutlined style={{ fontSize: 11 }} />
    </button>
  </Tooltip>
);

// ── Page card ─────────────────────────────────────────────────────────────────

interface PageCardProps {
  pageNum: number;
  thumbUrl: string | undefined;
  isCurrent: boolean;
  isSelected: boolean;
  isFirst: boolean;
  busy: boolean;
  onSelect: (pageNum: number, e: ReactMouseEvent | ReactKeyboardEvent) => void;
  onOpen: (pageNum: number) => void;
  onRotate: (pageNum: number, degrees: number) => void;
  onDelete: (pageNum: number) => void;
  onInsert: (after: number) => void;
  registerRef: (pageNum: number, el: HTMLDivElement | null) => void;
  onFocusPage: (pageNum: number) => void;
}

const PageCard: React.FC<PageCardProps> = ({
  pageNum,
  thumbUrl,
  isCurrent,
  isSelected,
  isFirst,
  busy,
  onSelect,
  onOpen,
  onRotate,
  onDelete,
  onInsert,
  registerRef,
  onFocusPage,
}) => {
  const [hovered, setHovered] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pageNum, disabled: busy });

  const ring = isSelected ? colors.textPrimary : isCurrent ? colors.borderDark : colors.border;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 10 : hovered ? 2 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isFirst && (
        <InsertButton after={0} side="left" visible={hovered} disabled={busy} onInsert={onInsert} />
      )}
      <InsertButton after={pageNum} side="right" visible={hovered} disabled={busy} onInsert={onInsert} />

      <div
        ref={(el) => registerRef(pageNum, el)}
        {...attributes}
        {...listeners}
        role="option"
        aria-selected={isSelected}
        aria-label={`Page ${pageNum}${isCurrent ? ', open in the editor' : ''}`}
        tabIndex={0}
        onFocus={() => onFocusPage(pageNum)}
        onClick={(e) => onSelect(pageNum, e)}
        onDoubleClick={() => onOpen(pageNum)}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 196,
          aspectRatio: thumbUrl ? undefined : '0.773',
          minHeight: 80,
          background: colors.bgWhite,
          borderRadius: borderRadius.sm,
          outline: `${isSelected ? 2 : 1}px solid ${ring}`,
          outlineOffset: isSelected ? 2 : 0,
          boxShadow: isDragging ? shadows.lg : hovered ? shadows.md : shadows.sm,
          opacity: isDragging ? 0.6 : 1,
          cursor: busy ? 'progress' : isDragging ? 'grabbing' : 'grab',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'box-shadow 0.15s ease, outline-color 0.15s ease',
          userSelect: 'none',
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            draggable={false}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        ) : (
          <Spin size="small" />
        )}

        {isSelected && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              width: 20,
              height: 20,
              borderRadius: borderRadius.full,
              background: colors.primary,
              color: colors.textWhite,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              boxShadow: shadows.sm,
            }}
          >
            <CheckOutlined />
          </span>
        )}

        {/* Hover actions */}
        {hovered && !busy && (
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: 2,
              padding: 2,
              background: 'rgba(255,255,255,0.95)',
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.base,
              boxShadow: shadows.base,
            }}
          >
            <Tooltip title="Rotate left">
              <Button
                type="text"
                size="small"
                icon={<RotateLeftOutlined style={{ fontSize: 13 }} />}
                onClick={() => onRotate(pageNum, 270)}
                style={{ width: 26, height: 26, padding: 0, color: colors.textSecondary }}
                aria-label={`Rotate page ${pageNum} left`}
              />
            </Tooltip>
            <Tooltip title="Rotate right">
              <Button
                type="text"
                size="small"
                icon={<RotateRightOutlined style={{ fontSize: 13 }} />}
                onClick={() => onRotate(pageNum, 90)}
                style={{ width: 26, height: 26, padding: 0, color: colors.textSecondary }}
                aria-label={`Rotate page ${pageNum} right`}
              />
            </Tooltip>
            <Tooltip title="Delete page">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined style={{ fontSize: 13 }} />}
                onClick={() => onDelete(pageNum)}
                style={{ width: 26, height: 26, padding: 0, color: colors.textMuted }}
                aria-label={`Delete page ${pageNum}`}
              />
            </Tooltip>
          </div>
        )}
      </div>

      <Text
        style={{
          fontSize: fontSizes.xs,
          fontFamily: fonts.body,
          fontVariantNumeric: 'tabular-nums',
          color: isSelected || isCurrent ? colors.textPrimary : colors.textSecondary,
          fontWeight: isSelected || isCurrent ? fontWeights.semibold : fontWeights.normal,
          lineHeight: 1,
        }}
      >
        {pageNum}
      </Text>
    </div>
  );
};

// ── Header action button ──────────────────────────────────────────────────────

const HeaderAction: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  compact: boolean;
}> = ({ label, icon, onClick, disabled, danger, compact }) => (
  <Tooltip title={compact ? label : undefined}>
    <Button
      size="small"
      type="text"
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        height: 30,
        fontSize: fontSizes.xs,
        fontFamily: fonts.body,
        color: disabled ? undefined : danger ? colors.error : colors.textSecondary,
        padding: compact ? '0 7px' : '0 8px',
      }}
    >
      {!compact && label}
    </Button>
  </Tooltip>
);

// ── Main component ────────────────────────────────────────────────────────────

const OrganizePagesView: React.FC<OrganizePagesViewProps> = ({
  documentId,
  documentName,
  pageCount,
  currentPage,
  refreshKey,
  busy,
  onClose,
  onOpenPage,
  onReorder,
  onRotate,
  onDelete,
  onDuplicate,
  onInsert,
  onExtract,
}) => {
  const { modal } = App.useApp();
  const isMobile = useIsMobile();
  const [order, setOrder] = useState<number[]>(() =>
    Array.from({ length: pageCount }, (_, i) => i + 1),
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const focusedRef = useRef<number | null>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const rootRef = useRef<HTMLDivElement>(null);

  const { thumbs, loading } = usePdfThumbnails(documentId, pageCount, refreshKey, THUMB_SCALE);

  // A page operation changed the file: the server's order is the new 1..n
  useEffect(() => {
    setOrder(Array.from({ length: pageCount }, (_, i) => i + 1));
    setSelected(new Set());
    anchorRef.current = null;
  }, [documentId, pageCount, refreshKey]);

  // Keyboard shortcuts work as soon as the view opens
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (busy || !over || active.id === over.id) return;
      const next = arrayMove(order, order.indexOf(active.id as number), order.indexOf(over.id as number));
      setOrder(next);
      onReorder(next);
    },
    [busy, order, onReorder],
  );

  // ── Selection ───────────────────────────────────────────────────────────────

  const selectedPages = Array.from(selected).sort((a, b) => a - b);

  const handleSelect = useCallback(
    (pageNum: number, e: ReactMouseEvent | ReactKeyboardEvent) => {
      if (e.shiftKey && anchorRef.current !== null) {
        const from = order.indexOf(anchorRef.current);
        const to = order.indexOf(pageNum);
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected(new Set(order.slice(lo, hi + 1)));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(pageNum)) next.delete(pageNum);
          else next.add(pageNum);
          return next;
        });
      } else {
        setSelected((prev) => (prev.size === 1 && prev.has(pageNum) ? new Set() : new Set([pageNum])));
      }
      anchorRef.current = pageNum;
    },
    [order],
  );

  const allSelected = pageCount > 0 && selected.size === pageCount;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(order));

  // ── Actions ────────────────────────────────────────────────────────────────

  const confirmDelete = useCallback(
    (pages: number[]) => {
      if (!pages.length || busy) return;
      if (pages.length >= pageCount) {
        modal.info({
          title: "Can't delete every page",
          content: 'A document needs at least one page.',
        });
        return;
      }
      const sorted = [...pages].sort((a, b) => a - b);
      modal.confirm({
        title: sorted.length === 1 ? `Delete page ${sorted[0]}?` : `Delete ${sorted.length} pages?`,
        content:
          sorted.length === 1
            ? 'The page and anything you added on it will be removed. This cannot be undone.'
            : `Pages ${sorted.join(', ')} and anything you added on them will be removed. This cannot be undone.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => onDelete(sorted),
      });
    },
    [busy, modal, pageCount, onDelete],
  );

  const rotateSelection = (degrees: number) => {
    if (!selectedPages.length || busy) return;
    onRotate(Object.fromEntries(selectedPages.map((p) => [String(p), degrees])));
  };

  const insertAfter = selectedPages.length ? selectedPages[selectedPages.length - 1] : pageCount;

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const focusPage = (pageNum: number | undefined) => {
    if (pageNum === undefined) return;
    cardRefs.current.get(pageNum)?.focus();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const isMeta = e.ctrlKey || e.metaKey;
    // Enter / Space act on a page only while that page has focus; on a
    // button (insert, Done, a hover action) they press the button
    const focusedCard = focusedRef.current !== null
      && e.target === cardRefs.current.get(focusedRef.current) ? focusedRef.current : null;

    if (isMeta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(order));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedPages.length) {
        e.preventDefault();
        confirmDelete(selectedPages);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (selected.size) setSelected(new Set());
      else onClose();
    } else if (e.key === 'Enter' && focusedCard !== null) {
      e.preventDefault();
      onOpenPage(focusedCard);
    } else if (e.key === ' ' && focusedCard !== null) {
      e.preventDefault();
      handleSelect(focusedCard, e);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const at = focusedRef.current === null ? -1 : order.indexOf(focusedRef.current);
      const next = e.key === 'ArrowRight' ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1);
      e.preventDefault();
      focusPage(order[next]);
    }
  };

  const registerRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(pageNum, el);
    else cardRefs.current.delete(pageNum);
  }, []);

  const handleFocusPage = useCallback((pageNum: number) => {
    focusedRef.current = pageNum;
  }, []);

  const handleRotateOne = useCallback(
    (pageNum: number, degrees: number) => {
      if (!busy) onRotate({ [String(pageNum)]: degrees });
    },
    [busy, onRotate],
  );

  const handleDeleteOne = useCallback((pageNum: number) => confirmDelete([pageNum]), [confirmDelete]);

  const handleInsert = useCallback(
    (after: number) => {
      if (!busy) onInsert(after);
    },
    [busy, onInsert],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const none = selectedPages.length === 0;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Organize pages"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        height: '100%',
        background: colors.bgSunken,
        outline: 'none',
        fontFamily: fonts.body,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: isMobile ? '8px 10px' : '10px 16px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: 'auto' }}>
          <Text
            style={{
              fontFamily: fonts.heading,
              fontSize: fontSizes.base,
              fontWeight: fontWeights.semibold,
              color: colors.textPrimary,
              lineHeight: 1.3,
            }}
          >
            Organize pages
          </Text>
          <Text
            ellipsis
            style={{ fontSize: fontSizes.xs, color: colors.textMuted, maxWidth: isMobile ? 160 : 320 }}
            aria-live="polite"
          >
            {selected.size
              ? `${selected.size} of ${pageCount} selected`
              : `${documentName} · ${pageCount} page${pageCount !== 1 ? 's' : ''}`}
          </Text>
        </div>

        {(busy || loading) && <Spin size="small" aria-label={busy ? 'Updating pages' : 'Loading pages'} />}

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }} role="toolbar" aria-label="Page actions">
          <HeaderAction
            compact={isMobile}
            label={allSelected ? 'Clear selection' : 'Select all'}
            icon={<CheckOutlined />}
            onClick={toggleSelectAll}
            disabled={!pageCount}
          />
          <HeaderAction
            compact={isMobile}
            label="Rotate left"
            icon={<RotateLeftOutlined />}
            onClick={() => rotateSelection(270)}
            disabled={none || busy}
          />
          <HeaderAction
            compact={isMobile}
            label="Rotate right"
            icon={<RotateRightOutlined />}
            onClick={() => rotateSelection(90)}
            disabled={none || busy}
          />
          <HeaderAction
            compact={isMobile}
            label="Duplicate"
            icon={<CopyOutlined />}
            onClick={() => !busy && onDuplicate(selectedPages)}
            disabled={none || busy}
          />
          <HeaderAction
            compact={isMobile}
            label="Extract"
            icon={<ExportOutlined />}
            onClick={() => !busy && onExtract(selectedPages)}
            disabled={none || busy}
          />
          <HeaderAction
            compact={isMobile}
            label="Delete"
            icon={<DeleteOutlined />}
            onClick={() => confirmDelete(selectedPages)}
            disabled={none || busy}
            danger
          />
          <HeaderAction
            compact={isMobile}
            label={none ? 'Insert pages' : `Insert after page ${insertAfter}`}
            icon={<FileAddOutlined />}
            onClick={() => handleInsert(insertAfter)}
            disabled={busy}
          />
        </div>

        <Button
          type="primary"
          size="small"
          onClick={onClose}
          style={{ height: 30, fontFamily: fonts.body, fontWeight: fontWeights.semibold, marginLeft: 4 }}
        >
          Done
        </Button>

        {busy && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: -1,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${colors.textSecondary}, transparent)`,
              backgroundSize: '200% 100%',
              animation: 'scopit-organize-progress 1.1s linear infinite',
            }}
          />
        )}
        <style>{'@keyframes scopit-organize-progress { from { background-position: 100% 0; } to { background-position: -100% 0; } }'}</style>
      </div>

      {/* Grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: isMobile ? `16px ${GRID_GAP / 2 + 8}px 32px` : `24px ${GRID_GAP}px 48px`,
        }}
      >
        {!isMobile && (
          <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textMuted, marginBottom: 16 }}>
            Drag to reorder. Click to select, Ctrl+click or Shift+click for more. Double-click opens a page.
          </Text>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div
              role="listbox"
              aria-multiselectable
              aria-label="Pages"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 120 : CELL_MIN}px, 1fr))`,
                gap: `${GRID_GAP}px ${GRID_GAP}px`,
                alignItems: 'end',
                justifyItems: 'center',
                opacity: busy ? 0.7 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              {order.map((pageNum, index) => (
                <PageCard
                  key={pageNum}
                  pageNum={pageNum}
                  thumbUrl={thumbs[pageNum]}
                  isCurrent={pageNum === currentPage}
                  isSelected={selected.has(pageNum)}
                  isFirst={index === 0}
                  busy={busy}
                  onSelect={handleSelect}
                  onOpen={onOpenPage}
                  onRotate={handleRotateOne}
                  onDelete={handleDeleteOne}
                  onInsert={handleInsert}
                  registerRef={registerRef}
                  onFocusPage={handleFocusPage}
                />
              ))}

              {/* Add pages at the end */}
              <button
                type="button"
                onClick={() => handleInsert(pageCount)}
                disabled={busy}
                aria-label="Insert pages at the end"
                style={{
                  width: '100%',
                  maxWidth: 196,
                  aspectRatio: '0.773',
                  marginBottom: 20,
                  border: `1px dashed ${colors.borderDark}`,
                  borderRadius: borderRadius.sm,
                  background: 'transparent',
                  color: colors.textMuted,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontFamily: fonts.body,
                  fontSize: fontSizes.xs,
                  transition: 'border-color 0.15s ease, color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (busy) return;
                  e.currentTarget.style.borderColor = colors.textSecondary;
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = colors.borderDark;
                  e.currentTarget.style.color = colors.textMuted;
                }}
              >
                <FileAddOutlined style={{ fontSize: 20 }} />
                Add pages
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

export default OrganizePagesView;
