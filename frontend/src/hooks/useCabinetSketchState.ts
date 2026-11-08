/**
 * useCabinetSketchState
 *
 * useReducer-based state management for the cabinet sketch canvas overlay
 * data. Trimmed down from the water mitigation sketch's useWMSketchState:
 * only walls + placed cabinets and appliances, selection, batch-move, z-order, and
 * undo/redo (up to 50 entries) — no demolition/equipment/containment/room
 * concepts.
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  CabinetSketchOverlayData,
  CabinetSketchWall,
  CabinetSketchCabinet,
  CabinetSketchAppliance,
  CabinetSketchFinish,
  CabinetSketchTool,
  CabinetSketchSelection,
} from '@/types/cabinetSketch';
import { EMPTY_CABINET_OVERLAY_DATA } from '@/types/cabinetSketch';

/** The sketch's backsplash choices, any of them, set together. */
type BacksplashChoices = Partial<
  Pick<CabinetSketchOverlayData, 'backsplash_off' | 'backsplash_on' | 'backsplash_trim'>
>;

const MAX_UNDO_STACK = 50;

export interface CabinetSketchLocalState {
  overlayData: CabinetSketchOverlayData;
  activeTool: CabinetSketchTool;
  /** Catalog code awaiting placement when activeTool === 'place_cabinet' */
  activePresetCode: string | null;
  selections: CabinetSketchSelection[];
  isDirty: boolean;
  undoStack: CabinetSketchOverlayData[];
  redoStack: CabinetSketchOverlayData[];
}

