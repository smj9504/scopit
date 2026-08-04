import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Modal,
  Button,
  Checkbox,
  Input,
  Upload,
  Slider,
  Divider,
  Space,
  Row,
  Col,
  Typography,
  message,
  Collapse,
  Tag,
  Tooltip,
  Switch,
  Radio,
} from 'antd';
import {
  CloseOutlined,
  FilePdfOutlined,
  UploadOutlined,
  DeleteOutlined,
  CameraOutlined,
  SendOutlined,
  WarningOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { packingApi } from './packingApi';
import type {
  EstimateResponse,
  ClientInfo,
  CompanyInfoOverride,
  PhotoRoom,
  PackingRoom,
  ReportSections,
  ReportRoomPhoto,
  ReportRoomData,
  DetectedContentItem,
} from './types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Interfaces ───────────────────────────────────────────────────────────────

interface ReportExportModalProps {
  open: boolean;
  onClose: () => void;
  result: EstimateResponse;
  mode: 'quick' | 'content' | 'packout';
  clientInfo: ClientInfo;
  companyOverride: CompanyInfoOverride;
  activeSessionId?: string;
  photoRooms?: PhotoRoom[];
  rooms?: PackingRoom[];
  onRequestSign?: (blob: Blob, filename: string) => void;
}

interface RoomPhotoState {
  room_name: string;
  photos: ReportRoomPhoto[];
  items: DetectedContentItem[];
  field_notes: string[];
  labor_hours: number;
  labor_notes: string;
  labor_source: 'calculated' | 'manual';
}

// ── Labor helpers ────────────────────────────────────────────────────────────

/** Sum estimated_labor_hours from detected items for a room */
function calcRoomLaborFromItems(items: DetectedContentItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.estimated_labor_hours != null && item.estimated_labor_hours > 0) {
      total += item.estimated_labor_hours;
    } else if (
      item.base_labor_hours != null &&
      item.per_unit_labor_hours != null
    ) {
      total += item.base_labor_hours + item.per_unit_labor_hours * item.quantity;
    }
  }
  return Math.round(total * 10) / 10;
}

/** Build labor notes from item characteristics */
function buildLaborNotes(items: DetectedContentItem[], roomName: string): string {
  const fragile = items.filter((i) => i.is_fragile).length;
  const highValue = items.filter((i) => i.is_high_value).length;
  const disassembly = items.filter((i) => i.needs_disassembly).length;
  const parts: string[] = [];
  if (items.length > 0) parts.push(`${items.length} items`);
  if (fragile > 0) parts.push(`${fragile} fragile`);
  if (highValue > 0) parts.push(`${highValue} high-value`);
  if (disassembly > 0) parts.push(`${disassembly} need disassembly`);
  return parts.length > 0 ? parts.join(', ') : '';
}

/**
 * Distribute total labor hours across rooms proportionally by item count.
 * Uses result.total_hours (the same value shown in the Estimate Editor
 * stats card) so the Report totals always match.
 */
function distributeEstimateLabor(
  result: EstimateResponse,
  roomNames: string[],
  roomItemCounts: number[],
): number[] {
  // Use the same total_hours that the Estimate Editor displays
  const totalLaborHrs = result.total_hours || 0;

  const totalItems = roomItemCounts.reduce((s, c) => s + c, 0);
  if (totalItems === 0 || totalLaborHrs === 0) {
    // Even distribution
    const perRoom = totalLaborHrs / Math.max(roomNames.length, 1);
    return roomNames.map(() => Math.round(perRoom * 10) / 10);
  }
  // Proportional distribution by item count
  return roomItemCounts.map(
    (cnt) => Math.round((cnt / totalItems) * totalLaborHrs * 10) / 10,
  );
}

