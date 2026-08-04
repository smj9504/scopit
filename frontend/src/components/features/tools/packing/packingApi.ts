import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type {
  QuickEstimateRequest,
  ContentEstimateRequest,
  EstimateResponse,
  RoomPreset,
  MovingPrice,
  RoomAnalysisResponse,
  MasterContentResponse,
  CorrectionsRequest,
  CompanyInfoOverride,
  SavedCompanyProfile,
  BatchRoomEvent,
  BatchCompleteEvent,
  ReportExportRequest,
  PackoutEstimateRequest,
  PackoutEstimateResponse,
  PackoutClassification,
  DetectedContentItem,
} from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';

export const packingApi = {
  // ── Quick Estimate ────────────────────────────────────────────────────────
  quickEstimate: async (data: QuickEstimateRequest): Promise<EstimateResponse> => {
    const response = await api.post<EstimateResponse>('/tools/packing/quick-estimate', data);
    return response.data;
  },

  // ── Content Estimate (Photo AI mode) ──────────────────────────────────────
  contentEstimate: async (data: ContentEstimateRequest): Promise<EstimateResponse> => {
    const response = await api.post<EstimateResponse>('/tools/packing/content-estimate', data, { timeout: 120_000 });
    return response.data;
  },

  // ── Packout Estimate ────────────────────────────────────────────────────
  packoutEstimate: async (data: PackoutEstimateRequest): Promise<PackoutEstimateResponse> => {
    const response = await api.post<PackoutEstimateResponse>('/tools/packing/packout-estimate', data, { timeout: 60_000 });
    return response.data;
  },

  classifyForPackout: async (
    items: DetectedContentItem[],
    detailLevel: string = 'detailed',
    roomSize: string = 'large',
  ): Promise<PackoutClassification> => {
    const response = await api.post<PackoutClassification>('/tools/packing/classify-for-packout', {
      items,
      detail_level: detailLevel,
      room_size: roomSize,
    });
    return response.data;
  },

  // ── Room Presets ──────────────────────────────────────────────────────────
  getPresets: async (): Promise<Record<string, RoomPreset[]>> => {
    const response = await api.get<Record<string, RoomPreset[]>>('/tools/packing/presets');
    return response.data;
  },

  // ── Prices ────────────────────────────────────────────────────────────────
  getPrices: async (): Promise<MovingPrice[]> => {
    const response = await api.get<MovingPrice[]>('/tools/packing/prices');
    return response.data;
  },

  updatePrice: async (id: string, data: Partial<MovingPrice>): Promise<MovingPrice> => {
    const response = await api.put<MovingPrice>(`/line-items/${id}`, data);
    return response.data;
  },

  // ── Photo Analysis ────────────────────────────────────────────────────────
  analyzeRoom: async (
    data: {
      room_name: string;
      images: string[];
      existing_items?: { name: string; quantity: number }[];
    },
    signal?: AbortSignal,
  ): Promise<RoomAnalysisResponse> => {
    // Vision API calls can take 60-120s; override the default 30s timeout
    const response = await api.post<RoomAnalysisResponse>(
      '/tools/packing/analyze-room',
      data,
      { timeout: 180_000, signal },
    );
    return response.data;
  },

  // ── Master Content List ───────────────────────────────────────────────────
  masterContent: async (data: {
    rooms: { room_name: string; items: any[] }[];
  }): Promise<MasterContentResponse> => {
    const response = await api.post<MasterContentResponse>('/tools/packing/master-content', data, { timeout: 120_000 });
    return response.data;
  },

  // ── Corrections ───────────────────────────────────────────────────────────
  submitCorrections: async (data: CorrectionsRequest): Promise<{ saved: number }> => {
    const response = await api.post<{ saved: number }>('/tools/packing/corrections', data);
    return response.data;
  },

  // ── Export ────────────────────────────────────────────────────────────────
  exportPdf: async (
    sessionId: string,
    companyOverride?: CompanyInfoOverride,
    taxRate?: number,
    showBreakdown?: boolean,
  ): Promise<Blob> => {
    const response = await api.post(
      '/tools/packing/export/pdf',
      {
        session_id: sessionId,
        company_override: companyOverride,
        tax_rate: taxRate ?? 0,
        show_breakdown: showBreakdown ?? false,
      },
      { responseType: 'blob' },
    );
    return response.data;
  },

  exportExcel: async (
    sessionId: string,
    companyOverride?: CompanyInfoOverride,
    taxRate?: number,
    showBreakdown?: boolean,
  ): Promise<Blob> => {
    const response = await api.post(
      '/tools/packing/export/excel',
      {
        session_id: sessionId,
        company_override: companyOverride,
        tax_rate: taxRate ?? 0,
        show_breakdown: showBreakdown ?? false,
      },
      { responseType: 'blob' },
    );
    return response.data;
  },

  // ── Report Export ───────────────────────────────────────────────────
  exportReport: async (data: ReportExportRequest): Promise<Blob> => {
    const response = await api.post(
      '/tools/packing/export/report',
      data,
      { responseType: 'blob', timeout: 120_000 },
    );
    return response.data;
  },

  // ── Address Autocomplete ────────────────────────────────────────────
  addressAutocomplete: async (query: string): Promise<{ address: string; street: string; city: string; state: string; zip: string }[]> => {
    if (query.trim().length < 3) return [];
    const response = await api.get('/tools/packing/address-autocomplete', { params: { q: query } });
    return response.data;
  },

  // ── Company Profiles ────────────────────────────────────────────────
  getCompanyProfiles: async (): Promise<SavedCompanyProfile[]> => {
    const response = await api.get<SavedCompanyProfile[]>('/tools/packing/company-profiles');
    return response.data;
  },

  saveCompanyProfile: async (label: string, data: CompanyInfoOverride): Promise<SavedCompanyProfile> => {
    const response = await api.post<SavedCompanyProfile>('/tools/packing/company-profiles', { label, data });
    return response.data;
  },

  deleteCompanyProfile: async (profileId: string): Promise<void> => {
    await api.delete(`/tools/packing/company-profiles/${profileId}`);
  },

  // ── Photo Storage ───────────────────────────────────────────────────
  uploadPhotos: async (images: string[]): Promise<string[]> => {
    const response = await api.post<{ photo_keys: string[] }>(
      '/tools/packing/photos/upload',
      { images },
      { timeout: 120_000 },
    );
    return response.data.photo_keys;
  },

  getPhotoUrl: (key: string): string => {
    const token = useAuthStore.getState().accessToken;
    const base = `${API_URL}/tools/packing/photos/${key}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },

  /** Fetch a photo as blob URL (authenticated). Use for <img src>. */
  fetchPhotoBlobUrl: async (key: string): Promise<string> => {
    const token = useAuthStore.getState().accessToken;
    const resp = await fetch(`${API_URL}/tools/packing/photos/${key}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`Photo fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  },

  fetchPhotoBase64: async (key: string): Promise<string> => {
    const response = await api.get(`/tools/packing/photos/${key}`, {
      responseType: 'arraybuffer',
    });
    const bytes = new Uint8Array(response.data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  },

  // ── Batch Photo Analysis (SSE) ──────────────────────────────────────
  analyzeBatch: (
    rooms: { room_name: string; images: string[]; existing_items?: { name: string; quantity: number }[] }[],
    callbacks: {
      onRoomResult: (event: BatchRoomEvent) => void;
      onComplete: (event: BatchCompleteEvent) => void;
      onError: (error: string) => void;
    },
    batchId?: string,
  ): { abort: () => void } => {
    const controller = new AbortController();
    const token = useAuthStore.getState().accessToken;

    const run = async () => {
      try {
        const response = await fetch(
          `${API_URL}/tools/packing/analyze-batch`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ rooms, batch_id: batchId }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const text = await response.text();
          let detail = `Server error (${response.status})`;
          try {
            const json = JSON.parse(text);
            detail = json.detail || detail;
          } catch { /* use default */ }
          callbacks.onError(detail);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError('No response stream');
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6);
            } else if (line === '' && currentData) {
              try {
                const parsed = JSON.parse(currentData);
                if (currentEvent === 'room_result') {
                  callbacks.onRoomResult(parsed as BatchRoomEvent);
                } else if (currentEvent === 'batch_complete') {
                  callbacks.onComplete(parsed as BatchCompleteEvent);
                }
              } catch { /* skip malformed */ }
              currentEvent = '';
              currentData = '';
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        callbacks.onError(err?.message || 'Batch analysis failed');
      }
    };

    run();
    return { abort: () => controller.abort() };
  },
};
