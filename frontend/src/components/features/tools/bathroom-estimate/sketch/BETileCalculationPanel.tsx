/**
 * BETileCalculationPanel - the tile zones in the sketch's takeoff
 *
 * One row per zone (its colour on the plan, its name, its SF). A row opens
 * to the zone's tile — material, size, pattern, waste — and how many tiles
 * and boxes that comes to. Only the SF goes to the estimate; the rest is a
 * guide for ordering.
 */

import React, { useCallback, useState } from 'react';
import { InputNumber, Select } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import type {
  BETileSpec,
  BETileZone,
  TileMaterial,
  TilePattern,
  TileSize,
  TileZoneType,
} from '@/types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';

// ── Tile size dimensions (inches) ──
const TILE_SIZE_MAP: Record<TileSize, { w: number; h: number; label: string }> = {
  '4x4': { w: 4, h: 4, label: '4″ × 4″' },
  '6x6': { w: 6, h: 6, label: '6″ × 6″' },
  '12x12': { w: 12, h: 12, label: '12″ × 12″' },
  '12x24': { w: 12, h: 24, label: '12″ × 24″' },
  '18x18': { w: 18, h: 18, label: '18″ × 18″' },
  '24x24': { w: 24, h: 24, label: '24″ × 24″' },
  '3x6_subway': { w: 3, h: 6, label: '3″ × 6″ subway' },
  '4x12_subway': { w: 4, h: 12, label: '4″ × 12″ subway' },
  'custom': { w: 12, h: 12, label: 'Custom' },
};

interface TileCalcResult {
  /** Area with waste */
  totalAreaSF: number;
  tilesNeeded: number;
  /** About 10 SF a box for large tile, 5 SF for small */
  boxesNeeded: number;
}

function calculateTileForZone(zone: BETileZone): TileCalcResult {
  const spec = zone.tileSpec;
  const totalAreaSF = zone.areaSF * (1 + spec.wastePct / 100);
  const tileInfo = TILE_SIZE_MAP[spec.size] ?? TILE_SIZE_MAP['12x12'];
  const tileSF = (tileInfo.w * tileInfo.h) / 144;
  const boxSF = tileSF > 0.5 ? 10 : 5;
  return {
    totalAreaSF: Math.round(totalAreaSF * 10) / 10,
    tilesNeeded: Math.ceil(totalAreaSF / tileSF),
    boxesNeeded: Math.ceil(totalAreaSF / boxSF),
  };
}

export const ZONE_TYPE_LABELS: Record<TileZoneType, string> = {
  floor: 'Floor',
  wall_full: 'Full wall',
  tub_surround: 'Tub surround',
  tub_deck: 'Tub deck',
  tub_front_panel: 'Tub front panel',
  shower_walls: 'Shower walls',
  shower_floor: 'Shower floor',
  shower_niche: 'Shower niche',
  shower_bench: 'Shower bench',
  shower_curb: 'Shower curb',
  shower_glass_panel: 'Fixed glass panel',
  shower_door: 'Shower door',
  vanity_backsplash: 'Vanity backsplash',
};

/** Glass and doors are measured with the tile but aren't tiled */
export const GLASS_TYPES: ReadonlySet<TileZoneType> = new Set(['shower_glass_panel', 'shower_door']);

/** The zone's plan colour, solid enough to read as a legend swatch */
export const zoneSwatch = (zone: BETileZone) => zone.color.replace(/[\d.]+\)$/, '0.7)');

const Spec: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="bes-field">
    <span className="bes-field-label">{label}</span>
    <div className="bes-field-control">{children}</div>
  </div>
);

const TileZoneDetail: React.FC<{ zone: BETileZone; onChange: (field: keyof BETileSpec, value: any) => void }> = ({ zone, onChange }) => {
  const calc = calculateTileForZone(zone);
  return (
    <div className="bes-tile-detail">
      <Spec label="Material">
        <Select
          aria-label="Tile material"
          value={zone.tileSpec.material}
          onChange={(v: TileMaterial) => onChange('material', v)}
          options={[
            { value: 'porcelain', label: 'Porcelain' },
            { value: 'ceramic', label: 'Ceramic' },
            { value: 'glass', label: 'Glass' },
            { value: 'natural_stone', label: 'Natural stone' },
            { value: 'mosaic', label: 'Mosaic' },
          ]}
        />
      </Spec>
      <Spec label="Size">
        <Select
          aria-label="Tile size"
          value={zone.tileSpec.size}
          onChange={(v: TileSize) => onChange('size', v)}
          options={Object.entries(TILE_SIZE_MAP).map(([value, v]) => ({ value, label: v.label }))}
        />
      </Spec>
      <Spec label="Pattern">
        <Select
          aria-label="Tile pattern"
          value={zone.tileSpec.pattern}
          onChange={(v: TilePattern) => onChange('pattern', v)}
          options={[
            { value: 'straight', label: 'Straight' },
            { value: 'diagonal', label: 'Diagonal (45°)' },
            { value: 'herringbone', label: 'Herringbone' },
            { value: 'subway', label: 'Subway (½ offset)' },
            { value: 'chevron', label: 'Chevron' },
            { value: 'basketweave', label: 'Basketweave' },
          ]}
        />
      </Spec>
      <Spec label="Waste">
        <InputNumber
          aria-label="Waste, percent"
          value={zone.tileSpec.wastePct}
          min={5}
          max={30}
          onChange={(v) => v && onChange('wastePct', v)}
        />
        <span className="bes-unit">%</span>
      </Spec>
      <Spec label="With waste">
        <span className="bes-field-value">{calc.totalAreaSF} SF</span>
      </Spec>
      <Spec label="To order">
        <span className="bes-field-value">{calc.tilesNeeded} tiles, ~{calc.boxesNeeded} boxes</span>
      </Spec>
    </div>
  );
};

interface BETileCalculationPanelProps {
  api: BESketchStateAPI;
  zones: BETileZone[];
}

const BETileCalculationPanel: React.FC<BETileCalculationPanelProps> = ({ api, zones }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  const handleSpecChange = useCallback((zone: BETileZone, field: keyof BETileSpec, value: any) => {
    api.updateTileZone(zone.id, { tileSpec: { ...zone.tileSpec, [field]: value } });
  }, [api]);

  return (
    <>
      {zones.map((zone) => {
        const isGlass = GLASS_TYPES.has(zone.type);
        const open = openId === zone.id;
        const name = ZONE_TYPE_LABELS[zone.type] ?? zone.label;
        if (isGlass) {
          return (
            <div key={zone.id} className="bes-row bes-row--child bes-row--static">
              <span className="bes-swatch" style={{ background: zoneSwatch(zone) }} />
              <span className="bes-row-name">{name}</span>
              <span className="bes-row-value">{zone.areaSF} SF</span>
            </div>
          );
        }
        return (
          <div key={zone.id}>
            <button
              type="button"
              className="bes-row bes-row--child"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : zone.id)}
            >
              <span className="bes-swatch" style={{ background: zoneSwatch(zone) }} />
              <span className="bes-row-name">{name}</span>
              <span className="bes-row-value">{zone.areaSF} SF</span>
              <RightOutlined className="bes-row-chevron" />
            </button>
            {open && <TileZoneDetail zone={zone} onChange={(f, v) => handleSpecChange(zone, f, v)} />}
          </div>
        );
      })}
    </>
  );
};

export default BETileCalculationPanel;
