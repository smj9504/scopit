import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Modal,
  Button,
  InputNumber,
  Switch,
  Input,
  Collapse,
  Divider,
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
  WarningOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  SaveOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  UserOutlined,
  BankOutlined,
  DownOutlined,
  RightOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { toolService } from '@/services/toolService';
import type { ToolSession } from '@/types/tools';
import ReportExportModal from './ReportExportModal';
import type { ColumnsType } from 'antd/es/table';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { packingApi } from './packingApi';
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
  const poCrewLine = packOutLines.find((l) => l.unit === 'HR' && /crew/i.test(l.name));
  const pbCrewLine = packBackLines.find((l) => l.unit === 'HR' && /crew/i.test(l.name));
  const poElapsed = poCrewLine ? Math.round((poCrewLine.qty / crewN) * 10) / 10 : 0;
  const pbElapsed = pbCrewLine ? Math.round((pbCrewLine.qty / crewN) * 10) / 10 : 0;
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

  if (totalElapsed > 8) {
    const workDays = Math.ceil(totalElapsed / 8);
    notes.push(
      `On-site time exceeds a standard 8-hr workday — ` +
        `recommend scheduling ${workDays} day${workDays > 1 ? 's' : ''}.`,
    );
  }

  // Labor hour breakdown — explain how each HR line item qty was calculated
  const breakdownParts: string[] = [];
  for (const secName of ['Pack-Out Labor', 'Pack-Back Labor']) {
    const lines = sectionDetails?.[secName]?.lines ?? [];
    for (const line of lines) {
      if (line.unit !== 'HR' || line.qty <= 0) continue;
      const detail = line.detail || '';
      const isCrew = /crew/i.test(detail);
      const hasElapsed = /[\d.]+\s*elapsed hr/i.test(detail);
      if (isCrew && hasElapsed) {
        // Quick mode: qty = person-hrs, rate = per-person rate
        const m = detail.match(/([\d.]+)\s*elapsed hr/i);
        const elapsed = m ? parseFloat(m[1]) : Math.round((line.qty / crewN) * 10) / 10;
        breakdownParts.push(
          `${line.name}: ${elapsed} elapsed hr × ${crewN} crew = ${line.qty} person-hrs × ${fmtMoney(line.rate)}/hr = ${fmtMoney(line.amount)}`,
        );
      } else if (isCrew) {
        // Content mode: qty = elapsed hrs, rate = crew_rate
        const perPerson = Math.round((line.rate / crewN) * 100) / 100;
        breakdownParts.push(
          `${line.name}: ${line.qty} hr × ${crewN} crew × ${fmtMoney(perPerson)}/hr = ${fmtMoney(line.amount)}`,
        );
      } else {
        breakdownParts.push(
          `${line.name}: ${line.qty} hr × ${fmtMoney(line.rate)}/hr = ${fmtMoney(line.amount)}`,
        );
      }
    }
  }
  if (breakdownParts.length > 0) {
    notes.push('Labor Hours Breakdown:\n' + breakdownParts.map((p) => `• ${p}`).join('\n'));
  }

  return notes;
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface EstimateEditorModalProps {
  open: boolean;
  onClose: () => void;
  result: EstimateResponse | null;
  setResult: React.Dispatch<React.SetStateAction<EstimateResponse | null>>;
  mode: 'quick' | 'content' | 'packout';
  clientInfo: ClientInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientInfo>>;
  companyOverride: CompanyInfoOverride;
  setCompanyOverride: React.Dispatch<React.SetStateAction<CompanyInfoOverride>>;
  activeSessionId?: string;
  onCreateEstimate?: () => void;
  onSaveSession?: () => Promise<void>;
  onCalculate?: () => Promise<EstimateResponse | undefined>;
  photoRooms?: import('./types').PhotoRoom[];
  rooms?: import('./types').PackingRoom[];
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
}) => {
  const isRowEditing = (record: { _index: number }) =>
    editing?.sectionName === sectionName && editing?.lineIndex === record._index;

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
              value={editing!.name}
              onChange={(e) => onEditField('name', e.target.value)}
              onPressEnter={onSaveEdit}
              autoFocus
              style={{ fontFamily: fonts.body }}
            />
          );
        }
        return <Text style={{ fontSize: 13, fontFamily: fonts.body }}>{val}</Text>;
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
              value={editing!.detail}
              onChange={(e) => onEditField('detail', e.target.value)}
              onPressEnter={onSaveEdit}
              style={{ fontFamily: fonts.body }}
            />
          );
        }
        return (
          <Text style={{ fontSize: 13, color: colors.textSecondary, fontFamily: fonts.body }}>
            {val}
          </Text>
        );
      },
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      key: 'qty',
      width: 80,
      align: 'right' as const,
      render: (val, record) => {
        if (isRowEditing(record)) {
          return (
            <InputNumber
              size="small"
              min={0}
              step={0.5}
              value={editing!.qty}
              onChange={(v) => onEditField('qty', v ?? 0)}
              style={{ width: 70 }}
              onPressEnter={onSaveEdit}
            />
          );
        }
        return <Text style={{ fontSize: 13 }}>{val}</Text>;
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
              value={editing!.unit}
              onChange={(e) => onEditField('unit', e.target.value)}
              onPressEnter={onSaveEdit}
              style={{ width: 55 }}
            />
          );
        }
        return <Text style={{ fontSize: 13, color: colors.textSecondary }}>{val}</Text>;
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
              min={0}
              step={1}
              value={editing!.rate}
              onChange={(v) => onEditField('rate', v ?? 0)}
              style={{ width: 80 }}
              prefix="$"
              onPressEnter={onSaveEdit}
            />
          );
        }
        return <Text style={{ fontSize: 13 }}>{fmt(val)}</Text>;
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
        return (
          <Text strong style={{ fontSize: 13, color: ed ? colors.info : colors.textPrimary }}>
            {fmt(amount)}
          </Text>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 60,
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

// ── Labor Hours Card ──────────────────────────────────────────────────────────

interface LaborHoursCardProps {
  result: EstimateResponse;
  onChangeHours: (sectionName: string, lineIndex: number, newQty: number) => void;
}

const LaborHoursCard: React.FC<LaborHoursCardProps> = ({ result, onChangeHours }) => {
  const crewN = Math.max(1, result.crew_size);

  const isCrewLine = (line: SectionDetailLine) => /crew/i.test(line.detail || '');
  const toElapsed = (line: SectionDetailLine) =>
    isCrewLine(line) ? Math.round((line.qty / crewN) * 10) / 10 : line.qty;
  const toPersonHours = (elapsed: number, line: SectionDetailLine) =>
    isCrewLine(line) ? Math.round(elapsed * crewN * 10) / 10 : elapsed;

  const [localValues, setLocalValues] = useState<Record<string, number>>({});

  const prevResultRef = useRef(result);
  useEffect(() => {
    if (prevResultRef.current !== result) {
      setLocalValues({});
      prevResultRef.current = result;
    }
  }, [result]);

  const getKey = (secName: string, lineIndex: number) => `${secName}||${lineIndex}`;
  const getDisplayValue = (secName: string, lineIndex: number, line: SectionDetailLine) =>
    localValues[getKey(secName, lineIndex)] ?? toElapsed(line);

  const handleChange = (secName: string, lineIndex: number, line: SectionDetailLine, v: number | null) => {
    const elapsed = v ?? 0;
    setLocalValues((prev) => ({ ...prev, [getKey(secName, lineIndex)]: elapsed }));
    onChangeHours(secName, lineIndex, toPersonHours(elapsed, line));
  };

  const laborSections: [string, SectionDetailLine[]][] = [];
  for (const secName of ['Pack-Out Labor', 'Pack-Back Labor']) {
    const lines = result.section_details?.[secName]?.lines ?? [];
    if (lines.some((l) => l.unit === 'HR')) {
      laborSections.push([secName, lines]);
    }
  }

  const carryLines: { label: string; secName: string; lineIndex: number; line: SectionDetailLine }[] = [];
  for (const [secName, detail] of Object.entries(result.section_details ?? {})) {
    if (isTransportSection(secName)) {
      detail.lines.forEach((line, i) => {
        if (line.unit === 'HR') {
          carryLines.push({
            label: /out/i.test(secName) ? 'Carry-Out' : 'Carry-In',
            secName,
            lineIndex: i,
            line,
          });
        }
      });
    }
  }

  const otherLaborSections: [string, SectionDetailLine[]][] = [];
  for (const [secName, detail] of Object.entries(result.section_details ?? {})) {
    if (
      /labor|labour/i.test(secName) &&
      secName !== 'Pack-Out Labor' &&
      secName !== 'Pack-Back Labor' &&
      !isTransportSection(secName)
    ) {
      if (detail.lines.some((l) => l.unit === 'HR')) {
        otherLaborSections.push([secName, detail.lines]);
      }
    }
  }

  if (laborSections.length === 0 && carryLines.length === 0 && otherLaborSections.length === 0) {
    return null;
  }

  // Compute total elapsed hours for summary badge
  const poCrewLine = (result.section_details?.['Pack-Out Labor']?.lines ?? []).find(
    (l) => l.unit === 'HR' && /crew/i.test(l.name),
  );
  const pbCrewLine = (result.section_details?.['Pack-Back Labor']?.lines ?? []).find(
    (l) => l.unit === 'HR' && /crew/i.test(l.name),
  );
  const poElapsed = poCrewLine
    ? (localValues[getKey('Pack-Out Labor', (result.section_details?.['Pack-Out Labor']?.lines ?? []).indexOf(poCrewLine))] ?? toElapsed(poCrewLine))
    : 0;
  const pbElapsed = pbCrewLine
    ? (localValues[getKey('Pack-Back Labor', (result.section_details?.['Pack-Back Labor']?.lines ?? []).indexOf(pbCrewLine))] ?? toElapsed(pbCrewLine))
    : 0;
  const totalElapsed = Math.round((poElapsed + pbElapsed) * 10) / 10;

  // ── Row renderer ──────────────────────────────────────────────────────────
  const renderRow = (
    secName: string,
    lineIndex: number,
    line: SectionDetailLine,
    sublabel?: string,
  ) => {
    const isCrew = isCrewLine(line);
    const displayVal = getDisplayValue(secName, lineIndex, line);
    return (
      <div
        key={`${secName}-${lineIndex}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 108px 68px',
          alignItems: 'center',
          gap: 8,
          padding: '7px 0',
          borderBottom: `1px solid ${colors.bgLight}`,
        }}
      >
        {/* Name column */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text
              ellipsis={{ tooltip: line.name }}
              style={{ fontSize: 13, color: colors.textPrimary, fontFamily: fonts.body, lineHeight: '18px' }}
            >
              {line.name}
            </Text>
            {isCrew && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textMuted,
                background: colors.bgLight,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                padding: '0 5px',
                lineHeight: '16px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                ×{crewN}
              </span>
            )}
          </div>
          {sublabel && (
            <Text style={{ fontSize: 11, color: colors.textMuted, lineHeight: '16px' }}>
              {sublabel}
            </Text>
          )}
        </div>

        {/* Hours input column */}
        <InputNumber
          size="small"
          min={0}
          step={0.5}
          value={displayVal}
          onChange={(v) => handleChange(secName, lineIndex, line, v)}
          style={{ width: '100%', fontSize: 13 }}
          suffix={<Text style={{ fontSize: 11, color: colors.textMuted }}>hr</Text>}
        />

        {/* Amount column */}
        <Text style={{
          fontSize: 13,
          color: colors.textSecondary,
          textAlign: 'right',
          fontFamily: fonts.body,
          whiteSpace: 'nowrap',
        }}>
          {fmt(line.amount)}
        </Text>
      </div>
    );
  };

  // ── Section label ──────────────────────────────────────────────────────────
  const renderSectionLabel = (label: string) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      marginBottom: 2,
    }}>
      <Text style={{
        fontSize: 10,
        fontWeight: 700,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </Text>
      <div style={{ flex: 1, height: 1, background: colors.border }} />
    </div>
  );

  return (
    <Card
      style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, marginBottom: 16 }}
      styles={{ body: { padding: '14px 16px 10px' } }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: 14 }}>
          Labor Hours
        </Title>
        {totalElapsed > 0 && (
          <div style={{
            background: colors.bgLight,
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            padding: '2px 10px',
            fontSize: 12,
            color: colors.textSecondary,
            fontFamily: fonts.body,
          }}>
            {totalElapsed} hr elapsed
          </div>
        )}
      </div>

      {/* ── Column header ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 108px 68px',
        gap: 8,
        paddingBottom: 4,
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: 2,
      }}>
        <Text style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Item</Text>
        <Text style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' }}>Hours</Text>
        <Text style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' }}>Cost</Text>
      </div>

      {/* ── Pack-Out / Pack-Back ── */}
      {laborSections.map(([secName, lines], si) => (
        <div key={secName}>
          {renderSectionLabel(secName.replace(' Labor', ''))}
          {lines.filter((l) => l.unit === 'HR').map((line, i) =>
            renderRow(secName, lines.indexOf(line), line)
          )}
        </div>
      ))}

      {/* ── Carry Labor ── */}
      {carryLines.length > 0 && (
        <div>
          {renderSectionLabel('Carry')}
          {carryLines.map(({ label, secName, lineIndex, line }) =>
            renderRow(secName, lineIndex, line, label)
          )}
        </div>
      )}

      {/* ── Other Labor ── */}
      {otherLaborSections.map(([secName, lines]) => (
        <div key={secName}>
          {renderSectionLabel(secName)}
          {lines.filter((l) => l.unit === 'HR').map((line, i) =>
            renderRow(secName, lines.indexOf(line), line)
          )}
        </div>
      ))}
    </Card>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const EstimateEditorModal: React.FC<EstimateEditorModalProps> = ({
  open,
  onClose,
  result,
  setResult,
  mode,
  clientInfo,
  setClientInfo,
  companyOverride,
  setCompanyOverride,
  activeSessionId,
  onCreateEstimate,
  onSaveSession,
  onCalculate,
  photoRooms,
  rooms,
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

  // ── Calculate handler ────────────────────────────────────────────────────
  const handleCalculate = useCallback(async () => {
    if (!onCalculate) return;
    setCalculating(true);
    try {
      const res = await onCalculate();
      if (res) {
        setResult(res);
        message.success('Estimate calculated');
      }
    } catch {
      message.error('Calculation failed. Please try again.');
    } finally {
      setCalculating(false);
    }
  }, [onCalculate, setResult]);

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
  const [showCompanyOverride, setShowCompanyOverride] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

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
        lines[lineIndex] = { ...lines[lineIndex], name, detail, qty, unit, rate, amount: newAmount };
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

    setEditing(null);
  }, [editing, setResult]);

  const handleCancelEdit = useCallback(() => setEditing(null), []);

  // ── Labor Hours change (from Labor Hours card) ─────────────────────────────

  const handleLaborHoursChange = useCallback(
    (sectionName: string, lineIndex: number, newQty: number) => {
      setResult((prev) => {
        if (!prev) return prev;
        const details = { ...(prev.section_details ?? {}) };
        if (!details[sectionName]) return prev;

        const lines = [...details[sectionName].lines];
        const line = lines[lineIndex];
        const newAmount = Math.round(newQty * line.rate * 100) / 100;
        // Also update the elapsed hrs in detail text (e.g. "11.5 elapsed hr · 4-person crew ...")
        const crewN = Math.max(1, prev.crew_size);
        const isCrewLine = /crew/i.test(line.detail || '');
        const newElapsed = isCrewLine
          ? Math.round((newQty / crewN) * 10) / 10
          : null;
        const newManHrs = isCrewLine ? Math.round(newQty * 10) / 10 : null;
        const newDetail =
          newElapsed !== null && line.detail
            ? line.detail
                .replace(/^[\d.]+(\s*elapsed hr)/, `${newElapsed}$1`)
                .replace(/([\d.]+)(\s*man-hr)/, `${newManHrs}$2`)
            : line.detail;
        lines[lineIndex] = { ...line, qty: newQty, amount: newAmount, detail: newDetail };

        const sectionTotal = lines.reduce((sum, l) => sum + l.amount, 0);
        const newSections = { ...prev.sections, [sectionName]: sectionTotal };
        const subtotal = Object.values(newSections).reduce((s, v) => s + v, 0);
        const opAmount = prev.include_op ? subtotal * (prev.op_rate / 100) : 0;
        const contingencyAmount = prev.include_contingency
          ? subtotal * (prev.contingency_rate / 100)
          : 0;

        const updatedDetails = { ...details, [sectionName]: { lines } };

        // Recalculate total_hours (elapsed) from main crew lines
        const poCrewLine = updatedDetails['Pack-Out Labor']?.lines.find(
          (l) => l.unit === 'HR' && /crew/i.test(l.name),
        );
        const pbCrewLine = updatedDetails['Pack-Back Labor']?.lines.find(
          (l) => l.unit === 'HR' && /crew/i.test(l.name),
        );
        const newTotalHours =
          Math.round(
            (((poCrewLine?.qty ?? 0) + (pbCrewLine?.qty ?? 0)) / crewN) * 10,
          ) / 10;

        return {
          ...prev,
          sections: newSections,
          section_details: updatedDetails,
          subtotal,
          op_amount: opAmount,
          contingency_amount: contingencyAmount,
          grand_total:
            subtotal + opAmount + contingencyAmount + (prev.supplements_total || 0),
          total_hours: newTotalHours,
          notes: generateSchedulingNotes(updatedDetails, prev.crew_size),
        };
      });
    },
    [setResult],
  );

  const handleDeleteLine = useCallback(
    (sectionName: string, lineIndex: number) => {
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
    [setResult],
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
      // List endpoint strips heavy data — filter by status and exclude current session
      const withResult = sessions.filter(
        (s) => (s.data as any)?.status === 'completed' && s.id !== activeSessionId,
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
      const addr = clientInfo.property_address?.trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ');
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
      const addr = clientInfo.property_address?.trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ');
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
        title: clientInfo.property_address
          ? `Packing & Moving - ${clientInfo.property_address}`
          : 'Packing & Moving Invoice',
      });
      message.success(`Invoice ${res.invoiceNumber} created`);
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
              isMaterialDetailsLegacy(result.material_details)
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
          />
        )}

        {/* New line row */}
        {isAddingHere && newLine && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: '8px 12px',
              background: '#f0f9ff',
              borderTop: `1px solid ${colors.border}`,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Input
              size="small"
              placeholder="Name"
              value={newLine.name}
              onChange={(e) => setNewLine((n) => n && { ...n, name: e.target.value })}
              autoFocus
              style={{ flex: '1 1 120px', minWidth: 100 }}
            />
            <Input
              size="small"
              placeholder="Detail"
              value={newLine.detail}
              onChange={(e) => setNewLine((n) => n && { ...n, detail: e.target.value })}
              style={{ flex: '2 1 160px', minWidth: 100 }}
            />
            <InputNumber
              size="small"
              min={0}
              value={newLine.qty}
              onChange={(v) => setNewLine((n) => n && { ...n, qty: v ?? 1 })}
              style={{ width: 70 }}
            />
            <Input
              size="small"
              placeholder="Unit"
              value={newLine.unit}
              onChange={(e) => setNewLine((n) => n && { ...n, unit: e.target.value })}
              style={{ width: 60 }}
            />
            <InputNumber
              size="small"
              min={0}
              value={newLine.rate}
              onChange={(v) => setNewLine((n) => n && { ...n, rate: v ?? 0 })}
              prefix="$"
              style={{ width: 90 }}
            />
            <Space size={4}>
              <Button
                type="primary"
                size="small"
                icon={<CheckOutlined />}
                onClick={handleCommitNewLine}
              />
              <Button
                size="small"
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
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="95vw"
      style={{ top: 20, maxWidth: 1200 }}
      styles={{
        body: {
          padding: 0,
          height: 'calc(95vh - 40px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        content: {
          padding: 0,
          borderRadius: borderRadius.lg,
          overflow: 'hidden',
        },
      }}
      closeIcon={null}
      destroyOnHidden
    >
      {/* Compact table styles */}
      <style>{`
        .estimate-compact-table .ant-table-thead > tr > th {
          padding: 4px 8px !important;
          font-size: 12px;
          line-height: 1.4;
        }
        .estimate-compact-table .ant-table-tbody > tr > td {
          padding: 4px 8px !important;
          line-height: 1.4;
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
      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          flexShrink: 0,
          gap: 16,
        }}
      >
        {/* Left: title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Title
            level={5}
            style={{
              margin: 0,
              fontFamily: fonts.heading,
              color: colors.textPrimary,
              fontWeight: 700,
            }}
          >
            Estimate Editor
          </Title>
          {mode === 'content' && (
            <Tag color="blue" style={{ fontSize: 11 }}>
              Photo AI
            </Tag>
          )}
        </div>

        {/* Stale result warning */}
        {(result as any)?._stale && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: borderRadius.base, fontSize: 12, color: '#92400e',
          }}>
            <WarningOutlined />
            Items were modified. Re-calculate to update the estimate.
          </div>
        )}

        {/* Right: close button */}
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ marginLeft: 'auto', color: colors.textSecondary }}
        />
      </div>

      {/* ── Scrollable Body ─────────────────────────────────────────────────── */}
      {!result ? (
        <div
          style={{
            flex: 1,
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
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: isMobile ? '16px 16px' : '32px 32px',
          background: colors.bgLight,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 24,
        }}
      >
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
                <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>Hours</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.heading, color: colors.textPrimary }}>{result.total_hours}</div>
              </Col>
              <Col style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>Crew</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fonts.heading, color: colors.textPrimary }}>{result.crew_size}</div>
              </Col>
            </Row>
          </Card>

          {/* ── Labor Hours Card ────────────────────────────────────────────── */}
          <LaborHoursCard result={result} onChangeHours={handleLaborHoursChange} />

          {/* ── Scheduling Notes ─────────────────────────────────────────────── */}
          {result.notes && result.notes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {result.notes.map((note, i) => (
                <Alert
                  key={i}
                  message={
                    note.includes('\n') ? (
                      <span style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{note}</span>
                    ) : (
                      note
                    )
                  }
                  type={
                    note.startsWith('Labor Hours Breakdown')
                      ? 'info'
                      : note.startsWith('Scheduling:')
                        ? 'info'
                        : 'warning'
                  }
                  showIcon
                  style={{ marginBottom: i < result.notes!.length - 1 ? 8 : 0 }}
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
                      {s.enabled && (
                        <Input
                          size="small"
                          placeholder="Reason (shown on estimate)"
                          value={s.reason || ''}
                          onChange={(e) => {
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
                          style={{
                            marginTop: 4,
                            marginLeft: 28,
                            fontSize: 12,
                            color: colors.textSecondary,
                          }}
                        />
                      )}
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

            {/* Show Breakdown option */}
            <Row align="middle" style={{ marginTop: 8, marginBottom: 2 }}>
              <Col>
                <Checkbox
                  checked={showBreakdown}
                  onChange={(e) => setShowBreakdown(e.target.checked)}
                >
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                    Show labor hour breakdown in export
                  </Text>
                </Checkbox>
              </Col>
            </Row>

            <Divider style={{ margin: '12px 0' }} />

            {/* Grand Total */}
            <Row justify="space-between" align="middle">
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Input
                    size="small"
                    placeholder="Client Name"
                    value={clientInfo.name}
                    onChange={(e) =>
                      setClientInfo((ci) => ({ ...ci, name: e.target.value }))
                    }
                    prefix={<UserOutlined style={{ color: colors.textMuted, fontSize: 12 }} />}
                  />
                  <Input
                    size="small"
                    placeholder="Phone"
                    value={clientInfo.phone}
                    onChange={(e) =>
                      setClientInfo((ci) => ({ ...ci, phone: e.target.value }))
                    }
                  />
                  <Input
                    size="small"
                    placeholder="Email"
                    value={clientInfo.email}
                    onChange={(e) =>
                      setClientInfo((ci) => ({ ...ci, email: e.target.value }))
                    }
                  />
                  <Input
                    size="small"
                    placeholder="Property Address"
                    value={clientInfo.property_address}
                    onChange={(e) =>
                      setClientInfo((ci) => ({
                        ...ci,
                        property_address: e.target.value,
                      }))
                    }
                  />
                </div>
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
                      placeholder="Address"
                      value={companyOverride.address ?? ''}
                      onChange={(e) =>
                        setCompanyOverride((co) => ({ ...co, address: e.target.value }))
                      }
                    />
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
      )}

      {/* ── Sticky Footer: action buttons ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: isMobile ? '10px 12px' : '12px 20px',
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          flexShrink: 0,
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

        {/* Right: Export + Actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={handleOpenLoadModal}
            size={isMobile ? 'small' : 'middle'}
            style={{ borderColor: colors.border }}
          >
            {!isMobile && 'Load Saved'}
          </Button>
          <Button
            icon={<FilePdfOutlined />}
            loading={exporting === 'pdf'}
            onClick={handleExportPdf}
            disabled={!activeSessionId || !result}
            size={isMobile ? 'small' : 'middle'}
            style={{ borderColor: colors.border }}
          >
            PDF
          </Button>
          <Button
            icon={<FileExcelOutlined />}
            loading={exporting === 'excel'}
            onClick={handleExportExcel}
            disabled={!activeSessionId || !result}
            size={isMobile ? 'small' : 'middle'}
            style={{ borderColor: colors.border }}
          >
            Excel
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setShowReportModal(true)}
            disabled={!activeSessionId || !result}
            size={isMobile ? 'small' : 'middle'}
            style={{ borderColor: colors.border }}
          >
            Report
          </Button>
          <Button
            icon={<SaveOutlined />}
            size={isMobile ? 'small' : 'middle'}
            disabled={!result}
            onClick={() => message.success('Estimate saved')}
          >
            Save
          </Button>
          <Button
            type="primary"
            loading={creatingInvoice}
            onClick={handleCreateInvoice}
            disabled={!activeSessionId || !result}
            size={isMobile ? 'small' : 'middle'}
            style={{ background: colors.primary, borderColor: colors.primary }}
          >
            {isMobile ? 'Invoice' : 'Create Invoice'}
          </Button>
          {onCreateEstimate && (
            <Button
              type="primary"
              onClick={onCreateEstimate}
              disabled={!result}
              size={isMobile ? 'small' : 'middle'}
              style={{ background: colors.primary, borderColor: colors.primary }}
            >
              {isMobile ? 'Estimate' : 'Create ScopeIt Estimate'}
            </Button>
          )}
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
              const address: string = d?.client_info?.property_address ?? '';
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

      {/* Report Export Modal */}
      {result && (
      <ReportExportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
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
    </Modal>
  );
};

export default EstimateEditorModal;
