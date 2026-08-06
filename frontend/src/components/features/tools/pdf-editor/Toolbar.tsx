/**
 * Scopit - PDF Editor Toolbar
 *
 * Two-row toolbar: header row (nav + save/export) and tools row
 * (tool buttons, undo/redo, zoom, page navigation).
 *
 * Usage:
 *   <Toolbar
 *     activeTool="select"
 *     onToolChange={setTool}
 *     zoom={100}
 *     onZoomChange={setZoom}
 *     currentPage={1}
 *     pageCount={12}
 *     onPageChange={setPage}
 *     canUndo={false}
 *     canRedo={false}
 *     onUndo={undo}
 *     onRedo={redo}
 *     onSave={save}
 *     onExport={export}
 *     isSaving={false}
 *     isDirty={true}
 *     documentName="Estimate_2024.pdf"
 *     onBack={goBack}
 *   />
 */
import React, { useState, useRef } from 'react';
import {
  Button,
  Tooltip,
  Dropdown,
  InputNumber,
  Typography,
  Space,
  Divider,
  ColorPicker,
  Select,
} from 'antd';
import type { InputNumberRef } from 'rc-input-number';
import type { MenuProps } from 'antd';
import type { Color } from 'antd/es/color-picker';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  DownloadOutlined,
  UndoOutlined,
  RedoOutlined,
  MinusOutlined,
  PlusOutlined,
  FontSizeOutlined,
  PictureOutlined,
  EditOutlined,
  AuditOutlined,
  HighlightOutlined,
  LeftOutlined,
  RightOutlined,
  LoadingOutlined,
  DownOutlined,
  BorderOutlined,
  MinusSquareOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolbarProps {
  activeTool: string;
  onToolChange: (tool: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onExport: () => void;
  isSaving: boolean;
  isDirty: boolean;
  documentName: string;
  onBack: () => void;
  drawColor?: string;
  drawWidth?: number;
  onDrawColorChange?: (color: string) => void;
  onDrawWidthChange?: (width: number) => void;
}

const MOBILE_BREAKPOINT = 768;
function useIsMobile() {
  const [mobile, setMobile] = React.useState(
    typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT,
  );
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMobile(e.matches);
    handler(mql);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return mobile;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;

const TOOL_DEFS: { key: string; label: string; icon: React.ReactNode }[] = [
  {
    key: 'select',
    label: 'Select',
    icon: (
      // Custom cursor SVG since Ant Design doesn't ship SelectOutlined
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M2 1L2 10L4.5 7.5L6.5 12L8 11.5L6 7H9.5L2 1Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
  { key: 'text',       label: 'Text',       icon: <FontSizeOutlined /> },
  { key: 'image',      label: 'Image',      icon: <PictureOutlined /> },
  { key: 'draw',       label: 'Draw',       icon: <EditOutlined /> },
  { key: 'stamp',      label: 'Stamp',      icon: <AuditOutlined /> },
  { key: 'sign', label: 'Sign', icon: <HighlightOutlined /> },
];

const SHAPE_ITEMS: { key: string; label: string; icon: React.ReactNode }[] = [
  {
    key: 'shape_rect',
    label: 'Rectangle',
    icon: <BorderOutlined style={{ fontSize: 13 }} />,
  },
  {
    key: 'shape_circle',
    label: 'Circle',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
      </svg>
    ),
  },
  {
    key: 'shape_line',
    label: 'Line',
    icon: <MinusSquareOutlined style={{ fontSize: 13 }} />,
  },
];

const DRAW_WIDTH_OPTIONS = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
  { value: 5, label: '5px' },
  { value: 8, label: '8px' },
  { value: 12, label: '12px' },
];

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  wrapper: {
    background: colors.bgWhite,
    borderBottom: `1px solid ${colors.border}`,
    fontFamily: fonts.body,
    userSelect: 'none' as const,
    flexShrink: 0,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.border}`,
    gap: 8,
    minHeight: 44,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  docName: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 320,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: colors.textSecondary,
    flexShrink: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  toolsRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    gap: 4,
    flexWrap: 'nowrap' as const,
    overflowX: 'auto' as const,
    minHeight: 42,
  },
  toolBtn: (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 30,
    padding: '0 8px',
    border: `1px solid ${isActive ? colors.borderDark : 'transparent'}`,
    borderRadius: borderRadius.base,
    background: isActive ? colors.bgLight : 'transparent',
    color: isActive ? colors.textPrimary : colors.textSecondary,
    cursor: 'pointer',
    fontSize: fontSizes.xs,
    fontFamily: fonts.body,
    fontWeight: isActive ? fontWeights.semibold : fontWeights.normal,
    transition: 'all 0.15s ease',
    outline: 'none',
    whiteSpace: 'nowrap',
  }),
  iconBtn: (disabled: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    border: `1px solid transparent`,
    borderRadius: borderRadius.base,
    background: 'transparent',
    color: disabled ? colors.textMuted : colors.textSecondary,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    transition: 'all 0.15s ease',
    outline: 'none',
    padding: 0,
  }),
  zoomDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  zoomValue: {
    fontSize: fontSizes.xs,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 40,
    textAlign: 'center' as const,
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  pageLabel: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap' as const,
  },
} as const;

// ── Sub-components ────────────────────────────────────────────────────────────

const IconBtn: React.FC<{
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ label, icon, disabled = false, onClick }) => (
  <Tooltip title={label} mouseEnterDelay={0.6}>
    <button
      type="button"
      style={S.iconBtn(disabled)}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = colors.bgLight;
          (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = disabled
          ? colors.textMuted
          : colors.textSecondary;
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
      }}
    >
      {icon}
    </button>
  </Tooltip>
);

// ── Main Component ────────────────────────────────────────────────────────────

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onToolChange,
  zoom,
  onZoomChange,
  currentPage,
  pageCount,
  onPageChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onExport,
  isSaving,
  isDirty,
  documentName,
  onBack,
  drawColor,
  drawWidth,
  onDrawColorChange,
  onDrawWidthChange,
}) => {
  const isMobile = useIsMobile();
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const zoomInputRef = useRef<InputNumberRef>(null);
  const pageInputRef = useRef<InputNumberRef>(null);

  // Zoom helpers
  const handleZoomDecrement = () => {
    const next = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP);
    onZoomChange(next);
  };

  const handleZoomIncrement = () => {
    const next = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP);
    onZoomChange(next);
  };

  const handleZoomCommit = (value: number | null) => {
    setIsEditingZoom(false);
    if (value !== null && !isNaN(value)) {
      onZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)));
    }
  };

  // Page helpers
  const handlePrevPage = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < pageCount) onPageChange(currentPage + 1);
  };

  const handlePageCommit = (value: number | null) => {
    setIsEditingPage(false);
    if (value !== null && !isNaN(value)) {
      onPageChange(Math.min(pageCount, Math.max(1, value)));
    }
  };

  // Shape tool state
  const isShapeTool = activeTool.startsWith('shape_');
  const isDrawActive = activeTool === 'draw';
  const showDrawOptions = isDrawActive || isShapeTool;

  // Current shape label for button display
  const activeShapeDef = SHAPE_ITEMS.find((s) => s.key === activeTool);

  const shapeMenuItems: MenuProps['items'] = SHAPE_ITEMS.map((s) => ({
    key: s.key,
    icon: s.icon,
    label: s.label,
    onClick: () => onToolChange(s.key),
  }));

  // Export menu
  const exportMenuItems: MenuProps['items'] = [
    {
      key: 'download',
      icon: <DownloadOutlined />,
      label: 'Download PDF',
      onClick: onExport,
    },
    {
      key: 'flatten',
      icon: <DownloadOutlined />,
      label: 'Flatten & Download',
      onClick: onExport,
    },
  ];

  return (
    <div style={S.wrapper} role="toolbar" aria-label="PDF editor toolbar">
      {/* ── Row 1: Header ─────────────────────────────────────────────── */}
      <div style={S.headerRow}>
        <div style={S.headerLeft}>
          <Tooltip title="Back to documents" mouseEnterDelay={0.6}>
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              style={{
                color: colors.textSecondary,
                fontSize: fontSizes.xs,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                height: 28,
                padding: '0 6px',
                flexShrink: 0,
              }}
            >
              {!isMobile && 'Back'}
            </Button>
          </Tooltip>

          {!isMobile && (
            <>
              <Divider type="vertical" style={{ margin: '0 2px', height: 16, borderColor: colors.border }} />
              <span style={S.docName} title={documentName}>
                {documentName}
              </span>
            </>
          )}

          {isDirty && (
            <Tooltip title="Unsaved changes" mouseEnterDelay={0.4}>
              <span style={S.dirtyDot} aria-label="Unsaved changes" />
            </Tooltip>
          )}
        </div>

        <div style={S.headerRight}>
          <Button
            size="small"
            icon={isSaving ? <LoadingOutlined spin /> : <SaveOutlined />}
            onClick={onSave}
            disabled={isSaving || !isDirty}
            style={{
              height: 30,
              fontSize: fontSizes.xs,
              fontWeight: fontWeights.semibold,
              fontFamily: fonts.body,
              color: isDirty && !isSaving ? colors.textPrimary : colors.textMuted,
              borderColor: colors.border,
            }}
          >
            {isSaving ? (isMobile ? '' : 'Saving...') : (isMobile ? '' : 'Save')}
          </Button>

          <Dropdown
            menu={{ items: exportMenuItems }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              size="small"
              style={{
                height: 30,
                fontSize: fontSizes.xs,
                fontWeight: fontWeights.semibold,
                fontFamily: fonts.body,
                borderColor: colors.border,
                color: colors.textPrimary,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {isMobile ? <DownloadOutlined /> : <>Export <DownOutlined style={{ fontSize: 10 }} /></>}
            </Button>
          </Dropdown>
        </div>
      </div>

      {/* ── Row 2: Tools ──────────────────────────────────────────────── */}
      <div style={{
        ...S.toolsRow,
        ...(isMobile ? { padding: '4px 8px', gap: 2, WebkitOverflowScrolling: 'touch' } : {}),
      }}>
        {/* Tool buttons */}
        <Space size={2} role="group" aria-label="Editing tools">
          {TOOL_DEFS.map((tool) => (
            <Tooltip key={tool.key} title={tool.label} mouseEnterDelay={0.6}>
              <button
                type="button"
                style={{
                  ...S.toolBtn(activeTool === tool.key),
                  ...(isMobile ? { padding: '0 6px', height: 32 } : {}),
                }}
                onClick={() => onToolChange(tool.key)}
                aria-pressed={activeTool === tool.key}
                aria-label={tool.label}
                onMouseEnter={(e) => {
                  if (activeTool !== tool.key) {
                    (e.currentTarget as HTMLButtonElement).style.background = colors.bgLight;
                    (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTool !== tool.key) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
                  }
                }}
              >
                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
                  {tool.icon}
                </span>
                {!isMobile && <span>{tool.label}</span>}
              </button>
            </Tooltip>
          ))}

          {/* Shape dropdown tool */}
          <Dropdown menu={{ items: shapeMenuItems }} trigger={['click']} placement="bottomLeft">
            <Tooltip title="Shapes" mouseEnterDelay={0.6}>
              <button
                type="button"
                style={{
                  ...S.toolBtn(isShapeTool),
                  ...(isMobile ? { padding: '0 6px', height: 32 } : {}),
                }}
                aria-pressed={isShapeTool}
                aria-label="Shapes"
                onMouseEnter={(e) => {
                  if (!isShapeTool) {
                    (e.currentTarget as HTMLButtonElement).style.background = colors.bgLight;
                    (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isShapeTool) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
                  }
                }}
              >
                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
                  {activeShapeDef?.icon ?? <BorderOutlined />}
                </span>
                {!isMobile && <span>{activeShapeDef?.label ?? 'Shape'}</span>}
                <DownOutlined style={{ fontSize: 8, marginLeft: 2 }} />
              </button>
            </Tooltip>
          </Dropdown>
        </Space>

        {/* Draw / Shape options: color + width (shown when draw or shape tool is active) */}
        {showDrawOptions && (
          <>
            <Divider type="vertical" style={{ margin: '0 4px', height: 18, borderColor: colors.border }} />
            <Space size={6} align="center" role="group" aria-label="Draw settings">
              <Tooltip title="Stroke color" mouseEnterDelay={0.5}>
                <ColorPicker
                  size="small"
                  value={drawColor ?? '#111827'}
                  onChange={(c: Color) => onDrawColorChange?.('#' + c.toHex())}
                  disabledAlpha
                  showText={false}
                  style={{ flexShrink: 0 }}
                />
              </Tooltip>
              <Tooltip title="Stroke width" mouseEnterDelay={0.5}>
                <Select
                  size="small"
                  value={drawWidth ?? 2}
                  onChange={(v) => onDrawWidthChange?.(v)}
                  options={DRAW_WIDTH_OPTIONS}
                  style={{ width: 68, fontSize: fontSizes.xs, fontFamily: fonts.body }}
                  popupMatchSelectWidth={false}
                  aria-label="Stroke width"
                />
              </Tooltip>
            </Space>
          </>
        )}

        <Divider type="vertical" style={{ margin: '0 4px', height: 18, borderColor: colors.border }} />

        {/* Undo / Redo */}
        <Space size={2} role="group" aria-label="History controls">
          <IconBtn
            label="Undo"
            icon={<UndoOutlined />}
            disabled={!canUndo}
            onClick={onUndo}
          />
          <IconBtn
            label="Redo"
            icon={<RedoOutlined />}
            disabled={!canRedo}
            onClick={onRedo}
          />
        </Space>

        <Divider type="vertical" style={{ margin: '0 4px', height: 18, borderColor: colors.border }} />

        {/* Zoom controls */}
        <Space size={2} role="group" aria-label="Zoom controls">
          <IconBtn
            label="Zoom out"
            icon={<MinusOutlined />}
            disabled={zoom <= ZOOM_MIN}
            onClick={handleZoomDecrement}
          />

          <Tooltip title="Click to enter zoom level" mouseEnterDelay={0.6}>
            {isEditingZoom ? (
              <InputNumber
                ref={zoomInputRef}
                size="small"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                defaultValue={zoom}
                style={{
                  width: 60,
                  height: 28,
                  fontSize: fontSizes.xs,
                  fontFamily: fonts.body,
                }}
                formatter={(v) => `${v}%`}
                parser={(v) => Number((v ?? '').replace('%', '')) as never}
                onBlur={(e) => {
                  const raw = parseFloat(e.target.value.replace('%', ''));
                  handleZoomCommit(isNaN(raw) ? null : raw);
                }}
                onPressEnter={(e) => {
                  const raw = parseFloat(
                    (e.target as HTMLInputElement).value.replace('%', '')
                  );
                  handleZoomCommit(isNaN(raw) ? null : raw);
                }}
                autoFocus
                controls={false}
              />
            ) : (
              <button
                type="button"
                style={{
                  ...S.iconBtn(false),
                  width: 'auto',
                  padding: '0 6px',
                  minWidth: 48,
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: fontSizes.xs,
                  color: colors.textPrimary,
                  border: `1px solid transparent`,
                  cursor: 'text',
                }}
                onClick={() => setIsEditingZoom(true)}
                aria-label={`Current zoom: ${zoom}%. Click to change.`}
              >
                {zoom}%
              </button>
            )}
          </Tooltip>

          <IconBtn
            label="Zoom in"
            icon={<PlusOutlined />}
            disabled={zoom >= ZOOM_MAX}
            onClick={handleZoomIncrement}
          />
        </Space>

        <Divider type="vertical" style={{ margin: '0 4px', height: 18, borderColor: colors.border }} />

        {/* Page navigation */}
        <Space size={2} role="group" aria-label="Page navigation">
          <IconBtn
            label="Previous page"
            icon={<LeftOutlined />}
            disabled={currentPage <= 1}
            onClick={handlePrevPage}
          />

          {isEditingPage ? (
            <InputNumber
              ref={pageInputRef}
              size="small"
              min={1}
              max={pageCount}
              defaultValue={currentPage}
              style={{
                width: 48,
                height: 28,
                fontSize: fontSizes.xs,
                fontFamily: fonts.body,
              }}
              onBlur={(e) => {
                const raw = parseInt(e.target.value, 10);
                handlePageCommit(isNaN(raw) ? null : raw);
              }}
              onPressEnter={(e) => {
                const raw = parseInt((e.target as HTMLInputElement).value, 10);
                handlePageCommit(isNaN(raw) ? null : raw);
              }}
              autoFocus
              controls={false}
            />
          ) : (
            <Tooltip title="Click to go to page" mouseEnterDelay={0.6}>
              <button
                type="button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '0 2px',
                  cursor: 'text',
                  outline: 'none',
                }}
                onClick={() => setIsEditingPage(true)}
                aria-label={`Page ${currentPage} of ${pageCount}. Click to navigate.`}
              >
                <Text style={S.pageLabel}>
                  Page{' '}
                  <span
                    style={{
                      fontWeight: fontWeights.semibold,
                      color: colors.textPrimary,
                      textDecoration: 'underline',
                      textDecorationStyle: 'dotted',
                      cursor: 'text',
                    }}
                  >
                    {currentPage}
                  </span>
                  {' '}/ {pageCount}
                </Text>
              </button>
            </Tooltip>
          )}

          <IconBtn
            label="Next page"
            icon={<RightOutlined />}
            disabled={currentPage >= pageCount}
            onClick={handleNextPage}
          />
        </Space>
      </div>
    </div>
  );
};

export default Toolbar;
