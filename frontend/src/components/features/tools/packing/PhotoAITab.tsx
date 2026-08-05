/**
 * ScopeIt - Packing Tool: Photo AI Tab
 * Step-based wizard: Details → Rooms & Photos → Review
 * Photo-based packing estimation using AI room analysis.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Steps,
  Card,
  Button,
  Select,
  Input,
  InputNumber,
  Space,
  Tag,
  Badge,
  Tooltip,
  message,
  Modal,
  Typography,
  Alert,
  Collapse,
  Divider,
  Image,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CameraOutlined,
  ScanOutlined,
  ExclamationCircleOutlined,
  StarOutlined,
  WarningOutlined,
  CalculatorOutlined,
  LoadingOutlined,
  EditOutlined,
  CheckOutlined,
  UserOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  CloseOutlined,
  DownOutlined,
  RightOutlined,
  SwapOutlined,
  UndoOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { packingApi } from './packingApi';
import { FolderImportModal } from './FolderImportModal';
import { useGoogleDrive } from './useGoogleDrive';
import {
  DENSITY_OPTIONS,
  FLOOR_OPTIONS,
  CONTAMINATION_OPTIONS,
  HINT_CATEGORIES,
  UNIT_HINTS,
  QTY_CHIPS,
  HINT_VOLUME_LEVELS,
  PRESET_CATEGORY_ICONS,
} from './constants';
import { ITEM_CATEGORIES } from './types';
import { SharedDetailsStep } from './SharedDetailsStep';
import { RoomSpecialItems } from './RoomSpecialItems';
import type {
  PhotoRoom,
  PackingSettings,
  ClientInfo,
  CompanyInfoOverride,
  EstimateResponse,
  RoomPreset,
  DetectedContentItem,
  CustomSpecialItem,
  BatchAnalysisState,
  BatchRoomEvent,
  BatchCompleteEvent,
} from './types';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsNarrow } from '@/hooks/useIsMobile';

const { Text, Title } = Typography;
const { Option } = Select;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhotoAITabProps {
  presets: Record<string, RoomPreset[]>;
  presetsLoading: boolean;
  photoRooms: PhotoRoom[];
  setPhotoRooms: React.Dispatch<React.SetStateAction<PhotoRoom[]>>;
  settings: PackingSettings;
  setSettings: React.Dispatch<React.SetStateAction<PackingSettings>>;
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  onEstimateResult: (res: EstimateResponse) => void;
  activeSessionId?: string;
  /** An estimate already exists for this session — generating again replaces it. */
  hasExistingEstimate?: boolean;
  /** Explicit save for AI analysis results — draft is never auto-saved. */
  onSavePhotoRooms: () => void;
  photoRoomsDirty: boolean;
  savingPhotoRooms: boolean;
}