type CabinetSketchAction =
  | { type: 'SET_TOOL'; payload: CabinetSketchTool }
  | { type: 'SET_ACTIVE_PRESET'; payload: string | null }
  | { type: 'SELECT_ELEMENT'; payload: CabinetSketchSelection }
  | { type: 'TOGGLE_SELECT_ELEMENT'; payload: CabinetSketchSelection }
  | { type: 'SELECT_ELEMENTS'; payload: { selections: CabinetSketchSelection[]; add: boolean } }
  | { type: 'DESELECT' }
  | { type: 'ADD_WALL'; payload: CabinetSketchWall }
  | { type: 'UPDATE_WALL'; payload: Partial<CabinetSketchWall> & { id: string } }
  | { type: 'REMOVE_WALL'; payload: string }
  | { type: 'ADD_CABINET'; payload: CabinetSketchCabinet }
  | { type: 'UPDATE_CABINET'; payload: Partial<CabinetSketchCabinet> & { id: string } }
  | { type: 'UPDATE_CABINETS'; payload: (Partial<CabinetSketchCabinet> & { id: string })[] }
  | { type: 'UPDATE_ELEMENTS'; payload: ElementPatches }
  | { type: 'REMOVE_CABINET'; payload: string }
  | { type: 'BATCH_MOVE_SELECTED'; payload: { draggedId: string; newX: number; newY: number } }
  | { type: 'BRING_TO_FRONT'; payload: string }
  | { type: 'SEND_TO_BACK'; payload: string }
  | { type: 'BRING_FORWARD'; payload: string }
  | { type: 'SEND_BACKWARD'; payload: string }
  | { type: 'SYNC_CABINETS'; payload: CabinetSketchCabinet[] }
  | { type: 'SET_ISLAND_SIDES'; payload: { twoSided: boolean; cabinets: CabinetSketchCabinet[] } }
  | { type: 'UPDATE_APPLIANCES'; payload: (Partial<CabinetSketchAppliance> & { id: string })[] }
  | { type: 'SYNC_APPLIANCES'; payload: CabinetSketchAppliance[] }
  | { type: 'SET_FINISH'; payload: CabinetSketchFinish }
  | { type: 'SET_BACKSPLASH'; payload: BacksplashChoices }
  | { type: 'LOAD_OVERLAY_DATA'; payload: CabinetSketchOverlayData }
  | { type: 'MARK_SAVED' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

/** Changes to several kinds of element at once: a group moved or turned, walls following a joint. */
export interface ElementPatches {
  walls?: (Partial<CabinetSketchWall> & { id: string })[];
  cabinets?: (Partial<CabinetSketchCabinet> & { id: string })[];
  appliances?: (Partial<CabinetSketchAppliance> & { id: string })[];
}

function pushUndo(
  state: CabinetSketchLocalState
): Pick<CabinetSketchLocalState, 'undoStack' | 'redoStack'> {
  const next = [state.overlayData, ...state.undoStack].slice(0, MAX_UNDO_STACK);
  return { undoStack: next, redoStack: [] };
}

function buildDefaultOrder(data: CabinetSketchOverlayData): string[] {
  return [...data.walls.map((w) => w.id), ...data.cabinets.map((c) => c.id)];
}

function ensureOrder(data: CabinetSketchOverlayData): string[] {
  return data.element_order && data.element_order.length > 0
    ? data.element_order
    : buildDefaultOrder(data);
}

function updateById<T extends { id: string }>(
  items: T[],
  patch: Partial<T> & { id: string }
): T[] {
  return items.map((item) => (item.id === patch.id ? { ...item, ...patch } : item));
}

function cabinetSketchReducer(
  state: CabinetSketchLocalState,
  action: CabinetSketchAction
): CabinetSketchLocalState {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.payload };

    case 'SET_ACTIVE_PRESET':
      return { ...state, activePresetCode: action.payload };

    case 'SELECT_ELEMENT':
      return { ...state, selections: [action.payload] };

    case 'TOGGLE_SELECT_ELEMENT': {
      const exists = state.selections.some((s) => s.element_id === action.payload.element_id);
      const newSelections = exists
        ? state.selections.filter((s) => s.element_id !== action.payload.element_id)
        : [...state.selections, action.payload];
      return { ...state, selections: newSelections };
    }

    // A drag-box or a group pick: the whole selection at once, or added to it.
    case 'SELECT_ELEMENTS': {
      const { selections, add } = action.payload;
      const base = add ? state.selections : [];
      const fresh = selections.filter((s) => !base.some((b) => b.element_id === s.element_id));
      return { ...state, selections: [...base, ...fresh] };
    }

    case 'DESELECT':
      return { ...state, selections: [] };

    case 'ADD_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, walls: [...state.overlayData.walls, action.payload] },
      };
    }

    case 'UPDATE_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          walls: updateById(state.overlayData.walls, action.payload),
        },
      };
    }

    case 'REMOVE_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: state.selections.filter((s) => s.element_id !== action.payload),
        overlayData: {
          ...state.overlayData,
          walls: state.overlayData.walls.filter((w) => w.id !== action.payload),
        },
      };
    }

    case 'ADD_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: [...state.overlayData.cabinets, action.payload],
        },
      };
    }

    case 'UPDATE_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: updateById(state.overlayData.cabinets, action.payload),
        },
      };
    }

    // Several cabinets at once (turning a group), as one undo step.
    case 'UPDATE_CABINETS': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: action.payload.reduce((cabs, patch) => updateById(cabs, patch), state.overlayData.cabinets),
        },
      };
    }

    // Walls, cabinets and appliances changed together, as one undo step.
    case 'UPDATE_ELEMENTS': {
      const { walls = [], cabinets = [], appliances = [] } = action.payload;
      if (walls.length + cabinets.length + appliances.length === 0) return state;
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          walls: walls.reduce((ws, patch) => updateById(ws, patch), state.overlayData.walls),
          cabinets: cabinets.reduce((cs, patch) => updateById(cs, patch), state.overlayData.cabinets),
          appliances: appliances.reduce((as, patch) => updateById(as, patch), state.overlayData.appliances ?? []),
        },
      };
    }

    case 'REMOVE_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: state.selections.filter((s) => s.element_id !== action.payload),
        overlayData: {
          ...state.overlayData,
          cabinets: state.overlayData.cabinets.filter((c) => c.id !== action.payload),
        },
      };
    }

    case 'BATCH_MOVE_SELECTED': {
      const { draggedId, newX, newY } = action.payload;
      const selectedIdSet = new Set(state.selections.map((s) => s.element_id));

      const allElements = [...state.overlayData.cabinets];
      const draggedEl = allElements.find((el) => el.id === draggedId);
      const oldX = draggedEl?.x ?? 0;
      const oldY = draggedEl?.y ?? 0;
      const dx = newX - oldX;
      const dy = newY - oldY;

      const moveIfSelected = <T extends { id: string; x: number; y: number }>(items: T[]): T[] =>
        items.map((item) =>
          selectedIdSet.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item
        );
      // An appliance in a cabinet goes with the cabinet (see sketchAppliances), so only free-standing ones move here.
      const free = (state.overlayData.appliances ?? []).map((a) => (a.host_id ? a : moveIfSelected([a])[0]));

      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: moveIfSelected(state.overlayData.cabinets),
          appliances: free,
        },
      };
    }

    case 'BRING_TO_FRONT': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.push(action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    case 'SEND_TO_BACK': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.unshift(action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    case 'BRING_FORWARD': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = [...ensureOrder(state.overlayData)];
      const idx = order.indexOf(action.payload);
      if (idx >= 0 && idx < order.length - 1) {
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
      }
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    case 'SEND_BACKWARD': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = [...ensureOrder(state.overlayData)];
      const idx = order.indexOf(action.payload);
      if (idx > 0) {
        [order[idx], order[idx - 1]] = [order[idx - 1], order[idx]];
      }
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    // Follows the Edit tab's box list rather than a user edit on the canvas,
    // so it's not an undo step: undoing past it would only be re-synced.
    case 'SYNC_CABINETS': {
      const ids = new Set(action.payload.map((c) => c.id));
      const order = state.overlayData.element_order.filter(
        (id) => ids.has(id) || state.overlayData.walls.some((w) => w.id === id)
      );
      return {
        ...state,
        isDirty: true,
        selections: state.selections.filter(
          (s) => s.element_type !== 'cabinet' || ids.has(s.element_id)
        ),
        overlayData: { ...state.overlayData, cabinets: action.payload, element_order: order },
      };
    }

    // The island laid out for the Edit tab's "Cabinets on both sides" (see
    // layoutIslandSides), and that setting noted: follows the Edit tab like
    // SYNC_CABINETS, so not an undo step either.
    case 'SET_ISLAND_SIDES':
      return {
        ...state,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: action.payload.cabinets,
          island_two_sided: action.payload.twoSided,
        },
      };

    // Appliances dragged or turned on the canvas, as one undo step.
    case 'UPDATE_APPLIANCES': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          appliances: action.payload.reduce(
            (apps, patch) => updateById(apps, patch),
            state.overlayData.appliances ?? []
          ),
        },
      };
    }

    // Follows the Edit tab's appliance list (and the cabinets appliances sit
    // in), like SYNC_CABINETS — not an undo step.
    case 'SYNC_APPLIANCES': {
      const ids = new Set(action.payload.map((a) => a.id));
      return {
        ...state,
        isDirty: true,
        selections: state.selections.filter((s) => s.element_type !== 'appliance' || ids.has(s.element_id)),
        overlayData: { ...state.overlayData, appliances: action.payload },
      };
    }

    // The realistic 3D look's finish, as one undo step.
    case 'SET_FINISH': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, finish: action.payload },
      };
    }

    // Which wall faces have backsplash and where it stops, as one undo step.
    case 'SET_BACKSPLASH': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, ...action.payload },
      };
    }

    case 'LOAD_OVERLAY_DATA':
      return {
        ...state,
        overlayData: action.payload,
        isDirty: false,
        undoStack: [],
        redoStack: [],
        selections: [],
      };

    case 'MARK_SAVED':
      return { ...state, isDirty: false };

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const [previous, ...remainingUndo] = state.undoStack;
      return {
        ...state,
        overlayData: previous,
        undoStack: remainingUndo,
        redoStack: [state.overlayData, ...state.redoStack],
        isDirty: true,
        selections: [],
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const [next, ...remainingRedo] = state.redoStack;
      return {
        ...state,
        overlayData: next,
        redoStack: remainingRedo,
        undoStack: [state.overlayData, ...state.undoStack],
        isDirty: true,
        selections: [],
      };
    }

    default:
      return state;
  }
}

