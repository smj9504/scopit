/**
 * ScopeIt - Send for Signature Modal
 *
 * Three-step wizard over a document's saved field-mapping template:
 *   Step 1: Preview the template's fields. "Edit Fields" and "Edit PDF" open
 *           the same field-placement editor (FieldMappingModal's body) and
 *           the same content editor (PdfEditorTool's EditorView) inline --
 *           this modal expands full-screen while either is open and returns
 *           to the wizard on save/cancel, rather than closing or navigating
 *           away.
 *   Step 2: Pick the delivery method, plus optional Cc/Bcc. One recipient
 *           row is pinned per signer role the template requires (or a single
 *           generic one if it requires none) -- just fill in who that person
 *           is by name/email, no role picking. A customer picker only
 *           appears here if the template needs one to resolve prefilled
 *           values and none was already supplied via initialCustomer.
 *   Step 3: Review auto-filled values, fill any required "I fill in
 *           before sending" fields, then send.
 *
 * Usage:
 *   <SendForSignModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     documentId={doc.id}
 *     documentName={doc.name}
 *     pageCount={doc.pageCount}
 *     fieldDefinitions={doc.fieldDefinitions}
 *   />
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, Radio, Select, Space, Tooltip, Typography, App, Divider, Empty } from 'antd';
import {
  SendOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  EditOutlined,
  FileImageOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import './pdfWorker';
import FieldPlacementCanvas from './FieldPlacementCanvas';
import { pdfEditorApi } from './pdfEditorApi';
import { isMultilineText, type FieldDefinition, type DeliveryMethod, type SignRequest } from './types';
import { EditorView } from './PdfEditorTool';
import { FieldEditorBody, useFieldEditorState, useAvailableFields, validateFieldsForSave } from './FieldMappingModal';
import CustomerSelector, { type CustomerData } from '@/components/features/CustomerSelector';
import { customerService } from '@/services/customerService';
import { companyService, type Company } from '@/services/companyService';
import type { Customer } from '@/types/entities';
import { getErrorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { colors, fonts, fontSizes, borderRadius } from '@/styles/theme';

/** Mirrors the backend's address-joining logic (field_registry.py /
 * Customer.full_address) so the client-side preview matches what actually
 * gets burned into the document. */
function joinFullAddress(parts: {
  line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null;
}): string {
  const segments = [parts.line1 || ''];
  if (parts.line2) segments.push(parts.line2);
  if (parts.city || parts.state || parts.zip) {
    const cityStateZip: string[] = [];
    if (parts.city) cityStateZip.push(parts.city);
    const stateZip = [parts.state, parts.zip].filter(Boolean).join(' ');
    if (stateZip) cityStateZip.push(stateZip);
    segments.push(cityStateZip.join(', '));
  }
  return segments.filter(Boolean).join(', ');
}

/** Resolves a "customer" registry field (field_registry.py) client-side.
 * Prefers the full Customer record; falls back to the flattened CustomerData
 * summary (name/email/phone/one-line address only) while it's still loading
 * or for a manually-entered, unsaved customer with no customerId to fetch. */
function resolveCustomerField(
  sourceField: string | null | undefined,
  full: Customer | undefined,
  fallback: CustomerData | undefined,
): string | undefined {
  if (!sourceField) return undefined;
  if (full) {
    switch (sourceField) {
      case 'name': return full.name;
      case 'contact_name': return full.contactName;
      case 'email': return full.email;
      case 'phone': return full.phone;
      case 'address_line1': return full.addressLine1;
      case 'address_line2': return full.addressLine2;
      case 'city': return full.city;
      case 'state': return full.state;
      case 'zipcode': return full.zipcode;
      case 'full_address':
        return joinFullAddress({ line1: full.addressLine1, line2: full.addressLine2, city: full.city, state: full.state, zip: full.zipcode });
      default: return undefined; // e.g. 'country' -- Customer has no country field client-side
    }
  }
  if (!fallback) return undefined;
  switch (sourceField) {
    case 'name': return fallback.name;
    case 'email': return fallback.email;
    case 'phone': return fallback.phone;
    case 'full_address':
    case 'address_line1':
      return fallback.address;
    default: return undefined;
  }
}

