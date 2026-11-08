/**
 * Product library API service (backend app/domains/product_library).
 * Part of the Cabinet Estimator; ported from MJ Estimate.
 */

import api from '@/services/api';
import type { Product, ProductCreate, ProductDraft, ProductMeta, ProductUpdate } from '@/types/productLibrary';

const BASE_URL = '/products';
/** Reading a listing fetches a page and asks Claude; give it time. */
const READ_TIMEOUT_MS = 120000;
/** Scopit's client defaults to JSON, which would turn FormData into JSON. */
const MULTIPART = { 'Content-Type': 'multipart/form-data' };

export const productLibraryService = {
  getMeta: async (): Promise<ProductMeta> => (await api.get(`${BASE_URL}/meta`)).data,

  list: async (params: {
    q?: string;
    category?: string;
    trade?: 'kitchen' | 'bathroom';
    include_archived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Product[]; total: number }> => (await api.get(BASE_URL, { params })).data,

  get: async (id: string): Promise<Product> => (await api.get(`${BASE_URL}/${id}`)).data,

  create: async (data: ProductCreate): Promise<Product> => (await api.post(BASE_URL, data, { timeout: READ_TIMEOUT_MS })).data,

  update: async (id: string, data: ProductUpdate): Promise<Product> =>
    (await api.put(`${BASE_URL}/${id}`, data, { timeout: READ_TIMEOUT_MS })).data,

  archive: async (id: string): Promise<void> => {
    await api.delete(`${BASE_URL}/${id}`);
  },

  /** A picture added by hand, or (swatch) the flat surface picture the 3D view uses as a texture. */
  uploadImage: async (id: string, file: Blob, filename: string, swatch = false): Promise<Product> => {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('swatch', swatch ? 'true' : 'false');
    return (await api.post(`${BASE_URL}/${id}/images`, form, { timeout: READ_TIMEOUT_MS, headers: MULTIPART })).data;
  },

  /** Read a product off a link the server fetches; big retailers mostly turn that away (draft.blocked). */
  readUrl: async (url: string): Promise<ProductDraft> =>
    (await api.post(`${BASE_URL}/extract/url`, { url }, { timeout: READ_TIMEOUT_MS })).data,

  /** Read a product off a page as the person's browser had it (sent by the bookmarklet). */
  readHtml: async (url: string, html: string): Promise<ProductDraft> =>
    (await api.post(`${BASE_URL}/extract/html`, { url, html }, { timeout: READ_TIMEOUT_MS })).data,

  /** Read a product off a screenshot of its listing. */
  readScreenshot: async (image: Blob, filename: string, url?: string): Promise<ProductDraft> => {
    const form = new FormData();
    form.append('file', image, filename);
    if (url) form.append('url', url);
    return (await api.post(`${BASE_URL}/extract/screenshot`, form, { timeout: READ_TIMEOUT_MS, headers: MULTIPART })).data;
  },
};

export default productLibraryService;