function createInitialState(
  initialOverlay: CabinetSketchOverlayData = EMPTY_CABINET_OVERLAY_DATA
): CabinetSketchLocalState {
  return {
    overlayData: initialOverlay,
    activeTool: 'select',
    activePresetCode: null,
    selections: [],
    isDirty: false,
    undoStack: [],
    redoStack: [],
  };
}

export interface CabinetSketchStateReturn {
  state: CabinetSketchLocalState;
  setTool: (tool: CabinetSketchTool) => void;
  setActivePreset: (code: string | null) => void;
  selectElement: (selection: CabinetSketchSelection) => void;
  toggleSelectElement: (selection: CabinetSketchSelection) => void;
  /** Select these (or, with `add`, add them to the selection). */
  selectElements: (selections: CabinetSketchSelection[], add?: boolean) => void;
  deselect: () => void;
  selectedIds: Set<string>;
  batchMoveSelected: (draggedId: string, newX: number, newY: number) => void;

  addWall: (wall: CabinetSketchWall) => void;
  updateWall: (patch: Partial<CabinetSketchWall> & { id: string }) => void;
  removeWall: (id: string) => void;

  addCabinet: (cabinet: CabinetSketchCabinet) => void;
  updateCabinet: (patch: Partial<CabinetSketchCabinet> & { id: string }) => void;
  updateCabinets: (patches: (Partial<CabinetSketchCabinet> & { id: string })[]) => void;
  removeCabinet: (id: string) => void;
  /** Walls, cabinets and appliances changed together, as one undo step. */
  updateElements: (patches: ElementPatches) => void;

  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  syncCabinets: (cabinets: CabinetSketchCabinet[]) => void;
  /** The island re-laid for "Cabinets on both sides" (or left as drawn), with that setting noted in the sketch. */
  setIslandSides: (twoSided: boolean, cabinets: CabinetSketchCabinet[]) => void;
  updateAppliances: (patches: (Partial<CabinetSketchAppliance> & { id: string })[]) => void;
  syncAppliances: (appliances: CabinetSketchAppliance[]) => void;
  setFinish: (finish: CabinetSketchFinish) => void;
  /** Which wall faces have backsplash and where it stops short (splashFaceKey keys, cabinetBacksplash.ts). */
  setBacksplash: (choices: BacksplashChoices) => void;
  loadOverlayData: (data: CabinetSketchOverlayData) => void;
  markSaved: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCabinetSketchState(
  initialOverlay: CabinetSketchOverlayData = EMPTY_CABINET_OVERLAY_DATA
): CabinetSketchStateReturn {
  const [state, dispatch] = useReducer(cabinetSketchReducer, initialOverlay, createInitialState);

  const setTool = useCallback((tool: CabinetSketchTool) => dispatch({ type: 'SET_TOOL', payload: tool }), []);
  const setActivePreset = useCallback(
    (code: string | null) => dispatch({ type: 'SET_ACTIVE_PRESET', payload: code }),
    []
  );
  const selectElement = useCallback(
    (selection: CabinetSketchSelection) => dispatch({ type: 'SELECT_ELEMENT', payload: selection }),
    []
  );
  const toggleSelectElement = useCallback(
    (selection: CabinetSketchSelection) => dispatch({ type: 'TOGGLE_SELECT_ELEMENT', payload: selection }),
    []
  );
  const selectElements = useCallback(
    (selections: CabinetSketchSelection[], add = false) =>
      dispatch({ type: 'SELECT_ELEMENTS', payload: { selections, add } }),
    []
  );
  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);
  const batchMoveSelected = useCallback(
    (draggedId: string, newX: number, newY: number) =>
      dispatch({ type: 'BATCH_MOVE_SELECTED', payload: { draggedId, newX, newY } }),
    []
  );

