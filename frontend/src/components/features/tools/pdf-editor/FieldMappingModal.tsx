/**
 * Scopit - Field Mapping Modal
 *
 * The reusable-template editor: place fields on a document, then configure
 * each field's type, data binding (auto-fill / signer fills in / sender
 * fills in before sending), signer role, and required flag. Saved fields
 * become the document's field_definitions template (FR-2), copied into
 * every future sign request created against this document.
 *
 * Renders as a full-screen takeover (not a constrained dialog) so the
 * document page has real room to place and adjust fields precisely --
 * mirrors the full-screen "editor mode" pattern already used by
 * PdfEditorTool for the same reason.
 *
 * The state/handlers (useFieldEditorState) and the toolbar+canvas+properties
 * body (FieldEditorBody) are exported so SendForSignModal can host the exact
 * same field editor inline (its own full-screen sub-mode) instead of routing
 * away to this component -- both call sites share one implementation.
 *
 * Usage:
 *   <FieldMappingModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     documentId={doc.id}
 *     documentName={doc.name}
 *     pageCount={doc.pageCount}
 *     initialFields={doc.fieldDefinitions}
 *     onSaved={(doc) => ...}
 *   />
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, Button, Input, Select, AutoComplete, Checkbox, Typography, App, Empty } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, DeleteOutlined, ReloadOutlined, WarningOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import './pdfWorker';
import FieldPlacementCanvas from './FieldPlacementCanvas';
import { pdfEditorApi } from './pdfEditorApi';
import type { FieldDefinition, FieldType, DataBindingMode, AvailableField } from './types';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

const { Text, Title } = Typography;

// Generic, ordinal slots -- not semantic names (homeowner, company_rep, ...).
// Signer role only needs to distinguish "whose field is this" *within one
// template*; which real person that is gets decided later, per envelope, in
// Send for Signature (recipient email against "Signer 1", "Signer 2", ...).
// That keeps this list universal and needs no per-company management UI.
const SIGNER_ROLES: { value: string; label: string }[] = [
  { value: 'signer_1', label: 'Signer 1' },
  { value: 'signer_2', label: 'Signer 2' },
  { value: 'signer_3', label: 'Signer 3' },
  { value: 'signer_4', label: 'Signer 4' },
];

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'signature', label: 'Signature' },
  { value: 'initials', label: 'Initials' },
];

// Default size as a fraction of page width/height, keyed by type. Matches
// Adobe Acrobat's form-field convention: every same-purpose field shares one
// height (0.035 for single-line data fields, a taller 0.06 for signature-like
// fields) so fields line up with each other regardless of type -- only width
// varies with expected content length. Checkbox keeps the data-field height
// but a near-square width (0.035 scaled by a Letter page's height/width
// ratio, ~1.294) instead of a smaller, disproportionate box.
const TYPE_DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  text: { width: 0.22, height: 0.035 },
  date: { width: 0.14, height: 0.035 },
  number: { width: 0.12, height: 0.035 },
  checkbox: { width: 0.045, height: 0.035 },
  signature: { width: 0.22, height: 0.06 },
  initials: { width: 0.08, height: 0.06 },
};

// Matches Adobe Acrobat's form-field "Font size" dropdown: Auto (fit to the
// field's height) plus a fixed set of point sizes.
const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];

const MODE_OPTIONS: { value: DataBindingMode; label: string; hint: string }[] = [
  { value: 'prefilled', label: 'Auto-fill from data', hint: 'Filled automatically from the Customer/Company record when a document is created.' },
  { value: 'signer_input', label: 'Signer fills in', hint: 'Left blank until the assigned signer fills it in while signing.' },
  { value: 'creator_input', label: 'I fill in before sending', hint: 'You fill this in yourself, right before sending.' },
];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

let keyCounter = 1;
function nextKey(type: string) {
  return `${type}_${keyCounter++}`;
}

// ── Shared field-editing state/logic ─────────────────────────────────────────
// Used by both this modal and SendForSignModal's inline "Edit Fields" mode.

export function validateFieldsForSave(fields: FieldDefinition[]): string | null {
  const missingSource = fields.filter((f) => f.dataBinding.mode === 'prefilled' && !f.dataBinding.sourceField);
  if (missingSource.length > 0) {
    return `Choose a data source for: ${missingSource.map((f) => f.label).join(', ')}`;
  }
  const missingRole = fields.filter(
    (f) => (f.dataBinding.mode === 'signer_input' || f.type === 'signature' || f.type === 'initials') && !f.signerRole,
  );
  if (missingRole.length > 0) {
    return `Set a signer role for: ${missingRole.map((f) => f.label).join(', ')}`;
  }
  return null;
}

/** Fetches the Customer/Company field registry once, when the editor is active. */
export function useAvailableFields(active: boolean): AvailableField[] {
  const [availableFields, setAvailableFields] = useState<AvailableField[]>([]);
  useEffect(() => {
    if (!active) return;
    pdfEditorApi.getAvailableFields().then(setAvailableFields).catch(() => setAvailableFields([]));
  }, [active]);
  return availableFields;
}

