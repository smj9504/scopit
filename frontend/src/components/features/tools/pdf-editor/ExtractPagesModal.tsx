/**
 * Scopit - PDF Editor: Extract Pages
 *
 * Copies pages into a new document -- or one document per page -- with the
 * edits made on them, optionally removing them from this one (Adobe's
 * "Delete pages after extracting" / "Extract pages as separate files").
 *
 * Usage:
 *   <ExtractPagesModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     pageCount={doc.pageCount}
 *     documentName={doc.name}
 *     defaultPages={[2, 3]}
 *     onExtract={(pages, options) => extract(pages, options)}
 *   />
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Checkbox, Typography, Button } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { formatPageRanges, parsePageRanges } from './pageRanges';
import { colors, fonts, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractPagesModalProps {
  open: boolean;
  onClose: () => void;
  pageCount: number;
  documentName: string;
  /** Preselected pages */
  defaultPages: number[];
  /** Resolves true when done (the modal closes), false to stay open */
  onExtract: (
    pages: number[],
    options: { separate: boolean; deleteAfter: boolean; name?: string },
  ) => Promise<boolean>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  sectionLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 8,
    fontFamily: fonts.body,
  },
  section: {
    padding: '0 24px',
    marginBottom: 18,
  },
  hint: {
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    fontFamily: fonts.body,
    display: 'block',
    marginTop: 6,
  },
} as const;

// ── Main component ────────────────────────────────────────────────────────────

const ExtractPagesModal: React.FC<ExtractPagesModalProps> = ({
  open,
  onClose,
  pageCount,
  documentName,
  defaultPages,
  onExtract,
}) => {
  const [rangeText, setRangeText] = useState('');
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [name, setName] = useState('');
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const valid = defaultPages.filter((p) => p >= 1 && p <= pageCount);
    setRangeText(valid.length ? formatPageRanges(valid) : '');
    setDeleteAfter(false);
    setSeparate(false);
    setName('');
    setExtracting(false);
    // Only when the modal opens: later prop changes mustn't wipe what's typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pages = useMemo(() => parsePageRanges(rangeText, pageCount), [rangeText, pageCount]);
  const rangeInvalid = !!rangeText.trim() && !pages;
  const allPages = !!pages && pages.length === pageCount;
  const base = documentName.replace(/\.pdf$/i, '');
  const namePlaceholder = pages
    ? `${base} (${pages.length === 1 ? 'page' : 'pages'} ${formatPageRanges(pages)})`
    : base;

  // A document needs at least one page left
  useEffect(() => {
    if (allPages && deleteAfter) setDeleteAfter(false);
  }, [allPages, deleteAfter]);

  const canExtract = !!pages && pages.length > 0 && !(deleteAfter && allPages);

  const handleExtract = async () => {
    if (!pages || !canExtract || extracting) return;
    setExtracting(true);
    try {
      const done = await onExtract(pages, {
        separate,
        deleteAfter,
        ...(!separate && name.trim() ? { name: name.trim() } : {}),
      });
      if (done) onClose();
    } finally {
      setExtracting(false);
    }
  };

  const confirmLabel = !pages
    ? 'Extract'
    : separate && pages.length > 1
    ? `Extract as ${pages.length} files`
    : `Extract ${pages.length} page${pages.length !== 1 ? 's' : ''}`;

  return (
    <Modal
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: fontWeights.semibold, fontSize: fontSizes.md }}>
          Extract pages
        </span>
      }
      open={open}
      onCancel={extracting ? undefined : onClose}
      width={480}
      maskClosable={!extracting}
      closable={!extracting}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <Button onClick={onClose} disabled={extracting} style={{ fontFamily: fonts.body }}>
            Cancel
          </Button>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            onClick={handleExtract}
            loading={extracting}
            disabled={!canExtract}
            style={{ fontFamily: fonts.body, fontWeight: fontWeights.semibold }}
          >
            {extracting ? 'Extracting…' : confirmLabel}
          </Button>
        </div>
      }
      styles={{
        body: { padding: '16px 0 4px', fontFamily: fonts.body },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        footer: { padding: '12px 24px 16px', borderTop: `1px solid ${colors.border}` },
      }}
    >
      <div style={S.section}>
        <span style={S.sectionLabel}>Pages</span>
        <Input
          value={rangeText}
          onChange={(e) => setRangeText(e.target.value)}
          onPressEnter={handleExtract}
          placeholder="e.g. 1-3, 5"
          status={rangeInvalid ? 'error' : undefined}
          disabled={extracting}
          autoFocus
          aria-label="Pages to extract"
          aria-invalid={rangeInvalid}
          style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}
        />
        <Text style={{ ...S.hint, color: rangeInvalid ? colors.error : colors.textMuted }}>
          {rangeInvalid
            ? `Use page numbers from 1 to ${pageCount}, like 1-3, 5.`
            : pages
            ? `${pages.length} of ${pageCount} page${pageCount !== 1 ? 's' : ''}. Edits on them come along.`
            : `This document has ${pageCount} page${pageCount !== 1 ? 's' : ''}.`}
        </Text>
      </div>

      <div style={{ ...S.section, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Checkbox
          checked={deleteAfter}
          onChange={(e) => setDeleteAfter(e.target.checked)}
          disabled={extracting || allPages}
        >
          <span style={{ fontSize: fontSizes.sm }}>Delete pages after extracting</span>
        </Checkbox>
        {allPages && (
          <Text style={{ ...S.hint, marginTop: -4, marginLeft: 24 }}>
            Not with every page selected: a document needs at least one page.
          </Text>
        )}
        <Checkbox
          checked={separate}
          onChange={(e) => setSeparate(e.target.checked)}
          disabled={extracting}
        >
          <span style={{ fontSize: fontSizes.sm }}>Extract pages as separate files</span>
        </Checkbox>
      </div>

      {!separate && (
        <div style={S.section}>
          <span style={S.sectionLabel}>New document name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleExtract}
            placeholder={namePlaceholder}
            maxLength={255}
            disabled={extracting}
            aria-label="New document name"
            style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}
          />
        </div>
      )}
    </Modal>
  );
};

export default ExtractPagesModal;
