/**
 * Scopit - PDF Preview Modal
 * Displays a preview of Invoice/Estimate PDFs with template selection
 */
import React, { useState, useEffect, useRef } from 'react';
import { Modal, Select, Button, Spin, Space, Tooltip, App } from 'antd';
import {
  DownloadOutlined,
  PrinterOutlined,
  ExpandOutlined,
  CompressOutlined,
} from '@ant-design/icons';
import { colors, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { PdfTemplateId, PdfTemplateInfo } from '@/types/entities';

export type DocumentType = 'invoice' | 'estimate';

interface PdfPreviewModalProps {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  documentId: string;
  documentNumber: string;
  customerName?: string;
  isPaid?: boolean;
  defaultTemplate?: PdfTemplateId;
  fetchPreview: (id: string, template?: PdfTemplateId) => Promise<string>;
  fetchPdf: (id: string, template?: PdfTemplateId) => Promise<Blob>;
  templates: PdfTemplateInfo[];
  templatesLoading?: boolean;
}

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
  open,
  onClose,
  documentType,
  documentId,
  documentNumber,
  customerName,
  isPaid = false,
  defaultTemplate = 'classic',
  fetchPreview,
  fetchPdf,
  templates,
  templatesLoading = false,
}) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const isTablet = !isMobile && typeof window !== 'undefined' && window.innerWidth < 1024;
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplateId>(defaultTemplate);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load preview when modal opens or template changes
  useEffect(() => {
    if (open && documentId) {
      loadPreview();
    }
  }, [open, documentId, selectedTemplate]);

  // Reset template when modal opens
  useEffect(() => {
    if (open) {
      setSelectedTemplate(defaultTemplate);
    }
  }, [open, defaultTemplate]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const html = await fetchPreview(documentId, selectedTemplate);
      setPreviewHtml(html);
    } catch (error) {
      message.error('Failed to load preview');
      console.error('Preview error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await fetchPdf(documentId, selectedTemplate);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Generate filename
      const paidSuffix = isPaid ? '_PAID' : '';
      const customerPart = customerName ? `_${customerName.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      a.download = `${documentType === 'invoice' ? 'Invoice' : 'Estimate'}_${documentNumber}${customerPart}${paidSuffix}.pdf`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      message.success('PDF downloaded successfully');
    } catch (error) {
      message.error('Failed to download PDF');
      console.error('Download error:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const documentLabel = documentType === 'invoice' ? 'Invoice' : 'Estimate';

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>
            Preview {documentLabel} #{documentNumber}
          </span>
          {isPaid && (
            <span
              style={{
                background: '#dcfce7',
                color: '#16a34a',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              PAID
            </span>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      width={
        isFullscreen
          ? '100%'
          : isMobile
          ? '100%'
          : isTablet
          ? '92vw'
          : 900
      }
      style={
        isFullscreen
          ? { top: 0, maxWidth: '100%', paddingBottom: 0 }
          : isMobile
          ? { top: 0, maxWidth: '100%', margin: 0, paddingBottom: 0 }
          : undefined
      }
      styles={{
        header: {
          paddingBottom: 16,
          marginBottom: 0,
        },
        body: {
          padding: 0,
          height: isFullscreen
            ? 'calc(100vh - 110px)'
            : isMobile
            ? 'calc(100dvh - 110px)'
            : 600,
          overflow: 'hidden',
        },
      }}
      footer={null}
      centered={!isFullscreen && !isMobile}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? 8 : 0,
          padding: isMobile ? '10px 12px' : '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgLight,
        }}
      >
        {/* Template Selector */}
        <Space>
          <span style={{ fontSize: 14, color: colors.textSecondary }}>Template:</span>
          <Select
            value={selectedTemplate}
            onChange={setSelectedTemplate}
            style={{ width: isMobile ? 160 : 180 }}
            loading={templatesLoading}
            options={templates.map((t) => ({
              value: t.id,
              label: t.name,
            }))}
          />
        </Space>

        {/* Actions */}
        <Space style={isMobile ? { display: 'flex', justifyContent: 'flex-end' } : undefined}>
          <Tooltip title="Print">
            <Button
              icon={<PrinterOutlined />}
              onClick={handlePrint}
              disabled={loading}
              style={{ minWidth: 44, minHeight: 44 }}
            />
          </Tooltip>
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <Button
              icon={isFullscreen ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={toggleFullscreen}
              style={{ minWidth: 44, minHeight: 44 }}
            />
          </Tooltip>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            loading={downloading}
            disabled={loading}
            style={isMobile ? { flex: 1, minHeight: 44 } : undefined}
          >
            {isMobile ? 'Download' : 'Download PDF'}
          </Button>
        </Space>
      </div>

      {/* Preview Content */}
      <div
        style={{
          height: 'calc(100% - 57px)',
          overflow: 'auto',
          background: '#525659',
          display: 'flex',
          justifyContent: 'center',
          padding: isMobile ? 8 : 24,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
            }}
          >
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
              ref={iframeRef}
              srcDoc={previewHtml}
              style={{
                width: '100%',
                height: '100%',
                minHeight: isMobile ? '80vh' : '11in',
                border: 'none',
                display: 'block',
              }}
              title={`${documentLabel} Preview`}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PdfPreviewModal;
