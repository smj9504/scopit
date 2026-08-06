/**
 * ScopeIt - PDF Editor API Client
 *
 * Uses the centralized `api` axios instance (auth headers, token refresh).
 * For public signing endpoints (no auth required), uses raw axios.
 */
import axios from 'axios';
import api from '@/services/api';
import type {
  PdfDocument,
  PdfDocumentListResponse,
  Annotation,
  AvailableField,
  FieldDefinition,
  SignRequest,
  SignRequestListResponse,
  SignAuditEvent,
  SignViewData,
  CompanyDocument,
  CompanyDocumentListResponse,
  DeliveryMethod,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a binary response and convert to a browser object URL. */
async function blobToObjectUrl(promise: Promise<{ data: Blob }>): Promise<string> {
  const response = await promise;
  return URL.createObjectURL(response.data);
}

/** Normalize a company-document API response into the CompanyDocument shape.
 * The backend's CompanyDocumentResponse schema already serializes with
 * camelCase aliases (mimeType, fileSize, ...), so this mostly just fills in
 * defaults for fields the API omits when null. */
function mapCompanyDocument(raw: any): CompanyDocument {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    category: raw.category ?? null,
    fileSize: raw.fileSize,
    mimeType: raw.mimeType,
    pageCount: raw.pageCount,
    thumbnailUrl: raw.thumbnailUrl ?? null,
    tags: raw.tags ?? [],
    useCount: raw.useCount ?? 0,
    lastUsedAt: raw.lastUsedAt ?? null,
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? null,
  };
}

// ── PDF Documents ─────────────────────────────────────────────────────────────

