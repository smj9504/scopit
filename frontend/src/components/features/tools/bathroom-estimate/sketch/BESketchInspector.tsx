/**
 * BESketchInspector - the settings of whatever is selected on the plan
 *
 * One fixture, wall, room or marked zone at a time: its name with Back and
 * Delete above, then its settings as label / control rows, grouped the way
 * the work is (surround, deck, walls, bench, glass).
 */

import React, { useCallback } from 'react';
import { Button, Input, InputNumber, Select, Switch, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, RotateRightOutlined } from '@ant-design/icons';
import type {
  BathtubSubType,
  BEDamageZone,
  BEDrywallRepairZone,
  BEFixture,
  BEInsulationZone,
  BEPoint,
  BERoom,
  BEWall,
  DrywallTextureType,
  InsulationType,
  ShowerDoorPosition,
  ShowerDoorType,
  ShowerFloorType,
  ShowerWallMaterial,
  VanitySubType,
} from '@/types/bathroomSketch';
import {
  BATHTUB_SURROUND_DEFAULTS,
  MIRROR_HEIGHT_IN,
  SHOWER_DOOR_HEIGHT_IN,
  SOFFIT_BOTTOM_IN,
  VANITY_SUBTYPE_DEFAULTS,
} from '@/types/bathroomSketch';
import type { BECabinetType, BELightType } from '@/types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { CABINET_KINDS, DEFAULT_BAR_BULBS, cabinetKind, isWallLight, lightKindOf, lightPlanSize } from '../fixtureRows';
import { placeFor } from './utils/hangOnWall';
import {
  drainOf,
  drainPresets,
  faucetOf,
  faucetPresets,
  presetOf,
} from './utils/plumbingPoints';
import { findFixtureWallSides } from './utils/beTileZoneGenerator';
import { resizeRoomEdge, showerDoorPosition, wallAreaSF } from './utils/beGeometry';
import BEWallFinishEditor from './BEWallFinishEditor';

// ── Names ──

export const FIXTURE_LABELS: Record<BEFixture['type'], string> = {
  bathtub: 'Bathtub',
  shower: 'Shower',
  vanity: 'Vanity',
  toilet: 'Toilet',
  door: 'Door',
  window: 'Window',
  mirror: 'Mirror',
  light: 'Light',
  cabinet: 'Cabinet',
  soffit: 'Soffit',
};

const DAMAGE_LABELS: Record<BEDamageZone['damageType'], string> = {
  water_damage: 'Water damage',
  mold: 'Mold',
  cement_board: 'Cement board',
};

const TEXTURE_LABELS: Record<DrywallTextureType, string> = {
  skip_trowel: 'Skip trowel',
  orange_peel: 'Orange peel',
  knockdown: 'Knockdown',
  flat: 'Flat',
  smooth: 'Smooth',
};

const INSULATION_LABELS: Record<InsulationType, string> = {
  fiberglass_batt: 'Fiberglass batt',
  blown_in: 'Blown-in',
  spray_foam: 'Spray foam',
  rigid_board: 'Rigid board',
};

const ROOM_TYPES: { value: string; label: string; name: string }[] = [
  { value: 'bathroom', label: 'Bathroom', name: 'Bathroom' },
  { value: 'closet', label: 'Closet', name: 'Closet' },
  { value: 'toilet_room', label: 'Toilet room', name: 'Toilet Room' },
  { value: 'linen_closet', label: 'Linen closet', name: 'Linen Closet' },
  { value: 'other', label: 'Other', name: 'Room' },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

type PanelConfig = 'none' | 'left' | 'right' | 'both';

/** The fixed panels a shower door leaves room for: one against a side moves a panel there to the other side. */
function panelsBesideDoor(position: ShowerDoorPosition, panels: PanelConfig): PanelConfig {
  if (panels === 'none' || position === 'center') return panels;
  return position === 'left' ? 'right' : 'left';
}

/** 5.5 → 5′ 6″ */
export function feetInches(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i === 0 ? `${f}′` : `${f}′ ${i}″`;
}

/** Length in feet of a wall-type zone's line */
function zoneLineFt(boundary: BEPoint[], ppf: number): number {
  if (boundary.length < 2) return 0;
  const dx = boundary[1].x - boundary[0].x;
  const dy = boundary[1].y - boundary[0].y;
  return Math.sqrt(dx * dx + dy * dy) / ppf;
}

// ── What's selected ──

export type SketchSelection =
  | { kind: 'fixture'; item: BEFixture }
  | { kind: 'wall'; item: BEWall }
  | { kind: 'room'; item: BERoom }
  | { kind: 'drywall'; item: BEDrywallRepairZone }
  | { kind: 'insulation'; item: BEInsulationZone }
  | { kind: 'damage'; item: BEDamageZone };

export function findSelection(data: BESketchStateAPI['data'], id: string | null): SketchSelection | null {
  if (!id) return null;
  const fixture = data.fixtures.find((f) => f.id === id);
  if (fixture) return { kind: 'fixture', item: fixture };
  const wall = data.walls.find((w) => w.id === id);
  if (wall) return { kind: 'wall', item: wall };
  const room = data.rooms.find((r) => r.id === id);
  if (room) return { kind: 'room', item: room };
  const drywall = (data.drywallRepairZones ?? []).find((z) => z.id === id);
  if (drywall) return { kind: 'drywall', item: drywall };
  const insulation = (data.insulationZones ?? []).find((z) => z.id === id);
  if (insulation) return { kind: 'insulation', item: insulation };
  const damage = data.damageZones.find((z) => z.id === id);
  if (damage) return { kind: 'damage', item: damage };
  return null;
}

export function selectionTitle(sel: SketchSelection): string {
  switch (sel.kind) {
    case 'fixture':
      return sel.item.type === 'light' && sel.item.properties.recessedParentId
        ? 'Recessed can'
        : FIXTURE_LABELS[sel.item.type];
    case 'wall': return sel.item.label ? `${sel.item.label} wall` : 'Wall';
    case 'room': return sel.item.name;
    case 'drywall': return 'Drywall repair';
    case 'insulation': return 'Insulation';
    case 'damage': return DAMAGE_LABELS[sel.item.damageType] ?? 'Damage';
  }
}

// ── Rows ──

const Field: React.FC<{ label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="bes-field">
    <span className="bes-field-label">{label}</span>
    <div className="bes-field-control">{children}</div>
    {hint && <div className="bes-field-hint">{hint}</div>}
  </div>
);

const Fact: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <Field label={label}><span className="bes-field-value">{children}</span></Field>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <>
    <div className="bes-group-title">{title}</div>
    {children}
  </>
);

