/**
 * Cabinet Estimate API service
 */

import api from '@/services/api';
import type {
  CabinetEstimate,
  CabinetEstimateCreate,
  CabinetEstimateListResponse,
  CabinetEstimateUpdate,
  EstimateHistory,
  KitchenEstimateGroup,
  KitchenEstimateKind,
  KitchenProjectType,
  PricingInfo,
  PurchaseOrderResponse,
} from '@/types/cabinetEstimate';
import type { KitchenDrawings } from '@/components/features/tools/cabinet-estimate/sketch/kitchenDrawings';

const BASE_URL = '/tools/cabinet-estimate';

/** Save a PDF the API sent, named by its Content-Disposition (or `fallback`). */
function savePdf(response: { data: any; headers?: any }, fallback: string) {
  let filename = fallback;
  const disposition = response.headers?.['content-disposition'];
  const match = disposition?.match(/filename="?([^";\n]+)"?/);
  if (match?.[1]) filename = match[1];
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const cabinetEstimateService = {
  // ── Pricing info ──

  /** With an estimate, the rates it is priced with (its price book, or the company's today) */
  async getPricingInfo(estimateId?: string) {
    const { data } = await api.get(`${BASE_URL}/pricing-info`, {
      params: estimateId ? { estimate_id: estimateId } : undefined,
    });
    return data as PricingInfo;
  },

  // ── CRUD ──

  async list(params?: {
    customer_id?: string;
    status?: string;
    search?: string;
    /** 'restore' = only restorations, the estimates that may go to the carrier */
    kind?: KitchenEstimateKind;
    /** One row per kitchen job (its first estimate), with every estimate's summary */
    grouped?: boolean;
    page?: number;
    page_size?: number;
  }) {
    const { data } = await api.get(BASE_URL, { params });
    return data as CabinetEstimateListResponse;
  },

  async getById(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}`);
    return data as CabinetEstimate;
  },

  async create(payload: CabinetEstimateCreate) {
    const { data } = await api.post(BASE_URL, payload);
    return data as CabinetEstimate;
  },

  async update(id: string, payload: CabinetEstimateUpdate) {
    const { data } = await api.put(`${BASE_URL}/${id}`, payload);
    return data as CabinetEstimate;
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
    return data as KitchenEstimateGroup;
  },

  /** A new option in the same job, starting as a copy of this estimate. */
  async addOption(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/options`);
    return data as CabinetEstimate;
  },

  async renameOption(id: string, optionLabel: string) {
    const { data } = await api.put(`${BASE_URL}/${id}/option-label`, { option_label: optionLabel });
    return data as CabinetEstimate;
  },

  async setProjectType(id: string, projectType: KitchenProjectType) {
    const { data } = await api.put(`${BASE_URL}/${id}/project-type`, { project_type: projectType });
    return data as CabinetEstimate;
  },

  // ── An option's products (from the product library) ──

  /** Put a library product in an option's slot; a calculated option is repriced. */
  async setSelection(id: string, slot: string, productId: string) {
    const { data } = await api.put(`${BASE_URL}/${id}/selections/${slot}`, { product_id: productId });
    return data as CabinetEstimate;
  },

  /** Empty a slot: that part goes back to the rate-table price. */
  async clearSelection(id: string, slot: string) {
    const { data } = await api.delete(`${BASE_URL}/${id}/selections/${slot}`);
    return data as CabinetEstimate;
  },

  // ── Calculation ──

  async calculate(id: string, payload?: CabinetEstimateUpdate) {
    const { data } = await api.post(`${BASE_URL}/${id}/calculate`, payload || {});
    return data as CabinetEstimate;
  },

  // ── Clone ──

  async clone(id: string) {
    const { data } = await api.post(`${BASE_URL}/${id}/clone`);
    return data as CabinetEstimate;
  },

  // ── History ──

  async getHistory(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/history`);
    return data as EstimateHistory[];
  },

  // ── Purchase Order ──

  async getPurchaseOrder(id: string) {
    const { data } = await api.get(`${BASE_URL}/${id}/purchase-order`);
    return data as PurchaseOrderResponse;
  },

  // ── To a Scopit estimate ──

  /**
   * Write this calculated estimate's line items into a Scopit estimate: a new
   * one, or (updateExisting) the one it was sent to before.
   */
  async sendToEstimate(id: string, updateExisting = false) {
    const { data } = await api.post(`${BASE_URL}/${id}/send-to-estimate`, { update_existing: updateExisting });
    return data as { estimate_id: string; estimate_number: string; updated: boolean };
  },

  // ── Export ──

  /**
   * The estimate's PDF. An option's can carry its 3D view (`render`, base64);
   * the restoration's never does - it goes to the carrier as it is.
   */
  async exportPdf(id: string, options?: { show_signature?: boolean; address?: string; render?: string | null }) {
    const response = options?.render
      ? await api.post(`${BASE_URL}/${id}/export/pdf`, {
        render: options.render,
        show_signature: options.show_signature ?? true,
      }, { responseType: 'blob', timeout: 60000 })
      : await api.get(`${BASE_URL}/${id}/export/pdf`, {
        responseType: 'blob',
        params: options?.show_signature === false ? { show_signature: false } : undefined,
      });
    const slug = (options?.address || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
    savePdf(response, `cabinet_estimate_${slug || id.substring(0, 8)}.pdf`);
  },

  /** The customer's side-by-side of every estimate of the job. Never for the carrier. */
  async exportProposalPdf(id: string, options?: {
    show_signature?: boolean;
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
    savePdf(response, `kitchen_options_${id.substring(0, 8)}.pdf`);
  },

  /**
   * The design quote, the other format of the estimate's PDF. `drawings` are
   * pictures drawn in the browser (kitchenDrawings.tsx), each part optional.
   */
  async exportDesignQuotePdf(id: string, options?: { show_signature?: boolean; drawings?: KitchenDrawings }) {
    const response = await api.post(`${BASE_URL}/${id}/export/design-quote-pdf`, {
      show_signature: options?.show_signature ?? true,
      drawings: options?.drawings,
    }, { responseType: 'blob', timeout: 120000 });
    savePdf(response, `kitchen_cabinet_quote_${id.substring(0, 8)}.pdf`);
  },

  async exportExcel(id: string) {
    const response = await api.get(`${BASE_URL}/${id}/export/excel`, {
      responseType: 'blob',
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cabinet_purchase_order_${id.substring(0, 8)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