/** Check if user manually edited labor lines in the EstimateEditor */
function detectLaborEdited(result: EstimateResponse): boolean {
  // Compare section totals: if section_details line amounts don't
  // match the section total, the user has edited
  const poLines = result.section_details?.['Pack-Out Labor']?.lines;
  const pbLines = result.section_details?.['Pack-Back Labor']?.lines;
  if (!poLines && !pbLines) return false;

  for (const [sectionName, lines] of [
    ['Pack-Out Labor', poLines],
    ['Pack-Back Labor', pbLines],
  ] as const) {
    if (!lines) continue;
    const lineTotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
    const sectionTotal = result.sections[sectionName] || 0;
    // If there's a significant difference, user edited
    if (Math.abs(lineTotal - sectionTotal) > 1) return true;
  }

  // Check if total_hours diverges significantly from section_details hours
  const allLines = [
    ...(poLines || []),
    ...(pbLines || []),
  ];
  const detailHrs = allLines.reduce((s, l) => s + (l.qty || 0), 0);
  // total_hours includes supervisor, inventory, debris etc. but if the
  // detail hours changed significantly relative to total, user likely edited
  if (detailHrs > 0 && result.total_hours > 0) {
    const ratio = detailHrs / result.total_hours;
    if (ratio < 0.5 || ratio > 2.0) return true;
  }

  return false;
}

/** Build aggregate labor notes from section_details lines */
function buildLaborNotesFromSections(result: EstimateResponse): string {
  const poLines = result.section_details?.['Pack-Out Labor']?.lines || [];
  const pbLines = result.section_details?.['Pack-Back Labor']?.lines || [];
  const parts = [...poLines, ...pbLines]
    .filter((l) => l.qty > 0)
    .map((l) => `${l.name}: ${l.qty} ${l.unit}`)
    .slice(0, 4);
  return parts.join(' | ');
}

// ── Component ────────────────────────────────────────────────────────────────

