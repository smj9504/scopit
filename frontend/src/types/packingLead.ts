/**
 * Scopit - Packing Lead Types
 *
 * Anonymous "packing estimate" lead capture flow: a public visitor submits
 * contact info + per-room photos, verifies their email with a 6-digit code,
 * then AI analysis runs server-side and can be claimed into a real tool
 * session after registering/logging in.
 */

export interface PackingLeadRoomInput {
  room_name: string;
  photo_count: number;
}

export interface PackingLeadSubmitPayload {
  contact_email: string;
  contact_phone: string | null;
  /** The submitter's own contracting business -- distinct from contact_*
   * (the individual) and property_address (the job site). */
  company_name: string | null;
  company_phone: string | null;
  company_address: string | null;
  property_address: string | null;
  idempotency_key: string;
  rooms: PackingLeadRoomInput[];
}

/** Client-side shape used to build the submit FormData; not sent as-is. */
export interface PackingLeadSubmitData {
  contactEmail: string;
  contactPhone: string | null;
  companyName: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  propertyAddress: string | null;
  idempotencyKey: string;
  rooms: Array<{
    roomName: string;
    photos: File[];
  }>;
}

export interface PackingLeadSubmitResponse {
  token: string;
}

export interface PackingLeadVerifyEmailResponse {
  status: 'analyzing' | 'failed';
  error_message: string | null;
}

export type PackingLeadStatusValue = 'pending_verification' | 'analyzing' | 'failed' | 'ready';

export interface PackingLeadTeaser {
  room_count: number;
  item_count: number;
  size_category: string;
}

export interface PackingLeadStatusPending {
  status: 'pending_verification' | 'analyzing' | 'failed';
  can_retry: boolean;
  error_message: string | null;
}

export interface PackingLeadStatusReady {
  status: 'ready';
  requires_auth: boolean;
  already_claimed: boolean;
  teaser: PackingLeadTeaser;
}

export type PackingLeadStatusResponse = PackingLeadStatusPending | PackingLeadStatusReady;

export interface PackingLeadRetryResponse {
  status: 'analyzing' | 'failed';
  error_message: string | null;
}

export interface PackingLeadClaimResponse {
  tool_session_id: string;
}