/** Owns the field list + selection + placement-mode + dirty flag, and every
 * CRUD handler for editing it. `resetToken` re-seeds from `initialFields`
 * (e.g. a new documentId, or re-entering edit mode) whenever it changes
 * while `active` is true. */
export function useFieldEditorState(initialFields: FieldDefinition[], active: boolean, resetToken: string) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<FieldType | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!active) return;
    setFields(initialFields.map((f) => ({ ...f })));
    setSelectedKey(null);
    setActiveType(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, resetToken]);

  const handlePlaceField = useCallback((page: number, x: number, y: number) => {
    if (!activeType) return;
    const size = TYPE_DEFAULT_SIZE[activeType] ?? TYPE_DEFAULT_SIZE.text;
    const isSignatureLike = activeType === 'signature' || activeType === 'initials';
    const key = nextKey(activeType);
    // Every signature/initials field needs a role -- default to the next
    // open slot so placing one is usually zero-click instead of a forced
    // Select visit; the user can still change it in the properties panel.
    const usedRoles = new Set(fields.map((f) => f.signerRole).filter(Boolean));
    const suggestedRole = isSignatureLike
      ? SIGNER_ROLES.find((r) => !usedRoles.has(r.value))?.value ?? null
      : null;
    const newField: FieldDefinition = {
      key,
      label: FIELD_TYPES.find((t) => t.value === activeType)?.label ?? activeType,
      type: activeType,
      page,
      x: Math.max(0, Math.min(1 - size.width, x)),
      y: Math.max(0, Math.min(1 - size.height, y)),
      width: size.width,
      height: size.height,
      dataBinding: isSignatureLike
        ? { mode: 'signer_input', sourceEntity: null, sourceField: null }
        : { mode: 'creator_input', sourceEntity: null, sourceField: null },
      signerRole: suggestedRole,
      required: isSignatureLike,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedKey(key);
    setDirty(true);
    // Exit placement mode after creating one field, so a stray click
    // doesn't immediately place another on top of it.
    setActiveType(null);
  }, [activeType, fields]);

  const updateSelected = useCallback((patch: Partial<FieldDefinition>) => {
    setFields((prev) => prev.map((f) => (f.key === selectedKey ? { ...f, ...patch } : f)));
    setDirty(true);
  }, [selectedKey]);

  const handleMoveField = useCallback((key: string, x: number, y: number) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, x, y } : f)));
    setDirty(true);
  }, []);

  const handleResizeField = useCallback((key: string, width: number, height: number) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, width, height } : f)));
    setDirty(true);
  }, []);

  const handleRemoveField = useCallback((key: string) => {
    setFields((prev) => prev.filter((f) => f.key !== key));
    setSelectedKey((prev) => (prev === key ? null : prev));
    setDirty(true);
  }, []);

  return {
    fields, setFields,
    selectedKey, setSelectedKey,
    activeType, setActiveType,
    dirty, setDirty,
    handlePlaceField, updateSelected, handleMoveField, handleResizeField, handleRemoveField,
  };
}

