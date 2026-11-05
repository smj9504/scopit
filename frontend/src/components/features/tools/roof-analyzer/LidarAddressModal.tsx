/**
 * Measure a roof by address from free USGS LiDAR.
 * Step 1: address -> the backend returns a shaded LiDAR picture of the block with every building outlined.
 *         If the survey is only on USGS's download site, the user downloads the tile in the browser
 *         and drops it here; the browser reads it and sends only the points around the address.
 * Step 2: the user confirms (or clicks) the right building -> the backend builds the roof model.
 */
import React, { useState } from 'react';
import { Modal, Input, Button, Alert, Spin, Upload, Progress, Tag } from 'antd';
import { EnvironmentOutlined, DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isNeedsTile, lidarApi, lidarErrorMessage } from './lidarApi';
import type { LidarLocateResult, LidarMeasureResult, LidarNeedsTile } from './lidarApi';
import { TileReadError, extractPoints, readTileHeader, toBase64 } from './tileReader';

interface Props {
  open: boolean;
  onClose: () => void;
  onMeasured: (result: LidarMeasureResult, address: string) => void;
}

interface TileProgress {
  name: string;
  index: number;
  total: number;
  fraction: number;
}

const LidarAddressModal: React.FC<Props> = ({ open, onClose, onMeasured }) => {
  const isMobile = useIsMobile();
  const [address, setAddress] = useState('');
  const [located, setLocated] = useState<LidarLocateResult | null>(null);
  const [needsTile, setNeedsTile] = useState<LidarNeedsTile | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [tileProgress, setTileProgress] = useState<TileProgress | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'locate' | 'tile' | 'measure' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLocated(null); setNeedsTile(null); setUploadId(null); setTileProgress(null);
    setSelectedId(null); setHoverId(null); setError(null); setBusy(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const find = async (value: string) => {
    const q = value.trim();
    if (!q) return;
    reset();
    setBusy('locate');
    try {
      const res = await lidarApi.locate(q);
      if (isNeedsTile(res)) {
        setNeedsTile(res);
      } else {
        setLocated(res);
        setSelectedId(res.suggested_id);
      }
    } catch (err) {
      setError(lidarErrorMessage(err, 'Could not look up that address.'));
    } finally {
      setBusy(null);
    }
  };

  // Read the dropped tile(s) in the browser and send only the points around the address.
  const readTiles = async (files: File[]) => {
    if (!needsTile || busy) return;
    setBusy('tile'); setError(null);
    let id: string | undefined;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setTileProgress({ name: file.name, index: i, total: files.length, fraction: 0 });
        const header = await readTileHeader(file);
        const prep = await lidarApi.prepareTile({
          lat: needsTile.lat,
          lon: needsTile.lon,
          header_b64: toBase64(header.headerBytes),
          evlr_b64: header.evlrBytes ? toBase64(header.evlrBytes) : undefined,
        });
        const { buffer, count } = await extractPoints(file, header, prep.raw_box,
          fraction => setTileProgress({ name: file.name, index: i, total: files.length, fraction }));
        if (count === 0) continue;   // a neighbouring tile that doesn't reach the house
        id = (await lidarApi.uploadTilePoints(prep.prep_id, id, buffer)).upload_id;
      }
      if (!id) {
        throw new TileReadError('The dropped file does not cover this address. Download the tile marked "address is here".');
      }
      const res = await lidarApi.locateTile({
        upload_id: id, address: needsTile.address, lat: needsTile.lat, lon: needsTile.lon,
        project: needsTile.survey.project, year: needsTile.survey.year,
      });
      setUploadId(id);
      setLocated(res);
      setSelectedId(res.suggested_id);
      setNeedsTile(null);
    } catch (err) {
      setError(lidarErrorMessage(err, 'Could not read that tile.'));
    } finally {
      setBusy(null);
      setTileProgress(null);
    }
  };

  const measure = async () => {
    const cand = located?.candidates.find(c => c.id === selectedId);
    if (!located || !cand) return;
    setBusy('measure'); setError(null);
    try {
      const result = await lidarApi.measure(cand.pick.lat, cand.pick.lon, uploadId);
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

      {needsTile && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 1.6, marginBottom: 12 }}>
            The LiDAR for <strong>{needsTile.address}</strong> ({needsTile.survey.project}
            {needsTile.survey.year ? `, ${needsTile.survey.year}` : ''}) is only on the USGS download site,
            so it has to be downloaded once in your browser. One tile covers the whole neighborhood.
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, marginBottom: 6 }}>1. Download the tile</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {needsTile.tiles.map(t => (
              <div key={t.url} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Button icon={<DownloadOutlined />} href={t.url} target="_blank" rel="noopener noreferrer"
                  type={t.contains_address ? 'primary' : 'default'} ghost={t.contains_address} style={{ maxWidth: '100%' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.file}</span>
                </Button>
                <span style={{ fontSize: 12, color: colors.textMuted }}>{t.size_mb} MB</span>
                {t.contains_address
                  ? <Tag color="blue">address is here</Tag>
                  : <span style={{ fontSize: 12, color: colors.textMuted }}>neighbour; only if the house is near its edge</span>}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, marginBottom: 6 }}>2. Drop the downloaded file here</div>
          {busy === 'tile' && tileProgress ? (
            <div style={{ border: `1px dashed ${colors.borderDark}`, borderRadius: 8, padding: '20px 16px' }}>
              <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Reading {tileProgress.name}{tileProgress.total > 1 ? ` (${tileProgress.index + 1} of ${tileProgress.total})` : ''}
              </div>
              <Progress percent={Math.round(tileProgress.fraction * 100)} size="small" />
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
                Read in your browser; only the area around the address is sent to Scopit.
              </div>
            </div>
          ) : (
            <Upload.Dragger
              accept=".laz,.las"
              multiple
              showUploadList={false}
              disabled={!!busy}
              beforeUpload={(file, fileList) => {
                if (file === fileList[0]) readTiles(fileList as unknown as File[]);
                return false;
              }}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">Drop the .laz file here, or click to choose it</p>
              <p className="ant-upload-hint">Usually in your Downloads folder</p>
            </Upload.Dragger>
          )}
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
