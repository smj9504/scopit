/**
 * ScopeIt - Packing Demo API Shims
 *
 * The real PhotoAITab / EstimateEditorModal / ReportExportModal / SharedDetailsStep
 * components import `packingApi`, `toolService`, and `customerService` directly at
 * module scope — there's no prop to inject a different client. Since those are
 * plain exported object literals (not classes), we monkey-patch their methods at
 * runtime, before the demo page mounts any of those components. No production
 * component or service file is modified.
 *
 * This is the ONLY way an anonymous public visitor can render the real tool UI
 * safely: every one of these methods normally calls an authenticated endpoint,
 * and the shared axios instance hard-redirects to /login on any 401 — so every
 * reachable call must be shimmed, not just the obviously-relevant ones.
 */
import api from '@/services/api';
import { packingApi } from '@/components/features/tools/packing/packingApi';
import { toolService } from '@/services/toolService';
import { customerService } from '@/services/customerService';
import type {
  BatchCompleteEvent,
  BatchRoomEvent,
  ContentEstimateRequest,
  DetectedContentItem,
  EstimateResponse,
  MovingPrice,
  ReportExportRequest,
  RoomAnalysisResponse,
} from '@/components/features/tools/packing/types';
import type { Customer, CustomerCreate } from '@/types/entities';

const DEMO_API = '/demo/packing';

export interface DemoFixtureRoom {
  room_key: string;
  room_name: string;
  photos: { image: string; caption?: string; is_damage: boolean }[];
  analysis: RoomAnalysisResponse;
}

export async function fetchDemoFixtures(): Promise<DemoFixtureRoom[]> {
  const response = await api.get<DemoFixtureRoom[]>(`${DEMO_API}/fixtures`);
  return response.data;
}

// Known fixture analyses, keyed by lowercased room name — populated once the
// demo page loads /fixtures, so re-analyzing a fixture room (or analyzing it
// as part of a batch) returns the same canned result without another call.
const fixtureAnalysesByName = new Map<string, RoomAnalysisResponse>();

export function registerDemoFixtures(rooms: DemoFixtureRoom[]) {
  for (const room of rooms) {
    fixtureAnalysesByName.set(room.room_name.trim().toLowerCase(), room.analysis);
  }
}

function genericFallbackAnalysis(roomName: string): RoomAnalysisResponse {
  const items: DetectedContentItem[] = [
    {
      name: 'Miscellaneous Boxed Items',
      category: 'Other',
      quantity: 6,
      is_high_value: false,
      is_fragile: false,
      needs_disassembly: false,
      confidence: 0.7,
    },
    {
      name: 'Furniture Piece',
      category: 'Furniture',
      quantity: 2,
      is_high_value: false,
      is_fragile: false,
      needs_disassembly: false,
      confidence: 0.65,
    },
  ];
  return {
    room_name: roomName,
    items,
    low_confidence_items: [],
    density: 'normal',
    room_size: 'medium',
    confidence_score: 0.68,
    total_labor_hours: 0,
    fragile_count: 0,
    high_value_count: 0,
    field_notes: [
      "Demo mode: this isn't one of the pre-analyzed sample rooms, so a generic placeholder is shown instead of a real AI analysis.",
    ],
  };
}

// The export shims (exportPdf/exportExcel) only receive a sessionId in the
// real flow — in the demo there's no session, so the page keeps the current
// EstimateResponse mirrored here for those shims to read at call time.
let currentDemoResult: EstimateResponse | null = null;
export function setDemoResult(result: EstimateResponse | null) {
  currentDemoResult = result;
}

let installed = false;

/** Monkey-patch every network-calling method the demo's component tree can
 * reach. Idempotent — safe to call multiple times (e.g. React StrictMode). */
