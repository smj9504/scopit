/**
 * Scopit - Pending Action Store
 *
 * Holds a single "resume after auth" action across the register/login
 * redirect boundary (e.g. claiming an anonymous packing lead once the
 * visitor creates an account or logs in). Persisted to sessionStorage —
 * narrower lifetime than authStore's localStorage persistence is
 * appropriate here since this only needs to survive one navigation.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface PendingAction {
  type: 'packing-claim';
  token: string;
  returnPath: string;
}

interface PendingActionState {
  pendingAction: PendingAction | null;
  setPendingAction: (action: PendingAction) => void;
  consumePendingAction: () => PendingAction | null;
  clearPendingAction: () => void;
}

export const usePendingActionStore = create<PendingActionState>()(
  persist(
    (set, get) => ({
      pendingAction: null,

      setPendingAction: (action) => set({ pendingAction: action }),

      // Reads then clears in one step so the same action can never be
      // consumed twice (e.g. a duplicate resume call after a re-render).
      consumePendingAction: () => {
        const action = get().pendingAction;
        if (action) {
          set({ pendingAction: null });
        }
        return action;
      },

      clearPendingAction: () => set({ pendingAction: null }),
    }),
    {
      name: 'scopit-pending-action',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);

export default usePendingActionStore;
