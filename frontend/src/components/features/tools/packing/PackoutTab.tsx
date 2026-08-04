/**
 * ScopeIt - Packing Tool: Packout Tab
 * Step-based wizard: Details → Rooms → Job Settings → Calculate
 * Content pack-out estimation with box counts + non-boxable items.
 */

import React, { useState, useCallback } from 'react';
import {
  Steps,
  Card,
  Button,
  Select,
  Input,
  InputNumber,
  Slider,
  Space,
  Tag,
  Switch,
  Tooltip,
  message,
  Typography,
  Row,
  Col,
  Alert,
  Divider,
  Radio,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { packingApi } from './packingApi';
import { SharedDetailsStep } from './SharedDetailsStep';
import {
  DENSITY_OPTIONS,
  FLOOR_OPTIONS,
  CONTAMINATION_OPTIONS,
  REGION_OPTIONS,
} from './constants';
import type {
  PackoutRoom,
  PackoutSettings,
  PackingSettings,
  ClientInfo,
  CompanyInfoOverride,
  EstimateResponse,
  NonBoxableItem,
  NonBoxableType,
  VolumeSize,
  WeightClassType,
  BoxType,
  PhotoRoom,
} from './types';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsNarrow } from '@/hooks/useIsMobile';

const { Text } = Typography;
const { Option } = Select;

// ── Constants ────────────────────────────────────────────────────────────────

const NON_BOXABLE_TYPES: { value: NonBoxableType; label: string }[] = [
  { value: 'furniture_large', label: 'Large Furniture (sofa, bed, table)' },
  { value: 'furniture_medium', label: 'Medium Furniture (dresser, desk)' },
  { value: 'appliance_large', label: 'Large Appliance (fridge, washer)' },
  { value: 'appliance_small', label: 'Small Appliance (microwave, AC)' },
  { value: 'outdoor', label: 'Outdoor (patio, grill, planters)' },
  { value: 'garage', label: 'Garage (tools, workbench)' },
  { value: 'specialty', label: 'Specialty (piano, pool table, safe)' },
  { value: 'sports', label: 'Sports (treadmill, bicycle, kayak)' },
  { value: 'instruments', label: 'Instruments (piano, drums, amp)' },
  { value: 'rugs_art', label: 'Rugs & Art (large artwork, mirrors)' },
  { value: 'custom', label: 'Custom...' },
];

const VOLUME_OPTIONS: { value: VolumeSize; label: string; sf: number }[] = [
  { value: 'small', label: 'Small', sf: 4 },
  { value: 'medium', label: 'Medium', sf: 8 },
  { value: 'large', label: 'Large', sf: 16 },
  { value: 'xlarge', label: 'X-Large', sf: 24 },
];

const WEIGHT_OPTIONS: { value: WeightClassType; label: string; desc: string }[] = [
  { value: 'light', label: 'Light', desc: '' },
  { value: 'moderate', label: 'Moderate', desc: '' },
  { value: 'heavy', label: 'Heavy', desc: '+40% labor (2-person lift)' },
  { value: 'extra_heavy', label: 'Extra Heavy', desc: '+80% labor (equipment)' },
];

const BOX_TYPES: { key: BoxType; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
  { key: 'wardrobe', label: 'Wardrobe' },
  { key: 'picture', label: 'Picture' },
  { key: 'dish_pack', label: 'Dish Pack' },
  { key: 'specialty', label: 'Specialty' },
];

const ROOM_PRESETS = [
  'Living Room', 'Master Bedroom', 'Bedroom', 'Kitchen', 'Dining Room',
  'Bathroom', 'Office', 'Garage', 'Basement', 'Attic', 'Closet', 'Den',
];

