/**
 * Scopit - Page Sidebar
 *
 * Scrollable panel showing page thumbnails for the open PDF document.
 * Features:
 *   - Thumbnails rendered via pdfjs-dist (no extra API calls)
 *   - Drag-and-drop reorder via @dnd-kit
 *   - Single and Ctrl+Click multi-select
 *   - Hover icons: rotate CW / CCW, delete
 *   - "Delete Selected" batch action
 *
 * Usage:
 *   <PageSidebar
 *     documentId={editorState.documentId}
 *     pageCount={doc.pageCount}
 *     currentPage={editorState.currentPage}
 *     onPageSelect={setPage}
 *     onPagesReorder={handleReorder}
 *     onPagesDelete={handleDelete}
 *     onPagesRotate={handleRotate}
 *   />
 */
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button, Spin, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
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
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts, borderRadius, shadows } from '@/styles/theme';
import './pdfWorker';

const { Text } = Typography;

// ── Constants ─────────────────────────────────────────────────────────────────

const THUMB_WIDTH = 120; // px – rendered thumbnail width
const THUMB_SCALE = 0.18; // render scale used for thumbnail canvas
const SIDEBAR_WIDTH = 160; // px – total sidebar width

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageSidebarProps {
  documentId: string;
  pageCount: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
  onPagesReorder: (newOrder: number[]) => void;
  onPagesDelete: (pages: number[]) => void;
  onPagesRotate: (rotations: Record<string, number>) => void;
  /** Increment to force thumbnail reload after page operations */
  refreshKey?: number;
}

// ── Thumbnail Hook ────────────────────────────────────────────────────────────

/**
 * Loads the PDF once and renders all pages to data-URLs at THUMB_SCALE.
 * Returns a map of 1-based page number → data-URL string.
 */
function usePdfThumbnails(
  documentId: string,
  pageCount: number,
  refreshKey = 0,
): { thumbs: Record<number, string>; loading: boolean } {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!documentId || pageCount === 0) return;

    let cancelled = false;
    setLoading(true);
    setThumbs({});

    const run = async () => {
      try {
        // Destroy previous
        if (pdfRef.current) {
          await pdfRef.current.destroy();
          pdfRef.current = null;
        }

        const token = useAuthStore.getState().accessToken;
        const apiBase = import.meta.env.VITE_API_URL || '/api';
        const url = `${apiBase}/tools/pdf-editor/documents/${documentId}/download`;

        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || cancelled) return;

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        pdfRef.current = pdf;

        // Render pages one by one and collect data URLs
        const map: Record<number, string> = {};
        for (let i = 1; i <= pageCount; i++) {
          if (cancelled) break;
          try {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: THUMB_SCALE });

            const offscreen = document.createElement('canvas');
            offscreen.width = viewport.width;
            offscreen.height = viewport.height;

            const ctx = offscreen.getContext('2d');
            if (!ctx) continue;
            await page.render({ canvas: offscreen, canvasContext: ctx, viewport }).promise;
            page.cleanup();

            map[i] = offscreen.toDataURL('image/jpeg', 0.8);
            // Update incrementally so thumbnails appear as they render
            if (!cancelled) {
              setThumbs((prev) => ({ ...prev, [i]: map[i] }));
            }
          } catch {
            // Skip failed pages silently
          }
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[PageSidebar] Thumbnail load error:', err);
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [documentId, pageCount, refreshKey]);

  return { thumbs, loading };
}

// ── Sortable Thumbnail Item ────────────────────────────────────────────────────

interface ThumbItemProps {
  pageNum: number;
  thumbUrl: string | undefined;
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: (pageNum: number, e: ReactMouseEvent) => void;
  onRotateCW: (pageNum: number) => void;
  onRotateCCW: (pageNum: number) => void;
  onDelete: (pageNum: number) => void;
}

