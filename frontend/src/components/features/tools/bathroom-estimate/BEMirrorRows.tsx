/**
 * The mirrors on the estimate: each width and how many. Detach & reset is
 * priced per mirror by its width. Rows measured on the plan say so and change
 * there; typed rows change here. A form control (value / onChange).
 */

import React from 'react';
import { Button, InputNumber, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { DEFAULT_MIRROR_WIDTH, type MirrorRow } from './mirrorRows';

const { Text } = Typography;

interface BEMirrorRowsProps {
  value?: MirrorRow[] | null;
  onChange?: (rows: MirrorRow[]) => void;
}

const BEMirrorRows: React.FC<BEMirrorRowsProps> = ({ value, onChange }) => {
  const rows = value ?? [];
  const set = (i: number, patch: Partial<MirrorRow>) =>
    onChange?.(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange?.(rows.filter((_, j) => j !== i));
  const add = () => onChange?.([...rows, { width: DEFAULT_MIRROR_WIDTH, count: 1 }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {rows.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>Size not given: priced as one 36" mirror per vanity</Text>
      )}
      {rows.map((row, i) => {
        const onPlan = !!row.from_sketch;
        return (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <InputNumber
              aria-label="Mirror width"
              size="small"
              style={{ width: 92 }}
              min={6}
              max={240}
              value={row.width}
              disabled={onPlan}
              suffix='" W'
              onChange={(v) => typeof v === 'number' && set(i, { width: v })}
            />
            <InputNumber
              aria-label="How many mirrors"
              size="small"
              style={{ width: 64 }}
              min={1}
              max={20}
              value={row.count}
              disabled={onPlan}
              prefix="×"
              onChange={(v) => typeof v === 'number' && set(i, { count: v })}
            />
            {onPlan ? (
              <Tooltip title="Measured on the sketch. Add, remove or resize it there.">
                <Tag style={{ marginInlineEnd: 0 }}>Sketch</Tag>
              </Tooltip>
            ) : (
              <Button type="text" size="small" icon={<DeleteOutlined />} aria-label="Remove mirror" onClick={() => remove(i)} />
            )}
          </div>
        );
      })}
      {/* With mirrors on the plan, the plan's mirrors are the estimate's: a typed one would go at the next sync */}
      {rows.some((r) => r.from_sketch) ? (
        <Text type="secondary" style={{ fontSize: 12 }}>Add or resize mirrors on the sketch</Text>
      ) : (
        <div>
          <Button type="link" size="small" icon={<PlusOutlined />} style={{ paddingInline: 0 }} onClick={add}>
            Add mirror
          </Button>
        </div>
      )}
    </div>
  );
};

export default BEMirrorRows;
