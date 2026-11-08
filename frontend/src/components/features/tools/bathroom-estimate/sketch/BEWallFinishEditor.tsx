/**
 * Which parts of the selected wall are tile — today (to take off) and after
 * the work (to install) — on a drawing of the wall as you'd see it standing
 * in the room. Anything not tiled is drywall; on the "to install" side, it's
 * painted. Tile areas are rectangles: across the wall from its left end, and
 * up from the floor. Tile to install over the whole of a tub or shower
 * surround makes it part of the wall's tile.
 */

import React, { useState } from 'react';
import { Button, Dropdown, InputNumber, Segmented, Tooltip, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { BEFixture, BERoom, BEWall, BEWallTileRegion } from '@/types/bathroomSketch';
import {
  fullWallRegion,
  newRegionId,
  regionRect,
  surroundsAfterWork,
  wainscotRegion,
  wallFinishAreas,
  wallFixtureCovers,
  wallLengthIn,
  wallOpenings,
  wallStartOnLeft,
  wallTileRegions,
  type FaceRect,
  type WallFinishLayer,
} from './utils/wallFinish';

const { Text } = Typography;

// The plan's colours: new tile blue, existing tile (to demo) red-orange
const LAYER_STYLE: Record<WallFinishLayer, { fill: string; stroke: string }> = {
  new: { fill: 'rgba(25, 118, 210, 0.32)', stroke: '#1976d2' },
  existing: { fill: 'rgba(212, 56, 13, 0.22)', stroke: '#d4380d' },
};

const round1 = (n: number) => Math.round(n * 10) / 10;

interface BEWallFinishEditorProps {
  wall: BEWall;
  ppf: number;
  fixtures: BEFixture[];
  rooms: BERoom[];
  onChange: (patch: Partial<BEWall>) => void;
}

const BEWallFinishEditor: React.FC<BEWallFinishEditorProps> = ({ wall, ppf, fixtures, rooms, onChange }) => {
  const [layer, setLayer] = useState<WallFinishLayer>('existing');
  const lengthIn = round1(wallLengthIn(wall, ppf));
  const heightIn = wall.heightInches;
  const startOnLeft = wallStartOnLeft(wall, rooms);
  const regions = wallTileRegions(wall, layer, ppf);
  const otherRegions = wallTileRegions(wall, layer === 'new' ? 'existing' : 'new', ppf);
  const openings = wallOpenings(wall, fixtures, ppf);
  const covers = wallFixtureCovers(wall, fixtures, ppf);
  // To install, tile over a whole surround takes it in
  const surrounds = layer === 'new'
    ? surroundsAfterWork(covers, regions.map(regionRect))
    : { kept: covers, inTile: [] };
  const areas = wallFinishAreas(wall, fixtures, ppf);
  const surroundSF = layer === 'new' ? round1(areas.coveredSF - areas.surroundInTileSF) : areas.coveredSF;

  // Across the wall as drawn: from its left end seen from inside the room
  const shownX = (x0: number, x1: number): [number, number] =>
    startOnLeft ? [x0, x1] : [lengthIn - x1, lengthIn - x0];

  const save = (next: BEWallTileRegion[]) => {
    // Regions read from the older fields get ids of their own once edited
    const list = next.map((r) => (r.id.startsWith('legacy') ? { ...r, id: newRegionId() } : r));
    onChange(layer === 'new'
      ? { tileRegions: list, finish: undefined }
      : { existingTileRegions: list, existingFinish: undefined, existingTileFromInches: undefined, existingTileToInches: undefined });
  };

  const edit = (index: number, field: 'left' | 'right' | 'bottomIn' | 'topIn', value: number | null) => {
    if (value === null) return;
    const next = regions.map((r, i) => {
      if (i !== index) return r;
      if (field === 'bottomIn' || field === 'topIn') return { ...r, [field]: value };
      const [left, right] = shownX(r.startIn, r.endIn);
      const l = field === 'left' ? value : left;
      const rt = field === 'right' ? value : right;
      return startOnLeft
        ? { ...r, startIn: l, endIn: rt }
        : { ...r, startIn: lengthIn - rt, endIn: lengthIn - l };
    });
    save(next);
  };

  const addMenu = {
    items: [
      { key: 'full', label: 'Whole wall' },
      { key: 'w36', label: 'Wainscot to 36″' },
      { key: 'w48', label: 'Wainscot to 48″' },
      { key: 'part', label: 'Part of the wall' },
    ],
    onClick: ({ key }: { key: string }) => {
      const region = key === 'full' ? fullWallRegion(lengthIn, heightIn)
        : key === 'w36' ? wainscotRegion(lengthIn, Math.min(36, heightIn))
          : key === 'w48' ? wainscotRegion(lengthIn, Math.min(48, heightIn))
            // Half the wall, full height, from the left end as seen in the room
            : { id: newRegionId(), bottomIn: 0, topIn: heightIn, ...(startOnLeft
              ? { startIn: 0, endIn: round1(lengthIn / 2) }
              : { startIn: round1(lengthIn / 2), endIn: lengthIn }) };
      save([...regions, region]);
    },
  };

  // ── The wall's face, floor at the bottom ──
  const rect = (r: FaceRect, key: string, style: React.SVGProps<SVGRectElement>, title?: string) => {
    const [x0, x1] = shownX(r.x0, r.x1);
    return (
      <rect key={key} x={x0} y={heightIn - r.y1} width={Math.max(0, x1 - x0)} height={Math.max(0, r.y1 - r.y0)} {...style}>
        {title && <title>{title}</title>}
      </rect>
    );
  };
  const asRect = (r: BEWallTileRegion): FaceRect => ({ x0: r.startIn, x1: r.endIn, y0: r.bottomIn, y1: r.topIn });
  const hairline = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1 };

  return (
    <div style={{ marginBottom: 8 }}>
      <Text type="secondary">Wall finish</Text>
      <Segmented
        block
        size="small"
        style={{ margin: '4px 0 6px' }}
        value={layer}
        onChange={(v) => setLayer(v as WallFinishLayer)}
        options={[
          { value: 'existing', label: 'Existing' },
          { value: 'new', label: 'To install' },
        ]}
      />

      <svg
        viewBox={`-1 -1 ${lengthIn + 2} ${heightIn + 2}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 110, display: 'block', background: '#fff' }}
        role="img"
        aria-label={`Wall face, ${lengthIn} by ${heightIn} inches`}
      >
        {rect({ x0: 0, x1: lengthIn, y0: 0, y1: heightIn }, 'face', { fill: '#f7f7f5', stroke: '#a8a49c', ...hairline }, 'Drywall')}
        {otherRegions.map((r) => rect(asRect(r), `o-${r.id}`, {
          fill: 'none', stroke: LAYER_STYLE[layer === 'new' ? 'existing' : 'new'].stroke, strokeDasharray: '3 3', ...hairline,
        }))}
        {regions.map((r) => rect(asRect(r), r.id, { fill: LAYER_STYLE[layer].fill, stroke: LAYER_STYLE[layer].stroke, ...hairline }, 'Tile'))}
        {surrounds.kept.map((c, i) => rect(c.rect, `c-${i}`, { fill: '#dedad2', stroke: '#a8a49c', ...hairline }, 'Tub / shower surround'))}
        {surrounds.inTile.map((c, i) => rect(c.rect, `ct-${i}`, {
          fill: 'none', stroke: '#a8a49c', strokeDasharray: '2 2', ...hairline,
        }, 'Tub / shower surround, tiled with the wall'))}
        {openings.map((r, i) => rect(r, `d-${i}`, { fill: '#fff', stroke: '#6b7280', strokeDasharray: '4 2', ...hairline }, 'Door / window'))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginTop: 2 }}>
        <span>Left, seen from the room</span>
        <span>{lengthIn}″ × {heightIn}″</span>
      </div>

      {regions.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', margin: '6px 0' }}>
          {layer === 'existing' ? 'All drywall today.' : 'All painted drywall.'}
        </Text>
      ) : (
        <div style={{ margin: '6px 0' }}>
          {regions.map((r, i) => {
            const [left, right] = shownX(r.startIn, r.endIn);
            const num = (value: number, field: 'left' | 'right' | 'bottomIn' | 'topIn', max: number, label: string) => (
              <InputNumber
                size="small"
                min={0}
                max={max}
                step={0.5}
                precision={1}
                value={round1(value)}
                onChange={(v) => edit(i, field, v)}
                style={{ width: 58 }}
                aria-label={label}
              />
            );
            return (
              <div key={r.id} style={{ borderTop: '1px solid #e5e7eb', padding: '4px 0', display: 'grid', gridTemplateColumns: '44px 1fr 24px', alignItems: 'center', rowGap: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Across</Text>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {num(left, 'left', lengthIn, 'From the left, inches')}
                  <Text type="secondary" style={{ fontSize: 11 }}>–</Text>
                  {num(right, 'right', lengthIn, 'To, inches from the left')}
                </span>
                <Tooltip title="Remove this tile area">
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => save(regions.filter((_, j) => j !== i))}
                    aria-label="Remove this tile area"
                    style={{ gridRow: 'span 2' }}
                  />
                </Tooltip>
                <Text type="secondary" style={{ fontSize: 11 }}>Height</Text>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {num(r.bottomIn, 'bottomIn', heightIn, 'From the floor, inches')}
                  <Text type="secondary" style={{ fontSize: 11 }}>–</Text>
                  {num(r.topIn, 'topIn', heightIn, 'Up to, inches from the floor')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Dropdown menu={addMenu} trigger={['click']}>
          <Button size="small" icon={<PlusOutlined />}>Tile area</Button>
        </Dropdown>
        {layer === 'new' && (
          <Tooltip title="Tile exactly where it is today: a like-kind restoration">
            <Button
              size="small"
              icon={<CopyOutlined />}
              disabled={otherRegions.length === 0 && regions.length === 0}
              onClick={() => save(otherRegions.map((r) => ({ ...r, id: newRegionId() })))}
            >
              Same as existing
            </Button>
          </Tooltip>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.6 }}>
        {layer === 'existing' ? (
          <div>Existing tile <strong style={{ color: '#111827' }}>{areas.existingTileSF} SF</strong>{areas.existingTileSF > 0 && ' — demo'}</div>
        ) : (
          <div>
            Tile <strong style={{ color: '#111827' }}>{areas.tileSF} SF</strong>
            {' · '}Paint <strong style={{ color: '#111827' }}>{areas.paintSF} SF</strong>
            {areas.surroundInTileSF > 0 && <div>Includes the tub/shower surround, {areas.surroundInTileSF} SF</div>}
          </div>
        )}
        {(areas.openingSF > 0 || surroundSF > 0) && (
          <div>
            Not counted: {[
              areas.openingSF > 0 && `doors/windows ${areas.openingSF} SF`,
              surroundSF > 0 && `tub/shower surround ${surroundSF} SF`,
            ].filter(Boolean).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};

export default BEWallFinishEditor;