/** A number with its unit after it */
const Num: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  pair?: boolean;
  onChange: (v: number | null) => void;
}> = ({ label, value, min, max, step, unit, pair, onChange }) => (
  <>
    <InputNumber
      className={pair ? 'bes-num-pair' : undefined}
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(v) => onChange(typeof v === 'number' ? v : null)}
    />
    {unit && <span className="bes-unit">{unit}</span>}
  </>
);

// ── Recessed cans: one light set to "multi" places its cans across the room ──

function removeRecessedSiblings(parentId: string, data: BESketchStateAPI['data'], api: BESketchStateAPI) {
  const siblings = data.fixtures.filter((f) => f.type === 'light' && f.properties.recessedParentId === parentId);
  for (const s of siblings) api.removeFixture(s.id);
}

/** `count` cans across the room: the light itself is the first, the rest are added */
function spawnRecessedLights(parent: BEFixture, count: number, data: BESketchStateAPI['data'], api: BESketchStateAPI) {
  removeRecessedSiblings(parent.id, data, api);

  const room = data.rooms.find((r) => r.roomType === 'bathroom') || data.rooms[0];
  if (!room || room.boundary.length < 3) return;

  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const roomW = maxX - minX;
  const roomH = maxY - minY;

  // Roughly square grid
  const cols = Math.ceil(Math.sqrt(count * (roomW / roomH)));
  const rows = Math.ceil(count / cols);
  const padX = roomW * 0.15;
  const padY = roomH * 0.15;
  const stepX = cols > 1 ? (roomW - 2 * padX) / (cols - 1) : 0;
  const stepY = rows > 1 ? (roomH - 2 * padY) / (rows - 1) : 0;

  let placed = 0;
  for (let r = 0; r < rows && placed < count; r++) {
    for (let c = 0; c < cols && placed < count; c++) {
      const pos = {
        x: minX + padX + (cols > 1 ? c * stepX : roomW / 2 - padX),
        y: minY + padY + (rows > 1 ? r * stepY : roomH / 2 - padY),
      };
      if (placed === 0) {
        api.updateFixture(parent.id, { position: pos, dimensions: { width: 6, height: 6 } });
      } else {
        api.addFixture('light', pos, room.id, undefined, {
          lightType: 'recessed',
          recessedParentId: parent.id,
        }, { width: 6, height: 6 });
      }
      placed++;
    }
  }
}

const LIGHT_TYPE_OPTIONS: { value: BELightType; label: string }[] = [
  { value: 'vanity_bar', label: 'Vanity light bar (wall)' },
  { value: 'sconce', label: 'Wall sconce' },
  { value: 'standard', label: 'Ceiling fixture' },
  { value: 'pendant', label: 'Pendant / chandelier' },
  { value: 'recessed', label: 'Recessed, 1 can' },
  { value: 'recessed_multi', label: 'Recessed, several cans' },
];

// ── Faucet and drain (tub, shower): a click away here, anywhere by dragging them on the plan ──

const PlumbingFields: React.FC<{ fixture: BEFixture; setProps: (p: Partial<BEFixture['properties']>) => void }> = ({ fixture, setProps }) => {
  const p = fixture.properties;
  const fPresets = faucetPresets(fixture);
  const dPresets = drainPresets(fixture);
  const fValue = presetOf(fPresets, faucetOf(fixture), false);
  const dValue = presetOf(dPresets, drainOf(fixture), !p.drainPos);
  const custom = { value: 'custom', label: 'Moved on the plan', disabled: true };
  const isTub = fixture.type === 'bathtub';
  return (
    <Group title="Faucet & drain">
      <Field label={isTub ? 'Faucet' : 'Valve & head'}>
        <Select
          aria-label={isTub ? 'Faucet position' : 'Valve position'}
          value={fValue}
          onChange={(v: string) => {
            const preset = fPresets.find((q) => q.value === v);
            if (preset?.pt) setProps({ faucetPos: preset.pt });
          }}
          options={[...fPresets.map(({ value, label }) => ({ value, label })), ...(fValue === 'custom' ? [custom] : [])]}
        />
      </Field>
      <Field label="Drain" hint="Or drag either one on the plan.">
        <Select
          aria-label="Drain position"
          value={dValue}
          onChange={(v: string) => {
            const preset = dPresets.find((q) => q.value === v);
            if (preset) setProps({ drainPos: preset.pt ?? undefined });
          }}
          options={[...dPresets.map(({ value, label }) => ({ value, label })), ...(dValue === 'custom' ? [custom] : [])]}
        />
      </Field>
    </Group>
  );
};

// ── Fixture ──

