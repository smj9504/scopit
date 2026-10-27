/**
 * Scopit - PDF Editor: Insert Pages
 *
 * Adds pages to the open document: blank pages the size of the neighboring
 * page, a file from the computer (PDF, image or Word), or pages of another
 * document in the library -- or of this one, which duplicates them.
 *
 * Usage:
 *   <InsertPagesModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     documentId={documentId}
 *     pageCount={doc.pageCount}
 *     defaultAfter={currentPage}
 *     onInsert={(after, source) => insert(after, source)}
 *   />
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Segmented,
  Radio,
  InputNumber,
  Input,
  Upload,
  Spin,
  Empty,
  Alert,
  Typography,
  Button,
} from 'antd';
import {
  FileAddOutlined,
  InboxOutlined,
  FileTextOutlined,
  SearchOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import { parsePageRanges } from './pageRanges';
import type { PdfDocument } from './types';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;
const { Dragger } = Upload;

// ── Types ─────────────────────────────────────────────────────────────────────

export type InsertSource =
  | { kind: 'blank'; count: number }
  | { kind: 'file'; file: File }
  | { kind: 'document'; documentId: string; pages?: number[] };

export interface InsertPagesModalProps {
  open: boolean;
  onClose: () => void;
  /** The open document: listed first as "This document" (inserting from it duplicates pages) */
  documentId: string;
  pageCount: number;
  /** 0..pageCount (0 = before page 1) */
  defaultAfter: number;
  /** Resolves true when done (the modal closes), false to stay open */
  onInsert: (after: number, source: InsertSource) => Promise<boolean>;
}

type SourceKind = InsertSource['kind'];

const MAX_BLANK_PAGES = 100;
const FILE_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.docx,application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

// ── Document row ──────────────────────────────────────────────────────────────

const DocOption: React.FC<{
  doc: PdfDocument;
  label?: string;
  selected: boolean;
  onSelect: (doc: PdfDocument) => void;
}> = ({ doc, label, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(doc)}
    aria-pressed={selected}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      border: 'none',
      borderRadius: borderRadius.base,
      background: selected ? colors.bgSunken : 'transparent',
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: fonts.body,
      transition: 'background 0.15s ease',
    }}
    onMouseEnter={(e) => {
      if (!selected) e.currentTarget.style.background = colors.bgLight;
    }}
    onMouseLeave={(e) => {
      if (!selected) e.currentTarget.style.background = 'transparent';
    }}
  >
    <FileTextOutlined style={{ color: colors.textMuted, fontSize: 13, flexShrink: 0 }} />
    <span style={{ flex: 1, minWidth: 0 }}>
      <Text
        ellipsis
        style={{
          display: 'block',
          fontSize: fontSizes.sm,
          color: colors.textPrimary,
          fontWeight: selected ? fontWeights.semibold : fontWeights.normal,
        }}
      >
        {label ?? doc.name}
      </Text>
      {label && (
        <Text ellipsis style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textMuted }}>
          {doc.name}
        </Text>
      )}
    </span>
    <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''}
    </Text>
    {selected && <CheckOutlined style={{ color: colors.textPrimary, fontSize: 12, flexShrink: 0 }} />}
  </button>
);

// ── Main component ────────────────────────────────────────────────────────────

