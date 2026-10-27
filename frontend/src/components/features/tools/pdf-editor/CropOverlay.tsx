/**
 * Scopit - PDF Editor: Crop pages
 *
 * CropOverlay sits on the page while the crop tool is on: drag to draw the
 * area to keep, then move it or pull its edges and corners. Outside it is
 * dimmed. CropBar holds the same area as margins (inches) and applies it to
 * this page, every page or a range -- the same margins on each, as the pages
 * are shown, like Acrobat's Crop Pages.
 *
 * Geometry is page units (the pdf.js viewport at scale 1, i.e. points),
 * like annotations.
 *
 * Usage:
 *   <CropOverlay pageWidth={w} pageHeight={h} zoom={zoom} rect={rect} onChange={setRect} />
 *   <CropBar pageWidth={w} pageHeight={h} rect={rect} onRectChange={setRect} ... />
 */
import React, { useRef, useState } from 'react';
import { Button, InputNumber, Select, Input, Tooltip, Typography } from 'antd';
import { ScissorOutlined } from '@ant-design/icons';
import type { CropMargins } from './types';
import { parsePageRanges } from './pageRanges';
import { colors, fonts, fontSizes, fontWeights, borderRadius } from '@/styles/theme';

const { Text } = Typography;

/** The area to keep, page units */
export interface CropRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Smallest area a crop may keep (the backend refuses less): half an inch
export const MIN_CROP = 36;
const POINTS_PER_INCH = 72;
const HANDLE = 10;

type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'new';

