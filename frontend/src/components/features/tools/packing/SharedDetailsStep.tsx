/**
 * SharedDetailsStep
 * Extracted unified Details step for the packing wizard.
 * Contains: Client Information, Company Override, Estimation Settings, O&P, Contingency.
 * Special Items have been moved to per-room configuration (RoomSpecialItems).
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Row,
  Col,
  Select,
  Input,
  InputNumber,
  Switch,
  Radio,
  Tooltip,
  Button,
  message,
  Popconfirm,
} from 'antd';
import { InfoCircleOutlined, SaveOutlined, DeleteOutlined } from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { REGION_OPTIONS, DEFAULT_SETTINGS } from './constants';
import { packingApi } from './packingApi';
import CustomerSelector from '@/components/features/CustomerSelector';
import type { CustomerData } from '@/components/features/CustomerSelector';
import type { PackingSettings, ClientInfo, CompanyInfoOverride, SavedCompanyProfile } from './types';

// ── Props ────────────────────────────────────────────────────────────────────

export interface SharedDetailsStepProps {
  settings: PackingSettings;
  setSettings: React.Dispatch<React.SetStateAction<PackingSettings>>;
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  /** When true, renders a compact single-section layout (no section titles). */
  compact?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

const SharedDetailsStep: React.FC<SharedDetailsStepProps> = ({
  settings,
  setSettings,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  compact = false,
}) => {
  const [showCompanyOverride, setShowCompanyOverride] = useState(
    !!(companyOverride.name || companyOverride.address || companyOverride.phone || companyOverride.email),
  );

  // Session data (including an active company override) often arrives after
  // this component has already mounted with empty props — re-check whenever
  // the override values actually change so the section auto-expands instead
  // of silently staying collapsed. Never auto-collapses, so a manual toggle
  // off sticks until the override data itself changes again.
  useEffect(() => {
    if (companyOverride.name || companyOverride.address || companyOverride.phone || companyOverride.email) {
      setShowCompanyOverride(true);
    }
  }, [companyOverride.name, companyOverride.address, companyOverride.phone, companyOverride.email]);
  const [profiles, setProfiles] = useState<SavedCompanyProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);

  // Load profiles from DB on mount
  useEffect(() => {
    setProfilesLoading(true);
    packingApi.getCompanyProfiles()
      .then((loaded) => {
        setProfiles(loaded);
        // Auto-show the override section if profiles exist
        if (loaded.length > 0 && !showCompanyOverride) {
          setShowCompanyOverride(true);
        }
      })
      .catch(() => {})
      .finally(() => setProfilesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patchSettings = (patch: Partial<PackingSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const patchCompany = (patch: Partial<CompanyInfoOverride>) => {
    setCompanyOverride((prev) => ({ ...prev, ...patch }));
    setSelectedProfileId(undefined);
  };

  const handleSelectProfile = useCallback((profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    setCompanyOverride(profile.data);
    setSelectedProfileId(profileId);
    setShowCompanyOverride(true);
  }, [profiles, setCompanyOverride]);

  const handleSaveProfile = useCallback(async () => {
    const label = companyOverride.name?.trim();
    if (!label) {
      message.warning('Enter a company name first.');
      return;
    }
    try {
      const saved = await packingApi.saveCompanyProfile(label, companyOverride);
      // Refresh list
      const updated = await packingApi.getCompanyProfiles();
      setProfiles(updated);
      setSelectedProfileId(saved.id);
      message.success(`Saved "${label}"`);
    } catch {
      message.error('Failed to save profile.');
    }
  }, [companyOverride]);

  const handleDeleteProfile = useCallback(async (profileId: string) => {
    try {
      await packingApi.deleteCompanyProfile(profileId);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      if (selectedProfileId === profileId) setSelectedProfileId(undefined);
      message.success('Profile deleted');
    } catch {
      message.error('Failed to delete profile.');
    }
  }, [selectedProfileId]);

  // Convert ClientInfo <-> CustomerData for the CustomerSelector
  const customerData: CustomerData = {
    name: clientInfo.name,
    email: clientInfo.email || undefined,
    phone: clientInfo.phone || undefined,
    address: clientInfo.property_address || undefined,
  };

  const handleCustomerChange = useCallback(
    (data: CustomerData) => {
      setClientInfo({
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        property_address: data.address || '',
      });
    },
    [setClientInfo],
  );

  // ── Shared helpers ─────────────────────────────────────────────────────────

  const sectionCard = (children: React.ReactNode) => (
    <div
      style={{
        background: colors.bgWhite,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: '20px',
      }}
    >
      {children}
    </div>
  );

  const sectionTitle = (text: string) => (
    <h4
      style={{
        fontFamily: fonts.heading,
        fontSize: 14,
        fontWeight: 600,
        color: colors.textPrimary,
        margin: '0 0 16px',
        letterSpacing: '-0.01em',
      }}
    >
      {text}
    </h4>
  );

  const fieldLabel = (text: string, tip?: string) => (
    <label
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: colors.textMuted,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginBottom: 6,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.04em',
      }}
    >
      {text}
      {tip && (
        <Tooltip title={tip}>
          <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted }} />
        </Tooltip>
      )}
    </label>
  );

  const switchRow = (
    label: string,
    tip: string,
    checked: boolean,
    onChange: (val: boolean) => void,
    extra?: React.ReactNode,
  ) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: colors.bgLight,
        borderRadius: borderRadius.md,
        minHeight: 44,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>{label}</span>
        <Tooltip title={tip}>
          <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted }} />
        </Tooltip>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {extra}
        <Switch size="small" checked={checked} onChange={onChange} />
      </div>
    </div>
  );

  // ── Estimation Settings block (reused in both full & compact modes) ──────

  const estimationSettingsBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Row 1: Crew / Region / Staging — flex-wrap reflows by available
          width so it also holds up in the 380px compact sidebar, where
          AntD's Row/Col breakpoints (viewport-based, not container-based)
          would otherwise keep three columns and squeeze "Off-site" until
          it wrapped and overflowed its button. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 140px', minWidth: 140 }}>
          {fieldLabel('Crew Size', 'Number of workers on the job')}
          <Select
            value={settings.crew_size}
            onChange={(val) => patchSettings({ crew_size: val })}
            style={{ width: '100%' }}
            options={[2, 3, 4, 5, 6].map((n) => ({
              value: n,
              label: `${n} workers`,
            }))}
            aria-label="Crew size"
          />
        </div>
        <div style={{ flex: '1 1 140px', minWidth: 140 }}>
          {fieldLabel('Region', 'Affects labor rate multiplier')}
          <Select
            value={settings.region}
            onChange={(val) => patchSettings({ region: val })}
            style={{ width: '100%' }}
            options={REGION_OPTIONS.map((o) => ({
              value: o.value,
              label: `${o.label}  ${o.description}`,
            }))}
            aria-label="Region"
          />
        </div>
        <div style={{ flex: '1 1 160px', minWidth: 160 }}>
          {fieldLabel('Staging')}
          <Radio.Group
            value={settings.staging_type}
            onChange={(e) => patchSettings({ staging_type: e.target.value })}
            optionType="button"
            buttonStyle="solid"
            style={{ width: '100%', display: 'flex' }}
          >
            <Radio.Button
              value="off_site"
              style={{ flex: 1, textAlign: 'center', fontSize: 13, height: 36, lineHeight: '34px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              Off-site
            </Radio.Button>
            <Radio.Button
              value="on_site"
              style={{ flex: 1, textAlign: 'center', fontSize: 13, height: 36, lineHeight: '34px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              On-site
            </Radio.Button>
          </Radio.Group>
        </div>
      </div>

      {/* Row 2: Conditional storage + toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {settings.staging_type === 'off_site' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: colors.bgLight,
              borderRadius: borderRadius.md,
              minHeight: 44,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>Storage Duration</span>
              <Tooltip title="How long contents will be stored">
                <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted }} />
              </Tooltip>
            </div>
            <InputNumber
              min={0}
              max={36}
              value={settings.storage_months}
              onChange={(val) => patchSettings({ storage_months: val ?? 0 })}
              style={{ width: 100 }}
              addonAfter="mo"
              size="small"
              aria-label="Storage months"
            />
          </div>
        )}
        {switchRow(
          'Pack-back',
          'Include return delivery / unpack service',
          settings.include_packback,
          (val) => patchSettings({ include_packback: val }),
        )}
      </div>
    </div>
  );

  // ── O&P block ─────────────────────────────────────────────────────────────

  const opContingencyBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {switchRow(
        'O&P',
        'Overhead & Profit percentage',
        settings.include_op,
        (val) => patchSettings({ include_op: val }),
        settings.include_op ? (
          <InputNumber
            min={0}
            max={30}
            value={settings.op_rate}
            onChange={(val) => patchSettings({ op_rate: val ?? DEFAULT_SETTINGS.op_rate })}
            style={{ width: 80 }}
            addonAfter="%"
            step={0.5}
            size="small"
            aria-label="O&P rate"
          />
        ) : undefined,
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: colors.bgLight,
          borderRadius: borderRadius.md,
          minHeight: 44,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>Material Rate</span>
          <span style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>% of pack-out labor</span>
        </div>
        <InputNumber
          min={10}
          max={40}
          value={settings.material_rate ?? 25}
          onChange={(val) => patchSettings({ material_rate: val ?? 25 })}
          style={{ width: 80 }}
          addonAfter="%"
          step={5}
          size="small"
          aria-label="Material rate"
        />
      </div>

      <p style={{ fontSize: 11, color: colors.textMuted, margin: '4px 0 0', paddingLeft: 2 }}>
        Supplements are auto-detected based on room conditions
      </p>
    </div>
  );

  // ── Company Override block (shared between compact and full modes) ────────

  const companyOverrideBlock = (
    <section>
      {sectionCard(
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: showCompanyOverride ? 16 : 0,
            }}
          >
            <div>
              <h4
                style={{
                  fontFamily: fonts.heading,
                  fontSize: 14,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                Company Override
              </h4>
              {!showCompanyOverride && (
                <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
                  Override company info on the exported estimate
                </p>
              )}
            </div>
            <Switch
              size="small"
              checked={showCompanyOverride}
              onChange={setShowCompanyOverride}
              aria-label="Toggle company override"
            />
          </div>

          {showCompanyOverride && (
            <>
              {/* Saved profiles selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Select
                  placeholder={profilesLoading ? 'Loading...' : 'Select saved company...'}
                  value={selectedProfileId}
                  onChange={handleSelectProfile}
                  loading={profilesLoading}
                  allowClear
                  onClear={() => {
                    setSelectedProfileId(undefined);
                    setCompanyOverride({});
                  }}
                  style={{ flex: 1 }}
                  size="middle"
                  options={profiles.map((p) => ({ value: p.id, label: p.label }))}
                  notFoundContent={
                    <span style={{ fontSize: 12, color: colors.textMuted }}>No saved profiles yet</span>
                  }
                />
                <Tooltip title="Save current as profile">
                  <Button
                    icon={<SaveOutlined />}
                    size="middle"
                    onClick={handleSaveProfile}
                    disabled={!companyOverride.name?.trim()}
                  />
                </Tooltip>
                {selectedProfileId && (
                  <Popconfirm
                    title="Delete this profile?"
                    onConfirm={() => handleDeleteProfile(selectedProfileId)}
                    okText="Delete"
                    cancelText="Cancel"
                  >
                    <Button icon={<DeleteOutlined />} size="middle" danger />
                  </Popconfirm>
                )}
              </div>

              <Row gutter={[12, 12]}>
                <Col xs={24} sm={12}>
                  {fieldLabel('Company Name')}
                  <Input
                    placeholder="Restoration Co."
                    value={companyOverride.name ?? ''}
                    onChange={(e) => patchCompany({ name: e.target.value })}
                    aria-label="Company name override"
                  />
                </Col>
                <Col xs={24} sm={12}>
                  {fieldLabel('Address')}
                  <Input
                    placeholder="456 Business Ave"
                    value={companyOverride.address ?? ''}
                    onChange={(e) => patchCompany({ address: e.target.value })}
                    aria-label="Company address override"
                  />
                </Col>
                <Col xs={24} sm={12}>
                  {fieldLabel('Phone')}
                  <Input
                    placeholder="(555) 111-2222"
                    value={companyOverride.phone ?? ''}
                    onChange={(e) => patchCompany({ phone: e.target.value })}
                    aria-label="Company phone override"
                  />
                </Col>
                <Col xs={24} sm={12}>
                  {fieldLabel('Email')}
                  <Input
                    type="email"
                    placeholder="info@company.com"
                    value={companyOverride.email ?? ''}
                    onChange={(e) => patchCompany({ email: e.target.value })}
                    aria-label="Company email override"
                  />
                </Col>
              </Row>
            </>
          )}
        </>
      )}
    </section>
  );

  // ── Compact mode: settings-only (for edit modal) ─────────────────────────

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section>
          <CustomerSelector value={customerData} onChange={handleCustomerChange} />
        </section>
        {companyOverrideBlock}
        <section>{sectionCard(estimationSettingsBlock)}</section>
        <section>{sectionCard(opContingencyBlock)}</section>
      </div>
    );
  }

  // ── Full mode: wizard step with section titles ───────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Client Information (CustomerSelector) ──── */}
      <section>
        {sectionTitle('Client Information')}
        <CustomerSelector
          value={customerData}
          onChange={handleCustomerChange}
        />
      </section>

      {/* ── Company Override ─────────────────────────────── */}
      {companyOverrideBlock}

      {/* ── Estimation Settings ──────────────────────────── */}
      <section>
        {sectionCard(
          <>
            {sectionTitle('Estimation Settings')}
            {estimationSettingsBlock}
          </>
        )}
      </section>

      {/* ── O&P & Materials ──────────────────────────────── */}
      <section>
        {sectionCard(
          <>
            {sectionTitle('Pricing')}
            {opContingencyBlock}
          </>
        )}
      </section>
    </div>
  );
};

export default SharedDetailsStep;
export { SharedDetailsStep };
