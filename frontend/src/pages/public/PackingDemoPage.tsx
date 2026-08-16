/**
 * Scopit - Public Packing Estimator Demo
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
import { Seo } from '@/components/Seo';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Modal, Typography, App as AntdApp } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CameraOutlined,
  DollarOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePageSEO } from '@/hooks/usePageSEO';
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
  return {
    name: 'Sarah Mitchell',
    phone: '(555) 123-4567',
    email: 'sarah.mitchell@example.com',
    property_address_line1: '482 Maple Grove Lane',
    property_city: 'Springfield',
    property_state: 'IL',
    property_zipcode: '62704',
  };
}

function defaultCompanyOverride(): CompanyInfoOverride {
  return {
    name: 'Summit Restoration Services',
    address_line1: '1120 Industrial Pkwy',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62703',
    phone: '(555) 987-6543',
    email: 'office@summitrestoration.example',
  };
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

  usePageSEO({
    title: 'Free Packing Estimate Demo | Scopit',
    description:
      "Try Scopit's AI packing calculator free — snap room photos for an instant pack-out estimate with an insurance-ready breakdown and packing report. No signup.",
    path: '/demo/packing',
  });

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
      <Seo
        title="Free Packing Estimate Demo | Scopit"
        description="Try Scopit's AI packing calculator free — snap room photos for an instant pack-out estimate with an insurance-ready breakdown and packing report. No signup."
        path="/demo/packing"
      />
      <h1
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        Free Packing Estimate Demo — AI Packing Calculator for Pack-Out &amp; Pack-Back Estimates
      </h1>
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
              padding: '14px 16px',
              borderBottom: `1px solid ${colors.border}`,
              background: colors.bgLight,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
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
                  color: editorOpen ? colors.textSecondary : '#2563eb',
                  fontWeight: editorOpen ? 500 : 700,
                  boxShadow: editorOpen ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <CameraOutlined />
                AI Analysis
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
              <Button onClick={handleStartOver} style={{ borderRadius: borderRadius.base, height: 40, fontSize: 14 }}>
                Start Over
              </Button>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setSettingsModalOpen(true)}
                style={{ borderRadius: borderRadius.base, height: 40, fontSize: 14 }}
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
