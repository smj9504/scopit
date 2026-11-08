/**
 * Cabinet Estimate Sketch API service.
 */

import api from '@/services/api';
import type {
  CabinetSketch,
  CabinetSketchOverlayData,
  CabinetSketchUpdate,
} from '@/types/cabinetSketch';
import { EMPTY_CABINET_OVERLAY_DATA } from '@/types/cabinetSketch';

const BASE_URL = '/tools/cabinet-estimate';

/**
 * Overlay saves still on their way, by estimate. The sketch saves as it's
 * left, so opening it again waits for that: read sooner, it would show the
 * layout from before the last change.
 */
const savesUnderway = new Map<string, Promise<unknown>>();

/** Ensure overlay_data array fields are defined (backend JSONB may omit empty arrays) */
function normalize(sketch: CabinetSketch): CabinetSketch {
  const od = sketch.overlay_data;
  if (!od || typeof od !== 'object') {
    return { ...sketch, overlay_data: { ...EMPTY_CABINET_OVERLAY_DATA } };
  }
  return { ...sketch, overlay_data: { ...EMPTY_CABINET_OVERLAY_DATA, ...od } };
}

export const cabinetSketchService = {
  /** Get (or lazily create) the layout sketch for an estimate */
  getSketch: async (estimateId: string): Promise<CabinetSketch> => {
    await savesUnderway.get(estimateId);
    const response = await api.get(`${BASE_URL}/${estimateId}/sketch`);
    return normalize(response.data);
  },

  /** Update sketch canvas metadata (size/scale) only */
  updateSketchMeta: async (
    estimateId: string,
    data: CabinetSketchUpdate
  ): Promise<CabinetSketch> => {
    const response = await api.put(`${BASE_URL}/${estimateId}/sketch`, data);
    return normalize(response.data);
  },

  /**
   * Replace the sketch's overlay data (walls + cabinets) wholesale.
   * Full replace, not a diff — pass the complete overlay state.
   */
  saveOverlay: async (
    estimateId: string,
    overlayData: CabinetSketchOverlayData
  ): Promise<CabinetSketch> => {
    const saving = api.put(
      `${BASE_URL}/${estimateId}/sketch/overlay`,
      overlayData
    );
    // With any earlier save, which may still be out too.
    const underway = Promise.allSettled([savesUnderway.get(estimateId), saving]);
    savesUnderway.set(estimateId, underway);
    underway.then(() => {
      if (savesUnderway.get(estimateId) === underway) savesUnderway.delete(estimateId);
    });
    const response = await saving;
    return normalize(response.data);
  },

  /**
   * Redraw the 3D view's realistic render as a photo of the finished
   * kitchen (an AI concept picture; not stored). `finish` is the finish in
   * words (finishWords), `notes` anything else the picture should show.
   */
  makeAiPhoto: async (
    estimateId: string,
    request: { image: string; finish: string; notes?: string }
  ): Promise<{ image: string; model: string }> => {
    // An image model takes a while to answer.
    const response = await api.post(`${BASE_URL}/${estimateId}/sketch/ai-photo`, request, { timeout: 150000 });
    return response.data;
  },
};

export default cabinetSketchService;
