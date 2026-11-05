/**
 * Scopit - PDF Editor: Edit text & images
 *
 * The bar under the toolbar while Edit is on. Edit stays on from one change
 * to the next until Done (or another tool, or Esc once nothing is being
 * typed into).
 *
 * Usage:
 *   <EditBar onDone={() => setActiveTool('select')} />
 */
import React from 'react';
import { Button, Typography } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import { colors, fonts, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

export interface EditBarProps {
  onDone: () => void;
  /** A phone: one short line, for a finger (a drag there scrolls the page) */
  compact?: boolean;
  /**
   * The page has no text of its own (a scan or a photo): a click on it has
   * nothing to edit, so say what to use instead
   */
  noText?: boolean;
}

const EditBar: React.FC<EditBarProps> = ({ onDone, compact = false, noText = false }) => (
  <div
    role="toolbar"
    aria-label="Edit text and images"
    style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: compact ? 8 : 10,
      padding: compact ? '6px 12px' : '8px 12px',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.bgWhite,
      fontFamily: fonts.body,
    }}
  >
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeights.semibold, fontSize: fontSizes.sm, color: colors.textPrimary }}>
      <FormOutlined /> {compact ? 'Edit' : 'Edit text & images'}
    </span>
    <Text
      role={noText ? 'status' : undefined}
      style={{
        fontSize: fontSizes.xs,
        // Plain text color: amber at this size doesn't read well enough
        color: noText ? colors.textPrimary : colors.textSecondary,
        fontWeight: noText ? 500 : undefined,
        ...(compact ? { flex: 1, minWidth: 0 } : {}),
      }}
    >
      {noText
        ? (compact
          ? 'No text on this page (a scan). Use Text to type on it.'
          : 'This page is a picture (a scan or photo), so it has no text to edit. Use Text to type on it, or a white Shape to cover something.')
        : compact
          ? 'Tap text to type, or an image to pick it up.'
          : 'Click text to type. Drag text or an image to move it, or a corner to resize. Click an image to pick it up. Drag from an empty spot to select several at once.'}
    </Text>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
      <Button size="small" type="primary" onClick={onDone}>
        Done
      </Button>
    </span>
  </div>
);

export default EditBar;
