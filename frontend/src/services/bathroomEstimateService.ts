/**
 * Bathroom Estimator API service (ported from MJ Estimate).
 */

import api from '@/services/api';
import type {
  BathroomEstimate,
  BathroomEstimateCreate,
  BathroomEstimateGroup,
  BathroomEstimateKind,
  BathroomEstimateListResponse,
  BathroomLayoutChangeReport,
  BathroomEstimateUpdate,
  BathroomEstimateHistory,
  BathroomPricingInfo,
  BathroomProjectType,
  BathroomSelectionSlot,
} from '@/types/bathroomEstimate';

const BASE_URL = '/tools/bathroom-estimate';

export const bathroomEstimateService = {
  // ── Pricing info ──

  /** With an estimate, the rates it is priced with (its price book, or the company's today) */
  async getPricingInfo(estimateId?: string) {
    const { data } = await api.get(`${BASE_URL}/pricing-info`, {
      params: estimateId ? { estimate_id: estimateId } : undefined,
    });
    return data as BathroomPricingInfo;
  },

  // ── CRUD ──

  async list(params?: {
    customer_id?: string;
    status?: string;
    search?: string;
    /** 'restore' = only restorations, the estimates that may go to the carrier */
    kind?: BathroomEstimateKind;
    /** One row per bathroom job (its first estimate), with every estimate's summary */
    grouped?: boolean;
    page?: number;
    page_size?: number;
  }) {
    const { data } = await api.get(BASE_URL, { params });
    return data as BathroomEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as BathroomEstimate;
  },

  async create(payload: BathroomEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as BathroomEstimate;
  },

  async update(id: string, payload: BathroomEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as BathroomEstimate;
  },

  async delete(id: string, options?: { wholeGroup?: boolean }) {
    const { data } = await api.delete(`${BASE_URL}/${id}`, {
      params: options?.wholeGroup ? { whole_group: true } : undefined,
    });
    return data;
  },

  // ── Estimate group (restoration + options) ──

  async getGroup(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/group`);
    return data as BathroomEstimateGroup;
  },

  /** A new option in the same job, starting as a copy of this estimate. */
  async addOption(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/options`);
    return data as BathroomEstimate;
  },

  /** A remodel's bathroom as it is today (unpriced), starting as a copy of this estimate. */
  async addCurrentLayout(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/current-layout`);
    return data as BathroomEstimate;
  },

  /** How an option's saved sketch differs from the bathroom as it is. */
  async getLayoutChanges(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/layout-changes`);
    return data as BathroomLayoutChangeReport;
  },

  async renameOption(id: string, optionLabel: string) {
    const { data } = await api.put(`${BASE_URL}/${id}/option-label`, { option_label: optionLabel });
    return data as BathroomEstimate;
  },

  // ── Selections (the products an option is built from) ──

  async getSelectionSlots() {
    const { data } = await api.get(`${BASE_URL}/selection-slots`);
    return data as BathroomSelectionSlot[];
  },

  /** Build an option's slot from a library product; the estimate keeps its own copy. */
  async setSelection(id: string, slot: string, productId: string, includesTop?: boolean) {
    const { data } = await api.put(`${BASE_URL}/${id}/selections/${slot}`, {
      product_id: productId,
      includes_top: includesTop,
    });
    return data as BathroomEstimate;
  },

  async clearSelection(id: string, slot: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}/selections/${slot}`);
    return data as BathroomEstimate;
  },

  async setProjectType(id: string, projectType: BathroomProjectType) {
    const { data } = await api.put(`${BASE_URL}/${id}/project-type`, { project_type: projectType });
    return data as BathroomEstimate;
  },

  /** The customer's side-by-side of every estimate of the job. Never for the carrier. */
  async exportProposalPdf(id: string, options?: {
    show_signature?: boolean;
    address?: string;
    /** Each estimate's 3D view, base64, by estimate id. */
    renders?: Record<string, string>;
  }) {
    const response = options?.renders && Object.keys(options.renders).length
      ? await api.post(`${BASE_URL}/${id}/export/proposal-pdf`, {
        renders: options.renders,
        show_signature: options.show_signature ?? true,
      }, { responseType: 'blob', timeout: 60000 })
      : await api.get(`${BASE_URL}/${id}/export/proposal-pdf`, {
        responseType: 'blob',
        params: options?.show_signature === false ? { show_signature: false } : undefined,
      });
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bathroom_options_${sanitized || id.substring(0, 8)}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // ── Calculation ──

  async calculate(id: string, payload?: BathroomEstimateUpdate) {
    const { data } = await api.post(`${BASE_URL}/${id}/calculate`, payload || {});
    return data as BathroomEstimate;
  },

  // ── Line Item CRUD ──

  async addLineItem(estimateId: string, item: { phase: number; description: string; quantity?: number; unit?: string; unit_price?: number; category?: string; notes?: string }) {
    const { data } = await api.post(`${BASE_URL}/${estimateId}/line-items`, item);
    return data as BathroomEstimate;
  },

  async updateLineItem(estimateId: string, itemId: string, updates: Partial<{ phase: number; description: string; quantity: number; unit: string; unit_price: number; total: number; category: string; notes: string }>) {
    const { data } = await api.put(`${BASE_URL}/${estimateId}/line-items/${itemId}`, updates);
    return data as BathroomEstimate;
  },

  async deleteLineItem(estimateId: string, itemId: string) {
    const { data } = await api.delete(`${BASE_URL}/${estimateId}/line-items/${itemId}`);
    return data as BathroomEstimate;
  },

  async deletePhase(estimateId: string, phase: number) {
    const { data } = await api.delete(`${BASE_URL}/${estimateId}/phases/${phase}`);
    return data as BathroomEstimate;
  },

  // ── Send to a Scopit estimate ──

  /** Write the calculated line items into a Scopit estimate: a new one, or (updateExisting) the one sent to before. */
  async sendToEstimate(id: string, updateExisting = false) {
    const { data } = await api.post(`${BASE_URL}/${id}/send-to-estimate`, { update_existing: updateExisting });
    return data as { estimate_id: string; estimate_number: string; updated: boolean };
  },

  // ── Clone ──

  async clone(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/clone`);
    return data as BathroomEstimate;
  },

  // ── History ──

  async getHistory(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data as BathroomEstimateHistory[];
  },

  // ── Overview Note Generation ──

  async generateOverview(id: string) {
    // LLM call - can exceed the default 30s client timeout.
    const { data } = await api.post(`${BASE_URL}/${id}/generate-overview`, undefined, { timeout: 60000 });
    return data as { overview_text: string };
  },

  // ── Export ──

  async exportPdf(id: string, options?: {
    show_signature?: boolean;
    sketch_image?: string;
    /** The 3D view, base64; an option's PDF shows it, the restoration's never does. */
    render_image?: string;
    show_breakdown_prices?: boolean;
    address?: string;
  }) {
    const sanitized = (options?.address || '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const type = options?.show_breakdown_prices === false ? 'clean' : 'detail';
    const base = sanitized || id.substring(0, 8);
    const filename = `bathroom_estimate_${base}_${type}.pdf`;

    const downloadBlob = (data: any) => {
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    };

    if (options?.sketch_image || options?.render_image) {
      const response = await api.post(`${BASE_URL}/${id}/export/pdf`, {
        sketch_image: options.sketch_image,
        render_image: options.render_image,
        show_signature: options?.show_signature ?? true,
        show_breakdown_prices: options?.show_breakdown_prices ?? true,
      }, {
        responseType: 'blob',
        timeout: 60000,
      });
      downloadBlob(response.data);
    } else {
      const params: Record<string, any> = {};
      if (options?.show_signature === false) {
        params.show_signature = false;
      }
      if (options?.show_breakdown_prices === false) {
        params.show_breakdown_prices = false;
      }
      const response = await api.get(`${BASE_URL}/${id}/export/pdf`, {
        responseType: 'blob',
        params,
      });
      downloadBlob(response.data);
    }
  },

  // ── Export Validation ──

  async validateForExport(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/export/validate`);
    return data as { valid: boolean; warnings: string[] };
  },
};