// ── Editor Body (type toolbar + canvas + properties panel) ──────────────────

export interface FieldEditorBodyProps {
  fields: FieldDefinition[];
  selectedKey: string | null;
  onSelectField: (key: string | null) => void;
  activeType: FieldType | null;
  onActiveTypeChange: (type: FieldType | null) => void;
  onPlaceField: (page: number, x: number, y: number) => void;
  onMoveField: (key: string, x: number, y: number) => void;
  onResizeField: (key: string, width: number, height: number) => void;
  onRemoveField: (key: string) => void;
  onFieldChange: (patch: Partial<FieldDefinition>) => void;
  availableFields: AvailableField[];
  pdfDoc: PDFDocumentProxy | null;
  pageCount: number;
  pdfLoadError: string | null;
  onReloadPdf: () => void;
  isMobile: boolean;
}

export function FieldEditorBody({
  fields,
  selectedKey,
  onSelectField,
  activeType,
  onActiveTypeChange,
  onPlaceField,
  onMoveField,
  onResizeField,
  onRemoveField,
  onFieldChange,
  availableFields,
  pdfDoc,
  pageCount,
  pdfLoadError,
  onReloadPdf,
  isMobile,
}: FieldEditorBodyProps) {
  const [zoom, setZoom] = useState(1);
  const selectedField = fields.find((f) => f.key === selectedKey) ?? null;

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  }, []);
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Left: type toolbar + canvas */}
      <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: isMobile ? '8px 12px' : '10px 24px',
            background: colors.bgWhite, borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body, marginRight: 4 }}>
            Place:
          </Text>
          {FIELD_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => onActiveTypeChange(t.value)}
              style={{
                padding: '5px 11px',
                border: activeType === t.value ? `2px solid ${colors.primary}` : `1.5px solid ${colors.border}`,
                borderRadius: borderRadius.base,
                background: activeType === t.value ? colors.primary : colors.bgWhite,
                color: activeType === t.value ? '#fff' : colors.textPrimary,
                fontSize: fontSizes.xs,
                fontFamily: fonts.body,
                fontWeight: activeType === t.value ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isMobile && (
              <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body, whiteSpace: 'nowrap' }}>
                {activeType ? 'Click the page to place' : 'Select a field type to place'}
              </Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} role="group" aria-label="Zoom controls">
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                onClick={handleZoomOut}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                style={{ color: colors.textSecondary }}
              />
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Reset zoom to 100%"
                aria-label={`Current zoom: ${Math.round(zoom * 100)}%. Click to reset to 100%.`}
                style={{
                  minWidth: 42, padding: '2px 4px', border: 'none', background: 'transparent',
                  fontSize: fontSizes.xs, fontFamily: fonts.body, color: colors.textPrimary,
                  fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleZoomIn}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                style={{ color: colors.textSecondary }}
              />
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: isMobile ? 360 : 0, overflow: 'hidden', background: colors.border, padding: isMobile ? 12 : '24px 28px' }}>
          {pdfLoadError ? (
            <div
              style={{
                height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 12, textAlign: 'center', padding: 24,
              }}
            >
              <WarningOutlined style={{ fontSize: 28, color: colors.error }} />
              <Text style={{ fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, maxWidth: 360 }}>
                {pdfLoadError}
              </Text>
              <Button icon={<ReloadOutlined />} onClick={onReloadPdf}>
                Try Again
              </Button>
            </div>
          ) : (
            <FieldPlacementCanvas
              pdfDoc={pdfDoc}
              pageCount={pageCount}
              fields={fields}
              selectedKey={selectedKey}
              onPlaceField={activeType ? onPlaceField : undefined}
              onSelectField={onSelectField}
              onMoveField={onMoveField}
              onResizeField={onResizeField}
              onRemoveField={onRemoveField}
              maxHeight="100%"
              zoom={zoom}
            />
          )}
        </div>
      </div>

      {/* Right: field properties panel */}
      <div
        style={{
          flex: isMobile ? '0 0 auto' : '0 0 360px',
          width: isMobile ? '100%' : undefined,
          maxHeight: isMobile ? 320 : undefined,
          borderLeft: isMobile ? 'none' : `1px solid ${colors.border}`,
          borderTop: isMobile ? `1px solid ${colors.border}` : 'none',
          overflowY: 'auto',
          background: colors.bgWhite,
          padding: '20px 24px',
        }}
      >
        <Text
          style={{
            display: 'block', fontSize: fontSizes.xs, fontWeight: 600, color: colors.textSecondary,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, fontFamily: fonts.body,
          }}
        >
          Field Properties
        </Text>

        {!selectedField ? (
          <Empty
            description={
              <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontFamily: fonts.body }}>
                {fields.length === 0
                  ? 'Click a field type above, then click the page to place it.'
                  : 'Select a field to edit its properties.'}
              </Text>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 40 }}
          />
        ) : (
          <FieldPropertiesForm
            key={selectedField.key}
            field={selectedField}
            availableFields={availableFields}
            onChange={onFieldChange}
            onRemove={() => onRemoveField(selectedField.key)}
          />
        )}
      </div>
    </div>
  );
}

