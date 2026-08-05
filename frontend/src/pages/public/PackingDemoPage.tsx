/**
 * ScopeIt - Public Packing Estimator Demo
 * Route: /demo/packing  (no authentication required)
 *
 * Renders the REAL production Photo AI screen (PhotoAITab + EstimateEditorModal
 * + SharedDetailsStep, unmodified) so the demo is genuinely identical to the
 * authenticated tool — not a lookalike — and automatically stays in sync with
 * any future changes to those components. What makes it a demo is entirely in
 * demoApiShims.ts: every network call those components make is monkey-patched
 * to hit the public, unauthenticated /api/demo/packing/* endpoints (or return
 * safe empty data) instead of the real, auth-gated backend.
 *
 * Rooms start pre-populated with a couple of sample photo sets (already
 * "analyzed") — visitors can also add their own rooms with their own photos
 * exactly like the real tool. Nothing here is persisted: no database writes,
 * no sessions, no photo uploads to storage. Refreshing the page resets the
 * demo, which is expected.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Breadcrumb, Button, Modal, Typography, App as AntdApp } from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PhotoAITab } from '@/components/features/tools/packing/PhotoAITab';
import { SharedDetailsStep } from '@/components/features/tools/packing/SharedDetailsStep';
import { EstimateEditorModal } from '@/components/features/tools/packing/EstimateEditorModal';
import { DEFAULT_SETTINGS } from '@/components/features/tools/packing/constants';
import type {
  ClientInfo,
  CompanyInfoOverride,
  ContentRoomInput,
  EstimateResponse,
  PackingSettings,
  PhotoRoom,
} from '@/components/features/tools/packing/types';
import { packingApi } from '@/components/features/tools/packing/packingApi';
import {
  fetchDemoFixtures,
  installPackingDemoShims,
  registerDemoFixtures,
  setDemoResult,
} from './packing-demo/demoApiShims';

const { Text } = Typography;

// A fixed, fake "session id" — enables the same UI affordances (Settings
// button, PDF/Excel/Report/Load-Saved buttons) the real tool only shows
// once a session exists. Every one of those actions is shimmed to hit the
// public demo endpoints instead of looking up a real session by this id.
const DEMO_SESSION_ID = 'demo-session';

function defaultClientInfo(): ClientInfo {
  return { name: '', phone: '', email: '', property_address: '' };
}

function defaultCompanyOverride(): CompanyInfoOverride {
  return { name: '', address: '', phone: '', email: '' };
}

function buildFixtureRoom(fixture: Awaited<ReturnType<typeof fetchDemoFixtures>>[number]): PhotoRoom {
  return {
    id: fixture.room_key,
    room_name: fixture.room_name,
    floor: '1st',
    density: 'normal',
    contamination: 'clean',
    photos: fixture.photos.map((p) => p.image),
    photo_keys: [],
    items: fixture.analysis.items,
    low_confidence_items: fixture.analysis.low_confidence_items,
    dismissed_items: [],
    analyzed: true,
    analyzing: false,
    confidence_score: fixture.analysis.confidence_score,
    room_size: fixture.analysis.room_size,
    field_notes: fixture.analysis.field_notes,
    special_items: [],
    custom_special_items: [],
    usePreset: false,
    hints: [],
    hint_volume: {},
    hint_qty: {},
  };
}

const PackingDemoPage: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [photoRooms, setPhotoRooms] = useState<PhotoRoom[]>([]);
  const [settings, setSettings] = useState<PackingSettings>({ ...DEFAULT_SETTINGS });
  const [clientInfo, setClientInfo] = useState<ClientInfo>(defaultClientInfo());
  const [companyOverride, setCompanyOverride] = useState<CompanyInfoOverride>(defaultCompanyOverride());

  const [result, setResult] = useState<EstimateResponse | null>(null);
  const resultRef = useRef(result);
  resultRef.current = result;
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  useEffect(() => {
    setDemoResult(result);
  }, [result]);

  useEffect(() => {
    installPackingDemoShims();
    fetchDemoFixtures()
      .then((fixtures) => {
        registerDemoFixtures(fixtures);
        setPhotoRooms(fixtures.map(buildFixtureRoom));
      })
      .catch(() => setLoadError('Could not load the demo. Please try again shortly.'))
      .finally(() => setLoading(false));
  }, []);

  // ── Calculate — mirrors PackingTool.handleCalculateFromEditor for 'content' mode ──
  const handleCalculate = useCallback(async () => {
    const analyzedRooms = photoRooms.filter((r) => r.analyzed || r.usePreset);
    if (analyzedRooms.length === 0) {
      message.warning('Add and analyze at least one room first.');
      return undefined;
    }
    const allSpecialItems = [...new Set(analyzedRooms.flatMap((r) => r.special_items ?? []))];
    const allCustomSpecialItems = analyzedRooms.flatMap((r) => r.custom_special_items ?? []);
    const roomInputs: ContentRoomInput[] = analyzedRooms.map((r) => ({
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
    }));
    const res = await packingApi.contentEstimate({
      rooms: roomInputs,
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
  }, [photoRooms, settings, message]);

  const handleEstimateResult = useCallback((res: EstimateResponse) => {
    setResult(res);
    setEditorOpen(true);
  }, []);

  const handleStartOver = useCallback(() => {
    setPhotoRooms((prev) => prev.map((r) => ({ ...r, items: [], low_confidence_items: [], analyzed: false })));
    setResult(null);
    setEditorOpen(false);
    fetchDemoFixtures().then((fixtures) => setPhotoRooms(fixtures.map(buildFixtureRoom))).catch(() => {});
  }, []);

  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgLight, padding: 48 }}>
        <Alert type="error" message={loadError} showIcon />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgLight, fontFamily: fonts.body }}>
      <Alert
        type="info"
        showIcon
        banner
        message={
          <span>
            <strong>This is a live demo</strong> of the real Packing Estimator — sample rooms are
            pre-analyzed (no real AI call runs), but every edit, the estimate math, and PDF/Excel
            export are fully real. Nothing here is saved.
          </span>
        }
        action={
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            Back to home
          </Button>
        }
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 64 }}>Loading demo…</div>
      ) : (
        <div style={{ width: '100%', maxWidth: '100%', padding: 0 }}>
          {/* Editor header bar — reproduces PackingTool's editor-view header */}
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
            <Breadcrumb
              items={[
                {
                  title: (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: editorOpen ? colors.textSecondary : '#2563eb',
                      fontWeight: editorOpen ? 500 : 700,
                    }}>
                      <CameraOutlined />
                      AI Analysis
                    </span>
                  ),
                  ...(editorOpen
                    ? { href: '#', onClick: (e: React.MouseEvent) => { e.preventDefault(); setEditorOpen(false); } }
                    : {}),
                },
                {
                  title: (
                    <span style={{
                      color: editorOpen ? colors.textPrimary : result ? colors.textSecondary : colors.textMuted,
                      fontWeight: editorOpen ? 700 : 500,
                    }}>
                      Estimate
                    </span>
                  ),
                  ...(!editorOpen && result
                    ? { href: '#', onClick: (e: React.MouseEvent) => { e.preventDefault(); setEditorOpen(true); } }
                    : {}),
                },
              ]}
              style={{ fontFamily: fonts.body, fontSize: 13 }}
            />
            {clientInfo.name && !isMobile && (
              <Text
                style={{
                  fontSize: 13,
                  color: colors.textSecondary,
                  fontFamily: fonts.body,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 160,
                }}
              >
                {clientInfo.name}
              </Text>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button size="small" onClick={handleStartOver}>
                Start Over
              </Button>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setSettingsModalOpen(true)}
                size="small"
                style={{ borderRadius: borderRadius.base }}
              >
                {!isMobile && 'Settings'}
              </Button>
            </div>
          </div>

          <Modal
            title="Estimate Settings"
            open={settingsModalOpen}
            onCancel={() => setSettingsModalOpen(false)}
            footer={
              <Button
                type="primary"
                onClick={() => setSettingsModalOpen(false)}
                style={{ background: colors.primary, borderColor: colors.primary }}
              >
                Done
              </Button>
            }
            width={isMobile ? '100%' : 680}
            style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', paddingBottom: 0 } : undefined}
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

          {/* Both stay mounted permanently — toggled with display, not
              conditional rendering — so switching back to re-analyze a room
              never resets in-panel settings like tax rate. */}
          <div style={{ display: editorOpen ? 'none' : 'block' }}>
            <PhotoAITab
              presets={{}}
              presetsLoading={false}
              photoRooms={photoRooms}
              setPhotoRooms={setPhotoRooms}
              settings={settings}
              setSettings={setSettings}
              clientInfo={clientInfo}
              setClientInfo={setClientInfo}
              companyOverride={companyOverride}
              setCompanyOverride={setCompanyOverride}
              onEstimateResult={handleEstimateResult}
              activeSessionId={DEMO_SESSION_ID}
              hasExistingEstimate={!!result}
              onSavePhotoRooms={() => {}}
              photoRoomsDirty={false}
              savingPhotoRooms={false}
            />
          </div>
          <div style={{ display: editorOpen ? 'block' : 'none' }}>
            <EstimateEditorModal
              active={editorOpen}
              result={result}
              setResult={setResult}
              mode="content"
              clientInfo={clientInfo}
              setClientInfo={setClientInfo}
              companyOverride={companyOverride}
              setCompanyOverride={setCompanyOverride}
              activeSessionId={DEMO_SESSION_ID}
              onSaveSession={async () => {}}
              onCalculate={handleCalculate}
              photoRooms={photoRooms}
              rooms={[]}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PackingDemoPage;
