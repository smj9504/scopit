/**
 * Scopit - PDF Editor Property Panel
 *
 * Right-side panel that displays and edits properties of the
 * currently selected annotation. Renders context-sensitive fields
 * depending on annotation type (text | image | drawing | stamp | sign_field).
 *
 * Usage:
 *   <PropertyPanel
 *     selectedAnnotation={annotation}
 *     onAnnotationUpdate={handleUpdate}
 *     onAnnotationDelete={handleDelete}
 *   />
 */
import React, { useCallback } from 'react';
import {
  Button,
  InputNumber,
  Select,
  Slider,
  ColorPicker,
  Typography,
  Divider,
  Tooltip,
  Space,
} from 'antd';
import type { Color } from 'antd/es/color-picker';
import {
  DeleteOutlined,
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  VerticalAlignTopOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons';
import type { Annotation, AnnotationStyle } from './types';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PropertyPanelProps {
  selectedAnnotation: Annotation | null;
  onAnnotationUpdate: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FONT_FAMILIES = [
  { value: 'Arial',           label: 'Arial' },
  { value: 'Helvetica',       label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier',         label: 'Courier' },
  { value: 'Georgia',         label: 'Georgia' },
];

const PANEL_WIDTH = 240;

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  panel: {
    width: PANEL_WIDTH,
    minWidth: PANEL_WIDTH,
    maxWidth: PANEL_WIDTH,
    background: colors.bgWhite,
    borderLeft: `1px solid ${colors.border}`,
    fontFamily: fonts.body,
    display: 'flex',
    flexDirection: 'column' as const,
    overflowY: 'auto' as const,
    flexShrink: 0,
  },
  panelHeader: {
    padding: '10px 12px 8px',
    borderBottom: `1px solid ${colors.border}`,
  },
  panelTitle: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 20,
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    lineHeight: 1.5,
  },
  section: {
    padding: '10px 12px',
  },
  sectionTitle: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textSecondary,
    marginBottom: 8,
    display: 'block',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  label: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    width: 16,
    flexShrink: 0,
  },
  toggleBtn: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    border: `1px solid ${active ? colors.borderDark : colors.border}`,
    borderRadius: borderRadius.sm,
    background: active ? colors.bgLight : 'transparent',
    color: active ? colors.textPrimary : colors.textSecondary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? fontWeights.bold : fontWeights.normal,
    transition: 'all 0.15s ease',
    outline: 'none',
    padding: 0,
    flexShrink: 0,
  }),
  colorRowLabel: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    flex: 1,
  },
  deleteBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.base,
    background: 'transparent',
    color: colors.error,
    cursor: 'pointer',
    fontSize: fontSizes.xs,
    fontFamily: fonts.body,
    fontWeight: fontWeights.medium,
    transition: 'all 0.15s ease',
    outline: 'none',
  },
  orderBtnGroup: {
    display: 'flex',
    gap: 6,
    width: '100%',
  },
} as const;

// ── Helper: compact InputNumber ───────────────────────────────────────────────

const CompactNumber: React.FC<{
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
}> = ({ value, onChange, min, max, step = 1, suffix, style, 'aria-label': ariaLabel }) => (
  <InputNumber
    size="small"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={(v) => { if (v !== null) onChange(v); }}
    controls={false}
    formatter={suffix ? (v) => `${v}${suffix}` : undefined}
    parser={suffix ? (v) => Number((v ?? '').replace(suffix, '')) as never : undefined}
    aria-label={ariaLabel}
    style={{
      flex: 1,
      height: 28,
      fontSize: fontSizes.xs,
      fontFamily: fonts.body,
      ...style,
    }}
  />
);

// ── Helper: style toggle button ───────────────────────────────────────────────

const StyleToggle: React.FC<{
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}> = ({ active, label, icon, onClick }) => (
  <Tooltip title={label} mouseEnterDelay={0.5}>
    <button
      type="button"
      style={S.toggleBtn(active)}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
    >
      {icon}
    </button>
  </Tooltip>
);

// ── Helper: color field row ───────────────────────────────────────────────────