// ── Standalone full-screen modal (Define Fields, opened outside a sign flow) ─

export interface FieldMappingModalProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
  pageCount: number;
  initialFields: FieldDefinition[];
  onSaved?: (fields: FieldDefinition[]) => void;
}

export default function FieldMappingModal({
  open,
  onClose,
  documentId,
  documentName,
  pageCount,
  initialFields,
  onSaved,
}: FieldMappingModalProps) {
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pdfReloadTick, setPdfReloadTick] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    onChange(mql);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const {
    fields, selectedKey, setSelectedKey, activeType, setActiveType, dirty, setDirty,
    handlePlaceField, updateSelected, handleMoveField, handleResizeField, handleRemoveField,
  } = useFieldEditorState(initialFields, open, documentId);
  const availableFields = useAvailableFields(open);

  useEffect(() => {
    if (!open || !documentId) {
      if (pdfDoc) { pdfDoc.destroy(); setPdfDoc(null); }
      return;
    }
    let cancelled = false;
    const load = async () => {
      setPdfLoadError(null);
      try {
        const token = useAuthStore.getState().accessToken;
        const apiBase = import.meta.env.VITE_API_URL || '/api';
        const url = `${apiBase}/tools/pdf-editor/documents/${documentId}/download`;
        const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) {
          if (cancelled) return;
          setPdfLoadError(
            response.status === 401
              ? 'Your session expired. Please refresh the page and try again.'
              : response.status === 404
                ? "This document's file couldn't be found."
                : `Couldn't load the document (server returned ${response.status}).`,
          );
          return;
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) { pdf.destroy(); return; }
        setPdfDoc(pdf);
      } catch (err) {
        console.error('FieldMappingModal: failed to load PDF for field mapping', err);
        if (!cancelled) setPdfLoadError("Couldn't load the document. Check your connection and try again.");
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId, pdfReloadTick]);

  const handleSave = async () => {
    const error = validateFieldsForSave(fields);
    if (error) {
      message.error(error);
      return;
    }
    setSaving(true);
    try {
      const doc = await pdfEditorApi.saveFieldDefinitions(documentId, fields);
      message.success('Field mapping saved');
      setDirty(false);
      onSaved?.(doc.fieldDefinitions);
      onClose();
    } catch {
      message.error('Failed to save field mapping. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAttemptClose = useCallback(() => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: 'Discard unsaved fields?',
      content: "Your field placements and settings for this template haven't been saved.",
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep Editing',
      onOk: onClose,
    });
  }, [saving, dirty, onClose, modal]);

  return (
    <Modal
      open={open}
      onCancel={handleAttemptClose}
      footer={null}
      closable={false}
      maskClosable={false}
      width="100vw"
      style={{ top: 0, paddingBottom: 0, margin: 0, maxWidth: '100vw' }}
      styles={{
        content: { padding: 0, borderRadius: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        body: { flex: 1, minHeight: 0, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: fonts.body }}>
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            padding: isMobile ? '10px 12px' : '12px 24px',
            borderBottom: `1px solid ${colors.border}`, background: colors.bgWhite,
          }}
        >
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={handleAttemptClose}
            disabled={saving}
            style={{ color: colors.textSecondary, flexShrink: 0 }}
          >
            {!isMobile && 'Cancel'}
          </Button>

          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: fontSizes.md, color: colors.textPrimary, lineHeight: 1.3 }}>
              Define Fields
            </Title>
            <Text ellipsis style={{ display: 'block', fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body }}>
              {documentName}
            </Text>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            {!isMobile && (
              <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body, whiteSpace: 'nowrap' }}>
                {fields.length} field{fields.length !== 1 ? 's' : ''} defined
              </Text>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              style={{ background: colors.primary, borderColor: colors.primary }}
            >
              {isMobile ? 'Save' : 'Save Template'}
            </Button>
          </div>
        </div>

        <FieldEditorBody
          fields={fields}
          selectedKey={selectedKey}
          onSelectField={setSelectedKey}
          activeType={activeType}
          onActiveTypeChange={setActiveType}
          onPlaceField={handlePlaceField}
          onMoveField={handleMoveField}
          onResizeField={handleResizeField}
          onRemoveField={handleRemoveField}
          onFieldChange={updateSelected}
          availableFields={availableFields}
          pdfDoc={pdfDoc}
          pageCount={pageCount}
          pdfLoadError={pdfLoadError}
          onReloadPdf={() => setPdfReloadTick((t) => t + 1)}
          isMobile={isMobile}
        />
      </div>
    </Modal>
  );
}

