/**
 * Scopit - PDF Editor: the phone's page bar
 *
 * Undo / redo and the page arrows, floating over the bottom of the page on
 * a phone, where the toolbar has no room left for them. Positioned by the
 * editor, inside its (relative) page area.
 *
 * Usage:
 *   <PageNavBar canUndo canRedo={false} onUndo={undo} onRedo={redo}
 *     currentPage={1} pageCount={3} onPageChange={setPage} />
 */
import React from 'react';
import { LeftOutlined, RedoOutlined, RightOutlined, UndoOutlined } from '@ant-design/icons';
import { colors, fonts, fontSizes, fontWeights } from '@/styles/theme';

export interface PageNavBarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

const BUTTON_SIZE = 40;
const BOTTOM_GAP = 12;
/** How much of the bottom of the page area the bar takes (with gaps), for the page to scroll clear of it */
export const PAGE_NAV_BAR_CLEARANCE = BOTTOM_GAP + BUTTON_SIZE + 6 + BOTTOM_GAP;

const NavButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}> = ({ label, icon, disabled, onClick }) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    style={{
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      borderRadius: BUTTON_SIZE / 2,
      background: 'transparent',
      color: disabled ? colors.textMuted : colors.textPrimary,
      fontSize: 16,
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: 0,
      touchAction: 'manipulation',
    }}
  >
    {icon}
  </button>
);

const PageNavBar: React.FC<PageNavBarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  currentPage,
  pageCount,
  onPageChange,
}) => (
  <div
    role="toolbar"
    aria-label="Undo and pages"
    style={{
      position: 'absolute',
      left: '50%',
      bottom: `calc(${BOTTOM_GAP}px + env(safe-area-inset-bottom))`,
      transform: 'translateX(-50%)',
      zIndex: 15,
      display: 'flex',
      alignItems: 'center',
      padding: 2,
      background: colors.bgWhite,
      border: `1px solid ${colors.border}`,
      borderRadius: BUTTON_SIZE / 2 + 3,
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
      fontFamily: fonts.body,
      userSelect: 'none',
    }}
  >
    <NavButton label="Undo" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} />
    <NavButton label="Redo" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} />
    <span aria-hidden="true" style={{ width: 1, height: 20, margin: '0 4px', background: colors.border }} />
    <NavButton
      label="Previous page"
      icon={<LeftOutlined />}
      disabled={currentPage <= 1}
      onClick={() => onPageChange(currentPage - 1)}
    />
    <span
      aria-live="polite"
      style={{
        minWidth: 44,
        textAlign: 'center',
        fontSize: fontSizes.sm,
        fontWeight: fontWeights.semibold,
        color: colors.textPrimary,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {currentPage} / {pageCount}
    </span>
    <NavButton
      label="Next page"
      icon={<RightOutlined />}
      disabled={currentPage >= pageCount}
      onClick={() => onPageChange(currentPage + 1)}
    />
  </div>
);

export default PageNavBar;
