/**
 * Scopit - PDF Editor: Redact a PDF
 *
 * The bar under the toolbar while redacting (or while marks are waiting to
 * be applied). Marking is reversible -- marks are just annotations that
 * never reach the export -- until Apply redactions takes what's under them
 * out of the PDF for good, which this confirms first. By default that
 * happens in a new copy, so this document keeps its marks to change and
 * apply again; redacting this document itself is the other choice.
 *
 * Usage:
 *   <RedactBar
 *     active={activeTool === 'redact'}
 *     markCount={marks.length}
 *     documentName={doc.name}
 *     busy={pageOpRunning}
 *     onToggle={() => setActiveTool(...)}
 *     onFindText={() => setSearchOpen(true)}
 *     onMarkPage={markCurrentPage}
 *     onClearMarks={clearMarks}
 *     onApply={(opts) => apply(opts)}
 *   />
 */
import React, { useState } from 'react';
import { App, Button, Checkbox, Radio, Typography } from 'antd';
import { SearchOutlined, FileOutlined } from '@ant-design/icons';
import { RedactIcon } from './Toolbar';
import { colors, fonts, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

const FILLS = [
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
  { value: '#6b7280', label: 'Gray' },
];

export interface RedactApplyOptions {
  fillColor: string;
  removeMetadata: boolean;
  /** Redact into a new document and leave this one as it is, marks and all */
  keepOriginal: boolean;
}

export interface RedactBarProps {
  /** The redact tool is on */
  active: boolean;
  /** Marks waiting in the document */
  markCount: number;
  /** For naming the redacted copy in the confirmation */
  documentName?: string;
  busy: boolean;
  onToggle: () => void;
  onFindText: () => void;
  onMarkPage: () => void;
  onClearMarks: () => void;
  onApply: (options: RedactApplyOptions) => void;
}

/** Where the redactions go, chosen in the confirmation (it lives outside
 * the bar's render, so it keeps its own state and reports each change) */
const ApplyTarget: React.FC<{
  documentName: string;
  onChange: (keepOriginal: boolean) => void;
}> = ({ documentName, onChange }) => {
  const [keepOriginal, setKeepOriginal] = useState(true);
  // Under the label, not in it: the radio would center on both lines
  const hint = { display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, paddingLeft: 24 };
  return (
    <Radio.Group
      value={keepOriginal}
      onChange={(e) => { setKeepOriginal(e.target.value); onChange(e.target.value); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div>
        <Radio value={true}>
          <span style={{ fontWeight: 500 }}>Save as a new document</span>
        </Radio>
        <span style={hint}>
          &ldquo;{documentName.replace(/(\.pdf)?$/i, ' (Redacted)$1')}&rdquo;. This one stays as it is, with what&rsquo;s
          under the marks and the marks themselves, so you can change them and apply again.
        </span>
      </div>
      <div>
        <Radio value={false}>
          <span style={{ fontWeight: 500 }}>Redact this document</span>
        </Radio>
        <span style={hint}>
          What&rsquo;s under the marks isn&rsquo;t kept anywhere. This can&rsquo;t be undone.
        </span>
      </div>
    </Radio.Group>
  );
};

const RedactBar: React.FC<RedactBarProps> = ({
  active,
  markCount,
  documentName = 'Document',
  busy,
  onToggle,
  onFindText,
  onMarkPage,
  onClearMarks,
  onApply,
}) => {
  const { modal } = App.useApp();
  const [fill, setFill] = useState(FILLS[0].value);
  const [removeMetadata, setRemoveMetadata] = useState(false);

  const confirmApply = () => {
    // The dialog's controls keep their own copies; read back on OK
    let chosenFill = fill;
    let chosenMetadata = removeMetadata;
    // Always offered as a copy first: the safe choice
    let chosenKeep = true;
    const okFor = (keep: boolean) => ({
      okText: keep ? 'Save redacted copy' : 'Redact this document',
      okButtonProps: { danger: !keep },
    });
    const confirm = modal.confirm({
      title: `Apply ${markCount} redaction${markCount === 1 ? '' : 's'}?`,
      width: 480,
      ...okFor(chosenKeep),
      content: (
        <div style={{ fontFamily: fonts.body }}>
          <p style={{ margin: '0 0 12px', color: colors.textSecondary }}>
            The text, images and graphics under the marked areas are taken out
            for good, and the areas are filled in.
          </p>
          <div style={{ marginBottom: 14 }}>
            <ApplyTarget
              documentName={documentName}
              onChange={(keep) => { chosenKeep = keep; confirm.update(okFor(keep)); }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Text style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, marginBottom: 4 }}>
              Fill color
            </Text>
            <Radio.Group
              defaultValue={fill}
              onChange={(e) => { chosenFill = e.target.value; }}
              optionType="button"
              size="small"
              options={FILLS.map((f) => ({
                value: f.value,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        background: f.value,
                        border: `1px solid ${colors.borderDark}`,
                        display: 'inline-block',
                      }}
                    />
                    {f.label}
                  </span>
                ),
              }))}
            />
          </div>
          <Checkbox defaultChecked={removeMetadata} onChange={(e) => { chosenMetadata = e.target.checked; }}>
            Also remove document properties (title, author, keywords)
          </Checkbox>
        </div>
      ),
      onOk: () => {
        setFill(chosenFill);
        setRemoveMetadata(chosenMetadata);
        onApply({ fillColor: chosenFill, removeMetadata: chosenMetadata, keepOriginal: chosenKeep });
      },
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Redact"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: active ? colors.errorBg : colors.bgWhite,
        fontFamily: fonts.body,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeights.semibold, fontSize: fontSizes.sm, color: colors.textPrimary }}>
        <span style={{ color: colors.error, display: 'flex' }}><RedactIcon /></span>
        Redact
      </span>
      <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
        {active
          ? 'Drag to mark an area, or click text to mark it.'
          : `${markCount} area${markCount === 1 ? '' : 's'} marked, not yet applied.`}
      </Text>

      {active && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button size="small" icon={<SearchOutlined />} onClick={onFindText} disabled={busy}>
            Find text
          </Button>
          <Button size="small" icon={<FileOutlined />} onClick={onMarkPage} disabled={busy}>
            Mark whole page
          </Button>
        </span>
      )}

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        {active && markCount > 0 && (
          <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
            {markCount} marked
          </Text>
        )}
        {markCount > 0 && (
          <Button size="small" onClick={onClearMarks} disabled={busy}>
            Clear marks
          </Button>
        )}
        <Button size="small" onClick={onToggle} disabled={busy}>
          {active ? 'Done marking' : 'Review marks'}
        </Button>
        <Button
          size="small"
          type="primary"
          danger
          loading={busy}
          disabled={markCount === 0}
          onClick={confirmApply}
        >
          Apply redactions
        </Button>
      </span>
    </div>
  );
};

export default RedactBar;
