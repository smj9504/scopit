/**
 * Scopit - Header Navigation Context
 * Allows child pages to set back navigation in the app header.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface BackNav {
  label: string;
  path: string;
}

interface HeaderNavContextType {
  backNav: BackNav | null;
  setBackNav: (nav: BackNav | null) => void;
}

const HeaderNavContext = createContext<HeaderNavContextType>({
  backNav: null,
  setBackNav: () => {},
});

export const HeaderNavProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [backNav, setBackNavState] = useState<BackNav | null>(null);
  const location = useLocation();

  const setBackNav = useCallback((nav: BackNav | null) => {
    setBackNavState(nav);
  }, []);

  // Clear back nav on route change
  useEffect(() => {
    setBackNavState(null);
  }, [location.pathname]);

  return (
    <HeaderNavContext.Provider value={{ backNav, setBackNav }}>
      {children}
    </HeaderNavContext.Provider>
  );
};

/**
 * Hook for pages to set back navigation in the header.
 * Call setBackNav({ label: 'Back to Estimates', path: '/app/estimates' }) in useEffect.
 */
export const useHeaderNav = () => useContext(HeaderNavContext);

/**
 * Hook to set back navigation declaratively. Automatically cleans up on unmount.
 */
export const useBackNav = (label: string, path: string) => {
  const { setBackNav } = useHeaderNav();

  useEffect(() => {
    setBackNav({ label, path });
    return () => setBackNav(null);
  }, [label, path, setBackNav]);
};
