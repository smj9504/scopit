/**
 * Scopit - Packing & Moving Estimator
 * Landing = session list. "New Estimate" opens mode picker then wizard.
 * Click existing session → edit mode.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useBlocker, type BlockerFunction } from 'react-router-dom';
import {
  Button,
  Modal,
  Card,
  Tag,
  Typography,
  Space,
  Switch,
  App,
  Tabs,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  ThunderboltOutlined,
  CameraOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DollarOutlined,
  LockOutlined,
  SettingOutlined,
  InboxOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { toolService } from '@/services/toolService';
import { packingApi } from './packingApi';
import { DEFAULT_SETTINGS } from './constants';
import { QuickEstimateTab } from './QuickEstimateTab';
import { PhotoAITab } from './PhotoAITab';
import { SharedDetailsStep } from './SharedDetailsStep';
import { HistoryTab } from './HistoryTab';
import { PricesTab } from './PricesTab';
import { EstimateEditorModal } from './EstimateEditorModal';
import { derivePackingStatus } from './sessionStatus';
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
  MaterialsMode,
} from './types';

const { Text, Title } = Typography;

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultClientInfo(): ClientInfo {
  return {
    name: '', phone: '', email: '',
    property_address_line1: '', property_address_line2: '',
    property_city: '', property_state: '', property_zipcode: '',
  };
}

function defaultCompanyOverride(): CompanyInfoOverride {
  return { name: '', address_line1: '', city: '', state: '', zipcode: '', phone: '', email: '' };
}

type ViewState = 'list' | 'editor';

// ── Main Component ───────────────────────────────────────────────────────────

interface LinkedDocRef {
  id: string;
  number: string;
}

const PackingTool: React.FC<ToolComponentProps> = ({ sessionId, onCreateEstimate }) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // View state: list (default) or editor (wizard)
  const [view, setView] = useState<ViewState>(sessionId ? 'editor' : 'list');
  const viewRef = useRef(view);
  viewRef.current = view;
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
  // Photo AI materials calculation method — % of pack-out labor (default) or
  // itemized. A per-estimate choice, not a saved setting; seeded from
  // result.materials_mode on load so it survives reload for free.
  const [materialsMode, setMaterialsMode] = useState<MaterialsMode>('pct_of_labor');
  // Packout rooms — retired mode; state kept only so old sessions with
  // mode: 'packout' still load and display read-only (see editorContent below).
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

  // Completion tracking — separate from "has a calculated result" (see saveEstimate/derivePackingStatus)
  const [manuallyCompleted, setManuallyCompleted] = useState(false);
  const [linkedEstimate, setLinkedEstimate] = useState<LinkedDocRef | null>(null);
  const [linkedInvoice, setLinkedInvoice] = useState<LinkedDocRef | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [estimateMode, setEstimateMode] = useState<PackingMode>('quick');

  // History refresh trigger
  const [historyKey, setHistoryKey] = useState(0);

  // ── Explicit save / dirty tracking ──────────────────────────────────────
  // AI photo results and estimate data (rooms/packout/settings/result) save
  // independently via merge-PATCH, so neither clobbers the other's unsaved
  // in-memory edits. Nothing auto-saves — the user must hit Save.
  const [savingPhotoRooms, setSavingPhotoRooms] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);
  // State (not refs) so that syncing a baseline after restore/load/reset or a
  // successful save always triggers the re-render that clears the dirty flag.
  const [photoRoomsBaseline, setPhotoRoomsBaseline] = useState('[]');
  const [estimateBaseline, setEstimateBaseline] = useState('');
  // Set after restore/load/reset finish spreading state across several
  // setState calls — the effect below syncs baselines once those commit,
  // instead of comparing against a fingerprint captured mid-load.
  const pendingBaselineSyncRef = useRef(false);

  const photoRoomsFingerprint = useMemo(
    () => JSON.stringify(photoRooms.map(({ photos, ...rest }) => ({ ...rest, photoCount: photos.length }))),
    [photoRooms],
  );
  const estimateFingerprint = useMemo(
    () => JSON.stringify({
      rooms, packoutRooms, packoutSettings, settings, clientInfo, companyOverride,
      result, manuallyCompleted, linkedEstimate, linkedInvoice,
    }),
    [rooms, packoutRooms, packoutSettings, settings, clientInfo, companyOverride, result, manuallyCompleted, linkedEstimate, linkedInvoice],
  );
  const photoRoomsDirty = view === 'editor' && photoRoomsFingerprint !== photoRoomsBaseline;
  const estimateDirty = view === 'editor' && estimateFingerprint !== estimateBaseline;
  const isDirty = photoRoomsDirty || estimateDirty;

  useEffect(() => {
    if (!pendingBaselineSyncRef.current) return;
    pendingBaselineSyncRef.current = false;
    setPhotoRoomsBaseline(photoRoomsFingerprint);
    setEstimateBaseline(estimateFingerprint);
  });

  // ── Load presets on mount ──────────────────────────────────────────────
  useEffect(() => {
    packingApi.getPresets().then(setPresets).catch(() => {
      message.error('Failed to load room presets');
    }).finally(() => setPresetsLoading(false));
  }, []);

  // Set right before we backfill the URL after creating a session for an
  // estimate the user is already mid-editing (ensureSessionId) — tells the
  // restore effect below to skip its fetch+reset for that one transition,
  // since there's nothing to restore and doing so would wipe the user's
  // in-progress unsaved edits.
  const skipNextRestoreRef = useRef(false);

  // ── Restore session (URL is the source of truth for which session is open) ──
  // Fires on mount and whenever the `sessionId` prop changes — i.e. every
  // in-app navigation to /app/tools/packing/:sessionId (from the list, from
  // an external deep-link, or via browser back/forward) as well as a hard
  // refresh. Always resets first so switching directly between two sessions
  // never merges stale fields from the previous one.
  useEffect(() => {
    if (!sessionId) {
      if (viewRef.current === 'editor') setHistoryKey((k) => k + 1); // force list refresh
      setView('list');
      return;
    }
    if (skipNextRestoreRef.current) {
      skipNextRestoreRef.current = false;
      setActiveSessionId(sessionId);
      setView('editor');
      return;
    }
    resetState();
    setActiveSessionId(sessionId);
    setView('editor');
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
      if (d?.packout_rooms) setPackoutRooms(d.packout_rooms);
      if (d?.packout_settings) setPackoutSettings(d.packout_settings);
      if (d?.settings) setSettings(d.settings);
      if (d?.client_info) setClientInfo(d.client_info);
      if (d?.company_override) setCompanyOverride(d.company_override);
      if (d?.result) {
        setResult(d.result);
        setMaterialsMode(d.result.materials_mode === 'itemized' ? 'itemized' : 'pct_of_labor');
        setEditorOpen(true);
      }
      setManuallyCompleted(!!d?.manually_completed);
      setLinkedEstimate(d?.linked_estimate_id ? { id: d.linked_estimate_id, number: d.linked_estimate_number ?? '' } : null);
      setLinkedInvoice(d?.linked_invoice_id ? { id: d.linked_invoice_id, number: d.linked_invoice_number ?? '' } : null);
      const mode = d?.mode === 'content' ? 'content' : d?.mode === 'packout' ? 'packout' : 'quick';
      setEditorMode(mode);
      setEstimateMode(mode);
      // Re-set in case the session was created after this effect started
      // (ensureSessionId races) so the id stays correct.
      setActiveSessionId(sessionId);
      pendingBaselineSyncRef.current = true;
    }).catch(() => {
      message.error('Failed to load estimate.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Session creation (shared by both save paths below) ──────────────────
  const sessionCreationRef = useRef<Promise<string> | null>(null);

  const ensureSessionId = useCallback((mode: PackingMode): Promise<string> => {
    if (activeSessionId) return Promise.resolve(activeSessionId);
    if (sessionCreationRef.current) return sessionCreationRef.current;
    const modeLabel = mode === 'content' ? 'Photo AI' : mode === 'packout' ? 'Packout' : 'Quick';
    const promise = toolService.createSession({
      tool_id: 'packing',
      name: clientInfo.name ? `${clientInfo.name} - ${modeLabel}` : `${modeLabel} Estimate`,
      data: { mode },
    }).then((session) => {
      setActiveSessionId(session.id);
      // Backfill the URL now that this new estimate has an id, so refresh
      // and browser back/forward work from this point on. `replace: true`
      // avoids leaving a dangling history entry for the brief "new estimate,
      // no id yet" moment. The restore effect would otherwise treat this
      // sessionId change as "load session X" and wipe the in-progress edits
      // the user just made — skip it for this one self-inflicted transition.
      skipNextRestoreRef.current = true;
      navigate(`/app/tools/packing/${session.id}`, { replace: true });
      return session.id;
    }).finally(() => {
      sessionCreationRef.current = null;
    });
    sessionCreationRef.current = promise;
    return promise;
  }, [activeSessionId, clientInfo.name, navigate]);

  // ── Save: AI photo analysis results (Photo AI tab) ──────────────────────
  // Explicit only — lets users delete photos or re-run analysis freely
  // without anything being persisted until they choose to save.
  const savePhotoRooms = useCallback(async () => {
    const snapshot = photoRoomsFingerprint;
    setSavingPhotoRooms(true);
    try {
      // Ensure all in-memory photos are uploaded to storage before saving.
      // Upload any photos that don't yet have a corresponding photo_key.
      const lightPhotoRooms = await Promise.all(photoRooms.map(async (r) => {
        let keys = [...(r.photo_keys ?? [])];
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
      const id = await ensureSessionId(editorMode);
      await toolService.updateSession(id, { data: { mode: editorMode, photo_rooms: lightPhotoRooms }, merge: true });
      setPhotoRoomsBaseline(snapshot);
      message.success('AI analysis results saved.');
      return true;
    } catch {
      message.error('Failed to save AI analysis results.');
      return false;
    } finally {
      setSavingPhotoRooms(false);
    }
  }, [photoRooms, photoRoomsFingerprint, ensureSessionId, editorMode, message]);

  // ── Save: estimate data (rooms/packout/settings/result/links) ──────────
  const saveEstimate = useCallback(async (
    mode: PackingMode,
    resultData?: EstimateResponse,
    linkOverrides?: {
      manually_completed?: boolean;
      linked_estimate?: LinkedDocRef | null;
      linked_invoice?: LinkedDocRef | null;
    },
  ) => {
    const snapshot = estimateFingerprint;
    // Use ref to always get the latest result state (avoids stale closure)
    const currentResult = resultData ?? resultRef.current;
    // Overrides let callers pass freshly-set values in the same tick as their
    // setState call, instead of racing the next render (see resultRef above).
    const currentManuallyCompleted = linkOverrides?.manually_completed ?? manuallyCompleted;
    const currentLinkedEstimate = linkOverrides && 'linked_estimate' in linkOverrides
      ? linkOverrides.linked_estimate : linkedEstimate;
    const currentLinkedInvoice = linkOverrides && 'linked_invoice' in linkOverrides
      ? linkOverrides.linked_invoice : linkedInvoice;
    setSavingEstimate(true);
    try {
      const sessionData = {
        mode,
        status: derivePackingStatus({
          result: currentResult,
          manually_completed: currentManuallyCompleted,
          linked_estimate_id: currentLinkedEstimate?.id,
          linked_invoice_id: currentLinkedInvoice?.id,
        }),
        rooms,
        packout_rooms: packoutRooms,
        packout_settings: packoutSettings,
        settings,
        client_info: clientInfo,
        company_override: companyOverride,
        result: currentResult ?? undefined,
        manually_completed: currentManuallyCompleted,
        linked_estimate_id: currentLinkedEstimate?.id,
        linked_estimate_number: currentLinkedEstimate?.number,
        linked_invoice_id: currentLinkedInvoice?.id,
        linked_invoice_number: currentLinkedInvoice?.number,
      };
      const id = await ensureSessionId(mode);
      await toolService.updateSession(id, { data: sessionData, merge: true });
      setEstimateBaseline(snapshot);
      return true;
    } catch {
      message.error('Failed to save estimate.');
      return false;
    } finally {
      setSavingEstimate(false);
    }
  }, [rooms, packoutRooms, packoutSettings, settings, clientInfo, companyOverride, manuallyCompleted, linkedEstimate, linkedInvoice, estimateFingerprint, ensureSessionId, message]);

  // ── Save everything dirty (used by the unsaved-changes exit guard) ─────
  const saveAll = useCallback(async () => {
    const results = await Promise.all([
      photoRoomsDirty ? savePhotoRooms() : Promise.resolve(true),
      estimateDirty ? saveEstimate(editorMode) : Promise.resolve(true),
    ]);
    return results.every(Boolean);
  }, [photoRoomsDirty, estimateDirty, savePhotoRooms, saveEstimate, editorMode]);

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
  // True once the user hand-edits something inside the Estimate Editor (line
  // edits, O&P, labor hours, etc). Re-running "Generate Estimate" — e.g. after
  // re-analyzing a single room's photos — only needs a confirmation when it
  // would actually discard edits like that; a plain refresh should not
  // interrupt the user just because the modal happened to be closed.
  const hasManualEditsRef = useRef(false);

  const applyEstimateResult = useCallback((res: EstimateResponse, mode: PackingMode) => {
    setResult(res);
    setEstimateMode(mode);
    setEditorOpen(true);
    hasManualEditsRef.current = false;
    // Generating an estimate is a natural "finalize" point — persist
    // whichever of the two independent buckets fed into it.
    if (mode === 'content') savePhotoRooms();
    saveEstimate(mode, res);
  }, [saveEstimate, savePhotoRooms]);

  const handleEstimateResult = useCallback((res: EstimateResponse, mode: PackingMode) => {
    if (result && hasManualEditsRef.current) {
      // Existing result has unsaved manual edits that a fresh generate would
      // wipe out — let the user explicitly pick recalculate vs. keep viewing
      // what they already have, right here instead of a hard-to-notice
      // header button.
      pendingResultRef.current = { res, mode };
      Modal.confirm({
        title: 'You Have Unsaved Estimate Edits',
        content: 'Recalculating will replace the manual edits you made in the Estimate Editor with fresh numbers from your rooms.',
        okText: 'Recalculate & Replace',
        cancelText: 'View Current Estimate',
        onOk: () => {
          applyEstimateResult(res, mode);
          pendingResultRef.current = null;
        },
        onCancel: () => {
          setEditorOpen(true);
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
    if (mode === 'packout') {
      // Retired mode — recalculation isn't available; switch to Quick
      // Estimate or Photo AI to generate a new estimate for this session.
      message.warning('Packout mode has been retired. Switch to Quick Estimate or Photo AI to recalculate.');
      return;
    }
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
        materials_mode: materialsMode,
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
  }, [editorMode, photoRooms, rooms, settings, materialsMode]);

  // ── Create Scopit Estimate ────────────────────────────────────────────
  // Ref (not just the `creatingEstimate` state) guards re-entrancy: a fast
  // double-click can fire a second call before React re-renders the button
  // into its disabled/loading state, so the state alone isn't enough.
  const [creatingEstimate, setCreatingEstimate] = useState(false);
  const creatingEstimateRef = useRef(false);

  const runCreateEstimate = useCallback(async (updateExisting: boolean) => {
    if (!activeSessionId) {
      message.warning('Calculate estimate first');
      return;
    }
    if (creatingEstimateRef.current) return;
    creatingEstimateRef.current = true;
    setCreatingEstimate(true);
    try {
      await saveEstimate(estimateMode);
      const res = await toolService.createEstimateFromSession(activeSessionId, {
        customer_name: clientInfo.name || undefined,
        title: clientInfo.property_address_line1
          ? `Packing & Moving - ${[clientInfo.property_address_line1, clientInfo.property_city].filter(Boolean).join(', ')}`
          : 'Packing & Moving Estimate',
        update_existing: updateExisting,
      });
      message.success(res.updated ? `Estimate ${res.estimateNumber} updated` : `Estimate ${res.estimateNumber} created`);
      const linked: LinkedDocRef = { id: res.estimateId, number: res.estimateNumber };
      setLinkedEstimate(linked);
      await saveEstimate(estimateMode, undefined, { linked_estimate: linked });
      onCreateEstimate?.(activeSessionId);
      navigate(`/app/estimates/${res.estimateId}`);
    } catch {
      message.error(updateExisting ? 'Failed to update estimate' : 'Failed to create estimate');
    } finally {
      creatingEstimateRef.current = false;
      setCreatingEstimate(false);
    }
  }, [activeSessionId, estimateMode, saveEstimate, onCreateEstimate, clientInfo, navigate]);

  const handleCreateEstimate = useCallback(async () => {
    if (!activeSessionId) {
      message.warning('Calculate estimate first');
      return;
    }
    if (creatingEstimateRef.current) return;
    if (linkedEstimate) {
      let modalRef: { destroy: () => void } | undefined;
      modalRef = Modal.confirm({
        title: 'Estimate already created',
        content: `This session is already linked to Estimate ${linkedEstimate.number}. Do you want to update it with the current data, or create a brand new estimate?`,
        okText: 'Update Existing',
        cancelText: 'Create New',
        onOk: () => runCreateEstimate(true),
        onCancel: () => runCreateEstimate(false),
        okButtonProps: { type: 'primary' },
        cancelButtonProps: { type: 'default' },
        footer: (_, { OkBtn, CancelBtn }) => (
          <>
            <Button onClick={() => modalRef?.destroy()}>Cancel</Button>
            <CancelBtn />
            <OkBtn />
          </>
        ),
      });
      return;
    }
    await runCreateEstimate(false);
  }, [activeSessionId, linkedEstimate, runCreateEstimate]);

  // ── Manually mark this estimate as completed/draft ─────────────────────
  const handleToggleManuallyCompleted = useCallback((checked: boolean) => {
    setManuallyCompleted(checked);
    saveEstimate(estimateMode, undefined, { manually_completed: checked });
  }, [estimateMode, saveEstimate]);

  // ── Invoice created from within the Estimate Editor ────────────────────
  const handleInvoiceCreated = useCallback((invoiceId: string, invoiceNumber: string) => {
    const linked: LinkedDocRef = { id: invoiceId, number: invoiceNumber };
    setLinkedInvoice(linked);
    saveEstimate(estimateMode, undefined, { linked_invoice: linked });
  }, [estimateMode, saveEstimate]);

  // ── Reset state for new estimate ───────────────────────────────────────
  const resetState = useCallback(() => {
    setRooms([]);
    setPhotoRooms([]);
    setPackoutRooms([]);
    setMaterialsMode('pct_of_labor');
    setSettings({ ...DEFAULT_SETTINGS });
    setClientInfo(defaultClientInfo());
    setCompanyOverride(defaultCompanyOverride());
    setActiveSessionId(undefined);
    setResult(null);
    setManuallyCompleted(false);
    setLinkedEstimate(null);
    setLinkedInvoice(null);
    setEditorOpen(false);
    pendingBaselineSyncRef.current = true;
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
  // Just navigates — the restore effect (keyed on the `sessionId` prop) does
  // the actual fetch-and-populate, so there's a single load path whether the
  // session was opened from the list, a deep-link, or browser back/forward.
  const handleLoadEstimate = useCallback((session: any) => {
    navigate(`/app/tools/packing/${session.id}`);
  }, [navigate]);

  // ── Back to list ───────────────────────────────────────────────────────
  const handleBackToList = useCallback(() => {
    navigate('/app/tools/packing');
  }, [navigate]);

  // ── Unsaved-changes exit guard ───────────────────────────────────────────
  // Applies to: browser tab close/refresh, in-app navigation to another page
  // (sidebar, etc — via the router blocker), and the tool's own Back button.
  const [navConfirmOpen, setNavConfirmOpen] = useState(false);
  const navProceedRef = useRef<(() => void) | null>(null);
  const navCancelRef = useRef<(() => void) | null>(null);
  // requestNav's own confirmation (used by the Back button) already asked
  // the user once — set right before its proceed() calls navigate() so the
  // router blocker below (which would otherwise see the same dirty pathname
  // change and prompt a second time) skips that one navigation.
  const bypassBlockerRef = useRef(false);

  const requestNav = useCallback((proceed: () => void, cancel?: () => void) => {
    if (!isDirty) {
      proceed();
      return;
    }
    const wrappedProceed = () => {
      bypassBlockerRef.current = true;
      proceed();
    };
    navProceedRef.current = wrappedProceed;
    navCancelRef.current = cancel ?? null;
    setNavConfirmOpen(true);
  }, [isDirty]);

  const guardedBackToList = useCallback(() => {
    requestNav(handleBackToList);
  }, [requestNav, handleBackToList]);

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => {
        if (bypassBlockerRef.current) {
          bypassBlockerRef.current = false;
          return false;
        }
        return isDirty && currentLocation.pathname !== nextLocation.pathname;
      },
      [isDirty],
    ),
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      navProceedRef.current = () => blocker.proceed();
      navCancelRef.current = () => blocker.reset();
      setNavConfirmOpen(true);
    }
  }, [blocker]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleNavCancel = useCallback(() => {
    navCancelRef.current?.();
    navProceedRef.current = null;
    navCancelRef.current = null;
    setNavConfirmOpen(false);
  }, []);

  const handleNavDiscard = useCallback(() => {
    const proceed = navProceedRef.current;
    navProceedRef.current = null;
    navCancelRef.current = null;
    setNavConfirmOpen(false);
    proceed?.();
  }, []);

  const handleNavSave = useCallback(async () => {
    const ok = await saveAll();
    if (!ok) return; // keep the modal open so the user can retry or discard
    const proceed = navProceedRef.current;
    navProceedRef.current = null;
    navCancelRef.current = null;
    setNavConfirmOpen(false);
    proceed?.();
  }, [saveAll]);

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
          </div>
        </Modal>
      </div>
    );
  }

  // ── Render: Editor View ──────────────────────────────────────────────────
  const modeMeta = editorMode === 'content'
    ? { icon: <CameraOutlined />, label: 'AI Analysis', color: '#2563eb' }
    : editorMode === 'packout'
    ? { icon: <InboxOutlined />, label: 'Rooms', color: '#d97706' }
    : { icon: <ThunderboltOutlined />, label: 'Rooms', color: '#16a34a' };
  const isStale = !!(result as any)?._stale;

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
      hasExistingEstimate={!!result}
      onSavePhotoRooms={savePhotoRooms}
      photoRoomsDirty={photoRoomsDirty}
      savingPhotoRooms={savingPhotoRooms}
      materialsMode={materialsMode}
      setMaterialsMode={setMaterialsMode}
    />
  ) : editorMode === 'packout' ? (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <Card style={{ borderRadius: borderRadius.lg, border: `1.5px solid ${colors.border}` }}>
        <Text strong style={{ display: 'block', marginBottom: 8, fontFamily: fonts.heading, fontSize: 15 }}>
          Packout Mode Has Been Retired
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
          This estimate was created with the Packout mode, which is no longer available
          for new estimates. You can still view and export it below, but recalculating
          requires switching to Quick Estimate or Photo AI for a new estimate.
        </Text>
      </Card>
    </div>
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
      hasExistingEstimate={!!result}
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
          padding: '14px 16px',
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
          onClick={guardedBackToList}
          style={{ color: colors.textSecondary, fontWeight: 500, height: 40, fontSize: 14 }}
        >
          Back
        </Button>
        <div
          style={{
            width: 1,
            height: 28,
            background: colors.border,
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: colors.bgSunken,
            padding: 3,
            borderRadius: borderRadius.md,
            fontFamily: fonts.body,
          }}
        >
          <button
            type="button"
            onClick={editorOpen ? () => setEditorOpen(false) : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              border: 'none',
              borderRadius: borderRadius.base,
              fontSize: 14,
              fontFamily: fonts.body,
              cursor: editorOpen ? 'pointer' : 'default',
              background: editorOpen ? 'transparent' : colors.bgWhite,
              color: editorOpen ? colors.textSecondary : modeMeta.color,
              fontWeight: editorOpen ? 500 : 700,
              boxShadow: editorOpen ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {modeMeta.icon}
            {modeMeta.label}
          </button>
          <ArrowRightOutlined style={{ fontSize: 11, color: colors.textMuted, margin: '0 8px' }} />
          <button
            type="button"
            onClick={!editorOpen && result ? () => setEditorOpen(true) : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              border: 'none',
              borderRadius: borderRadius.base,
              fontSize: 14,
              fontFamily: fonts.body,
              cursor: !editorOpen && result ? 'pointer' : 'default',
              background: editorOpen ? colors.bgWhite : 'transparent',
              color: editorOpen ? colors.textPrimary : result ? colors.textSecondary : colors.textMuted,
              fontWeight: editorOpen ? 700 : 500,
              boxShadow: editorOpen ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <DollarOutlined />
            Estimate
          </button>
        </div>
        {clientInfo.name && !isMobile && (
          <div style={{ minWidth: 0, maxWidth: 260, overflow: 'hidden' }}>
            <Text
              style={{
                fontSize: 13,
                color: colors.textPrimary,
                fontFamily: fonts.body,
                fontWeight: 600,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {clientInfo.name}
            </Text>
            {clientInfo.property_address_line1 && (
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  fontFamily: fonts.body,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {[clientInfo.property_address_line1, clientInfo.property_city].filter(Boolean).join(', ')}
              </Text>
            )}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {result && (
            isStale ? (
              <Tag
                color="warning"
                style={{
                  margin: 0,
                  padding: '0 12px',
                  height: 40,
                  fontSize: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
              >
                Needs Recalculation
              </Tag>
            ) : linkedInvoice || linkedEstimate ? (
              <Tag
                color="success"
                style={{
                  margin: 0,
                  padding: '0 12px',
                  height: 40,
                  fontSize: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {linkedInvoice ? `Invoice ${linkedInvoice.number}` : `Estimate ${linkedEstimate!.number}`}
              </Tag>
            ) : (
              <Space size={6}>
                {!isMobile && (
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    {manuallyCompleted ? 'Completed' : 'Draft'}
                  </Text>
                )}
                <Switch checked={manuallyCompleted} onChange={handleToggleManuallyCompleted} />
              </Space>
            )
          )}
          <Tooltip title={estimateDirty ? 'Save estimate changes (rooms, pricing, settings)' : 'No unsaved estimate changes'}>
            <Button
              type={estimateDirty ? 'primary' : 'default'}
              icon={<SaveOutlined />}
              loading={savingEstimate}
              disabled={!estimateDirty}
              onClick={() => saveEstimate(estimateMode)}
              style={{
                borderRadius: borderRadius.base,
                height: 40,
                fontSize: 14,
                ...(estimateDirty ? { background: colors.primary, borderColor: colors.primary } : {}),
              }}
            >
              {!isMobile && (estimateDirty ? 'Save Estimate' : 'Estimate Saved')}
            </Button>
          </Tooltip>
          {activeSessionId && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsModalOpen(true)}
              style={{ borderRadius: borderRadius.base, height: 40, fontSize: 14 }}
            >
              {!isMobile && 'Settings'}
            </Button>
          )}
        </div>
      </div>

      {/* Unsaved changes confirmation (Back button, in-app navigation, browser close/refresh) */}
      <Modal
        title="Unsaved Changes"
        open={navConfirmOpen}
        onCancel={handleNavCancel}
        centered
        footer={[
          <Button key="cancel" onClick={handleNavCancel}>
            Cancel
          </Button>,
          <Button key="discard" danger onClick={handleNavDiscard}>
            Leave Without Saving
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={savingPhotoRooms || savingEstimate}
            onClick={handleNavSave}
            style={{ background: colors.primary, borderColor: colors.primary }}
          >
            Save & Leave
          </Button>,
        ]}
      >
        <Text style={{ color: colors.textSecondary }}>
          {photoRoomsDirty && estimateDirty
            ? 'You have unsaved AI analysis results and estimate changes.'
            : photoRoomsDirty
            ? 'You have unsaved AI analysis results.'
            : 'You have unsaved estimate changes.'}
          {' '}Leaving now will discard them unless you save first.
        </Text>
      </Modal>

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

      {/* Wizard content and Estimate Editor both stay mounted permanently —
          toggled with display, not conditional rendering — so switching
          between them (e.g. to re-analyze a room) never recalculates and
          never resets in-panel settings like tax rate. The breadcrumb above
          is the only navigation control between the two. */}
      <div style={{ display: editorOpen ? 'none' : 'block' }}>
        {editorContent}
      </div>
      <div style={{ display: editorOpen ? 'block' : 'none' }}>
        <EstimateEditorModal
          active={editorOpen}
          result={result}
          setResult={setResult}
          mode={estimateMode}
          clientInfo={clientInfo}
          setClientInfo={setClientInfo}
          companyOverride={companyOverride}
          setCompanyOverride={setCompanyOverride}
          activeSessionId={activeSessionId}
          onCreateEstimate={handleCreateEstimate}
          creatingEstimate={creatingEstimate}
          onInvoiceCreated={handleInvoiceCreated}
          onSaveSession={async () => { await saveEstimate(estimateMode); }}
          onCalculate={handleCalculateFromEditor}
          photoRooms={photoRooms}
          rooms={rooms}
          onDirtyChange={(dirty) => { hasManualEditsRef.current = dirty; }}
        />
      </div>
    </div>
  );
};

export default PackingTool;
