/**
 * Scopit - PDF Editor: a picture, with its background taken out
 *
 * Two uses:
 *   - 'stamp': pick a picture (a photo of a seal or stamp, a logo) to place
 *     as a stamp, background out by default, and keep it in My stamps.
 *   - 'image': take the background out of an image already on the page.
 *
 * The preview shows the result over a checkerboard, so what's see-through
 * is plain; Strength trades leftover paper against bits of the mark.
 *
 * Usage:
 *   <ImageBackgroundModal
 *     open={open}
 *     mode="stamp"
 *     onCancel={close}
 *     onApply={({ dataUrl, save, name }) => place(dataUrl)}
 *   />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Checkbox, Input, Modal, Slider, Switch, Typography } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { borderRadius, colors, fonts, fontSizes, fontWeights } from '@/styles/theme';
import {
  imageToCanvas,
  loadImage,
  readFileAsDataUrl,
  removeBackground,
  trimTransparent,
} from './imageBackground';

const { Text } = Typography;

const DEFAULT_STRENGTH = 45;
/** Pixels on the long side: a stamp is at most a few inches across */
const STAMP_MAX_SIDE = 800;
const IMAGE_MAX_SIDE = 1600;
const CHECKERBOARD = `repeating-conic-gradient(${colors.border} 0% 25%, ${colors.bgWhite} 0% 50%) 50% / 16px 16px`;

export interface ImageBackgroundResult {
  dataUrl: string;
  /** Stamp: keep it in My stamps */
  save: boolean;
  name: string;
}

export interface ImageBackgroundModalProps {
  open: boolean;
  mode: 'stamp' | 'image';
  /** 'image': the picture to work on */
  source?: string | null;
  onCancel: () => void;
  onApply: (result: ImageBackgroundResult) => void;
}

const ImageBackgroundModal: React.FC<ImageBackgroundModalProps> = ({
  open,
  mode,
  source,
  onCancel,
  onApply,
}) => {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Bumped per picture, so choosing another one redoes the preview
  const [pictureKey, setPictureKey] = useState(0);
  const [removeBg, setRemoveBg] = useState(true);
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [save, setSave] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const isStamp = mode === 'stamp';

  const reset = useCallback(() => {
    baseRef.current = null;
    setLoaded(false);
    setPreview(null);
    setRemoveBg(true);
    setStrength(DEFAULT_STRENGTH);
    setName('');
    setSave(true);
  }, []);

  const loadPicture = useCallback(async (src: string) => {
    try {
      const img = await loadImage(src);
      baseRef.current = imageToCanvas(img, isStamp ? STAMP_MAX_SIDE : IMAGE_MAX_SIDE);
      setLoaded(true);
      setPictureKey((k) => k + 1);
    } catch {
      message.error('This picture could not be opened. Try a JPG or PNG.');
    }
  }, [isStamp, message]);

  useEffect(() => {
    if (!open) return;
    reset();
    if (mode === 'image' && source) loadPicture(source);
  }, [open, mode, source, reset, loadPicture]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      message.error('Choose a picture (JPG, PNG, ...)');
      return;
    }
    setName(file.name.replace(/\.[^.]+$/, '').slice(0, 40));
    try {
      await loadPicture(await readFileAsDataUrl(file));
    } catch {
      message.error('This file could not be read');
    }
  };

  // The result, redone a moment after the last change
  useEffect(() => {
    const base = baseRef.current;
    if (!loaded || !base) return;
    const timer = window.setTimeout(() => {
      if (!removeBg) {
        // A plain photo stays a JPEG: much smaller to keep
        setPreview(isStamp ? base.toDataURL('image/jpeg', 0.9) : base.toDataURL('image/png'));
        return;
      }
      const cut = removeBackground(base, strength);
      setPreview((isStamp ? trimTransparent(cut) : cut).toDataURL('image/png'));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loaded, pictureKey, removeBg, strength, isStamp]);

  const apply = () => {
    if (!preview) return;
    onApply({ dataUrl: preview, save: isStamp && save, name: name.trim() || 'Stamp' });
  };

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="primary" onClick={apply} disabled={!preview}>
        {isStamp ? 'Place stamp' : 'Apply'}
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={isStamp ? 'Picture stamp' : 'Remove background'}
      width={520}
      footer={footer}
      destroyOnHidden
      centered
    >
      <div style={{ fontFamily: fonts.body }}>
        {!loaded && !isStamp ? (
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted }}>
            Loading picture…
          </div>
        ) : !loaded ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              minHeight: 200,
              padding: 24,
              border: `1.5px dashed ${dragOver ? colors.textMuted : colors.borderDark}`,
              borderRadius: borderRadius.md,
              background: dragOver ? colors.bgSunken : colors.bgLight,
              cursor: 'pointer',
              fontFamily: fonts.body,
            }}
          >
            <PictureOutlined style={{ fontSize: 28, color: colors.textMuted }} aria-hidden="true" />
            <span style={{ fontSize: fontSizes.base, fontWeight: fontWeights.medium, color: colors.textPrimary }}>
              Choose a picture of your stamp
            </span>
            <span style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
              A photo or scan of a seal, stamp or logo. JPG or PNG.
            </span>
          </button>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 240,
                padding: 12,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                background: removeBg ? CHECKERBOARD : colors.bgLight,
              }}
            >
              {preview && (
                <img
                  src={preview}
                  alt="Preview"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <Switch size="small" checked={removeBg} onChange={setRemoveBg} id="remove-bg-switch" />
              <label htmlFor="remove-bg-switch" style={{ fontSize: fontSizes.sm, color: colors.textPrimary, cursor: 'pointer' }}>
                Remove background
              </label>
              {isStamp && (
                <Button type="link" size="small" style={{ marginLeft: 'auto', padding: 0 }} onClick={() => fileRef.current?.click()}>
                  Choose another picture
                </Button>
              )}
            </div>

            {removeBg && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, width: 56 }}>Strength</Text>
                  <Slider
                    min={0}
                    max={100}
                    value={strength}
                    onChange={setStrength}
                    style={{ flex: 1, margin: '6px 0' }}
                    aria-label="Background removal strength"
                  />
                </div>
                <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textMuted }}>
                  Raise it if paper still shows around the mark; lower it if parts of the mark disappear.
                </Text>
              </div>
            )}

            {isStamp && (
              <div style={{ marginTop: 16 }}>
                <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, marginBottom: 4 }}>
                  Name
                </Text>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="Company seal"
                  aria-label="Stamp name"
                />
                <Checkbox checked={save} onChange={(e) => setSave(e.target.checked)} style={{ marginTop: 10 }}>
                  Save to My stamps
                </Checkbox>
              </div>
            )}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
};

export default ImageBackgroundModal;
