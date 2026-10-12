/**
 * Scopit - Tool Presentation Metadata
 *
 * Frontend-only display data for each tool, keyed by the backend tool id:
 * nav label, icon, job types, one-line description and roadmap note.
 * Access, plan and the canonical name still come from the /tools API —
 * this module only decides how a tool is presented in nav, dashboard and
 * the Tools page.
 */
import React from 'react';
import { colors } from '@/styles/theme';

// ── Icons ─────────────────────────────────────────────────────────────────────

interface StrokeIconProps {
  size?: number;
  /** Stroke color; defaults to currentColor so the parent decides. */
  color?: string;
  children: React.ReactNode;
}

/** 24×24 outline icon in the app-shell style (2px stroke, round joins). */
export const StrokeIcon: React.FC<StrokeIconProps> = ({ size = 18, color = 'currentColor', children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ display: 'block', flexShrink: 0 }}
  >
    {children}
  </svg>
);

export interface ToolIconProps {
  size?: number;
  color?: string;
}

const BoxIcon: React.FC<ToolIconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </StrokeIcon>
);

const HouseIcon: React.FC<ToolIconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </StrokeIcon>
);

const MagnifierIcon: React.FC<ToolIconProps> = (p) => (
  <StrokeIcon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </StrokeIcon>
);

const PenIcon: React.FC<ToolIconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </StrokeIcon>
);

/** Four-square grid — "all tools" / unknown tool fallback. */
export const GridIcon: React.FC<ToolIconProps> = (p) => (
  <StrokeIcon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </StrokeIcon>
);

// Icon tile tint. The foreground is one step darker than colors.accent so
// text set on accentSubtle (e.g. estimate-number chips) clears 4.5:1.
export const TOOL_TINT = {
  bg: colors.accentSubtle,
  fg: '#1d4ed8',
} as const;

// ── Job types ─────────────────────────────────────────────────────────────────

export type JobTypeKey = 'interior' | 'roofing' | 'moving';

export const JOB_TYPES: { key: JobTypeKey; label: string }[] = [
  { key: 'interior', label: 'Interior restoration' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'moving', label: 'Moving & storage' },
];

const ALL_JOB_TYPES: JobTypeKey[] = JOB_TYPES.map((j) => j.key);

// ── Tool metadata ─────────────────────────────────────────────────────────────

export interface ToolMeta {
  id: string;
  /** Short label for nav and tiles. */
  navLabel: string;
  /** Shortest label, for tight mobile rows ("Packing · 2 hours ago"). */
  shortLabel: string;
  Icon: React.FC<ToolIconProps>;
  /** Filter keys — a tool for every job type lists all of them. */
  jobTypes: JobTypeKey[];
  /** True when the tool isn't tied to a job type ("All job types"). */
  allJobs: boolean;
  /** Compact job label for dashboard tiles. */
  jobLabel: string;
  description: string;
  comingSoon?: string;
  /** Saves work as tool sessions (GET /tools/sessions?tool_id=…). */
  savesSessions: boolean;
  /** Deep link for a saved session, when the tool supports opening one by URL. */
  sessionPath?: (sessionId: string) => string;
}

// Pack-out (interior restoration / moving) and roofing are separate job
// types — no tool spans both except the job-agnostic ones.
export const TOOL_META: Record<string, ToolMeta> = {
  packing: {
    id: 'packing',
    navLabel: 'Packing & Moving',
    shortLabel: 'Packing',
    Icon: BoxIcon,
    jobTypes: ['interior', 'moving'],
    allJobs: false,
    jobLabel: 'Interior · Moving',
    description: 'Room photos or presets to a priced pack-out: labor, materials, moving and storage.',
    savesSessions: true,
    sessionPath: (sessionId) => `/app/tools/packing/${sessionId}`,
  },
  roof_analyzer: {
    id: 'roof_analyzer',
    navLabel: 'Roof Analyzer',
    shortLabel: 'Roof',
    Icon: HouseIcon,
    jobTypes: ['roofing'],
    allJobs: false,
    jobLabel: 'Roofing',
    description: 'Upload an EagleView report to see every face, slope and area.',
    comingSoon: 'Priced roof estimates from these numbers',
    savesSessions: true,
  },
  item_recommender: {
    id: 'item_recommender',
    navLabel: 'Item Recommender',
    shortLabel: 'Items',
    Icon: MagnifierIcon,
    jobTypes: ALL_JOB_TYPES,
    allJobs: true,
    jobLabel: 'All jobs',
    description: 'Search by work type and get line items grouped pre-work, main, materials, trim and post-work.',
    comingSoon: 'Add picked items straight to an estimate',
    savesSessions: false,
  },
  pdf_editor: {
    id: 'pdf_editor',
    navLabel: 'PDF & E-Sign',
    shortLabel: 'PDF',
    Icon: PenIcon,
    jobTypes: ALL_JOB_TYPES,
    allJobs: true,
    jobLabel: 'All jobs',
    description: 'Mark up and merge PDFs, auto-fill forms from your records, send for signature.',
    savesSessions: false,
  },
};

/** Display order everywhere tools are listed. */
export const TOOL_ORDER: string[] = ['packing', 'roof_analyzer', 'item_recommender', 'pdf_editor'];

export const ORDERED_TOOL_META: ToolMeta[] = TOOL_ORDER.map((id) => TOOL_META[id]);

export function getToolMeta(toolId: string): ToolMeta | undefined {
  return TOOL_META[toolId];
}

/** Job tags as shown on tool cards. */
export function getJobTagLabels(meta: ToolMeta): string[] {
  if (meta.allJobs) return ['All job types'];
  return meta.jobTypes.map((key) => JOB_TYPES.find((j) => j.key === key)?.label ?? key);
}

/** Sort comparator: known tools in TOOL_ORDER, unknown ones after. */
export function compareToolOrder(a: string, b: string): number {
  const ia = TOOL_ORDER.indexOf(a);
  const ib = TOOL_ORDER.indexOf(b);
  return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/** "Just now", "12 min ago", "2 hours ago", "Yesterday", "Oct 9", "Oct 9, 2025". */
export function formatRelativeShort(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDiff === 0) {
    const hours = Math.floor(diffMin / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (dayDiff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  }).format(date);
}
