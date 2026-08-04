/**
 * ScopeIt - Packing & Moving Estimator
 * Landing = session list. "New Estimate" opens mode picker then wizard.
 * Click existing session → edit mode.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Modal,
  Card,
  Tag,
  Typography,
  Space,
  App,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  ThunderboltOutlined,
  CameraOutlined,
  ArrowLeftOutlined,
  DollarOutlined,
  LockOutlined,
  SettingOutlined,
  ReloadOutlined,
  FileTextOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { toolService } from '@/services/toolService';
import { packingApi } from './packingApi';
import { DEFAULT_SETTINGS } from './constants';
import { QuickEstimateTab } from './QuickEstimateTab';
import { PhotoAITab } from './PhotoAITab';
import { PackoutTab } from './PackoutTab';
import { SharedDetailsStep } from './SharedDetailsStep';
import { HistoryTab } from './HistoryTab';
import { PricesTab } from './PricesTab';
import { EstimateEditorModal } from './EstimateEditorModal';
import type {
  PackingRoom,
  PhotoRoom,
  PackoutRoom,
  PackoutSettings,
  PackingSettings,
  ClientInfo,
  CompanyInfoOverride,
  EstimateResponse,
  RoomPreset,
  PackingMode,
} from './types';

const { Text, Title } = Typography;

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultClientInfo(): ClientInfo {
  return { name: '', phone: '', email: '', property_address: '' };
}

function defaultCompanyOverride(): CompanyInfoOverride {
  return { name: '', address: '', phone: '', email: '' };
}

type ViewState = 'list' | 'editor';

// ── Main Component ───────────────────────────────────────────────────────────

const PackingTool: React.FC<ToolComponentProps> = ({ sessionId, onCreateEstimate }) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();

  // View state: list (default) or editor (wizard)
  const [view, setView] = useState<ViewState>(sessionId ? 'editor' : 'list');
  const [editorMode, setEditorMode] = useState<PackingMode>('quick');

  // Mode picker modal
  const [modePickerOpen, setModePickerOpen] = useState(false);

  // Shared data
  const [presets, setPresets] = useState<Record<string, RoomPreset[]>>({});
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [settings, setSettings] = useState<PackingSettings>({ ...DEFAULT_SETTINGS });
  const [clientInfo, setClientInfo] = useState<ClientInfo>(defaultClientInfo());
  const [companyOverride, setCompanyOverride] = useState<CompanyInfoOverride>(defaultCompanyOverride());
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(sessionId);

  // Quick estimate rooms
  const [rooms, setRooms] = useState<PackingRoom[]>([]);
  // Photo AI rooms
  const [photoRooms, setPhotoRooms] = useState<PhotoRoom[]>([]);
  // Packout rooms
  const [packoutRooms, setPackoutRooms] = useState<PackoutRoom[]>([]);
  const [packoutSettings, setPackoutSettings] = useState<PackoutSettings>({
    detail_level: 'detailed',
    storage_mode: 'off_site',
    repair_duration_months: 3,
    on_property_pct: 0,
    crew_size: 4,
    include_packback: true,
    include_op: true,
    op_rate: 20,
    include_contingency: false,
    contingency_rate: 0,
    region: 'mid_atlantic',
    special_items: [],
    custom_special_items: [],
  });

  // Estimate result + editor modal
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const resultRef = useRef(result);
  resultRef.current = result;
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [estimateMode, setEstimateMode] = useState<PackingMode>('quick');

  // History refresh trigger
  const [historyKey, setHistoryKey] = useState(0);

  // ── Load presets on mount ──────────────────────────────────────────────
  useEffect(() => {
    packingApi.getPresets().then(setPresets).catch(() => {
      message.error('Failed to load room presets');
    }).finally(() => setPresetsLoading(false));
  }, []);

  // ── Restore session (when opened from outside with sessionId) ──────────
  useEffect(() => {
    if (!sessionId) return;
    toolService.getSession(sessionId).then((session) => {
      const d = session.data as any;
      if (d?.rooms) setRooms(d.rooms);
      if (d?.photo_rooms) {
        // Ensure photo_keys and other fields have defaults for old sessions
        const restored = (d.photo_rooms as any[]).map((r: any) => ({
          ...r,
          photos: r.photos ?? [],
          photo_keys: r.photo_keys ?? [],
          items: r.items ?? [],
          low_confidence_items: r.low_confidence_items ?? [],
          dismissed_items: r.dismissed_items ?? [],
          analyzed: r.analyzed ?? false,
          analyzing: false,
          field_notes: r.field_notes ?? [],
          special_items: r.special_items ?? [],
          custom_special_items: r.custom_special_items ?? [],
          usePreset: r.usePreset ?? false,
          hints: r.hints ?? [],
          hint_volume: r.hint_volume ?? {},
          hint_qty: r.hint_qty ?? {},
        }));
        setPhotoRooms(restored);
      }
      if (d?.settings) setSettings(d.settings);
      if (d?.client_info) setClientInfo(d.client_info);
      if (d?.company_override) setCompanyOverride(d.company_override);
      if (d?.result) setResult(d.result);
      if (d?.mode) {
        setEditorMode(d.mode);
        setEstimateMode(d.mode);
      }
      setView('editor');
    }).catch(() => {});
  }, [sessionId]);

  // ── Session save ───────────────────────────────────────────────────────
  const createFailedRef = useRef(false);

  const saveSession = useCallback(async (mode: PackingMode, resultData?: EstimateResponse) => {
    if (!activeSessionId && createFailedRef.current) return;

    // Use ref to always get the latest result state (avoids stale closure)
    const currentResult = resultData ?? resultRef.current;
    // Ensure all in-memory photos are uploaded to storage before saving.
    // Upload any photos that don't yet have a corresponding photo_key.
    const lightPhotoRooms = await Promise.all(photoRooms.map(async (r) => {
      let keys = [...(r.photo_keys ?? [])];
      // Upload missing photos: photos exist in memory but no matching key
      if (r.photos.length > 0 && keys.length < r.photos.length) {
        try {
          const missingPhotos = r.photos.slice(keys.length);
          const newKeys = await packingApi.uploadPhotos(missingPhotos);
          keys = [...keys, ...newKeys];
          // Update state so subsequent saves don't re-upload
          r.photo_keys = keys;
        } catch { /* non-fatal */ }
      }
      return {
        ...r,
        photos: [],  // base64 stripped — loaded from storage via photo_keys
        photo_keys: keys,
        photo_count: r.photos?.length || keys.length || r.photo_count || 0,
      };
    }));
    const sessionData = {
      mode,
      status: currentResult ? 'completed' : 'draft',
      rooms,
      photo_rooms: lightPhotoRooms,
      packout_rooms: packoutRooms,
      packout_settings: packoutSettings,
      settings,
      client_info: clientInfo,
      company_override: companyOverride,
      result: currentResult ?? undefined,
    };
    try {
      if (activeSessionId) {
        await toolService.updateSession(activeSessionId, { data: sessionData });
      } else {
        const modeLabel = mode === 'content' ? 'Photo AI' : mode === 'packout' ? 'Packout' : 'Quick';
        const session = await toolService.createSession({
          tool_id: 'packing',
          name: clientInfo.name ? `${clientInfo.name} - ${modeLabel}` : `${modeLabel} Estimate`,
          data: sessionData,
        });
        setActiveSessionId(session.id);
        createFailedRef.current = false;
      }
    } catch {
      if (!activeSessionId) {
        createFailedRef.current = true;
      }
    }
  }, [rooms, photoRooms, packoutRooms, packoutSettings, settings, clientInfo, companyOverride, activeSessionId]);

  // ── Auto-save debounce ─────────────────────────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (view !== 'editor') return;
    const hasData = rooms.length > 0 || photoRooms.length > 0 || packoutRooms.length > 0 || clientInfo.name.trim() || result;
    if (!hasData) return;

    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveSession(editorMode);
    }, 3000);

    return () => clearTimeout(autoSaveTimerRef.current);
  }, [view, rooms, photoRooms, packoutRooms, packoutSettings, settings, clientInfo, companyOverride, editorMode, result, saveSession]);

  // ── Invalidate result when items are modified after calculate ──────────
  // Track a fingerprint of items so we detect edits/adds/deletes
  const itemsFingerprintRef = useRef('');
  useEffect(() => {
    if (!result) return; // no result to invalidate
    const fp = photoRooms
      .map((r) => r.items.map((i) => `${i.name}|${i.category}|${i.quantity}`).join(','))
      .join(';');
    if (itemsFingerprintRef.current && fp !== itemsFingerprintRef.current) {
      // Items changed after calculate — mark result as stale
      setResult((prev) => prev ? { ...prev, _stale: true } as any : prev);
    }
    itemsFingerprintRef.current = fp;
  }, [photoRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Estimate result handler ────────────────────────────────────────────
  const pendingResultRef = useRef<{ res: EstimateResponse; mode: PackingMode } | null>(null);

  const applyEstimateResult = useCallback((res: EstimateResponse, mode: PackingMode) => {
    setResult(res);
    setEstimateMode(mode);
    setEditorOpen(true);
    saveSession(mode, res);
  }, [saveSession]);

  const handleEstimateResult = useCallback((res: EstimateResponse, mode: PackingMode) => {
    if (result && editorOpen) {
      // Result already exists and editor is open — user may have made edits
      pendingResultRef.current = { res, mode };
      Modal.confirm({
        title: 'Replace Current Estimate?',
        content: 'Recalculating will replace all manual edits you made in the Estimate Editor. Continue?',
        okText: 'Replace',
        cancelText: 'Cancel',
        onOk: () => {
          applyEstimateResult(res, mode);
          pendingResultRef.current = null;
        },
        onCancel: () => {
          pendingResultRef.current = null;
        },
      });
    } else {
      applyEstimateResult(res, mode);
    }
  }, [result, editorOpen, applyEstimateResult]);

  // ── Calculate from editor ─────────────────────────────────────────────
  const handleCalculateFromEditor = useCallback(async () => {
    const mode = editorMode;
    if (mode === 'content') {
      const analyzedRooms = photoRooms.filter((r) => r.analyzed || r.usePreset);
      if (analyzedRooms.length === 0) {
        message.warning('Add and analyze at least one room first.');
        return;
      }
      const allSpecialItems = [...new Set(analyzedRooms.flatMap((r) => r.special_items ?? []))];
      const allCustomSpecialItems = analyzedRooms.flatMap((r) => r.custom_special_items ?? []);
      const res = await packingApi.contentEstimate({
        rooms: analyzedRooms.map((r) => ({
          room_name: r.room_name,
          preset_id: r.preset_id,
          items: r.usePreset ? [] : r.items,
          density: r.density,
          floor: r.floor,
          contamination: r.contamination,
          special_items: r.special_items ?? [],
          custom_special_items: r.custom_special_items ?? [],
          use_preset: r.usePreset,
          preset: r.preset,
          hints: r.hints ?? [],
          hint_volume: r.hint_volume ?? {},
          hint_qty: r.hint_qty ?? {},
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
      return res;
    } else {
      if (rooms.length === 0) {
        message.warning('Add at least one room first.');
        return;
      }
      const aggregatedSpecialItems = [...new Set(rooms.flatMap((r) => r.special_items ?? []))];
      const aggregatedCustomSpecialItems = rooms.flatMap((r) => r.custom_special_items ?? []);
      const res = await packingApi.quickEstimate({
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
      });
      return res;
    }
  }, [editorMode, photoRooms, rooms, settings]);

  // ── Create ScopeIt Estimate ────────────────────────────────────────────
  const handleCreateEstimate = useCallback(async () => {
    if (!activeSessionId) {
      message.warning('Calculate estimate first');
      return;
    }
    await saveSession(estimateMode);
    onCreateEstimate?.(activeSessionId);
  }, [activeSessionId, estimateMode, saveSession, onCreateEstimate]);

  // ── Reset state for new estimate ───────────────────────────────────────
  const resetState = useCallback(() => {
    setRooms([]);
    setPhotoRooms([]);
    setPackoutRooms([]);
    setSettings({ ...DEFAULT_SETTINGS });
    setClientInfo(defaultClientInfo());
    setCompanyOverride(defaultCompanyOverride());
    setActiveSessionId(undefined);
    setResult(null);
    setEditorOpen(false);
    createFailedRef.current = false;
  }, []);

  // ── New estimate flow ──────────────────────────────────────────────────
  const handleNewEstimate = () => {
    setModePickerOpen(true);
  };

  const handleSelectMode = (mode: PackingMode) => {
    setModePickerOpen(false);
    resetState();
    setEditorMode(mode);
    setEstimateMode(mode);
    setView('editor');
  };

  // ── Load session from list ─────────────────────────────────────────────
  const handleLoadEstimate = useCallback(async (session: any) => {
    resetState();
    // Fetch full session data (list endpoint strips heavy photo data for performance)
    let d = session.data;
    try {
      const fullSession = await toolService.getSession(session.id);
      d = fullSession.data as any;
    } catch {
      // Fall back to list data if fetch fails
    }
    if (d?.rooms) setRooms(d.rooms);
    if (d?.photo_rooms) setPhotoRooms(d.photo_rooms);
    if (d?.packout_rooms) setPackoutRooms(d.packout_rooms);
    if (d?.packout_settings) setPackoutSettings(d.packout_settings);
    if (d?.settings) setSettings(d.settings);
    if (d?.client_info) setClientInfo(d.client_info);
    if (d?.company_override) setCompanyOverride(d.company_override);
    if (d?.result) {
      setResult(d.result);
      setEstimateMode(d.mode || 'quick');
      setEditorOpen(true);
    }
    setActiveSessionId(session.id);
    setEditorMode(d?.mode === 'content' ? 'content' : d?.mode === 'packout' ? 'packout' : 'quick');
    setView('editor');
  }, [resetState]);

  // ── Back to list ───────────────────────────────────────────────────────
  const handleBackToList = useCallback(() => {
    setView('list');
    setHistoryKey((k) => k + 1); // force refresh
  }, []);

  // ── Render: List View ──────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div style={{ width: '100%', maxWidth: '100%', padding: 0 }}>
        <Tabs
          defaultActiveKey="estimates"
          size="large"
          style={{ fontFamily: fonts.heading }}
          tabBarStyle={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: colors.bgLight,
            marginBottom: 0,
            paddingLeft: isMobile ? 8 : 16,
            paddingRight: isMobile ? 8 : 16,
          }}
          tabBarExtraContent={
            <Space size={6}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => setHistoryKey((k) => k + 1)}
                style={{
                  borderRadius: borderRadius.base,
                  borderColor: colors.border,
                  color: colors.textSecondary,
                  minWidth: 32,
                  minHeight: 32,
                }}
              >
                {!isMobile && 'Refresh'}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleNewEstimate}
                style={{
                  background: colors.primary,
                  borderColor: colors.primary,
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  borderRadius: borderRadius.base,
                  minHeight: 32,
                }}
              >
                {isMobile ? 'New' : 'New Estimate'}
              </Button>
            </Space>
          }
          items={[
            {
              key: 'estimates',
              label: 'Estimates',
              children: (
                <HistoryTab
                  key={historyKey}
                  onLoadEstimate={handleLoadEstimate}
                />
              ),
            },
            {
              key: 'prices',
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <DollarOutlined /> Prices
                </span>
              ),
              children: <PricesTab />,
            },
          ]}
        />

        {/* Mode Picker Modal */}
        <Modal
          open={modePickerOpen}
          onCancel={() => setModePickerOpen(false)}
          footer={null}
          width={isMobile ? '100%' : 480}
          centered
          styles={{
            body: { padding: isMobile ? '16px' : '24px' },
            content: { borderRadius: isMobile ? borderRadius.base : borderRadius.lg },
          }}
        >
          <Title
            level={5}
            style={{
              margin: '0 0 4px',
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: colors.textPrimary,
            }}
          >
            New Estimate
          </Title>
          <Text style={{ fontSize: 13, color: colors.textSecondary, display: 'block', marginBottom: 20 }}>
            Choose an estimation method to get started.
          </Text>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Quick Estimate option */}
            <Card
              hoverable
              onClick={() => handleSelectMode('quick')}
              style={{
                borderRadius: borderRadius.lg,
                border: `1.5px solid ${colors.border}`,
                cursor: 'pointer',
              }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: borderRadius.md,
                    background: '#f0fdf4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ThunderboltOutlined style={{ fontSize: 20, color: '#16a34a' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    strong
                    style={{
                      fontSize: 15,
                      fontFamily: fonts.heading,
                      color: colors.textPrimary,
                      display: 'block',
                      marginBottom: 2,
                    }}
                  >
                    Quick Estimate
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    Room presets with content hints. Fast and reliable.
                  </Text>
                </div>
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 11,
                    background: '#f0fdf4',
                    borderColor: '#bbf7d0',
                    color: '#16a34a',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  Free
                </Tag>
              </div>
            </Card>

            {/* Photo AI option */}
            <Card
              hoverable
              onClick={() => handleSelectMode('content')}
              style={{
                borderRadius: borderRadius.lg,
                border: `1.5px solid ${colors.border}`,
                cursor: 'pointer',
              }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: borderRadius.md,
                    background: '#eff6ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CameraOutlined style={{ fontSize: 20, color: '#2563eb' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    strong
                    style={{
                      fontSize: 15,
                      fontFamily: fonts.heading,
                      color: colors.textPrimary,
                      display: 'block',
                      marginBottom: 2,
                    }}
                  >
                    Photo AI
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    Upload room photos. AI detects items automatically.
                  </Text>
                </div>
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 11,
                    background: '#eff6ff',
                    borderColor: '#bfdbfe',
                    color: '#2563eb',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  Beta
                </Tag>
              </div>
            </Card>

            {/* Packout option */}
            <Card
              hoverable
              onClick={() => handleSelectMode('packout')}
              style={{
                borderRadius: borderRadius.lg,
                border: `1.5px solid ${colors.border}`,
                cursor: 'pointer',
              }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: borderRadius.md,
                    background: '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <InboxOutlined style={{ fontSize: 20, color: '#d97706' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    strong
                    style={{
                      fontSize: 15,
                      fontFamily: fonts.heading,
                      color: colors.textPrimary,
                      display: 'block',
                      marginBottom: 2,
                    }}
                  >
                    Packout
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    Box counts, non-boxable items, storage & labor calculation.
                  </Text>
                </div>
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 11,
                    background: '#fef3c7',
                    borderColor: '#fde68a',
                    color: '#d97706',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  New
                </Tag>
              </div>
            </Card>
          </div>
        </Modal>
      </div>
    );
  }

  // ── Render: Editor View ──────────────────────────────────────────────────
  const editorContent = editorMode === 'content' ? (
    <PhotoAITab
      presets={presets}
      presetsLoading={presetsLoading}
      photoRooms={photoRooms}
      setPhotoRooms={setPhotoRooms}
      settings={settings}
      setSettings={setSettings}
      clientInfo={clientInfo}
      setClientInfo={setClientInfo}
      companyOverride={companyOverride}
      setCompanyOverride={setCompanyOverride}
      onEstimateResult={(res) => handleEstimateResult(res, 'content')}
      activeSessionId={activeSessionId}
    />
  ) : editorMode === 'packout' ? (
    <PackoutTab
      packoutRooms={packoutRooms}
      setPackoutRooms={setPackoutRooms}
      packoutSettings={packoutSettings}
      setPackoutSettings={setPackoutSettings}
      settings={settings}
      setSettings={setSettings}
      clientInfo={clientInfo}
      setClientInfo={setClientInfo}
      companyOverride={companyOverride}
      setCompanyOverride={setCompanyOverride}
      onEstimateResult={(res) => handleEstimateResult(res, 'packout')}
      photoRooms={photoRooms}
    />
  ) : (
    <QuickEstimateTab
      presets={presets}
      presetsLoading={presetsLoading}
      rooms={rooms}
      setRooms={setRooms}
      settings={settings}
      setSettings={setSettings}
      clientInfo={clientInfo}
      setClientInfo={setClientInfo}
      companyOverride={companyOverride}
      setCompanyOverride={setCompanyOverride}
      onEstimateResult={(res) => handleEstimateResult(res, 'quick')}
      activeSessionId={activeSessionId}
    />
  );

  return (
    <div style={{ width: '100%', maxWidth: '100%', padding: 0 }}>
      {/* Editor header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgLight,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleBackToList}
          style={{ color: colors.textSecondary, fontWeight: 500 }}
        >
          Back
        </Button>
        <div
          style={{
            width: 1,
            height: 20,
            background: colors.border,
          }}
        />
        {editorMode === 'content' ? (
          <Tag
            icon={<CameraOutlined />}
            style={{
              borderRadius: borderRadius.full,
              fontSize: 12,
              fontFamily: fonts.body,
              background: '#eff6ff',
              borderColor: '#bfdbfe',
              color: '#2563eb',
              margin: 0,
              fontWeight: 600,
            }}
          >
            Photo AI
          </Tag>
        ) : editorMode === 'packout' ? (
          <Tag
            icon={<InboxOutlined />}
            style={{
              borderRadius: borderRadius.full,
              fontSize: 12,
              fontFamily: fonts.body,
              background: '#fef3c7',
              borderColor: '#fde68a',
              color: '#d97706',
              margin: 0,
              fontWeight: 600,
            }}
          >
            Packout
          </Tag>
        ) : (
          <Tag
            icon={<ThunderboltOutlined />}
            style={{
              borderRadius: borderRadius.full,
              fontSize: 12,
              fontFamily: fonts.body,
              background: '#f0fdf4',
              borderColor: '#bbf7d0',
              color: '#16a34a',
              margin: 0,
              fontWeight: 600,
            }}
          >
            Quick Estimate
          </Tag>
        )}
        {clientInfo.name && !isMobile && (
          <Text style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            {clientInfo.name}
          </Text>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setEditorOpen(true)}
            size="small"
            type={result ? 'primary' : 'default'}
            style={{
              borderRadius: borderRadius.base,
              ...(result ? { background: colors.primary, borderColor: colors.primary } : {}),
            }}
          >
            {result ? 'View Estimate' : 'Estimate Editor'}
          </Button>
          {activeSessionId && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsModalOpen(true)}
              size="small"
              style={{ borderRadius: borderRadius.base }}
            >
              {!isMobile && 'Settings'}
            </Button>
          )}
        </div>
      </div>

      {/* Settings Modal (edit mode) */}
      <Modal
        title="Estimate Settings"
        open={settingsModalOpen}
        onCancel={() => setSettingsModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setSettingsModalOpen(false)} style={{ background: colors.primary, borderColor: colors.primary }}>
            Done
          </Button>
        }
        width={isMobile ? '100%' : 680}
        style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', paddingBottom: 0 } : undefined}
        destroyOnHidden={false}
      >
        <div style={{ padding: '12px 0' }}>
          <SharedDetailsStep
            compact
            settings={settings}
            setSettings={setSettings}
            clientInfo={clientInfo}
            setClientInfo={setClientInfo}
            companyOverride={companyOverride}
            setCompanyOverride={setCompanyOverride}
          />
        </div>
      </Modal>

      {/* Wizard content */}
      {editorContent}

      {/* Estimate Editor Modal */}
      <EstimateEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        result={result}
        setResult={setResult}
        mode={estimateMode}
        clientInfo={clientInfo}
        setClientInfo={setClientInfo}
        companyOverride={companyOverride}
        setCompanyOverride={setCompanyOverride}
        activeSessionId={activeSessionId}
        onCreateEstimate={onCreateEstimate ? handleCreateEstimate : undefined}
        onSaveSession={() => saveSession(estimateMode)}
        onCalculate={handleCalculateFromEditor}
        photoRooms={photoRooms}
        rooms={rooms}
      />
    </div>
  );
};

export default PackingTool;
