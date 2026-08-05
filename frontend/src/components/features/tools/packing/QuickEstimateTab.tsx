/**
 * QuickEstimateTab
 * 3-step wizard: Details → Rooms → Review
 * Step 1 uses SharedDetailsStep. Each room card in Step 2 has per-room
 * RoomSpecialItems. Step 3 aggregates per-room special items for the API payload.
 */
import React, { useState } from 'react';
import {
  Steps,
  Button,
  Card,
  Row,
  Col,
  Select,
  Collapse,
  Tag,
  Spin,
  Alert,
  Divider,
  Tooltip,
  message,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  HomeOutlined,
  FileTextOutlined,
  UserOutlined,
  EditOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsNarrow } from '@/hooks/useIsMobile';
import { packingApi } from './packingApi';
import {
  HINT_CATEGORIES,
  DENSITY_OPTIONS,
  FLOOR_OPTIONS,
  CONTAMINATION_OPTIONS,
  SPECIAL_ITEMS,
  PRESET_CATEGORY_ICONS,
  UNIT_HINTS,
  QTY_CHIPS,
  HINT_VOLUME_LEVELS,
  PRESET_CATEGORY_HINTS,
} from './constants';
import { SharedDetailsStep } from './SharedDetailsStep';
import { RoomSpecialItems } from './RoomSpecialItems';
import type {
  PackingRoom,
  PackingSettings,
  ClientInfo,
  CompanyInfoOverride,
  EstimateResponse,
  RoomPreset,
  CustomSpecialItem,
} from './types';

// ── Props ────────────────────────────────────────────────────────────────────

export interface QuickEstimateTabProps {
  presets: Record<string, RoomPreset[]>;
  presetsLoading: boolean;
  rooms: PackingRoom[];
  setRooms: React.Dispatch<React.SetStateAction<PackingRoom[]>>;
  settings: PackingSettings;
  setSettings: React.Dispatch<React.SetStateAction<PackingSettings>>;
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  onEstimateResult: (res: EstimateResponse) => void;
  activeSessionId?: string;
  /** An estimate already exists for this session — calculating again replaces it. */
  hasExistingEstimate?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildRoomFromPreset(preset: RoomPreset): PackingRoom {
  return {
    id: crypto.randomUUID(),
    preset: preset.key,
    floor: '1st',
    density: 'normal',
    hints: [...(preset.default_hints ?? [])],
    hint_volume: {},
    hint_qty: {},
    contamination: 'clean',
    items: [],
    photos: [],
    special_items: [],
    custom_special_items: [],
  };
}

function sizeBadgeColor(size: RoomPreset['size']): string {
  if (size === 'small') return colors.success;
  if (size === 'xlarge') return colors.error;
  return colors.warning;
}

function sizeLabel(size: RoomPreset['size']): string {
  if (size === 'small') return 'S';
  if (size === 'large') return 'L';
  return 'XL';
}

// ── StepRooms ────────────────────────────────────────────────────────────────

/** Step 2 – room preset grid with per-room special items */
const StepRooms: React.FC<{
  presets: Record<string, RoomPreset[]>;
  presetsLoading: boolean;
  rooms: PackingRoom[];
  setRooms: React.Dispatch<React.SetStateAction<PackingRoom[]>>;
}> = ({ presets, presetsLoading, rooms, setRooms }) => {
  const categories = Object.keys(presets);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => categories[0] ?? '');
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [expandedHintKey, setExpandedHintKey] = useState<string | null>(null);

  const addRoom = (preset: RoomPreset) => {
    setRooms((prev) => [...prev, buildRoomFromPreset(preset)]);
    message.success(`Added ${preset.name}`);
  };