const TUB_TYPES: { value: BathtubSubType; label: string }[] = [
  { value: 'standard_alcove', label: 'Alcove (3 walls)' },
  { value: 'corner_drop_in', label: 'Corner drop-in' },
  { value: 'corner_garden', label: 'Corner / garden' },
  { value: 'drop_in', label: 'Drop-in with deck' },
  { value: 'freestanding', label: 'Freestanding' },
];

const TUB_SIZES: Partial<Record<BathtubSubType, { width: number; height: number }>> = {
  standard_alcove: { width: 60, height: 32 },
  corner_drop_in: { width: 60, height: 42 },
  corner_garden: { width: 60, height: 60 },
  drop_in: { width: 60, height: 32 },
  freestanding: { width: 60, height: 30 },
};

const FixtureInspector: React.FC<{ fixture: BEFixture; api: BESketchStateAPI }> = ({ fixture, api }) => {
  const { updateFixtureProperties, updateFixture, data } = api;
  const p = fixture.properties;
  const setProps = (props: Partial<BEFixture['properties']>) => updateFixtureProperties(fixture.id, props);
  const isRecessedCan = fixture.type === 'light' && !!p.recessedParentId;

  const size = (
    <Field label="Size">
      <Num
        pair
        label="Width, inches"
        value={fixture.dimensions.width}
        min={6}
        max={120}
        onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, width: v } })}
      />
      <span className="bes-times" aria-hidden="true">×</span>
      <Num
        pair
        label="Depth, inches"
        value={fixture.dimensions.height}
        min={6}
        max={120}
        unit="in"
        onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, height: v } })}
      />
    </Field>
  );

  const rotation = (fixture.type !== 'light' || isWallLight(p.lightType)) && (
    <Field label="Rotation">
      <Num
        label="Rotation, degrees"
        value={fixture.rotation}
        min={0}
        max={360}
        step={15}
        unit="°"
        onChange={(v) => v != null && updateFixture(fixture.id, { rotation: v })}
      />
      <Tooltip title="Turn 90° (R)">
        <Button
          type="text"
          className="ui-icon-btn"
          icon={<RotateRightOutlined />}
          aria-label="Turn 90 degrees"
          onClick={() => updateFixture(fixture.id, { rotation: ((fixture.rotation || 0) + 90) % 360 })}
        />
      </Tooltip>
    </Field>
  );

  if (fixture.type === 'bathtub') {
    const subType = p.bathtubSubType ?? 'standard_alcove';
    const hasDeck = subType === 'drop_in' || subType === 'corner_garden' || subType === 'corner_drop_in' || subType === 'standard_alcove';
    const isAlcove = subType === 'standard_alcove';
    const deckOn = !isAlcove || (p.deckWidth ?? 0) > 0;
    // Sides of the deck that aren't against a wall, unless set by hand
    const wPx = (fixture.dimensions.width / 12) * data.settings.pixelsPerFoot;
    const hPx = (fixture.dimensions.height / 12) * data.settings.pixelsPerFoot;
    const room = data.rooms.find((r) => r.id === fixture.roomId) ?? data.rooms[0];
    const autoWalls = findFixtureWallSides(fixture, room, wPx, hPx);
    const autoSides = autoWalls
      ? Math.max(1, 4 - [autoWalls.north, autoWalls.south, autoWalls.east, autoWalls.west].filter(Boolean).length)
      : Math.max(1, BATHTUB_SURROUND_DEFAULTS[p.bathtubSubType ?? 'drop_in'].deckTileSides ?? 2);

    return (
      <>
        <Field label="Type">
          <Select
            aria-label="Bathtub type"
            value={subType}
            options={TUB_TYPES}
            onChange={(v: BathtubSubType) => {
              const sd = BATHTUB_SURROUND_DEFAULTS[v];
              const dims = TUB_SIZES[v];
              if (dims) updateFixture(fixture.id, { dimensions: dims });
              setProps({
                bathtubSubType: v,
                hasSurround: sd.surroundWallCount > 0,
                surroundWallCount: sd.surroundWallCount,
                surroundHeight: sd.surroundHeight,
                deckWidth: sd.deckWidth,
                deckHeight: sd.deckHeight,
                deckTileSides: sd.deckTileSides,
                hasFrontPanel: sd.hasFrontPanel,
              });
            }}
          />
        </Field>
        {size}
        {rotation}

        <PlumbingFields fixture={fixture} setProps={setProps} />

        <Group title="Surround">
          <Field label="Tile">
            <Switch aria-label="Tile surround" checked={p.hasSurround ?? false} onChange={(v) => setProps({ hasSurround: v })} />
          </Field>
          {p.hasSurround && (
            <>
              <Field label="Walls">
                <Num label="Surround walls" value={p.surroundWallCount ?? 3} min={1} max={3} onChange={(v) => v && setProps({ surroundWallCount: v })} />
              </Field>
              <Field label="Height">
                <Num label="Surround height, inches" value={p.surroundHeight ?? 60} min={24} max={96} unit="in" onChange={(v) => v && setProps({ surroundHeight: v })} />
              </Field>
              <Field
                label="Has faucet"
                hint={p.hasFaucet === false ? 'No valve replacement: the faucet is on another wall.' : undefined}
              >
                <Switch aria-label="Faucet on the surround" checked={p.hasFaucet ?? true} onChange={(v) => setProps({ hasFaucet: v })} />
              </Field>
            </>
          )}
        </Group>

        {hasDeck && (
          <Group title="Deck">
            {/* An alcove tub has no deck unless its rim is tiled */}
            {isAlcove && (
              <Field label="Tile rim">
                <Switch
                  aria-label="Tile the rim"
                  checked={deckOn}
                  onChange={(v) => setProps(v ? { deckWidth: 4, deckHeight: p.deckHeight || 18 } : { deckWidth: 0 })}
                />
              </Field>
            )}
            {deckOn && (
              <>
                <Field label="Width">
                  <Num label="Deck width, inches" value={p.deckWidth ?? 10} min={4} max={24} unit="in" onChange={(v) => v && setProps({ deckWidth: v })} />
                </Field>
                <Field label="Height">
                  <Num label="Deck height, inches" value={p.deckHeight ?? 20} min={12} max={36} unit="in" onChange={(v) => v && setProps({ deckHeight: v })} />
                </Field>
                <Field
                  label="Tiled sides"
                  hint={p.deckTileSides == null ? 'Found from the walls around the tub. Change it to set your own.' : undefined}
                >
                  <Num label="Deck tiled sides" value={p.deckTileSides ?? autoSides} min={1} max={4} onChange={(v) => v && setProps({ deckTileSides: v })} />
                </Field>
              </>
            )}
            <Field label="Front panel">
              <Switch aria-label="Tile the front panel" checked={p.hasFrontPanel ?? false} onChange={(v) => setProps({ hasFrontPanel: v })} />
            </Field>
          </Group>
        )}
      </>
    );
  }

  if (fixture.type === 'shower') {
    const layout = p.showerLayout ?? 'alcove';
    const isCornerOrNeo = layout === 'neo_angle' || layout === 'neo_angle_right' || layout === 'corner' || layout === 'corner_right';
    const curb = p.curbHeight ?? 4;
    const glassDoor = !!p.showerDoorType && p.showerDoorType !== 'none' && p.showerDoorType !== 'curtain';
    const doorWidth = p.showerDoorWidth ?? Math.round(fixture.dimensions.width * 0.5);
    // A neo-angle door sits on its diagonal, and a door the full width has nowhere to move
    const doorMoves = glassDoor && !layout.startsWith('neo_angle') && doorWidth < fixture.dimensions.width;
    const doorPosition = doorMoves ? showerDoorPosition(p) : 'center';
    const panelConfig = p.fixedPanelConfig ?? 'none';
    const hasGlass = isCornerOrNeo
      || (!!p.showerDoorType && p.showerDoorType !== 'none' && p.showerDoorType !== 'curtain')
      || (p.fixedPanelConfig ?? 'none') !== 'none';
    return (
      <>
        <Field label="Enclosure">
          <Select
            aria-label="Shower enclosure"
            value={layout}
            onChange={(v: string) => {
              const wallMap: Record<string, number> = { alcove: 3, corner: 2, corner_right: 2, neo_angle: 2, neo_angle_right: 2 };
              const isNeo = v === 'neo_angle' || v === 'neo_angle_right';
              setProps({
                showerLayout: v as any,
                showerWallCount: wallMap[v] ?? 3,
                ...(isNeo ? { showerDoorType: 'neo_angle_pivot' as ShowerDoorType } : {}),
              });
            }}
            options={[
              { value: 'alcove', label: 'Alcove (3 walls)' },
              { value: 'corner', label: 'Corner, glass right' },
              { value: 'corner_right', label: 'Corner, glass left' },
              { value: 'neo_angle', label: 'Neo-angle, back + left' },
              { value: 'neo_angle_right', label: 'Neo-angle, back + right' },
            ]}
          />
        </Field>
        {size}
        {rotation}

        <PlumbingFields fixture={fixture} setProps={setProps} />

        <Group title="Floor">
          <Field label="Pan">
            <Select
              aria-label="Shower floor"
              value={p.showerFloorType ?? 'tile'}
              onChange={(v: ShowerFloorType) => setProps({ showerFloorType: v })}
              options={[
                { value: 'tile', label: 'Tile' },
                { value: 'fiberglass_pan', label: 'Fiberglass pan' },
                { value: 'acrylic_pan', label: 'Acrylic pan' },
              ]}
            />
          </Field>
          <Field label="Curb" hint={curb === 0 ? 'Curbless' : undefined}>
            <Num label="Curb height, inches" value={curb} min={0} max={8} unit="in" onChange={(v) => setProps({ curbHeight: v ?? 0 })} />
          </Field>
        </Group>

        <Group title="Walls">
          <Field label="Tiled walls">
            <Num label="Tiled walls" value={p.showerWallCount ?? 3} min={1} max={3} onChange={(v) => v && setProps({ showerWallCount: v })} />
          </Field>
          <Field label="Tile height">
            <Num label="Tile height, inches" value={p.showerTileHeight ?? 96} min={48} max={120} unit="in" onChange={(v) => v && setProps({ showerTileHeight: v })} />
          </Field>
          {isCornerOrNeo && (
            <Field label="Material">
              <Select
                aria-label="Wall material"
                value={p.showerWallMaterial ?? 'tile'}
                onChange={(v: ShowerWallMaterial) => setProps({ showerWallMaterial: v })}
                options={[
                  { value: 'tile', label: 'Custom tile' },
                  { value: 'prefab_acrylic', label: 'Prefab acrylic' },
                  { value: 'prefab_fiberglass', label: 'Prefab fiberglass' },
                  { value: 'solid_surface', label: 'Solid surface' },
                ]}
              />
            </Field>
          )}
          <Field label="Niches">
            <Num label="Niches" value={p.nicheCount ?? 0} min={0} max={4} onChange={(v) => setProps({ nicheCount: v ?? 0 })} />
          </Field>
          <Field label="Bench">
            <Switch aria-label="Shower bench" checked={p.hasBench ?? false} onChange={(v) => setProps({ hasBench: v })} />
          </Field>
          {p.hasBench && (
            <>
              <Field label="Side">
                <Select
                  aria-label="Bench side"
                  value={p.benchPosition ?? 'left'}
                  onChange={(v) => setProps({ benchPosition: v })}
                  options={[
                    { label: 'Left', value: 'left' },
                    { label: 'Right', value: 'right' },
                    { label: 'Back', value: 'back' },
                  ]}
                />
              </Field>
              <Field label="Length">
                <Num label="Bench length, inches" value={p.benchLength ?? 36} min={12} max={60} unit="in" onChange={(v) => setProps({ benchLength: v ?? 36 })} />
              </Field>
            </>
          )}
        </Group>

        <Group title="Glass">
          <Field label="Door">
            <Select
              aria-label="Shower door"
              value={p.showerDoorType ?? 'none'}
              onChange={(v: ShowerDoorType) => setProps({ showerDoorType: v })}
              options={[
                { value: 'none', label: 'Open, no door' },
                { value: 'curtain', label: 'Curtain' },
                { value: 'sliding', label: 'Sliding glass' },
                { value: 'swing', label: 'Swing, framed' },
                { value: 'frameless_swing', label: 'Swing, frameless' },
                { value: 'bi_fold', label: 'Bi-fold' },
                { value: 'neo_angle_pivot', label: 'Neo-angle pivot' },
              ]}
            />
          </Field>
          {glassDoor && (
            <Field label="Door width">
              <Num
                label="Door width, inches"
                value={doorWidth}
                min={18}
                max={fixture.dimensions.width}
                unit="in"
                onChange={(v) => v && setProps({ showerDoorWidth: v })}
              />
            </Field>
          )}
          {doorMoves && (
            <Field label="Door position" hint="Looking in from outside. A swing door hinges on the side it's against.">
              <Select
                aria-label="Door position"
                value={doorPosition}
                onChange={(v: ShowerDoorPosition) => setProps({ showerDoorPosition: v, fixedPanelConfig: panelsBesideDoor(v, panelConfig) })}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Field>
          )}
          <Field label="Fixed panel">
            <Select
              aria-label="Fixed glass panel"
              value={panelConfig}
              onChange={(v: PanelConfig) => setProps({ fixedPanelConfig: v })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'left', label: 'Left side', disabled: doorPosition === 'left' },
                { value: 'right', label: 'Right side', disabled: doorPosition === 'right' },
                { value: 'both', label: 'Both sides', disabled: doorPosition !== 'center' },
              ]}
            />
          </Field>
          {hasGlass && (
            <Field label="Height" hint="The glass, on the curb. The wall tile has its own height.">
              <Num
                label="Glass height, inches"
                value={p.showerDoorHeight ?? SHOWER_DOOR_HEIGHT_IN}
                min={48}
                max={120}
                unit="in"
                onChange={(v) => v && setProps({ showerDoorHeight: v })}
              />
            </Field>
          )}
        </Group>
      </>
    );
  }

  if (fixture.type === 'vanity') {
    const subType = p.vanitySubType ?? 'cabinet';
    return (
      <>
        <Field label="Type">
          <Select
            aria-label="Vanity type"
            value={subType}
            onChange={(v: VanitySubType) => {
              const sd = VANITY_SUBTYPE_DEFAULTS[v];
              updateFixture(fixture.id, { dimensions: { width: sd.width, height: sd.height } });
              setProps({ vanitySubType: v, sinkCount: sd.sinkCount, hasBacksplash: sd.hasBacksplash });
            }}
            options={[
              { value: 'cabinet', label: 'Cabinet vanity' },
              { value: 'pedestal_sink', label: 'Pedestal sink' },
              { value: 'wall_mount_sink', label: 'Wall-mount sink' },
            ]}
          />
        </Field>
        {size}
        {rotation}
        {subType === 'cabinet' && (
          <>
            <Field label="Sinks">
              <Num label="Sinks" value={p.sinkCount ?? 1} min={1} max={2} onChange={(v) => v && setProps({ sinkCount: v })} />
            </Field>
            <Field label="Backsplash">
              <Switch aria-label="Backsplash" checked={p.hasBacksplash ?? false} onChange={(v) => setProps({ hasBacksplash: v })} />
              {p.hasBacksplash && (
                <Num label="Backsplash height, inches" value={p.backsplashHeight ?? 4} min={2} max={24} unit="in" onChange={(v) => v && setProps({ backsplashHeight: v })} />
              )}
            </Field>
          </>
        )}
      </>
    );
  }

  if (fixture.type === 'light' && !isRecessedCan) {
    const ppf = data.settings.pixelsPerFoot;
    const kind = lightKindOf(p.lightType);
    // A new kind: its size, and a light on a wall onto the wall behind the vanity
    const changeType = (v: BELightType) => {
      const bulbs = v === 'vanity_bar' ? (p.lightBulbs || DEFAULT_BAR_BULBS) : undefined;
      const dims = lightPlanSize(v, bulbs);
      setProps({ lightType: v, lightBulbs: bulbs });
      const k = lightKindOf(v);
      const spot = k === 'vanity_bar' || k === 'sconce' ? placeFor(data.fixtures, fixture, k, dims, ppf) : null;
      updateFixture(fixture.id, spot ?? { dimensions: dims });
      if (v === 'recessed_multi') spawnRecessedLights(fixture, p.lightCount ?? 4, data, api);
      else removeRecessedSiblings(fixture.id, data, api);
    };
    return (
      <>
        <Field label="Type">
          <Select
            aria-label="Light type"
            value={p.lightType ?? 'standard'}
            onChange={changeType}
            options={LIGHT_TYPE_OPTIONS}
          />
        </Field>
        {kind === 'vanity_bar' && (
          <Field label="Lights" hint={'A "3-light" bar has 3'}>
            <Num
              label="Lights on the bar"
              value={p.lightBulbs || DEFAULT_BAR_BULBS}
              min={1}
              max={8}
              onChange={(v) => {
                if (!v) return;
                setProps({ lightBulbs: v });
                updateFixture(fixture.id, { dimensions: lightPlanSize('vanity_bar', v) });
              }}
            />
          </Field>
        )}
        {p.lightType === 'recessed_multi' && (
          <Field label="Cans" hint="Spread across the room. Drag any of them to move it.">
            <Num
              label="Cans"
              value={p.lightCount ?? 4}
              min={2}
              max={12}
              onChange={(v) => {
                if (!v) return;
                setProps({ lightCount: v });
                spawnRecessedLights(fixture, v, data, api);
              }}
            />
          </Field>
        )}
        {isWallLight(p.lightType) ? (
          <Field label="Width">
            <Num
              label="Width, inches"
              value={fixture.dimensions.width}
              min={4}
              max={72}
              unit="in"
              onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, width: v } })}
            />
          </Field>
        ) : size}
        {rotation}
      </>
    );
  }

  if (fixture.type === 'cabinet') {
    const kind = cabinetKind(p.cabinetType);
    const changeType = (v: BECabinetType) => {
      const k = cabinetKind(v);
      setProps({ cabinetType: v, cabinetHeight: k.heightIn });
      const spot = placeFor(data.fixtures, fixture, v === 'wall_cabinet' ? 'wall_cabinet' : 'medicine_cabinet',
        k.size, data.settings.pixelsPerFoot);
      updateFixture(fixture.id, spot ?? { dimensions: { ...k.size } });
    };
    return (
      <>
        <Field label="Type">
          <Select
            aria-label="Cabinet type"
            value={kind.value}
            onChange={changeType}
            options={CABINET_KINDS.map(({ value, label }) => ({ value, label }))}
          />
        </Field>
        <Field label="Size" hint="Width along the wall × how far it stands out">
          <Num
            pair
            label="Width, inches"
            value={fixture.dimensions.width}
            min={8}
            max={72}
            onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, width: v } })}
          />
          <span className="bes-times" aria-hidden="true">×</span>
          <Num
            pair
            label="Depth, inches"
            value={fixture.dimensions.height}
            min={2}
            max={16}
            unit="in"
            onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, height: v } })}
          />
        </Field>
        <Field label="Height">
          <Num
            label="Height, inches"
            value={p.cabinetHeight ?? kind.heightIn}
            min={8}
            max={60}
            unit="in"
            onChange={(v) => v && setProps({ cabinetHeight: v })}
          />
        </Field>
        {rotation}
      </>
    );
  }

  if (fixture.type === 'soffit') {
    const room = data.rooms.find((r) => r.id === fixture.roomId) ?? data.rooms.find((r) => !r.parentRoomId);
    const ceiling = room?.heightInches || 96;
    const bottom = p.soffitBottom ?? SOFFIT_BOTTOM_IN;
    return (
      <>
        <Field
          label="Ceiling under it"
          hint={`${feetInches(bottom / 12)} here, ${feetInches(ceiling / 12)} in the room: it hangs ${Math.max(0, ceiling - bottom)}" down. The wall behind it comes off the paint; its faces go on.`}
        >
          <Num
            label="Soffit underside height, inches"
            value={bottom}
            min={48}
            max={ceiling}
            unit="in"
            onChange={(v) => v && setProps({ soffitBottom: v })}
          />
        </Field>
        {size}
        {rotation}
      </>
    );
  }

  if (fixture.type === 'mirror') {
    // Its width runs along the wall; its height is up the wall, which the plan can't show
    return (
      <>
        <Field label="Size">
          <Num
            pair
            label="Width, inches"
            value={fixture.dimensions.width}
            min={6}
            max={120}
            onChange={(v) => v && updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, width: v } })}
          />
          <span className="bes-times" aria-hidden="true">×</span>
          <Num
            pair
            label="Height, inches"
            value={p.mirrorHeight ?? MIRROR_HEIGHT_IN}
            min={6}
            max={96}
            unit="in"
            onChange={(v) => v && setProps({ mirrorHeight: v })}
          />
        </Field>
        {rotation}
      </>
    );
  }

  return (
    <>
      {size}
      {rotation}
    </>
  );
};

