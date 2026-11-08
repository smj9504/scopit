/**
 * KitchenFinishPicker
 *
 * The 3D view's finish choices (kitchenFinish.ts) behind one toolbar
 * button: cabinet colour and door style, countertop, backsplash, sink,
 * faucet, hardware and floor. The button shows the cabinet and countertop
 * swatches, so the current finish reads at a glance.
 *
 * On an upgrade option, what its chosen products set (productLook.ts) is
 * named instead of offered: change the product to change it.
 */

import React from 'react';
import { Button, Popover, Select, Space } from 'antd';
import { BgColorsOutlined } from '@ant-design/icons';
import type { CabinetSketchFinish } from '@/types/cabinetSketch';
import {
  BACKSPLASHES,
  CABINET_COLORS,
  COUNTERTOPS,
  DOOR_STYLES,
  FAUCETS,
  FLOORS,
  HARDWARE,
  HARDWARE_STYLES,
  SINKS,
  choiceOf,
} from '@/components/features/tools/cabinet-estimate/sketch/kitchenFinish';
import type { FinishChoice } from '@/components/features/tools/cabinet-estimate/sketch/kitchenFinish';

const Swatch: React.FC<{ color: string }> = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 12,
      height: 12,
      borderRadius: 3,
      background: color,
      border: '1px solid rgba(0, 0, 0, 0.18)',
      verticalAlign: -1,
    }}
  />
);

const ROWS: { field: keyof CabinetSketchFinish; label: string; choices: FinishChoice[]; swatches: boolean }[] = [
  { field: 'cabinet_color', label: 'Cabinets', choices: CABINET_COLORS, swatches: true },
  { field: 'door_style', label: 'Doors', choices: DOOR_STYLES, swatches: false },
  { field: 'hardware_style', label: 'Hardware', choices: HARDWARE_STYLES, swatches: false },
  { field: 'hardware', label: 'Hardware finish', choices: HARDWARE, swatches: true },
  { field: 'countertop', label: 'Countertop', choices: COUNTERTOPS, swatches: true },
  { field: 'backsplash', label: 'Backsplash', choices: BACKSPLASHES, swatches: true },
  { field: 'sink', label: 'Sink', choices: SINKS, swatches: true },
  { field: 'faucet', label: 'Faucet', choices: FAUCETS, swatches: true },
  { field: 'floor', label: 'Floor', choices: FLOORS, swatches: true },
];

export interface KitchenFinishPickerProps {
  finish: CabinetSketchFinish;
  onChange: (finish: CabinetSketchFinish) => void;
  /** Finishes an option's chosen product sets, with the product's name. */
  setBy?: Partial<Record<keyof CabinetSketchFinish, string>>;
  /** The finish as drawn, products and all, for the button's swatches. */
  drawn?: CabinetSketchFinish;
}

const KitchenFinishPicker: React.FC<KitchenFinishPickerProps> = ({ finish, onChange, setBy = {}, drawn }) => {
  const content = (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 200px', gap: '8px 12px', alignItems: 'center' }}>
      {ROWS.map(({ field, label, choices, swatches }) => (
        <React.Fragment key={field}>
          <span style={{ color: '#374151', fontSize: 13 }}>{label}</span>
          {setBy[field] ? (
            <span
              title="Set in the Edit tab, by the door style or by the product chosen for this option. Change it there."
              style={{ fontSize: 12, color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {setBy[field]}
            </span>
          ) : (
            <Select
              size="small"
              value={finish[field]}
              onChange={(value: string) => onChange({ ...finish, [field]: value })}
              options={choices.map((c) => ({
                value: c.key,
                label: swatches ? (
                  <Space size={6}>
                    <Swatch color={c.swatch} />
                    {c.label}
                  </Space>
                ) : (
                  c.label
                ),
              }))}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomLeft" title="Finishes" content={content}>
      <Button icon={<BgColorsOutlined />}>
        <Space size={4}>
          <Swatch color={choiceOf(CABINET_COLORS, (drawn ?? finish).cabinet_color).swatch} />
          <Swatch color={choiceOf(COUNTERTOPS, (drawn ?? finish).countertop).swatch} />
          Finishes
        </Space>
      </Button>
    </Popover>
  );
};

export default KitchenFinishPicker;
