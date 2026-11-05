/**
 * Scopit - In-person signing API client: the employee's steps
 * Backend: backend/app/domains/tools/modules/pdf_editor/in_person_api.py
 * The signer's steps, after the hand-over, are in kioskApi.ts.
 */
import api from '@/services/api';
import type { Handoff } from './kioskApi';

const BASE = '/tools/pdf-editor/sign/in-person';

export interface SignableDocument {
  id: string;
  name: string;
  pageCount: number;
  /** A customer's own copy rather than a company template */
  customerCopy: boolean;
  /** "Signer 1", "Signer 2", ... */
  signers: string[];
  createdAt: string;
}

/** A customer not saved yet: saved only when the documents are signed */
export interface NewCustomer {
  name: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

/** Who the documents are for */
export type Subject =
  | { kind: 'customer'; id: string; name: string }
  | { kind: 'new'; customer: NewCustomer };

export type QuestionKind = 'text' | 'multiline' | 'date' | 'number' | 'checkbox' | 'email' | 'phone';

export interface Question {
  key: string;
  label: string;
  kind: QuestionKind;
  required: boolean;
  /** What's on record, or '' */
  value: string;
  source: 'customer' | 'company' | 'document';
  /** For a signer's own field: whose */
  role: string | null;
  /** Names of the visit's documents that use it */
  documents: string[];
}

export interface SignLine {
  key: string;
  label: string;
  type: 'signature' | 'initials';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signerRole: string;
}

export interface FormDocument {
  id: string;
  name: string;
  pageCount: number;
  customerCopy: boolean;
  lines: SignLine[];
}

export interface FormSigner {
  role: string;
  label: string;
  signature: boolean;
  initials: boolean;
}

export interface InPersonForm {
  documents: FormDocument[];
  questions: Question[];
  signers: FormSigner[];
  customer: { id: string | null; name: string; contactName: string | null; email: string | null };
}

export type Answers = Record<string, string>;

export interface Mark {
  signature?: string;
  initials?: string;
  signature_type?: 'draw' | 'type';
  signature_font?: string;
}

export interface SignedVisit {
  customerId: string;
  customerName: string;
  customerCreated: boolean;
  customerEmail: string | null;
  requests: { id: string; documentId: string; documentName: string | null; signedPdfReady: boolean }[];
}

function subjectBody(subject: Subject) {
  return subject.kind === 'customer'
    ? { customer_id: subject.id }
    : { new_customer: subject.customer };
}

export const inPersonApi = {
  listDocuments: async (customerId?: string): Promise<SignableDocument[]> => {
    const response = await api.get<SignableDocument[]>(`${BASE}/documents`, {
      params: customerId ? { customer_id: customerId } : undefined,
    });
    return response.data;
  },

  getForm: async (subject: Subject, documentIds: string[]): Promise<InPersonForm> => {
    const response = await api.post<InPersonForm>(`${BASE}/form`, {
      ...subjectBody(subject),
      document_ids: documentIds,
    });
    return response.data;
  },

  /**
   * Hand the device to the signer: the visit is checked, and the signer's
   * part gets a kiosk token of its own (see kioskApi.ts). The last call made
   * with the employee's session.
   */
  handoff: async (subject: Subject, documentIds: string[], answers: Answers): Promise<Handoff> => {
    const response = await api.post<Handoff>(`${BASE}/handoff`, {
      ...subjectBody(subject),
      document_ids: documentIds,
      answers,
    });
    return response.data;
  },
};

/** The device's date, as the documents print it (an evening signing must not be dated tomorrow in UTC) */
export function todayOnDevice(): string {
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date());
}

export const CONSENT_TEXT =
  'I have reviewed the document and agree to sign it electronically. '
  + 'My electronic signature has the same legal effect as a handwritten signature.';
