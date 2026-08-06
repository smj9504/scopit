/**
 * SignatureModal - Create and manage signatures for PDF signing
 *
 * Three creation modes:
 *   - Type: Enter name, rendered in a script font
 *   - Draw: Freehand drawing on a canvas
 *   - Image: Upload a signature image
 *
 * Saved signatures persist in localStorage.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, Button, Input, Checkbox, Tabs, Typography, Tooltip } from 'antd';
import {
  FontSizeOutlined,
  EditOutlined,
  PictureOutlined,
  DeleteOutlined,
  PlusOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';

const { Text } = Typography;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SavedSignature {
  id: string;
  dataUrl: string;
  label: string;
  createdAt: number;
}

interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (dataUrl: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'scopit-signatures';
const CANVAS_W = 500;
const CANVAS_H = 160;

const FONT_STYLES = [
  { key: 'dancing', family: "'Dancing Script', cursive", label: 'Script' },
  { key: 'satisfy', family: "'Satisfy', cursive", label: 'Elegant' },
  { key: 'caveat', family: "'Caveat', cursive", label: 'Casual' },
  { key: 'greatvibes', family: "'Great Vibes', cursive", label: 'Formal' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSignatures(sigs: SavedSignature[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sigs));
}

function generateId(): string {
  return `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Render typed text to a transparent-background PNG dataUrl. */
function renderTextToDataUrl(text: string, fontFamily: string): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = 48;
  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + 24;
  const h = fontSize + 24;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, h / 2);
  return canvas.toDataURL('image/png');
}

// ── Draw Canvas Hook ─────────────────────────────────────────────────────────

function useDrawCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const drawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const hasContentRef = useRef(false);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const onStart = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      drawingRef.current = true;
      lastPosRef.current = getPos(e, canvas);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const pos = getPos(e, canvas);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      lastPosRef.current = pos;
      hasContentRef.current = true;
    };

    const onEnd = () => {
      drawingRef.current = false;
    };

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('mouseleave', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);

    return () => {
      canvas.removeEventListener('mousedown', onStart);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onEnd);
      canvas.removeEventListener('mouseleave', onEnd);
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
    };
  }, [canvasRef]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasContentRef.current = false;
  }, [canvasRef]);

  const getDataUrl = useCallback((): string | null => {
    if (!hasContentRef.current) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // Crop to content bounds
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const a = imgData.data[(y * canvas.width + x) * 4 + 3];
        if (a > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 10;
    const cw = maxX - minX + 1 + pad * 2;
    const ch = maxY - minY + 1 + pad * 2;
    const cropped = document.createElement('canvas');
    cropped.width = cw;
    cropped.height = ch;
    const cctx = cropped.getContext('2d')!;
    cctx.drawImage(canvas, minX - pad, minY - pad, cw, ch, 0, 0, cw, ch);
    return cropped.toDataURL('image/png');
  }, [canvasRef]);

  return { clear, getDataUrl };
}

// ── Component ────────────────────────────────────────────────────────────────

