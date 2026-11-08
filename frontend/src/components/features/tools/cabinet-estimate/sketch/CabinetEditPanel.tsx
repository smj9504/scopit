/**
 * One cabinet's settings: which cabinet it is, its specialty, width and
 * height, glass and door pattern, and a slide-in range's finished end
 * panels. Each pick changes the cabinet list's box at once (a row of several
 * splits this one off), so the panel only shows the box and reports the change.
 *
 * It floats on the plan where a cabinet was right-clicked, or, beside the
 * form (`docked`), it is the Inspect panel's view of the selected cabinet.
 */

import React from 'react';
import { Button, Checkbox, InputNumber, Select, Space, Tooltip, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { DoorPattern, SpecialtyType } from '@/types/cabinetEstimate';
import {
  DOOR_PATTERN_OPTIONS,
  PLAIN_DOOR,
  TALL_DOOR_PATTERN_OPTIONS,
  boxChoices,
  cabinetKinds,
  codeForKind,
  hasDoors,
  kindName,
  kindOf,
  specialtyName,
  takesGlass,
  type BoxChange,
  type BoxFields,
  type Catalog,
} from '@/components/features/tools/cabinet-estimate/cabinetBoxChoices';

const { Text } = Typography;

export const EDIT_PANEL_WIDTH = 300;

export interface CabinetEditPanelProps {
  /** The box as it stands. */
  box: BoxFields;
  label: string;
  catalog: Catalog;
  /** The section's cabinet list, grouped as in the toolbar picker. */
  cabinetOptions: { label: string; options: { label: string; value: string }[] }[];
  /** How many cabinets the list's row for it holds; more than one splits this one off. */
  rowQty: number;
  onChange: (change: BoxChange) => void;
  onClose: () => void;
  style?: React.CSSProperties;
  /**
   * Docked in the estimate's side panel instead of floating on the plan:
   * label beside control rows (ce-field), no frame and no close button.
   */
  docked?: boolean;
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const name: React.CSSProperties = { width: 64, flex: 'none', fontSize: 12, color: '#6b7280' };
const fullWidth: React.CSSProperties = { flex: 1, minWidth: 0 };

const CabinetEditPanel: React.FC<CabinetEditPanelProps> = ({
  box,
  label,
  catalog,
  cabinetOptions,
  rowQty,
  onChange,
  onClose,
  style,
  docked = false,
}) => {
  const choices = boxChoices(box.code, catalog);
  const custom = !choices;
  // Cabinet lists each kind once; Width and Height pick its size.
  const kinds = React.useMemo(() => cabinetKinds(cabinetOptions, catalog), [cabinetOptions, catalog]);
  const doors = hasDoors(box.specialty_type);
  const glass = takesGlass(box.cab_type, box.specialty_type);
  const patternOptions = box.cab_type === 'tall' ? TALL_DOOR_PATTERN_OPTIONS : DOOR_PATTERN_OPTIONS;
  const size = docked ? 'middle' : 'small';
  const textSize = docked ? 13 : 12;

  // One setting: beside its label in the panel, in a compact row on the floating panel.
  const field = (fieldLabel: string, control: React.ReactNode) =>
    docked ? (
      <div className="ce-field">
        <span className="ce-field-label">{fieldLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>{control}</div>
      </div>
    ) : (
      <div style={row}>
        <span style={name}>{fieldLabel}</span>
        {control}
      </div>
    );

  const widthControl = custom ? (
    <InputNumber
      size={size}
      aria-label="Width"
      style={fullWidth}
      min={6}
      max={120}
      step={1.5}
      addonAfter='"'
      value={box.width_inches}
      onChange={(v) => v && onChange({ width: v })}
    />
  ) : (
    <Select<string>
      size={size}
      aria-label="Width"
      style={fullWidth}
      value={box.code}
      options={choices!.widths.map((c) => ({ label: c.label, value: c.code }))}
      onChange={(code) => onChange({ code })}
    />
  );
  const heightControl = custom ? (
    <InputNumber
      size={size}
      aria-label="Height"
      style={fullWidth}
      min={6}
      max={120}
      step={1.5}
      addonAfter='"'
      value={box.height_inches}
      onChange={(v) => v && onChange({ height: v })}
    />
  ) : (
    <Select<string>
      size={size}
      aria-label="Height"
      style={fullWidth}
      value={box.code}
      options={choices!.heights.map((c) => ({ label: c.label, value: c.code }))}
      onChange={(code) => onChange({ code })}
    />
  );
  const note =
    rowQty > 1
      ? `Changes this one of the ${rowQty} ${box.code} in the cabinet list; it gets its own row.`
      : 'Changes its row in the cabinet list.';

  return (
    <div
      role={docked ? 'group' : 'dialog'}
      aria-label={`Edit ${label}`}
      // Keep canvas shortcuts (Delete, R) and drags off while working in the panel; Escape closes it.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={
        docked
          ? style
          : {
              position: 'absolute',
              zIndex: 10,
              width: EDIT_PANEL_WIDTH,
              background: '#fff',
              borderRadius: 8,
              boxShadow:
                'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px',
              padding: '10px 12px 4px',
              ...style,
            }
      }
    >
      {!docked && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <Text strong style={{ flex: 1 }} ellipsis>
            {label}
          </Text>
          <Button size="small" type="text" className="ui-icon-btn" icon={<CloseOutlined />} aria-label="Close" onClick={onClose} />
        </div>
      )}

      {field(
        'Cabinet',
        <Select
          size={size}
          aria-label="Cabinet"
          style={fullWidth}
          popupMatchSelectWidth={300}
          showSearch
          value={kindOf(box.code, catalog) ?? undefined}
          placeholder={`Custom ${box.width_inches}"`}
          options={kinds.map((k) => ({ label: k.label, value: k.value, codes: k.codes.join(' ') }))}
          // A box outside the list (an upper off the height filter) still names its kind.
          labelRender={(p) => p.label ?? (catalog[box.code] ? kindName(catalog[box.code]) : p.value)}
          filterOption={(input, option: any) =>
            `${option?.label ?? ''} ${option?.codes ?? ''}`.toLowerCase().includes(input.toLowerCase())
          }
          onChange={(kind: string) => {
            const k = kinds.find((o) => o.value === kind);
            if (k) onChange({ code: codeForKind(k.codes, box, catalog) });
          }}
        />
      )}

      {field(
        'Specialty',
        choices && choices.specialties.length > 1 ? (
          <Select<string>
            size={size}
            aria-label="Specialty"
            style={fullWidth}
            popupMatchSelectWidth={240}
            value={box.code}
            options={choices.specialties.map((s) => ({ label: s.label, value: s.code }))}
            onChange={(code) => onChange({ code })}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: textSize }}>
            {box.specialty_type ? specialtyName(box.specialty_type as SpecialtyType) : 'None'}
            {custom ? ' (custom size)' : ', none other at this size'}
          </Text>
        )
      )}

      {docked ? (
        <>
          {field('Width', widthControl)}
          {field('Height', heightControl)}
        </>
      ) : (
        <div style={row}>
          <span style={name}>Width</span>
          {widthControl}
          <span style={{ ...name, width: 'auto' }}>Height</span>
          {heightControl}
        </div>
      )}

      {doors &&
        field(
          'Door',
          <>
            <Select<DoorPattern | typeof PLAIN_DOOR>
              size={size}
              aria-label="Door pattern"
              style={fullWidth}
              popupMatchSelectWidth={200}
              value={box.door_pattern ?? PLAIN_DOOR}
              options={patternOptions}
              onChange={(v) => onChange({ door_pattern: v === PLAIN_DOOR ? null : v })}
            />
            {glass && (
              <Checkbox checked={box.has_glass_door} onChange={(e) => onChange({ has_glass_door: e.target.checked })}>
                Glass
              </Checkbox>
            )}
          </>
        )}

      {box.specialty_type === 'range_base_slide_in' &&
        field(
          'Panels',
          <>
            <Tooltip title="Finished end panels flanking the range opening">
              <Select<number>
                size={size}
                style={{ width: 64 }}
                aria-label="Panels"
                value={box.range_panel_count ?? 2}
                options={[0, 1, 2].map((n) => ({ label: String(n), value: n }))}
                onChange={(n) => onChange({ range_panel_count: n })}
              />
            </Tooltip>
            <Text type="secondary" style={{ fontSize: textSize, whiteSpace: 'nowrap' }}>
              beside the range
            </Text>
          </>
        )}

      {docked ? (
        <p className="ce-hint-text">{note}</p>
      ) : (
        <Space style={{ marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {note}
          </Text>
        </Space>
      )}
    </div>
  );
};

export default CabinetEditPanel;
