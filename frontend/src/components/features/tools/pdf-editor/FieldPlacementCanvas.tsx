/**
 * Scopit - Field Placement Canvas
 *
 * Renders PDF pages (client-side via pdfjs) with draggable field overlays
 * positioned in fractional [0,1] coordinates. Shared by:
 *   - FieldMappingModal (template editor: place/select/drag/remove fields)
 *   - SendForSignModal (read-only preview of a template's saved fields)
 *
 * Coordinate model matches the existing public signing page (SignPage.tsx)
 * and the backend's field-burning logic exactly, so fields placed here
 * render identically everywhere else in the app.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Spin, Typography } from 'antd';
import { CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isMultilineText, type FieldDefinition } from './types';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

// Minimum field size, as a fraction of page width/height. Small enough for
// a checkbox, large enough that a resize drag can't collapse a field to
// nothing.
const MIN_FIELD_WIDTH = 0.02;
const MIN_FIELD_HEIGHT = 0.015;

// A resolved (prefilled) value can be much longer than the field's own
// placed width -- e.g. a full street address in a field sized for "Date".
// Rather than truncate real data with an ellipsis, the box grows to fit it,
// up to this cap (px), after which it wraps instead of running off forever.
const RESOLVED_VALUE_MAX_WIDTH = 320;

const { Text } = Typography;

// A small, deterministic palette for coloring fields by signer role so
// multiple recipients' fields are visually distinguishable at a glance.
// Shades chosen for >=4.5:1 contrast against white badge text.
const ROLE_PALETTE = ['#1d4ed8', '#047857', '#b45309', '#b91c1c', '#6d28d9', '#0e7490'];

function colorForRole(role: string | null | undefined): string {
  if (!role) return colors.textSecondary;
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) >>> 0;
  return ROLE_PALETTE[hash % ROLE_PALETTE.length];
}

function fieldColor(field: FieldDefinition): string {
  if (field.signerRole) return colorForRole(field.signerRole);
  if (field.dataBinding.mode === 'prefilled') return '#6b7280';
  return colors.primary; // creator_input, no role
}

function fieldBadgeText(field: FieldDefinition): string {
  const typeLabel = field.type.charAt(0).toUpperCase() + field.type.slice(1);
  return field.signerRole ? `${typeLabel} · ${field.signerRole}` : typeLabel;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface FieldPlacementCanvasProps {
  pdfDoc: PDFDocumentProxy | null;
  pageCount: number;
  fields: FieldDefinition[];
  selectedKey?: string | null;
  readOnly?: boolean;
  /** Present (and canvas becomes click-to-place) only in edit mode. */
  onPlaceField?: (page: number, x: number, y: number) => void;
  onSelectField?: (key: string) => void;
  onMoveField?: (key: string, x: number, y: number) => void;
  onResizeField?: (key: string, width: number, height: number) => void;
  onRemoveField?: (key: string) => void;
  maxHeight?: number | string;
  /** 1 = fit-to-container width (default). >1 zooms in, <1 zooms out. */
  zoom?: number;
  /** field.key -> already-known resolved value (e.g. from a customer picked
   * before a sign request exists server-side). Shown in place of the field's
   * generic label wherever present. */
  resolvedValues?: Record<string, string>;
}

export default function FieldPlacementCanvas({
  pdfDoc,
  pageCount,
  fields,
  selectedKey,
  readOnly = false,
  onPlaceField,
  onSelectField,
  onMoveField,
  onResizeField,
  onRemoveField,
  maxHeight = 480,
  zoom = 1,
  resolvedValues,
}: FieldPlacementCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const panStateRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // Dragging the blank canvas pans the view -- but only when a field type
  // isn't being actively placed, so click-to-place stays unambiguous.
  const panEnabled = !onPlaceField;

  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (!panEnabled || e.button !== 0 || !scrollRef.current) return;
    panStateRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
    setPanning(true);
  }, [panEnabled]);

  useEffect(() => {
    if (!panning) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = panStateRef.current;
      const scrollEl = scrollRef.current;
      if (!start || !scrollEl) return;
      scrollEl.scrollLeft = start.scrollLeft - (e.clientX - start.x);
      scrollEl.scrollTop = start.scrollTop - (e.clientY - start.y);
    };
    const handleMouseUp = () => {
      panStateRef.current = null;
      setPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panning]);

  return (
    <div
      ref={scrollRef}
      onMouseDown={handlePanMouseDown}
      style={{
        maxHeight,
        overflow: 'auto',
        paddingRight: 4,
        cursor: panEnabled ? (panning ? 'grabbing' : 'grab') : undefined,
        userSelect: panning ? 'none' : undefined,
      }}
    >
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
        <PageImage
          key={pageNum}
          pdfDoc={pdfDoc}
          pageNum={pageNum}
          fields={fields}
          selectedKey={selectedKey}
          readOnly={readOnly}
          onPlaceField={onPlaceField}
          onSelectField={onSelectField}
          onMoveField={onMoveField}
          onResizeField={onResizeField}
          onRemoveField={onRemoveField}
          zoom={zoom}
          resolvedValues={resolvedValues}
          showLabel={pageCount > 1}
        />
      ))}
    </div>
  );
}

