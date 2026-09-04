import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Modal,
  Button,
  InputNumber,
  Switch,
  Input,
  Collapse,
  Divider,
  Dropdown,
  Space,
  Row,
  Col,
  Typography,
  message,
  Tag,
  Table,
  Card,
  Tooltip,
  Checkbox,
  Alert,
} from 'antd';
import {
  CloseOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  ExportOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  UserOutlined,
  BankOutlined,
  DownOutlined,
  RightOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { toolService } from '@/services/toolService';
import type { ToolSession } from '@/types/tools';
import ReportExportModal from './ReportExportModal';
import type { ColumnsType } from 'antd/es/table';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { packingApi } from './packingApi';
import { getGrandTotal } from './sessionStatus';
import CustomerSelector from '@/components/features/CustomerSelector';
import type { CustomerData } from '@/components/features/CustomerSelector';
import type {
  EstimateResponse,
  SectionDetailLine,
  ClientInfo,
  CompanyInfoOverride,
} from './types';

const { Title, Text } = Typography;
const { Panel } = Collapse;

// ── Mobile detection ──────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SECTION_ORDER = [
  'Pack-Out Labor',
  'Pack-Back Labor',
  'Transport Out',
  'Transport Back',
  'Materials',
  'Special Items',
  'Storage',
];

