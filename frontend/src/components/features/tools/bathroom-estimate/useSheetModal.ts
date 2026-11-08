/**
 * useSheetModal — phones get a modal as a bottom sheet: full width, the
 * header and the footer pinned, the body scrolling between them, and a slide
 * up instead of the zoom. Spread `sheetProps` onto an antd Modal; desktop gets
 * an empty object and keeps the centred dialog. Styles: `.ui-sheet` in
 * bathroomEstimate.css. (MJ Estimate's shared hook, kept with the tool.)
 */

import { Grid } from 'antd';
import type { ModalProps } from 'antd';

/** `tall` keeps the sheet at full height so it does not jump while its content loads */
export const useSheetModal = (variant?: 'tall') => {
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const sheetProps: Partial<ModalProps> = isPhone
    ? {
        wrapClassName: variant === 'tall' ? 'ui-sheet ui-sheet--tall' : 'ui-sheet',
        transitionName: 'ui-sheet-up',
      }
    : {};
  return { isPhone, sheetProps };
};

export default useSheetModal;