// ── Wall ──

const WallInspector: React.FC<{ wall: BEWall; api: BESketchStateAPI }> = ({ wall, api }) => {
  const ppf = api.data.settings.pixelsPerFoot;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  const lengthIn = Math.round((lengthPx / ppf) * 12);
  const angle = Math.atan2(dy, dx);

  const setLength = (inches: number | null) => {
    if (!inches || inches < 1) return;
    const px = (inches / 12) * ppf;
    // A room's own wall: resize that edge of the room, so its walls (and a
    // rectangle's shape) follow
    const ownRoom = api.data.rooms.find((r) => r.wallIds.length === r.boundary.length && r.wallIds.includes(wall.id));
    if (ownRoom) {
      const b = resizeRoomEdge(ownRoom.boundary, ownRoom.wallIds.indexOf(wall.id), px);
      if (b) api.updateRoom(ownRoom.id, b);
      return;
    }
    // A wall of its own: same direction, new end
    api.updateWall(wall.id, {
      end: { x: Math.round(wall.start.x + Math.cos(angle) * px), y: Math.round(wall.start.y + Math.sin(angle) * px) },
    });
  };

  return (
    <>
      <Field label="Length" hint={feetInches(lengthIn / 12)}>
        <Num label="Length, inches" value={lengthIn} min={1} max={600} unit="in" onChange={setLength} />
      </Field>
      <Field label="Height">
        <Num
          label="Height, inches"
          value={wall.heightInches}
          min={12}
          max={240}
          unit="in"
          onChange={(v) => v && v >= 12 && api.updateWall(wall.id, { heightInches: v })}
        />
      </Field>
      <Field label="Name">
        <Input
          aria-label="Wall name"
          value={wall.label || ''}
          placeholder="e.g. North"
          onChange={(e) => api.updateWall(wall.id, { label: e.target.value || undefined })}
        />
      </Field>
      <Fact label="Area">{round1((lengthIn / 12) * (wall.heightInches / 12))} SF</Fact>

      <div className="bes-wall-finish">
        <BEWallFinishEditor
          wall={wall}
          ppf={ppf}
          fixtures={api.data.fixtures}
          rooms={api.data.rooms}
          onChange={(patch) => api.updateWall(wall.id, patch)}
        />
      </div>
    </>
  );
};

