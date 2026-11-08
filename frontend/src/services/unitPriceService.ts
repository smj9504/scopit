/**
 * Company prices for the Bathroom and Cabinet Estimators (backend
 * app/domains/unit_prices; ported from MJ Estimate).
 *
 * The defaults live in the backend's pricing.py and are updated there
 * monthly or quarterly. A company may set its own material and/or labor for
 * any price; a side left empty follows the default. Prices are the signed-in
 * user's company's.
 */

import api from '@/services/api';
import type {
  PriceDomain,
  UnitPriceChange,
  UnitPriceDomain,
  UnitPriceHistoryEntry,
  UnitPriceList,
} from '@/types/unitPrices';

const BASE_URL = '/unit-prices';

/** Each tool's API base, for repricing one of its estimates. */
const ESTIMATE_BASE: Record<PriceDomain, string> = {
  bathroom: '/tools/bathroom-estimate',
  cabinet: '/tools/cabinet-estimate',
};

export const unitPriceService = {
  async domains(): Promise<UnitPriceDomain[]> {
    const { data } = await api.get(`${BASE_URL}/domains`);
    return data;
  },

  async list(domain: PriceDomain): Promise<UnitPriceList> {
    const { data } = await api.get(`${BASE_URL}/${domain}`);
    return data;
  },

  async save(domain: PriceDomain, prices: Record<string, UnitPriceChange>): Promise<UnitPriceList> {
    const { data } = await api.put(`${BASE_URL}/${domain}`, { prices });
    return data;
  },

  async history(domain: PriceDomain): Promise<UnitPriceHistoryEntry[]> {
    const { data } = await api.get(`${BASE_URL}/${domain}/history`);
    return data;
  },

  /** Reprice an estimate's whole job at today's prices; answers the estimate. */
  async useCurrentPrices<T = unknown>(domain: PriceDomain, estimateId: string): Promise<T> {
    const { data } = await api.post(`${ESTIMATE_BASE[domain]}/${estimateId}/use-current-prices`);
    return data as T;
  },
};
