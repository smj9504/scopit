/**
 * Roof measurement from free USGS LiDAR: API calls, response types, and conversion into the
 * RoofData shape the Roof Analyzer canvas already draws for EagleView files.
 */
import api from '@/services/api';
import type { RoofData } from './eagleview-parser';

export interface LidarCandidate {
  id: number;
  plan_sqft: number;
  height_ft: number;
  distance_ft: number;
  /** A point inside the building outline; send it to measure(). */
  pick: { lat: number; lon: number };
  /** Outline in preview-image pixels (x right, y down). */
  outline_px: [number, number][];
}

export interface LidarSource {
  provider: string;
  project: string;
  year: number | null;
  density_pts_m2: number;
  building_points: string;
}

export interface LidarLocateResult {
  address: string;
  lat: number;
  lon: number;
  image: { src: string; size_px: number; meters: number };
  center_px: [number, number];
  candidates: LidarCandidate[];
  suggested_id: number | null;
  source: LidarSource;
}

export interface LidarSummary {
  total_area_sqft: number;
  plan_area_sqft: number;
  squares: number;
  facets: number;
  predominant_pitch: number | null;
  area_by_pitch: Record<string, number>;
  line_totals_ft: Record<string, number>;
}

export interface LidarMeasureResult {
  roof: RoofData;
  summary: LidarSummary;
  source: LidarSource;
  warnings: string[];
  footprint_sqft: number;
  height_ft: number;
}

/** What a saved Roof Analyzer session stores for a LiDAR measurement. */
export interface LidarSessionData {
  source: 'lidar';
  filename: string;
  address: string;
  lidar_result: LidarMeasureResult;
}

const LIDAR_TIMEOUT_MS = 120_000; // first request in a new area downloads the point cloud

export const lidarApi = {
  locate: async (address: string): Promise<LidarLocateResult> => {
    const res = await api.post<LidarLocateResult>('/tools/roof-analyzer/lidar/locate', { address }, { timeout: LIDAR_TIMEOUT_MS });
    return res.data;
  },
  measure: async (lat: number, lon: number): Promise<LidarMeasureResult> => {
    const res = await api.post<LidarMeasureResult>('/tools/roof-analyzer/lidar/measure', { lat, lon }, { timeout: LIDAR_TIMEOUT_MS });
    return res.data;
  },
};

/** The backend already returns RoofData; copy it so canvas state never aliases the saved session. */
export function lidarToRoofData(result: LidarMeasureResult): RoofData {
  const { points, lines, faces } = result.roof;
  return {
    points: { ...points },
    lines: { ...lines },
    faces: faces.map(f => ({ ...f, lineIds: [...f.lineIds], vertices: [...f.vertices] })),
  };
}

export function lidarErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown } }; code?: string };
  if (e?.code === 'ECONNABORTED') return 'The LiDAR download took too long. Try again; the second try is usually faster.';
  const detail = e?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}