const DEFAULT_BOX_COUNTS: Record<BoxType, number> = {
  small: 0, medium: 0, large: 0, wardrobe: 0, picture: 0, dish_pack: 0, specialty: 0,
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeRoom(name = ''): PackoutRoom {
  return {
    id: makeId(),
    room_name: name,
    room_size: 'large',
    floor: '1st',
    density: 'normal',
    contamination: 'clean',
    box_counts: { ...DEFAULT_BOX_COUNTS },
    non_boxable_items: [],
    floor_coverage_pct: 50,
    source_items: [],
    special_items: [],
    custom_special_items: [],
  };
}

function makeNonBoxableItem(): NonBoxableItem {
  return {
    type: 'furniture_medium',
    name: '',
    quantity: 1,
    volume: 'medium',
    weight: 'moderate',
    protection: [],
    needs_disassembly: false,
    needs_crating: false,
  };
}

// ── Props ────────────────────────────────────────────────────────────────────

interface PackoutTabProps {
  packoutRooms: PackoutRoom[];
  setPackoutRooms: React.Dispatch<React.SetStateAction<PackoutRoom[]>>;
  packoutSettings: PackoutSettings;
  setPackoutSettings: React.Dispatch<React.SetStateAction<PackoutSettings>>;
  settings: PackingSettings;
  setSettings: React.Dispatch<React.SetStateAction<PackingSettings>>;
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  onEstimateResult: (res: EstimateResponse) => void;
  photoRooms: PhotoRoom[];
}

// ── Component ────────────────────────────────────────────────────────────────

const PackoutTab: React.FC<PackoutTabProps> = ({
  packoutRooms,
  setPackoutRooms,
  packoutSettings,
  setPackoutSettings,
  settings,
  setSettings,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  onEstimateResult,
  photoRooms,
}) => {
  const isNarrow = useIsNarrow();
  const [step, setStep] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [importing, setImporting] = useState(false);

  const isDetailed = packoutSettings.detail_level === 'detailed';

  // ── Room helpers ─────────────────────────────────────────────────────────

  const addRoom = useCallback((name?: string) => {
    setPackoutRooms(prev => [...prev, makeRoom(name)]);
  }, [setPackoutRooms]);

  const removeRoom = useCallback((id: string) => {
    setPackoutRooms(prev => prev.filter(r => r.id !== id));
  }, [setPackoutRooms]);

  const updateRoom = useCallback((id: string, patch: Partial<PackoutRoom>) => {
    setPackoutRooms(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, [setPackoutRooms]);

  // ── Non-boxable item helpers ────────────────────────────────────────────

  const addNonBoxable = useCallback((roomId: string) => {
    setPackoutRooms(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      return { ...r, non_boxable_items: [...r.non_boxable_items, makeNonBoxableItem()] };
    }));
  }, [setPackoutRooms]);

  const removeNonBoxable = useCallback((roomId: string, idx: number) => {
    setPackoutRooms(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      return { ...r, non_boxable_items: r.non_boxable_items.filter((_, i) => i !== idx) };
    }));
  }, [setPackoutRooms]);

  const updateNonBoxable = useCallback((roomId: string, idx: number, patch: Partial<NonBoxableItem>) => {
    setPackoutRooms(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      const items = [...r.non_boxable_items];
      items[idx] = { ...items[idx], ...patch };
      return { ...r, non_boxable_items: items };
    }));
  }, [setPackoutRooms]);

  // ── Import from Photo AI ────────────────────────────────────────────────

  const handleImportFromPhotoAI = useCallback(async () => {
    if (!photoRooms.length) {
      message.warning('No Photo AI rooms to import');
      return;
    }
    setImporting(true);
    try {
      const newRooms: PackoutRoom[] = [];
      for (const pr of photoRooms) {
        if (!pr.items.length && !pr.analyzed) continue;
        const classification = await packingApi.classifyForPackout(
          pr.items,
          packoutSettings.detail_level,
          pr.room_size || 'large',
        );
        newRooms.push({
          id: makeId(),
          room_name: pr.room_name,
          room_size: (pr.room_size as PackoutRoom['room_size']) || 'large',
          floor: pr.floor,
          density: pr.density,
          contamination: pr.contamination,
          box_counts: classification.box_counts as Record<BoxType, number>,
          non_boxable_items: classification.non_boxable_items || [],
          lump_large_item_count: classification.lump_large_item_count,
          floor_coverage_pct: classification.estimated_floor_coverage_pct,
          source_items: pr.items,
          special_items: pr.special_items || [],
          custom_special_items: pr.custom_special_items || [],
        });
      }
      setPackoutRooms(newRooms);
      message.success(`Imported ${newRooms.length} room(s) from Photo AI`);
    } catch (err: any) {
      message.error('Import failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setImporting(false);
    }
  }, [photoRooms, packoutSettings.detail_level, setPackoutRooms]);

  // ── Calculate ───────────────────────────────────────────────────────────

  const handleCalculate = useCallback(async () => {
    if (!packoutRooms.length) {
      message.warning('Add at least one room');
      return;
    }
    setCalculating(true);
    try {
      const response = await packingApi.packoutEstimate({
        rooms: packoutRooms.map(r => ({
          room_name: r.room_name || 'Unnamed Room',
          room_size: r.room_size,
          floor: r.floor,
          density: r.density,
          contamination: r.contamination,
          box_counts: r.box_counts,
          non_boxable_items: r.non_boxable_items,
          lump_large_item_count: r.lump_large_item_count,
          floor_coverage_pct: r.floor_coverage_pct,
          blanket_override: r.blanket_override,
          source_items: [],
          special_items: r.special_items,
          custom_special_items: r.custom_special_items,
        })),
        detail_level: packoutSettings.detail_level,
        crew_size: packoutSettings.crew_size,
        storage_mode: packoutSettings.storage_mode,
        repair_duration_months: packoutSettings.repair_duration_months,
        on_property_pct: packoutSettings.on_property_pct,
        include_packback: packoutSettings.include_packback,
        include_op: packoutSettings.include_op,
        op_rate: packoutSettings.op_rate,
        include_contingency: packoutSettings.include_contingency,
        contingency_rate: packoutSettings.contingency_rate,
        region: packoutSettings.region,
        special_items: packoutSettings.special_items,
        custom_special_items: packoutSettings.custom_special_items,
      });
      onEstimateResult(response.estimate);
      message.success('Packout estimate calculated');
    } catch (err: any) {
      message.error('Calculation failed: ' + (err?.response?.data?.detail || err?.message || 'Unknown error'));
    } finally {
      setCalculating(false);
    }
  }, [packoutRooms, packoutSettings, onEstimateResult]);

  // ── Render: Step 0 — Details ────────────────────────────────────────────

  const renderDetails = () => (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 13 }}>Estimate Detail Level</Text>
        <div style={{ marginTop: 6 }}>
          <Radio.Group
            value={packoutSettings.detail_level}
            onChange={e => setPackoutSettings(s => ({ ...s, detail_level: e.target.value }))}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'lump_sum', label: 'Lump Sum' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            {isDetailed
              ? 'Itemize each non-boxable item with volume, weight, and protection materials'
              : 'Simple large-item count per room — faster, less granular'}
          </Text>
        </div>
      </div>
      <SharedDetailsStep
        settings={settings}
        setSettings={setSettings}
        clientInfo={clientInfo}
        setClientInfo={setClientInfo}
        companyOverride={companyOverride}
        setCompanyOverride={setCompanyOverride}
      />
    </div>
  );

  // ── Render: Step 1 — Rooms ──────────────────────────────────────────────

  const renderRoomCard = (room: PackoutRoom) => (
    <Card
      key={room.id}
      size="small"
      style={{ marginBottom: 12, borderRadius: borderRadius.card }}
      title={
        <Space>
          <Input
            value={room.room_name}
            onChange={e => updateRoom(room.id, { room_name: e.target.value })}
            placeholder="Room name"
            style={{ width: 180 }}
            size="small"
          />
          <Select size="small" value={room.floor} onChange={v => updateRoom(room.id, { floor: v })} style={{ width: 80 }}>
            {FLOOR_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
          <Select size="small" value={room.density} onChange={v => updateRoom(room.id, { density: v })} style={{ width: 100 }}>
            {DENSITY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
          <Select size="small" value={room.contamination} onChange={v => updateRoom(room.id, { contamination: v })} style={{ width: 110 }}>
            {CONTAMINATION_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </Space>
      }
      extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRoom(room.id)} size="small" />}
    >
      {/* Non-boxable items */}
      {isDetailed ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>Non-Boxable Items</Text>
            <Button size="small" icon={<PlusOutlined />} onClick={() => addNonBoxable(room.id)}>Add Item</Button>
          </div>
          {room.non_boxable_items.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 8px', background: colors.bgLight, borderRadius: borderRadius.base, border: `1px solid ${colors.border}` }}>
              <Select
                size="small"
                value={item.type}
                onChange={v => updateNonBoxable(room.id, idx, { type: v })}
                style={{ width: 200 }}
                options={NON_BOXABLE_TYPES.map(t => ({ value: t.value, label: t.label }))}
              />
              {item.type === 'custom' && (
                <Input
                  size="small"
                  placeholder="Custom type"
                  value={item.custom_type_name || ''}
                  onChange={e => updateNonBoxable(room.id, idx, { custom_type_name: e.target.value })}
                  style={{ width: 130 }}
                />
              )}
              <Input
                size="small"
                placeholder="Item name"
                value={item.name}
                onChange={e => updateNonBoxable(room.id, idx, { name: e.target.value })}
                style={{ width: 140 }}
              />
              <InputNumber
                size="small"
                min={1}
                max={50}
                value={item.quantity}
                onChange={v => updateNonBoxable(room.id, idx, { quantity: v || 1 })}
                style={{ width: 55 }}
              />
              <Select
                size="small"
                value={item.volume}
                onChange={v => updateNonBoxable(room.id, idx, { volume: v })}
                style={{ width: 90 }}
              >
                {VOLUME_OPTIONS.map(o => (
                  <Option key={o.value} value={o.value}>
                    {o.label} ({o.sf}sf)
                  </Option>
                ))}
              </Select>
              <Select
                size="small"
                value={item.weight}
                onChange={v => updateNonBoxable(room.id, idx, { weight: v })}
                style={{ width: 120 }}
              >
                {WEIGHT_OPTIONS.map(o => (
                  <Option key={o.value} value={o.value}>
                    {o.label} {o.desc && <Text type="secondary" style={{ fontSize: 10 }}>{o.desc}</Text>}
                  </Option>
                ))}
              </Select>
              <Tooltip title="Needs disassembly (+0.35 hr)">
                <Switch
                  size="small"
                  checked={item.needs_disassembly}
                  onChange={v => updateNonBoxable(room.id, idx, { needs_disassembly: v })}
                  checkedChildren="Disasm"
                  unCheckedChildren=""
                />
              </Tooltip>
              <Tooltip title="Needs crating (+1.5 hr)">
                <Switch
                  size="small"
                  checked={item.needs_crating}
                  onChange={v => updateNonBoxable(room.id, idx, { needs_crating: v })}
                  checkedChildren="Crate"
                  unCheckedChildren=""
                />
              </Tooltip>
              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNonBoxable(room.id, idx)} />
            </div>
          ))}
          {room.non_boxable_items.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>No non-boxable items added. Click "Add Item" to start.</Text>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 13 }}>Large Items (non-boxable)</Text>
          <div style={{ marginTop: 6 }}>
            <InputNumber
              size="small"
              min={0}
              max={100}
              value={room.lump_large_item_count ?? 0}
              onChange={v => updateRoom(room.id, { lump_large_item_count: v ?? 0 })}
              addonAfter="items"
              style={{ width: 140 }}
            />
          </div>
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      {/* Box counts */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>Boxes</Text>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {BOX_TYPES.map(bt => (
            <div key={bt.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 12, width: 70 }}>{bt.label}</Text>
              <InputNumber
                size="small"
                min={0}
                max={200}
                value={room.box_counts[bt.key] || 0}
                onChange={v => updateRoom(room.id, {
                  box_counts: { ...room.box_counts, [bt.key]: v ?? 0 },
                })}
                style={{ width: 60 }}
              />
            </div>
          ))}
        </div>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* Floor coverage */}
      <div>
        <Text strong style={{ fontSize: 13 }}>Floor Coverage</Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <Slider
            min={0}
            max={100}
            value={room.floor_coverage_pct}
            onChange={v => updateRoom(room.id, { floor_coverage_pct: v })}
            style={{ flex: 1 }}
          />
          <Text style={{ width: 40, textAlign: 'right' }}>{room.floor_coverage_pct}%</Text>
        </div>
      </div>
    </Card>
  );

  const renderRooms = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Select
            placeholder="Add room..."
            style={{ width: 180 }}
            size="small"
            onSelect={(v: string) => addRoom(v)}
            value={undefined}
          >
            {ROOM_PRESETS.map(p => <Option key={p} value={p}>{p}</Option>)}
          </Select>
          <Button size="small" icon={<PlusOutlined />} onClick={() => addRoom('Custom Room')}>
            Custom
          </Button>
        </Space>
        {photoRooms.length > 0 && (
          <Button
            size="small"
            icon={<ImportOutlined />}
            loading={importing}
            onClick={handleImportFromPhotoAI}
          >
            Import from Photo AI
          </Button>
        )}
      </div>

      {packoutRooms.length === 0 && (
        <Alert message="No rooms added yet. Select a room preset or click Custom to start." type="info" showIcon />
      )}

      {packoutRooms.map(renderRoomCard)}
    </div>
  );

  // ── Render: Step 2 — Job Settings ───────────────────────────────────────

  const renderJobSettings = () => (
    <div>
      <Row gutter={[16, 12]}>
        <Col span={isNarrow ? 24 : 12}>
          <Text strong style={{ fontSize: 13 }}>Storage Mode</Text>
          <div style={{ marginTop: 4 }}>
            <Radio.Group
              value={packoutSettings.storage_mode}
              onChange={e => setPackoutSettings(s => ({ ...s, storage_mode: e.target.value }))}
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: 'off_site', label: 'Off-Site Storage' },
                { value: 'on_site', label: 'On-Site (Pod/Container)' },
              ]}
            />
          </div>
        </Col>
        <Col span={isNarrow ? 24 : 12}>
          <Text strong style={{ fontSize: 13 }}>Repair Duration</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Slider
              min={0}
              max={24}
              step={0.5}
              value={packoutSettings.repair_duration_months}
              onChange={v => setPackoutSettings(s => ({ ...s, repair_duration_months: v }))}
              style={{ flex: 1 }}
            />
            <Text style={{ width: 80 }}>{packoutSettings.repair_duration_months} mo</Text>
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Storage period = {Math.ceil(packoutSettings.repair_duration_months)} month{Math.ceil(packoutSettings.repair_duration_months) !== 1 ? 's' : ''}
          </Text>
        </Col>
        <Col span={isNarrow ? 24 : 12}>
          <Text strong style={{ fontSize: 13 }}>On-Property Storage %</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Slider
              min={0}
              max={100}
              value={packoutSettings.on_property_pct}
              onChange={v => setPackoutSettings(s => ({ ...s, on_property_pct: v }))}
              style={{ flex: 1 }}
            />
            <Text style={{ width: 40 }}>{packoutSettings.on_property_pct}%</Text>
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Items staying on-site reduce off-site storage need
          </Text>
        </Col>
        <Col span={isNarrow ? 24 : 12}>
          <Text strong style={{ fontSize: 13 }}>Crew Size</Text>
          <div style={{ marginTop: 4 }}>
            <InputNumber
              min={2}
              max={6}
              value={packoutSettings.crew_size}
              onChange={v => setPackoutSettings(s => ({ ...s, crew_size: v ?? 4 }))}
              size="small"
              addonAfter="crew"
            />
          </div>
        </Col>
        <Col span={isNarrow ? 24 : 12}>
          <Text strong style={{ fontSize: 13 }}>Region</Text>
          <div style={{ marginTop: 4 }}>
            <Select
              size="small"
              value={packoutSettings.region}
              onChange={v => setPackoutSettings(s => ({ ...s, region: v }))}
              style={{ width: 200 }}
            >
              {REGION_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
            </Select>
          </div>
        </Col>
        <Col span={isNarrow ? 24 : 12}>
          <Space direction="vertical" size={4}>
            <Space>
              <Switch
                size="small"
                checked={packoutSettings.include_packback}
                onChange={v => setPackoutSettings(s => ({ ...s, include_packback: v }))}
              />
              <Text style={{ fontSize: 13 }}>Include Pack-Back</Text>
            </Space>
            <Space>
              <Switch
                size="small"
                checked={packoutSettings.include_op}
                onChange={v => setPackoutSettings(s => ({ ...s, include_op: v }))}
              />
              <Text style={{ fontSize: 13 }}>O&P {packoutSettings.include_op && `(${packoutSettings.op_rate}%)`}</Text>
              {packoutSettings.include_op && (
                <InputNumber
                  size="small"
                  min={0}
                  max={30}
                  value={packoutSettings.op_rate}
                  onChange={v => setPackoutSettings(s => ({ ...s, op_rate: v ?? 20 }))}
                  style={{ width: 60 }}
                />
              )}
            </Space>
          </Space>
        </Col>
      </Row>
    </div>
  );

  // ── Step navigation ─────────────────────────────────────────────────────

  const steps = [
    { title: 'Details' },
    { title: 'Rooms' },
    { title: 'Settings' },
  ];

  const canCalculate = packoutRooms.length > 0;

  return (
    <div style={{ padding: isNarrow ? '8px 4px' : '12px 0' }}>
      <Steps
        current={step}
        size="small"
        items={steps}
        style={{ marginBottom: 16 }}
        onChange={setStep}
      />

      {step === 0 && renderDetails()}
      {step === 1 && renderRooms()}
      {step === 2 && renderJobSettings()}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <Button disabled={step === 0} onClick={() => setStep(s => s - 1)}>
          Back
        </Button>
        <Space>
          {step < 2 && (
            <Button type="primary" onClick={() => setStep(s => s + 1)}>
              Next
            </Button>
          )}
          {step === 2 && (
            <Button
              type="primary"
              icon={<CalculatorOutlined />}
              loading={calculating}
              disabled={!canCalculate}
              onClick={handleCalculate}
            >
              Calculate Estimate
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
};

export { PackoutTab };
export default PackoutTab;
