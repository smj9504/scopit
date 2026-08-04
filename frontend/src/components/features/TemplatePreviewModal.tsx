/**
 * ScopeIt - PDF Template Sample Preview Modal
 * Renders a sample estimate through a given template, for template pickers.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Spin, Button, App } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { colors, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { estimateService } from '@/services/estimateService';
import type { PdfTemplateId } from '@/types/entities';

interface TemplatePreviewModalProps {
  open: boolean;
  onClose: () => void;
  template: PdfTemplateId;
  templateName: string;
  isSelected: boolean;
  onUseTemplate: (template: PdfTemplateId) => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  open,
  onClose,
  template,
  templateName,
  isSelected,
  onUseTemplate,
}) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    estimateService
      .getTemplateSamplePreview(template)
      .then(setHtml)
      .catch(() => message.error('Failed to load template preview'))
      .finally(() => setLoading(false));
  }, [open, template]);

  return (
    <Modal
      title={<span style={{ fontWeight: 600 }}>{templateName} template — sample preview</span>}
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 900}
      style={isMobile ? { top: 0, maxWidth: '100%', margin: 0, paddingBottom: 0 } : undefined}
      styles={{
        body: {
          padding: 0,
          height: isMobile ? 'calc(100dvh - 110px)' : 600,
          overflow: 'hidden',
        },
      }}
      centered={!isMobile}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {isSelected && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 500,
                color: colors.success,
              }}
            >
              <CheckOutlined />
              This is your current default
            </span>
          )}
          <Button onClick={onClose}>Close</Button>
          {!isSelected && (
            <Button
              type="primary"
              onClick={() => {
                onUseTemplate(template);
                onClose();
              }}
              style={{ background: colors.primary }}
            >
              Use This Template
            </Button>
          )}
        </div>
      }
    >
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          background: '#525659',
          display: 'flex',
          justifyContent: 'center',
          padding: isMobile ? 8 : 24,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <Spin size="large" tip="Loading preview..." />
          </div>
        ) : (
          <div
            style={{
              width: isMobile ? '100%' : '8.5in',
              minHeight: isMobile ? 'auto' : '11in',
              background: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              borderRadius: borderRadius.sm,
              overflow: 'hidden',
            }}
          >
            <iframe
              srcDoc={html}
              style={{
                width: '100%',
                height: '100%',
                minHeight: isMobile ? '80vh' : '11in',
                border: 'none',
                display: 'block',
              }}
              title={`${templateName} template sample preview`}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TemplatePreviewModal;