/** Resolves a "company" registry field (field_registry.py) client-side. */
function resolveCompanyField(sourceField: string | null | undefined, company: Company): string | undefined {
  if (!sourceField) return undefined;
  switch (sourceField) {
    case 'name': return company.name;
    case 'legal_name': return company.legalName;
    case 'email': return company.email;
    case 'phone': return company.phone;
    case 'website': return company.website;
    case 'address_line1': return company.addressLine1;
    case 'address_line2': return company.addressLine2;
    case 'city': return company.city;
    case 'state': return company.state;
    case 'zipcode': return company.zipcode;
    case 'country': return company.country;
    case 'full_address':
      return joinFullAddress({ line1: company.addressLine1, line2: company.addressLine2, city: company.city, state: company.state, zip: company.zipcode });
    default: return undefined;
  }
}

const { Text, Title } = Typography;
const { TextArea } = Input;

const EXPIRY_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "signer_1" -> "Signer 1" -- field templates store role as a slug. */
function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RecipientRow {
  id: string;
  role: string;
  name: string;
  email: string;
  phone: string;
}

let rowCounter = 1;
function nextRowId() {
  return `recipient-${rowCounter++}`;
}

export interface SendForSignModalProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
  pageCount: number;
  fieldDefinitions: FieldDefinition[];
  /** Pre-select this customer in Step 2 (e.g. when launched from a Customer's own page). */
  initialCustomer?: CustomerData;
  /** Fired right after the signature request is successfully sent. */
  onSent?: (result: SignRequest) => void;
}

