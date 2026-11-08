/**
 * BESketchSidebar - the panel beside the plan
 *
 * Nothing selected: what to add (fixtures, or a whole layout to start from),
 * the rooms, and the takeoff the estimate gets from the sketch. Something
 * selected: that one thing's settings (BESketchInspector).
 */

import React, { useCallback, useState } from 'react';
import { Button } from 'antd';
import { AppstoreAddOutlined, RightOutlined } from '@ant-design/icons';
import type { BEFixtureType, BEPoint, BESketchTool } from '@/types/bathroomSketch';
import { BE_FIXTURE_DEFAULTS, SOFFIT_BOTTOM_IN } from '@/types/bathroomSketch';
import { cabinetKind } from '../fixtureRows';
import { placeFor } from './utils/hangOnWall';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { FIXTURE_GLYPHS } from './beGlyphs';
import BELayoutPicker from './BELayoutPicker';
import BESketchInspector, { FIXTURE_LABELS, feetInches, findSelection } from './BESketchInspector';
import BETileCalculationPanel, { GLASS_TYPES } from './BETileCalculationPanel';

interface BESketchSidebarProps {
  api: BESketchStateAPI;
  width?: number | string;
  /** In the phone sheet: no edge of its own */
  sheet?: boolean;
}

const ADDABLE: BEFixtureType[] = ['bathtub', 'shower', 'vanity', 'toilet', 'door', 'window', 'mirror', 'light', 'cabinet', 'soffit'];

// The canvas's own colours, so a list row and its zone on the plan match
const DRYWALL_SWATCH = { wall: '#ff9800', ceiling: '#42a5f5' };
const INSULATION_SWATCH = { wall: '#e91e63', ceiling: '#ab47bc' };
const DAMAGE_SWATCH = '#ef5350';

const sf = (n: number) => `${Math.round(n * 10) / 10} SF`;

interface TakeoffItem {
  id: string;
  name: string;
  meta?: string;
  areaSF: number;
  swatch: string;
}

/** One line of the takeoff: its total, opening to the zones behind it */
const TakeoffGroup: React.FC<{
  label: string;
  totalSF: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Nothing yet: what to do about it */
  empty: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, totalSF, count, open, onToggle, empty, children }) => {
  if (count === 0) {
    return (
      <div className="bes-row bes-row--static">
        <span className="bes-row-name">{label}</span>
        {empty}
      </div>
    );
  }
  return (
    <>
      <button type="button" className="bes-row" aria-expanded={open} onClick={onToggle}>
        <span className="bes-row-name">{label}</span>
        <span className="bes-row-value">{sf(totalSF)}</span>
        <RightOutlined className="bes-row-chevron" />
      </button>
      {open && children}
    </>
  );
};

const ZoneRows: React.FC<{ items: TakeoffItem[]; onSelect: (id: string) => void }> = ({ items, onSelect }) => (
  <>
    {items.map((z) => (
      <button key={z.id} type="button" className="bes-row bes-row--child" onClick={() => onSelect(z.id)}>
        <span className="bes-swatch" style={{ background: z.swatch }} />
        <span className="bes-row-name">{z.name}</span>
        {z.meta && <span className="bes-row-meta">{z.meta}</span>}
        <span className="bes-row-value">{sf(z.areaSF)}</span>
      </button>
    ))}
  </>
);

