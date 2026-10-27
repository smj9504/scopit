/**
 * Scopit - PDF Editor Tool Types
 */

export interface PdfDocument {
  id: string;
  name: string;
  fileSize: number;
  pageCount: number;
  mimeType: string;
  sourceType: string;
  sourceId: string | null;
  /** The customer this copy is filled in or signed for */
  customerId: string | null;
  customer: PdfDocumentCustomer | null;
  /** The document this customer copy was made from */
  templateId: string | null;
  /** How many customer copies were made from this document (list responses only) */
  customerCopyCount?: number;
  annotations: Annotation[];
  fieldDefinitions: FieldDefinition[];
  thumbnailUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface PdfDocumentCustomer {
  id: string;
  name: string;
  email: string | null;
}

export interface PdfDocumentListResponse {
  items: PdfDocument[];
  total: number;
  skip: number;
  limit: number;
}

export interface AnnotationStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  /**
   * Edit Text: the PDF font (as pdf.js names it) the replaced words were
   * printed in. The editor and the export draw the text with it where they
   * can; fontFamily is the fallback.
   */
  pdfFont?: string;
}

export interface Annotation {
  id: string;
  /**
   * 'redact' marks an area for redaction: shown in the editor, never
   * exported, until Apply redactions takes what's under it out of the PDF.
   */
  type: 'text' | 'image' | 'drawing' | 'stamp' | 'sign_field' | 'shape' | 'redact';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  content: string;
  style: AnnotationStyle;
}

// Field type is an open string (new types can be added without a frontend
// release), but these are the ones the built-in editor/burn logic knows about.
export type FieldType = 'text' | 'date' | 'signature' | 'initials' | 'checkbox' | 'number' | string;

export type DataBindingMode = 'prefilled' | 'signer_input' | 'creator_input';

/** 'custom' = no source entity (freeform); undefined only for legacy data. */
export type SourceEntity = 'customer' | 'company' | 'custom';

export interface DataBinding {
  mode: DataBindingMode;
  sourceEntity?: SourceEntity | null;
  sourceField?: string | null;
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataBinding: DataBinding;
  signerRole?: string | null;
  required: boolean;
  /** Points; undefined = auto-fit to the field's height. */
  fontSize?: number;
}

export interface AvailableField {
  sourceEntity: string;
  sourceField: string;
  label: string;
  type: string;
}

export type RecipientStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';

export interface SignRecipient {
  id: string;
  role: string;
  name: string;
  email: string;
  phone?: string | null;
  sequence: number;
  status: RecipientStatus;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  consentAgreed: boolean;
}

export type DeliveryMethod = 'direct_link' | 'email_request';

export interface SignRequest {
  id: string;
  documentId: string;
  documentName: string | null;
  recipients: SignRecipient[];
  senderEmail: string;
  senderName: string;
  customerId: string | null;
  status: string;
  deliveryMethod: DeliveryMethod;
  signFields: FieldDefinition[];
  prefillData: Record<string, string>;
  emailSubject: string | null;
  emailMessage: string | null;
  ccEmails: string[];
  bccEmails: string[];
  expiresAt: string | null;
  sentAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** recipientId -> signing URL, for the sender to view/copy/share. Empty for drafts. */
  signUrls?: Record<string, string>;
  /** Only on send/reminder responses: recipients whose email couldn't be delivered. */
  deliveryFailures?: SignDeliveryFailure[];
}

export interface SignDeliveryFailure {
  recipientId: string;
  name: string;
  email: string;
  error: string;
}

export interface SignRequestListResponse {
  items: SignRequest[];
  total: number;
  skip: number;
  limit: number;
}

export interface SignAuditEvent {
  id: string;
  eventType: string;
  recipientId: string | null;
  actorEmail: string | null;
  actorIp: string | null;
  eventMetadata: Record<string, unknown>;
  createdAt: string;
}

/** A field as shown to one specific recipient: editable if it's theirs,
 * otherwise a read-only context field with its resolved value. Fields
 * belonging to a *different* recipient's role are never present at all. */
export interface SignViewField extends FieldDefinition {
  editable: boolean;
  value?: string;
}

export interface SignViewData {
  documentName: string;
  senderName: string;
  senderEmail: string;
  recipientName: string | null;
  recipientRole: string | null;
  recipientStatus: RecipientStatus;
  companyName: string | null;
  companyLogoUrl: string | null;
  pageCount: number;
  signFields: SignViewField[];
  status: string;
  expiresAt: string;
  consentRequired: boolean;
}

export interface CompanyDocument {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  fileSize: number;
  mimeType: string;
  pageCount: number;
  thumbnailUrl: string | null;
  tags: string[];
  useCount: number;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface CompanyDocumentListResponse {
  items: CompanyDocument[];
  total: number;
  skip: number;
  limit: number;
}

/** Field height (page-height fraction) at/above which a text field switches
 * from a single-line input to a multi-line, line-break-capable textarea —
 * both when filling it in and when burning the value into the PDF. */
export const TEXT_MULTILINE_HEIGHT = 0.05;

export function isMultilineText(field: Pick<FieldDefinition, 'type' | 'height'>): boolean {
  return field.type === 'text' && field.height >= TEXT_MULTILINE_HEIGHT;
}

export type EditorTool = 'select' | 'edit_text' | 'text' | 'image' | 'draw' | 'stamp' | 'sign' | 'sign_field' | 'shape_rect' | 'shape_circle' | 'shape_line' | 'crop' | 'redact';

/** A box in the editor's page space: center, size and clockwise rotation, like an Annotation */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** An image the page itself draws, which Edit can pick up */
export interface PageImage extends PageBox {
  /** Its place in the page's drawing order */
  index: number;
  /** Fills most of the page (a scan): not offered for editing */
  background: boolean;
}

export interface TextSearchMatch {
  page: number;
  text: string;
  /** One box per line the match spans */
  boxes: PageBox[];
}

/** Patterns the redaction search knows besides plain words */
export type RedactPattern = 'email' | 'phone' | 'ssn' | 'credit_card' | 'date';

/** Points to trim off each side of a page, as it's shown */
export interface CropMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Page number -> crop box [x0, y0, x1, y1] in PDF user space, for undoing a crop */
export type CropBoxes = Record<string, [number, number, number, number]>;

export interface ProtectOptions {
  openPassword?: string;
  permissionsPassword?: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowEditing: boolean;
  allowCommenting: boolean;
}

export interface EditorState {
  documentId: string | null;
  currentPage: number;
  zoom: number;
  tool: EditorTool;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  isDirty: boolean;
}
