/**
 * Scopit - PDF Editor: find text to redact
 *
 * Searches the PDF's own text for words, a phrase or a pattern (email
 * addresses, phone numbers, ...) and lets the user pick which matches to
 * mark for redaction -- Acrobat's "Find text" in Redact.
 *
 * Usage:
 *   <RedactSearchModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     documentId={doc.id}
 *     onMark={(matches) => addRedactMarks(matches)}
 *     onGoToPage={setCurrentPage}
 *   />
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { pdfEditorApi } from './pdfEditorApi';
import { apiErrorMessage } from './pdfPassword';
import type { RedactPattern, TextSearchMatch } from './types';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

export interface RedactSearchModalProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  /** Mark these for redaction (parent adds 'redact' annotations, one per box) */
  onMark: (matches: TextSearchMatch[]) => void;
  onGoToPage: (page: number) => void;
}

type Mode = 'words' | 'patterns';

const PATTERN_OPTIONS: { value: RedactPattern; label: string }[] = [
  { value: 'email', label: 'Email addresses' },
  { value: 'phone', label: 'Phone numbers' },
  { value: 'ssn', label: 'Social Security numbers' },
  { value: 'credit_card', label: 'Credit card numbers' },
  { value: 'date', label: 'Dates' },
];

const S = {
  sectionLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 6,
  },
  results: {
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    maxHeight: 300,
    overflowY: 'auto' as const,
  },
  pageHeader: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    background: colors.bgLight,
    borderBottom: `1px solid ${colors.border}`,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 12px',
    borderBottom: `1px solid ${colors.borderLight}`,
    cursor: 'pointer',
  },
};