export default function SendForSignModal({
  open,
  onClose,
  documentId,
  documentName,
  pageCount: initialPageCount,
  fieldDefinitions: initialFieldDefinitions,
  initialCustomer,
  onSent,
}: SendForSignModalProps) {
  const { message, modal } = App.useApp();
  const user = useAuthStore((s) => s.user);

  const isMobile = useIsMobile();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pdfReloadTick, setPdfReloadTick] = useState(0);

  // The template as last known to this modal -- seeded from props, but kept
  // locally so inline "Edit Fields"/"Edit PDF" (see editMode below) can
  // update it in place without the parent re-fetching and passing new props.
  const [fields, setFields] = useState<FieldDefinition[]>(initialFieldDefinitions);
  const [pageCount, setPageCount] = useState(initialPageCount);

  // 'fields' and 'pdf' take the whole modal full-screen, in place -- no
  // navigating away and no separate modal stacked on top.
  const [editMode, setEditMode] = useState<'none' | 'fields' | 'pdf'>('none');
  const [savingFields, setSavingFields] = useState(false);

  // Step 2 state
  const [customer, setCustomer] = useState<CustomerData | undefined>(undefined);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('email_request');
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [ccBccOpen, setCcBccOpen] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(14);

  // Step 3 state
  const [draft, setDraft] = useState<SignRequest | null>(null);
  const [creatorValues, setCreatorValues] = useState<Record<string, string>>({});
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentResult, setSentResult] = useState<SignRequest | null>(null);

  const signerRoles = useMemo(
    () => Array.from(new Set(fields.map((f) => f.signerRole).filter((r): r is string => !!r))),
    [fields],
  );

  // Step 1 renders before a sign request exists, so there's no server-computed
  // prefill_data yet. Resolve the same way the backend eventually will
  // (field_registry.py's AVAILABLE_FIELD_REGISTRY) using the full Customer/
  // Company records -- not just the flattened CustomerData summary, which is
  // missing most address components and would silently under-resolve fields
  // like "Full Address".
  const fullCustomerQuery = useQuery({
    queryKey: ['customer', customer?.customerId],
    queryFn: () => customerService.getById(customer!.customerId!),
    enabled: open && !!customer?.customerId,
    staleTime: 60_000,
  });
  const companyQuery = useQuery({
    queryKey: ['company'],
    queryFn: () => companyService.get(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const step1ResolvedValues = useMemo(() => {
    const fullCustomer = fullCustomerQuery.data;
    const company = companyQuery.data;
    const map: Record<string, string> = {};
    for (const f of fields) {
      if (f.dataBinding.mode !== 'prefilled') continue;
      let value: string | null | undefined;
      if (f.dataBinding.sourceEntity === 'customer') {
        value = resolveCustomerField(f.dataBinding.sourceField, fullCustomer, customer);
      } else if (f.dataBinding.sourceEntity === 'company' && company) {
        value = resolveCompanyField(f.dataBinding.sourceField, company);
      }
      if (value) map[f.key] = value;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  }, [customer, fullCustomerQuery.data, companyQuery.data, fields]);

  // A customer picker is only shown when the template actually needs one to
  // resolve prefilled values (e.g. customer name/address burned into the
  // document) and the caller hasn't already supplied one -- e.g. opened from
  // the PDF Editor Tool or Company Documents, not from a Customer's own page.
  const needsCustomerForPrefill = useMemo(
    () => fields.some(
      (f) => f.dataBinding.mode === 'prefilled' && f.dataBinding.sourceEntity === 'customer',
    ),
    [fields],
  );
  const showCustomerPicker = !initialCustomer && needsCustomerForPrefill;

  // Reset wizard state whenever the modal opens for a (possibly new) document
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setEditMode('none');
    setCustomer(initialCustomer);
    setFields(initialFieldDefinitions);
    setPageCount(initialPageCount);
    setDeliveryMethod('email_request');
    // Pre-fill the first recipient row from initialCustomer, same convenience
    // behavior as handleCustomerChange below when the customer is instead
    // picked interactively (see showCustomerPicker). Computed straight from
    // the incoming prop, not the signerRoles memo -- that's derived from the
    // `fields` state this same effect is setting, so it would still reflect
    // the *previous* document for this render.
    const roles = Array.from(
      new Set(initialFieldDefinitions.map((f) => f.signerRole).filter((r): r is string => !!r)),
    );
    setRecipients(
      roles.length > 0
        ? roles.map((role, idx) => ({
            id: nextRowId(),
            role,
            name: idx === 0 ? (initialCustomer?.name ?? '') : '',
            email: idx === 0 ? (initialCustomer?.email ?? '') : '',
            phone: '',
          }))
        : [{ id: nextRowId(), role: 'signer', name: initialCustomer?.name ?? '', email: initialCustomer?.email ?? '', phone: '' }],
    );
    setEmailSubject(`Signature requested: ${documentName}`);
    setEmailMessage('');
    setCcEmails([]);
    setBccEmails([]);
    setCcBccOpen(false);
    setExpiresInDays(14);
    setDraft(null);
    setCreatorValues({});
    setSentResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId]);

  // Load the PDF client-side for the step-1 read-only field preview, and for
  // the inline field editor (editMode === 'fields') -- both show the same
  // document. pdfReloadTick forces a refetch after returning from the inline
  // PDF editor (editMode === 'pdf'), whose content edits this won't otherwise
  // know about.
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
        const response = await fetch(`${apiBase}/tools/pdf-editor/documents/${documentId}/download?flatten=true`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          if (!cancelled) setPdfLoadError(`Couldn't load the document (server returned ${response.status}).`);
          return;
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) { pdf.destroy(); return; }
        setPdfDoc(pdf);
      } catch {
        if (!cancelled) setPdfLoadError("Couldn't load the document. Check your connection and try again.");
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId, pdfReloadTick]);

  const handleCustomerChange = (data: CustomerData) => {
    setCustomer(data);
    // Convenience only: fill the first still-empty recipient row, never
    // overwrite a row the user has already started editing.
    setRecipients((prev) => {
      if (prev.length === 0) return prev;
      const [first, ...rest] = prev;
      if (first.name.trim() || first.email.trim()) return prev;
      return [{ ...first, name: data.name, email: data.email ?? '' }, ...rest];
    });
  };

  // Cc/Bcc use a free-text tag input: split on paste/comma/space, keep only
  // syntactically valid addresses, and warn once per batch about the rest.
  const parseEmailTags = (values: string[]): string[] => {
    const valid: string[] = [];
    let hadInvalid = false;
    values.forEach((raw) => {
      const email = raw.trim();
      if (!email) return;
      if (EMAIL_RE.test(email)) valid.push(email);
      else hadInvalid = true;
    });
    if (hadInvalid) message.warning('Enter a valid email address');
    return Array.from(new Set(valid));
  };

  // One row per role the template requires -- who ends up in each slot is
  // decided right here, by email, not by picking "Signer 1/2/3" anywhere.
  const updateRecipient = (id: string, patch: Partial<RecipientRow>) =>
    setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const recipientsValid =
    recipients.length > 0 && recipients.every((r) => r.name.trim() && r.email.trim());

  const creatorFields = useMemo(
    () => fields.filter((f) => f.dataBinding.mode === 'creator_input'),
    [fields],
  );
  const missingRequiredCreatorFields = useMemo(
    () => creatorFields.filter((f) => f.required && !(creatorValues[f.key] ?? '').trim()),
    [creatorFields, creatorValues],
  );

  const handleProceedToReview = async () => {
    if (!recipientsValid) {
      message.error('Enter a name and email for every recipient');
      return;
    }
    setCreatingDraft(true);
    try {
      const created = await pdfEditorApi.createSignRequest({
        documentId,
        recipients: recipients.map((r) => ({
          role: r.role.trim(),
          name: r.name.trim(),
          email: r.email.trim(),
          ...(r.phone.trim() ? { phone: r.phone.trim() } : {}),
        })),
        customerId: customer?.customerId,
        deliveryMethod,
        senderEmail: user?.email,
        senderName: user?.fullName || user?.email,
        emailSubject: emailSubject || undefined,
        emailMessage: emailMessage || undefined,
        ccEmails,
        bccEmails,
        expiresInDays,
      });
      setDraft(created);
      setCreatorValues(created.prefillData ?? {});
      setStep(3);
    } catch (err) {
      message.error(getErrorMessage(err) || 'Failed to create the sign request');
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleSend = async () => {
    if (!draft) return;
    if (missingRequiredCreatorFields.length > 0) {
      message.error(`Fill required field(s): ${missingRequiredCreatorFields.map((f) => f.label).join(', ')}`);
      return;
    }
    setSending(true);
    try {
      if (creatorFields.length > 0) {
        const values = creatorFields.reduce<Record<string, string>>((acc, f) => {
          acc[f.key] = creatorValues[f.key] ?? '';
          return acc;
        }, {});
        await pdfEditorApi.setCreatorFieldValues(draft.id, values);
      }
      const result = await pdfEditorApi.sendSignRequest(draft.id);
      setSentResult(result);
      onSent?.(result);
      if (deliveryMethod === 'email_request') {
        message.success('Signature request sent');
      }
    } catch (err) {
      message.error(getErrorMessage(err) || 'Failed to send the signature request');
    } finally {
      setSending(false);
    }
  };

  const canProceedStep1 = fields.length > 0;

  // ── Inline "Edit Fields" sub-mode (editMode === 'fields') ───────────────────
  // Same state/handlers FieldMappingModal uses -- see its module docblock.
  const {
    fields: editorFields, selectedKey, setSelectedKey, activeType, setActiveType, dirty: fieldsDirty, setDirty: setFieldsDirty,
    handlePlaceField, updateSelected, handleMoveField, handleResizeField, handleRemoveField,
  } = useFieldEditorState(fields, editMode === 'fields', documentId);
  const editorAvailableFields = useAvailableFields(editMode === 'fields');

  const handleSaveFields = async () => {
    const error = validateFieldsForSave(editorFields);
    if (error) {
      message.error(error);
      return;
    }
    setSavingFields(true);
    try {
      const doc = await pdfEditorApi.saveFieldDefinitions(documentId, editorFields);
      setFields(doc.fieldDefinitions);
      message.success('Field mapping saved');
      setFieldsDirty(false);
      setEditMode('none');
    } catch {
      message.error('Failed to save field mapping. Please try again.');
    } finally {
      setSavingFields(false);
    }
  };

  const handleCancelFieldsEdit = () => {
    if (savingFields) return;
    if (!fieldsDirty) {
      setEditMode('none');
      return;
    }
    modal.confirm({
      title: 'Discard unsaved fields?',
      content: "Your field placements and settings for this template haven't been saved.",
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep Editing',
      onOk: () => setEditMode('none'),
    });
  };

  // ── Inline "Edit PDF" sub-mode (editMode === 'pdf') ─────────────────────────
  // EditorView autosaves annotations itself -- returning here just means
  // re-pulling the document (page count may have changed via page delete/
  // reorder) and re-rendering the flattened preview to match.
  const handleBackFromPdfEdit = async () => {
    setEditMode('none');
    try {
      const doc = await pdfEditorApi.getDocument(documentId);
      setPageCount(doc.pageCount);
    } catch {
      // non-fatal -- keep the previously known page count
    }
    setPdfReloadTick((t) => t + 1);
  };

  // ── Step 1: field preview ──────────────────────────────────────────────────
  const step1Content = (
    <>
      {!canProceedStep1 ? (
        <Empty
          description={
            <Space direction="vertical" size={4} style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: fontSizes.sm, color: colors.textSecondary, fontFamily: fonts.body }}>
                This document has no fields defined yet.
              </Text>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => setEditMode('fields')}
                  style={{ background: colors.primary, borderColor: colors.primary, marginTop: 4 }}
                >
                  Define Fields
                </Button>
                <Button
                  icon={<FileImageOutlined />}
                  onClick={() => setEditMode('pdf')}
                  style={{ marginTop: 4 }}
                >
                  Edit PDF
                </Button>
              </Space>
            </Space>
          }
          style={{ padding: '48px 0' }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body }}>
              {fields.length} field{fields.length !== 1 ? 's' : ''} defined on this template
            </Text>
            <Space size={4}>
              <Button
                size="small"
                type="text"
                icon={<FileImageOutlined />}
                onClick={() => setEditMode('pdf')}
                style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}
              >
                Edit PDF
              </Button>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => setEditMode('fields')}
                style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}
              >
                Edit Fields
              </Button>
            </Space>
          </div>
          <FieldPlacementCanvas
            pdfDoc={pdfDoc}
            pageCount={pageCount}
            fields={fields}
            readOnly
            maxHeight="calc(100vh - 360px)"
            resolvedValues={step1ResolvedValues}
          />
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '12px 0 0' }}>
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            iconPosition="end"
            onClick={() => setStep(2)}
            disabled={!canProceedStep1}
            style={{ background: colors.primary, borderColor: colors.primary }}
          >
            Next
          </Button>
        </Space>
      </div>
    </>
  );

  // ── Step 2: recipients & delivery ──────────────────────────────────────────
  const sectionLabelStyle: React.CSSProperties = {
    fontSize: fontSizes.xs, fontWeight: 600, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontFamily: fonts.body,
  };

  const step2Content = (
    <>
      {showCustomerPicker && (
        <>
          <div style={sectionLabelStyle}>Customer</div>
          <Text style={{ display: 'block', fontSize: 11, color: colors.textMuted, fontFamily: fonts.body, marginTop: -6, marginBottom: 10 }}>
            This template pulls customer details (e.g. name, address) into the document.
          </Text>
          <div style={{ marginBottom: 16 }}>
            <CustomerSelector value={customer} onChange={handleCustomerChange} />
          </div>
        </>
      )}

      <div style={sectionLabelStyle}>Delivery Method</div>
      <Radio.Group
        value={deliveryMethod}
        onChange={(e) => setDeliveryMethod(e.target.value)}
        style={{ marginBottom: 18, display: 'flex', gap: 8 }}
      >
        <Radio.Button value="email_request" style={{ flex: 1, textAlign: 'center', fontFamily: fonts.body }}>
          Email Request
        </Radio.Button>
        <Radio.Button value="direct_link" style={{ flex: 1, textAlign: 'center', fontFamily: fonts.body }}>
          Direct Link
        </Radio.Button>
      </Radio.Group>
      <Text style={{ display: 'block', fontSize: 11, color: colors.textMuted, fontFamily: fonts.body, marginTop: -12, marginBottom: 16 }}>
        {deliveryMethod === 'email_request'
          ? 'Each recipient gets an email with their own signing link.'
          : "No email is sent — you'll get a link per recipient to share yourself."}
      </Text>

      <div style={sectionLabelStyle}>Recipients</div>

      <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
        {recipients.map((r, index) => (
          <div
            key={r.id}
            style={{
              padding: 10, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, background: colors.bgLight,
            }}
          >
            {recipients.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <Text
                  style={{
                    fontSize: 10, fontWeight: 600, color: colors.textMuted, fontFamily: fonts.body,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}
                >
                  {formatRoleLabel(r.role)}
                </Text>
                <Tooltip title="Which signature/fields on the document this recipient fills in. It's just a slot label from the template, not a real job title.">
                  <QuestionCircleOutlined style={{ fontSize: 11, color: colors.textMuted, cursor: 'help' }} />
                </Tooltip>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 8 }}>
              {index === 0 && customer ? (
                <Input
                  value={customer.name}
                  disabled
                  style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}
                  size="small"
                />
              ) : (
                <Input
                  placeholder="Full name"
                  value={r.name}
                  onChange={(e) => updateRecipient(r.id, { name: e.target.value })}
                  style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}
                  size="small"
                />
              )}
              <Input
                placeholder="Email address"
                value={r.email}
                onChange={(e) => updateRecipient(r.id, { email: e.target.value })}
                style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}
                size="small"
              />
            </div>
          </div>
        ))}
      </Space>

      <Divider style={{ margin: '4px 0 16px', borderColor: colors.border }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={sectionLabelStyle as React.CSSProperties}>Email Details</div>
        {!ccBccOpen && deliveryMethod === 'email_request' && (
          <Button
            size="small"
            type="text"
            onClick={() => setCcBccOpen(true)}
            style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}
          >
            Cc/Bcc
          </Button>
        )}
      </div>
      {ccBccOpen && deliveryMethod === 'email_request' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>Cc</label>
            <Select
              mode="tags"
              value={ccEmails}
              onChange={(v) => setCcEmails(parseEmailTags(v))}
              tokenSeparators={[',', ' ']}
              notFoundContent={null}
              suffixIcon={null}
              placeholder="Add email, press Enter"
              style={{ width: '100%', fontFamily: fonts.body }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>Bcc</label>
            <Select
              mode="tags"
              value={bccEmails}
              onChange={(v) => setBccEmails(parseEmailTags(v))}
              tokenSeparators={[',', ' ']}
              notFoundContent={null}
              suffixIcon={null}
              placeholder="Add email, press Enter"
              style={{ width: '100%', fontFamily: fonts.body }}
            />
          </div>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>Subject</label>
        <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} style={{ fontFamily: fonts.body }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>
          Message <span style={{ color: colors.textMuted, fontWeight: 400 }}>(optional)</span>
        </label>
        <TextArea
          value={emailMessage}
          onChange={(e) => setEmailMessage(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{ fontFamily: fonts.body }}
        />
      </div>
      <div style={{ marginBottom: 4 }}>
        <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>Expires in</label>
        <Radio.Group value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}>
          {EXPIRY_OPTIONS.map((opt) => (
            <Radio.Button key={opt.value} value={opt.value} style={{ fontFamily: fonts.body, fontSize: fontSizes.xs }}>
              {opt.label}
            </Radio.Button>
          ))}
        </Radio.Group>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 0' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(1)}>Back</Button>
        <Button
          type="primary"
          icon={<ArrowRightOutlined />}
          iconPosition="end"
          onClick={handleProceedToReview}
          loading={creatingDraft}
          style={{ background: colors.primary, borderColor: colors.primary }}
        >
          Review
        </Button>
      </div>
    </>
  );

  // ── Step 3: review & send ───────────────────────────────────────────────────
  const step3Content = draft && (
    <>
      <div style={sectionLabelStyle}>Recipients</div>
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
        {draft.recipients.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontSizes.sm, fontFamily: fonts.body }}>
            <Text style={{ color: colors.textPrimary }}>{r.name} <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>({r.role})</Text></Text>
            <Text style={{ color: colors.textSecondary }}>{r.email}</Text>
          </div>
        ))}
      </Space>

      {fields.filter((f) => f.dataBinding.mode === 'prefilled').length > 0 && (
        <>
          <div style={sectionLabelStyle}>Auto-Filled Values</div>
          <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 16 }}>
            {fields.filter((f) => f.dataBinding.mode === 'prefilled').map((f) => (
              <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontSizes.xs, fontFamily: fonts.body }}>
                <Text style={{ color: colors.textSecondary }}>{f.label}</Text>
                <Text style={{ color: colors.textPrimary, fontWeight: 500 }}>{creatorValues[f.key] || <Text style={{ color: colors.textMuted }}>—</Text>}</Text>
              </div>
            ))}
          </Space>
        </>
      )}

      {creatorFields.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Fill In Before Sending</div>
          <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
            {creatorFields.map((f) => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textPrimary, fontFamily: fonts.body, marginBottom: 4 }}>
                  {f.label} {f.required && <span style={{ color: colors.error }}>*</span>}
                </label>
                {isMultilineText(f) ? (
                  <TextArea
                    value={creatorValues[f.key] ?? ''}
                    onChange={(e) => setCreatorValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    style={{ fontFamily: fonts.body }}
                  />
                ) : (
                  <Input
                    value={creatorValues[f.key] ?? ''}
                    onChange={(e) => setCreatorValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ fontFamily: fonts.body }}
                  />
                )}
              </div>
            ))}
          </Space>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(2)} disabled={sending}>Back</Button>
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          style={{ background: colors.primary, borderColor: colors.primary }}
        >
          Send
        </Button>
      </div>
    </>
  );

  const modalTitle = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <Title level={5} style={{ margin: 0, fontFamily: fonts.heading, fontSize: fontSizes.md, color: colors.textPrimary }}>
          Send for Signature
        </Title>
        <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body }}>{documentName}</Text>
      </div>
      <Text style={{ fontSize: fontSizes.xs, color: colors.textSecondary, fontFamily: fonts.body, fontWeight: 500 }}>
        Step {step} of 3
      </Text>
    </div>
  );

  const fieldsEditorContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: fonts.body }}>
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
          onClick={handleCancelFieldsEdit}
          disabled={savingFields}
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
              {editorFields.length} field{editorFields.length !== 1 ? 's' : ''} defined
            </Text>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveFields}
            loading={savingFields}
            style={{ background: colors.primary, borderColor: colors.primary }}
          >
            {isMobile ? 'Save' : 'Save Template'}
          </Button>
        </div>
      </div>

      <FieldEditorBody
        fields={editorFields}
        selectedKey={selectedKey}
        onSelectField={setSelectedKey}
        activeType={activeType}
        onActiveTypeChange={setActiveType}
        onPlaceField={handlePlaceField}
        onMoveField={handleMoveField}
        onResizeField={handleResizeField}
        onRemoveField={handleRemoveField}
        onFieldChange={updateSelected}
        availableFields={editorAvailableFields}
        pdfDoc={pdfDoc}
        pageCount={pageCount}
        pdfLoadError={pdfLoadError}
        onReloadPdf={() => setPdfReloadTick((t) => t + 1)}
        isMobile={isMobile}
      />
    </div>
  );

  const fullScreen = editMode !== 'none';

  return (
    <>
      <Modal
        open={open && !sentResult}
        onCancel={editMode === 'fields' ? handleCancelFieldsEdit : editMode === 'pdf' ? handleBackFromPdfEdit : onClose}
        title={fullScreen ? null : modalTitle}
        footer={null}
        closable={fullScreen ? false : (!sending && !creatingDraft)}
        maskClosable={fullScreen ? false : (!sending && !creatingDraft)}
        width={fullScreen ? '100vw' : (step === 1 ? 840 : 560)}
        style={fullScreen ? { top: 0, paddingBottom: 0, margin: 0, maxWidth: '100vw' } : undefined}
        styles={
          fullScreen
            ? {
                content: { padding: 0, borderRadius: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
                body: { flex: 1, minHeight: 0, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
              }
            : {
                body: { padding: '16px 24px 8px' },
                header: { padding: '16px 24px 12px', borderBottom: `1px solid ${colors.border}` },
                content: { borderRadius: borderRadius.lg, fontFamily: fonts.body },
              }
        }
      >
        {editMode === 'fields' ? (
          fieldsEditorContent
        ) : editMode === 'pdf' ? (
          <EditorView documentId={documentId} onBack={handleBackFromPdfEdit} heightOffset={0} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
              {([1, 2, 3] as const).map((s) => (
                <div
                  key={s}
                  style={{
                    flex: 1, height: 3, background: step >= s ? colors.primary : colors.border,
                    borderRadius: s === 1 ? '2px 0 0 2px' : s === 3 ? '0 2px 2px 0' : 0,
                    transition: 'background 0.2s ease',
                  }}
                />
              ))}
            </div>

            {step === 1 && step1Content}
            {step === 2 && step2Content}
            {step === 3 && step3Content}
          </>
        )}
      </Modal>

      {/* Success screen */}
      <Modal
        open={!!sentResult}
        onCancel={() => { setSentResult(null); onClose(); }}
        footer={null}
        closable={false}
        width={480}
        centered
        styles={{ body: { padding: '32px 28px 24px' }, content: { borderRadius: borderRadius.lg, fontFamily: fonts.body } }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <Title level={4} style={{ margin: '0 0 8px', fontFamily: fonts.heading, fontSize: fontSizes.xl, color: colors.textPrimary }}>
            Signature request sent
          </Title>
          <Text style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textSecondary, fontFamily: fonts.body, marginBottom: 16 }}>
            {deliveryMethod === 'direct_link'
              ? 'Copy each link below and share it with the recipient.'
              : 'Each recipient has been emailed their own signing link.'}
          </Text>

          {sentResult?.signUrls && (
            <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 20 }}>
              {sentResult.recipients.map((r) => {
                const url = sentResult.signUrls?.[r.id];
                if (!url) return null;
                return (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      background: colors.bgLight, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: '8px 12px',
                    }}
                  >
                    <Text style={{ fontSize: fontSizes.xs, fontFamily: fonts.body, color: colors.textPrimary }}>
                      {r.name} <Text style={{ color: colors.textMuted }}>({r.role})</Text>
                    </Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => { navigator.clipboard.writeText(url); message.success('Link copied'); }}
                    >
                      Copy
                    </Button>
                  </div>
                );
              })}
            </Space>
          )}

          <Button
            type="primary"
            onClick={() => { setSentResult(null); onClose(); }}
            style={{ borderRadius: borderRadius.base, background: colors.primary, borderColor: colors.primary, fontFamily: fonts.body, fontWeight: 600, fontSize: fontSizes.sm }}
          >
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}