const GRIPS: { grip: Grip; left: string; top: string; cursor: string }[] = [
  { grip: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { grip: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { grip: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { grip: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { grip: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { grip: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { grip: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { grip: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The crop's margins (points, as the page is shown) */
export function rectToMargins(rect: CropRect, pageWidth: number, pageHeight: number): CropMargins {
  return {
    left: rect.x0,
    top: rect.y0,
    right: pageWidth - rect.x1,
    bottom: pageHeight - rect.y1,
  };
}

/** Whether a crop fits this page and would change anything */
export function isRealCrop(rect: CropRect | null, pageWidth: number, pageHeight: number): boolean {
  if (!rect) return false;
  const m = Object.values(rectToMargins(rect, pageWidth, pageHeight));
  // A sub-point overhang is the page size's rounding, not a bad crop
  return m.every((v) => v > -1) && m.some((v) => v > 0.5);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export interface CropOverlayProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  rect: CropRect | null;
  onChange: (rect: CropRect | null) => void;
}

export const CropOverlay: React.FC<CropOverlayProps> = ({ pageWidth, pageHeight, zoom, rect, onChange }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ grip: Grip; start: { x: number; y: number }; from: CropRect | null } | null>(null);
  const [dragging, setDragging] = useState(false);

  const pointAt = (e: React.PointerEvent) => {
    const box = rootRef.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / zoom, 0, pageWidth),
      y: clamp((e.clientY - box.top) / zoom, 0, pageHeight),
    };
  };

  const begin = (grip: Grip) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { grip, start: pointAt(e), from: rect };
    setDragging(true);
  };

  const move = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointAt(e);
    const { grip, start, from } = drag;
    if (grip === 'new' || !from) {
      onChange({
        x0: Math.min(start.x, p.x),
        y0: Math.min(start.y, p.y),
        x1: Math.max(start.x, p.x),
        y1: Math.max(start.y, p.y),
      });
      return;
    }
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (grip === 'move') {
      const w = from.x1 - from.x0;
      const h = from.y1 - from.y0;
      const x0 = clamp(from.x0 + dx, 0, pageWidth - w);
      const y0 = clamp(from.y0 + dy, 0, pageHeight - h);
      onChange({ x0, y0, x1: x0 + w, y1: y0 + h });
      return;
    }
    const next = { ...from };
    if (grip.includes('w')) next.x0 = clamp(from.x0 + dx, 0, from.x1 - MIN_CROP);
    if (grip.includes('e')) next.x1 = clamp(from.x1 + dx, from.x0 + MIN_CROP, pageWidth);
    if (grip.includes('n')) next.y0 = clamp(from.y0 + dy, 0, from.y1 - MIN_CROP);
    if (grip.includes('s')) next.y1 = clamp(from.y1 + dy, from.y0 + MIN_CROP, pageHeight);
    onChange(next);
  };

  const end = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    rootRef.current?.releasePointerCapture(e.pointerId);
    // A click, or a box too small to keep: no crop drawn
    if (drag.grip === 'new' && rect && (rect.x1 - rect.x0 < MIN_CROP || rect.y1 - rect.y0 < MIN_CROP)) {
      onChange(drag.from);
    }
  };

  const w = rect ? (rect.x1 - rect.x0) : 0;
  const h = rect ? (rect.y1 - rect.y0) : 0;

  return (
    <div
      ref={rootRef}
      role="application"
      aria-label="Crop area. Drag to draw the area to keep."
      onPointerDown={begin('new')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        position: 'absolute',
        inset: 0,
        width: pageWidth * zoom,
        height: pageHeight * zoom,
        overflow: 'hidden',
        cursor: 'crosshair',
        touchAction: 'none',
        zIndex: 5,
        background: rect ? 'transparent' : 'rgba(17, 24, 39, 0.08)',
      }}
    >
      {rect && (
        <div
          onPointerDown={begin('move')}
          style={{
            position: 'absolute',
            left: rect.x0 * zoom,
            top: rect.y0 * zoom,
            width: w * zoom,
            height: h * zoom,
            cursor: dragging ? 'grabbing' : 'move',
            outline: `1.5px solid ${colors.textPrimary}`,
            // Dims everything outside the area to keep
            boxShadow: '0 0 0 1px rgba(255,255,255,0.9), 0 0 0 9999px rgba(17, 24, 39, 0.45)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 6,
              top: 6,
              padding: '1px 6px',
              borderRadius: borderRadius.sm,
              background: 'rgba(17, 24, 39, 0.75)',
              color: colors.textWhite,
              fontFamily: fonts.body,
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {(w / POINTS_PER_INCH).toFixed(2)} × {(h / POINTS_PER_INCH).toFixed(2)} in
          </span>
          {GRIPS.map(({ grip, left, top, cursor }) => (
            <span
              key={grip}
              onPointerDown={begin(grip)}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left,
                top,
                width: HANDLE,
                height: HANDLE,
                marginLeft: -HANDLE / 2,
                marginTop: -HANDLE / 2,
                background: colors.bgWhite,
                border: `1.5px solid ${colors.textPrimary}`,
                borderRadius: 2,
                cursor,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Bar ───────────────────────────────────────────────────────────────────────

type Scope = 'page' | 'all' | 'range';

export interface CropBarProps {
  pageWidth: number;
  pageHeight: number;
  rect: CropRect | null;
  onRectChange: (rect: CropRect | null) => void;
  currentPage: number;
  pageCount: number;
  busy: boolean;
  /** pages: 1-based; undefined = every page */
  onApply: (margins: CropMargins, pages: number[] | undefined) => void;
  /** Show the whole page again */
  onReset: (pages: number[] | undefined) => void;
  onCancel: () => void;
}

const MARGINS: { key: keyof CropMargins; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

export const CropBar: React.FC<CropBarProps> = ({
  pageWidth,
  pageHeight,
  rect,
  onRectChange,
  currentPage,
  pageCount,
  busy,
  onApply,
  onReset,
  onCancel,
}) => {
  const [scope, setScope] = useState<Scope>('page');
  const [range, setRange] = useState('');

  const margins = rect
    ? rectToMargins(rect, pageWidth, pageHeight)
    : { left: 0, top: 0, right: 0, bottom: 0 };

  const setMargin = (key: keyof CropMargins, inches: number | null) => {
    const m = { ...margins, [key]: Math.max(0, (inches ?? 0) * POINTS_PER_INCH) };
    const next = {
      x0: m.left,
      y0: m.top,
      x1: pageWidth - m.right,
      y1: pageHeight - m.bottom,
    };
    if (next.x1 - next.x0 < MIN_CROP || next.y1 - next.y0 < MIN_CROP) return;
    onRectChange(next);
  };

  const rangePages = scope === 'range' ? parsePageRanges(range, pageCount) : null;
  const pages = scope === 'page' ? [currentPage] : scope === 'all' ? undefined : rangePages ?? undefined;
  const scopeOk = scope !== 'range' || !!rangePages;
  const canApply = !busy && scopeOk && isRealCrop(rect, pageWidth, pageHeight);

  return (
    <div
      role="toolbar"
      aria-label="Crop pages"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgWhite,
        fontFamily: fonts.body,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeights.semibold, fontSize: fontSizes.sm, color: colors.textPrimary }}>
        <ScissorOutlined /> Crop pages
      </span>
      <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
        {rect ? 'Drag the edges to adjust, or set margins.' : 'Drag on the page to choose the area to keep.'}
      </Text>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {MARGINS.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fontSizes.xs, color: colors.textSecondary }}>
            {label}
            <InputNumber
              size="small"
              min={0}
              step={0.05}
              precision={2}
              value={Math.round((margins[key] / POINTS_PER_INCH) * 100) / 100}
              onChange={(v) => setMargin(key, v)}
              suffix="in"
              style={{ width: 82 }}
              aria-label={`${label} margin in inches`}
            />
          </label>
        ))}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>Apply to</Text>
        <Select
          size="small"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'page', label: `This page (${currentPage})` },
            { value: 'all', label: 'All pages' },
            { value: 'range', label: 'Pages…' },
          ]}
          style={{ width: 132 }}
          popupMatchSelectWidth={false}
          aria-label="Pages to crop"
        />
        {scope === 'range' && (
          <Input
            size="small"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder={`e.g. 1-3, 5 (of ${pageCount})`}
            status={range && !rangePages ? 'error' : undefined}
            style={{ width: 150 }}
            aria-label="Page range"
          />
        )}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <Tooltip title="Show the whole page again on the chosen pages" mouseEnterDelay={0.5}>
          <Button size="small" disabled={busy || !scopeOk} onClick={() => onReset(pages)}>
            Remove crop
          </Button>
        </Tooltip>
        <Button size="small" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="small"
          type="primary"
          loading={busy}
          disabled={!canApply}
          onClick={() => {
            if (!rect) return;
            const m = rectToMargins(rect, pageWidth, pageHeight);
            onApply({
              left: Math.max(0, m.left),
              top: Math.max(0, m.top),
              right: Math.max(0, m.right),
              bottom: Math.max(0, m.bottom),
            }, pages);
          }}
        >
          Apply crop
        </Button>
      </span>
    </div>
  );
};