export const pdfEditorApi = {
  /**
   * Upload a PDF file and create a new document record.
   */
  uploadDocument: async (file: File, name?: string, rotation = 0): Promise<PdfDocument> => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (rotation) form.append('rotation', String(rotation));
    const response = await api.post<PdfDocument>('/tools/pdf-editor/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Convert one or more image files into a single PDF document.
   */
  imagesToPdf: async (files: File[], name?: string): Promise<PdfDocument> => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    if (name) form.append('name', name);
    const response = await api.post<PdfDocument>('/tools/pdf-editor/documents/images-to-pdf', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * List documents for the current company with optional pagination and search.
   */
  listDocuments: async (
    skip = 0,
    limit = 20,
    search?: string,
  ): Promise<PdfDocumentListResponse> => {
    const response = await api.get<PdfDocumentListResponse>('/tools/pdf-editor/documents', {
      params: { skip, limit, ...(search ? { search } : {}) },
    });
    return response.data;
  },

  /**
   * Get a single document by ID.
   */
  getDocument: async (id: string): Promise<PdfDocument> => {
    const response = await api.get<PdfDocument>(`/tools/pdf-editor/documents/${id}`);
    return response.data;
  },

  /**
   * Download the PDF file. Pass `flatten: true` to bake annotations into the PDF.
   */
  downloadDocument: async (id: string, flatten = false): Promise<Blob> => {
    const response = await api.get(`/tools/pdf-editor/documents/${id}/download`, {
      responseType: 'blob',
      params: flatten ? { flatten: true } : undefined,
    });
    return response.data;
  },

  /**
   * Fetch a rasterized page image and return a browser object URL.
   * Caller is responsible for calling URL.revokeObjectURL() when done.
   */
  getPageImage: async (id: string, pageNum: number): Promise<string> => {
    return blobToObjectUrl(
      api.get(`/tools/pdf-editor/documents/${id}/page/${pageNum}`, {
        responseType: 'blob',
      }),
    );
  },

  /**
   * Fetch a document's thumbnail image and return a browser object URL.
   * Caller is responsible for calling URL.revokeObjectURL() when done.
   */
  getThumbnail: async (id: string): Promise<string> => {
    return blobToObjectUrl(
      api.get(`/tools/pdf-editor/documents/${id}/thumbnail`, {
        responseType: 'blob',
      }),
    );
  },

  /**
   * Permanently delete a document.
   */
  deleteDocument: async (id: string): Promise<void> => {
    await api.delete(`/tools/pdf-editor/documents/${id}`);
  },

  /**
   * Create a copy of an existing document.
   */
  duplicateDocument: async (id: string, name?: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(`/tools/pdf-editor/documents/${id}/duplicate`, {
      ...(name ? { name } : {}),
    });
    return response.data;
  },

  /**
   * Rename a document without changing its contents.
   */
  renameDocument: async (id: string, name: string): Promise<PdfDocument> => {
    const response = await api.patch<PdfDocument>(`/tools/pdf-editor/documents/${id}`, { name });
    return response.data;
  },

  // ── Page Operations ──────────────────────────────────────────────────────

  /**
   * Merge multiple documents into a single new document.
   * The order of `documentIds` determines page order.
   */
  mergeDocuments: async (documentIds: string[], name?: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>('/tools/pdf-editor/documents/merge', {
      document_ids: documentIds,
      ...(name ? { name } : {}),
    });
    return response.data;
  },

  /**
   * Reorder pages within a document.
   * `pageOrder` is a 1-based array of the desired page positions.
   */
  reorderPages: async (id: string, pageOrder: number[]): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(
      `/tools/pdf-editor/documents/${id}/pages/reorder`,
      { page_order: pageOrder },
    );
    return response.data;
  },

  /**
   * Permanently remove specific pages from a document.
   * `pageNumbers` is 1-based.
   */
  deletePages: async (id: string, pageNumbers: number[]): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(
      `/tools/pdf-editor/documents/${id}/pages/delete`,
      { page_numbers: pageNumbers },
    );
    return response.data;
  },

  /**
   * Rotate specific pages within a document.
   * `rotations` maps 1-based page number (as string key) to degrees (90, 180, 270).
   */
  rotatePages: async (id: string, rotations: Record<string, number>): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(
      `/tools/pdf-editor/documents/${id}/pages/rotate`,
      { rotations },
    );
    return response.data;
  },

  // ── Annotations ──────────────────────────────────────────────────────────

  /**
   * Persist the full annotation list for a document (replaces existing).
   */
  saveAnnotations: async (id: string, annotations: Annotation[]): Promise<PdfDocument> => {
    const response = await api.put<PdfDocument>(
      `/tools/pdf-editor/documents/${id}/annotations`,
      { annotations },
    );
    return response.data;
  },

  /**
   * Render annotations into the PDF and return the flattened file as a Blob.
   */
  flattenAnnotations: async (id: string): Promise<Blob> => {
    const response = await api.post(
      `/tools/pdf-editor/documents/${id}/flatten`,
      {},
      { responseType: 'blob' },
    );
    return response.data;
  },

  // ── Field Mapping (reusable template) ───────────────────────────────────

  /**
   * List source entity/field pairs available for "auto-fill" data binding.
   */
  getAvailableFields: async (): Promise<AvailableField[]> => {
    const response = await api.get<AvailableField[]>('/tools/pdf-editor/fields/available');
    return response.data;
  },

  /**
   * Persist the reusable field-mapping template for a document. Every
   * future sign request created against this document copies these
   * definitions as its starting field set.
   */
  saveFieldDefinitions: async (id: string, fields: FieldDefinition[]): Promise<PdfDocument> => {
    const response = await api.put<PdfDocument>(`/tools/pdf-editor/documents/${id}/fields`, {
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        data_binding: {
          mode: f.dataBinding.mode,
          source_entity: f.dataBinding.sourceEntity ?? null,
          source_field: f.dataBinding.sourceField ?? null,
        },
        signer_role: f.signerRole ?? null,
        required: f.required,
        font_size: f.fontSize ?? null,
      })),
    });
    return response.data;
  },

  // ── Import ───────────────────────────────────────────────────────────────

  /**
   * Generate a PDF from an existing estimate and create a new document.
   */
  importEstimate: async (estimateId: string, template?: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>('/tools/pdf-editor/documents/import-estimate', {
      estimate_id: estimateId,
      ...(template ? { template } : {}),
    });
    return response.data;
  },

  /**
   * Generate a PDF from an existing invoice and create a new document.
   */
  importInvoice: async (invoiceId: string, template?: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>('/tools/pdf-editor/documents/import-invoice', {
      invoice_id: invoiceId,
      ...(template ? { template } : {}),
    });
    return response.data;
  },

  /**
   * Copy a company document template into the editor as a new editable document.
   */
  importCompanyDoc: async (companyDocId: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(
      '/tools/pdf-editor/documents/import-company-doc',
      { company_document_id: companyDocId },
    );
    return response.data;
  },

  // ── Sign Requests ────────────────────────────────────────────────────────

  /**
   * Create a new e-signature request (envelope) for a document. Field
   * definitions are NOT passed here -- they're copied server-side from the
   * document's saved field-mapping template (see saveFieldDefinitions).
   */
  createSignRequest: async (data: {
    documentId: string;
    recipients: Array<{ role: string; name: string; email: string; phone?: string }>;
    customerId?: string;
    deliveryMethod?: DeliveryMethod;
    senderEmail?: string;
    senderName?: string;
    emailSubject?: string;
    emailMessage?: string;
    ccEmails?: string[];
    bccEmails?: string[];
    expiresInDays?: number;
  }): Promise<SignRequest> => {
    const response = await api.post<SignRequest>('/tools/pdf-editor/sign/requests', {
      document_id: data.documentId,
      recipients: data.recipients.map((r) => ({
        role: r.role,
        name: r.name,
        email: r.email,
        ...(r.phone ? { phone: r.phone } : {}),
      })),
      ...(data.customerId ? { customer_id: data.customerId } : {}),
      delivery_method: data.deliveryMethod || 'email_request',
      ...(data.senderEmail ? { sender_email: data.senderEmail } : {}),
      ...(data.senderName ? { sender_name: data.senderName } : {}),
      ...(data.emailSubject ? { email_subject: data.emailSubject } : {}),
      ...(data.emailMessage ? { email_message: data.emailMessage } : {}),
      ...(data.ccEmails?.length ? { cc_emails: data.ccEmails } : {}),
      ...(data.bccEmails?.length ? { bcc_emails: data.bccEmails } : {}),
      ...(data.expiresInDays !== undefined ? { expires_in_days: data.expiresInDays } : {}),
    });
    return response.data;
  },

  /**
   * Fill in the sender's own ("I fill in before sending") field values.
   * Only allowed while the request is still a draft.
   */
  setCreatorFieldValues: async (
    id: string,
    values: Record<string, string>,
  ): Promise<SignRequest> => {
    const response = await api.patch<SignRequest>(
      `/tools/pdf-editor/sign/requests/${id}/creator-fields`,
      { values },
    );
    return response.data;
  },

  /**
   * Preview resolved field values (auto-filled + creator-filled) before
   * sending, rendered over the template's rasterized pages.
   */
  previewSignRequest: async (
    id: string,
  ): Promise<{ fields: FieldDefinition[]; values: Record<string, string>; pageCount: number; documentName: string | null }> => {
    const response = await api.get(`/tools/pdf-editor/sign/requests/${id}/preview`);
    return response.data;
  },

  /**
   * List sign requests with optional status filter and pagination.
   */
  listSignRequests: async (
    status?: string,
    skip = 0,
    limit = 20,
  ): Promise<SignRequestListResponse> => {
    const response = await api.get<SignRequestListResponse>('/tools/pdf-editor/sign/requests', {
      params: { skip, limit, ...(status ? { status } : {}) },
    });
    return response.data;
  },

  /**
   * Get a single sign request by ID.
   */
  getSignRequest: async (id: string): Promise<SignRequest> => {
    const response = await api.get<SignRequest>(`/tools/pdf-editor/sign/requests/${id}`);
    return response.data;
  },

  /**
   * Dispatch the sign request email to the recipient.
   */
  sendSignRequest: async (id: string): Promise<SignRequest> => {
    const response = await api.post<SignRequest>(`/tools/pdf-editor/sign/requests/${id}/send`);
    return response.data;
  },

  /**
   * Send a reminder email. Omit recipientId to remind everyone still
   * outstanding, or pass it to remind a single recipient.
   */
  sendReminder: async (id: string, recipientId?: string): Promise<SignRequest> => {
    const response = await api.post<SignRequest>(
      `/tools/pdf-editor/sign/requests/${id}/reminder`,
      undefined,
      { params: recipientId ? { recipient_id: recipientId } : undefined },
    );
    return response.data;
  },

  /**
   * Void a pending sign request.
   */
  cancelSignRequest: async (id: string): Promise<SignRequest> => {
    const response = await api.post<SignRequest>(`/tools/pdf-editor/sign/requests/${id}/cancel`);
    return response.data;
  },

  /**
   * Re-send the fully-signed PDF (email, with attachment) to the sender
   * and every recipient. Only valid once the envelope is fully signed.
   */
  resendSignedCopy: async (id: string): Promise<SignRequest> => {
    const response = await api.post<SignRequest>(
      `/tools/pdf-editor/sign/requests/${id}/resend-signed-copy`,
    );
    return response.data;
  },

  /**
   * Retrieve the audit trail events for a sign request.
   */
  getSignAudit: async (id: string): Promise<SignAuditEvent[]> => {
    const response = await api.get<SignAuditEvent[]>(
      `/tools/pdf-editor/sign/requests/${id}/audit`,
    );
    return response.data;
  },

  /**
   * Download the completed (signed) PDF.
   */
  downloadSignedDocument: async (id: string): Promise<Blob> => {
    const response = await api.get(`/tools/pdf-editor/sign/requests/${id}/signed-document`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // ── Public Signing (no auth token) ──────────────────────────────────────

  /**
   * Fetch document metadata for the public signing view using a one-time token.
   * Does NOT use the authenticated `api` instance.
   */
  viewSignDocument: async (token: string): Promise<SignViewData> => {
    const response = await axios.get<SignViewData>(
      `${API_BASE}/sign/view/${token}`,
    );
    return response.data;
  },

  /**
   * Fetch a rasterised page image for the public signing view.
   * Returns a browser object URL. Caller must revoke when done.
   */
  getSignPageImage: async (token: string, pageNum: number): Promise<string> => {
    const response = await axios.get(
      `${API_BASE}/sign/view/${token}/page/${pageNum}`,
      { responseType: 'blob' },
    );
    return URL.createObjectURL(response.data);
  },

  /**
   * Submit this recipient's completed signature and field values.
   */
  submitSignature: async (
    token: string,
    data: {
      signatureDataUrl: string;
      signatureType?: 'draw' | 'type';
      signatureFont?: string;
      fieldValues?: Record<string, string>;
      consentAgreed: boolean;
    },
  ): Promise<{ status: string; envelopeStatus: string; signedAt: string | null }> => {
    // Strip data URL prefix to get raw base64
    const base64 = data.signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const response = await axios.post(`${API_BASE}/sign/submit/${token}`, {
      signature_data: base64,
      signature_type: data.signatureType || 'draw',
      ...(data.signatureFont ? { signature_font: data.signatureFont } : {}),
      field_values: data.fieldValues || {},
      consent_agreed: data.consentAgreed,
    });
    return response.data;
  },

  /**
   * Decline a signing request and optionally provide a reason.
   */
  declineSignature: async (token: string, reason?: string): Promise<void> => {
    await axios.post(`${API_BASE}/sign/decline/${token}`, {
      ...(reason ? { reason } : {}),
    });
  },

  // ── Company Documents ────────────────────────────────────────────────────

  /**
   * Get (or create, on first use) the persistent e-signature-capable copy
   * of a company document. Field definitions and sign requests are always
   * created against this same linked copy, so field mapping done once
   * from the company document library stays reusable on every visit.
   */
  getOrCreateLinkedDocument: async (companyDocumentId: string): Promise<PdfDocument> => {
    const response = await api.post<PdfDocument>(
      `/company-documents/${companyDocumentId}/linked-document`,
    );
    return response.data;
  },

  /**
   * List company document templates with optional search and category filter.
   */
  listCompanyDocs: async (
    skip = 0,
    limit = 20,
    search?: string,
    category?: string,
  ): Promise<CompanyDocumentListResponse> => {
    const response = await api.get<any>(
      '/company-documents',
      {
        params: {
          skip,
          limit,
          ...(search ? { search } : {}),
          ...(category ? { category } : {}),
        },
      },
    );
    return {
      items: response.data.items.map(mapCompanyDocument),
      total: response.data.total,
      skip: response.data.skip,
      limit: response.data.limit,
    };
  },

  /**
   * Upload a new company document template.
   */
  uploadCompanyDoc: async (
    file: File,
    name: string,
    description?: string,
    category?: string,
    tags?: string[],
  ): Promise<CompanyDocument> => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    if (description) form.append('description', description);
    if (category) form.append('category', category);
    if (tags?.length) form.append('tags', tags.join(','));
    const response = await api.post<any>('/company-documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return mapCompanyDocument(response.data);
  },

  /**
   * Get a single company document by ID.
   */
  getCompanyDoc: async (id: string): Promise<CompanyDocument> => {
    const response = await api.get<any>(`/company-documents/${id}`);
    return mapCompanyDocument(response.data);
  },

  /**
   * Update company document metadata (name, description, category, tags).
   */
  updateCompanyDoc: async (
    id: string,
    data: {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
    },
  ): Promise<CompanyDocument> => {
    const response = await api.patch<any>(
      `/company-documents/${id}`,
      data,
    );
    return mapCompanyDocument(response.data);
  },

  /**
   * Delete a company document template.
   */
  deleteCompanyDoc: async (id: string): Promise<void> => {
    await api.delete(`/company-documents/${id}`);
  },

  /**
   * Fetch a company document's thumbnail image and return a browser object URL.
   * Caller is responsible for calling URL.revokeObjectURL() when done.
   */
  getCompanyDocThumbnail: async (id: string): Promise<string> => {
    return blobToObjectUrl(
      api.get(`/company-documents/${id}/thumbnail`, {
        responseType: 'blob',
      }),
    );
  },
};