  const addWall = useCallback((wall: CabinetSketchWall) => dispatch({ type: 'ADD_WALL', payload: wall }), []);
  const updateWall = useCallback(
    (patch: Partial<CabinetSketchWall> & { id: string }) => dispatch({ type: 'UPDATE_WALL', payload: patch }),
    []
  );
  const removeWall = useCallback((id: string) => dispatch({ type: 'REMOVE_WALL', payload: id }), []);

  const addCabinet = useCallback(
    (cabinet: CabinetSketchCabinet) => dispatch({ type: 'ADD_CABINET', payload: cabinet }),
    []
  );
  const updateCabinet = useCallback(
    (patch: Partial<CabinetSketchCabinet> & { id: string }) =>
      dispatch({ type: 'UPDATE_CABINET', payload: patch }),
    []
  );
  const updateCabinets = useCallback(
    (patches: (Partial<CabinetSketchCabinet> & { id: string })[]) =>
      dispatch({ type: 'UPDATE_CABINETS', payload: patches }),
    []
  );
  const removeCabinet = useCallback((id: string) => dispatch({ type: 'REMOVE_CABINET', payload: id }), []);
  const updateElements = useCallback(
    (patches: ElementPatches) => dispatch({ type: 'UPDATE_ELEMENTS', payload: patches }),
    []
  );