// ── Field Properties Form ──────────────────────────────────────────────────────

interface FieldPropertiesFormProps {
  field: FieldDefinition;
  availableFields: AvailableField[];
  onChange: (patch: Partial<FieldDefinition>) => void;
  onRemove: () => void;
}

function FieldPropertiesForm({ field, availableFields, onChange, onRemove }: FieldPropertiesFormProps) {
  const isSignatureLike = field.type === 'signature' || field.type === 'initials';
  const needsRole = isSignatureLike || field.dataBinding.mode === 'signer_input';

  const sourceValue = field.dataBinding.sourceEntity && field.dataBinding.sourceField
    ? `${field.dataBinding.sourceEntity}:${field.dataBinding.sourceField}`
    : undefined;

  const groupedSourceOptions = useMemo(() => {
    const byEntity = new Map<string, AvailableField[]>();
    for (const f of availableFields) {
      if (!byEntity.has(f.sourceEntity)) byEntity.set(f.sourceEntity, []);
      byEntity.get(f.sourceEntity)!.push(f);
    }
    return Array.from(byEntity.entries()).map(([entity, items]) => ({
      label: entity.charAt(0).toUpperCase() + entity.slice(1),
      options: items.map((f) => ({ value: `${f.sourceEntity}:${f.sourceField}`, label: f.label })),
    }));
  }, [availableFields]);

  // Picking a suggestion here (vs. just typing) means "this field's value IS
  // that Customer/Company field" -- so it also wires up the prefill binding,
  // instead of making the user separately repeat the same choice below.
  // Reuses groupedSourceOptions (same "entity:field" values, grouped by
  // entity) rather than a flat list of labels: Customer and Company share
  // several field names verbatim (Address Line 1, City, ...), so a flat list
  // would show visually identical rows there's no way to tell apart -- and
  // whichever one happened to match first would silently win.
  const handleLabelSelect = (value: string) => {
    const [sourceEntity, sourceField] = value.split(':');
    const match = availableFields.find((f) => f.sourceEntity === sourceEntity && f.sourceField === sourceField);
    if (!match) return;
    onChange({ label: match.label, dataBinding: { mode: 'prefilled', sourceEntity: sourceEntity as any, sourceField } });
  };
  // Only treat typed text as a plain label edit -- a composite "entity:field"
  // value here means onSelect above already applied the real patch.
  const handleLabelChange = (value: string) => {
    const isKnownSource = availableFields.some((f) => `${f.sourceEntity}:${f.sourceField}` === value);
    if (isKnownSource) return;
    onChange({ label: value });
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: fontSizes.xs, fontWeight: 500, color: colors.textPrimary,
    fontFamily: fonts.body, marginBottom: 4,
  };
  const fieldWrap: React.CSSProperties = { marginBottom: 16 };

  return (
    <div>
      <div style={fieldWrap}>
        <label style={labelStyle}>Label</label>
        {isSignatureLike ? (
          <Input
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            style={{ fontFamily: fonts.body }}
          />
        ) : (
          <>
            <AutoComplete
              value={field.label}
              options={groupedSourceOptions}
              onChange={handleLabelChange}
              onSelect={handleLabelSelect}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
              placeholder="Type a label, or pick a Customer/Company field"
              style={{ width: '100%', fontFamily: fonts.body }}
            />
            <Text style={{ display: 'block', fontSize: 11, color: colors.textMuted, fontFamily: fonts.body, marginTop: 4 }}>
              Picking a suggestion auto-fills this field from that record instead of typing a plain label.
            </Text>
          </>
        )}
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Type</label>
        <Select
          value={field.type}
          onChange={(type) => onChange({
            type,
            // Signature/initials can only be signer_input -- force it so
            // the model can never represent an invalid combination.
            dataBinding: type === 'signature' || type === 'initials'
              ? { mode: 'signer_input', sourceEntity: null, sourceField: null }
              : field.dataBinding,
          })}
          style={{ width: '100%' }}
          options={FIELD_TYPES}
        />
      </div>

      {!isSignatureLike && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Data source</label>
          <Select
            value={field.dataBinding.mode}
            onChange={(mode: DataBindingMode) => onChange({
              dataBinding: { mode, sourceEntity: null, sourceField: null },
              signerRole: mode === 'signer_input' ? field.signerRole : null,
            })}
            style={{ width: '100%' }}
            options={MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Text style={{ display: 'block', fontSize: 11, color: colors.textMuted, fontFamily: fonts.body, marginTop: 4 }}>
            {MODE_OPTIONS.find((o) => o.value === field.dataBinding.mode)?.hint}
          </Text>
        </div>
      )}

      {field.dataBinding.mode === 'prefilled' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Auto-fill from</label>
          <Select
            value={sourceValue}
            placeholder="Choose a source field..."
            onChange={(value: string) => {
              const [sourceEntity, sourceField] = value.split(':');
              onChange({ dataBinding: { mode: 'prefilled', sourceEntity: sourceEntity as any, sourceField } });
            }}
            style={{ width: '100%' }}
            options={groupedSourceOptions}
            showSearch
            filterOption={(input, option) =>
              (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
      )}

      {needsRole && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Signer role</label>
          <Select
            value={field.signerRole ?? undefined}
            onChange={(value) => onChange({ signerRole: value ?? null })}
            options={SIGNER_ROLES}
            placeholder="Select a signer role"
            allowClear
            style={{ width: '100%' }}
          />
          <Text style={{ display: 'block', fontSize: 11, color: colors.textMuted, fontFamily: fonts.body, marginTop: 4 }}>
            Only the recipient assigned this role can fill this field.
          </Text>
        </div>
      )}

      {!isSignatureLike && field.type !== 'checkbox' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Font size</label>
          <Select
            value={field.fontSize ?? 'auto'}
            onChange={(value) => onChange({ fontSize: value === 'auto' ? undefined : Number(value) })}
            style={{ width: '100%' }}
            options={[
              { value: 'auto', label: 'Auto (fits the field)' },
              ...FONT_SIZE_OPTIONS.map((size) => ({ value: size, label: `${size} pt` })),
            ]}
          />
        </div>
      )}

      <div style={fieldWrap}>
        <Checkbox checked={field.required} onChange={(e) => onChange({ required: e.target.checked })}>
          <Text style={{ fontSize: fontSizes.xs, fontFamily: fonts.body, color: colors.textPrimary }}>Required</Text>
        </Checkbox>
      </div>

      <Button danger block icon={<DeleteOutlined />} onClick={onRemove} style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}>
        Remove Field
      </Button>
    </div>
  );
}
