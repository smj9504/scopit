/**
 * Scopit - Packing Lead Service
 *
 * Anonymous packing-estimate lead capture: public submit -> email verify ->
 * background AI analysis -> status polling -> authenticated claim.
 */
import api from './api';
import type {
  PackingLeadClaimResponse,
  PackingLeadRetryResponse,
  PackingLeadStatusResponse,
  PackingLeadSubmitData,
  PackingLeadSubmitResponse,
  PackingLeadVerifyEmailResponse,
} from '@/types/packingLead';

export const packingLeadService = {
  /**
   * Submit the public lead form: contact info + per-room photos.
   * Photos are appended as a single flat ordered list across all rooms,
   * grouped implicitly by each room's photo_count.
   */
  submit: async (data: PackingLeadSubmitData): Promise<PackingLeadSubmitResponse> => {
    const formData = new FormData();
    const payload = {
      contact_email: data.contactEmail,
      contact_phone: data.contactPhone,
      company_name: data.companyName,
      company_phone: data.companyPhone,
      company_address_line1: data.companyAddressLine1,
      company_address_line2: data.companyAddressLine2,
      company_city: data.companyCity,
      company_state: data.companyState,
      company_zipcode: data.companyZipcode,
      property_address_line1: data.propertyAddressLine1,
      property_address_line2: data.propertyAddressLine2,
      property_city: data.propertyCity,
      property_state: data.propertyState,
      property_zipcode: data.propertyZipcode,
      idempotency_key: data.idempotencyKey,
      rooms: data.rooms.map((r) => ({
        room_name: r.roomName,
        photo_count: r.photos.length,
      })),
    };
    formData.append('payload', JSON.stringify(payload));
    for (const room of data.rooms) {
      for (const photo of room.photos) {
        formData.append('photos', photo);
      }
    }

    const response = await api.post<PackingLeadSubmitResponse>('/packing-leads/submit', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Confirm the emailed 6-digit code. Kicks off background AI analysis.
   */
  verifyEmail: async (token: string, code: string): Promise<PackingLeadVerifyEmailResponse> => {
    const response = await api.post<PackingLeadVerifyEmailResponse>(
      `/packing-leads/${token}/verify-email`,
      { code }
    );
    return response.data;
  },

  /**
   * Poll analysis status. Returns a pending/failed shape or a ready shape
   * with a pricing-free teaser once analysis completes.
   */
  getStatus: async (token: string): Promise<PackingLeadStatusResponse> => {
    const response = await api.get<PackingLeadStatusResponse>(`/packing-leads/${token}/status`);
    return response.data;
  },

  /**
   * Retry analysis after a failure, if retries remain.
   */
  retry: async (token: string): Promise<PackingLeadRetryResponse> => {
    const response = await api.post<PackingLeadRetryResponse>(`/packing-leads/${token}/retry`);
    return response.data;
  },

  /**
   * Claim a ready lead into a real authenticated tool session. Requires the
   * caller to already be logged in (the shared `api` instance attaches the
   * bearer token automatically).
   */
  claim: async (token: string): Promise<PackingLeadClaimResponse> => {
    const response = await api.post<PackingLeadClaimResponse>(`/packing-leads/${token}/claim`);
    return response.data;
  },

  /**
   * Public US-address autocomplete for the anonymous lead form. Returns [] on
   * short queries or any upstream error, so typing never breaks.
   */
  addressAutocomplete: async (
    query: string
  ): Promise<{ address: string; street: string; city: string; state: string; zip: string }[]> => {
    if (query.trim().length < 3) return [];
    try {
      const response = await api.get('/packing-leads/address-autocomplete', { params: { q: query } });
      return response.data;
    } catch {
      return [];
    }
  },
};

export default packingLeadService;
