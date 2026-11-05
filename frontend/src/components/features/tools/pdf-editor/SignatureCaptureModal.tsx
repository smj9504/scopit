/**
 * Scopit - Signature capture for a signer
 *
 * Draw or type a signature or initials, nothing remembered: used where the
 * signer is someone outside the company (the public signing page, and signing
 * in person on the company's own device). The PDF editor's SignatureModal is
 * different -- it saves the signed-in user's own signatures for reuse, which
 * must never be offered to a customer holding that user's device.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Radio, Typography, message } from 'antd';
import SignaturePad from 'signature_pad';

const { Text } = Typography;

export type SignMode = 'draw' | 'type';

type CursiveFont = { label: string; family: string };

export const CURSIVE_FONTS: CursiveFont[] = [
  { label: 'Dancing Script', family: 'Dancing Script' },
  { label: 'Great Vibes', family: 'Great Vibes' },
  { label: 'Caveat', family: 'Caveat' },
  { label: 'Sacramento', family: 'Sacramento' },
];

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Great+Vibes&family=Caveat:wght@700&family=Sacramento&display=swap';

/** Load the typed-signature fonts once per page */
export function useSignatureFonts(): void {
  useEffect(() => {
    const existing = document.querySelector('link[data-scopit-sig-fonts]');
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    link.setAttribute('data-scopit-sig-fonts', '1');
    document.head.appendChild(link);
  }, []);
}

/** Wait (briefly) for a web font to be usable on canvas -- drawing before
 * the Google font has loaded silently falls back to a default font. */
async function ensureFontLoaded(fontFamily: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.race([
      document.fonts.load(`60px "${fontFamily}"`),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // Render with whatever is available rather than blocking the signer.
  }
}

function renderTextToCanvas(text: string, fontFamily: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 150;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `60px "${fontFamily}"`;
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, canvas.height / 2);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

export interface SignatureCaptureModalProps {
  open: boolean;
  onClose: () => void;
  /** base64 PNG without the data URL prefix */
  onApply: (base64: string, mode: SignMode, font?: string) => void;
  fieldType: 'signature' | 'initials';
  /** Overrides the default "Sign Document" / "Enter Initials" */
  title?: string;
  /** Starts the Type tab with this text */
  defaultName?: string;
}

const SignatureCaptureModal: React.FC<SignatureCaptureModalProps> = ({
  open, onClose, onApply, fieldType, title, defaultName,
}) => {
  const [mode, setMode] = useState<SignMode>('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(CURSIVE_FONTS[0].family);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const savedDataRef = useRef<string | null>(null);

  const heading = title ?? (fieldType === 'initials' ? 'Enter Initials' : 'Sign Document');

  // The canvas remounts every time the Draw tab is shown, so each mount gets
  // its own pad and the strokes carry over through savedDataRef
  useEffect(() => {
    if (!open || mode !== 'draw') return;
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // offsetWidth/Height ignore the modal's zoom-in transform, which
      // getBoundingClientRect includes and would shrink the drawable area
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(ratio, ratio);
      const pad = new SignaturePad(canvas, { penColor: '#111827', backgroundColor: 'rgba(0,0,0,0)' });
      padRef.current = pad;
      if (savedDataRef.current) pad.fromDataURL(savedDataRef.current);
    }, 50);
    return () => {
      clearTimeout(timer);
      const pad = padRef.current;
      if (pad) {
        savedDataRef.current = pad.isEmpty() ? null : pad.toDataURL();
        pad.off();
        padRef.current = null;
      }
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open) {
      savedDataRef.current = null;
      setTypedName('');
      setMode('draw');
    } else {
      setTypedName(defaultName ?? '');
    }
  }, [open, defaultName]);

  const handleClear = () => padRef.current?.clear();

  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (mode === 'draw') {
      if (!padRef.current || padRef.current.isEmpty()) {
        message.warning(fieldType === 'initials' ? 'Please draw your initials.' : 'Please draw your signature.');
        return;
      }
      const dataUrl = padRef.current.toDataURL('image/png');
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      onApply(base64, 'draw');
    } else {
      const name = typedName.trim();
      if (!name) {
        message.warning(fieldType === 'initials' ? 'Please enter your initials.' : 'Please enter your name.');
        return;
      }
      setApplying(true);
      try {
        await ensureFontLoaded(selectedFont);
        const base64 = renderTextToCanvas(name, selectedFont);
        onApply(base64, 'type', selectedFont);
      } finally {
        setApplying(false);
      }
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={heading}
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="apply" type="primary" onClick={handleApply} loading={applying} style={{ background: '#111827', borderColor: '#111827' }}>
          Apply {fieldType === 'initials' ? 'Initials' : 'Signature'}
        </Button>,
      ]}
      destroyOnHidden
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
        <button
          onClick={() => setMode('draw')}
          style={{
            padding: '6px 16px', borderRadius: 6,
            border: mode === 'draw' ? '1.5px solid #111827' : '1px solid #e5e7eb',
            background: mode === 'draw' ? '#111827' : '#fff',
            color: mode === 'draw' ? '#fff' : '#374151',
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          aria-pressed={mode === 'draw'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Draw
        </button>
        <button
          onClick={() => setMode('type')}
          style={{
            padding: '6px 16px', borderRadius: 6,
            border: mode === 'type' ? '1.5px solid #111827' : '1px solid #e5e7eb',
            background: mode === 'type' ? '#111827' : '#fff',
            color: mode === 'type' ? '#fff' : '#374151',
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          aria-pressed={mode === 'type'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
          Type
        </button>
      </div>

      {mode === 'draw' && (
        <div>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            {fieldType === 'initials' ? 'Draw your initials in the box below' : 'Draw your signature in the box below'}
          </Text>
          <div style={{ border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden', background: '#fafafa', position: 'relative' }}>
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 160, cursor: 'crosshair', touchAction: 'none' }} />
          </div>
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <Button size="small" onClick={handleClear} style={{ color: '#6b7280' }}>Clear</Button>
          </div>
        </div>
      )}

      {mode === 'type' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Text style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {fieldType === 'initials' ? 'Your initials' : 'Full name'}
            </Text>
            <Input
              placeholder={fieldType === 'initials' ? 'JS' : 'John Smith'}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              size="large"
              style={{ borderRadius: 6 }}
              maxLength={fieldType === 'initials' ? 5 : 60}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Font style</Text>
            <Radio.Group value={selectedFont} onChange={(e) => setSelectedFont(e.target.value)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CURSIVE_FONTS.map((f) => (
                <Radio.Button key={f.family} value={f.family} style={{ fontFamily: `"${f.family}", cursive`, fontSize: 18, height: 40, lineHeight: '38px', borderRadius: 6, paddingLeft: 12, paddingRight: 12 }}>
                  {f.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </div>
          <div>
            <Text style={{ display: 'block', marginBottom: 6, fontSize: 12 }} type="secondary">Preview</Text>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa', height: 80, display: 'flex', alignItems: 'center', paddingLeft: 20, overflow: 'hidden' }}>
              <span style={{ fontFamily: `"${selectedFont}", cursive`, fontSize: 40, color: '#111827', whiteSpace: 'nowrap' }}>
                {typedName || (fieldType === 'initials' ? 'AB' : 'Your signature')}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default SignatureCaptureModal;
