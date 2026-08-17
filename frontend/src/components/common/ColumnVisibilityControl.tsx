/**
 * Scopit - Column visibility toggle for list tables
 */
import React from 'react';
import { Dropdown, Checkbox, Button } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { colors } from '@/styles/theme';

export interface ColumnOption {
  key: string;
  label: string;
}

interface ColumnVisibilityControlProps {
  options: ColumnOption[];
  hiddenKeys: string[];
  onChange: (hiddenKeys: string[]) => void;
}

export const ColumnVisibilityControl: React.FC<ColumnVisibilityControlProps> = ({
  options,
  hiddenKeys,
  onChange,
}) => {
  const toggle = (key: string, checked: boolean) => {
    if (checked) {
      onChange(hiddenKeys.filter((k) => k !== key));
    } else {
      onChange([...hiddenKeys, key]);
    }
  };

  return (
    <Dropdown
      trigger={['click']}
      popupRender={() => (
        <div
          style={{
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: '8px 4px',
            minWidth: 180,
          }}
        >
          <div style={{ padding: '4px 12px 8px', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>
            Show Columns
          </div>
          {options.map((opt) => (
            <div
              key={opt.key}
              style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => toggle(opt.key, hiddenKeys.includes(opt.key))}
            >
              <Checkbox
                checked={!hiddenKeys.includes(opt.key)}
                onChange={(e) => toggle(opt.key, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
              />
              <span style={{ fontSize: 14 }}>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    >
      <Button icon={<SettingOutlined />}>Columns</Button>
    </Dropdown>
  );
};