const ColorRow: React.FC<{
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
  allowClear?: boolean;
}> = ({ label, value, onChange, allowClear = false }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
    <span style={S.colorRowLabel}>{label}</span>
    <ColorPicker
      size="small"
      value={value ?? '#000000'}
      onChange={(c: Color) => onChange('#' + c.toHex())}
      disabledAlpha
      showText={false}
      style={{ flexShrink: 0 }}
    />
  </div>
);

// ── Section: Position & Size ──────────────────────────────────────────────────

const PositionSection: React.FC<{
  annotation: Annotation;
  onChange: (patch: Partial<Annotation>) => void;
}> = ({ annotation, onChange }) => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Position &amp; Size</span>

    <div style={S.row}>
      <span style={S.label}>X</span>
      <CompactNumber
        value={Math.round(annotation.x)}
        onChange={(v) => onChange({ x: v })}
        aria-label="X position"
      />
      <span style={S.label}>Y</span>
      <CompactNumber
        value={Math.round(annotation.y)}
        onChange={(v) => onChange({ y: v })}
        aria-label="Y position"
      />
    </div>

    <div style={S.row}>
      <span style={S.label}>W</span>
      <CompactNumber
        value={Math.round(annotation.width)}
        onChange={(v) => onChange({ width: v })}
        min={1}
        aria-label="Width"
      />
      <span style={S.label}>H</span>
      <CompactNumber
        value={Math.round(annotation.height)}
        onChange={(v) => onChange({ height: v })}
        min={1}
        aria-label="Height"
      />
    </div>
  </div>
);

// ── Section: Text Style ───────────────────────────────────────────────────────

const TextStyleSection: React.FC<{
  style: AnnotationStyle;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ style, onStyleChange }) => {
  const isBold      = style.fontWeight === 'bold';
  const isItalic    = style.fontStyle  === 'italic';
  const isUnderline = style.textDecoration === 'underline';

  return (
    <div style={S.section}>
      <span style={S.sectionTitle}>Text Style</span>

      {/* Font family */}
      <div style={{ marginBottom: 6 }}>
        <Select
          size="small"
          value={style.fontFamily ?? 'Arial'}
          onChange={(v) => onStyleChange({ fontFamily: v })}
          options={FONT_FAMILIES}
          style={{ width: '100%', fontSize: fontSizes.xs }}
          aria-label="Font family"
          popupMatchSelectWidth={false}
        />
      </div>

      {/* Size + Bold / Italic / Underline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <CompactNumber
          value={style.fontSize ?? 14}
          onChange={(v) => onStyleChange({ fontSize: v })}
          min={8}
          max={96}
          style={{ maxWidth: 60, flex: 'none' }}
          aria-label="Font size"
        />
        <StyleToggle
          active={isBold}
          label="Bold"
          icon={<BoldOutlined />}
          onClick={() => onStyleChange({ fontWeight: isBold ? 'normal' : 'bold' })}
        />
        <StyleToggle
          active={isItalic}
          label="Italic"
          icon={<ItalicOutlined />}
          onClick={() => onStyleChange({ fontStyle: isItalic ? 'normal' : 'italic' })}
        />
        <StyleToggle
          active={isUnderline}
          label="Underline"
          icon={<UnderlineOutlined />}
          onClick={() =>
            onStyleChange({ textDecoration: isUnderline ? 'none' : 'underline' })
          }
        />
      </div>

      {/* Colors */}
      <ColorRow
        label="Text color"
        value={style.color}
        onChange={(hex) => onStyleChange({ color: hex })}
      />
      <ColorRow
        label="Background"
        value={style.backgroundColor}
        onChange={(hex) => onStyleChange({ backgroundColor: hex })}
        allowClear
      />
    </div>
  );
};

// ── Section: Image Options ────────────────────────────────────────────────────