const BESketchSidebar: React.FC<BESketchSidebarProps> = ({ api, width = 300, sheet }) => {
  const { data, selectedId, setSelectedId, setActiveTool, addFixture, updateFixture } = api;
  const ppf = data.settings.pixelsPerFoot;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const selection = findSelection(data, selectedId);

  // New fixtures land in the middle of the bathroom, selected, ready to drag
  const handleAdd = useCallback((type: BEFixtureType) => {
    const room = data.rooms.find((r) => r.roomType === 'bathroom') ?? data.rooms[0];
    let pos: BEPoint = { x: 200, y: 200 };
    if (room && room.boundary.length >= 3) {
      const xs = room.boundary.map((p) => p.x);
      const ys = room.boundary.map((p) => p.y);
      pos = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    const cabinet = cabinetKind('medicine_cabinet');
    const id = addFixture(type, pos, room?.id, undefined, {
      bathtubSubType: type === 'bathtub' ? 'standard_alcove' : undefined,
      showerFloorType: type === 'shower' ? 'tile' : undefined,
      showerWallCount: type === 'shower' ? 3 : undefined,
      showerTileHeight: type === 'shower' ? 96 : undefined,
      showerDoorType: type === 'shower' ? 'sliding' : undefined,
      showerDoorSide: type === 'shower' ? 'front' : undefined,
      lightType: type === 'light' ? 'standard' : undefined,
      cabinetType: type === 'cabinet' ? cabinet.value : undefined,
      cabinetHeight: type === 'cabinet' ? cabinet.heightIn : undefined,
      soffitBottom: type === 'soffit' ? SOFFIT_BOTTOM_IN : undefined,
    }, type === 'cabinet' ? cabinet.size : undefined);
    // A medicine cabinet on the wall behind the vanity, a soffit over the tub or shower
    if (type === 'cabinet' || type === 'soffit') {
      const draft = { id, type, position: pos, rotation: 0, dimensions: type === 'cabinet' ? cabinet.size : BE_FIXTURE_DEFAULTS.soffit, properties: {} };
      const spot = placeFor(data.fixtures, draft, type === 'cabinet' ? 'medicine_cabinet' : 'soffit', draft.dimensions, ppf);
      if (spot) updateFixture(id, spot);
    }
    setSelectedId(id);
    setActiveTool('select');
  }, [addFixture, updateFixture, data.rooms, data.fixtures, ppf, setSelectedId, setActiveTool]);

  const markAction = (tool: BESketchTool) => (
    <>
      <span className="bes-row-none">None</span>
      <Button type="link" size="small" className="bes-row-action" onClick={() => setActiveTool(tool)}>
        Mark
      </Button>
    </>
  );

  const panelStyle: React.CSSProperties = { width };
  const className = `bes-panel${sheet ? ' bes-panel--sheet' : ''}`;

  if (selection) {
    return (
      <aside className={className} style={panelStyle} aria-label="Selected item">
        <BESketchInspector api={api} selection={selection} />
      </aside>
    );
  }

  // ── Takeoff ──
  const tileZones = data.tileZones.filter((z) => !GLASS_TYPES.has(z.type));
  const glassZones = data.tileZones.filter((z) => GLASS_TYPES.has(z.type));
  const drywall = (data.drywallRepairZones ?? []).map((z, i): TakeoffItem => {
    const lineFt = z.surface === 'wall' && z.boundary.length >= 2
      ? Math.hypot(z.boundary[1].x - z.boundary[0].x, z.boundary[1].y - z.boundary[0].y) / ppf
      : 0;
    return {
      id: z.id,
      name: `${z.surface === 'wall' ? 'Wall' : 'Ceiling'} ${i + 1}`,
      meta: lineFt > 0 ? feetInches(lineFt) : undefined,
      areaSF: z.areaSF,
      swatch: DRYWALL_SWATCH[z.surface],
    };
  });
  const insulation = (data.insulationZones ?? []).map((z, i): TakeoffItem => {
    const lineFt = z.surface === 'wall' && z.boundary.length >= 2
      ? Math.hypot(z.boundary[1].x - z.boundary[0].x, z.boundary[1].y - z.boundary[0].y) / ppf
      : 0;
    return {
      id: z.id,
      name: `${z.surface === 'wall' ? 'Wall' : 'Ceiling'} ${i + 1}`,
      meta: [lineFt > 0 ? feetInches(lineFt) : '', z.needsDemo ? 'demo' : ''].filter(Boolean).join(' · ') || undefined,
      areaSF: z.areaSF,
      swatch: INSULATION_SWATCH[z.surface],
    };
  });
  const damage = data.damageZones.map((z, i): TakeoffItem => ({
    id: z.id,
    name: `${z.damageType === 'mold' ? 'Mold' : z.damageType === 'cement_board' ? 'Cement board' : 'Water damage'} ${i + 1}`,
    areaSF: z.areaSF,
    swatch: DAMAGE_SWATCH,
  }));
  const total = (items: { areaSF: number }[]) => items.reduce((s, z) => s + z.areaSF, 0);

  return (
    <aside className={className} style={panelStyle} aria-label="Plan">
      <section className="bes-section">
        <h3 className="bes-section-title">Add</h3>
        <div className="bes-add-grid">
          {ADDABLE.map((type) => (
            <Button key={type} type="text" className="bes-add" onClick={() => handleAdd(type)}>
              {FIXTURE_GLYPHS[type]}
              {FIXTURE_LABELS[type]}
            </Button>
          ))}
        </div>
        <BELayoutPicker api={api}>
          <Button type="text" className="bes-layout-link" icon={<AppstoreAddOutlined />}>
            Start from a layout
          </Button>
        </BELayoutPicker>
      </section>

      {data.rooms.length > 0 && (
        <section className="bes-section">
          <h3 className="bes-section-title">Rooms</h3>
          {data.rooms.map((room) => {
            const xs = room.boundary.map((p) => p.x);
            const ys = room.boundary.map((p) => p.y);
            const w = (Math.max(...xs) - Math.min(...xs)) / ppf;
            const d = (Math.max(...ys) - Math.min(...ys)) / ppf;
            return (
              <button key={room.id} type="button" className="bes-row" onClick={() => setSelectedId(room.id)}>
                <span className="bes-row-name">{room.name}</span>
                <span className="bes-row-meta">{feetInches(w)} × {feetInches(d)}</span>
                <span className="bes-row-value">{sf(room.netFloorAreaSF ?? room.floorAreaSF)}</span>
              </button>
            );
          })}
        </section>
      )}

      {data.fixtures.some((f) => f.type === 'soffit') && (
        <section className="bes-section">
          <h3 className="bes-section-title">Soffits</h3>
          {data.fixtures.filter((f) => f.type === 'soffit').map((f, i) => (
            <button key={f.id} type="button" className="bes-row" onClick={() => setSelectedId(f.id)}>
              <span className="bes-row-name">Soffit {i + 1}</span>
              <span className="bes-row-meta">{feetInches(f.dimensions.width / 12)} × {feetInches(f.dimensions.height / 12)}</span>
              <span className="bes-row-value">{feetInches((f.properties.soffitBottom ?? SOFFIT_BOTTOM_IN) / 12)} high</span>
            </button>
          ))}
        </section>
      )}

      <section className="bes-section">
        <h3 className="bes-section-title">Takeoff</h3>
        <TakeoffGroup
          label="Tile"
          totalSF={total(tileZones)}
          count={tileZones.length}
          open={!!open.tile}
          onToggle={() => toggle('tile')}
          empty={<span className="bes-row-none">From the tub, shower and vanity</span>}
        >
          <BETileCalculationPanel api={api} zones={tileZones} />
        </TakeoffGroup>
        {glassZones.length > 0 && (
          <TakeoffGroup
            label="Glass"
            totalSF={total(glassZones)}
            count={glassZones.length}
            open={!!open.glass}
            onToggle={() => toggle('glass')}
            empty={null}
          >
            <BETileCalculationPanel api={api} zones={glassZones} />
          </TakeoffGroup>
        )}
        <TakeoffGroup
          label="Drywall repair"
          totalSF={total(drywall)}
          count={drywall.length}
          open={!!open.drywall}
          onToggle={() => toggle('drywall')}
          empty={markAction('drywall_repair')}
        >
          <ZoneRows items={drywall} onSelect={setSelectedId} />
        </TakeoffGroup>
        <TakeoffGroup
          label="Insulation"
          totalSF={total(insulation)}
          count={insulation.length}
          open={!!open.insulation}
          onToggle={() => toggle('insulation')}
          empty={markAction('insulation')}
        >
          <ZoneRows items={insulation} onSelect={setSelectedId} />
        </TakeoffGroup>
        <TakeoffGroup
          label="Damage"
          totalSF={total(damage)}
          count={damage.length}
          open={!!open.damage}
          onToggle={() => toggle('damage')}
          empty={markAction('damage_zone')}
        >
          <ZoneRows items={damage} onSelect={setSelectedId} />
        </TakeoffGroup>
      </section>
    </aside>
  );
};

export default BESketchSidebar;