  const bringToFront = useCallback((id: string) => dispatch({ type: 'BRING_TO_FRONT', payload: id }), []);
  const sendToBack = useCallback((id: string) => dispatch({ type: 'SEND_TO_BACK', payload: id }), []);
  const bringForward = useCallback((id: string) => dispatch({ type: 'BRING_FORWARD', payload: id }), []);
  const sendBackward = useCallback((id: string) => dispatch({ type: 'SEND_BACKWARD', payload: id }), []);

  const syncCabinets = useCallback(
    (cabinets: CabinetSketchCabinet[]) => dispatch({ type: 'SYNC_CABINETS', payload: cabinets }),
    []
  );
  const setIslandSides = useCallback(
    (twoSided: boolean, cabinets: CabinetSketchCabinet[]) =>
      dispatch({ type: 'SET_ISLAND_SIDES', payload: { twoSided, cabinets } }),
    []
  );
  const updateAppliances = useCallback(
    (patches: (Partial<CabinetSketchAppliance> & { id: string })[]) =>
      dispatch({ type: 'UPDATE_APPLIANCES', payload: patches }),
    []
  );
  const syncAppliances = useCallback(
    (appliances: CabinetSketchAppliance[]) => dispatch({ type: 'SYNC_APPLIANCES', payload: appliances }),
    []
  );
  const setFinish = useCallback(
    (finish: CabinetSketchFinish) => dispatch({ type: 'SET_FINISH', payload: finish }),
    []
  );
  const setBacksplash = useCallback(
    (choices: BacksplashChoices) => dispatch({ type: 'SET_BACKSPLASH', payload: choices }),
    []
  );
  const loadOverlayData = useCallback(
    (data: CabinetSketchOverlayData) => dispatch({ type: 'LOAD_OVERLAY_DATA', payload: data }),
    []
  );
  const markSaved = useCallback(() => dispatch({ type: 'MARK_SAVED' }), []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  const selectedIds = useMemo(() => new Set(state.selections.map((s) => s.element_id)), [state.selections]);

  return {
    state,
    setTool,
    setActivePreset,
    selectElement,
    toggleSelectElement,
    selectElements,
    deselect,
    selectedIds,
    batchMoveSelected,
    addWall,
    updateWall,
    removeWall,
    addCabinet,
    updateCabinet,
    updateCabinets,
    removeCabinet,
    updateElements,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    syncCabinets,
    setIslandSides,
    updateAppliances,
    syncAppliances,
    setFinish,
    setBacksplash,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
