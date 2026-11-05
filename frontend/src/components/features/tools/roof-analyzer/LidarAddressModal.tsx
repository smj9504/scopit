/**
 * Measure a roof by address from free USGS LiDAR.
 * Step 1: address -> the backend returns a shaded LiDAR picture of the block with every building outlined.
 * Step 2: the user confirms (or clicks) the right building -> the backend builds the roof model.
 */
import React, { useState } from 'react';
import { Modal, Input, Button, Alert, Spin } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lidarApi, lidarErrorMessage } from './lidarApi';
import type { LidarLocateResult, LidarMeasureResult } from './lidarApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onMeasured: (result: LidarMeasureResult, address: string) => void;
}

const LidarAddressModal: React.FC<Props> = ({ open, onClose, onMeasured }) => {
  const isMobile = useIsMobile();
  const [address, setAddress] = useState('');
  const [located, setLocated] = useState<LidarLocateResult | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'locate' | 'measure' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLocated(null); setSelectedId(null); setHoverId(null); setError(null); setBusy(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const find = async (value: string) => {
    const q = value.trim();
    if (!q) return;
    setBusy('locate'); setError(null); setLocated(null); setSelectedId(null);
    try {
      const res = await lidarApi.locate(q);
      setLocated(res);
      setSelectedId(res.suggested_id);
    } catch (err) {
      setError(lidarErrorMessage(err, 'Could not look up that address.'));
    } finally {
      setBusy(null);
    }
  };

  const measure = async () => {
    const cand = located?.candidates.find(c => c.id === selectedId);
    if (!located || !cand) return;
    setBusy('measure'); setError(null);
    try {
      const result = await lidarApi.measure(cand.pick.lat, cand.pick.lon);
      onMeasured(result, located.address);
      reset();
      setAddress('');
    } catch (err) {
      setError(lidarErrorMessage(err, 'Could not build a roof model for that building.'));
      setBusy(null);
    }
  };

  const selected = located?.candidates.find(c => c.id === selectedId) || null;
  const size = located?.image.size_px || 360;

  return (
    <Modal
      title="Measure a roof by address"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={isMobile ? '100%' : 560}
      style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', paddingBottom: 0 } : undefined}
      centered={!isMobile}
      maskClosable={!busy}
      destroyOnHidden
    >
      <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12, lineHeight: 1.6 }}>
        Uses free public LiDAR from the USGS 3D Elevation Program (US only). Results are estimates:
        check them on site before ordering materials.
      </div>

      <Input.Search
        placeholder="Street, city, state ZIP"
        value={address}
        onChange={e => setAddress(e.target.value)}
        onSearch={find}
        enterButton="Find"
        size="large"
        disabled={!!busy}
        prefix={<EnvironmentOutlined style={{ color: colors.textMuted }} />}
        autoFocus
      />

      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}

      {busy === 'locate' && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: colors.textSecondary, fontSize: 13 }}>
          <Spin />
          <div style={{ marginTop: 12 }}>Downloading LiDAR for this block. The first lookup in an area can take 30 seconds.</div>
        </div>
      )}

      {located && busy !== 'locate' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: colors.textPrimary, fontWeight: 600, marginBottom: 6 }}>
            {selected ? 'Is the blue building the right one?' : 'Click the building to measure'}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
            {located.address} · shaded LiDAR heights, north up · click another outline to change it
          </div>
          <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: 8, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
            <svg viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', width: '100%', height: 'auto' }} role="img" aria-label="Buildings near the address">
              <image href={located.image.src} x={0} y={0} width={size} height={size} />
              {located.candidates.map(c => {
                const isSel = c.id === selectedId;
                const isHover = c.id === hoverId;
                return (
                  <polygon
                    key={c.id}
                    points={c.outline_px.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill={isSel ? 'rgba(37,99,235,0.28)' : isHover ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)'}
                    stroke={isSel ? '#2563eb' : 'rgba(17,24,39,0.55)'}
                    strokeWidth={isSel ? 2.5 : 1.2}
                    style={{ cursor: busy ? 'default' : 'pointer' }}
                    onMouseEnter={() => setHoverId(c.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => { if (!busy) setSelectedId(c.id); }}
                  >
                    <title>{`${c.plan_sqft.toLocaleString()} sqft footprint`}</title>
                  </polygon>
                );
              })}
              {/* geocoded address point */}
              <g transform={`translate(${located.center_px[0]},${located.center_px[1]})`} style={{ pointerEvents: 'none' }}>
                <circle r={6} fill="#dc2626" stroke="#fff" strokeWidth={2} />
              </g>
            </svg>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.6 }}>
              {selected ? (
                <>
                  <span style={{ fontFamily: fonts.heading, fontWeight: 700, color: colors.textPrimary, fontSize: 14 }}>
                    {selected.plan_sqft.toLocaleString()} sqft
                  </span>{' '}
                  footprint · about {Math.round(selected.height_ft)} ft tall
                </>
              ) : 'No building selected'}
              <div style={{ color: colors.textMuted }}>
                LiDAR: {located.source.project}{located.source.year ? ` (${located.source.year})` : ''}
              </div>
            </div>
            <Button type="primary" size="large" disabled={!selected} loading={busy === 'measure'} onClick={measure} style={{ minHeight: 44 }}>
              {busy === 'measure' ? 'Building roof model' : 'Measure this roof'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default LidarAddressModal;