const ReportExportModal: React.FC<ReportExportModalProps> = ({
  open,
  onClose,
  result,
  mode,
  clientInfo,
  companyOverride,
  activeSessionId,
  photoRooms,
  rooms,
  onRequestSign,
}) => {
  // Section toggles
  const [sections, setSections] = useState<ReportSections>({
    inventory_list: true,
    damage_photos: false,
    labor_log: false,
    room_photos: true,
    estimate_summary: true,
  });

  // Detect if user manually edited labor in the estimate editor
  const laborWasEdited = useMemo(() => detectLaborEdited(result), [result]);

  // Per-room photo attachments — pre-populate with photos + labor data
  const initialRoomPhotos = useMemo((): RoomPhotoState[] => {
    if (mode === 'content' && photoRooms?.length) {
      // Photo AI mode: items have per-item labor data
      const roomStates = photoRooms.map((pr) => {
        const existingPhotos: ReportRoomPhoto[] = (pr.photos || []).map(
          (b64, idx) => ({
            image: b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`,
            caption: `${pr.room_name} - Photo ${idx + 1}`,
            is_damage: false,
          }),
        );
        const items = pr.items || [];
        const itemLabor = calcRoomLaborFromItems(items);
        return {
          room_name: pr.room_name,
          photos: existingPhotos,
          items,
          field_notes: pr.field_notes || [],
          labor_hours: itemLabor,
          labor_notes: buildLaborNotes(items, pr.room_name),
          labor_source: (laborWasEdited ? 'manual' : 'calculated') as 'calculated' | 'manual',
        };
      });

      // Always use result.total_hours as the authoritative total
      // and distribute proportionally so the sum matches the
      // Estimate Editor stats card exactly.
      if (!laborWasEdited) {
        const names = roomStates.map((r) => r.room_name);
        const counts = roomStates.map((r) => r.items.length);
        const distributed = distributeEstimateLabor(result, names, counts);
        const sectionNotes = buildLaborNotesFromSections(result);
        roomStates.forEach((r, i) => {
          r.labor_hours = distributed[i];
          if (!r.labor_notes) r.labor_notes = sectionNotes;
        });
      }

      return roomStates;
    }

    // Quick Estimate mode
    if (result.room_summaries?.length) {
      const roomNames = result.room_summaries.map((rs) => rs.room_name);
      const itemCounts = result.room_summaries.map((rs) => rs.item_count);
      const distributed = laborWasEdited
        ? roomNames.map(() => 0)
        : distributeEstimateLabor(result, roomNames, itemCounts);
      const sectionNotes = buildLaborNotesFromSections(result);

      return result.room_summaries.map((rs, i) => ({
        room_name: rs.room_name,
        photos: [],
        items: [],
        field_notes: rs.packing_notes || [],
        labor_hours: distributed[i],
        labor_notes: laborWasEdited ? '' : sectionNotes,
        labor_source: (laborWasEdited ? 'manual' : 'calculated') as 'calculated' | 'manual',
      }));
    }
    return [];
  }, [mode, photoRooms, result, laborWasEdited]);

  const [roomPhotos, setRoomPhotos] = useState<RoomPhotoState[]>(initialRoomPhotos);

  // Load photos from photo_keys when base64 photos are missing (e.g. after session reload)
  useEffect(() => {
    if (mode !== 'content' || !photoRooms?.length) return;
    let cancelled = false;

    const loadMissing = async () => {
      const updates: { index: number; photos: ReportRoomPhoto[] }[] = [];

      for (let i = 0; i < photoRooms.length; i++) {
        const pr = photoRooms[i];
        const current = roomPhotos[i];
        // Skip if already has photos or no photo_keys
        if (current?.photos?.length > 0) continue;
        const keys = pr.photo_keys ?? [];
        if (keys.length === 0) continue;

        try {
          const base64List = await Promise.all(
            keys.map((key) => packingApi.fetchPhotoBase64(key)),
          );
          const photos: ReportRoomPhoto[] = base64List
            .filter((b64) => b64 && b64.length > 100)
            .map((b64, idx) => ({
              image: `data:image/jpeg;base64,${b64}`,
              caption: `${pr.room_name} - Photo ${idx + 1}`,
              is_damage: false,
            }));
          if (photos.length > 0) {
            updates.push({ index: i, photos });
          }
        } catch {
          // photo load failed — leave empty
        }
      }

      if (!cancelled && updates.length > 0) {
        setRoomPhotos((prev) => {
          const next = [...prev];
          for (const u of updates) {
            if (next[u.index]) {
              next[u.index] = { ...next[u.index], photos: u.photos };
            }
          }
          return next;
        });
      }
    };

    loadMissing();
    return () => { cancelled = true; };
  }, [mode, photoRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Additional options
  const [notes, setNotes] = useState('');
  const [includeSignature, setIncludeSignature] = useState(false);
  const [includeFieldNotes, setIncludeFieldNotes] = useState(true);
  const [imageQuality, setImageQuality] = useState(60);
  const [photosPerPage, setPhotosPerPage] = useState<2 | 4>(2);
  const [exporting, setExporting] = useState(false);
  const [taxRate] = useState(0);

  // ── Photo management ───────────────────────────────────────────────────────

  const handleAddPhotos = useCallback(async (roomIndex: number, files: File[]) => {
    const newPhotos: ReportRoomPhoto[] = [];
    for (const file of files) {
      try {
        const b64 = await fileToBase64(file);
        newPhotos.push({
          image: b64,
          caption: '',
          is_damage: false,
        });
      } catch {
        // skip failed files
      }
    }

    setRoomPhotos((prev) => {
      const updated = [...prev];
      updated[roomIndex] = {
        ...updated[roomIndex],
        photos: [...updated[roomIndex].photos, ...newPhotos],
      };
      return updated;
    });
  }, []);

  const handleRemovePhoto = useCallback((roomIndex: number, photoIndex: number) => {
    setRoomPhotos((prev) => {
      const updated = [...prev];
      const photos = [...updated[roomIndex].photos];
      photos.splice(photoIndex, 1);
      updated[roomIndex] = { ...updated[roomIndex], photos };
      return updated;
    });
  }, []);

  const handleToggleDamage = useCallback((roomIndex: number, photoIndex: number) => {
    setRoomPhotos((prev) => {
      const updated = [...prev];
      const photos = [...updated[roomIndex].photos];
      photos[photoIndex] = {
        ...photos[photoIndex],
        is_damage: !photos[photoIndex].is_damage,
      };
      updated[roomIndex] = { ...updated[roomIndex], photos };
      return updated;
    });
  }, []);

  const handlePhotoCaption = useCallback(
    (roomIndex: number, photoIndex: number, caption: string) => {
      setRoomPhotos((prev) => {
        const updated = [...prev];
        const photos = [...updated[roomIndex].photos];
        photos[photoIndex] = { ...photos[photoIndex], caption };
        updated[roomIndex] = { ...updated[roomIndex], photos };
        return updated;
      });
    },
    [],
  );

  const handleLaborChange = useCallback(
    (roomIndex: number, field: 'labor_hours' | 'labor_notes', value: number | string) => {
      setRoomPhotos((prev) => {
        const updated = [...prev];
        updated[roomIndex] = { ...updated[roomIndex], [field]: value };
        return updated;
      });
    },
    [],
  );

  // ── Section toggle ─────────────────────────────────────────────────────────

  const toggleSection = useCallback((key: keyof ReportSections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async (forSign = false) => {
    if (!activeSessionId) {
      message.error('Save the session first');
      return;
    }

    setExporting(true);
    try {
      const roomsData: ReportRoomData[] = roomPhotos.map((rp) => ({
        room_name: rp.room_name,
        photos: rp.photos,
        items: rp.items.length > 0 ? rp.items : undefined,
        labor_hours: rp.labor_hours || undefined,
        labor_notes: rp.labor_notes || undefined,
        field_notes: rp.field_notes,
      }));

      const blob = await packingApi.exportReport({
        session_id: activeSessionId,
        sections,
        rooms: roomsData,
        company_override: companyOverride,
        tax_rate: taxRate,
        notes: notes || undefined,
        include_signature_page: includeSignature,
        include_field_notes: includeFieldNotes,
        image_quality: imageQuality,
        max_image_width: 800,
        photos_per_page: photosPerPage,
      });

      const addr = clientInfo.property_address?.trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ');
      const hasPackback = result.include_packback ?? false;
      const reportLabel = hasPackback ? 'Content Pack-Out Pack-Back Report' : 'Content Pack-Out Report';
      const filename = addr
        ? `${reportLabel} - ${addr}.pdf`
        : `${reportLabel}-${activeSessionId.slice(0, 8)}.pdf`;

      if (forSign && onRequestSign) {
        onRequestSign(blob, filename);
        message.success('Report generated — ready for signature');
      } else {
        triggerDownload(blob, filename);
        message.success('Report downloaded');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Report export failed');
    } finally {
      setExporting(false);
    }
  }, [
    activeSessionId, sections, roomPhotos, companyOverride,
    taxRate, notes, includeSignature, imageQuality, photosPerPage, onRequestSign,
  ]);

  // ── Total photo count ──────────────────────────────────────────────────────

  const totalPhotos = useMemo(
    () => roomPhotos.reduce((sum, rp) => sum + rp.photos.length, 0),
    [roomPhotos],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      style={{ top: 40 }}
      styles={{
        body: {
          padding: 0,
          maxHeight: 'calc(90vh - 80px)',
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
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          flexShrink: 0,
        }}
      >
        <Title
          level={5}
          style={{
            margin: 0,
            fontFamily: fonts.heading,
            color: colors.textPrimary,
            fontWeight: 700,
          }}
        >
          Generate Report
        </Title>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: colors.textSecondary }}
        />
      </div>

      {/* Scrollable Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 24px',
          background: colors.bgLight,
        }}
      >
        {/* Section Toggles */}
        <div style={{ marginBottom: 20 }}>
          <Text
            strong
            style={{
              fontSize: 13,
              fontFamily: fonts.heading,
              color: colors.textPrimary,
              display: 'block',
              marginBottom: 10,
            }}
          >
            Report Sections
          </Text>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: colors.bgWhite,
              padding: '12px 16px',
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
            }}
          >
            <Checkbox
              checked={sections.estimate_summary}
              onChange={() => toggleSection('estimate_summary')}
            >
              <Text style={{ fontSize: 13 }}>Estimate Summary</Text>
            </Checkbox>
            <Checkbox
              checked={sections.inventory_list}
              onChange={() => toggleSection('inventory_list')}
            >
              <Text style={{ fontSize: 13 }}>Inventory List (per room)</Text>
            </Checkbox>
            <Checkbox
              checked={sections.room_photos}
              onChange={() => toggleSection('room_photos')}
            >
              <Text style={{ fontSize: 13 }}>Room Photos</Text>
            </Checkbox>
            <Checkbox
              checked={sections.damage_photos}
              onChange={() => toggleSection('damage_photos')}
            >
              <Text style={{ fontSize: 13 }}>Pre-Existing Damage Photos</Text>
            </Checkbox>
            <Checkbox
              checked={sections.labor_log}
              onChange={() => toggleSection('labor_log')}
            >
              <Text style={{ fontSize: 13 }}>Labor Log</Text>
            </Checkbox>
          </div>
        </div>

        {/* Warning: labor was manually edited */}
        {sections.labor_log && laborWasEdited && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: borderRadius.base,
              marginTop: 10,
            }}
          >
            <WarningOutlined style={{ color: '#faad14', fontSize: 14, marginTop: 2 }} />
            <div>
              <Text style={{ fontSize: 12, fontWeight: 600, color: '#ad6800' }}>
                Labor hours were manually edited in the Estimate Editor
              </Text>
              <br />
              <Text style={{ fontSize: 11, color: '#ad6800' }}>
                The original calculated values may no longer match. Please review and
                enter the labor hours per room manually below.
              </Text>
            </div>
          </div>
        )}

        {/* Labor totals summary (when labor log enabled) */}
        {sections.labor_log && !laborWasEdited && roomPhotos.length > 0 && (
          <div
            style={{
              padding: '8px 12px',
              background: colors.bgWhite,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.base,
              marginTop: 10,
            }}
          >
            <Row justify="space-between" align="middle">
              <Col>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  Total Labor: <strong>{roomPhotos.reduce((s, r) => s + r.labor_hours, 0).toFixed(1)} hrs</strong>
                  {' '}across {roomPhotos.length} room{roomPhotos.length !== 1 ? 's' : ''}
                </Text>
              </Col>
              <Col>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>
                  Crew: {result.crew_size}
                </Text>
              </Col>
            </Row>
          </div>
        )}

        <Divider style={{ margin: '8px 0 16px' }} />

        {/* Per-Room Photo Upload */}
        {(sections.room_photos || sections.damage_photos) && roomPhotos.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <Text
                strong
                style={{
                  fontSize: 13,
                  fontFamily: fonts.heading,
                  color: colors.textPrimary,
                }}
              >
                Room Photos
              </Text>
              {totalPhotos > 0 && (
                <Tag style={{ fontSize: 11 }}>
                  {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}
                </Tag>
              )}
            </div>

            <Collapse
              bordered={false}
              style={{ background: 'transparent' }}
              size="small"
            >
              {roomPhotos.map((rp, roomIdx) => (
                <Panel
                  key={rp.room_name}
                  header={
                    <Row justify="space-between" align="middle" style={{ width: '100%' }}>
                      <Col>
                        <Text strong style={{ fontSize: 13, fontFamily: fonts.body }}>
                          {rp.room_name}
                        </Text>
                      </Col>
                      <Col>
                        <Space size={6}>
                          {rp.photos.length > 0 && (
                            <Tag style={{ fontSize: 11 }}>
                              {rp.photos.length} photo{rp.photos.length !== 1 ? 's' : ''}
                            </Tag>
                          )}
                          {rp.items.length > 0 && (
                            <Tag style={{ fontSize: 11 }}>
                              {rp.items.length} items
                            </Tag>
                          )}
                        </Space>
                      </Col>
                    </Row>
                  }
                  style={{
                    marginBottom: 6,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.base,
                    background: colors.bgWhite,
                  }}
                >
                  {/* Photo upload area */}
                  <Upload.Dragger
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    showUploadList={false}
                    beforeUpload={(_, fileList) => {
                      handleAddPhotos(roomIdx, fileList as unknown as File[]);
                      return false;
                    }}
                    style={{
                      padding: '8px 12px',
                      border: `1px dashed ${colors.border}`,
                      background: colors.bgLight,
                      marginBottom: rp.photos.length > 0 ? 12 : 0,
                    }}
                  >
                    <Space>
                      <CameraOutlined style={{ color: colors.textMuted }} />
                      <Text style={{ fontSize: 12, color: colors.textMuted }}>
                        Drop photos or click to upload
                      </Text>
                    </Space>
                  </Upload.Dragger>

                  {/* Photo grid */}
                  {rp.photos.length > 0 && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: 8,
                      }}
                    >
                      {rp.photos.map((photo, photoIdx) => (
                        <div
                          key={photoIdx}
                          style={{
                            border: `1px solid ${photo.is_damage ? '#faad14' : colors.border}`,
                            borderRadius: borderRadius.base,
                            overflow: 'hidden',
                            background: colors.bgWhite,
                          }}
                        >
                          <div style={{ position: 'relative' }}>
                            <img
                              src={photo.image}
                              alt={photo.caption || `Photo ${photoIdx + 1}`}
                              style={{
                                width: '100%',
                                height: 100,
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                            <div
                              style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                                display: 'flex',
                                gap: 4,
                              }}
                            >
                              <Tooltip title="Remove">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={() => handleRemovePhoto(roomIdx, photoIdx)}
                                  style={{
                                    background: 'rgba(0,0,0,0.5)',
                                    color: '#fff',
                                    border: 'none',
                                    width: 22,
                                    height: 22,
                                    minWidth: 22,
                                  }}
                                />
                              </Tooltip>
                            </div>
                            {photo.is_damage && (
                              <Tag
                                color="warning"
                                style={{
                                  position: 'absolute',
                                  bottom: 4,
                                  left: 4,
                                  fontSize: 10,
                                  lineHeight: '16px',
                                  padding: '0 4px',
                                }}
                              >
                                Damage
                              </Tag>
                            )}
                          </div>
                          <div style={{ padding: '4px 6px' }}>
                            <Input
                              size="small"
                              placeholder="Caption"
                              value={photo.caption || ''}
                              onChange={(e) =>
                                handlePhotoCaption(roomIdx, photoIdx, e.target.value)
                              }
                              style={{ fontSize: 11, marginBottom: 4 }}
                            />
                            <Checkbox
                              checked={photo.is_damage}
                              onChange={() => handleToggleDamage(roomIdx, photoIdx)}
                            >
                              <Text style={{ fontSize: 11 }}>Damage</Text>
                            </Checkbox>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Labor log fields (when enabled) */}
                  {sections.labor_log && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 10px',
                        background: '#fafafa',
                        borderRadius: borderRadius.base,
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textSecondary,
                          }}
                        >
                          Labor
                        </Text>
                        {rp.labor_hours > 0 && rp.labor_source === 'calculated' && (
                          <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                            Auto-calculated
                          </Tag>
                        )}
                        {rp.labor_source === 'manual' && (
                          <Tag
                            icon={<EditOutlined />}
                            style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                          >
                            Manual
                          </Tag>
                        )}
                      </div>
                      <Row gutter={8}>
                        <Col span={8}>
                          <Input
                            size="small"
                            type="number"
                            placeholder="Hours"
                            value={rp.labor_hours || ''}
                            onChange={(e) =>
                              handleLaborChange(
                                roomIdx,
                                'labor_hours',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            suffix="hrs"
                            style={{ fontSize: 12 }}
                          />
                        </Col>
                        <Col span={16}>
                          <Input
                            size="small"
                            placeholder="Labor notes"
                            value={rp.labor_notes}
                            onChange={(e) =>
                              handleLaborChange(roomIdx, 'labor_notes', e.target.value)
                            }
                            style={{ fontSize: 12 }}
                          />
                        </Col>
                      </Row>
                    </div>
                  )}
                </Panel>
              ))}
            </Collapse>
          </div>
        )}

        <Divider style={{ margin: '8px 0 16px' }} />

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <Text
            strong
            style={{
              fontSize: 13,
              fontFamily: fonts.heading,
              color: colors.textPrimary,
              display: 'block',
              marginBottom: 6,
            }}
          >
            Additional Notes
          </Text>
          <TextArea
            rows={3}
            placeholder="Optional notes to include in the report..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ fontSize: 13, borderColor: colors.border }}
          />
        </div>

        {/* Options */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: colors.bgWhite,
            padding: '12px 16px',
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
          }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Text style={{ fontSize: 13 }}>Include Field Notes</Text>
            </Col>
            <Col>
              <Switch
                size="small"
                checked={includeFieldNotes}
                onChange={setIncludeFieldNotes}
              />
            </Col>
          </Row>

          <Row justify="space-between" align="middle">
            <Col>
              <Text style={{ fontSize: 13 }}>Include Signature Page</Text>
            </Col>
            <Col>
              <Switch
                size="small"
                checked={includeSignature}
                onChange={setIncludeSignature}
              />
            </Col>
          </Row>

          <Row justify="space-between" align="middle">
            <Col flex="1">
              <Text style={{ fontSize: 13 }}>
                Image Quality
                <Text style={{ fontSize: 11, color: colors.textMuted, marginLeft: 6 }}>
                  (lower = smaller file)
                </Text>
              </Text>
            </Col>
            <Col style={{ width: 160 }}>
              <Slider
                min={20}
                max={90}
                step={10}
                value={imageQuality}
                onChange={setImageQuality}
                marks={{ 20: '20', 60: '60', 90: '90' }}
                style={{ margin: '0 8px 12px' }}
              />
            </Col>
          </Row>

          <Row justify="space-between" align="middle">
            <Col>
              <Text style={{ fontSize: 13 }}>Photos per Row</Text>
            </Col>
            <Col>
              <Radio.Group
                size="small"
                value={photosPerPage}
                onChange={(e) => setPhotosPerPage(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value={2}>2</Radio.Button>
                <Radio.Button value={4}>4</Radio.Button>
              </Radio.Group>
            </Col>
          </Row>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          flexShrink: 0,
        }}
      >
        {onRequestSign && (
          <Tooltip title="Generate report and send for e-signature">
            <Button
              icon={<SendOutlined />}
              onClick={() => handleExport(true)}
              loading={exporting}
              disabled={!activeSessionId}
              style={{ borderColor: colors.border }}
            >
              Send for Signature
            </Button>
          </Tooltip>
        )}
        <Button
          type="primary"
          icon={<FilePdfOutlined />}
          onClick={() => handleExport(false)}
          loading={exporting}
          disabled={!activeSessionId}
          style={{
            background: colors.primary,
            borderColor: colors.primary,
          }}
        >
          Download Report
        </Button>
      </div>
    </Modal>
  );
};

export default ReportExportModal;
