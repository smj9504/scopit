/**
 * Scopit - In-person signing: the signer's part, on the handed-over device
 * Backend: backend/app/domains/tools/modules/pdf_editor/in_person_api.py (/kiosk/...)
 *
 * Once the device is handed over, the employee's session is gone from it and
 * these calls carry the visit's kiosk token instead. It only reaches this
 * visit: its documents, its customer, and the company's answers as they were
 * handed over. Its own axios instance, so the app's sign-in handling (token
 * refresh, redirect to /login) never touches it.
 */
import axios from 'axios';
import type { Answers, InPersonForm, Mark, SignedVisit } from './inPersonApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';
const BASE = '/tools/pdf-editor/sign/in-person/kiosk';

/** What the employee's hand-over gives the signer's part of the visit */
export interface Handoff {
  token: string;
  /** ISO time the kiosk token stops working */
  expiresAt: string;
  companyName: string;
  /** The employee who handed over: offered as "That's me" on a signer line */
  staff: { name: string; email: string };
  form: InPersonForm;
  /** Every answer as handed over */
  answers: Answers;
}

export interface KioskClient {
  /** Tells one hand-over's cached previews from another's */
  key: string;
  /** A handed-over document filled in, as a PDF */
  preview: (documentId: string, answers: Answers, today: string) => Promise<ArrayBuffer>;
  sign: (data: {
    answers: Answers;
    today: string;
    signers: { role: string; name: string; email?: string }[];
    marks: Record<string, Mark>;
    consentText: string;
  }) => Promise<SignedVisit>;
  email: (requestIds: string[], emails: string[]) => Promise<{ emails: string[] }>;
}

export function kioskClient(token: string): KioskClient {
  const http = axios.create({
    baseURL: `${API_URL}${BASE}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // Signing burns every document's PDF; give it longer than a page load
    timeout: 60000,
  });
  return {
    key: token.slice(-16),
    preview: async (documentId, answers, today) => {
      const response = await http.post('/preview', { document_id: documentId, answers, today }, {
        responseType: 'arraybuffer',
      });
      return response.data;
    },
    sign: async (data) => {
      const response = await http.post<SignedVisit>('/sign', {
        answers: data.answers,
        today: data.today,
        signers: data.signers,
        marks: data.marks,
        consent_agreed: true,
        consent_text: data.consentText,
      });
      return response.data;
    },
    email: async (requestIds, emails) => {
      const response = await http.post<{ emails: string[] }>('/email', { request_ids: requestIds, emails });
      return response.data;
    },
  };
}

/** The kiosk token was refused: expired, or the employee's session ended */
export const isKioskEnded = (error: unknown) =>
  axios.isAxiosError(error) && error.response?.status === 401;
