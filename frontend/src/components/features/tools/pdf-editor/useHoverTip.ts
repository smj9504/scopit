/**
 * Scopit - PDF Editor: tooltips only where there's a mouse
 *
 * On a touch screen a tap opens a hover tooltip and leaves it up, over the
 * buttons next to it, until something else is tapped. Spread on a Tooltip
 * to keep it closed there.
 *
 * Usage:
 *   const tip = useHoverTip();
 *   <Tooltip title="Undo" {...tip}>…</Tooltip>
 */
import { useEffect, useState } from 'react';

const HOVER_QUERY = '(hover: hover)';
const OPEN_ON_HOVER = {};
const NEVER_OPEN = { open: false };

export function useHoverTip(): { open?: boolean } {
  const [canHover, setCanHover] = useState(
    () => typeof window === 'undefined' || window.matchMedia(HOVER_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(HOVER_QUERY);
    const onChange = () => setCanHover(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return canHover ? OPEN_ON_HOVER : NEVER_OPEN;
}