function sortSections(sections: Record<string, number>): [string, number][] {
  const entries = Object.entries(sections);
  return entries.sort(([a], [b]) => {
    const ai = SECTION_ORDER.indexOf(a);
    const bi = SECTION_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function isTransportSection(name: string): boolean {
  return /transport/i.test(name);
}

/** Sum elapsed hours across every crew-tagged HR line (qty on a crew-labor
 * line is already elapsed hours). Sums across all matching lines in a
 * section since Content mode splits Pack-Out/Pack-Back into several
 * category lines rather than one "Crew Labor" line. */
function sumCrewElapsedHours(lines: SectionDetailLine[]): number {
  return lines
    .filter((l) => l.unit === 'HR' && /crew/i.test(l.detail || ''))
    .reduce((s, l) => s + l.qty, 0);
}

/** Check if material_details are individual items (not already category-grouped). */
function isMaterialDetailsLegacy(details: { unit?: string; quantity?: number }[]): boolean {
  return details.length > 3 || details.some((m) => m.unit !== 'LS' || (m.quantity ?? 1) !== 1);
}

const _SUPPLY_CODES = new Set([
  '3026', '3025', '3027', '3028', '3024', '3030', '3032', '3089', '3088',
]);
const _SPECIALTY_CODES = new Set([
  '3033', '3029', '3031', '3036', '3037', '3035', '3034',
]);

/** Group legacy individual material items into 3 categories. */
function groupMaterialDetails(
  details: { name: string; code?: string; quantity: number; unit: string; unit_price: number; total: number; detail?: string }[],
): { name: string; detail: string; qty: number; unit: string; rate: number; amount: number }[] {
  let supply = 0, protective = 0, specialty = 0;
  const supplyNames: string[] = [], protectiveNames: string[] = [], specialtyNames: string[] = [];
  for (const m of details) {
    const code = m.code ?? '';
    if (_SUPPLY_CODES.has(code)) {
      supply += m.total;
      supplyNames.push(m.name);
    } else if (_SPECIALTY_CODES.has(code)) {
      specialty += m.total;
      specialtyNames.push(m.name);
    } else {
      protective += m.total;
      protectiveNames.push(m.name);
    }
  }
  const lines: { name: string; detail: string; qty: number; unit: string; rate: number; amount: number }[] = [];
  if (supply > 0) lines.push({ name: 'Packing Supplies', detail: supplyNames.join(', '), qty: 1, unit: 'LS', rate: Math.round(supply * 100) / 100, amount: Math.round(supply * 100) / 100 });
  if (protective > 0) lines.push({ name: 'Protective Wrapping', detail: protectiveNames.join(', '), qty: 1, unit: 'LS', rate: Math.round(protective * 100) / 100, amount: Math.round(protective * 100) / 100 });
  if (specialty > 0) lines.push({ name: 'Specialty Packaging', detail: specialtyNames.join(', '), qty: 1, unit: 'LS', rate: Math.round(specialty * 100) / 100, amount: Math.round(specialty * 100) / 100 });
  return lines;
}

/** Regenerate scheduling notes from current section_details + crew size. */
function generateSchedulingNotes(
  sectionDetails: Record<string, { lines: SectionDetailLine[] }> | undefined,
  crewSize: number,
): string[] {
  const notes: string[] = [];
  const crewN = Math.max(1, crewSize);
  const packOutLines = sectionDetails?.['Pack-Out Labor']?.lines ?? [];
  const packBackLines = sectionDetails?.['Pack-Back Labor']?.lines ?? [];
  const poElapsed = Math.round(sumCrewElapsedHours(packOutLines) * 10) / 10;
  const pbElapsed = Math.round(sumCrewElapsedHours(packBackLines) * 10) / 10;
  const totalElapsed = Math.round((poElapsed + pbElapsed) * 10) / 10;

  if (totalElapsed <= 0) return notes;

  const parts: string[] = [];
  if (poElapsed > 0) parts.push(`pack-out ${poElapsed} hrs`);
  if (pbElapsed > 0) parts.push(`pack-back ${pbElapsed} hrs`);
  const totalManHrs = Math.round(totalElapsed * crewN * 10) / 10;
  notes.push(
    `Scheduling: ${parts.join(' + ')} = ${totalElapsed} elapsed hrs` +
      ` · crew of ${crewN} · ${totalManHrs} man-hrs total`,
  );

  // A multi-day job is already priced for that schedule (labor hours are the
  // job's real total and the van is billed per day), so state the resulting
  // schedule as a fact rather than warning about an overrun and recommending
  // a fix that has already been applied. Mirrors the backend's schedule_note().
  if (totalElapsed > 8) {
    const workDays = Math.ceil(totalElapsed / 8);
    const perDay = Math.round((totalElapsed / workDays) * 10) / 10;
    // toFixed(1) so the text is byte-identical to the backend's, which
    // formats with Python's round(x, 1) — otherwise regenerating the note on
    // an edit would visibly reformat "13.0 hrs" to "13 hrs".
    notes.push(
      `Scheduled over ${workDays} days — estimated on-site time is ` +
        `${totalElapsed.toFixed(1)} hrs (${crewN}-person crew), which exceeds a ` +
        `standard 8-hr workday. Approx. ${perDay.toFixed(1)} hrs/day; pricing ` +
        `reflects the ${workDays}-day schedule.`,
    );
  }

  return notes;
}

/** Recompute section/subtotal/O&P/grand-total from edited section_details.
 * Every mutation path funnels through this so the derived money never drifts
 * from the lines actually displayed. */
function recalcFromDetails(
  prev: EstimateResponse,
  details: Record<string, { lines: SectionDetailLine[] }>,
): EstimateResponse {
  const sections = { ...prev.sections };
  for (const [name, sd] of Object.entries(details)) {
    if (name in sections) {
      sections[name] = Math.round(sd.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    }
  }
  const subtotal = Object.values(sections).reduce((s, v) => s + v, 0);
  const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
  const contingencyAmount = prev.include_contingency ? subtotal * (prev.contingency_rate / 100) : 0;
  return {
    ...prev,
    sections,
    section_details: details,
    subtotal,
    op_amount: opAmount,
    contingency_amount: contingencyAmount,
    grand_total: subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
    notes: generateSchedulingNotes(details, prev.crew_size),
  };
}

/** True for a crew-priced labor line: qty is elapsed hours and rate is
 * per-person-rate × crew. Mirrors the backend's _crew_detail() marker. */
function isCrewLaborLine(line: SectionDetailLine): boolean {
  return line.unit === 'HR' && /crew/i.test(line.detail || '');
}

/** Rebuild a crew-labor line's detail text so every number in it matches the
 * line's own qty/rate/amount. Mirrors the backend's _crew_detail():
 *   "{crew}-person crew ({desc}) · {hrs} hr × {crew} crew × ${rate}/hr = ${amt}"
 * Patching the string piecemeal leaves the trailing per-person rate and total
 * stale, so the printed breakdown contradicts the line it describes. Falls
 * back to the original text if the shape isn't recognised. */
function rebuildCrewDetail(
  detail: string,
  hrs: number,
  crew: number,
  crewRate: number,
  amount: number,
): string {
  // Pull the parenthesised task description out of the canonical prefix.
  const desc = detail.match(/^\s*\d+-person crew \(([^)]*)\)/)?.[1];
  if (desc == null) return detail;
  const perPerson = crew > 0 ? crewRate / crew : crewRate;
  return (
    `${crew}-person crew (${desc}) · ${hrs} hr × ${crew} crew × ` +
    `${fmtMoney(Math.round(perPerson * 100) / 100)}/hr = ${fmtMoney(amount)}`
  );
}

/** True for the moving-van line, whose qty is billed in DY (van-days). */
function isTruckLine(line: SectionDetailLine): boolean {
  return /moving van/i.test(line.name) && (line.unit || '').toUpperCase() === 'DY';
}

/** Rewrite every moving-van line to a new van-day quantity.
 * Rate is held; amount follows qty, matching how the backend builds the line.
 * `detail` describes why the quantity is what it is: pass a baseline to restore
 * the calculated wording, otherwise the line is labelled as van-days. */
function applyTruckQty(
  prev: EstimateResponse,
  trips: number,
  restore?: TruckBaseline,
): EstimateResponse {
  const qty = Math.max(0, Math.round(restore ? restore.qty : trips));
  const details = { ...(prev.section_details ?? {}) };
  let touched = false;
  for (const [name, sd] of Object.entries(details)) {
    if (!sd.lines.some(isTruckLine)) continue;
    details[name] = {
      lines: sd.lines.map((l) =>
        isTruckLine(l)
          ? {
              ...l,
              qty,
              amount: Math.round(l.rate * qty * 100) / 100,
              detail: restore
                ? restore.detail
                : `${qty} van-day${qty === 1 ? '' : 's'} × ${fmtMoney(l.rate)}/day`,
            }
          : l,
      ),
    };
    touched = true;
  }
  if (!touched) return { ...prev, truck_trips: qty };
  return { ...recalcFromDetails(prev, details), truck_trips: qty };
}

/** The van line's qty and detail as the calculation produced them. */
interface TruckBaseline {
  qty: number;
  detail: string;
}

/** Rebuild the van line exactly as the calculation produced it, from the
 * untouched capacity figure the backend reports. Derived rather than stashed
 * in React state: a cached baseline is invisible to undo/redo (which restore
 * `result` alone), so it goes stale and a later switch-off silently no-ops,
 * losing the original wording for good. Mirrors the backend's
 * truck_qty_note(). */
function calculatedTruckLine(result: EstimateResponse): TruckBaseline | null {
  const qty = result.truck_capacity_trips ?? 0;
  if (qty <= 0) return null;
  return {
    qty,
    detail: `${qty} trip${qty === 1 ? '' : 's'} (~500 SF capacity per trip)`,
  };
}

/** Scale every crew-labor HR line so total elapsed hours hit `targetHours`.
 * Rate per line is unchanged — only qty (elapsed hours) and amount move, so
 * the mix between pack-out categories is preserved. */
function applyTotalHours(
  prev: EstimateResponse,
  targetHours: number,
): EstimateResponse {
  const details = { ...(prev.section_details ?? {}) };
  const laborSections = ['Pack-Out Labor', 'Pack-Back Labor'];
  const current =
    Math.round(
      laborSections.reduce((s, n) => s + sumCrewElapsedHours(details[n]?.lines ?? []), 0) * 10,
    ) / 10;
  if (current <= 0 || targetHours <= 0) return prev;
  const factor = targetHours / current;

  for (const name of laborSections) {
    const sd = details[name];
    if (!sd) continue;
    details[name] = {
      lines: sd.lines.map((l) => {
        if (!isCrewLaborLine(l)) return l;
        // Keep hours on the half-hour grid the backend's rh() enforces.
        const qty = Math.max(0.5, Math.round(l.qty * factor * 2) / 2);
        const amount = Math.round(l.rate * qty * 100) / 100;
        const detail = rebuildCrewDetail(l.detail || '', qty, prev.crew_size, l.rate, amount);
        return { ...l, qty, amount, detail };
      }),
    };
  }

  const next = recalcFromDetails(prev, details);
  const newTotal =
    Math.round(
      laborSections.reduce(
        (s, n) => s + sumCrewElapsedHours(next.section_details?.[n]?.lines ?? []),
        0,
      ) * 10,
    ) / 10;
  return { ...next, total_hours: newTotal };
}

/** Re-price crew-labor lines for a new crew size.
 * A crew line's rate is per-person-rate × crew, so changing crew size changes
 * the rate. Elapsed hours are held — the user adjusts those separately. */
function applyCrewSize(prev: EstimateResponse, crewSize: number): EstimateResponse {
  const oldCrew = Math.max(1, prev.crew_size);
  const newCrew = Math.max(1, Math.round(crewSize));
  if (newCrew === oldCrew) return prev;
  const ratio = newCrew / oldCrew;
  const details = { ...(prev.section_details ?? {}) };

  for (const [name, sd] of Object.entries(details)) {
    details[name] = {
      lines: sd.lines.map((l) => {
        if (!isCrewLaborLine(l)) return l;
        const rate = Math.round(l.rate * ratio * 100) / 100;
        const amount = Math.round(rate * l.qty * 100) / 100;
        const detail = rebuildCrewDetail(l.detail || '', l.qty, newCrew, rate, amount);
        return { ...l, rate, amount, detail };
      }),
    };
  }

  const next = recalcFromDetails({ ...prev, crew_size: newCrew }, details);
  return { ...next, notes: generateSchedulingNotes(next.section_details, newCrew) };
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface EstimateEditorModalProps {
  /** True while this panel is the visible one. The parent's breadcrumb owns navigation — this only drives clearing in-progress edit drafts when the user steps away. */
  active: boolean;
  result: EstimateResponse | null;
  setResult: React.Dispatch<React.SetStateAction<EstimateResponse | null>>;
  mode: 'quick' | 'content' | 'packout';
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  activeSessionId?: string;
  onCreateEstimate?: () => void;
  creatingEstimate?: boolean;
  /** Called after a real Invoice is created from this session (marks the session as actually converted). */
  onInvoiceCreated?: (invoiceId: string, invoiceNumber: string) => void;
  onSaveSession?: () => Promise<void>;
  onCalculate?: () => Promise<EstimateResponse | undefined>;
  photoRooms?: import('./types').PhotoRoom[];
  rooms?: import('./types').PackingRoom[];
  /** Called whenever manual edits are made/cleared, so a parent-level "regenerate" can warn before overwriting them. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface EditingState {
  sectionName: string;
  lineIndex: number;
  name: string;
  detail: string;
  qty: number;
  unit: string;
  rate: number;
}

interface NewLineState {
  sectionName: string;
  name: string;
  detail: string;
  qty: number;
  unit: string;
  rate: number;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

interface SectionLineTableProps {
  sectionName: string;
  lines: SectionDetailLine[];
  editing: EditingState | null;
  onStartEdit: (sectionName: string, lineIndex: number, line: SectionDetailLine) => void;
  onEditField: (field: keyof EditingState, value: string | number) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDeleteLine: (sectionName: string, lineIndex: number) => void;
  /** Crew size (global for the estimate) — crew-labor lines already store qty as elapsed
   * hours; crewSize is only used here to render the informational "×N" crew badge. */
  crewSize: number;
}

const SectionLineTable: React.FC<SectionLineTableProps> = ({
  sectionName,
  lines,
  editing,
  onStartEdit,
  onEditField,
  onSaveEdit,
  onCancelEdit,
  onDeleteLine,
  crewSize,
}) => {
  const isMobile = useIsMobile();
  const isRowEditing = (record: { _index: number }) =>
    editing?.sectionName === sectionName && editing?.lineIndex === record._index;

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
        {lines.map((line, i) => {
          const record = { ...line, _index: i };
          const ed = isRowEditing(record);
          const isCrew = /crew/i.test(line.detail || '');
          const amount = ed ? editing!.qty * editing!.rate : line.amount;

          if (ed) {
            return (
              <div
                key={i}
                style={{
                  border: `1.5px solid ${colors.primary}`,
                  borderRadius: borderRadius.md,
                  padding: 12,
                  background: '#eff6ff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <Input
                  size="middle"
                  placeholder="Name"
                  value={editing!.name}
                  onChange={(e) => onEditField('name', e.target.value)}
                  style={{ fontFamily: fonts.body, fontSize: 14 }}
                />
                <Input
                  size="middle"
                  placeholder="Detail"
                  value={editing!.detail}
                  onChange={(e) => onEditField('detail', e.target.value)}
                  style={{ fontFamily: fonts.body, fontSize: 14 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: '1 1 0' }}>
                    <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 2 }}>Qty</label>
                    <InputNumber
                      size="middle"
                      min={0}
                      step={0.5}
                      value={editing!.qty}
                      onChange={(v) => onEditField('qty', v ?? 0)}
                      style={{ width: '100%' }}
                      suffix={isCrew ? <Text style={{ fontSize: 11, color: colors.textMuted }}>hr</Text> : undefined}
                    />
                  </div>
                  <div style={{ width: 72 }}>
                    <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 2 }}>Unit</label>
                    <Input
                      size="middle"
                      value={editing!.unit}
                      onChange={(e) => onEditField('unit', e.target.value)}
                    />
                  </div>
                  <div style={{ flex: '1 1 0' }}>
                    <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 2 }}>Rate</label>
                    <InputNumber
                      size="middle"
                      min={0}
                      step={1}
                      value={editing!.rate}
                      onChange={(v) => onEditField('rate', v ?? 0)}
                      prefix="$"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: colors.info,
                      background: colors.infoBg,
                      borderRadius: borderRadius.sm,
                      padding: '4px 10px',
                    }}
                  >
                    {fmt(amount)}
                  </span>
                  <Space size={4}>
                    <Button
                      type="primary"
                      size="middle"
                      icon={<CheckOutlined />}
                      onClick={onSaveEdit}
                    >
                      Save
                    </Button>
                    <Button
                      size="middle"
                      icon={<CloseCircleOutlined />}
                      onClick={onCancelEdit}
                    />
                  </Space>
                </div>
              </div>
            );
          }

          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => onStartEdit(sectionName, i, line)}
              onKeyDown={(e) => e.key === 'Enter' && onStartEdit(sectionName, i, line)}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: '10px 12px',
                background: colors.bgWhite,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: fonts.body, fontWeight: 600, color: colors.textPrimary, display: 'block' }}>
                  {line.name}
                </Text>
                {line.detail && (
                  <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.body, display: 'block', marginTop: 2 }}>
                    {line.detail}
                  </Text>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    {isCrew ? `${line.qty} hr` : `${line.qty} ${line.unit}`}
                    {isCrew && (
                      <span style={{
                        marginLeft: 4, fontSize: 10, fontWeight: 600, color: colors.textMuted,
                        background: colors.bgLight, border: `1px solid ${colors.border}`,
                        borderRadius: 4, padding: '0 5px', lineHeight: '16px',
                      }}>
                        ×{crewSize}
                      </span>
                    )}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>· {fmt(line.rate)}/{line.unit}</Text>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <Text strong style={{ fontSize: 14, color: colors.textPrimary }}>
                  {fmt(amount)}
                </Text>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined style={{ color: colors.textMuted, fontSize: 12 }} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteLine(sectionName, i);
                  }}
                  aria-label={`Remove ${line.name}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const columns: ColumnsType<SectionDetailLine & { _index: number }> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      ellipsis: true,
      render: (val, record) => {
        if (isRowEditing(record)) {
          return (
            <Input
              size="small"
              variant="filled"
              value={editing!.name}
              onChange={(e) => onEditField('name', e.target.value)}
              onPressEnter={onSaveEdit}
              autoFocus
              style={{ fontFamily: fonts.body, fontSize: 14 }}
            />
          );
        }
        return (
          <Text style={{ fontSize: 14, fontFamily: fonts.body }} ellipsis={{ tooltip: val }}>
            {val}
          </Text>
        );
      },
    },
    {
      title: 'Detail',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (val, record) => {
        if (isRowEditing(record)) {
          return (
            <Input
              size="small"
              variant="filled"
              value={editing!.detail}
              onChange={(e) => onEditField('detail', e.target.value)}
              onPressEnter={onSaveEdit}
              style={{ fontFamily: fonts.body, fontSize: 14 }}
            />
          );
        }
        return (
          <Text
            style={{ fontSize: 14, color: colors.textSecondary, fontFamily: fonts.body }}
            ellipsis={{ tooltip: val }}
          >
            {val}
          </Text>
        );
      },
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      key: 'qty',
      width: 100,
      align: 'right' as const,
      render: (val, record) => {
        const isCrew = /crew/i.test(record.detail || '');
        if (isRowEditing(record)) {
          return (
            <InputNumber
              size="small"
              variant="filled"
              min={0}
              step={0.5}
              value={editing!.qty}
              onChange={(v) => onEditField('qty', v ?? 0)}
              style={{ width: isCrew ? 78 : 70, fontSize: 14 }}
              suffix={isCrew ? <Text style={{ fontSize: 11, color: colors.textMuted }}>hr</Text> : undefined}
              onPressEnter={onSaveEdit}
            />
          );
        }
        if (isCrew) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              <Text style={{ fontSize: 14 }}>{val} hr</Text>
              <span style={{
                fontSize: 10, fontWeight: 600, color: colors.textMuted,
                background: colors.bgLight, border: `1px solid ${colors.border}`,
                borderRadius: 4, padding: '0 5px', lineHeight: '16px', whiteSpace: 'nowrap',
              }}>
                ×{crewSize}
              </span>
            </div>
          );
        }
        return <Text style={{ fontSize: 14 }}>{val}</Text>;
      },
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 70,
      render: (val, record) => {
        if (isRowEditing(record)) {
          return (
            <Input
              size="small"
              variant="filled"
              value={editing!.unit}
              onChange={(e) => onEditField('unit', e.target.value)}
              onPressEnter={onSaveEdit}
              style={{ width: 55, fontSize: 14 }}
            />
          );
        }
        return <Text style={{ fontSize: 14, color: colors.textSecondary }}>{val}</Text>;
      },
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      width: 100,
      align: 'right' as const,
      render: (val, record) => {
        if (isRowEditing(record)) {
          return (
            <InputNumber
              size="small"
              variant="filled"
              min={0}
              step={1}
              value={editing!.rate}
              onChange={(v) => onEditField('rate', v ?? 0)}
              style={{ width: 80, fontSize: 14 }}
              prefix="$"
              onPressEnter={onSaveEdit}
            />
          );
        }
        return <Text style={{ fontSize: 14 }}>{fmt(val)}</Text>;
      },
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 100,
      align: 'right' as const,
      render: (_, record) => {
        const ed = isRowEditing(record);
        const amount = ed ? editing!.qty * editing!.rate : record.amount;
        if (ed) {
          // Computed, not directly editable — echo the row's filled-field
          // language as a static chip so it doesn't read as a stray leftover
          // amid the now-boxed inputs.
          return (
            <span
              style={{
                display: 'inline-block',
                fontSize: 14,
                fontWeight: 600,
                color: colors.info,
                background: colors.infoBg,
                borderRadius: borderRadius.sm,
                padding: '3px 8px',
              }}
            >
              {fmt(amount)}
            </span>
          );
        }
        return (
          <Text strong style={{ fontSize: 14, color: colors.textPrimary }}>
            {fmt(amount)}
          </Text>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 84,
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_, record) => {
        if (isRowEditing(record)) {
          return (
            <Space size={4}>
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined style={{ color: colors.success }} />}
                onClick={onSaveEdit}
              />
              <Button
                type="text"
                size="small"
                icon={<CloseCircleOutlined style={{ color: colors.error }} />}
                onClick={onCancelEdit}
              />
            </Space>
          );
        }
        return (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined style={{ color: colors.textMuted, fontSize: 11 }} />}
            onClick={() => onDeleteLine(sectionName, record._index)}
          />
        );
      },
    },
  ];

  const data = lines.map((line, i) => ({ ...line, _index: i, key: i }));

  return (
    <Table
      className="estimate-compact-table"
      columns={columns}
      dataSource={data}
      size="small"
      pagination={false}
      scroll={{ x: 600 }}
      onRow={(record) => ({
        onDoubleClick: () => {
          if (!editing) {
            onStartEdit(sectionName, record._index, record);
          }
        },
        style: {
          cursor: 'pointer',
          background:
            editing?.sectionName === sectionName && editing?.lineIndex === record._index
              ? '#eff6ff'
              : undefined,
        },
      })}
      style={{ marginTop: 4 }}
    />
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const EstimateEditorModal: React.FC<EstimateEditorModalProps> = ({
  active,
  result,
  setResult,
  mode,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  activeSessionId,
  onCreateEstimate,
  creatingEstimate,
  onInvoiceCreated,
  onSaveSession,
  onCalculate,
  photoRooms,
  rooms,
  onDirtyChange,
}) => {
  // ── Responsive ─────────────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // ── Local state ────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // ── Manual-edit tracking ──────────────────────────────────────────────────
  // Tracks whether the user has hand-edited the current result (line edits,
  // deletes, added lines/sections, labor hours, O&P, supplements) since the
  // last fresh calculate. Only THEN is a "you'll lose your edits" confirm
  // needed — a plain re-run (e.g. after re-analyzing one room's photos) should
  // proceed without interrupting the user.
  const [hasEdits, setHasEdits] = useState(false);
  const markDirty = useCallback(() => {
    setHasEdits(true);
    onDirtyChange?.(true);
  }, [onDirtyChange]);
  const clearDirty = useCallback(() => {
    setHasEdits(false);
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  // ── Undo / redo ────────────────────────────────────────────────────────────
  // Snapshots of the whole EstimateResponse. Every mutating handler calls
  // pushHistory() with the pre-edit result BEFORE applying its change, so undo
  // restores exactly what was on screen a moment earlier. A fresh calculate or
  // a loaded session resets the stacks — there is nothing meaningful to undo
  // back past a full recalculation.
  const [undoStack, setUndoStack] = useState<EstimateResponse[]>([]);
  const [redoStack, setRedoStack] = useState<EstimateResponse[]>([]);
  const HISTORY_LIMIT = 50;

  const pushHistory = useCallback(() => {
    setResult((prev) => {
      if (prev) {
        setUndoStack((st) => [...st, prev].slice(-HISTORY_LIMIT));
        setRedoStack([]);
      }
      return prev;
    });
  }, [setResult]);

  const resetHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const restored = stack[stack.length - 1];
      setResult((prev) => {
        if (prev) setRedoStack((r) => [...r, prev].slice(-HISTORY_LIMIT));
        return restored;
      });
      setEditing(null);
      return stack.slice(0, -1);
    });
  }, [setResult]);

  const handleRedo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const restored = stack[stack.length - 1];
      setResult((prev) => {
        if (prev) setUndoStack((u) => [...u, prev].slice(-HISTORY_LIMIT));
        return restored;
      });
      setEditing(null);
      return stack.slice(0, -1);
    });
  }, [setResult]);

  // ── Customer link ──────────────────────────────────────────────────────────
  // Mirrors SharedDetailsStep's ClientInfo <-> CustomerData mapping so this
  // panel searches/updates the same linked Customer record instead of drifting.
  const customerData: CustomerData = {
    customerId: clientInfo.customer_id,
    name: clientInfo.name,
    email: clientInfo.email || undefined,
    phone: clientInfo.phone || undefined,
    addressLine1: clientInfo.property_address_line1 || undefined,
    addressLine2: clientInfo.property_address_line2 || undefined,
    city: clientInfo.property_city || undefined,
    state: clientInfo.property_state || undefined,
    zipcode: clientInfo.property_zipcode || undefined,
  };
  const handleCustomerChange = useCallback(
    (data: CustomerData) => {
      setClientInfo((ci) => ({
        ...ci,
        customer_id: data.customerId,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        property_address_line1: data.addressLine1 || '',
        property_address_line2: data.addressLine2 || '',
        property_city: data.city || '',
        property_state: data.state || '',
        property_zipcode: data.zipcode || '',
      }));
    },
    [setClientInfo],
  );

  // ── Calculate handler ────────────────────────────────────────────────────
  const runCalculate = useCallback(async () => {
    if (!onCalculate) return;
    setCalculating(true);
    try {
      const res = await onCalculate();
      if (res) {
        setResult(res);
        clearDirty();
        resetHistory();
        message.success('Estimate calculated');
      }
    } catch {
      message.error('Calculation failed. Please try again.');
    } finally {
      setCalculating(false);
    }
  }, [onCalculate, setResult, clearDirty, resetHistory]);

  const handleCalculate = useCallback(() => {
    // Recalculating rebuilds every line from the current room/settings data —
    // only confirm if there are manual edits it would actually discard.
    if (hasEdits) {
      Modal.confirm({
        title: 'Replace Current Estimate?',
        content: 'Recalculating will replace all manual edits you made in the Estimate Editor. Continue?',
        okText: 'Replace',
        cancelText: 'Cancel',
        onOk: runCalculate,
      });
    } else {
      runCalculate();
    }
  }, [hasEdits, runCalculate]);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo — but not while
  // the user is typing in an input, where the browser's own text undo is what
  // they mean.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, handleUndo, handleRedo]);

  // ── Leaving cleanup ────────────────────────────────────────────────────────
  // Navigation itself is owned by the parent's breadcrumb — this panel stays
  // permanently mounted so persisted settings like taxRate/showBreakdown
  // survive a trip back to Rooms. Only in-progress (uncommitted) edit drafts
  // get cleared when the user steps away, so coming back starts clean.
  useEffect(() => {
    if (active) return;
    setEditing(null);
    setNewLine(null);
    setShowAddSection(false);
    setNewSectionName('');
  }, [active]);

  // Seed scheduling notes on first open if backend returned none
  useEffect(() => {
    if (!result) return;
    if (!result.notes || result.notes.length === 0) {
      const seeded = generateSchedulingNotes(result.section_details, result.crew_size);
      if (seeded.length > 0) {
        setResult((prev) => prev ? { ...prev, notes: seeded } : prev);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id, result?.created_at]); // safe: result null-checked at start of effect
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [exportOptionsFormat, setExportOptionsFormat] = useState<'pdf' | 'excel' | null>(null);
  const [showCompanyOverride, setShowCompanyOverride] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [preparingReport, setPreparingReport] = useState(false);

  // New line draft state
  const [newLine, setNewLine] = useState<NewLineState | null>(null);

  // Add section state
  const [newSectionName, setNewSectionName] = useState('');
  const [showAddSection, setShowAddSection] = useState(false);

  // Load saved estimate state
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSessions, setSavedSessions] = useState<ToolSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Derived totals ─────────────────────────────────────────────────────────
  // Recomputed straight from section_details/crew_size on every render (not
  // read off result.notes) so it can't drift out of sync with an edit path
  // that forgets to call generateSchedulingNotes.
  const schedulingSummary = useMemo(() => {
    if (!result) return null;
    const note = generateSchedulingNotes(result.section_details, result.crew_size)
      .find((n) => n.startsWith('Scheduling:'));
    return note ? note.replace(/^Scheduling:\s*/, '') : null;
  }, [result?.section_details, result?.crew_size]);

  // ── Schedule & logistics (editable) ───────────────────────────────────────
  // Read straight off the current lines so hand-edits to a labor or van line
  // are reflected in these controls, not just the other way round.
  const currentTruckQty = useMemo(() => {
    const details = result?.section_details ?? {};
    for (const sd of Object.values(details)) {
      const truck = sd.lines.find(isTruckLine);
      if (truck) return truck.qty;
    }
    return result?.truck_trips ?? 0;
  }, [result?.section_details, result?.truck_trips]);

  const currentLaborHours = useMemo(() => {
    const details = result?.section_details ?? {};
    return (
      Math.round(
        (sumCrewElapsedHours(details['Pack-Out Labor']?.lines ?? []) +
          sumCrewElapsedHours(details['Pack-Back Labor']?.lines ?? [])) * 10,
      ) / 10
    );
  }, [result?.section_details]);

  const currentWorkDays = Math.max(1, Math.ceil(currentLaborHours / 8));

  // Derived, not stored: the van is being billed per work day exactly when its
  // quantity equals the work-day count and that count is more than the load
  // needs. Deriving it means undo/redo — which restore `result` and nothing
  // else — can never show a switch that contradicts the estimate.
  const vanPerWorkDay =
    currentWorkDays > 1 && currentTruckQty === currentWorkDays;

  const handleTruckQtyChange = useCallback((val: number | null) => {
    if (val == null || val < 0) return;
    pushHistory();
    markDirty();
    setResult((prev) => (prev ? applyTruckQty(prev, val) : prev));
  }, [pushHistory, markDirty, setResult]);

  // Per-work-day van billing is OFF by default — the calculated estimate bills
  // the van by load capacity, and charging it for every day of a multi-day job
  // is the estimator's call. Toggling on stashes the calculated qty/detail so
  // toggling back off restores them exactly rather than guessing at 1.
  const handleVanPerWorkDayToggle = useCallback((checked: boolean) => {
    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      if (checked) return applyTruckQty(prev, currentWorkDays);
      // Switching off rebuilds the calculated line from the capacity figure the
      // backend reported, so it restores correctly no matter what happened in
      // between (undo, redo, a session reload).
      const original = calculatedTruckLine(prev);
      return original
        ? applyTruckQty(prev, original.qty, original)
        : applyTruckQty(prev, 1);
    });
  }, [pushHistory, markDirty, setResult, currentWorkDays]);

  const handleLaborHoursChange = useCallback((val: number | null) => {
    if (val == null || val <= 0) return;
    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      const wasPerWorkDay = vanPerWorkDay;
      const next = applyTotalHours(prev, val);
      if (!wasPerWorkDay) return next;
      // Per-work-day billing was on, and the day count just moved — keep the
      // van in step with it. Without this a drop below 8 hrs hides the switch
      // (it only shows for multi-day jobs) while leaving the inflated quantity
      // stranded on the estimate with no visible control to undo it.
      const days = Math.max(1, Math.ceil(val / 8));
      if (days > 1) return applyTruckQty(next, days);
      const original = calculatedTruckLine(next);
      return original ? applyTruckQty(next, original.qty, original) : next;
    });
  }, [pushHistory, markDirty, setResult, vanPerWorkDay]);

  const handleCrewSizeChange = useCallback((val: number | null) => {
    if (val == null || val < 1) return;
    pushHistory();
    markDirty();
    setResult((prev) => (prev ? applyCrewSize(prev, val) : prev));
  }, [pushHistory, markDirty, setResult]);

  // Everything except the "Scheduling:" summary, which now lives in the
  // Hours stat's tooltip instead of a standalone alert.
  const visibleNotes = (result?.notes ?? []).filter((n) => !n.startsWith('Scheduling:'));

  const taxableBase = result ? result.subtotal + result.op_amount + result.contingency_amount + (result.supplements_total || 0) : 0;
  const taxAmount = taxRate > 0 ? taxableBase * (taxRate / 100) : 0;
  const computedGrandTotal = useMemo(() => {
    if (!result) return 0;
    const base = result.subtotal + result.op_amount + result.contingency_amount + (result.supplements_total || 0);
    const tax = taxRate > 0 ? base * (taxRate / 100) : 0;
    return base + tax;
  }, [result?.subtotal, result?.op_amount, result?.supplements_total, result?.contingency_amount, taxRate]);

  // Sync grand_total back into result whenever computedGrandTotal changes
  // so exports/reports use the same value the editor displays
  useEffect(() => {
    if (!result) return;
    const rounded = Math.round(computedGrandTotal * 100) / 100;
    if (Math.abs((result.grand_total || 0) - rounded) > 0.01) {
      setResult((prev) => prev ? { ...prev, grand_total: rounded } : prev);
    }
  }, [computedGrandTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inline edit handlers ──────────────────────────────────────────────────

  const handleStartEdit = useCallback(
    (sectionName: string, lineIndex: number, line: SectionDetailLine) => {
      setEditing({
        sectionName,
        lineIndex,
        name: line.name,
        detail: line.detail || '',
        qty: line.qty,
        unit: line.unit || 'EA',
        rate: line.rate,
      });
    },
    [],
  );

  const handleEditField = useCallback(
    (field: keyof EditingState, value: string | number) => {
      setEditing((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [],
  );

  const handleSaveEdit = useCallback(() => {
    if (!editing) return;
    pushHistory();
    markDirty();
    const { sectionName, lineIndex, name, detail, qty, unit, rate } = editing;
    const newAmount = Math.round(qty * rate * 100) / 100;

    setResult((prev) => {
      if (!prev) return prev;

      const isMat = sectionName === 'Materials';
      const hasMaterialDetails = isMat && prev.material_details && prev.material_details.length > 0;

      let newMaterialDetails = prev.material_details;
      const details = prev.section_details ? { ...prev.section_details } : {};

      if (hasMaterialDetails) {
        // Update material_details
        const md = [...prev.material_details!];
        if (lineIndex < md.length) {
          md[lineIndex] = {
            ...md[lineIndex],
            name,
            code: detail,
            quantity: qty,
            unit,
            unit_price: rate,
            total: newAmount,
          };
        }
        newMaterialDetails = md;

        // Also sync section_details.Materials.lines if it exists
        if (details[sectionName]) {
          const sdLines = [...details[sectionName].lines];
          if (lineIndex < sdLines.length) {
            sdLines[lineIndex] = { ...sdLines[lineIndex], name, detail, qty, unit, rate, amount: newAmount };
          }
          details[sectionName] = { lines: sdLines };
        }
      } else {
        if (!details[sectionName]) return prev;
        const lines = [...details[sectionName].lines];
        const prevLine = lines[lineIndex];
        // Crew-labor lines store qty as ELAPSED hours directly — keep the note
        // text's embedded "X hr × N crew" number in sync with the new qty.
        const isCrewLine = /crew/i.test(prevLine?.detail || '');
        const finalDetail = isCrewLine && detail
          ? rebuildCrewDetail(detail, qty, prev.crew_size, rate, newAmount)
          : detail;
        lines[lineIndex] = { ...prevLine, name, detail: finalDetail, qty, unit, rate, amount: newAmount };
        details[sectionName] = { lines };
      }

      // Recalculate section total
      const sectionTotal = hasMaterialDetails
        ? newMaterialDetails!.reduce((sum, m) => sum + m.total, 0)
        : details[sectionName]?.lines.reduce((sum: number, l: any) => sum + l.amount, 0) ?? 0;
      const newSections = { ...prev.sections, [sectionName]: sectionTotal };
      const subtotal = Object.values(newSections).reduce((s, v) => s + v, 0);
      const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
      const contingencyAmount = prev.include_contingency
        ? subtotal * (prev.contingency_rate / 100)
        : 0;

      // Recompute total elapsed hours (Rooms/Hours/Crew stat) from the crew lines —
      // qty on a crew-labor HR line is already elapsed hours, summed across every
      // crew-tagged line in the section (Content mode splits Pack-Out/Pack-Back
      // into several category lines, not one "Crew Labor" line).
      const newTotalHours = Math.round(
        (sumCrewElapsedHours(details['Pack-Out Labor']?.lines ?? []) +
          sumCrewElapsedHours(details['Pack-Back Labor']?.lines ?? [])) *
          10,
      ) / 10;

      return {
        ...prev,
        sections: newSections,
        section_details: details,
        material_details: newMaterialDetails,
        subtotal,
        op_amount: opAmount,
        contingency_amount: contingencyAmount,
        grand_total: subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
        total_hours: newTotalHours,
        notes: generateSchedulingNotes(details, prev.crew_size),
      };
    });

    setEditing(null);
  }, [editing, setResult, markDirty, pushHistory]);

  const handleCancelEdit = useCallback(() => setEditing(null), []);

  const handleDeleteLine = useCallback(
    (sectionName: string, lineIndex: number) => {
      pushHistory();
      markDirty();
      setResult((prev) => {
        if (!prev) return prev;

        // Materials section: may use material_details instead of section_details
        const isMat = sectionName === 'Materials';
        const hasMaterialDetails = isMat && prev.material_details && prev.material_details.length > 0;

        let newMaterialDetails = prev.material_details;
        let sectionTotal: number;

        if (hasMaterialDetails) {
          // Delete from material_details
          const md = [...prev.material_details!];
          md.splice(lineIndex, 1);
          newMaterialDetails = md;
          sectionTotal = md.reduce((sum, m) => sum + m.total, 0);
        } else {
          // Delete from section_details
          const details = prev.section_details ? { ...prev.section_details } : {};
          if (!details[sectionName]) return prev;
          const lines = [...details[sectionName].lines];
          lines.splice(lineIndex, 1);
          sectionTotal = lines.reduce((sum, l) => sum + l.amount, 0);

          const newSections = { ...prev.sections, [sectionName]: sectionTotal };
          const subtotal = Object.values(newSections).reduce((s, v) => s + v, 0);
          const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
          const contingencyAmount = prev.include_contingency
            ? subtotal * (prev.contingency_rate / 100)
            : 0;
          const updatedDetails = { ...details, [sectionName]: { lines } };
          return {
            ...prev,
            sections: newSections,
            section_details: updatedDetails,
            subtotal,
            op_amount: opAmount,
            contingency_amount: contingencyAmount,
            grand_total: subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
            notes: generateSchedulingNotes(updatedDetails, prev.crew_size),
          };
        }

        // Update section total and recalculate for material_details path
        const newSections = { ...prev.sections, [sectionName]: sectionTotal };
        // Also sync section_details.Materials.lines if it exists
        const details = prev.section_details ? { ...prev.section_details } : {};
        if (details[sectionName]) {
          const sdLines = [...details[sectionName].lines];
          if (lineIndex < sdLines.length) sdLines.splice(lineIndex, 1);
          details[sectionName] = { lines: sdLines };
        }
        const subtotal = Object.values(newSections).reduce((s, v) => s + v, 0);
        const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
        const contingencyAmount = prev.include_contingency
          ? subtotal * (prev.contingency_rate / 100)
          : 0;

        return {
          ...prev,
          sections: newSections,
          section_details: details,
          material_details: newMaterialDetails,
          subtotal,
          op_amount: opAmount,
          contingency_amount: contingencyAmount,
          grand_total: subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
          notes: generateSchedulingNotes(details, prev.crew_size),
        };
      });
    },
    [setResult, markDirty, pushHistory],
  );

  // ── Add line handlers ──────────────────────────────────────────────────────

  const handleStartNewLine = (sectionName: string) => {
    setNewLine({
      sectionName,
      name: '',
      detail: '',
      qty: 1,
      unit: 'EA',
      rate: 0,
    });
  };

  const handleCommitNewLine = () => {
    if (!newLine) return;
    if (!newLine.name.trim()) {
      message.warning('Line item name is required');
      return;
    }

    const amount = newLine.qty * newLine.rate;

    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      const details = prev.section_details ? { ...prev.section_details } : {};
      const existingLines = details[newLine.sectionName]?.lines ?? [];
      const lines = [
        ...existingLines,
        {
          name: newLine.name,
          detail: newLine.detail,
          qty: newLine.qty,
          unit: newLine.unit,
          rate: newLine.rate,
          amount,
        },
      ];
      const sectionTotal = lines.reduce((sum, l) => sum + l.amount, 0);
      const newSections = { ...prev.sections, [newLine.sectionName]: sectionTotal };
      const subtotal = Object.values(newSections).reduce((s, v) => s + v, 0);
      const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
      const contingencyAmount = prev.include_contingency
        ? subtotal * (prev.contingency_rate / 100)
        : 0;

      return {
        ...prev,
        sections: newSections,
        section_details: { ...details, [newLine.sectionName]: { lines } },
        subtotal,
        op_amount: opAmount,
        contingency_amount: contingencyAmount,
        grand_total: subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
      };
    });

    setNewLine(null);
  };

  // ── Add section handler ────────────────────────────────────────────────────

  const handleAddSection = () => {
    if (!newSectionName.trim()) {
      message.warning('Section name is required');
      return;
    }
    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      if (prev.sections[newSectionName]) {
        message.warning('Section already exists');
        return prev;
      }
      return {
        ...prev,
        sections: { ...prev.sections, [newSectionName]: 0 },
        section_details: {
          ...(prev.section_details ?? {}),
          [newSectionName]: { lines: [] },
        },
      };
    });
    setNewSectionName('');
    setShowAddSection(false);
  };

  // ── Load saved estimate handlers ───────────────────────────────────────────

  const handleOpenLoadModal = async () => {
    setShowLoadModal(true);
    setLoadingHistory(true);
    try {
      const sessions = await toolService.listSessions('packing');
      // List endpoint strips heavy data down to a grand_total stand-in — filter
      // by "has a calculated estimate" (not `status`, which now tracks whether
      // the session was actually converted/marked done, a stricter thing).
      const withResult = sessions.filter(
        (s) => getGrandTotal(s.data as any) !== undefined && s.id !== activeSessionId,
      );
      setSavedSessions(withResult);
    } catch {
      message.error('Failed to load saved estimates');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadSession = async (session: ToolSession) => {
    try {
      const full = await toolService.getSession(session.id);
      const d = full.data as any;
      if (d?.result) {
        setResult(d.result);
        clearDirty();
        resetHistory();
        if (d?.client_info) setClientInfo(d.client_info);
        message.success(`Loaded: ${session.name}`);
      }
      setShowLoadModal(false);
    } catch {
      message.error('Failed to load estimate');
    }
  };

  // ── O&P / Contingency handlers ─────────────────────────────────────────────

  const handleOpToggle = (checked: boolean) => {
    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      const opAmount = checked ? prev.subtotal * (prev.op_rate / 100) : 0;
      const contingencyAmount = prev.include_contingency
        ? prev.subtotal * (prev.contingency_rate / 100)
        : prev.contingency_amount;
      return {
        ...prev,
        include_op: checked,
        op_amount: opAmount,
        grand_total: prev.subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
      };
    });
  };

  const handleOpRateChange = (val: number | null) => {
    const rate = val ?? 0;
    pushHistory();
    markDirty();
    setResult((prev) => {
      if (!prev) return prev;
      const opAmount = prev.include_op ? prev.subtotal * (rate / 100) : 0;
      return {
        ...prev,
        op_rate: rate,
        op_amount: opAmount,
        grand_total: prev.subtotal + opAmount + prev.contingency_amount + (prev.supplements_total || 0),
      };
    });
  };

  // ── Export handlers ────────────────────────────────────────────────────────

  const handleExportPdf = async () => {
    if (!activeSessionId) {
      message.error('No active session to export');
      return;
    }
    setExporting('pdf');
    try {
      // Save latest edits to session before exporting
      if (onSaveSession) await onSaveSession();
      const blob = await packingApi.exportPdf(activeSessionId, companyOverride, taxRate, showBreakdown);
      const addr = [clientInfo.property_address_line1, clientInfo.property_city].filter(Boolean).join(', ').trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ');
      const pdfName = addr ? `Pack_in_out Estimate - ${addr}.pdf` : `Pack_in_out Estimate-${activeSessionId}.pdf`;
      triggerDownload(blob, pdfName);
      message.success('PDF downloaded');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    if (!activeSessionId) {
      message.error('No active session to export');
      return;
    }
    setExporting('excel');
    try {
      if (onSaveSession) await onSaveSession();
      const blob = await packingApi.exportExcel(activeSessionId, companyOverride, taxRate, showBreakdown);
      const addr = [clientInfo.property_address_line1, clientInfo.property_city].filter(Boolean).join(', ').trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ');
      const xlsName = addr ? `Pack_in_out Estimate - ${addr}.xlsx` : `Pack_in_out Estimate-${activeSessionId}.xlsx`;
      triggerDownload(blob, xlsName);
      message.success('Excel downloaded');
    } catch {
      message.error('Failed to export Excel');
    } finally {
      setExporting(null);
    }
  };

  // ── Create Invoice handler ──────────────────────────────────────────────────

  const handleCreateInvoice = async () => {
    if (!activeSessionId) {
      message.warning('Calculate estimate first');
      return;
    }
    setCreatingInvoice(true);
    try {
      if (onSaveSession) await onSaveSession();
      const res = await toolService.createInvoiceFromSession(activeSessionId, {
        customer_name: clientInfo.name || undefined,
        title: clientInfo.property_address_line1
          ? `Packing & Moving - ${[clientInfo.property_address_line1, clientInfo.property_city].filter(Boolean).join(', ')}`
          : 'Packing & Moving Invoice',
      });
      message.success(`Invoice ${res.invoiceNumber} created`);
      onInvoiceCreated?.(res.invoiceId, res.invoiceNumber);
      navigate(`/app/invoices/${res.invoiceId}`);
    } catch {
      message.error('Failed to create invoice');
    } finally {
      setCreatingInvoice(false);
    }
  };

  // ── Sections rendering ─────────────────────────────────────────────────────

  const sortedSections = result ? sortSections(result.sections) : [];

  const sectionPanels = sortedSections.map(([sectionName, sectionTotal]) => {
    const detail = result?.section_details?.[sectionName];
    const isAddingHere = newLine?.sectionName === sectionName;
    const isMaterialsSection = sectionName === 'Materials';

    return (
      <Panel
        key={sectionName}
        header={
          <Row justify="space-between" align="middle" style={{ width: '100%', paddingRight: 8 }}>
            <Col>
              <Text
                strong
                style={{
                  fontSize: 14,
                  fontFamily: fonts.heading,
                  color: colors.textPrimary,
                }}
              >
                {sectionName}{isMaterialsSection && (result?.material_details || detail?.lines) ? ` (${(result?.material_details?.length ?? detail?.lines?.length ?? 0)} items)` : ''}
              </Text>
              {isMaterialsSection && result?.materials_mode && (
                <Tag
                  style={{
                    marginLeft: 8,
                    borderRadius: borderRadius.sm,
                    fontSize: 11,
                    border: 'none',
                    background: result.materials_mode === 'itemized' ? colors.primary + '15' : colors.bgSunken,
                    color: result.materials_mode === 'itemized' ? colors.primary : colors.textSecondary,
                  }}
                >
                  {result.materials_mode === 'itemized' ? 'Itemized' : '% of Labor'}
                </Tag>
              )}
            </Col>
            <Col>
              <Text
                strong
                style={{ fontSize: 14, color: colors.info, fontFamily: fonts.body }}
              >
                {fmt(sectionTotal)}
              </Text>
            </Col>
          </Row>
        }
        style={{
          marginBottom: 8,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
        }}
      >
        {/* Materials section: show as category groups */}
        {isMaterialsSection && result?.material_details && result.material_details.length > 0 && (
          <SectionLineTable
            sectionName={sectionName}
            lines={
              // materials_mode self-declares the shape (itemized = many real
              // lines, pct_of_labor = 2-3 lump-sum category lines already in
              // material_details) for any estimate computed after this field
              // was added — no need to guess from shape either way. Only
              // sessions with no materials_mode at all (saved before this
              // field existed) fall back to the legacy shape-sniffing.
              result.materials_mode
                ? result.material_details.map((m) => ({
                    name: m.name,
                    detail: m.detail ?? '',
                    qty: m.quantity,
                    unit: m.unit,
                    rate: m.unit_price,
                    amount: m.total,
                  }))
                : isMaterialDetailsLegacy(result.material_details)
                ? groupMaterialDetails(result.material_details)
                : result.material_details.map((m) => ({
                    name: m.name,
                    detail: m.detail ?? '',
                    qty: m.quantity,
                    unit: m.unit,
                    rate: m.unit_price,
                    amount: m.total,
                  }))
            }
            editing={editing}
            onStartEdit={handleStartEdit}
            onEditField={handleEditField}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onDeleteLine={handleDeleteLine}
            crewSize={result?.crew_size ?? 1}
          />
        )}

        {/* Materials fallback: use section_details lines when material_details is absent */}
        {isMaterialsSection && !result?.material_details && detail && detail.lines.length > 0 && (
          <SectionLineTable
            sectionName={sectionName}
            lines={detail.lines}
            editing={editing}
            onStartEdit={handleStartEdit}
            onEditField={handleEditField}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onDeleteLine={handleDeleteLine}
            crewSize={result?.crew_size ?? 1}
          />
        )}

        {/* Other sections: show section_details lines */}
        {!isMaterialsSection && detail && detail.lines.length > 0 && (
          <SectionLineTable
            sectionName={sectionName}
            lines={detail.lines}
            editing={editing}
            onStartEdit={handleStartEdit}
            onEditField={handleEditField}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onDeleteLine={handleDeleteLine}
            crewSize={result?.crew_size ?? 1}
          />
        )}

        {/* New line row */}
        {isAddingHere && newLine && (
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: isMobile ? 8 : 6,
              padding: isMobile ? 12 : '8px 12px',
              background: '#f0f9ff',
              borderTop: `1px solid ${colors.border}`,
              alignItems: isMobile ? 'stretch' : 'center',
              flexWrap: 'wrap',
            }}
          >
            <Input
              size={isMobile ? 'middle' : 'small'}
              placeholder="Name"
              value={newLine.name}
              onChange={(e) => setNewLine((n) => n && { ...n, name: e.target.value })}
              autoFocus
              style={isMobile ? undefined : { flex: '1 1 120px', minWidth: 100 }}
            />
            <Input
              size={isMobile ? 'middle' : 'small'}
              placeholder="Detail"
              value={newLine.detail}
              onChange={(e) => setNewLine((n) => n && { ...n, detail: e.target.value })}
              style={isMobile ? undefined : { flex: '2 1 160px', minWidth: 100 }}
            />
            <div style={{ display: 'flex', gap: isMobile ? 8 : 6 }}>
              <InputNumber
                size={isMobile ? 'middle' : 'small'}
                min={0}
                value={newLine.qty}
                onChange={(v) => setNewLine((n) => n && { ...n, qty: v ?? 1 })}
                style={{ width: isMobile ? '30%' : 70 }}
              />
              <Input
                size={isMobile ? 'middle' : 'small'}
                placeholder="Unit"
                value={newLine.unit}
                onChange={(e) => setNewLine((n) => n && { ...n, unit: e.target.value })}
                style={{ width: isMobile ? '25%' : 60 }}
              />
              <InputNumber
                size={isMobile ? 'middle' : 'small'}
                min={0}
                value={newLine.rate}
                onChange={(v) => setNewLine((n) => n && { ...n, rate: v ?? 0 })}
                prefix="$"
                style={{ width: isMobile ? '45%' : 90 }}
              />
            </div>
            <Space size={isMobile ? 8 : 4} style={isMobile ? { justifyContent: 'flex-end' } : undefined}>
              <Button
                type="primary"
                size={isMobile ? 'middle' : 'small'}
                icon={<CheckOutlined />}
                onClick={handleCommitNewLine}
              >
                {isMobile ? 'Add' : undefined}
              </Button>
              <Button
                size={isMobile ? 'middle' : 'small'}
                icon={<CloseOutlined />}
                onClick={() => setNewLine(null)}
              />
            </Space>
          </div>
        )}

        <div style={{ padding: '8px 12px' }}>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => handleStartNewLine(sectionName)}
            disabled={isAddingHere || !!editing}
            style={{ width: '100%', borderColor: colors.border, color: colors.textSecondary }}
          >
            Add Line
          </Button>
        </div>
      </Panel>
    );
  });

  // ── Room summaries ─────────────────────────────────────────────────────────

  const roomSummaryPanels = result?.room_summaries?.map((rs) => (
    <Panel
      key={rs.room_name}
      header={
        <Row justify="space-between" align="middle">
          <Col>
            <Text strong style={{ fontSize: 13, fontFamily: fonts.body }}>
              {rs.room_name}
            </Text>
          </Col>
          <Col>
            <Tag style={{ fontSize: 11 }}>{rs.item_count} items</Tag>
          </Col>
        </Row>
      }
      style={{
        marginBottom: 6,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.base,
      }}
    >
      <Row gutter={[16, 8]}>
        {rs.notable_items.length > 0 && (
          <Col span={24}>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>Notable: </Text>
            {rs.notable_items.slice(0, 5).map((item) => (
              <Tag key={item} style={{ fontSize: 11, marginBottom: 4 }}>
                {item}
              </Tag>
            ))}
          </Col>
        )}
        {rs.high_value_items.length > 0 && (
          <Col span={24}>
            <Text style={{ fontSize: 12, color: colors.warning }}>High Value: </Text>
            {rs.high_value_items.slice(0, 4).map((item) => (
              <Tag
                key={item}
                color="warning"
                style={{ fontSize: 11, marginBottom: 4 }}
              >
                {item}
              </Tag>
            ))}
          </Col>
        )}
      </Row>
    </Panel>
  ));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: colors.bgWhite }}>
      {/* Compact table styles */}
      <style>{`
        .estimate-compact-table .ant-table-thead > tr > th {
          padding: 10px 12px !important;
          font-size: 12px;
          line-height: 1.4;
        }
        .estimate-compact-table .ant-table-tbody > tr > td {
          padding: 12px 12px !important;
          line-height: 1.5;
          /* global.css forces nowrap/hidden/ellipsis on every antd table cell
             app-wide, which clips the Input/InputNumber controls in edit mode
             (shows as a stray ".." at the cut edge). Undo it for this table —
             Name/Detail restore their own truncation via Text's ellipsis prop. */
          white-space: normal !important;
          overflow: visible !important;
          text-overflow: clip !important;
        }
        .estimate-compact-table .ant-table-thead > tr > th.ant-table-cell {
          background: ${colors.bgLight};
        }
        .estimate-editor-panel .ant-input {
          font-size: 13px !important;
          padding: 4px 8px !important;
        }
        .estimate-editor-panel .ant-input-affix-wrapper {
          font-size: 13px !important;
          padding: 4px 8px !important;
        }
        .estimate-editor-panel .ant-input-affix-wrapper > .ant-input {
          font-size: 13px !important;
          padding: 0 !important;
        }
      `}</style>
      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {!result ? (
        <div
          style={{
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 32,
            background: colors.bgLight,
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: colors.bgWhite, border: `2px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileTextOutlined style={{ fontSize: 28, color: colors.textMuted }} />
          </div>
          <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, color: colors.textPrimary }}>
            No Estimate Yet
          </Title>
          <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', maxWidth: 320 }}>
            Add rooms and configure settings in the wizard, then calculate to generate your estimate.
          </Text>
          {onCalculate && (
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              loading={calculating}
              onClick={handleCalculate}
              style={{
                marginTop: 8,
                background: colors.primary,
                borderColor: colors.primary,
                fontFamily: fonts.heading,
                fontWeight: 600,
                borderRadius: borderRadius.base,
                height: 44,
                paddingInline: 32,
              }}
            >
              Calculate Estimate
            </Button>
          )}
        </div>
      ) : (
      <div
        className="animate-result-reveal"
        style={{
          padding: isMobile ? '16px 16px' : '32px 32px',
          paddingBottom: isMobile ? 92 : 100,
          background: colors.bgLight,
        }}
      >
        {(result as any)?._stale && (
          <Alert
            type="warning"
            showIcon
            message="Items were modified"
            description="Re-calculate to update the estimate with your latest rooms."
            style={{ borderRadius: borderRadius.md, marginBottom: 20 }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
        {/* Left column: Sections + Materials + Room Summaries */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, paddingRight: isMobile ? 0 : 10, order: isMobile ? 2 : 1 }}>
          {/* ── Sections ──────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Title
                level={5}
                style={{
                  margin: 0,
                  fontFamily: fonts.heading,
                  fontSize: 15,
                  color: colors.textPrimary,
                }}
              >
                Sections
              </Title>
              <Text
                style={{ fontSize: 12, color: colors.textMuted }}
              >
                Double-click a row to edit
              </Text>
            </div>

            <Collapse
              bordered={false}
              defaultActiveKey={sortedSections.map(([k]) => k)}
              style={{ background: 'transparent' }}
              expandIcon={({ isActive }) =>
                isActive ? (
                  <DownOutlined style={{ fontSize: 11 }} />
                ) : (
                  <RightOutlined style={{ fontSize: 11 }} />
                )
              }
            >
              {sectionPanels}
            </Collapse>

            {/* Add Section */}
            <div style={{ marginTop: 8 }}>
              {showAddSection ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    placeholder="Section name"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    onPressEnter={handleAddSection}
                    autoFocus
                    size="small"
                    style={{ flex: 1 }}
                  />
                  <Button size="small" type="primary" onClick={handleAddSection}>
                    Add
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setShowAddSection(false);
                      setNewSectionName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => setShowAddSection(true)}
                  style={{
                    width: '100%',
                    borderColor: colors.borderDark,
                    color: colors.textSecondary,
                  }}
                >
                  Add Section
                </Button>
              )}
            </div>
          </div>

          {/* Materials detail is now rendered inline inside the Materials section panel above */}

          {/* ── Room Summaries ─────────────────────────────────────────────── */}
          {mode === 'content' && result.room_summaries && result.room_summaries.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <Collapse
                bordered={false}
                style={{ background: 'transparent' }}
                expandIcon={({ isActive }) =>
                  isActive ? (
                    <DownOutlined style={{ fontSize: 11 }} />
                  ) : (
                    <RightOutlined style={{ fontSize: 11 }} />
                  )
                }
              >
                <Panel
                  key="room-summaries"
                  header={
                    <Text
                      strong
                      style={{
                        fontSize: 14,
                        fontFamily: fonts.heading,
                        color: colors.textPrimary,
                      }}
                    >
                      Room Summaries
                    </Text>
                  }
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    overflow: 'hidden',
                    background: colors.bgWhite,
                  }}
                >
                  <Collapse
                    bordered={false}
                    style={{ background: 'transparent' }}
                    size="small"
                  >
                    {roomSummaryPanels}
                  </Collapse>
                </Panel>
              </Collapse>
            </div>
          )}
        </div>

        {/* Right column: Stats + Totals + Customer Info */}
        <div style={{ width: isMobile ? '100%' : 320, flexShrink: isMobile ? 1 : 0, order: isMobile ? 1 : 2 }}>
          {/* ── Stats Card ──────────────────────────────────────────────────── */}
          <Card
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              marginBottom: 16,
            }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <Row gutter={16} justify="space-around">
              <Col style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>Rooms</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.heading, color: colors.textPrimary }}>{result.total_rooms}</div>
              </Col>
              <Col style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  Hours
                  {schedulingSummary && (
                    <Tooltip title={schedulingSummary}>
                      <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted, cursor: 'help' }} />
                    </Tooltip>
                  )}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.heading, color: colors.textPrimary }}>{result.total_hours}</div>
              </Col>
              <Col style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>Crew</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.heading, color: colors.textPrimary }}>{result.crew_size}</div>
              </Col>
            </Row>
          </Card>

          {/* ── Schedule & Logistics ─────────────────────────────────────────── */}
          {/* Hand-adjust the drivers behind the estimate: on-site hours, crew
              size, and moving-van days. Each edit rewrites the affected lines
              and is undoable. */}
          <Card
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              marginBottom: 16,
            }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: 15 }}>
                Schedule &amp; Logistics
              </Title>
              <Space size={4}>
                <Tooltip title={undoStack.length ? 'Undo last change' : 'Nothing to undo'}>
                  <Button
                    size="small"
                    type="text"
                    icon={<UndoOutlined />}
                    disabled={undoStack.length === 0}
                    onClick={handleUndo}
                  />
                </Tooltip>
                <Tooltip title={redoStack.length ? 'Redo' : 'Nothing to redo'}>
                  <Button
                    size="small"
                    type="text"
                    icon={<RedoOutlined />}
                    disabled={redoStack.length === 0}
                    onClick={handleRedo}
                  />
                </Tooltip>
              </Space>
            </div>

            {/* On-site hours */}
            <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
              <Col>
                <Space size={4}>
                  <Text style={{ fontSize: 13 }}>On-Site Hours</Text>
                  <Tooltip title="Total elapsed crew hours. Changing this scales every crew-labor line proportionally.">
                    <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted, cursor: 'help' }} />
                  </Tooltip>
                </Space>
              </Col>
              <Col>
                <Space size={8}>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                    {currentWorkDays} day{currentWorkDays > 1 ? 's' : ''}
                  </Text>
                  <InputNumber
                    size="small"
                    min={0.5}
                    step={0.5}
                    value={currentLaborHours}
                    onChange={handleLaborHoursChange}
                    suffix="hr"
                    style={{ width: 92 }}
                  />
                </Space>
              </Col>
            </Row>

            {/* Crew size */}
            <Row justify="space-between" align="middle" style={{ marginBottom: 10 }}>
              <Col>
                <Space size={4}>
                  <Text style={{ fontSize: 13 }}>Crew Size</Text>
                  <Tooltip title="Crew-labor lines are priced at per-person rate × crew, so this re-prices them. Hours stay as set.">
                    <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted, cursor: 'help' }} />
                  </Tooltip>
                </Space>
              </Col>
              <Col>
                <InputNumber
                  size="small"
                  min={1}
                  max={20}
                  value={result.crew_size}
                  onChange={handleCrewSizeChange}
                  style={{ width: 92 }}
                />
              </Col>
            </Row>

            {/* Moving van days */}
            {currentTruckQty > 0 && (
              <>
                <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
                  <Col>
                    <Space size={4}>
                      <Text style={{ fontSize: 13 }}>Moving Van</Text>
                      <Tooltip title="Van-days billed. The calculated estimate bills the van by load capacity; switch on per-work-day billing to charge one day per workday instead.">
                        <InfoCircleOutlined style={{ fontSize: 11, color: colors.textMuted, cursor: 'help' }} />
                      </Tooltip>
                    </Space>
                  </Col>
                  <Col>
                    <InputNumber
                      size="small"
                      min={0}
                      max={30}
                      value={currentTruckQty}
                      onChange={handleTruckQtyChange}
                      suffix="DY"
                      style={{ width: 92 }}
                    />
                  </Col>
                </Row>

                {/* Per-work-day billing: off by default, and reversible —
                    switching back restores the calculated quantity and its
                    original description. Only meaningful once the job actually
                    spans more than one day. */}
                {currentWorkDays > 1 && (
                  <Row justify="space-between" align="middle">
                    <Col flex="1" style={{ minWidth: 0 }}>
                      <Space size={6}>
                        <Switch
                          size="small"
                          checked={vanPerWorkDay}
                          onChange={handleVanPerWorkDayToggle}
                        />
                        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                          Bill per work day ({currentWorkDays} days)
                        </Text>
                      </Space>
                    </Col>
                  </Row>
                )}
              </>
            )}
          </Card>

          {/* ── Scheduling Notes ─────────────────────────────────────────────── */}
          {/* The "Scheduling: ..." summary now lives in the Hours stat's hover
              tooltip above; standalone notes carry the rest. A multi-day
              schedule is already priced in, so it reads as info rather than a
              warning about something the user still has to resolve. */}
          {visibleNotes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {visibleNotes.map((note, i) => (
                <Alert
                  key={i}
                  message={
                    note.includes('\n') ? (
                      <span style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{note}</span>
                    ) : (
                      note
                    )
                  }
                  type={note.startsWith('Scheduled over') ? 'info' : 'warning'}
                  showIcon
                  style={{ marginBottom: i < visibleNotes.length - 1 ? 8 : 0 }}
                />
              ))}
            </div>
          )}

          {/* ── Totals Panel ────────────────────────────────────────────────── */}
          <Card
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              marginBottom: 16,
            }}
            styles={{ body: { padding: '20px 20px' } }}
          >
            <Title
              level={5}
              style={{
                margin: '0 0 16px',
                fontFamily: fonts.heading,
                fontSize: 15,
              }}
            >
              Totals
            </Title>

            {/* Subtotal */}
            <Row justify="space-between" style={{ marginBottom: 10 }}>
              <Col>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Subtotal</Text>
              </Col>
              <Col>
                <Text strong style={{ fontSize: 13 }}>
                  {fmt(result.subtotal)}
                </Text>
              </Col>
            </Row>

            <Divider style={{ margin: '8px 0' }} />

            {/* O&P */}
            <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
              <Col>
                <Space>
                  <Switch
                    size="small"
                    checked={result.include_op}
                    onChange={handleOpToggle}
                  />
                  <Text style={{ fontSize: 13 }}>O&P</Text>
                </Space>
              </Col>
              <Col>
                <Space size={8}>
                  <Text style={{ fontSize: 13, minWidth: 60, textAlign: 'right' }}>
                    {result.include_op ? fmt(result.op_amount) : '—'}
                  </Text>
                  <InputNumber
                    size="small"
                    min={0}
                    max={100}
                    value={result.op_rate}
                    onChange={handleOpRateChange}
                    disabled={!result.include_op}
                    suffix="%"
                    style={{ width: 72 }}
                  />
                </Space>
              </Col>
            </Row>

            {/* Conditional Supplements */}
            {(result.supplements || []).filter(s => s.triggered).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4, marginBottom: 6 }}>
                  Conditional Supplements
                </div>
                {(result.supplements || []).filter(s => s.triggered).map(s => (
                  <Row key={s.key} justify="space-between" align="top" style={{ marginBottom: 6 }}>
                    <Col flex="1" style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Checkbox
                          checked={s.enabled}
                          onChange={(e) => {
                            pushHistory();
                            markDirty();
                            setResult(prev => {
                              if (!prev) return prev;
                              const newSupplements = (prev.supplements || []).map(p =>
                                p.key === s.key ? { ...p, enabled: e.target.checked } : p
                              );
                              const newSupplementsTotal = newSupplements.filter(x => x.enabled).reduce((sum, x) => sum + (x.amount || 0), 0);
                              return {
                                ...prev,
                                supplements: newSupplements,
                                supplements_total: newSupplementsTotal,
                                grand_total: prev.subtotal + prev.op_amount + prev.contingency_amount + newSupplementsTotal,
                              };
                            });
                          }}
                        />
                        <Tooltip title={s.description}>
                          <Text style={{ fontSize: 13 }}>{s.name}</Text>
                        </Tooltip>
                      </div>
                    </Col>
                    <Col flex="none">
                      <InputNumber
                        size="small"
                        value={s.amount || 0}
                        min={0}
                        step={5}
                        prefix="$"
                        style={{ width: 100, fontSize: 13, opacity: s.enabled ? 1 : 0.4 }}
                        onChange={(val) => {
                          pushHistory();
                          markDirty();
                          setResult(prev => {
                            if (!prev) return prev;
                            const newSupplements = (prev.supplements || []).map(p =>
                              p.key === s.key ? { ...p, amount: val || 0 } : p
                            );
                            const newSupplementsTotal = newSupplements.filter(x => x.enabled).reduce((sum, x) => sum + (x.amount || 0), 0);
                            return {
                              ...prev,
                              supplements: newSupplements,
                              supplements_total: newSupplementsTotal,
                              grand_total: prev.subtotal + prev.op_amount + prev.contingency_amount + newSupplementsTotal,
                            };
                          });
                        }}
                      />
                    </Col>
                    {s.enabled && (
                      <Col span={24}>
                        <Input.TextArea
                          placeholder="Reason (shown on estimate)"
                          value={s.reason || ''}
                          onChange={(e) => {
                            pushHistory();
                            markDirty();
                            setResult(prev => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                supplements: (prev.supplements || []).map(p =>
                                  p.key === s.key ? { ...p, reason: e.target.value } : p
                                ),
                              };
                            });
                          }}
                          rows={3}
                          style={{
                            marginTop: 4,
                            marginLeft: 28,
                            width: 'calc(100% - 28px)',
                            fontSize: 12,
                            color: colors.textSecondary,
                          }}
                        />
                      </Col>
                    )}
                  </Row>
                ))}
              </>
            )}

            {/* Tax */}
            <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
              <Col>
                <Text style={{ fontSize: 13 }}>Tax Rate</Text>
              </Col>
              <Col>
                <Space size={8}>
                  <Text style={{ fontSize: 13, minWidth: 60, textAlign: 'right' }}>
                    {taxRate > 0 ? fmt(taxAmount) : '—'}
                  </Text>
                  <InputNumber
                    size="small"
                    min={0}
                    max={30}
                    value={taxRate}
                    onChange={(v) => setTaxRate(v ?? 0)}
                    suffix="%"
                    style={{ width: 72 }}
                  />
                </Space>
              </Col>
            </Row>

            <Divider style={{ margin: '12px 0' }} />

            {/* Grand Total */}
            <Row justify="space-between" align="middle" className="animate-result-reveal" style={{ animationDelay: '150ms' }}>
              <Col>
                <Text
                  strong
                  style={{
                    fontSize: 15,
                    fontFamily: fonts.heading,
                    color: colors.textPrimary,
                  }}
                >
                  Grand Total
                </Text>
              </Col>
              <Col>
                <Text
                  strong
                  style={{
                    fontSize: 22,
                    fontFamily: fonts.heading,
                    color: colors.info,
                  }}
                >
                  {fmt(computedGrandTotal)}
                </Text>
              </Col>
            </Row>
          </Card>

          {/* ── Customer Info ───────────────────────────────────────────────── */}
          <Card
            className="estimate-editor-panel"
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
            }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <Collapse
              bordered={false}
              style={{ background: 'transparent', margin: '-8px -8px' }}
              expandIcon={({ isActive }) =>
                isActive ? (
                  <DownOutlined style={{ fontSize: 11 }} />
                ) : (
                  <RightOutlined style={{ fontSize: 11 }} />
                )
              }
            >
              <Panel
                key="client"
                header={
                  <Space>
                    <UserOutlined style={{ color: colors.textSecondary }} />
                    <Text
                      strong
                      style={{ fontSize: 13, fontFamily: fonts.heading }}
                    >
                      Customer Info
                    </Text>
                  </Space>
                }
                style={{ border: 'none' }}
              >
                <CustomerSelector value={customerData} onChange={handleCustomerChange} />
              </Panel>

              {/* Company Override */}
              <Panel
                key="company"
                header={
                  <Row justify="space-between" align="middle" style={{ width: '100%' }}>
                    <Col>
                      <Space>
                        <BankOutlined style={{ color: colors.textSecondary }} />
                        <Text strong style={{ fontSize: 13, fontFamily: fonts.heading }}>
                          Company Override
                        </Text>
                      </Space>
                    </Col>
                    <Col>
                      <Switch
                        size="small"
                        checked={showCompanyOverride}
                        onChange={(v) => {
                          setShowCompanyOverride(v);
                          if (!v) {
                            setCompanyOverride({});
                          }
                        }}
                        onClick={(_, e) => e.stopPropagation()}
                      />
                    </Col>
                  </Row>
                }
                style={{ border: 'none' }}
              >
                {showCompanyOverride && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Input
                      size="small"
                      placeholder="Company Name"
                      value={companyOverride.name ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, name: e.target.value }))
                      }
                    />
                    <Input
                      size="small"
                      placeholder="Street Address"
                      value={companyOverride.address_line1 ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, address_line1: e.target.value }))
                      }
                    />
                    <Input
                      size="small"
                      placeholder="Apt/Suite/Unit (optional)"
                      value={companyOverride.address_line2 ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, address_line2: e.target.value }))
                      }
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Input
                        size="small"
                        placeholder="City"
                        value={companyOverride.city ?? ''}
                        onChange={(e) =>
                          setCompanyOverride((co) => ({ ...co, city: e.target.value }))
                        }
                      />
                      <Input
                        size="small"
                        placeholder="State"
                        style={{ width: 80 }}
                        value={companyOverride.state ?? ''}
                        onChange={(e) =>
                          setCompanyOverride((co) => ({ ...co, state: e.target.value }))
                        }
                      />
                      <Input
                        size="small"
                        placeholder="Zip"
                        style={{ width: 90 }}
                        value={companyOverride.zipcode ?? ''}
                        onChange={(e) =>
                          setCompanyOverride((co) => ({ ...co, zipcode: e.target.value }))
                        }
                      />
                    </div>
                    <Input
                      size="small"
                      placeholder="Phone"
                      value={companyOverride.phone ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, phone: e.target.value }))
                      }
                    />
                    <Input
                      size="small"
                      placeholder="Email"
                      value={companyOverride.email ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, email: e.target.value }))
                      }
                    />
                    <Input
                      size="small"
                      placeholder="License #"
                      value={companyOverride.license ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, license: e.target.value }))
                      }
                    />
                  </div>
                )}
                {!showCompanyOverride && (
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    Toggle to override company info on the export
                  </Text>
                )}
              </Panel>
            </Collapse>
          </Card>
        </div>
        </div>
      </div>
      )}

      {/* ── Fixed Footer: action buttons ─────────────────────────────────────
          position: fixed (not sticky) — this panel sits behind several nested
          flex/layout ancestors (app shell, tool wrapper) and sticky proved
          unreliable there. Fixed pins it to the viewport regardless. On
          desktop it spans edge-to-edge; the sidebar (higher z-index, opaque)
          naturally occludes the portion behind it. On mobile it sits just
          above the app's own bottom tab bar. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: isMobile ? '10px 12px' : '12px 20px',
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: isMobile ? 60 : 0,
          paddingBottom: isMobile ? '10px' : 'calc(12px + env(safe-area-inset-bottom))',
          zIndex: 90,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        }}
      >
        {/* Left: Calculate / Recalculate */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {onCalculate && (
            <Button
              icon={<ThunderboltOutlined />}
              loading={calculating}
              onClick={handleCalculate}
              size={isMobile ? 'small' : 'middle'}
              type={result ? 'default' : 'primary'}
              style={result ? { borderColor: colors.border } : { background: colors.primary, borderColor: colors.primary }}
            >
              {result ? 'Recalculate' : 'Calculate'}
            </Button>
          )}
        </div>

        {/* Right: Load / Export / Create — grouped so it reads as 2 clusters, not 4-7 flat buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={handleOpenLoadModal}
            size={isMobile ? 'small' : 'middle'}
            style={{ borderColor: colors.border }}
          >
            {!isMobile && 'Load Saved'}
          </Button>
          <Dropdown
            trigger={['click']}
            disabled={!activeSessionId || !result}
            menu={{
              items: [
                { key: 'pdf', label: 'PDF', icon: <FilePdfOutlined /> },
                { key: 'excel', label: 'Excel', icon: <FileExcelOutlined /> },
                { key: 'report', label: 'Report', icon: <FileTextOutlined /> },
              ],
              onClick: async ({ key }) => {
                if (key === 'pdf') setExportOptionsFormat('pdf');
                else if (key === 'excel') setExportOptionsFormat('excel');
                else if (key === 'report') {
                  // Open the modal first: the save below can take a few seconds,
                  // and until it finishes the click would otherwise look ignored.
                  setPreparingReport(true);
                  setShowReportModal(true);
                  try {
                    // Save latest edits (customer info, etc.) to the session first —
                    // the report is built server-side from the saved session, not live state.
                    if (onSaveSession) await onSaveSession();
                  } finally {
                    setPreparingReport(false);
                  }
                }
              },
            }}
          >
            <Button
              icon={<ExportOutlined />}
              loading={exporting !== null}
              disabled={!activeSessionId || !result}
              size={isMobile ? 'small' : 'middle'}
              style={{ borderColor: colors.border }}
            >
              {!isMobile && 'Export'} <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>

          <Divider type="vertical" style={{ height: 24, margin: '0 2px' }} />

          {/* Estimate comes first — it's the primary action; an Invoice is
              normally created from an Estimate afterward, so it's secondary
              here (unless this session has no estimate step at all, in which
              case Invoice is the only "create" action and carries full weight). */}
          {onCreateEstimate && (
            <Button
              type="primary"
              loading={creatingEstimate}
              onClick={onCreateEstimate}
              disabled={!result || creatingEstimate}
              size={isMobile ? 'small' : 'middle'}
              style={{ background: colors.primary, borderColor: colors.primary }}
            >
              {isMobile ? 'Estimate' : 'Create Scopit Estimate'}
            </Button>
          )}
          <Button
            type={onCreateEstimate ? 'default' : 'primary'}
            loading={creatingInvoice}
            onClick={handleCreateInvoice}
            disabled={!activeSessionId || !result}
            size={isMobile ? 'small' : 'middle'}
            style={onCreateEstimate ? { borderColor: colors.border } : { background: colors.primary, borderColor: colors.primary }}
          >
            {isMobile ? 'Invoice' : 'Create Invoice'}
          </Button>
        </div>
      </div>

      {/* Load Saved Estimate Modal */}
      <Modal
        open={showLoadModal}
        onCancel={() => setShowLoadModal(false)}
        footer={null}
        title="Load Saved Estimate"
        width={480}
        styles={{ body: { padding: '12px 0 0' } }}
      >
        {loadingHistory ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: colors.textMuted }}>
            Loading...
          </div>
        ) : savedSessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: colors.textMuted }}>
            No saved estimates found.
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {savedSessions.map((session) => {
              const d = session.data as any;
              const mode: string = d?.mode ?? 'quick';
              const address: string = [d?.client_info?.property_address_line1, d?.client_info?.property_city].filter(Boolean).join(', ');
              const updatedAt = new Date(session.updatedAt || session.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              });
              return (
                <div
                  key={session.id}
                  onClick={() => handleLoadSession(session)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = colors.bgLight)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text
                      strong
                      ellipsis
                      style={{ fontSize: 13, display: 'block', fontFamily: fonts.heading }}
                    >
                      {session.name}
                    </Text>
                    {address && (
                      <Text
                        ellipsis
                        style={{ fontSize: 12, color: colors.textSecondary, display: 'block' }}
                      >
                        {address}
                      </Text>
                    )}
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>
                      {updatedAt}
                    </Text>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right', marginLeft: 12 }}>
                    <Tag style={{ fontSize: 10 }}>
                      {mode === 'content' ? 'Photo AI' : 'Quick'}
                    </Tag>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* PDF/Excel export options */}
      <Modal
        title={exportOptionsFormat === 'excel' ? 'Export as Excel' : 'Export as PDF'}
        open={exportOptionsFormat !== null}
        onCancel={() => setExportOptionsFormat(null)}
        width={380}
        footer={[
          <Button key="cancel" onClick={() => setExportOptionsFormat(null)}>
            Cancel
          </Button>,
          <Button
            key="export"
            type="primary"
            loading={exporting !== null}
            style={{ background: colors.primary, borderColor: colors.primary }}
            onClick={() => {
              const format = exportOptionsFormat;
              setExportOptionsFormat(null);
              if (format === 'excel') handleExportExcel();
              else if (format === 'pdf') handleExportPdf();
            }}
          >
            Export
          </Button>,
        ]}
      >
        <Checkbox
          checked={showBreakdown}
          onChange={(e) => setShowBreakdown(e.target.checked)}
        >
          <Text style={{ fontSize: 13 }}>Include labor hour breakdown</Text>
        </Checkbox>
      </Modal>

      {/* Report Export Modal */}
      {result && (
      <ReportExportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        preparing={preparingReport}
        result={result}
        mode={mode}
        clientInfo={clientInfo}
        companyOverride={companyOverride}
        activeSessionId={activeSessionId}
        photoRooms={photoRooms}
        rooms={rooms}
        onRequestSign={async (blob, filename) => {
          // Upload report PDF to PDF editor, then user can create sign request
          try {
            const { pdfEditorApi } = await import(
              '../pdf-editor/pdfEditorApi'
            );
            const file = new File([blob], filename, { type: 'application/pdf' });
            const doc = await pdfEditorApi.uploadDocument(file, filename);
            message.success(
              'Report uploaded to PDF Editor. Open PDF Editor to send for signature.',
            );
            setShowReportModal(false);
            // Log doc id so user can find it
            console.info('Report document uploaded:', doc.id);
          } catch (err: any) {
            message.error(
              err?.response?.data?.detail || 'Failed to upload report for signing',
            );
          }
        }}
      />
      )}
    </div>
  );
};

export default EstimateEditorModal;
