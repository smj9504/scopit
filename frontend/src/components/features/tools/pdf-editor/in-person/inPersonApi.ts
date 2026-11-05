/**
 * Scopit - In-person signing API client
 * Backend: backend/app/domains/tools/modules/pdf_editor/in_person_api.py
 */
import api from '@/services/api';

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

  /** The document filled in with the answers so far, as a PDF */
  preview: async (subject: Subject, documentId: string, answers: Answers, today: string): Promise<ArrayBuffer> => {
    const response = await api.post(`${BASE}/preview`, {
      ...subjectBody(subject),
      document_id: documentId,
      answers,
      today,
    }, { responseType: 'arraybuffer' });
    return response.data;
  },

  sign: async (data: {
    subject: Subject;
    documentIds: string[];
    answers: Answers;
    today: string;
    signers: { role: string; name: string; email?: string }[];
    marks: Record<string, Mark>;
    consentText: string;
  }): Promise<SignedVisit> => {
    const response = await api.post<SignedVisit>(`${BASE}/sign`, {
      ...subjectBody(data.subject),
      document_ids: data.documentIds,
      answers: data.answers,
      today: data.today,
      signers: data.signers,
      marks: data.marks,
      consent_agreed: true,
      consent_text: data.consentText,
    });
    return response.data;
  },

  email: async (requestIds: string[], emails: string[]): Promise<{ emails: string[] }> => {
    const response = await api.post<{ emails: string[] }>(`${BASE}/email`, {
      request_ids: requestIds,
      emails,
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
