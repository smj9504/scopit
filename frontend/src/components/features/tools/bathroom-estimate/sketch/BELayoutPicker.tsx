/**
 * Start the plan from a common bathroom layout. A layout replaces the whole
 * sketch, so it asks first when something is already drawn.
 */

import React, { useCallback } from 'react';
import { Dropdown, Modal } from 'antd';
import type { BEPoint } from '@/types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { BATHROOM_PRESETS, type BathroomPreset } from './utils/bePresets';

interface BELayoutPickerProps {
  api: BESketchStateAPI;
  /** The button that opens the list */
  children: React.ReactElement;
  /** After the layout is in */
  onApplied?: () => void;
}

const BELayoutPicker: React.FC<BELayoutPickerProps> = ({ api, children, onApplied }) => {
  const apply = useCallback((preset: BathroomPreset) => {
    const ppf = api.data.settings.pixelsPerFoot;
    const offsetX = 60;
    const offsetY = 40;

    api.resetSketch();

    const boundary: BEPoint[] = [
      { x: offsetX, y: offsetY },
      { x: offsetX + preset.widthFt * ppf, y: offsetY },
      { x: offsetX + preset.widthFt * ppf, y: offsetY + preset.depthFt * ppf },
      { x: offsetX, y: offsetY + preset.depthFt * ppf },
    ];
    api.addRoom(boundary, [], 'Bathroom');

    for (const f of preset.fixtures) {
      const pos: BEPoint = { x: offsetX + f.relX * ppf, y: offsetY + f.relY * ppf };
      api.addFixture(f.type, pos, undefined, undefined, f.properties, f.dimensions);
    }

    api.setSelectedId(null);
    api.setActiveTool('select');
    onApplied?.();
  }, [api, onApplied]);

  const pick = useCallback((preset: BathroomPreset) => {
    const d = api.data;
    const hasContent = d.rooms.length > 0 || d.walls.length > 0 || d.fixtures.length > 0;
    if (!hasContent) {
      apply(preset);
      return;
    }
    Modal.confirm({
      title: `Replace the sketch with ${preset.name}?`,
      content: 'Everything drawn now is cleared.',
      okText: 'Replace',
      okButtonProps: { danger: true },
      onOk: () => apply(preset),
    });
  }, [api.data, apply]);

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: BATHROOM_PRESETS.map((p) => ({
          key: p.id,
          label: (
            <span className="bes-mark-option">
              <span>{p.name}</span>
              <span className="bes-mark-option-desc">{p.description}</span>
            </span>
          ),
        })),
        onClick: ({ key }) => {
          const preset = BATHROOM_PRESETS.find((p) => p.id === key);
          if (preset) pick(preset);
        },
      }}
    >
      {children}
    </Dropdown>
  );
};

export default BELayoutPicker;