// Inline edit state tracks which cell is being edited
interface EditingCell {
  roomId: string;
  itemIndex: number;
  field: 'name' | 'description' | 'size' | 'weight' | 'category' | 'quantity';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Detect floor from room/section name (e.g. "2nd Floor Kitchen" → "2nd") */
function detectFloor(name: string): PhotoRoom['floor'] {
  const lower = name.toLowerCase();
  if (/\bbasement\b|\bbsmt\b|\blower\s*level\b/.test(lower)) return 'basement';
  if (/\b4th|\b4th\s*floor|\bfourth\s*floor|\b5th|\b6th/.test(lower)) return '4th+';
  if (/\b3rd|\b3rd\s*floor|\bthird\s*floor/.test(lower)) return '3rd';
  if (/\b2nd|\b2nd\s*floor|\bsecond\s*floor|\bupstairs\b/.test(lower)) return '2nd';
  if (/\b1st|\b1st\s*floor|\bfirst\s*floor|\bmain\s*(floor|level)\b|\bground\b/.test(lower)) return '1st';
  return '1st';
}

function defaultPhotoRoom(roomName: string, presetId?: string): PhotoRoom {
  return {
    id: generateId(),
    room_name: roomName,
    preset_id: presetId,
    floor: detectFloor(roomName),
    density: 'normal',
    contamination: 'clean',
    photos: [],
    photo_keys: [],
    items: [],
    low_confidence_items: [],
    dismissed_items: [],
    analyzed: false,
    analyzing: false,
    field_notes: [],
    special_items: [],
    custom_special_items: [],
    usePreset: false,
    preset: undefined,
    hints: [],
    hint_volume: {},
    hint_qty: {},
  };
}

/** Convert File to base64 string (data URI stripped) */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Build a data URI for displaying a base64 image */
function toDataUri(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

function confidenceColor(score?: number): string {
  if (!score) return colors.textMuted;
  if (score >= 0.8) return colors.success;
  if (score >= 0.6) return colors.warning;
  return colors.error;
}

function confidenceLabel(score?: number): string {
  if (!score) return 'Not analyzed';
  return `${Math.round(score * 100)}% confidence`;
}

// ── Add Room Panel (used in Step 2) ─────────────────────────────────────────

interface AddRoomPanelProps {
  presets: Record<string, RoomPreset[]>;
  presetsLoading: boolean;
  onAddRoom: (room: PhotoRoom) => void;
}

const AddRoomPanel: React.FC<AddRoomPanelProps> = ({ presets, presetsLoading, onAddRoom }) => {
  const [expanded, setExpanded] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(undefined);
  const [customName, setCustomName] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const addFileRef = useRef<HTMLInputElement>(null);

  const allPresets: RoomPreset[] = Object.values(presets).flat();

  const handleFilesSelected = useCallback(async (files: FileList) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;
    const base64List = await Promise.all(fileArray.map(fileToBase64));
    setPendingPhotos((prev) => [...prev, ...base64List]);
  }, []);

  const handleAdd = () => {
    const roomName = useCustom
      ? customName.trim()
      : allPresets.find((p) => p.key === selectedPreset)?.name ?? '';

    if (!roomName) {
      message.warning('Please select or enter a room name.');
      return;
    }
    if (pendingPhotos.length === 0) {
      message.warning('Please upload at least one photo.');
      return;
    }

    const room = defaultPhotoRoom(roomName, useCustom ? undefined : selectedPreset);
    room.photos = [...pendingPhotos];
    onAddRoom(room);

    // Reset and collapse
    setSelectedPreset(undefined);
    setCustomName('');
    setPendingPhotos([]);
    setExpanded(false);
  };

  // ── Collapsed: single dashed trigger row ──
  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 16px',
          border: `1.5px dashed ${colors.border}`,
          borderRadius: borderRadius.lg,
          cursor: 'pointer',
          background: colors.bgWhite,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = colors.primary;
          (e.currentTarget as HTMLDivElement).style.background = colors.primary + '06';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
          (e.currentTarget as HTMLDivElement).style.background = colors.bgWhite;
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(true)}
      >
        <PlusOutlined style={{ fontSize: 14, color: colors.textMuted }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: colors.textSecondary, fontFamily: fonts.body }}>
          Add a room...
        </span>
      </div>
    );
  }

  // ── Expanded: compact 2-row form ──
  return (
    <div
      style={{
        border: `1.5px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: '12px 14px',
        marginBottom: 12,
        background: colors.bgWhite,
      }}
    >
      {/* Row 1: Room name + preset/custom toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {useCustom ? (
            <Input
              placeholder="Room name (e.g. Master Bedroom)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onPressEnter={handleAdd}
              size="middle"
            />
          ) : (
            <Select
              placeholder={presetsLoading ? 'Loading...' : 'Select a room'}
              loading={presetsLoading}
              value={selectedPreset}
              onChange={setSelectedPreset}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              size="middle"
            >
              {Object.entries(presets).map(([category, list]) => (
                <Select.OptGroup key={category} label={category}>
                  {list.map((p) => (
                    <Option key={p.key} value={p.key} label={p.name}>
                      {p.name}
                    </Option>
                  ))}
                </Select.OptGroup>
              ))}
            </Select>
          )}
        </div>
        <button
          onClick={() => setUseCustom((v) => !v)}
          style={{
            fontSize: 12,
            fontFamily: fonts.body,
            color: colors.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: 500,
            padding: '4px 0',
            flexShrink: 0,
          }}
        >
          {useCustom ? 'Preset' : 'Custom'}
        </button>
        <button
          onClick={() => {
            setExpanded(false);
            setPendingPhotos([]);
            setSelectedPreset(undefined);
            setCustomName('');
          }}
          style={{
            fontSize: 16,
            color: colors.textMuted,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 0',
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Row 2: Photo upload + Add button */}
      {pendingPhotos.length === 0 ? (
        /* Empty state: wide upload zone */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            onClick={() => addFileRef.current?.click()}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px 16px',
              border: `1.5px dashed ${colors.border}`,
              borderRadius: borderRadius.base,
              cursor: 'pointer',
              background: colors.bgLight,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = colors.primary;
              (e.currentTarget as HTMLDivElement).style.background = colors.primary + '06';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
              (e.currentTarget as HTMLDivElement).style.background = colors.bgLight;
            }}
          >
            <CameraOutlined style={{ fontSize: 16, color: colors.textMuted }} />
            <span style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.body }}>
              Upload room photos
            </span>
          </div>
          <input
            ref={addFileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFilesSelected(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            disabled
            style={{ flexShrink: 0, fontWeight: 600, fontSize: 13 }}
          >
            Add
          </Button>
        </div>
      ) : (
        /* Has photos: thumbnails + add more + submit */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
            <Image.PreviewGroup>
            {pendingPhotos.map((b64, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 44,
                  borderRadius: borderRadius.sm,
                  overflow: 'hidden',
                  border: `1px solid ${colors.border}`,
                  flexShrink: 0,
                }}
              >
                <Image
                  src={toDataUri(b64)}
                  alt={`Photo ${i + 1}`}
                  width={44}
                  height={44}
                  style={{ objectFit: 'cover', display: 'block' }}
                  preview={{ mask: false }}
                />
                <button
                  onClick={() => setPendingPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    position: 'absolute',
                    top: 1,
                    right: 1,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    fontSize: 9,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </div>
            ))}
            </Image.PreviewGroup>
            <div
              onClick={() => addFileRef.current?.click()}
              style={{
                width: 44,
                height: 44,
                borderRadius: borderRadius.sm,
                border: `1px dashed ${colors.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: colors.bgLight,
                flexShrink: 0,
              }}
            >
              <PlusOutlined style={{ fontSize: 13, color: colors.textMuted }} />
            </div>
          </div>
          <input
            ref={addFileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFilesSelected(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            style={{
              background: colors.primary,
              borderColor: colors.primary,
              flexShrink: 0,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Add ({pendingPhotos.length})
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Inline-Editable Item Row ────────────────────────────────────────────────

const ITEM_ROW_GRID = '1fr 60px 108px 100px 40px 30px';

interface ItemRowProps {
  item: DetectedContentItem;
  roomId: string;
  itemIndex: number;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onCommitEdit: (roomId: string, itemIndex: number, field: EditingCell['field'], value: string | number) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

const ItemRow: React.FC<ItemRowProps> = ({
  item,
  roomId,
  itemIndex,
  editingCell,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
}) => {
  const [editValue, setEditValue] = useState<string | number>('');
  const isEditing = (field: EditingCell['field']) =>
    editingCell?.roomId === roomId &&
    editingCell?.itemIndex === itemIndex &&
    editingCell?.field === field;

  const startEdit = (field: EditingCell['field']) => {
    const initial =
      field === 'name' ? item.name
      : field === 'description' ? (item.description || '')
      : field === 'size' ? (item.size || 'M')
      : field === 'weight' ? (item.weight || 'medium')
      : field === 'category' ? item.category
      : item.quantity;
    setEditValue(initial);
    onStartEdit({ roomId, itemIndex, field });
  };

  const commit = (field: EditingCell['field']) => {
    onCommitEdit(roomId, itemIndex, field, editValue);
  };

  const cellStyle: React.CSSProperties = {
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: borderRadius.sm,
    transition: 'background 0.15s',
  };

  return (
    <div
      className="pai-item-row"
      style={{
        display: 'grid',
        gridTemplateColumns: ITEM_ROW_GRID,
        gap: 8,
        alignItems: 'center',
        padding: '9px 8px',
        borderBottom: `1px solid ${colors.border}`,
        fontSize: 12,
        fontFamily: fonts.body,
      }}
    >
      {/* Name */}
      {isEditing('name') ? (
        <Input
          size="small"
          value={editValue as string}
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onPressEnter={() => commit('name')}
          onBlur={() => commit('name')}
          onKeyDown={(e) => e.key === 'Escape' && onCancelEdit()}
          style={{ fontSize: 12, height: 24 }}
        />
      ) : (
        <div
          style={{ ...cellStyle, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, cursor: 'pointer' }}
          onClick={() => startEdit('name')}
          title="Click to edit"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.textPrimary }}>
              {item.name}
            </span>
            {item.is_high_value && (
              <Tooltip title="High value">
                <StarOutlined style={{ color: colors.warning, fontSize: 11, flexShrink: 0 }} />
              </Tooltip>
            )}
            {item.is_fragile && (
              <Tooltip title="Fragile">
                <WarningOutlined style={{ color: colors.error, fontSize: 11, flexShrink: 0 }} />
              </Tooltip>
            )}
          </div>
          {item.description && (
            <Tooltip title={item.description}>
              <div style={{ marginTop: 2, fontSize: 10, color: colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.description}
              </div>
            </Tooltip>
          )}
        </div>
      )}

      {/* Size */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {isEditing('size') ? (
          <Select
            size="small"
            value={editValue as string}
            autoFocus
            open
            onChange={(v) => { setEditValue(v); onCommitEdit(roomId, itemIndex, 'size', v); }}
            onBlur={() => onCancelEdit()}
            style={{ width: '100%' }}
            popupMatchSelectWidth={false}
            dropdownStyle={{ minWidth: 90 }}
            onClick={(e) => e.stopPropagation()}
          >
            {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => <Option key={s} value={s}>{s}</Option>)}
          </Select>
        ) : (
          <Tag
            style={{ margin: 0, cursor: 'pointer' }}
            onClick={() => startEdit('size')}
            title="Size class (click to change)"
          >
            {item.size || 'M'}
          </Tag>
        )}
      </div>

      {/* Weight */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {isEditing('weight') ? (
          <Select
            size="small"
            value={editValue as string}
            autoFocus
            open
            onChange={(v) => { setEditValue(v); onCommitEdit(roomId, itemIndex, 'weight', v); }}
            onBlur={() => onCancelEdit()}
            style={{ width: '100%' }}
            popupMatchSelectWidth={false}
            dropdownStyle={{ minWidth: 140 }}
            onClick={(e) => e.stopPropagation()}
          >
            {[['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy'], ['extra_heavy', 'Extra Heavy']].map(([k, l]) => <Option key={k} value={k}>{l}</Option>)}
          </Select>
        ) : (
          <Tag
            color={item.weight === 'heavy' || item.weight === 'extra_heavy' ? 'warning' : 'default'}
            style={{ margin: 0, cursor: 'pointer' }}
            onClick={() => startEdit('weight')}
            title="Weight class (click to change)"
          >
            {(item.weight || 'medium').replace('_', ' ')}
          </Tag>
        )}
      </div>

      {/* Category */}
      {isEditing('category') ? (
        <Select
          size="small"
          value={editValue as string}
          autoFocus
          open
          onChange={(v) => {
            setEditValue(v);
            onCommitEdit(roomId, itemIndex, 'category', v);
          }}
          onBlur={() => onCancelEdit()}
          style={{ width: '100%' }}
          popupMatchSelectWidth={false}
          dropdownStyle={{ minWidth: 160 }}
        >
          {ITEM_CATEGORIES.map((cat) => (
            <Option key={cat} value={cat}>
              {cat}
            </Option>
          ))}
        </Select>
      ) : (
        <Tag
          color="default"
          style={{ cursor: 'pointer', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
          onClick={() => startEdit('category')}
          title="Click to edit"
        >
          {item.category || 'Other'}
        </Tag>
      )}

      {/* Quantity */}
      {isEditing('quantity') ? (
        <InputNumber
          size="small"
          min={1}
          value={editValue as number}
          autoFocus
          onChange={(v) => setEditValue(v ?? 1)}
          onPressEnter={() => commit('quantity')}
          onBlur={() => commit('quantity')}
          onKeyDown={(e) => e.key === 'Escape' && onCancelEdit()}
          style={{ width: '100%', fontSize: 12 }}
        />
      ) : (
        <div
          style={{ ...cellStyle, textAlign: 'center', color: colors.textSecondary }}
          onClick={() => startEdit('quantity')}
          title="Click to edit"
        >
          x{item.quantity}
        </div>
      )}

      {/* Delete */}
      <Button
        type="text"
        size="small"
        icon={<DeleteOutlined />}
        danger
        onClick={onDelete}
        style={{ padding: '0 4px', height: 24 }}
        aria-label={`Delete ${item.name}`}
      />
    </div>
  );
};

// ── Room Card ───────────────────────────────────────────────────────────────

interface RoomCardProps {
  room: PhotoRoom;
  presets: Record<string, RoomPreset[]>;
  editingCell: EditingCell | null;
  onUpdate: (id: string, updates: Partial<PhotoRoom>) => void;
  onDelete: (id: string) => void;
  onAnalyze: (id: string) => void;
  onCancelAnalyze: (id: string) => void;
  onStartEdit: (cell: EditingCell) => void;
  onCommitEdit: (roomId: string, itemIndex: number, field: EditingCell['field'], value: string | number) => void;
  onCancelEdit: () => void;
  onAddPhoto: (id: string, files: FileList) => void;
  onRemovePhoto: (id: string, index: number) => void;
  onAddItem: (id: string) => void;
  onDeleteItem: (roomId: string, itemIndex: number) => void;
  analysisFailed?: boolean;
}

const RoomCard: React.FC<RoomCardProps> = ({
  room,
  presets,
  editingCell,
  onUpdate,
  onDelete,
  onAnalyze,
  onCancelAnalyze,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onAddPhoto,
  onRemovePhoto,
  onAddItem,
  onDeleteItem,
  analysisFailed,
}) => {
  const isNarrow = useIsNarrow();
  const [editingAttrs, setEditingAttrs] = useState(false);
  const [itemsCollapsed, setItemsCollapsed] = useState(false);
  const [expandedHintKey, setExpandedHintKey] = useState<string | null>(null);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  // Blob URLs for storage-backed photos (fetched with auth)
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);

  // Load storage photos in parallel (all at once — browser handles concurrency)
  useEffect(() => {
    const keys = room.photo_keys ?? [];
    if (room.photos.length > 0 || keys.length === 0 || loadingRef.current) return;
    loadingRef.current = true;

    keys.forEach((key) => {
      packingApi.fetchPhotoBlobUrl(key).then((url) => {
        setBlobUrls((prev) => ({ ...prev, [key]: url }));
      }).catch(() => {
        setFailedKeys((prev) => new Set(prev).add(key));
      });
    });
  }, [room.photo_keys, room.photos.length]);

  const allPresets: RoomPreset[] = Object.values(presets).flat();

  const totalLaborHours = room.items.reduce((sum, item) => sum + (item.estimated_labor_hours ?? 0), 0);
  const fragileCount = room.items.filter((i) => i.is_fragile).length;
  const specialItemCount = room.special_items.length + room.custom_special_items.length;

  // Preset mode handlers
  const handleTogglePresetMode = useCallback(() => {
    onUpdate(room.id, { usePreset: !room.usePreset });
  }, [room.id, room.usePreset, onUpdate]);

  const handlePresetSelect = useCallback(
    (presetKey: string) => {
      const preset = allPresets.find((p) => p.key === presetKey);
      onUpdate(room.id, {
        preset: presetKey,
        hints: [...(preset?.default_hints ?? [])],
        hint_volume: {},
        hint_qty: {},
      });
    },
    [room.id, allPresets, onUpdate],
  );

  const handleToggleHint = useCallback(
    (hint: string) => {
      const has = room.hints.includes(hint);
      if (has) {
        const newQty = { ...room.hint_qty };
        const newVol = { ...room.hint_volume };
        delete newQty[hint];
        delete newVol[hint];
        onUpdate(room.id, {
          hints: room.hints.filter((h) => h !== hint),
          hint_qty: newQty,
          hint_volume: newVol,
        });
      } else {
        const isUnit = UNIT_HINTS.has(hint);
        const isVolume = !isUnit && hint in HINT_VOLUME_LEVELS;
        onUpdate(room.id, {
          hints: [...room.hints, hint],
          hint_qty: isUnit ? { ...room.hint_qty, [hint]: 1 } : room.hint_qty,
          hint_volume: isVolume ? { ...room.hint_volume, [hint]: 1 } : room.hint_volume,
        });
      }
    },
    [room.id, room.hints, room.hint_qty, room.hint_volume, onUpdate],
  );

  const handleHintQty = useCallback(
    (hint: string, qty: number) => {
      onUpdate(room.id, { hint_qty: { ...room.hint_qty, [hint]: qty } });
    },
    [room.id, room.hint_qty, onUpdate],
  );

  const handleHintVolume = useCallback(
    (hint: string, levelIdx: number) => {
      onUpdate(room.id, { hint_volume: { ...room.hint_volume, [hint]: levelIdx } });
    },
    [room.id, room.hint_volume, onUpdate],
  );

  const handleToggleSpecialItem = useCallback(
    (key: string) => {
      const current = room.special_items;
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
      onUpdate(room.id, { special_items: next });
    },
    [room.id, room.special_items, onUpdate],
  );

  const handleAddCustomSpecialItem = useCallback(
    (item: CustomSpecialItem) => {
      onUpdate(room.id, { custom_special_items: [...room.custom_special_items, item] });
    },
    [room.id, room.custom_special_items, onUpdate],
  );

  const handleRemoveCustomSpecialItem = useCallback(
    (idx: number) => {
      onUpdate(room.id, {
        custom_special_items: room.custom_special_items.filter((_, i) => i !== idx),
      });
    },
    [room.id, room.custom_special_items, onUpdate],
  );

  return (
    <Card
      size="small"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${
          analysisFailed
            ? colors.error + '55'
            : (room.analyzed || (room.usePreset && room.preset))
              ? colors.success + '55'
              : colors.border
        }`,
        marginBottom: 12,
        width: '100%',
      }}
      bodyStyle={{ padding: 0 }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
            {editingAttrs ? (
              <Input
                size="small"
                variant="borderless"
                value={room.room_name}
                onChange={(e) => onUpdate(room.id, { room_name: e.target.value })}
                style={{
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  fontSize: 14,
                  width: 180,
                  padding: '0 2px 2px',
                  borderRadius: 0,
                  borderBottom: `1.5px solid ${colors.primary}`,
                }}
                autoFocus
              />
            ) : (
              <span
                style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                onClick={() => setEditingAttrs(true)}
                title="Click to rename"
              >
                {room.room_name}
              </span>
            )}
            {!editingAttrs && (
              <>
                <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>{room.floor}</Tag>
                <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>{room.density}</Tag>
                {room.contamination !== 'clean' && (
                  <Tag color="warning" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                    {room.contamination.replace('_', ' ')}
                  </Tag>
                )}
              </>
            )}
            {room.analyzed && (
              <Badge
                count={confidenceLabel(room.confidence_score)}
                style={{
                  backgroundColor: confidenceColor(room.confidence_score),
                  fontSize: 10,
                  height: 18,
                  lineHeight: '18px',
                  padding: '0 6px',
                  borderRadius: 9,
                  whiteSpace: 'nowrap',
                }}
              />
            )}
            {room.usePreset && (
              <Tag style={{ margin: 0, fontSize: 10, borderRadius: 4, border: 'none', background: colors.primary + '15', color: colors.primary, fontWeight: 600 }}>
                Preset
              </Tag>
            )}
            {room.analyzing && <LoadingOutlined style={{ fontSize: 14, color: colors.info }} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip title={editingAttrs ? 'Done editing' : 'Edit room settings'}>
              <Button
                type="text"
                size="small"
                icon={editingAttrs ? <CheckOutlined /> : <EditOutlined />}
                onClick={() => setEditingAttrs((v) => !v)}
                style={{ color: editingAttrs ? colors.success : colors.textMuted }}
              />
            </Tooltip>
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              danger
              onClick={() => onDelete(room.id)}
              aria-label={`Delete room ${room.room_name}`}
            />
          </div>
        </div>
      }
    >
      <div style={{ padding: '12px 16px' }}>
        {/* Editable attributes */}
        {editingAttrs && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 20,
              marginBottom: 16,
              paddingTop: 12,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ flex: '1 1 120px' }}>
              <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.body, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Floor</span>
              <Select
                size="small"
                variant="borderless"
                value={room.floor}
                onChange={(v) => onUpdate(room.id, { floor: v })}
                style={{ width: '100%' }}
                disabled={room.analyzing}
              >
                {FLOOR_OPTIONS.map((o) => (
                  <Option key={o.value} value={o.value}>{o.label}</Option>
                ))}
              </Select>
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.body, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Density</span>
              <Select
                size="small"
                variant="borderless"
                value={room.density}
                onChange={(v) => onUpdate(room.id, { density: v })}
                style={{ width: '100%' }}
                disabled={room.analyzing}
              >
                {DENSITY_OPTIONS.map((o) => (
                  <Option key={o.value} value={o.value}>{o.label}</Option>
                ))}
              </Select>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.body, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Contamination</span>
              <Select
                size="small"
                variant="borderless"
                value={room.contamination}
                onChange={(v) => onUpdate(room.id, { contamination: v })}
                style={{ width: '100%' }}
                disabled={room.analyzing}
              >
                {CONTAMINATION_OPTIONS.map((o) => (
                  <Option key={o.value} value={o.value}>{o.label}</Option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {/* ── Two-column layout (desktop) / stacked (mobile) ── */}
        {(() => {
          const hasBase64 = room.photos.length > 0;
          const photoKeys = room.photo_keys ?? [];
          const photoCount = hasBase64 ? room.photos.length : photoKeys.length;
          const photoSrcs = Array.from({ length: photoCount }, (_, i) =>
            hasBase64 ? toDataUri(room.photos[i]) : (blobUrls[photoKeys[i]] ?? ''),
          );
          const safeIdx = photoCount > 0 ? Math.min(selectedPhotoIdx, photoCount - 1) : 0;
          const mainSrc = photoSrcs[safeIdx] ?? '';
          const hasItems = !room.usePreset && (room.analyzed || room.items.length > 0);

          // ── Photo column content ──
          const photoColumn = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Main photo preview (inline, not modal) */}
              {photoCount > 0 && !isNarrow && (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '4/3',
                    borderRadius: borderRadius.md,
                    overflow: 'hidden',
                    border: `1px solid ${colors.border}`,
                    background: '#f5f5f5',
                    position: 'relative',
                  }}
                >
                  {mainSrc ? (
                    <img
                      src={mainSrc}
                      alt={`Photo ${(selectedPhotoIdx || 0) + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: colors.bgLight, gap: 4 }}>
                      {failedKeys.has(photoKeys[safeIdx]) ? (
                        <>
                          <CameraOutlined style={{ fontSize: 24, color: colors.textMuted }} />
                          <span style={{ fontSize: 11, color: colors.textMuted }}>Photo unavailable</span>
                        </>
                      ) : (
                        <>
                          <LoadingOutlined style={{ fontSize: 24, color: colors.textMuted }} />
                          <span style={{ fontSize: 11, color: colors.textMuted }}>Loading...</span>
                        </>
                      )}
                    </div>
                  )}
                  {/* Nav arrows */}
                  {photoCount > 1 && (
                    <>
                      <button
                        onClick={() => setSelectedPhotoIdx((p) => (p - 1 + photoCount) % photoCount)}
                        style={{
                          position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                          width: 24, height: 24, borderRadius: '50%', border: 'none',
                          background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 14,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        ‹
                      </button>
                      <button
                        onClick={() => setSelectedPhotoIdx((p) => (p + 1) % photoCount)}
                        style={{
                          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                          width: 24, height: 24, borderRadius: '50%', border: 'none',
                          background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 14,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Thumbnails strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {photoSrcs.map((src, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setSelectedPhotoIdx(i);
                    }}
                    style={{
                      position: 'relative',
                      width: isNarrow ? 56 : 44,
                      height: isNarrow ? 56 : 44,
                      borderRadius: borderRadius.sm,
                      overflow: 'hidden',
                      border: `2px solid ${i === selectedPhotoIdx && !isNarrow ? colors.primary : colors.border}`,
                      flexShrink: 0,
                      cursor: 'pointer',
                      opacity: i === selectedPhotoIdx && !isNarrow ? 1 : 0.75,
                      transition: 'all 0.15s',
                    }}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={`Thumb ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: colors.bgLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CameraOutlined style={{ fontSize: 14, color: colors.textMuted }} />
                      </div>
                    )}
                    {!room.analyzing && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemovePhoto(room.id, i); }}
                        style={{
                          position: 'absolute', top: 1, right: 1,
                          width: 14, height: 14, borderRadius: '50%', border: 'none',
                          background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0, lineHeight: 1, zIndex: 10,
                        }}
                        aria-label="Remove photo"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {!room.analyzing && (
                  <div
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.multiple = true;
                      input.onchange = () => {
                        if (input.files && input.files.length > 0) onAddPhoto(room.id, input.files);
                      };
                      input.click();
                    }}
                    style={{
                      width: isNarrow ? 56 : 44,
                      height: isNarrow ? 56 : 44,
                      borderRadius: borderRadius.sm,
                      border: `1px dashed ${colors.border}`,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: colors.bgLight,
                      flexShrink: 0, gap: 1,
                    }}
                  >
                    <PlusOutlined style={{ fontSize: 12, color: colors.textMuted }} />
                    <span style={{ fontSize: 9, color: colors.textMuted }}>Photo</span>
                  </div>
                )}
                <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.body }}>
                  {photoCount > 0 ? `${photoCount} photo${photoCount !== 1 ? 's' : ''}` : '0 photos'}
                </span>
              </div>

              {/* Analyze / Cancel button */}
              {!room.usePreset && (
                room.analyzing ? (
                  <Button danger icon={<CloseOutlined />} onClick={() => onCancelAnalyze(room.id)} style={{ width: '100%' }}>
                    Cancel Analysis
                  </Button>
                ) : (
                  <Button
                    type={room.analyzed ? 'default' : 'primary'}
                    icon={<ScanOutlined />}
                    disabled={photoCount === 0 && !room.analyzed}
                    onClick={() => onAnalyze(room.id)}
                    style={{ width: '100%', ...(room.analyzed ? {} : { background: colors.primary, borderColor: colors.primary }) }}
                  >
                    {analysisFailed ? 'Retry Analysis' : room.analyzed ? 'Re-Analyze' : 'Analyze Room'}
                  </Button>
                )
              )}

              {/* Switch mode button */}
              <Button
                type="text" size="small" icon={<SwapOutlined />}
                onClick={handleTogglePresetMode} disabled={room.analyzing}
                style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.body, padding: '2px 8px', height: 'auto' }}
              >
                {room.usePreset ? 'Switch to AI Analysis' : 'Use Preset Instead'}
              </Button>
            </div>
          );

          // ── Items / Preset column content ──
          const itemsColumn = (
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Preset mode content */}
              {room.usePreset && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.body, display: 'block', marginBottom: 4 }}>Room Preset</span>
                    <Select placeholder="Select a room preset" value={room.preset} onChange={handlePresetSelect} style={{ width: '100%' }} showSearch optionFilterProp="label" size="middle">
                      {Object.entries(presets).map(([category, list]) => (
                        <Select.OptGroup key={category} label={`${PRESET_CATEGORY_ICONS[category] ?? ''} ${category}`}>
                          {list.map((p) => (<Option key={p.key} value={p.key} label={p.name}>{p.name}</Option>))}
                        </Select.OptGroup>
                      ))}
                    </Select>
                  </div>
                  {room.preset && (
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.body, display: 'block', marginBottom: 8 }}>
                        Content Hints
                        {room.hints.length > 0 && (
                          <Tag style={{ marginLeft: 6, fontSize: 11, border: 'none', background: colors.primary + '15', color: colors.primary, borderRadius: borderRadius.full, fontWeight: 700 }}>{room.hints.length}</Tag>
                        )}
                      </span>
                      {Object.entries(HINT_CATEGORIES).map(([cat, items]) => (
                        <div key={cat} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{cat}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                                <div key={hint.key} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                  <button role="checkbox" aria-checked={active} onClick={() => handleToggleHint(hint.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: borderRadius.full, border: `1.5px solid ${active ? colors.primary : colors.border}`, background: active ? colors.primary : colors.bgWhite, color: active ? '#fff' : colors.textSecondary, fontFamily: fonts.body, fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s ease', userSelect: 'none', lineHeight: 1.4, flexShrink: 0 }}>
                                    <span style={{ fontSize: 13, lineHeight: 1 }}>{hint.icon}</span>{hint.label}
                                  </button>
                                  {active && isUnit && !isExpanded && (
                                    <Tooltip title="Click to change quantity"><button onClick={() => setExpandedHintKey(hintExpandKey)} style={{ minWidth: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.sm, border: `1.5px solid ${colors.primary}`, background: colors.primary + '12', color: colors.primary, fontSize: 11, fontWeight: 700, fontFamily: fonts.body, cursor: 'pointer', padding: '0 5px' }}>x{currentQtyLabel}</button></Tooltip>
                                  )}
                                  {active && isUnit && isExpanded && (
                                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                      {QTY_CHIPS.map((chip) => { const selected = currentQty === chip.value; return (<button key={chip.value} onClick={() => { handleHintQty(hint.key, chip.value); setExpandedHintKey(null); }} style={{ width: 26, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.sm, border: `1.5px solid ${selected ? colors.primary : colors.border}`, background: selected ? colors.primary : colors.bgWhite, color: selected ? '#fff' : colors.textSecondary, fontSize: 11, fontWeight: selected ? 700 : 400, fontFamily: fonts.body, cursor: 'pointer', transition: 'all 0.12s ease', padding: 0 }}>{chip.label}</button>); })}
                                    </div>
                                  )}
                                  {active && isVolume && volLevels && !isExpanded && (
                                    <Tooltip title={currentVol ? `${currentVol.label} (${currentVol.hint}) - Click to change` : 'Click to change'}><button onClick={() => setExpandedHintKey(hintExpandKey)} style={{ minWidth: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.sm, border: `1.5px solid ${colors.primary}`, background: colors.primary + '12', color: colors.primary, fontSize: 10, fontWeight: 700, fontFamily: fonts.body, cursor: 'pointer', padding: '0 5px' }}>{currentVol?.key ?? 'M'}</button></Tooltip>
                                  )}
                                  {active && isVolume && volLevels && isExpanded && (
                                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                      {volLevels.map((lvl, lvlIdx) => { const selected = currentVolIdx === lvlIdx; return (<Tooltip key={lvl.key} title={`${lvl.label} (${lvl.hint})`}><button onClick={() => { handleHintVolume(hint.key, lvlIdx); setExpandedHintKey(null); }} style={{ minWidth: 26, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.sm, border: `1.5px solid ${selected ? colors.primary : colors.border}`, background: selected ? colors.primary : colors.bgWhite, color: selected ? '#fff' : colors.textSecondary, fontSize: 10, fontWeight: selected ? 700 : 400, fontFamily: fonts.body, cursor: 'pointer', transition: 'all 0.12s ease', padding: '0 4px' }}>{lvl.key}</button></Tooltip>); })}
                                      {currentVol && (<span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 2, whiteSpace: 'nowrap' }}>{currentVol.label} · {currentVol.hint}</span>)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Detected items + field notes — AI mode only */}
              {hasItems && (
                <div className="animate-result-reveal">
                  <div onClick={() => setItemsCollapsed((v) => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: itemsCollapsed ? 0 : 6, cursor: 'pointer', userSelect: 'none', padding: '4px 0' }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setItemsCollapsed((v) => !v)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {itemsCollapsed ? <RightOutlined style={{ fontSize: 10, color: colors.textMuted }} /> : <DownOutlined style={{ fontSize: 10, color: colors.textMuted }} />}
                      <Text style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.body }}>Detected Items ({room.items.length})</Text>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {totalLaborHours > 0 && <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>{totalLaborHours.toFixed(1)}h labor</Tag>}
                      {fragileCount > 0 && <Tag color="red" style={{ fontSize: 11, margin: 0 }}>{fragileCount} fragile</Tag>}
                    </div>
                  </div>
                  {!itemsCollapsed && (
                    <>
                      {room.field_notes.length > 0 && (
                        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fffbeb', borderRadius: borderRadius.base, border: '1px solid #fde68a' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><ExclamationCircleOutlined /> Field Notes</div>
                          {room.field_notes.map((note, i) => (<div key={i} style={{ fontSize: 11, color: '#78350f', marginBottom: 2 }}>- {note}</div>))}
                        </div>
                      )}
                      {room.items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '12px 0', color: colors.textMuted, fontSize: 12 }}>No items detected. Try re-analyzing or add items manually.</div>
                      ) : (
                        <div style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.base, overflow: 'hidden', marginBottom: 8 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: ITEM_ROW_GRID, gap: 8, padding: '7px 8px', background: colors.bgLight, borderBottom: `1px solid ${colors.border}`, fontSize: 11, fontWeight: 600, color: colors.textSecondary, fontFamily: fonts.body }}>
                            <span>Name</span><span>Size</span><span>Weight</span><span>Category</span><span style={{ textAlign: 'center' }}>Qty</span><span />
                          </div>
                          {room.items.map((item, idx) => (
                            <ItemRow key={idx} item={item} roomId={room.id} itemIndex={idx} editingCell={editingCell} onStartEdit={onStartEdit} onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} onDelete={() => onDeleteItem(room.id, idx)} />
                          ))}
                        </div>
                      )}
                      {/* Low-confidence items requiring manual review */}
                      {room.low_confidence_items && room.low_confidence_items.length > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          icon={<WarningOutlined />}
                          style={{ marginBottom: 8, fontSize: 12 }}
                          message={`${room.low_confidence_items.length} item${room.low_confidence_items.length !== 1 ? 's' : ''} need your review`}
                          description={
                            <div style={{ marginTop: 4 }}>
                              {room.low_confidence_items.map((item, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: idx < room.low_confidence_items.length - 1 ? `1px solid ${colors.border}` : undefined }}>
                                  <div style={{ flex: 1 }}>
                                    <span style={{ fontWeight: 500 }}>{item.name}</span>
                                    <span style={{ color: colors.textMuted, marginLeft: 6, fontSize: 11 }}>
                                      x{item.quantity} &middot; {item.category}
                                      {item.confidence != null && ` · ${Math.round(item.confidence * 100)}%`}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <Button
                                      size="small"
                                      type="link"
                                      icon={<CheckOutlined />}
                                      style={{ color: colors.success, fontSize: 11 }}
                                      onClick={() => {
                                        const accepted = room.low_confidence_items[idx];
                                        onUpdate(room.id, {
                                          items: [...room.items, accepted],
                                          low_confidence_items: room.low_confidence_items.filter((_, i) => i !== idx),
                                        });
                                      }}
                                    >
                                      Add
                                    </Button>
                                    <Button
                                      size="small"
                                      type="link"
                                      icon={<CloseOutlined />}
                                      style={{ color: colors.textMuted, fontSize: 11 }}
                                      onClick={() => {
                                        const dismissed = room.low_confidence_items[idx];
                                        onUpdate(room.id, {
                                          low_confidence_items: room.low_confidence_items.filter((_, i) => i !== idx),
                                          dismissed_items: [...(room.dismissed_items ?? []), dismissed],
                                        });
                                      }}
                                    >
                                      Dismiss
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                                <Button
                                  size="small"
                                  type="primary"
                                  ghost
                                  style={{ fontSize: 11 }}
                                  onClick={() => {
                                    onUpdate(room.id, {
                                      items: [...room.items, ...room.low_confidence_items],
                                      low_confidence_items: [],
                                    });
                                  }}
                                >
                                  Add All
                                </Button>
                                <Button
                                  size="small"
                                  style={{ fontSize: 11 }}
                                  onClick={() => {
                                    onUpdate(room.id, {
                                      low_confidence_items: [],
                                      dismissed_items: [...(room.dismissed_items ?? []), ...room.low_confidence_items],
                                    });
                                  }}
                                >
                                  Dismiss All
                                </Button>
                              </div>
                            </div>
                          }
                        />
                      )}
                      <Button type="dashed" icon={<PlusOutlined />} size="small" onClick={() => onAddItem(room.id)} style={{ width: '100%', fontSize: 12, marginBottom: 8 }}>Add Item Manually</Button>

                      {/* Dismissed / deleted items — restorable */}
                      {room.dismissed_items && room.dismissed_items.length > 0 && (
                        <Collapse
                          size="small"
                          ghost
                          style={{ marginBottom: 8 }}
                          items={[{
                            key: 'dismissed',
                            label: (
                              <span style={{ fontSize: 11, color: colors.textMuted }}>
                                <UndoOutlined style={{ marginRight: 4 }} />
                                Removed Items ({room.dismissed_items.length})
                              </span>
                            ),
                            children: (
                              <div>
                                {room.dismissed_items.map((item, idx) => (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: idx < room.dismissed_items.length - 1 ? `1px solid ${colors.border}` : undefined }}>
                                    <span style={{ fontSize: 12, color: colors.textMuted }}>
                                      {item.name} <span style={{ fontSize: 11 }}>x{item.quantity}</span>
                                    </span>
                                    <Button
                                      size="small"
                                      type="link"
                                      icon={<UndoOutlined />}
                                      style={{ fontSize: 11 }}
                                      onClick={() => {
                                        onUpdate(room.id, {
                                          items: [...room.items, item],
                                          dismissed_items: room.dismissed_items.filter((_, i) => i !== idx),
                                        });
                                      }}
                                    >
                                      Restore
                                    </Button>
                                  </div>
                                ))}
                                {room.dismissed_items.length > 1 && (
                                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                                    <Button
                                      size="small"
                                      type="primary"
                                      ghost
                                      style={{ fontSize: 11 }}
                                      onClick={() => {
                                        onUpdate(room.id, {
                                          items: [...room.items, ...room.dismissed_items],
                                          dismissed_items: [],
                                        });
                                      }}
                                    >
                                      Restore All
                                    </Button>
                                    <Button
                                      size="small"
                                      danger
                                      type="text"
                                      style={{ fontSize: 11 }}
                                      onClick={() => {
                                        onUpdate(room.id, { dismissed_items: [] });
                                      }}
                                    >
                                      Clear All
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ),
                          }]}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );

          // ── Render: 2-column on desktop, stacked on mobile ──
          return isNarrow ? (
            <div>
              {photoColumn}
              <div style={{ marginTop: 12 }}>{itemsColumn}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 380, flexShrink: 0 }}>{photoColumn}</div>
              {itemsColumn}
            </div>
          );
        })()}
      </div>
    </Card>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const PhotoAITab: React.FC<PhotoAITabProps> = ({
  presets,
  presetsLoading,
  photoRooms,
  setPhotoRooms,
  settings,
  setSettings,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  onEstimateResult,
  activeSessionId: _activeSessionId,
  hasExistingEstimate,
  onSavePhotoRooms,
  photoRoomsDirty,
  savingPhotoRooms,
}) => {
  const gDrive = useGoogleDrive();
  const isNarrow = useIsNarrow();
  const [currentStep, setCurrentStep] = useState(0);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [generatingEstimate, setGeneratingEstimate] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [batchState, setBatchState] = useState<BatchAnalysisState>({
    isRunning: false,
    currentRoomIndex: 0,
    totalRooms: 0,
    completedRooms: 0,
    failedRooms: [],
    aborted: false,
  });
  const batchAbortRef = useRef<{ abort: () => void } | null>(null);

  const analyzedRooms = photoRooms.filter((r) => r.analyzed || (r.usePreset && r.preset));
  const canGenerate = analyzedRooms.length > 0 && !generatingEstimate;

  // ── Room mutation helpers ──────────────────────────────────────────────
  const updateRoom = useCallback(
    (id: string, updates: Partial<PhotoRoom>) => {
      setPhotoRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    },
    [setPhotoRooms],
  );

  const deleteRoom = useCallback(
    (id: string) => {
      setPhotoRooms((prev) => prev.filter((r) => r.id !== id));
    },
    [setPhotoRooms],
  );

  const addRoom = useCallback(
    (room: PhotoRoom) => {
      setPhotoRooms((prev) => [room, ...prev]);
      // Upload photos to storage in background
      if (room.photos.length > 0) {
        packingApi.uploadPhotos(room.photos).then((keys) => {
          setPhotoRooms((prev) =>
            prev.map((r) => r.id === room.id ? { ...r, photo_keys: keys } : r),
          );
        }).catch(() => {});
      }
    },
    [setPhotoRooms],
  );

  // ── Photo helpers ──────────────────────────────────────────────────────
  const handleAddPhotos = useCallback(
    async (roomId: string, files: FileList) => {
      const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (fileArray.length === 0) return;
      try {
        const base64List = await Promise.all(fileArray.map(fileToBase64));
        const room = photoRooms.find((r) => r.id === roomId);

        // Upload to storage in background, then store keys
        packingApi.uploadPhotos(base64List).then((keys) => {
          updateRoom(roomId, {
            photo_keys: [...(room?.photo_keys ?? []), ...keys],
          });
        }).catch(() => {
          // Non-fatal: photos still work in-memory for current session
        });

        updateRoom(roomId, {
          photos: [...(room?.photos ?? []), ...base64List],
        });
      } catch {
        message.error('Failed to process image files.');
      }
    },
    [photoRooms, updateRoom],
  );

  const handleRemovePhoto = useCallback(
    (roomId: string, index: number) => {
      setPhotoRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
                ...r,
                photos: r.photos.filter((_, i) => i !== index),
                photo_keys: (r.photo_keys ?? []).filter((_, i) => i !== index),
              }
            : r,
        ),
      );
    },
    [setPhotoRooms],
  );

  // ── AI Analysis ────────────────────────────────────────────────────────
  // Track per-room AbortControllers so each analysis can be cancelled
  const analyzeAbortRef = useRef<Record<string, AbortController>>({});

  const handleAnalyze = useCallback(
    async (roomId: string) => {
      const room = photoRooms.find((r) => r.id === roomId);
      const photoKeys = room?.photo_keys ?? [];
      const hasPhotos = (room?.photos?.length ?? 0) > 0 || photoKeys.length > 0;
      console.log('[PhotoAI] handleAnalyze called', { roomId, found: !!room, photoCount: room?.photos.length, photoKeys: photoKeys.length });
      if (!room || !hasPhotos) return;

      // Create AbortController for this room
      const controller = new AbortController();
      analyzeAbortRef.current[roomId] = controller;

      updateRoom(roomId, { analyzing: true });
      try {
        // If no in-memory base64 but have storage keys, fetch from storage
        let images = room.photos;
        if (images.length === 0 && photoKeys.length > 0) {
          console.log('[PhotoAI] Fetching photos from storage...', { keys: photoKeys.length });
          images = await Promise.all(photoKeys.map((key) => packingApi.fetchPhotoBase64(key)));
          // Cache in memory for subsequent operations
          updateRoom(roomId, { photos: images });
        }

        console.log('[PhotoAI] Sending analyze request...', { room_name: room.room_name, images: images.length });
        const result = await packingApi.analyzeRoom(
          {
            room_name: room.room_name,
            images,
            existing_items: room.items.map((i) => ({ name: i.name, quantity: i.quantity })),
          },
          controller.signal,
        );
        console.log('[PhotoAI] Analyze success', { items: result.items.length, lowConf: result.low_confidence_items?.length ?? 0 });
        updateRoom(roomId, {
          items: result.items,
          low_confidence_items: result.low_confidence_items ?? [],
          dismissed_items: [],
          density: (result.density as PhotoRoom['density']) ?? room.density,
          room_size: result.room_size,
          confidence_score: result.confidence_score,
          field_notes: result.field_notes,
          analyzed: true,
          analyzing: false,
        });
        const lowCount = result.low_confidence_items?.length ?? 0;
        message.success(`Analyzed ${room.room_name}: ${result.items.length} items detected`);
        if (lowCount > 0) {
          message.warning(
            `${lowCount} item${lowCount !== 1 ? 's' : ''} need manual review (low confidence)`,
            5,
          );
        }
      } catch (err: any) {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED' || controller.signal.aborted) {
          message.info('Analysis cancelled.');
        } else {
          console.error('Photo analysis error:', err);
          const detail = err?.response?.data?.detail;
          const status = err?.response?.status;
          let msg = 'Failed to analyze room. Try again.';
          if (detail) {
            msg = detail;
          } else if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
            msg = 'Cannot reach the server. Make sure the backend is running.';
          } else if (status) {
            msg = `Server error (${status}). Check backend logs for details.`;
          }
          message.error(msg);
        }
        updateRoom(roomId, { analyzing: false });
      } finally {
        delete analyzeAbortRef.current[roomId];
      }
    },
    [photoRooms, updateRoom],
  );

  const handleCancelAnalyze = useCallback(
    (roomId: string) => {
      const controller = analyzeAbortRef.current[roomId];
      if (controller) {
        controller.abort();
      }
      updateRoom(roomId, { analyzing: false });
    },
    [updateRoom],
  );

  // ── Bulk Room Import (from folder) ────────────────────────────────────
  const handleBulkAddRooms = useCallback(
    (newRooms: PhotoRoom[]) => {
      setPhotoRooms((prev) => [...newRooms, ...prev]);
      // Upload all room photos to storage in background
      for (const room of newRooms) {
        if (room.photos.length > 0) {
          packingApi.uploadPhotos(room.photos).then((keys) => {
            setPhotoRooms((prev) =>
              prev.map((r) => r.id === room.id ? { ...r, photo_keys: keys } : r),
            );
          }).catch(() => {});
        }
      }
    },
    [setPhotoRooms],
  );

  // ── Batch Analysis (SSE) ────────────────────────────────────────────
  const unanalyzedWithPhotos = photoRooms.filter(
    (r) => !r.analyzed && !r.usePreset && r.photos.length > 0 && !r.analyzing,
  );

  const handleBatchAnalyze = useCallback(() => {
    const rooms = photoRooms.filter(
      (r) => !r.analyzed && !r.usePreset && r.photos.length > 0,
    );
    if (rooms.length === 0) {
      message.warning('No unanalyzed rooms with photos.');
      return;
    }

    // Mark all target rooms as analyzing
    setPhotoRooms((prev) =>
      prev.map((r) =>
        rooms.some((t) => t.id === r.id)
          ? { ...r, analyzing: true }
          : r,
      ),
    );

    setBatchState({
      isRunning: true,
      currentRoomIndex: 0,
      totalRooms: rooms.length,
      completedRooms: 0,
      failedRooms: [],
      aborted: false,
    });

    const handle = packingApi.analyzeBatch(
      rooms.map((r) => ({
        room_name: r.room_name,
        images: r.photos,
        existing_items: r.items.length > 0
          ? r.items.map((i) => ({ name: i.name, quantity: i.quantity }))
          : undefined,
      })),
      {
        onRoomResult: (evt: BatchRoomEvent) => {
          const targetRoom = rooms[evt.room_index];
          if (!targetRoom) return;

          if (evt.status === 'success' && evt.result) {
            updateRoom(targetRoom.id, {
              items: evt.result.items,
              low_confidence_items: evt.result.low_confidence_items ?? [],
              dismissed_items: [],
              density: (evt.result.density as PhotoRoom['density']) ?? 'normal',
              room_size: evt.result.room_size,
              confidence_score: evt.result.confidence_score,
              field_notes: evt.result.field_notes,
              analyzed: true,
              analyzing: false,
            });
            const lowCount = evt.result.low_confidence_items?.length ?? 0;
            if (lowCount > 0) {
              message.warning(
                `${targetRoom.room_name}: ${lowCount} item${lowCount !== 1 ? 's' : ''} need review`,
                4,
              );
            }
          } else {
            // Error: leave room in previous state, mark not analyzing
            updateRoom(targetRoom.id, { analyzing: false });
            setBatchState((prev) => ({
              ...prev,
              failedRooms: [
                ...prev.failedRooms,
                {
                  id: targetRoom.id,
                  name: targetRoom.room_name,
                  error: evt.error_message || 'Unknown error',
                },
              ],
            }));
          }

          setBatchState((prev) => ({
            ...prev,
            currentRoomIndex: evt.room_index + 1,
            completedRooms: prev.completedRooms + 1,
          }));
        },
        onComplete: (evt: BatchCompleteEvent) => {
          setBatchState((prev) => ({
            ...prev,
            isRunning: false,
          }));
          batchAbortRef.current = null;

          if (evt.failed > 0) {
            message.warning(
              `${evt.succeeded} room${evt.succeeded !== 1 ? 's' : ''} analyzed, ${evt.failed} failed. Check rooms marked in red.`,
            );
          } else {
            message.success(
              `All ${evt.succeeded} room${evt.succeeded !== 1 ? 's' : ''} analyzed successfully.`,
            );
          }
        },
        onError: (error: string) => {
          // Stream-level error: mark all analyzing rooms as not analyzing
          setPhotoRooms((prev) =>
            prev.map((r) => (r.analyzing ? { ...r, analyzing: false } : r)),
          );
          setBatchState((prev) => ({
            ...prev,
            isRunning: false,
          }));
          batchAbortRef.current = null;
          message.error(`Batch analysis failed: ${error}`);
        },
      },
    );

    batchAbortRef.current = handle;
  }, [photoRooms, setPhotoRooms, updateRoom]);

  const handleBatchCancel = useCallback(() => {
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    setPhotoRooms((prev) =>
      prev.map((r) => (r.analyzing ? { ...r, analyzing: false } : r)),
    );
    setBatchState((prev) => ({
      ...prev,
      isRunning: false,
      aborted: true,
    }));
    message.info('Batch analysis cancelled.');
  }, [setPhotoRooms]);

  // ── Item inline edit ──────────────────────────────────────────────────
  const handleCommitEdit = useCallback(
    (roomId: string, itemIndex: number, field: EditingCell['field'], value: string | number) => {
      setPhotoRooms((prev) =>
        prev.map((r) => {
          if (r.id !== roomId) return r;
          const items = r.items.map((item, i) => {
            if (i !== itemIndex) return item;
            if (field === 'name') return { ...item, name: String(value) };
            if (field === 'description') return { ...item, description: String(value) || undefined };
            if (field === 'size') return { ...item, size: String(value) as any };
            if (field === 'weight') return { ...item, weight: String(value) as any };
            if (field === 'category') return { ...item, category: String(value) };
            if (field === 'quantity') return { ...item, quantity: Number(value) };
            return item;
          });
          return { ...r, items };
        }),
      );
      setEditingCell(null);
    },
    [setPhotoRooms],
  );

  const handleDeleteItem = useCallback(
    (roomId: string, itemIndex: number) => {
      setPhotoRooms((prev) =>
        prev.map((r) => {
          if (r.id !== roomId) return r;
          const removed = r.items[itemIndex];
          return {
            ...r,
            items: r.items.filter((_, i) => i !== itemIndex),
            dismissed_items: removed ? [...r.dismissed_items, removed] : r.dismissed_items,
          };
        }),
      );
    },
    [setPhotoRooms],
  );

  const handleAddItem = useCallback(
    (roomId: string) => {
      const newItem: DetectedContentItem = {
        name: 'New Item',
        category: 'Other',
        quantity: 1,
        is_high_value: false,
        is_fragile: false,
        needs_disassembly: false,
      };
      setPhotoRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, items: [...r.items, newItem] } : r)),
      );
    },
    [setPhotoRooms],
  );

  // ── Generate Estimate ──────────────────────────────────────────────────
  const runGenerateEstimate = useCallback(async () => {
    if (analyzedRooms.length === 0) return;
    setGeneratingEstimate(true);

    // Aggregate per-room special items
    const allSpecialItems = [...new Set(analyzedRooms.flatMap((r) => r.special_items))];
    const allCustomSpecialItems = analyzedRooms.flatMap((r) => r.custom_special_items);

    try {
      const result = await packingApi.contentEstimate({
        rooms: analyzedRooms.map((r) => ({
          room_name: r.room_name,
          preset_id: r.preset_id,
          items: r.usePreset ? [] : r.items,
          density: r.density,
          floor: r.floor,
          contamination: r.contamination,
          special_items: r.special_items,
          custom_special_items: r.custom_special_items,
          // Preset fallback fields
          use_preset: r.usePreset,
          preset: r.preset,
          hints: r.hints,
          hint_volume: r.hint_volume,
          hint_qty: r.hint_qty,
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
        special_items: allSpecialItems,
        custom_special_items: allCustomSpecialItems,
      });
      onEstimateResult(result);
      message.success('Estimate generated successfully!');
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Failed to generate estimate.';
      message.error(msg);
    } finally {
      setGeneratingEstimate(false);
    }
  }, [analyzedRooms, settings, onEstimateResult]);

  const handleGenerateEstimate = useCallback(() => {
    if (analyzedRooms.length === 0) return;
    if (hasExistingEstimate) {
      Modal.confirm({
        title: 'This will update your existing estimate',
        content: 'Recalculating rebuilds every line from the current rooms. Manual edits made in the Estimate Editor will be replaced.',
        okText: 'Recalculate',
        cancelText: 'Cancel',
        onOk: runGenerateEstimate,
      });
    } else {
      runGenerateEstimate();
    }
  }, [analyzedRooms, hasExistingEstimate, runGenerateEstimate]);

  // ── Step definitions ───────────────────────────────────────────────────

  const steps = [
    { title: 'Details', description: 'Client & settings', icon: <UserOutlined /> },
    { title: 'Rooms', description: 'Photos & analysis', icon: <CameraOutlined /> },
    { title: 'Review', description: 'Generate estimate', icon: <FileTextOutlined /> },
  ];

  const canGoNext = () => {
    if (currentStep === 1) return analyzedRooms.length > 0;
    return true;
  };

  const handleNext = () => {
    if (!canGoNext()) {
      if (currentStep === 1) {
        if (photoRooms.length === 0) {
          message.warning('Add at least one room to continue.');
        } else {
          message.warning('Analyze at least one room before continuing.');
        }
      }
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const handleStepClick = (idx: number) => {
    if (idx > currentStep && idx >= 2 && analyzedRooms.length === 0) {
      message.warning('Analyze at least one room first.');
      return;
    }
    setCurrentStep(idx);
  };

  // ── Step 2: Rooms & Photos content ────────────────────────────────────
  const renderStepRooms = () => (
    <div>
      {/* Import toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, display: 'flex' }}>
          <div style={{ width: '100%' }}>
            <AddRoomPanel presets={presets} presetsLoading={presetsLoading} onAddRoom={addRoom} />
          </div>
        </div>
        <Tooltip title="Import rooms from folder">
          <Button
            icon={<FolderOpenOutlined />}
            onClick={() => setFolderModalOpen(true)}
            style={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 500,
              height: 'auto',
              borderRadius: borderRadius.lg,
            }}
          >
            Import
          </Button>
        </Tooltip>
      </div>

      {photoRooms.length === 0 ? (
        <Card
          style={{ borderRadius: borderRadius.lg, border: `1px solid ${colors.border}`, textAlign: 'center' }}
          bodyStyle={{ padding: '48px 24px' }}
        >
          <CameraOutlined style={{ fontSize: 40, color: colors.textMuted, marginBottom: 12 }} />
          <Title level={5} style={{ color: colors.textSecondary, fontFamily: fonts.heading, marginBottom: 8 }}>
            No Rooms Added
          </Title>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: fonts.body }}>
            Add a room above, upload photos, or import a folder to get started.
          </Text>
        </Card>
      ) : (
        <>
          {/* Batch progress bar (only visible during batch analysis or when unanalyzed rooms exist) */}
          {batchState.isRunning && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                padding: '8px 12px',
                background: colors.bgLight,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <LoadingOutlined style={{ fontSize: 14, color: colors.primary }} />
                <Text style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.heading }}>
                  Analyzing {batchState.completedRooms}/{batchState.totalRooms} rooms...
                </Text>
                <div
                  style={{
                    width: 80,
                    height: 4,
                    borderRadius: 2,
                    background: colors.border,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: `${batchState.totalRooms > 0 ? (batchState.completedRooms / batchState.totalRooms) * 100 : 0}%`,
                      height: '100%',
                      background: colors.primary,
                      borderRadius: 2,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={handleBatchCancel}
                style={{ fontSize: 12, flexShrink: 0 }}
              >
                Cancel
              </Button>
            </div>
          )}
          {!batchState.isRunning && unanalyzedWithPhotos.length > 0 && (
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Tooltip title={`Analyze ${unanalyzedWithPhotos.length} unanalyzed room${unanalyzedWithPhotos.length !== 1 ? 's' : ''}`}>
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={handleBatchAnalyze}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    background: colors.primary,
                    borderColor: colors.primary,
                  }}
                >
                  Analyze All ({unanalyzedWithPhotos.length})
                </Button>
              </Tooltip>
            </div>
          )}

          {/* Batch failure summary */}
          {!batchState.isRunning && batchState.failedRooms.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: colors.error + '08',
                border: `1px solid ${colors.error}33`,
                borderRadius: borderRadius.md,
                fontSize: 12,
                color: colors.error,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ExclamationCircleOutlined /> {batchState.failedRooms.length} room{batchState.failedRooms.length !== 1 ? 's' : ''} failed analysis
              </div>
              {batchState.failedRooms.map((f) => (
                <div key={f.id} style={{ marginLeft: 18, color: colors.textSecondary }}>
                  {f.name}: {f.error}
                </div>
              ))}
            </div>
          )}

          {photoRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              presets={presets}
              editingCell={editingCell}
              onUpdate={updateRoom}
              onDelete={deleteRoom}
              onAnalyze={handleAnalyze}
              onCancelAnalyze={handleCancelAnalyze}
              onStartEdit={setEditingCell}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={() => setEditingCell(null)}
              onAddPhoto={handleAddPhotos}
              onRemovePhoto={handleRemovePhoto}
              onAddItem={handleAddItem}
              onDeleteItem={handleDeleteItem}
              analysisFailed={batchState.failedRooms.some((f) => f.id === room.id)}
            />
          ))}
        </>
      )}

      {/* Folder Import Modal */}
      <FolderImportModal
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        onRoomsCreated={handleBulkAddRooms}
        existingRoomNames={photoRooms.map((r) => r.room_name)}
        gDrive={gDrive.isAvailable ? gDrive : undefined}
      />
    </div>
  );

  // ── Step 3: Review & Generate ─────────────────────────────────────────
  const renderStepReview = () => {
    const allSpecialItems = [...new Set(analyzedRooms.flatMap((r) => r.special_items))];
    const allCustomSpecialItems = analyzedRooms.flatMap((r) => r.custom_special_items);
    const totalSpecialCount = allSpecialItems.length + allCustomSpecialItems.length;

    let reviewHvCount = 0;
    let reviewFragileCount = 0;
    analyzedRooms.forEach((r) => {
      const items = r.items || [];
      items.forEach((i) => {
        if (i.is_high_value) reviewHvCount += 1;
        if (i.is_fragile) reviewFragileCount += 1;
      });
    });

    return (
      <div>
        <h3 style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: 700, color: colors.textPrimary, marginBottom: 4 }}>
          Review & Generate
        </h3>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 24 }}>
          Confirm your selections below, then click Generate to create the estimate.
        </p>

        {/* High-value & Fragile summary */}
        {(reviewHvCount > 0 || reviewFragileCount > 0) && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            {reviewHvCount > 0 && (
              <span style={{ color: '#b45309' }}>
                {reviewHvCount} high-value item{reviewHvCount !== 1 ? 's' : ''}
              </span>
            )}
            {reviewFragileCount > 0 && (
              <span style={{ color: '#dc2626' }}>
                {reviewFragileCount} fragile item{reviewFragileCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Client + Rooms side by side */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {/* Client info preview */}
          {clientInfo.name && (
            <Card
              size="small"
              style={{ borderRadius: borderRadius.md, border: `1.5px solid ${colors.border}`, flex: '1 1 240px', minWidth: 240 }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>CLIENT</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>{clientInfo.name}</div>
              {clientInfo.property_address && (
                <div style={{ fontSize: 13, color: colors.textSecondary }}>{clientInfo.property_address}</div>
              )}
              {clientInfo.phone && (
                <div style={{ fontSize: 13, color: colors.textSecondary }}>{clientInfo.phone}</div>
              )}
              {clientInfo.email && (
                <div style={{ fontSize: 13, color: colors.textSecondary }}>{clientInfo.email}</div>
              )}
            </Card>
          )}

          {/* Rooms preview */}
          {analyzedRooms.length > 0 && (
            <Card
              size="small"
              style={{ borderRadius: borderRadius.md, border: `1.5px solid ${colors.border}`, flex: '1 1 240px', minWidth: 240 }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>
                ANALYZED ROOMS ({analyzedRooms.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {analyzedRooms.map((room) => (
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
                    {room.room_name} {'\u00B7'} {room.floor} floor{room.density !== 'normal' ? ` \u00B7 ${room.density}` : ''}{room.usePreset ? ' \u00B7 Preset' : ''}
                  </Tag>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Aggregated special items preview */}
        {totalSpecialCount > 0 && (
          <Card
            size="small"
            style={{ borderRadius: borderRadius.md, border: `1.5px solid ${colors.border}`, marginBottom: 20 }}
            styles={{ body: { padding: '12px 16px' } }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>
              SPECIAL ITEMS ({totalSpecialCount})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allSpecialItems.map((key) => (
                <Tag
                  key={key}
                  style={{
                    borderRadius: borderRadius.sm,
                    fontSize: 12,
                    border: 'none',
                    background: colors.primary + '15',
                    color: colors.primary,
                  }}
                >
                  {key}
                </Tag>
              ))}
              {allCustomSpecialItems.map((item, idx) => (
                <Tag
                  key={`custom-${idx}`}
                  style={{
                    borderRadius: borderRadius.sm,
                    fontSize: 12,
                    border: `1px solid ${colors.border}`,
                    background: colors.bgLight,
                    color: colors.textPrimary,
                  }}
                >
                  {item.name} (${item.price.toFixed(0)})
                </Tag>
              ))}
            </div>
          </Card>
        )}

        {analyzedRooms.length === 0 && (
          <Alert
            type="warning"
            message="No analyzed rooms"
            description="Go back to Step 2 and analyze at least one room."
            showIcon
            style={{ borderRadius: borderRadius.md, marginBottom: 20 }}
          />
        )}

        <Button
          type="primary"
          size="large"
          icon={generatingEstimate ? <LoadingOutlined /> : <CalculatorOutlined />}
          loading={generatingEstimate}
          disabled={!canGenerate}
          onClick={handleGenerateEstimate}
          style={{
            width: '100%',
            height: 52,
            fontFamily: fonts.heading,
            fontWeight: 700,
            fontSize: 16,
            borderRadius: borderRadius.base,
            background: canGenerate ? colors.primary : undefined,
            borderColor: canGenerate ? colors.primary : undefined,
          }}
        >
          {generatingEstimate
            ? 'Generating…'
            : hasExistingEstimate
              ? `Recalculate Estimate (${analyzedRooms.length} room${analyzedRooms.length !== 1 ? 's' : ''})`
              : `Generate Estimate (${analyzedRooms.length} room${analyzedRooms.length !== 1 ? 's' : ''})`}
        </Button>
      </div>
    );
  };

  const isEditMode = !!_activeSessionId;

  // ── Edit mode: Rooms (left) + Review (right), stacks on narrow ──────

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
          {renderStepRooms()}
        </div>

        {isNarrow && <Divider />}

        {/* Settings + Review & Generate - right side (sticky on desktop) */}
        <div
          style={{
            width: isNarrow ? '100%' : 380,
            flexShrink: 0,
            position: isNarrow ? 'relative' : 'sticky',
            top: isNarrow ? undefined : 60,
          }}
        >
          <SharedDetailsStep
            settings={settings}
            setSettings={setSettings}
            clientInfo={clientInfo}
            setClientInfo={setClientInfo}
            companyOverride={companyOverride}
            setCompanyOverride={setCompanyOverride}
            compact
          />
          <div style={{ marginTop: 20 }}>
            {renderStepReview()}
          </div>
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
    renderStepRooms(),
    renderStepReview(),
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
      {/* Step Indicator + Save Draft */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <Steps
          current={currentStep}
          onChange={handleStepClick}
          items={steps.map((s, idx) => ({
            title: (
              <span style={{ fontFamily: fonts.heading, fontWeight: currentStep === idx ? 700 : 500, fontSize: 13 }}>
                {s.title}
              </span>
            ),
            description: (
              <span style={{ fontSize: 11, color: colors.textMuted }}>{s.description}</span>
            ),
            icon: s.icon,
          }))}
          size="small"
          style={{ maxWidth: 600, flex: 1, minWidth: 260 }}
        />
        <Tooltip title={photoRoomsDirty ? 'Save your photo/analysis changes as a draft' : 'No unsaved AI analysis changes'}>
          <Button
            type={photoRoomsDirty ? 'primary' : 'default'}
            icon={<SaveOutlined />}
            loading={savingPhotoRooms}
            disabled={!photoRoomsDirty}
            onClick={onSavePhotoRooms}
            style={{
              borderRadius: borderRadius.base,
              fontWeight: 600,
              flexShrink: 0,
              ...(photoRoomsDirty ? { background: colors.primary, borderColor: colors.primary } : {}),
            }}
          >
            {photoRoomsDirty ? 'Save Draft' : 'Draft Saved'}
          </Button>
        </Tooltip>
      </div>

      {/* Step Content */}
      <div style={{ minHeight: 300 }}>{stepContent[currentStep]}</div>

      {/* Navigation */}
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
          style={{ minWidth: 100, borderRadius: borderRadius.base, fontWeight: 600 }}
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
