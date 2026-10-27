/**
 * Scopit - Focus Mode Context
 * Lets a page take over the whole window: while it's on, AppLayout drops
 * its sidebar, header and bottom nav (e.g. the PDF editor with a document
 * open).
 */
import { createContext, useContext, useEffect } from 'react';

interface FocusModeContextType {
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
}

const FocusModeContext = createContext<FocusModeContextType>({
  focusMode: false,
  setFocusMode: () => {},
});

export const FocusModeProvider = FocusModeContext.Provider;

/** Whether a page has taken over the whole window */
export const useIsFocusMode = () => useContext(FocusModeContext).focusMode;

/**
 * Take over the whole window while `active`. Automatically cleans up on
 * unmount.
 */
export const useFocusMode = (active: boolean) => {
  const { setFocusMode } = useContext(FocusModeContext);

  useEffect(() => {
    if (!active) return;
    setFocusMode(true);
    return () => setFocusMode(false);
  }, [active, setFocusMode]);
};