export const SignatureModal: React.FC<SignatureModalProps> = ({
  open,
  onClose,
  onInsert,
}) => {
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [activeTab, setActiveTab] = useState('type');
  const [typedName, setTypedName] = useState('');
  const [fontStyle, setFontStyle] = useState(FONT_STYLES[0].key);
  const [saveChecked, setSaveChecked] = useState(true);
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draw = useDrawCanvas(drawCanvasRef);

  // Load saved signatures
  useEffect(() => {
    if (open) {
      setSignatures(loadSignatures());
      setMode('list');
      setTypedName('');
      setUploadDataUrl(null);
      setActiveTab('type');
    }
  }, [open]);

  // Load Google Fonts for type tab
  useEffect(() => {
    if (!document.getElementById('sig-fonts-link')) {
      const link = document.createElement('link');
      link.id = 'sig-fonts-link';
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Satisfy&family=Caveat:wght@600&family=Great+Vibes&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const handleApply = () => {
    let dataUrl: string | null = null;
    let label = '';

    if (activeTab === 'type') {
      if (!typedName.trim()) return;
      const font = FONT_STYLES.find((f) => f.key === fontStyle) ?? FONT_STYLES[0];
      dataUrl = renderTextToDataUrl(typedName.trim(), font.family);
      label = typedName.trim();
    } else if (activeTab === 'draw') {
      dataUrl = draw.getDataUrl();
      if (!dataUrl) return;
      label = 'Drawn signature';
    } else if (activeTab === 'image') {
      if (!uploadDataUrl) return;
      dataUrl = uploadDataUrl;
      label = 'Uploaded signature';
    }

    if (!dataUrl) return;

    if (saveChecked) {
      const sig: SavedSignature = {
        id: generateId(),
        dataUrl,
        label,
        createdAt: Date.now(),
      };
      const updated = [...signatures, sig];
      setSignatures(updated);
      saveSignatures(updated);
    }

    onInsert(dataUrl);
    onClose();
  };

  const handleDelete = (id: string) => {
    const updated = signatures.filter((s) => s.id !== id);
    setSignatures(updated);
    saveSignatures(updated);
  };

  const handleInsertSaved = (sig: SavedSignature) => {
    onInsert(sig.dataUrl);
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadDataUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // ── List mode ────────────────────────────────────────────────────────────

  if (mode === 'list') {
    return (
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={400}
        centered
        title={null}
        styles={{ body: { padding: '20px 24px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text strong style={{ fontSize: 16, fontFamily: fonts.heading }}>My Signatures</Text>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setMode('create')}
            style={{
              background: colors.primary,
              borderColor: colors.primary,
              fontFamily: fonts.body,
              fontWeight: 600,
              borderRadius: borderRadius.base,
            }}
          >
            Add Signature
          </Button>
        </div>

        {signatures.length === 0 ? (
          <div
            style={{
              padding: '40px 16px',
              textAlign: 'center',
              border: `1.5px dashed ${colors.border}`,
              borderRadius: borderRadius.lg,
            }}
          >
            <EditOutlined style={{ fontSize: 32, color: colors.textMuted, marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: colors.textPrimary, marginBottom: 4 }}>
              No saved signatures
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              Create your first signature to get started.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {signatures.map((sig) => (
              <div
                key={sig.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => handleInsertSaved(sig)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = colors.borderDark;
                  (e.currentTarget as HTMLDivElement).style.background = colors.bgLight;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                <img
                  src={sig.dataUrl}
                  alt={sig.label}
                  style={{ height: 36, maxWidth: 200, objectFit: 'contain' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    ellipsis
                    style={{ fontSize: 12, color: colors.textSecondary, display: 'block' }}
                  >
                    {sig.label}
                  </Text>
                </div>
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined style={{ color: colors.textMuted, fontSize: 12 }} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(sig.id);
                    }}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  // ── Create mode ──────────────────────────────────────────────────────────

  const currentFont = FONT_STYLES.find((f) => f.key === fontStyle) ?? FONT_STYLES[0];

  return (
    <Modal
      open={open}
      onCancel={() => setMode('list')}
      footer={null}
      width={560}
      centered
      title={null}
      styles={{ body: { padding: '20px 24px' } }}
    >
      <Text strong style={{ fontSize: 16, fontFamily: fonts.heading, display: 'block', marginBottom: 16 }}>
        Create Signature
      </Text>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k)}
        centered
        items={[
          {
            key: 'type',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FontSizeOutlined /> Type
              </span>
            ),
            children: (
              <div>
                {/* Preview */}
                <div
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    padding: '24px 16px',
                    minHeight: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                    background: colors.bgWhite,
                  }}
                >
                  {typedName.trim() ? (
                    <span
                      style={{
                        fontFamily: currentFont.family,
                        fontSize: 42,
                        color: colors.textPrimary,
                        lineHeight: 1.2,
                        wordBreak: 'break-word',
                        textAlign: 'center',
                      }}
                    >
                      {typedName}
                    </span>
                  ) : (
                    <span style={{ fontSize: 14, color: colors.textMuted }}>
                      Type your name below
                    </span>
                  )}
                </div>

                <Input
                  placeholder="Enter your name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  style={{ marginBottom: 12, fontFamily: fonts.body }}
                  autoFocus
                />

                {/* Style selector */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {FONT_STYLES.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFontStyle(f.key)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: borderRadius.base,
                        border: `1.5px solid ${fontStyle === f.key ? colors.primary : colors.border}`,
                        background: fontStyle === f.key ? colors.primary + '08' : 'transparent',
                        cursor: 'pointer',
                        fontFamily: f.family,
                        fontSize: 16,
                        color: colors.textPrimary,
                        outline: 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'draw',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <EditOutlined /> Draw
              </span>
            ),
            children: (
              <div>
                <div
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    overflow: 'hidden',
                    marginBottom: 12,
                    position: 'relative',
                    background: colors.bgWhite,
                  }}
                >
                  <canvas
                    ref={drawCanvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    style={{
                      width: '100%',
                      height: 160,
                      cursor: 'crosshair',
                      display: 'block',
                      touchAction: 'none',
                    }}
                  />
                  {/* Baseline */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 40,
                      left: 16,
                      right: 16,
                      height: 1.5,
                      background: colors.info,
                      opacity: 0.4,
                      pointerEvents: 'none',
                    }}
                  />
                </div>
                <Button
                  size="small"
                  onClick={() => draw.clear()}
                  style={{ fontSize: 12, color: colors.textSecondary }}
                >
                  Clear
                </Button>
              </div>
            ),
          },
          {
            key: 'image',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <PictureOutlined /> Image
              </span>
            ),
            children: (
              <div>
                <div
                  style={{
                    border: `1.5px dashed ${colors.border}`,
                    borderRadius: borderRadius.md,
                    padding: '24px 16px',
                    minHeight: 120,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    background: colors.bgWhite,
                    marginBottom: 12,
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadDataUrl ? (
                    <div style={{ position: 'relative' }}>
                      <img
                        src={uploadDataUrl}
                        alt="Signature"
                        style={{ maxHeight: 100, maxWidth: '100%', objectFit: 'contain' }}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadDataUrl(null);
                        }}
                        style={{
                          position: 'absolute',
                          top: -8,
                          right: -8,
                          background: colors.bgWhite,
                          borderRadius: '50%',
                          border: `1px solid ${colors.border}`,
                          width: 22,
                          height: 22,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      <PictureOutlined style={{ fontSize: 28, color: colors.textMuted, marginBottom: 8, display: 'block' }} />
                      <span style={{ fontSize: 13, color: colors.textSecondary }}>
                        Click to upload signature image
                      </span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </div>
            ),
          },
        ]}
      />

      {/* Footer */}
      <div style={{ marginTop: 16 }}>
        <Checkbox
          checked={saveChecked}
          onChange={(e) => setSaveChecked(e.target.checked)}
          style={{ marginBottom: 16, fontSize: 13, fontFamily: fonts.body }}
        >
          Save signature
        </Checkbox>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <Button
            onClick={() => setMode('list')}
            style={{
              minWidth: 100,
              borderRadius: borderRadius.base,
              fontFamily: fonts.body,
            }}
          >
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={handleApply}
            style={{
              minWidth: 100,
              borderRadius: borderRadius.base,
              fontFamily: fonts.body,
              fontWeight: 600,
              background: colors.info,
              borderColor: colors.info,
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default SignatureModal;