export function installPackingDemoShims() {
  if (installed) return;
  installed = true;

  // ── Analysis — no real AI call ever runs ──────────────────────────────
  packingApi.analyzeRoom = async (data) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const match = fixtureAnalysesByName.get(data.room_name.trim().toLowerCase());
    return match ?? genericFallbackAnalysis(data.room_name);
  };

  packingApi.analyzeBatch = (rooms, callbacks, batchId) => {
    let aborted = false;
    (async () => {
      let succeeded = 0;
      for (let i = 0; i < rooms.length; i++) {
        if (aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 700));
        const match = fixtureAnalysesByName.get(rooms[i].room_name.trim().toLowerCase());
        const result = match ?? genericFallbackAnalysis(rooms[i].room_name);
        succeeded += 1;
        const event: BatchRoomEvent = {
          event: 'room_result',
          batch_id: batchId,
          room_index: i,
          total_rooms: rooms.length,
          status: 'success',
          room_name: rooms[i].room_name,
          result,
        };
        callbacks.onRoomResult(event);
      }
      if (!aborted) {
        const complete: BatchCompleteEvent = {
          event: 'batch_complete',
          batch_id: batchId,
          total_rooms: rooms.length,
          succeeded,
          failed: 0,
          failed_rooms: [],
        };
        callbacks.onComplete(complete);
      }
    })();
    return { abort: () => { aborted = true; } };
  };

  // ── Estimate calculation — real math, via the public demo endpoint ────
  packingApi.contentEstimate = async (data: ContentEstimateRequest): Promise<EstimateResponse> => {
    const response = await api.post<EstimateResponse>(`${DEMO_API}/estimate`, data, { timeout: 30_000 });
    return response.data;
  };
  packingApi.quickEstimate = async () => {
    throw new Error('Quick Estimate mode is not available in this demo — try Photo AI.');
  };
  packingApi.packoutEstimate = async () => {
    throw new Error('Packout mode is not available in this demo — try Photo AI.');
  };
  packingApi.classifyForPackout = async () => {
    throw new Error('Packout mode is not available in this demo.');
  };
  packingApi.masterContent = async () => ({
    items: [],
    total_items: 0,
    total_labor_hours: 0,
    high_value_count: 0,
    fragile_count: 0,
    flag_summary: {},
  });
  packingApi.submitCorrections = async () => ({ saved: 0 });

  // ── Presets / prices / company profiles / address lookup — these are
  // real company data behind auth; never call the real endpoints ────────
  packingApi.getPresets = async () => ({});
  packingApi.getPrices = async (): Promise<MovingPrice[]> => [];
  packingApi.updatePrice = async (id, data) => ({
    id,
    code: data.code ?? '',
    name: data.name ?? '',
    unit: data.unit ?? '',
    unit_price: data.unit_price ?? 0,
    cat: data.cat ?? '',
  });
  packingApi.getCompanyProfiles = async () => [];
  packingApi.saveCompanyProfile = async (label, data) => ({ id: `demo-${Date.now()}`, label, data });
  packingApi.deleteCompanyProfile = async () => {};
  packingApi.addressAutocomplete = async () => [];

  // ── Photo storage — photos are kept in-memory as base64 from the start
  // (see PackingDemoPage), so these should rarely fire; safety nets only ──
  packingApi.uploadPhotos = async (images: string[]) => images.map((_, i) => `demo-photo-${i}`);
  packingApi.fetchPhotoBlobUrl = async () => '';
  packingApi.fetchPhotoBase64 = async () => '';

  // ── Export — route to the public demo PDF/Excel/report endpoints,
  // ignoring the (nonexistent) real sessionId ────────────────────────────
  packingApi.exportPdf = async (_sessionId, companyOverride, taxRate) => {
    if (!currentDemoResult) throw new Error('Calculate an estimate first.');
    const response = await api.post(
      `${DEMO_API}/estimate/pdf`,
      { result: currentDemoResult, company_override: companyOverride, tax_rate: taxRate ?? 0 },
      { responseType: 'blob' },
    );
    return response.data;
  };
  packingApi.exportExcel = async (_sessionId, companyOverride, taxRate) => {
    if (!currentDemoResult) throw new Error('Calculate an estimate first.');
    const response = await api.post(
      `${DEMO_API}/estimate/excel`,
      { result: currentDemoResult, company_override: companyOverride, tax_rate: taxRate ?? 0 },
      { responseType: 'blob' },
    );
    return response.data;
  };
  packingApi.exportReport = async (data: ReportExportRequest) => {
    const response = await api.post(`${DEMO_API}/report`, data, { responseType: 'blob', timeout: 60_000 });
    return response.data;
  };

  // ── Session management — no real sessions exist in a public demo ──────
  toolService.listSessions = async () => [];
  toolService.getSession = async () => {
    throw new Error('Loading saved estimates is not available in the demo.');
  };
  toolService.createSession = async () => {
    throw new Error('Saving is not available in the demo.');
  };
  toolService.updateSession = async () => {
    throw new Error('Saving is not available in the demo.');
  };
  toolService.deleteSession = async () => {};
  toolService.createInvoiceFromSession = async () => {
    throw new Error('Invoice creation is not available in the demo — sign up to create real invoices.');
  };
  toolService.createEstimateFromSession = async () => {
    throw new Error('Estimate creation is not available in the demo — sign up to create real estimates.');
  };

  // ── Customer search — never expose the real customer list publicly ────
  customerService.search = async () => [];
  customerService.getById = async () => {
    throw new Error('Not available in the demo.');
  };
  customerService.create = async (data: CustomerCreate): Promise<Customer> => ({
    id: `demo-${Date.now()}`,
    companyId: 'demo',
    name: data.name,
    contactName: data.contactName,
    email: data.email,
    phone: data.phone,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    state: data.state,
    zipcode: data.zipcode,
    notes: data.notes,
    isActive: true,
    createdAt: new Date().toISOString(),
  });
}