// ── Room ──

const RoomInspector: React.FC<{ room: BERoom; api: BESketchStateAPI }> = ({ room, api }) => {
  const ppf = api.data.settings.pixelsPerFoot;
  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  const widthFt = xs.length ? (Math.max(...xs) - Math.min(...xs)) / ppf : 0;
  const depthFt = ys.length ? (Math.max(...ys) - Math.min(...ys)) / ppf : 0;
  const parent = room.parentRoomId ? api.data.rooms.find((r) => r.id === room.parentRoomId) : undefined;

  return (
    <>
      <Field label="Type">
        <Select
          aria-label="Room type"
          value={room.roomType ?? 'bathroom'}
          onChange={(v) => {
            const t = ROOM_TYPES.find((r) => r.value === v);
            api.updateRoomMeta(room.id, { roomType: v, name: t?.name ?? v });
          }}
          options={ROOM_TYPES.map(({ value, label }) => ({ value, label }))}
        />
      </Field>
      {parent && <Fact label="Inside">{parent.name}</Fact>}
      <Fact label="Size">{feetInches(widthFt)} × {feetInches(depthFt)}</Fact>
      <Fact label="Floor">
        {room.floorAreaSF} SF
        {room.netFloorAreaSF !== room.floorAreaSF && <span className="bes-unit"> · {room.netFloorAreaSF} SF net</span>}
      </Fact>
      {/* From the perimeter: rooms saved before 2026-11-08 store a wall area 12× too small */}
      <Fact label="Walls">{Math.round(wallAreaSF(room.perimeterLF, room.heightInches || 96) * 10) / 10} SF</Fact>
      <Fact label="Perimeter">{room.perimeterLF} LF</Fact>
      <Field label="Ceiling" hint={`${feetInches((room.heightInches || 96) / 12)}. Sets its walls' height; a lower part (over a tub) is a soffit.`}>
        <Num
          label="Ceiling height, inches"
          value={room.heightInches || 96}
          min={60}
          max={240}
          unit="in"
          onChange={(v) => v && v >= 60 && api.setRoomHeight(room.id, v)}
        />
      </Field>
    </>
  );
};

