/**
 * Scopit - PDF Editor: All tools
 *
 * The document tools in one menu, named and ordered as in Acrobat's Edit
 * panel, so they're easy to find: some switch the editor's tool, others
 * open the page organizer or a dialog (EditorView decides).
 *
 * Usage:
 *   <ToolsMenu onAction={(action) => ...} compact={isMobile} />
 */
import React from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  DownOutlined,
  ExportOutlined,
  FileAddOutlined,
  FormOutlined,
  LockOutlined,
  MergeCellsOutlined,
  RotateRightOutlined,
  ScissorOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { RedactIcon, headerButtonStyle } from './Toolbar';

export type ToolsMenuAction =
  | 'edit'
  | 'combine'
  | 'organize'
  | 'crop'
  | 'reorder'
  | 'rotate'
  | 'insert'
  | 'extract'
  | 'protect'
  | 'redact';

const ITEMS: { key: ToolsMenuAction; label: string; icon: React.ReactNode }[] = [
  { key: 'edit', label: 'Edit text & images', icon: <FormOutlined /> },
  { key: 'combine', label: 'Combine files', icon: <MergeCellsOutlined /> },
  { key: 'organize', label: 'Organize pages', icon: <AppstoreOutlined /> },
  { key: 'crop', label: 'Crop pages', icon: <ScissorOutlined /> },
  { key: 'reorder', label: 'Reorder pages', icon: <SwapOutlined rotate={90} /> },
  { key: 'rotate', label: 'Rotate pages', icon: <RotateRightOutlined /> },
  { key: 'insert', label: 'Insert pages', icon: <FileAddOutlined /> },
  { key: 'extract', label: 'Extract pages', icon: <ExportOutlined /> },
  { key: 'protect', label: 'Protect a PDF', icon: <LockOutlined /> },
  { key: 'redact', label: 'Redact a PDF', icon: <RedactIcon /> },
];

export interface ToolsMenuProps {
  onAction: (action: ToolsMenuAction) => void;
  /** Icon-sized button (mobile) */
  compact?: boolean;
}

const ToolsMenu: React.FC<ToolsMenuProps> = ({ onAction, compact = false }) => {
  const items: MenuProps['items'] = [
    {
      type: 'group',
      label: 'Edit',
      children: ITEMS.map((item) => ({
        key: item.key,
        icon: <span style={{ display: 'inline-flex', width: 14, justifyContent: 'center' }}>{item.icon}</span>,
        label: item.label,
      })),
    },
  ];

  return (
    <Dropdown
      menu={{ items, onClick: ({ key }) => onAction(key as ToolsMenuAction) }}
      trigger={['click']}
      placement="bottomLeft"
    >
      <Button
        size="small"
        icon={<AppstoreOutlined />}
        style={headerButtonStyle}
        aria-label="All tools"
      >
        {!compact && <>All tools <DownOutlined style={{ fontSize: 10 }} /></>}
      </Button>
    </Dropdown>
  );
};

export default ToolsMenu;