const ThumbItem: React.FC<ThumbItemProps> = ({
  pageNum,
  thumbUrl,
  isCurrent,
  isSelected,
  onSelect,
  onRotateCW,
  onRotateCCW,
  onDelete,
}) => {
  const [hovered, setHovered] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pageNum });

  const thumbHeight = thumbUrl
    ? undefined // let the img determine its own height
    : Math.round(THUMB_WIDTH * 1.414); // A4 aspect ratio fallback

  const borderColor = isCurrent
    ? colors.textPrimary
    : isSelected
    ? colors.textSecondary
    : colors.border;

  const borderWidth = isCurrent || isSelected ? 2 : 1;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        padding: '8px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      {...attributes}
    >
      {/* Thumbnail container */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => onSelect(pageNum, e)}
        role="button"
        tabIndex={0}
        aria-label={`Page ${pageNum}${isCurrent ? ' (current)' : ''}${isSelected ? ' (selected)' : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(pageNum, e as unknown as ReactMouseEvent);
          }
        }}
      >
        {/* Drag handle area - uses dnd-kit listeners */}
        <div
          {...listeners}
          style={{ position: 'absolute', inset: 0, zIndex: 1, cursor: 'grab' }}
          aria-hidden
        />

        {/* Thumbnail image or placeholder */}
        <div
          style={{
            width: THUMB_WIDTH,
            height: thumbHeight,
            border: `${borderWidth}px solid ${borderColor}`,
            borderRadius: borderRadius.sm,
            overflow: 'hidden',
            background: colors.bgWhite,
            boxShadow: isCurrent ? shadows.md : shadows.sm,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          }}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={`Page ${pageNum} thumbnail`}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                filter: 'grayscale(0%)',
              }}
              draggable={false}
            />
          ) : (
            <div
              style={{
                width: THUMB_WIDTH,
                height: thumbHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: colors.bgLight,
              }}
            >
              <Spin size="small" />
            </div>
          )}
        </div>

        {/* Hover action bar - floats above the thumbnail */}
        {hovered && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              background: 'rgba(255,255,255,0.92)',
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              padding: 2,
              boxShadow: shadows.base,
            }}
            // Stop click propagation so hover buttons don't also trigger page select
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip title="Rotate clockwise" placement="right">
              <Button
                type="text"
                size="small"
                icon={<RotateRightOutlined style={{ fontSize: 13 }} />}
                onClick={() => onRotateCW(pageNum)}
                style={{ width: 24, height: 24, padding: 0, color: colors.textSecondary }}
                aria-label={`Rotate page ${pageNum} clockwise`}
              />
            </Tooltip>
            <Tooltip title="Rotate counter-clockwise" placement="right">
              <Button
                type="text"
                size="small"
                icon={<RotateLeftOutlined style={{ fontSize: 13 }} />}
                onClick={() => onRotateCCW(pageNum)}
                style={{ width: 24, height: 24, padding: 0, color: colors.textSecondary }}
                aria-label={`Rotate page ${pageNum} counter-clockwise`}
              />
            </Tooltip>
            <Tooltip title="Delete page" placement="right">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined style={{ fontSize: 13 }} />}
                onClick={() => onDelete(pageNum)}
                style={{ width: 24, height: 24, padding: 0, color: colors.textMuted }}
                aria-label={`Delete page ${pageNum}`}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {/* Page number label */}
      <Text
        style={{
          fontSize: 11,
          color: isCurrent ? colors.textPrimary : colors.textSecondary,
          fontFamily: fonts.body,
          fontWeight: isCurrent ? 600 : 400,
          lineHeight: 1,
        }}
      >
        {pageNum}
      </Text>
    </div>
  );
};

// ── PageSidebar ───────────────────────────────────────────────────────────────

const PageSidebar: React.FC<PageSidebarProps> = ({
  documentId,
  pageCount,
  currentPage,
  onPageSelect,
  onPagesReorder,
  onPagesDelete,
  onPagesRotate,
  refreshKey = 0,
}) => {
  // Ordered list of 1-based page numbers (reflects local reorder before API call)
  const [pageOrder, setPageOrder] = useState<number[]>(() =>
    Array.from({ length: pageCount }, (_, i) => i + 1),
  );
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  const { thumbs, loading: thumbsLoading } = usePdfThumbnails(documentId, pageCount, refreshKey);

  // Re-initialise order when the document changes (e.g. after a delete/reorder
  // that updates pageCount)
  useEffect(() => {
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i + 1));
    setSelectedPages(new Set());
  }, [documentId, pageCount]);

  // ── DnD ────────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 4 px of movement before initiating a drag so clicks still work
      activationConstraint: { distance: 4 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setPageOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as number);
        const newIndex = prev.indexOf(over.id as number);
        const next = arrayMove(prev, oldIndex, newIndex);
        onPagesReorder(next);
        return next;
      });
    },
    [onPagesReorder],
  );

  // ── Selection ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (pageNum: number, e: ReactMouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Toggle multi-select
        setSelectedPages((prev) => {
          const next = new Set(prev);
          if (next.has(pageNum)) {
            next.delete(pageNum);
          } else {
            next.add(pageNum);
          }
          return next;
        });
      } else {
        // Navigate to page and clear selection
        setSelectedPages(new Set());
        onPageSelect(pageNum);
      }
    },
    [onPageSelect],
  );

  // ── Rotate ─────────────────────────────────────────────────────────────────

  const handleRotateCW = useCallback(
    (pageNum: number) => {
      onPagesRotate({ [String(pageNum)]: 90 });
    },
    [onPagesRotate],
  );

  const handleRotateCCW = useCallback(
    (pageNum: number) => {
      onPagesRotate({ [String(pageNum)]: 270 });
    },
    [onPagesRotate],
  );

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteSingle = useCallback(
    (pageNum: number) => {
      onPagesDelete([pageNum]);
    },
    [onPagesDelete],
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedPages.size === 0) return;
    onPagesDelete(Array.from(selectedPages));
    setSelectedPages(new Set());
  }, [selectedPages, onPagesDelete]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <aside
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${colors.border}`,
        background: colors.bgWhite,
        height: '100%',
        overflow: 'hidden',
      }}
      aria-label="Page thumbnails"
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px 8px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            fontWeight: 600,
            color: colors.textPrimary,
          }}
        >
          Pages ({pageCount})
        </Text>
        {thumbsLoading && <Spin size="small" />}
      </div>

      {/* Batch delete bar */}
      {selectedPages.size > 0 && (
        <div
          style={{
            padding: '6px 10px',
            borderBottom: `1px solid ${colors.border}`,
            background: colors.bgLight,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <Text style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body, flex: 1 }}>
            {selectedPages.size} selected
          </Text>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined style={{ fontSize: 11 }} />}
            onClick={handleDeleteSelected}
            style={{
              fontFamily: fonts.body,
              fontSize: 11,
              height: 22,
              padding: '0 6px',
              color: colors.textMuted,
            }}
          >
            Delete
          </Button>
        </div>
      )}

      {/* Scrollable thumbnail list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingBottom: 16,
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={pageOrder} strategy={verticalListSortingStrategy}>
            {pageOrder.map((pageNum) => (
              <ThumbItem
                key={pageNum}
                pageNum={pageNum}
                thumbUrl={thumbs[pageNum]}
                isCurrent={pageNum === currentPage}
                isSelected={selectedPages.has(pageNum)}
                onSelect={handleSelect}
                onRotateCW={handleRotateCW}
                onRotateCCW={handleRotateCCW}
                onDelete={handleDeleteSingle}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  );
};

export default PageSidebar;