// ── Marked zones ──

const DrywallInspector: React.FC<{ zone: BEDrywallRepairZone; api: BESketchStateAPI }> = ({ zone, api }) => {
  const set = (u: Partial<BEDrywallRepairZone>) => api.updateDrywallRepairZone(zone.id, u);
  const lineFt = zone.surface === 'wall' ? zoneLineFt(zone.boundary, api.data.settings.pixelsPerFoot) : 0;
  return (
    <>
      <Fact label="Surface">{zone.surface === 'wall' ? `Wall · ${feetInches(lineFt)}` : 'Ceiling'}</Fact>
      {zone.surface === 'wall' && (
        <Field label="Height" hint="Sets the area">
          <Num label="Repair height, inches" value={zone.repairHeightInches} min={12} max={240} unit="in" onChange={(v) => v && set({ repairHeightInches: v })} />
        </Field>
      )}
      <Fact label="Area">{zone.areaSF} SF</Fact>
      <Field label="Gluing">
        <Switch aria-label="Include gluing" checked={zone.includeGluing} onChange={(v) => set({ includeGluing: v })} />
      </Field>
      <Field label="Texture">
        <Select
          aria-label="Texture"
          value={zone.textureType}
          onChange={(v: DrywallTextureType) => set({ textureType: v })}
          options={(Object.keys(TEXTURE_LABELS) as DrywallTextureType[]).map((k) => ({ value: k, label: TEXTURE_LABELS[k] }))}
        />
      </Field>
      <Field label="Paint coats">
        <Num label="Paint coats" value={zone.paintCoats} min={1} max={4} onChange={(v) => v && set({ paintCoats: v })} />
      </Field>
    </>
  );
};