const ImageSection: React.FC<{
  annotation: Annotation;
  onChange: (patch: Partial<Annotation>) => void;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ annotation, onChange, onStyleChange }) => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Image</span>

    <div style={S.row}>
      <span style={S.label}>W</span>
      <CompactNumber
        value={Math.round(annotation.width)}
        onChange={(v) => onChange({ width: v })}
        min={1}
        aria-label="Image width"
      />
      <span style={S.label}>H</span>
      <CompactNumber
        value={Math.round(annotation.height)}
        onChange={(v) => onChange({ height: v })}
        min={1}
        aria-label="Image height"
      />
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary, flex: 1 }}>
        Border
      </span>
      <StyleToggle
        active={!!annotation.style.borderWidth && annotation.style.borderWidth > 0}
        label="Toggle border"
        icon={
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        }
        onClick={() =>
          onStyleChange({
            borderWidth: annotation.style.borderWidth ? 0 : 1,
            borderColor: annotation.style.borderColor ?? colors.borderDark,
          })
        }
      />
    </div>
  </div>
);

// ── Section: Drawing Style ───────────────────────────────────────────────────

const STROKE_WIDTH_OPTIONS = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
  { value: 5, label: '5px' },
  { value: 8, label: '8px' },
  { value: 12, label: '12px' },
];

const DrawingStyleSection: React.FC<{
  style: AnnotationStyle;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ style, onStyleChange }) => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Stroke</span>

    <ColorRow
      label="Color"
      value={style.color}
      onChange={(hex) => onStyleChange({ color: hex })}
    />

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary, flex: 1 }}>
        Width
      </span>
      <Select
        size="small"
        value={style.borderWidth ?? 2}
        onChange={(v) => onStyleChange({ borderWidth: v })}
        options={STROKE_WIDTH_OPTIONS}
        style={{ width: 72, fontSize: fontSizes.xs, fontFamily: fonts.body }}
        popupMatchSelectWidth={false}
        aria-label="Stroke width"
      />
    </div>
  </div>
);

// ── Section: Shape Style ────────────────────────────────────────────────────

const ShapeStyleSection: React.FC<{
  annotation: Annotation;
  style: AnnotationStyle;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ annotation, style, onStyleChange }) => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Shape</span>

    <ColorRow
      label="Stroke"
      value={style.color}
      onChange={(hex) => onStyleChange({ color: hex })}
    />

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary, flex: 1 }}>
        Width
      </span>
      <Select
        size="small"
        value={style.borderWidth ?? 2}
        onChange={(v) => onStyleChange({ borderWidth: v })}
        options={STROKE_WIDTH_OPTIONS}
        style={{ width: 72, fontSize: fontSizes.xs, fontFamily: fonts.body }}
        popupMatchSelectWidth={false}
        aria-label="Stroke width"
      />
    </div>

    {/* Fill color only for rect and circle, not line */}
    {annotation.content !== 'line' && (
      <ColorRow
        label="Fill"
        value={style.backgroundColor ?? 'transparent'}
        onChange={(hex) => onStyleChange({ backgroundColor: hex })}
      />
    )}
  </div>
);

// ── Section: Transform (Rotation + Opacity) ───────────────────────────────────

