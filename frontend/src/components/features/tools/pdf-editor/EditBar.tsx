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
}

const EditBar: React.FC<EditBarProps> = ({ onDone }) => (
  <div
    role="toolbar"
    aria-label="Edit text and images"
    style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 10,
      padding: '8px 12px',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.bgWhite,
      fontFamily: fonts.body,
    }}
  >
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: fontWeights.semibold, fontSize: fontSizes.sm, color: colors.textPrimary }}>
      <FormOutlined /> Edit text &amp; images
    </span>
    <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary }}>
      Click text to type. Drag text or an image to move it, or a corner to resize. Click an image to pick it up.
    </Text>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
      <Button size="small" type="primary" onClick={onDone}>
        Done
      </Button>
    </span>
  </div>
);

export default EditBar;