const InsulationInspector: React.FC<{ zone: BEInsulationZone; api: BESketchStateAPI }> = ({ zone, api }) => {
  const set = (u: Partial<BEInsulationZone>) => api.updateInsulationZone(zone.id, u);
  const lineFt = zone.surface === 'wall' ? zoneLineFt(zone.boundary, api.data.settings.pixelsPerFoot) : 0;
  return (
    <>
      <Fact label="Surface">{zone.surface === 'wall' ? `Wall · ${feetInches(lineFt)}` : 'Ceiling'}</Fact>
      {zone.surface === 'wall' && (
        <Field label="Height" hint="Sets the area">
          <Num label="Height, inches" value={zone.heightInches} min={12} max={240} unit="in" onChange={(v) => v && set({ heightInches: v })} />
        </Field>
      )}
      <Fact label="Area">{zone.areaSF} SF</Fact>
      <Field label="Demo existing">
        <Switch aria-label="Demo existing insulation" checked={zone.needsDemo} onChange={(v) => set({ needsDemo: v })} />
      </Field>
      <Field label="Type">
        <Select
          aria-label="Insulation type"
          value={zone.insulationType}
          onChange={(v: InsulationType) => set({ insulationType: v })}
          options={(Object.keys(INSULATION_LABELS) as InsulationType[]).map((k) => ({ value: k, label: INSULATION_LABELS[k] }))}
        />
      </Field>
      <Field label="R-value">
        <Num label="R-value" value={zone.rValue} min={1} max={60} onChange={(v) => v && set({ rValue: v })} />
      </Field>
    </>
  );
};