const InsertPagesModal: React.FC<InsertPagesModalProps> = ({
  open,
  onClose,
  documentId,
  pageCount,
  defaultAfter,
  onInsert,
}) => {
  const [kind, setKind] = useState<SourceKind>('blank');
  const [placement, setPlacement] = useState<'before' | 'after'>('after');
  const [refPage, setRefPage] = useState(1);
  const [count, setCount] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [sourceDoc, setSourceDoc] = useState<PdfDocument | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [inserting, setInserting] = useState(false);

  // Fresh form each time the modal opens, positioned where the caller asked
  useEffect(() => {
    if (!open) return;
    const after = Math.max(0, Math.min(defaultAfter, pageCount));
    setKind('blank');
    setPlacement(after === 0 ? 'before' : 'after');
    setRefPage(Math.max(1, after));
    setCount(1);
    setFile(null);
    setSearch('');
    setSourceDoc(null);
    setRangeText('');
    setInserting(false);
  }, [open, defaultAfter, pageCount]);

  const { data: thisDoc } = useQuery({
    queryKey: ['pdf-document', documentId],
    queryFn: () => pdfEditorApi.getDocument(documentId),
    enabled: open && kind === 'document',
    staleTime: 30_000,
  });

  const { data: docList, isLoading: docsLoading, isError: docsError } = useQuery({
    queryKey: ['pdf-editor-insert-documents', search.trim()],
    queryFn: () => pdfEditorApi.listDocuments(0, 50, search.trim() || undefined),
    enabled: open && kind === 'document',
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const otherDocs = (docList?.items ?? []).filter((d) => d.id !== documentId);
  const showThisDoc =
    !!thisDoc && (!search.trim() || thisDoc.name.toLowerCase().includes(search.trim().toLowerCase()));

  const safeRef = Math.max(1, Math.min(refPage || 1, Math.max(pageCount, 1)));
  const after = placement === 'before' ? safeRef - 1 : safeRef;

  const parsedRange = useMemo(
    () => (sourceDoc && rangeText.trim() ? parsePageRanges(rangeText, sourceDoc.pageCount) : null),
    [sourceDoc, rangeText],
  );
  const rangeInvalid = !!sourceDoc && !!rangeText.trim() && !parsedRange;

  const source: InsertSource | null =
    kind === 'blank'
      ? count >= 1 && count <= MAX_BLANK_PAGES ? { kind: 'blank', count } : null
      : kind === 'file'
      ? file ? { kind: 'file', file } : null
      : sourceDoc && !rangeInvalid
      ? { kind: 'document', documentId: sourceDoc.id, ...(parsedRange ? { pages: parsedRange } : {}) }
      : null;

  const insertedCount =
    source?.kind === 'blank'
      ? source.count
      : source?.kind === 'document'
      ? source.pages?.length ?? sourceDoc?.pageCount ?? 0
      : null;

  const handleInsert = async () => {
    if (!source || inserting) return;
    setInserting(true);
    try {
      const done = await onInsert(after, source);
      if (done) onClose();
    } finally {
      setInserting(false);
    }
  };

  const confirmLabel =
    insertedCount !== null
      ? `Insert ${insertedCount} page${insertedCount !== 1 ? 's' : ''}`
      : 'Insert';

  return (
    <Modal
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: fontWeights.semibold, fontSize: fontSizes.md }}>
          Insert pages
        </span>
      }
      open={open}
      onCancel={inserting ? undefined : onClose}
      width={520}
      maskClosable={!inserting}
      closable={!inserting}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <Button onClick={onClose} disabled={inserting} style={{ fontFamily: fonts.body }}>
            Cancel
          </Button>
          <Button
            type="primary"
            icon={<FileAddOutlined />}
            onClick={handleInsert}
            loading={inserting}
            disabled={!source}
            style={{ fontFamily: fonts.body, fontWeight: fontWeights.semibold }}
          >
            {inserting ? 'Inserting…' : confirmLabel}
          </Button>
        </div>
      }
      styles={{
        body: { padding: '16px 0 4px', fontFamily: fonts.body },
        header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
        footer: { padding: '12px 24px 16px', borderTop: `1px solid ${colors.border}` },
      }}
    >
      {/* ── What to insert ── */}
      <div style={S.section}>
        <span style={S.sectionLabel}>Insert</span>
        <Segmented<SourceKind>
          block
          value={kind}
          onChange={(v) => setKind(v)}
          disabled={inserting}
          options={[
            { value: 'blank', label: 'Blank page' },
            { value: 'file', label: 'From a file' },
            { value: 'document', label: 'From a document' },
          ]}
          style={{ fontFamily: fonts.body }}
        />
      </div>

      {kind === 'blank' && (
        <div style={S.section}>
          <span style={S.sectionLabel}>Number of pages</span>
          <InputNumber
            min={1}
            max={MAX_BLANK_PAGES}
            precision={0}
            value={count}
            onChange={(v) => setCount(v ?? 1)}
            disabled={inserting}
            aria-label="Number of blank pages"
            style={{ width: 120, fontFamily: fonts.body }}
          />
          <Text style={S.hint}>Blank pages match the size of the page next to them.</Text>
        </div>
      )}

      {kind === 'file' && (
        <div style={S.section}>
          <span style={S.sectionLabel}>File</span>
          <Dragger
            accept={FILE_ACCEPT}
            multiple={false}
            showUploadList={false}
            disabled={inserting}
            beforeUpload={(f) => {
              setFile(f as unknown as File);
              return false;
            }}
            style={{ background: colors.bgLight, borderColor: colors.border, borderRadius: borderRadius.md }}
          >
            <div style={{ padding: '4px 0' }}>
              <InboxOutlined style={{ fontSize: 28, color: colors.textMuted }} />
              {file ? (
                <p style={{ margin: '6px 0 0', fontSize: fontSizes.sm, color: colors.textPrimary }}>
                  <Text strong ellipsis style={{ maxWidth: 360 }}>{file.name}</Text>
                  <br />
                  <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>Click or drop to replace</Text>
                </p>
              ) : (
                <p style={{ margin: '6px 0 0', fontSize: fontSizes.sm, color: colors.textPrimary }}>
                  Drop a file here or <span style={{ fontWeight: fontWeights.semibold }}>click to browse</span>
                  <br />
                  <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
                    PDF, image (JPG, PNG, WEBP, HEIC) or Word (DOCX)
                  </Text>
                </p>
              )}
            </div>
          </Dragger>
        </div>
      )}

      {kind === 'document' && (
        <div style={S.section}>
          <span style={S.sectionLabel}>Document</span>
          <Input
            prefix={<SearchOutlined style={{ color: colors.textMuted, fontSize: 13 }} />}
            placeholder="Search documents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            disabled={inserting}
            style={{ marginBottom: 8, fontFamily: fonts.body, fontSize: fontSizes.sm }}
            aria-label="Search documents"
          />
          <div
            role="listbox"
            aria-label="Documents"
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              maxHeight: 210,
              overflowY: 'auto',
              padding: 4,
            }}
          >
            {showThisDoc && thisDoc && (
              <DocOption
                doc={thisDoc}
                label="This document"
                selected={sourceDoc?.id === thisDoc.id}
                onSelect={setSourceDoc}
              />
            )}
            {docsLoading && !docList ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <Spin size="small" />
              </div>
            ) : docsError ? (
              <Alert type="error" message="Couldn't load documents" showIcon style={{ margin: 6 }} />
            ) : otherDocs.length === 0 && !showThisDoc ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>
                    {search ? 'No documents match your search' : 'No other documents yet'}
                  </Text>
                }
                style={{ padding: '12px 0' }}
              />
            ) : (
              otherDocs.map((doc) => (
                <DocOption
                  key={doc.id}
                  doc={doc}
                  selected={sourceDoc?.id === doc.id}
                  onSelect={setSourceDoc}
                />
              ))
            )}
          </div>

          {sourceDoc && (
            <div style={{ marginTop: 12 }}>
              <span style={S.sectionLabel}>Pages</span>
              <Input
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder={`All ${sourceDoc.pageCount} pages, or e.g. 1-3, 5`}
                status={rangeInvalid ? 'error' : undefined}
                disabled={inserting}
                aria-label="Pages to insert"
                aria-invalid={rangeInvalid}
                style={{ fontFamily: fonts.body, fontSize: fontSizes.sm }}
              />
              <Text style={{ ...S.hint, color: rangeInvalid ? colors.error : colors.textMuted }}>
                {rangeInvalid
                  ? `Use page numbers from 1 to ${sourceDoc.pageCount}, like 1-3, 5.`
                  : sourceDoc.id === documentId
                  ? 'Inserting pages of this document duplicates them, with their edits.'
                  : 'Edits on those pages come along.'}
              </Text>
            </div>
          )}
        </div>
      )}

      {/* ── Where ── */}
      <div style={S.section}>
        <span style={S.sectionLabel}>Where</span>
        {pageCount > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Radio.Group
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              disabled={inserting}
              optionType="button"
              options={[
                { value: 'before', label: 'Before' },
                { value: 'after', label: 'After' },
              ]}
            />
            <span style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>page</span>
            <InputNumber
              min={1}
              max={pageCount}
              value={safeRef}
              onChange={(v) => setRefPage(v ?? 1)}
              disabled={inserting}
              aria-label="Reference page"
              style={{ width: 80, fontFamily: fonts.body }}
            />
            <span style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>of {pageCount}</span>
          </div>
        ) : (
          <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>At the start</Text>
        )}
      </div>
    </Modal>
  );
};

export default InsertPagesModal;