  const removeRoom = (id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRoom = (id: string, patch: Partial<PackingRoom>) => {
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const toggleHint = (roomId: string, hint: string) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        const has = r.hints.includes(hint);
        if (has) {
          // Remove hint and clean up qty/volume
          const newQty = { ...r.hint_qty };
          const newVol = { ...r.hint_volume };
          delete newQty[hint];
          delete newVol[hint];
          return {
            ...r,
            hints: r.hints.filter((h) => h !== hint),
            hint_qty: newQty,
            hint_volume: newVol,
          };
        }
        // Add hint with defaults
        const isUnit = UNIT_HINTS.has(hint);
        const isVolume = !isUnit && hint in HINT_VOLUME_LEVELS;
        return {
          ...r,
          hints: [...r.hints, hint],
          hint_qty: isUnit ? { ...r.hint_qty, [hint]: 1 } : r.hint_qty,
          hint_volume: isVolume ? { ...r.hint_volume, [hint]: 1 } : r.hint_volume,
        };
      }),
    );
  };

  const updateHintQty = (roomId: string, hint: string, qty: number) => {
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId ? { ...r, hint_qty: { ...r.hint_qty, [hint]: qty } } : r,
      ),
    );
  };

  const updateHintVolume = (roomId: string, hint: string, levelIdx: number) => {
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId ? { ...r, hint_volume: { ...r.hint_volume, [hint]: levelIdx } } : r,
      ),
    );
  };

  const toggleRoomSpecialItem = (roomId: string, key: string) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        const current = r.special_items ?? [];
        const next = current.includes(key)
          ? current.filter((k) => k !== key)
          : [...current, key];
        return { ...r, special_items: next };
      }),
    );
  };

  const addRoomCustomSpecialItem = (roomId: string, item: CustomSpecialItem) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        return {
          ...r,
          custom_special_items: [...(r.custom_special_items ?? []), item],
        };
      }),
    );
  };

  const removeRoomCustomSpecialItem = (roomId: string, idx: number) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        return {
          ...r,
          custom_special_items: (r.custom_special_items ?? []).filter((_, i) => i !== idx),
        };
      }),
    );
  };

  const allPresets: RoomPreset[] = Object.values(presets).flat();
  const findPreset = (key: string) => allPresets.find((p) => p.key === key);

  if (presetsLoading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center' }}>
        <Spin size="large" tip="Loading room presets..." />
      </div>
    );
  }

  const activeCat = categories.includes(selectedCategory) ? selectedCategory : (categories[0] ?? '');

  return (
    <div>
      {/* ── Preset Picker ────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            fontFamily: fonts.heading,
            fontSize: 16,
            fontWeight: 600,
            color: colors.textPrimary,
            marginBottom: 4,
          }}
        >
          Select Rooms to Pack
        </h3>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
          Click a room type to add it to the estimate.
        </p>

        {/* Category chips row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 12,
          }}
          role="tablist"
          aria-label="Room categories"
        >
          {categories.map((cat) => {
            const isActive = cat === activeCat;
            return (
              <button
                key={cat}
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: borderRadius.full,
                  border: `1.5px solid ${isActive ? colors.primary : colors.border}`,
                  background: isActive ? colors.primary : colors.bgWhite,
                  color: isActive ? '#fff' : colors.textSecondary,
                  fontFamily: fonts.body,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                  lineHeight: 1.4,
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1 }}>
                  {PRESET_CATEGORY_ICONS[cat] ?? ''}
                </span>
                {cat}
              </button>
            );
          })}
        </div>

        {/* Preset grid for active category */}
        <Row gutter={[10, 10]}>
          {(presets[activeCat] ?? []).map((preset) => (
            <Col key={preset.key} xs={12} sm={8} md={6} lg={4}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => addRoom(preset)}
                onKeyDown={(e) => e.key === 'Enter' && addRoom(preset)}
                style={{
                  border: `1.5px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  backgroundColor: colors.bgWhite,
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  overflow: 'hidden',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = colors.primary;
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 2px 8px rgba(0,0,0,0.10)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
                  (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: fonts.heading,
                      fontWeight: 600,
                      fontSize: 12,
                      color: colors.textPrimary,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      minWidth: 0,
                      wordBreak: 'break-word',
                    }}
                  >
                    {preset.name}
                  </span>
                  <Tag
                    style={{
                      margin: 0,
                      fontSize: 10,
                      lineHeight: '16px',
                      padding: '0 5px',
                      borderRadius: borderRadius.sm,
                      border: 'none',
                      background: sizeBadgeColor(preset.size) + '22',
                      color: sizeBadgeColor(preset.size),
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {sizeLabel(preset.size)}
                  </Tag>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </div>

      <Divider style={{ margin: '8px 0 24px' }} />

      {/* ── Added Rooms ──────────────────────────────────── */}
      <div>
        <h3
          style={{
            fontFamily: fonts.heading,
            fontSize: 16,
            fontWeight: 600,
            color: colors.textPrimary,
            marginBottom: 14,
          }}
        >
          Added Rooms
          {rooms.length > 0 && (
            <Tag
              style={{
                marginLeft: 8,
                background: colors.primary + '15',
                color: colors.primary,
                border: 'none',
                borderRadius: borderRadius.full,
                fontWeight: 700,
              }}
            >
              {rooms.length}
            </Tag>
          )}
        </h3>

        {rooms.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <HomeOutlined
              style={{ fontSize: 48, color: colors.textMuted, marginBottom: 16 }}
            />
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: colors.textPrimary,
                marginBottom: 8,
              }}
            >
              No rooms added yet
            </div>
            <div style={{ color: colors.textSecondary }}>
              Click a room type above to add it to your estimate
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rooms.map((room, idx) => {
              const preset = findPreset(room.preset);
              const specialCount =
                (room.special_items?.length ?? 0) + (room.custom_special_items?.length ?? 0);

              return (
                <Card
                  key={room.id}
                  size="small"
                  style={{
                    borderRadius: borderRadius.lg,
                    border: `1.5px solid ${colors.border}`,
                  }}
                  styles={{ body: { padding: '14px 16px' } }}
                >
                  {/* Room header */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontFamily: fonts.heading,
                          fontWeight: 700,
                          fontSize: 15,
                          color: colors.textPrimary,
                        }}
                      >
                        {idx + 1}. {preset?.name ?? room.preset}
                      </span>
                      {preset && (
                        <Tag
                          style={{
                            margin: 0,
                            fontSize: 10,
                            fontWeight: 700,
                            border: 'none',
                            background: sizeBadgeColor(preset.size) + '22',
                            color: sizeBadgeColor(preset.size),
                            borderRadius: borderRadius.sm,
                          }}
                        >
                          {sizeLabel(preset.size)}
                        </Tag>
                      )}
                      {editingRoomId !== room.id && (
                        <>
                          <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                            {FLOOR_OPTIONS.find((o) => o.value === room.floor)?.label ?? room.floor}
                          </Tag>
                          <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                            {room.density.charAt(0).toUpperCase() + room.density.slice(1)}
                          </Tag>
                          {room.contamination !== 'clean' && (
                            <Tag color="warning" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                              {room.contamination.replace('_', ' ')}
                            </Tag>
                          )}
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Tooltip title={editingRoomId === room.id ? 'Done' : 'Edit settings'}>
                        <Button
                          type="text"
                          size="small"
                          icon={editingRoomId === room.id ? <CheckOutlined /> : <EditOutlined />}
                          onClick={() =>
                            setEditingRoomId(editingRoomId === room.id ? null : room.id)
                          }
                          style={{
                            color:
                              editingRoomId === room.id ? colors.success : colors.textMuted,
                          }}
                        />
                      </Tooltip>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        size="small"
                        onClick={() => removeRoom(room.id)}
                        aria-label={`Remove room ${idx + 1}`}
                      />
                    </div>
                  </div>

                  {/* Editable Floor / Density / Contamination */}
                  {editingRoomId === room.id && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 10,
                        marginBottom: 12,
                        padding: '10px 12px',
                        background: colors.bgLight,
                        borderRadius: borderRadius.md,
                      }}
                    >
                      <div style={{ flex: '1 1 140px' }}>
                        <label
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            display: 'block',
                            marginBottom: 2,
                          }}
                        >
                          Floor
                        </label>
                        <Select
                          value={room.floor}
                          onChange={(val) => updateRoom(room.id, { floor: val })}
                          style={{ width: '100%' }}
                          options={FLOOR_OPTIONS}
                        />
                      </div>
                      <div style={{ flex: '1 1 140px' }}>
                        <label
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            display: 'block',
                            marginBottom: 2,
                          }}
                        >
                          Density
                        </label>
                        <Select
                          value={room.density}
                          onChange={(val) => updateRoom(room.id, { density: val })}
                          style={{ width: '100%' }}
                          options={DENSITY_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label,
                          }))}
                        />
                      </div>
                      <div style={{ flex: '1 1 160px' }}>
                        <label
                          style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            display: 'block',
                            marginBottom: 2,
                          }}
                        >
                          Contamination
                        </label>
                        <Select
                          value={room.contamination}
                          onChange={(val) => updateRoom(room.id, { contamination: val })}
                          style={{ width: '100%' }}
                          options={CONTAMINATION_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label,
                          }))}
                        />
                      </div>
                    </div>
                  )}

                  {/* Content Hints collapse */}
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: 'hints',
                        label: (
                          <span
                            style={{
                              fontSize: 14,
                              color: colors.textSecondary,
                              fontWeight: 500,
                            }}
                          >
                            Content Hints{' '}
                            {room.hints.length > 0 && (
                              <Tag
                                style={{
                                  marginLeft: 4,
                                  fontSize: 11,
                                  border: 'none',
                                  background: colors.primary + '15',
                                  color: colors.primary,
                                  borderRadius: borderRadius.full,
                                  fontWeight: 700,
                                }}
                              >
                                {room.hints.length}
                              </Tag>
                            )}
                          </span>
                        ),
                        children: (
                          <div style={{ paddingTop: 6 }}>
                            {Object.entries((() => {
                              const presetCategory = findPreset(room.preset)?.category;
                              const allowed = presetCategory ? PRESET_CATEGORY_HINTS[presetCategory] : undefined;
                              if (!allowed) return HINT_CATEGORIES;
                              return Object.fromEntries(
                                Object.entries(HINT_CATEGORIES)
                                  .map(([cat, catItems]) => [cat, catItems.filter((h) => allowed.includes(h.key))])
                                  .filter(([, catItems]) => (catItems as typeof catItems).length > 0)
                              );
                            })()).map(([cat, items]) => (
                              <div key={cat} style={{ marginBottom: 12 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: colors.textMuted,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em',
                                    marginBottom: 8,
                                  }}
                                >
                                  {cat}
                                </div>
                                <div
                                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                                  role="group"
                                  aria-label={cat}
                                >
                                  {items.map((hint) => {
                                    const active = room.hints.includes(hint.key);
                                    const isUnit = UNIT_HINTS.has(hint.key);
                                    const isVolume = !isUnit && hint.key in HINT_VOLUME_LEVELS;
                                    const volLevels = HINT_VOLUME_LEVELS[hint.key];
                                    const currentQty = room.hint_qty?.[hint.key] ?? 1;
                                    const currentVolIdx = room.hint_volume?.[hint.key] ?? 1;
                                    const currentVol = volLevels?.[currentVolIdx];
                                    const hintExpandKey = `${room.id}:${hint.key}`;
                                    const isExpanded = expandedHintKey === hintExpandKey;
                                    const currentQtyLabel = QTY_CHIPS.find((c) => c.value === currentQty)?.label ?? String(currentQty);

                                    return (
                                      <div key={hint.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <button
                                          role="checkbox"
                                          aria-checked={active}
                                          onClick={() => toggleHint(room.id, hint.key)}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            padding: '4px 10px',
                                            borderRadius: borderRadius.full,
                                            border: `1.5px solid ${
                                              active ? colors.primary : colors.border
                                            }`,
                                            background: active ? colors.primary : colors.bgWhite,
                                            color: active ? '#fff' : colors.textSecondary,
                                            fontFamily: fonts.body,
                                            fontSize: 13,
                                            fontWeight: active ? 600 : 400,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            userSelect: 'none',
                                            lineHeight: 1.4,
                                            flexShrink: 0,
                                          }}
                                        >
                                          <span style={{ fontSize: 14, lineHeight: 1 }}>
                                            {hint.icon}
                                          </span>
                                          {hint.label}
                                        </button>

                                        {/* Unit-based: collapsed badge or expanded chips */}
                                        {active && isUnit && !isExpanded && (
                                          <Tooltip title="Click to change quantity">
                                            <button
                                              onClick={() => setExpandedHintKey(hintExpandKey)}
                                              style={{
                                                minWidth: 24,
                                                height: 22,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: borderRadius.sm,
                                                border: `1.5px solid ${colors.primary}`,
                                                background: colors.primary + '12',
                                                color: colors.primary,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                fontFamily: fonts.body,
                                                cursor: 'pointer',
                                                padding: '0 6px',
                                              }}
                                            >
                                              x{currentQtyLabel}
                                            </button>
                                          </Tooltip>
                                        )}
                                        {active && isUnit && isExpanded && (
                                          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                            {QTY_CHIPS.map((chip) => {
                                              const selected = currentQty === chip.value;
                                              return (
                                                <button
                                                  key={chip.value}
                                                  onClick={() => {
                                                    updateHintQty(room.id, hint.key, chip.value);
                                                    setExpandedHintKey(null);
                                                  }}
                                                  style={{
                                                    width: 28,
                                                    height: 24,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    borderRadius: borderRadius.sm,
                                                    border: `1.5px solid ${selected ? colors.primary : colors.border}`,
                                                    background: selected ? colors.primary : colors.bgWhite,
                                                    color: selected ? '#fff' : colors.textSecondary,
                                                    fontSize: 12,
                                                    fontWeight: selected ? 700 : 400,
                                                    fontFamily: fonts.body,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.12s ease',
                                                    padding: 0,
                                                  }}
                                                >
                                                  {chip.label}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}

                                        {/* Volume-based: collapsed badge or expanded chips */}
                                        {active && isVolume && volLevels && !isExpanded && (
                                          <Tooltip title={currentVol ? `${currentVol.label} (${currentVol.hint}) - Click to change` : 'Click to change'}>
                                            <button
                                              onClick={() => setExpandedHintKey(hintExpandKey)}
                                              style={{
                                                minWidth: 24,
                                                height: 22,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: borderRadius.sm,
                                                border: `1.5px solid ${colors.primary}`,
                                                background: colors.primary + '12',
                                                color: colors.primary,
                                                fontSize: 11,
                                                fontWeight: 700,
                                                fontFamily: fonts.body,
                                                cursor: 'pointer',
                                                padding: '0 6px',
                                              }}
                                            >
                                              {currentVol?.key ?? 'M'}
                                            </button>
                                          </Tooltip>
                                        )}
                                        {active && isVolume && volLevels && isExpanded && (
                                          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                            {volLevels.map((lvl, lvlIdx) => {
                                              const selected = currentVolIdx === lvlIdx;
                                              return (
                                                <Tooltip
                                                  key={lvl.key}
                                                  title={`${lvl.label} (${lvl.hint})`}
                                                >
                                                  <button
                                                    onClick={() => {
                                                      updateHintVolume(room.id, hint.key, lvlIdx);
                                                      setExpandedHintKey(null);
                                                    }}
                                                    style={{
                                                      minWidth: 28,
                                                      height: 24,
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      borderRadius: borderRadius.sm,
                                                      border: `1.5px solid ${selected ? colors.primary : colors.border}`,
                                                      background: selected ? colors.primary : colors.bgWhite,
                                                      color: selected ? '#fff' : colors.textSecondary,
                                                      fontSize: 11,
                                                      fontWeight: selected ? 700 : 400,
                                                      fontFamily: fonts.body,
                                                      cursor: 'pointer',
                                                      transition: 'all 0.12s ease',
                                                      padding: '0 4px',
                                                    }}
                                                  >
                                                    {lvl.key}
                                                  </button>
                                                </Tooltip>
                                              );
                                            })}
                                            {currentVol && (
                                              <span style={{
                                                fontSize: 11,
                                                color: colors.textMuted,
                                                marginLeft: 2,
                                                whiteSpace: 'nowrap',
                                              }}>
                                                {currentVol.label} · {currentVol.hint}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ),
                      },
                    ]}
                  />

                  {/* Special Items collapse (per-room) */}
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: 'special',
                        label: (
                          <span
                            style={{
                              fontSize: 14,
                              color: colors.textSecondary,
                              fontWeight: 500,
                            }}
                          >
                            Special Items{' '}
                            {specialCount > 0 && (
                              <Tag
                                style={{
                                  marginLeft: 4,
                                  fontSize: 11,
                                  border: 'none',
                                  background: colors.primary + '15',
                                  color: colors.primary,
                                  borderRadius: borderRadius.full,
                                  fontWeight: 700,
                                }}
                              >
                                {specialCount}
                              </Tag>
                            )}
                          </span>
                        ),
                        children: (
                          <div style={{ paddingTop: 6 }}>
                            <RoomSpecialItems
                              selectedItems={room.special_items ?? []}
                              customItems={room.custom_special_items ?? []}
                              onToggleItem={(key) => toggleRoomSpecialItem(room.id, key)}
                              onAddCustom={(item) => addRoomCustomSpecialItem(room.id, item)}
                              onRemoveCustom={(i) => removeRoomCustomSpecialItem(room.id, i)}
                            />
                          </div>
                        ),
                      },
                    ]}
                  />
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── StepReview ────────────────────────────────────────────────────────────────

/** Step 3 – review and calculate */
const StepReview: React.FC<{
  rooms: PackingRoom[];
  settings: PackingSettings;
  clientInfo: ClientInfo;
  onEstimateResult: (res: EstimateResponse) => void;
  hasExistingEstimate?: boolean;
}> = ({ rooms, settings, clientInfo, onEstimateResult, hasExistingEstimate }) => {
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Aggregate per-room special items across all rooms
  const aggregatedSpecialItems = [...new Set(rooms.flatMap((r) => r.special_items ?? []))];
  const aggregatedCustomSpecialItems = rooms.flatMap((r) => r.custom_special_items ?? []);

  const runCalculate = async () => {
    if (rooms.length === 0) {
      message.warning('Add at least one room before calculating.');
      return;
    }
    setCalculating(true);
    setError(null);
    try {
      const payload = {
        rooms: rooms.map((r) => ({
          preset: r.preset,
          floor: r.floor,
          density: r.density,
          hints: r.hints,
          contamination: r.contamination,
          hint_volume: r.hint_volume,
          hint_qty: r.hint_qty,
          special_items: r.special_items ?? [],
          custom_special_items: r.custom_special_items ?? [],
        })),
        crew_size: settings.crew_size,
        storage_months: settings.storage_months,
        staging_type: settings.staging_type,
        include_packback: settings.include_packback,
        include_op: settings.include_op,
        op_rate: settings.op_rate,
        material_rate: settings.material_rate ?? 25,
        include_contingency: false,
        contingency_rate: 0,
        region: settings.region,
        special_items: aggregatedSpecialItems,
        custom_special_items: aggregatedCustomSpecialItems,
      };
      const res = await packingApi.quickEstimate(payload);
      onEstimateResult(res);
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { detail?: unknown } } };
      const msg = anyErr?.response?.data?.detail ?? 'Calculation failed. Please try again.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCalculating(false);
    }
  };

  const handleCalculate = () => {
    if (rooms.length === 0) {
      message.warning('Add at least one room before calculating.');
      return;
    }
    if (hasExistingEstimate) {
      Modal.confirm({
        title: 'This will update your existing estimate',
        content: 'Recalculating rebuilds every line from the current rooms. Manual edits made in the Estimate Editor will be replaced.',
        okText: 'Recalculate',
        cancelText: 'Cancel',
        onOk: runCalculate,
      });
    } else {
      runCalculate();
    }
  };

  const statCard = (label: string, value: string | number) => (
    <Card
      size="small"
      style={{
        borderRadius: borderRadius.md,
        border: `1.5px solid ${colors.border}`,
        textAlign: 'center',
        height: '100%',
      }}
      styles={{ body: { padding: '14px 10px', height: '100%', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center' } }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          fontFamily: fonts.heading,
          color: colors.textPrimary,
          lineHeight: 1.3,
          wordBreak: 'keep-all',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{label}</div>
    </Card>
  );

  return (
    <div>
      <h3
        style={{
          fontFamily: fonts.heading,
          fontSize: 16,
          fontWeight: 700,
          color: colors.textPrimary,
          marginBottom: 4,
        }}
      >
        Review &amp; Calculate
      </h3>
      <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 24 }}>
        Confirm your selections below, then click Calculate to generate the estimate.
      </p>

      {/* Summary stat cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 28 }}>
        <Col span={12}>{statCard('Rooms', rooms.length)}</Col>
        <Col span={12}>
          {statCard('Crew Size', `${settings.crew_size} workers`)}
        </Col>
        <Col span={12}>
          {statCard('Staging', settings.staging_type === 'off_site' ? 'Off-site' : 'On-site')}
        </Col>
        <Col span={12}>
          {statCard(
            'Region',
            settings.region
              .replace('_', ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase()),
          )}
        </Col>
      </Row>

      {/* Client + Rooms side by side */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Client info preview */}
        {clientInfo.name && (
          <Card
            size="small"
            style={{
              borderRadius: borderRadius.md,
              border: `1.5px solid ${colors.border}`,
              flex: '1 1 240px',
              minWidth: 240,
            }}
            styles={{ body: { padding: '12px 16px' } }}
          >
            <div
              style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}
            >
              CLIENT
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
              {clientInfo.name}
            </div>
            {clientInfo.property_address && (
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                {clientInfo.property_address}
              </div>
            )}
            {clientInfo.phone && (
              <div style={{ fontSize: 13, color: colors.textSecondary }}>{clientInfo.phone}</div>
            )}
            {clientInfo.email && (
              <div style={{ fontSize: 13, color: colors.textSecondary }}>{clientInfo.email}</div>
            )}
          </Card>
        )}

        {/* Rooms preview list */}
        {rooms.length > 0 && (
          <Card
            size="small"
            style={{
              borderRadius: borderRadius.md,
              border: `1.5px solid ${colors.border}`,
              flex: '1 1 240px',
              minWidth: 240,
            }}
            styles={{ body: { padding: '12px 16px' } }}
          >
            <div
              style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}
            >
              ROOMS ({rooms.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {rooms.map((room, idx) => (
                <Tag
                  key={room.id}
                  style={{
                    borderRadius: borderRadius.sm,
                    fontSize: 12,
                    border: `1px solid ${colors.border}`,
                    background: colors.bgLight,
                    color: colors.textPrimary,
                  }}
                >
                  {idx + 1}. {room.preset}
                </Tag>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Aggregated special items preview */}
      {(aggregatedSpecialItems.length > 0 || aggregatedCustomSpecialItems.length > 0) && (
        <Card
          size="small"
          style={{
            borderRadius: borderRadius.md,
            border: `1.5px solid ${colors.border}`,
            marginBottom: 20,
          }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <div
            style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}
          >
            SPECIAL ITEMS
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {aggregatedSpecialItems.map((key) => {
              const item = SPECIAL_ITEMS.find((s) => s.key === key);
              return (
                <Tag
                  key={key}
                  color="default"
                  style={{ borderRadius: borderRadius.sm, fontSize: 12 }}
                >
                  {item?.label ?? key}
                </Tag>
              );
            })}
            {aggregatedCustomSpecialItems.map((item, idx) => (
              <Tag
                key={idx}
                color="default"
                style={{ borderRadius: borderRadius.sm, fontSize: 12 }}
              >
                {item.name} (${item.price})
              </Tag>
            ))}
          </div>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Alert
          type="error"
          message="Calculation Error"
          description={error}
          showIcon
          style={{ borderRadius: borderRadius.md, marginBottom: 20 }}
          closable
          onClose={() => setError(null)}
        />
      )}

      {rooms.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <HomeOutlined style={{ fontSize: 48, color: colors.textMuted, marginBottom: 16 }} />
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: colors.textPrimary,
              marginBottom: 8,
            }}
          >
            No rooms added
          </div>
          <div style={{ color: colors.textSecondary }}>
            Go back to Step 2 and add at least one room before calculating
          </div>
        </div>
      )}

      {/* Calculate button */}
      <Button
        type="primary"
        size="large"
        icon={<ThunderboltOutlined />}
        onClick={handleCalculate}
        loading={calculating}
        disabled={rooms.length === 0}
        style={{
          width: '100%',
          fontFamily: fonts.heading,
          fontWeight: 700,
          borderRadius: borderRadius.base,
          background: colors.primary,
          borderColor: colors.primary,
        }}
      >
        {calculating ? 'Calculating...' : hasExistingEstimate ? 'Recalculate Estimate' : 'Calculate Estimate'}
      </Button>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const QuickEstimateTab: React.FC<QuickEstimateTabProps> = ({
  presets,
  presetsLoading,
  rooms,
  setRooms,
  settings,
  setSettings,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  onEstimateResult,
  activeSessionId,
  hasExistingEstimate,
}) => {
  const isEditMode = !!activeSessionId;
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    { title: 'Details', description: 'Client & settings', icon: <UserOutlined /> },
    { title: 'Rooms', description: 'Select rooms', icon: <HomeOutlined /> },
    { title: 'Review', description: 'Review & export', icon: <FileTextOutlined /> },
  ];

  const canGoNext = () => {
    if (currentStep === 1) return rooms.length > 0;
    return true;
  };

  const handleNext = () => {
    if (!canGoNext()) {
      message.warning('Add at least one room to continue.');
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const handleStepClick = (idx: number) => {
    if (idx > currentStep && idx === 2 && rooms.length === 0) {
      message.warning('Add at least one room first.');
      return;
    }
    setCurrentStep(idx);
  };

  // ── Edit mode: Rooms (left) + Review (right), stacks on narrow ──────────
  const isNarrow = useIsNarrow();

  if (isEditMode) {
    return (
      <div
        style={{
          width: '100%',
          padding: '20px 16px 32px',
          fontFamily: fonts.body,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: isNarrow ? 'column' : 'row',
          gap: isNarrow ? 0 : 24,
          alignItems: 'flex-start',
        }}
      >
        {/* Rooms - left side */}
        <div style={{ flex: '1 1 0%', minWidth: 0, width: isNarrow ? '100%' : undefined }}>
          <StepRooms
            presets={presets}
            presetsLoading={presetsLoading}
            rooms={rooms}
            setRooms={setRooms}
          />
        </div>

        {isNarrow && <Divider />}

        {/* Review & Calculate - right side (sticky on desktop) */}
        <div
          style={{
            width: isNarrow ? '100%' : 380,
            flexShrink: 0,
            position: isNarrow ? 'relative' : 'sticky',
            top: isNarrow ? undefined : 60,
          }}
        >
          <StepReview
            rooms={rooms}
            settings={settings}
            clientInfo={clientInfo}
            onEstimateResult={onEstimateResult}
            hasExistingEstimate={hasExistingEstimate}
          />
        </div>
      </div>
    );
  }

  // ── Create mode: 3-step wizard ──────────────────────────────────────────

  const stepContent = [
    <SharedDetailsStep
      key="details"
      settings={settings}
      setSettings={setSettings}
      clientInfo={clientInfo}
      setClientInfo={setClientInfo}
      companyOverride={companyOverride}
      setCompanyOverride={setCompanyOverride}
    />,
    <StepRooms
      key="rooms"
      presets={presets}
      presetsLoading={presetsLoading}
      rooms={rooms}
      setRooms={setRooms}
    />,
    <StepReview
      key="review"
      rooms={rooms}
      settings={settings}
      clientInfo={clientInfo}
      onEstimateResult={onEstimateResult}
      hasExistingEstimate={hasExistingEstimate}
    />,
  ];

  return (
    <div
      style={{
        width: '100%',
        padding: '20px 16px 32px',
        fontFamily: fonts.body,
        boxSizing: 'border-box',
      }}
    >
      {/* ── Step Indicator ────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <Steps
          current={currentStep}
          onChange={handleStepClick}
          items={steps.map((s, idx) => ({
            title: (
              <span
                style={{
                  fontFamily: fonts.heading,
                  fontWeight: currentStep === idx ? 700 : 500,
                  fontSize: 13,
                }}
              >
                {s.title}
              </span>
            ),
            description: (
              <span style={{ fontSize: 11, color: colors.textMuted }}>{s.description}</span>
            ),
            icon: s.icon,
          }))}
          size="small"
          style={{ maxWidth: 600 }}
        />
      </div>

      {/* ── Step Content ──────────────────────────────── */}
      <div style={{ minHeight: 300 }}>{stepContent[currentStep]}</div>

      {/* ── Navigation ───────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 32,
          paddingTop: 20,
          borderTop: `1px solid ${colors.border}`,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Button
          size="large"
          onClick={handleBack}
          disabled={currentStep === 0}
          style={{
            minWidth: 100,
            borderRadius: borderRadius.base,
            fontWeight: 600,
          }}
        >
          Back
        </Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {steps.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: idx === currentStep ? 20 : 8,
                height: 8,
                borderRadius: borderRadius.full,
                background: idx === currentStep ? colors.primary : colors.border,
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              }}
              onClick={() => handleStepClick(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleStepClick(idx)}
              aria-label={`Go to step ${idx + 1}: ${steps[idx].title}`}
              aria-current={idx === currentStep ? 'step' : undefined}
            />
          ))}
        </div>

        {currentStep < steps.length - 1 ? (
          <Button
            type="primary"
            size="large"
            onClick={handleNext}
            style={{
              minWidth: 100,
              borderRadius: borderRadius.base,
              fontWeight: 600,
              background: colors.primary,
              borderColor: colors.primary,
            }}
          >
            Next
          </Button>
        ) : (
          <div style={{ minWidth: 100 }} />
        )}
      </div>
    </div>
  );
};