const RedactSearchModal: React.FC<RedactSearchModalProps> = ({
  open,
  onClose,
  documentId,
  onMark,
  onGoToPage,
}) => {
  const { message } = App.useApp();
  const [mode, setMode] = useState<Mode>('words');
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [pattern, setPattern] = useState<RedactPattern>('email');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<TextSearchMatch[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Indices into `matches`
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // The document may have changed since last time: start over on each open
  useEffect(() => {
    if (!open) return;
    setMatches(null);
    setTruncated(false);
    setChecked(new Set());
    setSearching(false);
  }, [open]);

  const canSearch = mode === 'patterns' || query.trim().length > 0;

  const handleSearch = async () => {
    if (!canSearch || searching) return;
    setSearching(true);
    try {
      const result = await pdfEditorApi.searchText(
        documentId,
        mode === 'words'
          ? { q: query.trim(), matchCase, wholeWord }
          : { pattern },
      );
      setMatches(result.matches);
      setTruncated(result.truncated);
      setChecked(new Set(result.matches.map((_, i) => i)));
    } catch (err) {
      message.error(apiErrorMessage(err, 'Search failed. Please try again.'));
    } finally {
      setSearching(false);
    }
  };

  // Matches grouped by page, keeping their indices
  const byPage = useMemo(() => {
    const groups = new Map<number, number[]>();
    (matches ?? []).forEach((m, i) => {
      const list = groups.get(m.page);
      if (list) list.push(i);
      else groups.set(m.page, [i]);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const toggle = (indices: number[], on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const i of indices) {
        if (on) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  };

  const handleMark = () => {
    if (!matches || checked.size === 0) return;
    onMark(matches.filter((_, i) => checked.has(i)));
    onClose();
  };

  const total = matches?.length ?? 0;
  const pageCountLabel = `${byPage.length} page${byPage.length === 1 ? '' : 's'}`;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={560}
      destroyOnHidden
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: fontSizes.md }}>
          Find text to redact
        </span>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} style={{ fontFamily: fonts.body }}>
            Cancel
          </Button>
          <Button
            type="primary"
            danger
            disabled={checked.size === 0}
            onClick={handleMark}
            style={{ fontFamily: fonts.body, fontWeight: 600 }}
          >
            {checked.size > 0 ? `Mark ${checked.size} for redaction` : 'Mark for redaction'}
          </Button>
        </div>
      }
      styles={{ body: { fontFamily: fonts.body, paddingTop: 4 } }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <Segmented<Mode>
          block
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: 'words', label: 'Words or phrases' },
            { value: 'patterns', label: 'Patterns' },
          ]}
          style={{ marginBottom: 12 }}
        />

        {mode === 'words' ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Jane Doe, account number"
                prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
                maxLength={200}
                aria-label="Words or phrase to find"
                style={{ flex: 1, fontSize: fontSizes.sm }}
              />
              <Button htmlType="submit" type="primary" loading={searching} disabled={!canSearch}>
                Search
              </Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 8 }}>
              <Checkbox checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)}>
                <Text style={{ fontSize: fontSizes.sm }}>Match case</Text>
              </Checkbox>
              <Checkbox checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)}>
                <Text style={{ fontSize: fontSizes.sm }}>Whole words only</Text>
              </Checkbox>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Select<RedactPattern>
              value={pattern}
              onChange={setPattern}
              options={PATTERN_OPTIONS}
              aria-label="Pattern to find"
              style={{ flex: 1 }}
            />
            <Button htmlType="submit" type="primary" loading={searching}>
              Search
            </Button>
          </div>
        )}
      </form>

      <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textMuted, margin: '10px 0 14px', lineHeight: 1.5 }}>
        Searches the PDF&rsquo;s own text. Text you added in the editor and words inside
        scanned images aren&rsquo;t found &mdash; mark those by drawing over them.
      </Text>

      {searching && !matches && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
          <Spin />
        </div>
      )}

      {matches && (
        <div style={{ opacity: searching ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
          {total === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>
                  Nothing found in this document.
                </Text>
              }
              style={{ padding: '12px 0' }}
            />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ ...S.sectionLabel, marginBottom: 0 }}>
                  {total} match{total === 1 ? '' : 'es'} on {pageCountLabel}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <Button size="small" type="link" onClick={() => toggle(matches.map((_, i) => i), true)} style={{ padding: '0 4px' }}>
                    Select all
                  </Button>
                  <Button size="small" type="link" onClick={() => setChecked(new Set())} style={{ padding: '0 4px' }}>
                    None
                  </Button>
                </span>
              </div>

              {truncated && (
                <Alert
                  type="warning"
                  showIcon
                  message={`Showing the first ${total} matches. Narrow the search to find the rest.`}
                  style={{ marginBottom: 8, fontSize: fontSizes.xs }}
                />
              )}

              <div style={S.results} role="list" aria-label="Matches">
                {byPage.map(([page, indices]) => {
                  const allOn = indices.every((i) => checked.has(i));
                  const someOn = !allOn && indices.some((i) => checked.has(i));
                  return (
                    <div key={page} role="group" aria-label={`Page ${page}`}>
                      <div style={S.pageHeader}>
                        <Checkbox
                          checked={allOn}
                          indeterminate={someOn}
                          onChange={(e) => toggle(indices, e.target.checked)}
                        >
                          <Text strong style={{ fontSize: fontSizes.xs }}>
                            Page {page}
                          </Text>
                        </Checkbox>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => onGoToPage(page)}
                          style={{ padding: 0, fontSize: fontSizes.xs }}
                        >
                          Go to page
                        </Button>
                      </div>
                      {indices.map((i) => (
                        <label key={i} role="listitem" style={S.row}>
                          <Checkbox
                            checked={checked.has(i)}
                            onChange={(e) => toggle([i], e.target.checked)}
                          />
                          <Text
                            ellipsis={{ tooltip: matches[i].text }}
                            style={{ flex: 1, fontSize: fontSizes.sm, color: colors.textPrimary }}
                          >
                            {matches[i].text}
                          </Text>
                          {matches[i].boxes.length > 1 && (
                            <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, flexShrink: 0 }}>
                              {matches[i].boxes.length} lines
                            </Text>
                          )}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default RedactSearchModal;
