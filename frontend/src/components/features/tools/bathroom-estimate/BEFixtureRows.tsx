/**
 * Lights or cabinets on the estimate, one row per kind: what it is, how
 * many, and New or D&R. Rows counted from the plan say so and change there;
 * typed rows change here. A form control (value / onChange).
 */

import React from 'react';
import { Button, InputNumber, Radio, Select, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { DEFAULT_BAR_BULBS, type FixtureRow, type ItemAction, type KindInfo } from './fixtureRows';

const { Text } = Typography;

interface BEFixtureRowsProps {
  value?: FixtureRow[] | null;
  onChange?: (rows: FixtureRow[]) => void;
  kinds: KindInfo<string>[];
  /** What the button adds ("light", "cabinet") */
  noun: string;
  /** Room for the longest kind's name */
  typeWidth?: number;
}

const BEFixtureRows: React.FC<BEFixtureRowsProps> = ({ value, onChange, kinds, noun, typeWidth = 180 }) => {
  const rows = value ?? [];
  const set = (i: number, patch: Partial<FixtureRow>) =>
    onChange?.(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange?.(rows.filter((_, j) => j !== i));
  const add = () => onChange?.([...rows, { type: kinds[0].value, count: 1, action: 'replace' }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>None</Text>}
      {rows.map((row, i) => {
        const onPlan = !!row.from_sketch;
        return (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Select
              aria-label={`${noun} type`}
              size="small"
              style={{ width: typeWidth }}
              value={row.type}
              disabled={onPlan}
              options={kinds.map(({ value: v, label }) => ({ value: v, label }))}
              onChange={(t) => set(i, { type: t, bulbs: t === 'vanity_bar' ? (row.bulbs || DEFAULT_BAR_BULBS) : null })}
            />
            {row.type === 'vanity_bar' && (
              <InputNumber
                aria-label="Lights on the bar"
                size="small"
                style={{ width: 84 }}
                min={1}
                max={8}
                value={row.bulbs || DEFAULT_BAR_BULBS}
                disabled={onPlan}
                suffix="-light"
                onChange={(v) => typeof v === 'number' && set(i, { bulbs: v })}
              />
            )}
            <InputNumber
              aria-label="How many"
              size="small"
              style={{ width: 72 }}
              min={1}
              max={50}
              value={row.count}
              disabled={onPlan}
              prefix="×"
              onChange={(v) => typeof v === 'number' && set(i, { count: v })}
            />
            <Radio.Group
              size="small"
              value={row.action ?? 'replace'}
              onChange={(e) => set(i, { action: e.target.value as ItemAction })}
            >
              <Radio.Button value="replace">New</Radio.Button>
              <Radio.Button value="detach_reset">D&R</Radio.Button>
            </Radio.Group>
            {onPlan ? (
              <Tooltip title="Counted from the sketch. Add, remove or change it there.">
                <Tag style={{ marginInlineEnd: 0 }}>Sketch</Tag>
              </Tooltip>
            ) : (
              <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`Remove ${noun}`} onClick={() => remove(i)} />
            )}
          </div>
        );
      })}
      <div>
        <Button type="link" size="small" icon={<PlusOutlined />} style={{ paddingInline: 0 }} onClick={add}>
          Add {noun}
        </Button>
      </div>
    </div>
  );
};

export default BEFixtureRows;