const DamageInspector: React.FC<{ zone: BEDamageZone; api: BESketchStateAPI }> = ({ zone, api }) => {
  // The room the damage is in, by its centre
  const cx = zone.boundary.reduce((s, p) => s + p.x, 0) / zone.boundary.length;
  const cy = zone.boundary.reduce((s, p) => s + p.y, 0) / zone.boundary.length;
  const room = api.data.rooms.find((r) => {
    let inside = false;
    for (let i = 0, j = r.boundary.length - 1; i < r.boundary.length; j = i++) {
      const xi = r.boundary[i].x, yi = r.boundary[i].y;
      const xj = r.boundary[j].x, yj = r.boundary[j].y;
      if ((yi > cy) !== (yj > cy) && cx < (xj - xi) * (cy - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });

  const addDrywallRepair = useCallback(() => {
    const b = zone.boundary;
    if (b.length < 4) return;
    // A wall-type repair along each edge of the damage rectangle
    let created = 0;
    for (let i = 0; i < 4; i++) {
      const p0 = b[i];
      const p1 = b[(i + 1) % 4];
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 5) continue;
      api.addDrywallRepairZone([p0, p1], room?.id, 'wall');
      created++;
    }
    if (created > 0) message.success(`${created} drywall repairs added`);
  }, [zone.boundary, room, api]);

  return (
    <>
      <Field label="Type">
        <Select
          aria-label="Damage type"
          value={zone.damageType}
          onChange={(v) => api.updateDamageZone(zone.id, { damageType: v as BEDamageZone['damageType'] })}
          options={(Object.keys(DAMAGE_LABELS) as BEDamageZone['damageType'][]).map((k) => ({ value: k, label: DAMAGE_LABELS[k] }))}
        />
      </Field>
      {room && <Fact label="Room">{room.name}</Fact>}
      <Fact label="Area">{zone.areaSF} SF</Fact>
      <Field label="Needs demo">
        <Switch aria-label="Needs demo" checked={zone.needsDemo} onChange={(v) => api.updateDamageZone(zone.id, { needsDemo: v })} />
      </Field>
      <Field label="Needs replacing">
        <Switch aria-label="Needs replacing" checked={zone.needsReplace} onChange={(v) => api.updateDamageZone(zone.id, { needsReplace: v })} />
      </Field>
      <Button block className="bes-inspector-action" onClick={addDrywallRepair}>
        Add drywall repair on its 4 sides
      </Button>
    </>
  );
};

// ── The panel ──

interface BESketchInspectorProps {
  api: BESketchStateAPI;
  selection: SketchSelection;
}

const BESketchInspector: React.FC<BESketchInspectorProps> = ({ api, selection }) => {
  const title = selectionTitle(selection);

  const remove = () => {
    const id = selection.item.id;
    switch (selection.kind) {
      case 'fixture': api.removeFixture(id); break;
      case 'wall': api.removeWall(id); break;
      case 'room': api.removeRoom(id); break;
      case 'drywall': api.removeDrywallRepairZone(id); break;
      case 'insulation': api.removeInsulationZone(id); break;
      case 'damage': api.removeDamageZone(id); break;
    }
    api.setSelectedId(null);
  };

  return (
    <>
      <div className="bes-inspector-head">
        <Tooltip title="Back to the plan (Esc)" mouseEnterDelay={0.6}>
          <Button
            type="text"
            className="ui-icon-btn"
            icon={<ArrowLeftOutlined />}
            onClick={() => api.setSelectedId(null)}
            aria-label="Back to the plan"
          />
        </Tooltip>
        <span className="bes-inspector-title">{title}</span>
        <Tooltip title="Delete (Del)" mouseEnterDelay={0.6}>
          <Button
            type="text"
            className="ui-icon-btn ui-icon-btn--danger"
            icon={<DeleteOutlined />}
            onClick={remove}
            aria-label={`Delete ${title.toLowerCase()}`}
          />
        </Tooltip>
      </div>
      <div className="bes-inspector-body">
        {selection.kind === 'fixture' && <FixtureInspector fixture={selection.item} api={api} />}
        {selection.kind === 'wall' && <WallInspector wall={selection.item} api={api} />}
        {selection.kind === 'room' && <RoomInspector room={selection.item} api={api} />}
        {selection.kind === 'drywall' && <DrywallInspector zone={selection.item} api={api} />}
        {selection.kind === 'insulation' && <InsulationInspector zone={selection.item} api={api} />}
        {selection.kind === 'damage' && <DamageInspector zone={selection.item} api={api} />}
      </div>
    </>
  );
};

export default BESketchInspector;
