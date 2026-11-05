/**
 * Scopit - Auth Store
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@/types/auth';

interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,

      // Actions
      setUser: (user) =>
        set({
          user,
          isAuthenticated: true,
        }),

      setTokens: (accessToken, refreshToken) =>
        set({
          accessToken,
          refreshToken,
          // Don't set isAuthenticated here - wait for user info to be fetched
        }),

      setAccessToken: (accessToken) =>
        set({
          accessToken,
        }),

      login: (user, accessToken, refreshToken) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
        }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setLoading: (loading) =>
        set({
          isLoading: loading,
        }),
    }),
    {
      name: 'scopit-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // localStorage에서 복원 완료 후 isLoading을 false로 설정
        if (state) {
          state.setLoading(false);
        }
      },
    }
  )
);

// Keep every tab on the same session. Without this, signing out (or handing
// the device to a customer for in-person signing, which clears storage) left
// other open tabs signed in, and a token refresh there wrote the session back.
// Also re-checks a page restored from the back/forward cache, whose memory
// may still hold a session that has since been cleared.
if (typeof window !== 'undefined') {
  const syncFromStorage = () => {
    const state = useAuthStore.getState();
    // In-person signing hand-over: this tab deliberately runs with no tokens
    // (isAuthenticated stays true so the signing page stays mounted). Other
    // tabs signing out must not end the customer's visit.
    if (state.isAuthenticated && !state.accessToken) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem('scopit-auth');
    } catch {
      return;
    }
    if (!raw) {
      if (state.accessToken || state.isAuthenticated) state.logout();
      return;
    }
    void useAuthStore.persist.rehydrate();
  };
  window.addEventListener('storage', (event) => {
    if (event.key === 'scopit-auth' || event.key === null) syncFromStorage();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) syncFromStorage();
  });
}

export default useAuthStore;
