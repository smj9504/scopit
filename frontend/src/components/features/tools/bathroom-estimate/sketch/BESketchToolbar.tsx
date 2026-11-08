/**
 * BESketchToolbar - the sketch's one row of tools
 *
 * Select, Room, Wall, and Mark (damage, drywall repair, insulation) on the
 * left with Undo / Redo; Plan or 3D, Save and the panel toggle on the right.
 * Zoom and the view settings float on the canvas instead (see BESketchTab).
 */

import React from 'react';
import { Button, Dropdown, Segmented, Tooltip } from 'antd';
import {
  CheckOutlined,
  DownOutlined,
  HighlightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RedoOutlined,
  SaveOutlined,
  SelectOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import type { BESketchTool } from '@/types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { RoomGlyph, WallGlyph } from './beGlyphs';

export type BESketchView = 'plan' | '3d';

interface BESketchToolbarProps {
  api: BESketchStateAPI;
  view: BESketchView;
  onViewChange: (view: BESketchView) => void;
  onSave: () => void;
  /** Desktop only: the panel beside the canvas */
  panel?: { open: boolean; onToggle: () => void };
}

const DRAW_TOOLS: { key: BESketchTool; label: string; icon: React.ReactNode; tip: string }[] = [
  { key: 'select', label: 'Select', icon: <SelectOutlined />, tip: 'Select, move and edit' },
  { key: 'room', label: 'Room', icon: <RoomGlyph />, tip: 'Draw the room by its corners' },
  { key: 'wall', label: 'Wall', icon: <WallGlyph />, tip: 'Draw a wall' },
];

export const MARK_TOOLS: { key: BESketchTool; label: string; short: string; desc: string }[] = [
  { key: 'damage_zone', label: 'Damage', short: 'Damage', desc: 'Water damage, mold or cement board' },
  { key: 'drywall_repair', label: 'Drywall repair', short: 'Drywall', desc: 'Board, texture and paint to replace' },
  { key: 'insulation', label: 'Insulation', short: 'Insulation', desc: 'Insulation to take out or put in' },
];

const BESketchToolbar: React.FC<BESketchToolbarProps> = ({ api, view, onViewChange, onSave, panel }) => {
  const { activeTool, setActiveTool, undo, redo, canUndo, canRedo, isDirty } = api;
  const isPlan = view === 'plan';
  const mark = MARK_TOOLS.find((t) => t.key === activeTool);

  return (
    <div className="bes-toolbar" role="toolbar" aria-label="Sketch tools">
      {isPlan && (
        <>
          <div className="bes-toolbar-group">
            {DRAW_TOOLS.map((t) => (
              <Tooltip key={t.key} title={t.tip} mouseEnterDelay={0.6}>
                <Button
                  type="text"
                  className={`bes-tool${activeTool === t.key ? ' is-selected' : ''}`}
                  aria-pressed={activeTool === t.key}
                  aria-label={t.label}
                  onClick={() => setActiveTool(t.key)}
                >
                  {t.icon}
                  <span className="bes-tool-label">{t.label}</span>
                </Button>
              </Tooltip>
            ))}
            <Dropdown
              trigger={['click']}
              menu={{
                selectable: true,
                selectedKeys: mark ? [mark.key] : [],
                items: MARK_TOOLS.map((t) => ({
                  key: t.key,
                  label: (
                    <span className="bes-mark-option">
                      <span>{t.label}</span>
                      <span className="bes-mark-option-desc">{t.desc}</span>
                    </span>
                  ),
                })),
                onClick: ({ key }) => setActiveTool(key as BESketchTool),
              }}
            >
              <Button
                type="text"
                className={`bes-tool${mark ? ' is-selected' : ''}`}
                aria-label={mark ? `Mark: ${mark.label}` : 'Mark damage, drywall or insulation'}
              >
                <HighlightOutlined />
                <span className="bes-tool-label">{mark ? mark.short : 'Mark'}</span>
                <DownOutlined className="bes-tool-caret" />
              </Button>
            </Dropdown>
          </div>

          <span className="bes-toolbar-sep" aria-hidden="true" />

          <div className="bes-toolbar-group">
            <Tooltip title="Undo (Ctrl+Z)" mouseEnterDelay={0.6}>
              <Button type="text" className="ui-icon-btn" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} aria-label="Undo" />
            </Tooltip>
            <Tooltip title="Redo (Ctrl+Y)" mouseEnterDelay={0.6}>
              <Button type="text" className="ui-icon-btn" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} aria-label="Redo" />
            </Tooltip>
          </div>
        </>
      )}

      <div className="bes-toolbar-group bes-toolbar-end">
        <Segmented
          value={view}
          onChange={(v) => onViewChange(v as BESketchView)}
          options={[
            { value: 'plan', label: 'Plan' },
            { value: '3d', label: '3D' },
          ]}
          aria-label="Plan or 3D view"
        />
        <Tooltip title={isDirty ? 'Save the sketch (Ctrl+S)' : 'All changes saved'} mouseEnterDelay={0.6}>
          <Button
            className="bes-save"
            icon={isDirty ? <SaveOutlined /> : <CheckOutlined />}
            disabled={!isDirty}
            onClick={onSave}
          >
            <span className="bes-tool-label">{isDirty ? 'Save' : 'Saved'}</span>
          </Button>
        </Tooltip>
        {panel && (
          <Tooltip title={panel.open ? 'Hide panel' : 'Show panel'} mouseEnterDelay={0.6}>
            <Button
              type="text"
              className="ui-icon-btn"
              icon={panel.open ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={panel.onToggle}
              aria-label={panel.open ? 'Hide panel' : 'Show panel'}
              aria-expanded={panel.open}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default BESketchToolbar;
