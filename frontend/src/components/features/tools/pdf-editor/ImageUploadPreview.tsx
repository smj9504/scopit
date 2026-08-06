/**
 * Scopit - Image Upload Preview Modal
 *
 * Shows a preview of an image file before converting to PDF.
 * Allows the user to rotate the image (90° CW/CCW) so the
 * resulting PDF page has the correct orientation.
 */
import React, { useState, useMemo } from 'react';
import { Modal, Button, Space, Typography } from 'antd';
import {
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';

const { Text } = Typography;

interface ImageUploadPreviewProps {
  open: boolean;
  file: File | null;
  onConfirm: (file: File, rotation: number) => void;
  onCancel: () => void;
}

const ImageUploadPreview: React.FC<ImageUploadPreviewProps> = ({
  open,
  file,
  onConfirm,
  onCancel,
}) => {
  const [rotation, setRotation] = useState(0);

  // Create a preview URL for the image
  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  // Reset rotation when file changes
  React.useEffect(() => {
    setRotation(0);
  }, [file]);

  // Clean up URL on unmount
  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleRotateCW = () => setRotation((r) => (r + 90) % 360);
  const handleRotateCCW = () => setRotation((r) => (r - 90 + 360) % 360);

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onCancel}
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.body }}>
            {rotation !== 0 ? `Rotated ${rotation}°` : 'No rotation'}
          </Text>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button
              type="primary"
              onClick={() => file && onConfirm(file, rotation)}
            >
              Convert to PDF
            </Button>
          </Space>
        </div>
      }
      destroyOnHidden
    >
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <Text
          strong
          style={{
            fontFamily: fonts.heading,
            fontSize: 16,
            display: 'block',
            marginBottom: 16,
          }}
        >
          Preview & Rotate
        </Text>

        {/* Rotation controls */}
        <Space size={12} style={{ marginBottom: 16 }}>
          <Button
            icon={<RotateLeftOutlined />}
            onClick={handleRotateCCW}
            style={{ fontFamily: fonts.body }}
          >
            Rotate Left
          </Button>
          <Button
            icon={<RotateRightOutlined />}
            onClick={handleRotateCW}
            style={{ fontFamily: fonts.body }}
          >
            Rotate Right
          </Button>
        </Space>

        {/* Image preview */}
        <div
          style={{
            background: colors.bgLight,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 300,
            maxHeight: 460,
            overflow: 'hidden',
          }}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Preview"
              style={{
                maxWidth: '100%',
                maxHeight: 420,
                objectFit: 'contain',
                transform: `rotate(${rotation}deg)`,
                transition: 'transform 0.3s ease',
              }}
            />
          )}
        </div>

        <Text
          style={{
            fontSize: 12,
            color: colors.textMuted,
            fontFamily: fonts.body,
            display: 'block',
            marginTop: 8,
          }}
        >
          {file?.name}
        </Text>
      </div>
    </Modal>
  );
};

export default ImageUploadPreview;