// ── Page Image with Field Overlays ────────────────────────────────────────────

interface PageImageProps {
  pdfDoc: PDFDocumentProxy | null;
  pageNum: number;
  fields: FieldDefinition[];
  selectedKey?: string | null;
  readOnly: boolean;
  onPlaceField?: (page: number, x: number, y: number) => void;
  onSelectField?: (key: string) => void;
  onMoveField?: (key: string, x: number, y: number) => void;
  onResizeField?: (key: string, width: number, height: number) => void;
  onRemoveField?: (key: string) => void;
  zoom: number;
  resolvedValues?: Record<string, string>;
  /** Hide the "Page N" caption for single-page documents -- with nothing to
   * disambiguate, it's a redundant line taking space from the preview itself. */
  showLabel?: boolean;
}

function PageImage({
  pdfDoc,
  pageNum,
  fields,
  selectedKey,
  readOnly,
  onPlaceField,
  onSelectField,
  onMoveField,
  onResizeField,
  onRemoveField,
  zoom,
  resolvedValues,
  showLabel = true,
}: PageImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [pageWidthPt, setPageWidthPt] = useState<number | null>(null);

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    const render = async () => {
      setLoading(true);
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) { page.cleanup(); return; }

        const baseViewport = page.getViewport({ scale: 1 });
        if (!cancelled) setPageWidthPt(baseViewport.width);
        const scale = 1200 / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) { page.cleanup(); return; }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) { page.cleanup(); return; }

        await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;

        if (!cancelled) setLoading(false);
        page.cleanup();
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    render();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum]);

  useEffect(() => {
    if (loading || !canvasRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (canvasRef.current) {
        setCanvasSize({ w: canvasRef.current.offsetWidth, h: canvasRef.current.offsetHeight });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, zoom]);

  useEffect(() => {
    if (loading || !canvasRef.current) return;
    const measure = () => {
      if (canvasRef.current) {
        setCanvasSize({ w: canvasRef.current.offsetWidth, h: canvasRef.current.offsetHeight });
      }
    };
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loading]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly || !onPlaceField || !canvasRef.current || !canvasSize) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / canvasSize.w;
      const relY = (e.clientY - rect.top) / canvasSize.h;
      onPlaceField(pageNum, relX, relY);
    },
    [readOnly, onPlaceField, canvasSize, pageNum],
  );

  const pageFields = fields.filter((f) => f.page === pageNum);

  return (
    <div style={{ marginBottom: 24 }}>
      {showLabel && (
        <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, marginBottom: 6, fontFamily: fonts.body }}>
          Page {pageNum}
        </Text>
      )}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            position: 'relative',
            flexShrink: 0,
            width: `${zoom * 100}%`,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            overflow: 'hidden',
            cursor: readOnly || !onPlaceField ? 'default' : 'crosshair',
            background: colors.bgLight,
          }}
          onClick={handleClick}
        >
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: colors.textSecondary }} />} />
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ display: loading ? 'none' : 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }}
          />
          {canvasSize &&
            pageFields.map((field) => (
              <FieldOverlay
                key={field.key}
                field={field}
                imgWidth={canvasSize.w}
                imgHeight={canvasSize.h}
                pxPerPoint={pageWidthPt ? canvasSize.w / pageWidthPt : null}
                selected={field.key === selectedKey}
                readOnly={readOnly}
                onSelect={() => onSelectField?.(field.key)}
                onRemove={() => onRemoveField?.(field.key)}
                onMove={(x, y) => onMoveField?.(field.key, x, y)}
                onResize={(w, h) => onResizeField?.(field.key, w, h)}
                resolvedValue={resolvedValues?.[field.key]}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Field Overlay ─────────────────────────────────────────────────────────────

interface FieldOverlayProps {
  field: FieldDefinition;
  imgWidth: number;
  imgHeight: number;
  /** On-screen pixels per PDF point at the page's current render size, for
   *  converting field.fontSize (points, matches the burned-PDF unit) to a
   *  CSS pixel size. Null until the page has measured its own point width. */
  pxPerPoint: number | null;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMove: (relX: number, relY: number) => void;
  onResize: (relWidth: number, relHeight: number) => void;
  /** Already-known real value for this field (e.g. resolved from a customer
   * picked before a sign request exists server-side). Shown in place of the
   * field's generic label when present. */
  resolvedValue?: string;
}

const DRAG_THRESHOLD_PX = 3;

function FieldOverlay({ field, imgWidth, imgHeight, pxPerPoint, selected, readOnly, onSelect, onRemove, onMove, onResize, resolvedValue }: FieldOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const dragStartRef = useRef<{ startMouseX: number; startMouseY: number; startLeft: number; startTop: number; moved: boolean } | null>(null);

  const [resizing, setResizing] = useState(false);
  const [resizeDelta, setResizeDelta] = useState({ dw: 0, dh: 0 });
  const resizeStartRef = useRef<{ startMouseX: number; startMouseY: number; startWidth: number; startHeight: number } | null>(null);

  const left = field.x * imgWidth;
  const top = field.y * imgHeight;
  const width = field.width * imgWidth;
  const height = field.height * imgHeight;
  const accent = fieldColor(field);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    setDragOffset({ dx: 0, dy: 0 });
    dragStartRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startLeft: left, startTop: top, moved: false };
  }, [readOnly, left, top]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startMouseX;
      const dy = e.clientY - dragStartRef.current.startMouseY;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        dragStartRef.current.moved = true;
      }
      setDragOffset({ dx, dy });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      setDragging(false);
      setDragOffset({ dx: 0, dy: 0 });
      dragStartRef.current = null;
      if (!start) return;

      if (!start.moved) {
        onSelect();
        return;
      }
      const dx = e.clientX - start.startMouseX;
      const dy = e.clientY - start.startMouseY;
      const newRelX = Math.max(0, Math.min(1 - field.width, (start.startLeft + dx) / imgWidth));
      const newRelY = Math.max(0, Math.min(1 - field.height, (start.startTop + dy) / imgHeight));
      onMove(newRelX, newRelY);
      onSelect();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, field.width, field.height, imgWidth, imgHeight, onMove, onSelect]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
    setResizeDelta({ dw: 0, dh: 0 });
    resizeStartRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startWidth: width, startHeight: height };
  }, [readOnly, width, height]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;
      setResizeDelta({
        dw: e.clientX - resizeStartRef.current.startMouseX,
        dh: e.clientY - resizeStartRef.current.startMouseY,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      setResizing(false);
      setResizeDelta({ dw: 0, dh: 0 });
      resizeStartRef.current = null;
      if (!start) return;

      const newWidthPx = start.startWidth + (e.clientX - start.startMouseX);
      const newHeightPx = start.startHeight + (e.clientY - start.startMouseY);
      const maxRelWidth = 1 - field.x;
      const maxRelHeight = 1 - field.y;
      const newRelWidth = Math.max(MIN_FIELD_WIDTH, Math.min(maxRelWidth, newWidthPx / imgWidth));
      const newRelHeight = Math.max(MIN_FIELD_HEIGHT, Math.min(maxRelHeight, newHeightPx / imgHeight));
      onResize(newRelWidth, newRelHeight);
      onSelect();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, field.x, field.y, imgWidth, imgHeight, onResize, onSelect]);

  const displayLeft = dragging ? left + dragOffset.dx : left;
  const displayTop = dragging ? top + dragOffset.dy : top;
  const displayWidth = resizing ? Math.max(MIN_FIELD_WIDTH * imgWidth, width + resizeDelta.dw) : width;
  const displayHeight = resizing ? Math.max(MIN_FIELD_HEIGHT * imgHeight, height + resizeDelta.dh) : height;

  // Auto-fit the placeholder label to the field's own height (Adobe Acrobat's
  // "Auto" font-size behavior) so the label always sits proportionally inside
  // the box instead of a fixed size that looks cramped in short fields and
  // lost in tall ones. Recomputes live while resizing. A creator-chosen
  // fontSize (points, the same unit burned into the signed PDF) overrides
  // this and is converted to on-screen pixels so the preview matches the
  // real output at any zoom level.
  const labelFontSize = field.fontSize && pxPerPoint
    ? Math.max(6, Math.round(field.fontSize * pxPerPoint))
    : Math.max(9, Math.min(15, Math.round(displayHeight * 0.35)));

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: displayLeft,
        top: displayTop,
        // A resolved value shrink-to-fits (and grows) instead of a fixed
        // size, so the box always shows the whole value -- see
        // RESOLVED_VALUE_MAX_WIDTH.
        width: resolvedValue ? undefined : displayWidth,
        height: resolvedValue ? undefined : displayHeight,
        minWidth: resolvedValue ? displayWidth : undefined,
        minHeight: resolvedValue ? displayHeight : undefined,
        maxWidth: resolvedValue ? RESOLVED_VALUE_MAX_WIDTH : undefined,
        background: `${accent}14`,
        border: `1.5px ${readOnly ? 'solid' : 'dashed'} ${selected ? accent : `${accent}80`}`,
        borderRadius: borderRadius.sm,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: readOnly ? 'none' : 'all',
        cursor: readOnly ? 'default' : dragging ? 'grabbing' : 'grab',
        boxSizing: 'border-box',
        boxShadow: selected ? `0 0 0 2px ${accent}40` : 'none',
        transition: dragging || resizing ? 'none' : 'box-shadow 0.15s ease',
        userSelect: 'none',
        zIndex: dragging || resizing || selected ? 10 : 1,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          position: 'absolute',
          top: -1,
          left: 0,
          background: accent,
          color: '#fff',
          fontSize: 10,
          fontFamily: fonts.body,
          fontWeight: 600,
          padding: '1px 5px',
          borderRadius: `${borderRadius.sm} 0 ${borderRadius.sm} 0`,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {fieldBadgeText(field)}
        {field.required && ' *'}
      </div>
      {!readOnly && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove field"
          style={{
            position: 'absolute', top: -1, right: -1, width: 18, height: 18,
            background: colors.textSecondary, color: '#fff', border: 'none',
            borderRadius: `0 ${borderRadius.sm} 0 ${borderRadius.sm}`, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
          }}
        >
          <CloseOutlined style={{ fontSize: 9 }} />
        </button>
      )}
      {/* Checkbox fields are placed at a small square size where any label
          text has no room to fit -- the top badge already identifies the
          type, so skip it entirely rather than let it wrap/overflow. */}
      {field.type !== 'checkbox' && (
        <div
          style={
            resolvedValue
              // In-flow (not inset:0) so the box's own width/height -- now
              // shrink-to-fit, see the outer style above -- is driven by
              // this content instead of the other way around.
              ? { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px', pointerEvents: 'none' }
              : { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '0 6px', pointerEvents: 'none' }
          }
        >
          <Text
            style={{
              fontSize: labelFontSize,
              color: resolvedValue ? colors.textPrimary : colors.textSecondary,
              fontFamily: fonts.body,
              fontStyle: resolvedValue ? 'normal' : 'italic',
              fontWeight: resolvedValue ? 500 : 400,
              textAlign: 'center', lineHeight: 1.3,
              maxWidth: resolvedValue ? undefined : '100%',
              whiteSpace: resolvedValue ? 'normal' : 'nowrap',
              overflow: resolvedValue ? 'visible' : 'hidden',
              textOverflow: resolvedValue ? 'clip' : 'ellipsis',
              wordBreak: resolvedValue ? 'break-word' : undefined,
            }}
          >
            {resolvedValue ?? field.label}
            {!resolvedValue && isMultilineText(field) && ' (multi-line)'}
          </Text>
        </div>
      )}
      {!readOnly && (
        <div
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize"
          style={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            width: 11,
            height: 11,
            background: accent,
            border: '1.5px solid #fff',
            borderRadius: 2,
            cursor: 'nwse-resize',
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
}
