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

/** A USGS download tile, for surveys that are only on USGS's download site. */
export interface LidarTile {
  file: string;
  url: string;
  size_mb: number;
  project: string;
  year: number | null;
  contains_address: boolean;
}

/** locate() answer when the survey has to be downloaded by the user and dropped in. */
export interface LidarNeedsTile {
  needs_tile: true;
  address: string;
  lat: number;
  lon: number;
  survey: { project: string; year: number | null };
  tiles: LidarTile[];
}

export interface TilePrepared {
  prep_id: string;
  raw_box: [number, number, number, number];
  covers_address: boolean;
  point_format: number;
  point_length: number;
  point_count: number;
  crs: string;
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

const BASE = '/tools/roof-analyzer/lidar';

export const lidarApi = {
  locate: async (address: string): Promise<LidarLocateResult | LidarNeedsTile> => {
    const res = await api.post<LidarLocateResult | LidarNeedsTile>(`${BASE}/locate`, { address }, { timeout: LIDAR_TIMEOUT_MS });
    return res.data;
  },
  measure: async (lat: number, lon: number, uploadId?: string | null): Promise<LidarMeasureResult> => {
    const res = await api.post<LidarMeasureResult>(
      `${BASE}/measure`,
      { lat, lon, upload_id: uploadId || undefined },
      { timeout: LIDAR_TIMEOUT_MS },
    );
    return res.data;
  },
  // A tile the user downloaded: header first (the backend reads the coordinate system and says which
  // raw box to keep), then the kept points, then the same building picker as locate().
  prepareTile: async (body: { lat: number; lon: number; header_b64: string; evlr_b64?: string }): Promise<TilePrepared> => {
    const res = await api.post<TilePrepared>(`${BASE}/tile/prepare`, body, { timeout: LIDAR_TIMEOUT_MS });
    return res.data;
  },
  uploadTilePoints: async (prepId: string, uploadId: string | undefined, points: ArrayBuffer): Promise<{ upload_id: string; points: number }> => {
    const res = await api.post<{ upload_id: string; points: number }>(`${BASE}/tile/points`, points, {
      params: { prep_id: prepId, upload_id: uploadId },
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: LIDAR_TIMEOUT_MS,
    });
    return res.data;
  },
  locateTile: async (body: {
    upload_id: string; address: string; lat: number; lon: number; project?: string; year?: number | null;
  }): Promise<LidarLocateResult & { upload_id: string }> => {
    const res = await api.post<LidarLocateResult & { upload_id: string }>(
      `${BASE}/tile/locate`, { ...body, year: body.year ?? undefined }, { timeout: LIDAR_TIMEOUT_MS },
    );
    return res.data;
  },
};

export function isNeedsTile(r: LidarLocateResult | LidarNeedsTile): r is LidarNeedsTile {
  return (r as LidarNeedsTile).needs_tile === true;
}

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
  if (err instanceof Error && err.name === 'TileReadError') return err.message;
  const e = err as { response?: { data?: { detail?: unknown } }; code?: string };
  if (e?.code === 'ECONNABORTED') return 'The LiDAR download took too long. Try again; the second try is usually faster.';
  const detail = e?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}
