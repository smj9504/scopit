/**
 * ScopeIt - PDF Editor Tool Types
 */

export interface PdfDocument {
  id: string;
  name: string;
  fileSize: number;
  pageCount: number;
  mimeType: string;
  sourceType: string;
  sourceId: string | null;
  annotations: Annotation[];
  fieldDefinitions: FieldDefinition[];
  thumbnailUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
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
}

export interface Annotation {
  id: string;
  type: 'text' | 'image' | 'drawing' | 'stamp' | 'sign_field' | 'shape';
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
  /** recipientId -> signing URL, for the sender to view/copy/share. */
  signUrls?: Record<string, string>;
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

export type EditorTool = 'select' | 'text' | 'image' | 'draw' | 'stamp' | 'sign' | 'sign_field' | 'shape_rect' | 'shape_circle' | 'shape_line';

export interface EditorState {
  documentId: string | null;
  currentPage: number;
  zoom: number;
  tool: EditorTool;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  isDirty: boolean;
}