const TransformSection: React.FC<{
  annotation: Annotation;
  onChange: (patch: Partial<Annotation>) => void;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ annotation, onChange, onStyleChange }) => {
  const opacity = Math.round((annotation.style.opacity ?? 1) * 100);

  return (
    <div style={S.section}>
      <span style={S.sectionTitle}>Transform</span>

      {/* Rotation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary, flex: 1 }}>
          Rotation
        </span>
        <CompactNumber
          value={Math.round(annotation.rotation)}
          onChange={(v) => onChange({ rotation: ((v % 360) + 360) % 360 })}
          min={0}
          max={359}
          suffix="°"
          style={{ maxWidth: 70, flex: 'none' }}
          aria-label="Rotation degrees"
        />
      </div>

      {/* Opacity */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
            Opacity
          </span>
          <span
            style={{
              fontSize: fontSizes.xs,
              color: colors.textPrimary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {opacity}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={opacity}
          onChange={(v) => onStyleChange({ opacity: v / 100 })}
          tooltip={{ formatter: (v) => `${v}%` }}
          styles={{
            rail: { background: colors.border },
            track: { background: colors.textSecondary },
          }}
        />
      </div>
    </div>
  );
};

// ── Section: Layer Order ──────────────────────────────────────────────────────

const LayerSection: React.FC = () => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Layer</span>
    <div style={S.orderBtnGroup}>
      <Tooltip title="Bring to front" mouseEnterDelay={0.5}>
        <Button
          size="small"
          icon={<VerticalAlignTopOutlined />}
          style={{
            flex: 1,
            height: 28,
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            borderColor: colors.border,
          }}
          aria-label="Bring to front"
        >
          Front
        </Button>
      </Tooltip>
      <Tooltip title="Send to back" mouseEnterDelay={0.5}>
        <Button
          size="small"
          icon={<VerticalAlignBottomOutlined />}
          style={{
            flex: 1,
            height: 28,
            fontSize: fontSizes.xs,
            color: colors.textSecondary,
            borderColor: colors.border,
          }}
          aria-label="Send to back"
        >
          Back
        </Button>
      </Tooltip>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  selectedAnnotation,
  onAnnotationUpdate,
  onAnnotationDelete,
}) => {
  // Produce a merged annotation update
  const handleChange = useCallback(
    (patch: Partial<Annotation>) => {
      if (!selectedAnnotation) return;
      onAnnotationUpdate({ ...selectedAnnotation, ...patch });
    },
    [selectedAnnotation, onAnnotationUpdate]
  );

  const handleStyleChange = useCallback(
    (patch: Partial<AnnotationStyle>) => {
      if (!selectedAnnotation) return;
      onAnnotationUpdate({
        ...selectedAnnotation,
        style: { ...selectedAnnotation.style, ...patch },
      });
    },
    [selectedAnnotation, onAnnotationUpdate]
  );

  return (
    <aside
      style={S.panel}
      aria-label="Element properties"
      role="complementary"
    >
      {/* Panel title */}
      <div style={S.panelHeader}>
        <span style={S.panelTitle}>Properties</span>
      </div>

      {/* Empty state */}
      {!selectedAnnotation && (
        <div style={S.emptyState}>
          <p style={S.emptyText}>
            Select an element to edit its properties.
          </p>
        </div>
      )}

      {/* Populated state */}
      {selectedAnnotation && (
        <>
          {/* Type-specific sections */}
          {selectedAnnotation.type === 'text' && (
            <>
              <TextStyleSection
                style={selectedAnnotation.style}
                onStyleChange={handleStyleChange}
              />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {selectedAnnotation.type === 'image' && (
            <>
              <ImageSection
                annotation={selectedAnnotation}
                onChange={handleChange}
                onStyleChange={handleStyleChange}
              />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {selectedAnnotation.type === 'drawing' && (
            <>
              <DrawingStyleSection
                style={selectedAnnotation.style}
                onStyleChange={handleStyleChange}
              />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {selectedAnnotation.type === 'shape' && (
            <>
              <ShapeStyleSection
                annotation={selectedAnnotation}
                style={selectedAnnotation.style}
                onStyleChange={handleStyleChange}
              />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {/* Transform: Rotation + Opacity (all types) */}
          <TransformSection
            annotation={selectedAnnotation}
            onChange={handleChange}
            onStyleChange={handleStyleChange}
          />

          <Divider style={{ margin: 0, borderColor: colors.border }} />

          {/* Layer order */}
          <LayerSection />

          <Divider style={{ margin: 0, borderColor: colors.border }} />

          {/* Delete */}
          <div style={{ ...S.section, marginTop: 'auto' }}>
            <Tooltip title="Delete this element" mouseEnterDelay={0.5}>
              <button
                type="button"
                style={S.deleteBtn}
                onClick={() => onAnnotationDelete(selectedAnnotation.id)}
                aria-label="Delete selected element"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(239, 68, 68, 0.06)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    colors.error;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                }}
              >
                <DeleteOutlined style={{ fontSize: 13 }} />
                Delete element
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </aside>
  );
};

export default PropertyPanel;
