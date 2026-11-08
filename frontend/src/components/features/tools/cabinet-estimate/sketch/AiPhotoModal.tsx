/**
 * AiPhotoModal
 *
 * Turns the 3D view's realistic render into a photo-like picture of the
 * finished kitchen: the render beside the picture, a box for anything else
 * the picture should show (a backsplash, pendant lights…), and a download.
 *
 * The picture comes from an AI image model (backend sketch_ai_photo.py),
 * which keeps the layout but can drift in small ways, so it is offered as
 * a concept image only. It is not stored: downloading it is how to keep it.
 */

import React, { useState } from 'react';
import { Alert, Button, Input, Modal, Spin, Typography } from 'antd';
import { CameraOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { cabinetSketchService } from '@/services/cabinetSketchService';

export interface AiPhotoModalProps {
  estimateId: string;
  /** The captured render (a data URL); the modal is open while there is one. */
  render: string | null;
  /** The kitchen's finish in words (finishWords). */
  finish: string;
  onClose: () => void;
}

const paneStyle: React.CSSProperties = {
  flex: '1 1 320px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const frameStyle: React.CSSProperties = {
  aspectRatio: '16 / 9',
  border: '1px solid #e5e3de',
  borderRadius: 6,
  background: '#f7f7f5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const errorText = (error: unknown): string => {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return error instanceof Error ? error.message : 'The AI photo could not be made.';
};

const AiPhotoModal: React.FC<AiPhotoModalProps> = ({ estimateId, render, finish, onClose }) => {
  const [notes, setNotes] = useState('');
  const photo = useMutation({
    mutationFn: () =>
      cabinetSketchService.makeAiPhoto(estimateId, { image: render ?? '', finish, notes: notes.trim() || undefined }),
  });

  const close = () => {
    photo.reset();
    onClose();
  };

  return (
    <Modal
      open={!!render}
      title="AI photo"
      width={1040}
      onCancel={close}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={close}>
          Close
        </Button>,
        photo.data && (
          <Button
            key="download"
            icon={<DownloadOutlined />}
            href={photo.data.image}
            download={`kitchen-ai-photo.${photo.data.image.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`}
          >
            Download
          </Button>
        ),
        <Button key="make" type="primary" icon={<CameraOutlined />} loading={photo.isPending} onClick={() => photo.mutate()}>
          {photo.data ? 'Make another' : 'Make photo'}
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        An AI concept picture of the kitchen, drawn from the 3D view as it is framed now (use Eye level, or turn the view, then
        open this again for another angle). It keeps the layout and finishes but can differ in small ways — a door split
        differently, an appliance moved — so it is not the record of what is priced. It is not saved; download it to keep it.
      </Typography.Paragraph>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={paneStyle}>
          <Typography.Text strong>3D view</Typography.Text>
          <div style={frameStyle}>
            {render && <img src={render} alt="The kitchen in the 3D view" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          </div>
        </div>
        <div style={paneStyle}>
          <Typography.Text strong>AI photo</Typography.Text>
          <div style={frameStyle}>
            {photo.isPending ? (
              <Spin tip="Drawing the photo… usually 10–30 seconds">
                <div style={{ width: 240, height: 80 }} />
              </Spin>
            ) : photo.data ? (
              <img src={photo.data.image} alt="The finished kitchen, as drawn by AI" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary">Not made yet</Typography.Text>
            )}
          </div>
        </div>
      </div>

      {photo.isError && <Alert type="error" showIcon style={{ marginTop: 12 }} message={errorText(photo.error)} />}

      <div style={{ marginTop: 16 }}>
        <Typography.Text strong>Finishes</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '2px 0 10px' }}>
          {finish}
        </Typography.Paragraph>
        <Typography.Text strong>Anything else to show</Typography.Text>
        <Input.TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="Optional — e.g. white subway tile backsplash, a window over the sink, pendant lights"
          style={{ marginTop: 4 }}
        />
      </div>
    </Modal>
  );
};

export default AiPhotoModal;
