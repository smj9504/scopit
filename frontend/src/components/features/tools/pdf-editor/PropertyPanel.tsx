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
import React, { useCallback, useRef } from 'react';
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
  UndoOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { Annotation, AnnotationStyle } from './types';
import { useHoverTip } from './useHoverTip';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PropertyPanelProps {
  selectedAnnotation: Annotation | null;
  onAnnotationUpdate: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  /** Set for an Edit replacement: drop it and bring the PDF's own words (or image) back */
  onRestoreOriginal?: (id: string) => void;
  /** As wide as where it's put (a phone's bottom drawer), not a side panel */
  fullWidth?: boolean;
}

/** Fit an image of naturalW x naturalH inside a box, keeping its proportions */
function fitInside(naturalW: number, naturalH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  return { width: naturalW * scale, height: naturalH * scale };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FONT_FAMILIES = [
  { value: 'Arial',           label: 'Arial' },
  { value: 'Helvetica',       label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier',         label: 'Courier' },
  { value: 'Georgia',         label: 'Georgia' },
];

// Font picker value for an Edit Text replacement still in its PDF font
const PDF_FONT_OPTION = '__pdf_font__';

/** "ABCDEF+Calibri-Bold" -> "Calibri-Bold" (drops the subset tag) */
function pdfFontLabel(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '');
}

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
}> = ({ active, label, icon, onClick }) => {
  const tip = useHoverTip();
  return (
    <Tooltip {...tip} title={label} mouseEnterDelay={0.5}>
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
};

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
  // The PDF's own font can't change family, weight or slant: changing any
  // of them switches to the standard font that stands in for it
  const fontOptions = style.pdfFont
    ? [{ value: PDF_FONT_OPTION, label: `${pdfFontLabel(style.pdfFont)} (original)` }, ...FONT_FAMILIES]
    : FONT_FAMILIES;

  return (
    <div style={S.section}>
      <span style={S.sectionTitle}>Text Style</span>

      {/* Font family */}
      <div style={{ marginBottom: 6 }}>
        <Select
          size="small"
          value={style.pdfFont ? PDF_FONT_OPTION : style.fontFamily ?? 'Arial'}
          onChange={(v) => {
            if (v !== PDF_FONT_OPTION) onStyleChange({ fontFamily: v, pdfFont: undefined });
          }}
          options={fontOptions}
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
          onClick={() => onStyleChange({ fontWeight: isBold ? 'normal' : 'bold', pdfFont: undefined })}
        />
        <StyleToggle
          active={isItalic}
          label="Italic"
          icon={<ItalicOutlined />}
          onClick={() => onStyleChange({ fontStyle: isItalic ? 'normal' : 'italic', pdfFont: undefined })}
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
}> = ({ annotation, onChange, onStyleChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  // A new picture in the same spot, fitted inside the current box
  const replacePicture = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        if (!img.width || !img.height) return;
        onChange({
          content: dataUrl,
          ...fitInside(img.width, img.height, annotation.width, annotation.height),
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
  <div style={S.section}>
    <span style={S.sectionTitle}>Image</span>

    <Button
      size="small"
      block
      icon={<SwapOutlined />}
      onClick={() => fileRef.current?.click()}
      style={{
        height: 28,
        marginBottom: 8,
        fontSize: fontSizes.xs,
        color: colors.textSecondary,
        borderColor: colors.border,
      }}
    >
      Replace image
    </Button>
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      style={{ display: 'none' }}
      aria-hidden="true"
      tabIndex={-1}
      onChange={(e) => {
        replacePicture(e.target.files?.[0]);
        e.target.value = '';
      }}
    />

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
};

// ── Section: Redaction mark ───────────────────────────────────────────────────

const RedactSection: React.FC = () => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Marked for redaction</span>
    <p style={{ ...S.emptyText, margin: 0, textAlign: 'left' }}>
      Nothing is removed yet. Apply redactions to take the text, images and
      graphics under this area out of the PDF for good.
    </p>
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
  onChange: (patch: Partial<Annotation>) => void;
  onStyleChange: (patch: Partial<AnnotationStyle>) => void;
}> = ({ annotation, style, onChange, onStyleChange }) => (
  <div style={S.section}>
    <span style={S.sectionTitle}>Shape</span>

    {/* Check marks resize as a square */}
    {annotation.content === 'check' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: fontSizes.xs, color: colors.textSecondary, flex: 1 }}>
          Size
        </span>
        <CompactNumber
          value={Math.round(annotation.width)}
          onChange={(v) => onChange({ width: v, height: v })}
          min={8}
          max={200}
          style={{ maxWidth: 72, flex: 'none' }}
          aria-label="Check size"
        />
      </div>
    )}

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

    {/* Fill color only for rect and circle, not line or check */}
    {annotation.content !== 'line' && annotation.content !== 'check' && (
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

const LayerSection: React.FC<{
  onBringToFront: () => void;
  onSendToBack: () => void;
}> = ({ onBringToFront, onSendToBack }) => {
  const tip = useHoverTip();
  return (
    <div style={S.section}>
      <span style={S.sectionTitle}>Layer</span>
      <div style={S.orderBtnGroup}>
        <Tooltip {...tip} title="Bring to front" mouseEnterDelay={0.5}>
          <Button
            size="small"
            icon={<VerticalAlignTopOutlined />}
            onClick={onBringToFront}
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
        <Tooltip {...tip} title="Send to back" mouseEnterDelay={0.5}>
          <Button
            size="small"
            icon={<VerticalAlignBottomOutlined />}
            onClick={onSendToBack}
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
};

// ── Main Component ────────────────────────────────────────────────────────────

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  selectedAnnotation,
  onAnnotationUpdate,
  onAnnotationDelete,
  onBringToFront,
  onSendToBack,
  onRestoreOriginal,
  fullWidth = false,
}) => {
  const tip = useHoverTip();
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
      style={fullWidth ? { ...S.panel, width: '100%', minWidth: 0, maxWidth: 'none', borderLeft: 'none' } : S.panel}
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
                onChange={handleChange}
                onStyleChange={handleStyleChange}
              />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {selectedAnnotation.type === 'redact' ? (
            <>
              <RedactSection />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
              <PositionSection annotation={selectedAnnotation} onChange={handleChange} />
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          ) : (
            <>
              {/* Transform: Rotation + Opacity (all types) */}
              <TransformSection
                annotation={selectedAnnotation}
                onChange={handleChange}
                onStyleChange={handleStyleChange}
              />

              <Divider style={{ margin: 0, borderColor: colors.border }} />

              {/* Layer order */}
              <LayerSection
                onBringToFront={() => onBringToFront(selectedAnnotation.id)}
                onSendToBack={() => onSendToBack(selectedAnnotation.id)}
              />

              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {/* Edit replacement: back to the PDF's own words or image */}
          {onRestoreOriginal && (
            <>
              <div style={S.section}>
                <span style={S.sectionTitle}>
                  {selectedAnnotation.type === 'image' ? 'Original image' : 'Original text'}
                </span>
                <Button
                  size="small"
                  block
                  icon={<UndoOutlined />}
                  onClick={() => onRestoreOriginal(selectedAnnotation.id)}
                  style={{
                    height: 28,
                    fontSize: fontSizes.xs,
                    color: colors.textSecondary,
                    borderColor: colors.border,
                  }}
                >
                  {selectedAnnotation.type === 'image' ? 'Restore original image' : 'Restore original text'}
                </Button>
              </div>
              <Divider style={{ margin: 0, borderColor: colors.border }} />
            </>
          )}

          {/* Delete */}
          <div style={{ ...S.section, marginTop: 'auto' }}>
            <Tooltip {...tip} title="Delete this element" mouseEnterDelay={0.5}>
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
                {selectedAnnotation.type === 'redact' ? 'Remove mark' : 'Delete element'}
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </aside>
  );
};

export default PropertyPanel;
