/**
 * Scopit - Line Item Service
 */
import api from './api';
import type { LineItem, LineItemNote, LineItemCreate, PaginatedResponse } from '@/types/entities';

export interface LineItemListParams {
  skip?: number;
  limit?: number;
  search?: string;
  category?: string;
  visibility?: 'company' | 'private';
  is_active?: boolean;
}

export interface LineItemNoteCreate {
  content: string;
  order_index: number;
}

export const lineItemService = {
  // Line Item CRUD
  async list(params?: LineItemListParams): Promise<PaginatedResponse<LineItem>> {
    const response = await api.get('/line-items', { params });
    return response.data;
  },

  async get(id: string): Promise<LineItem> {
    const response = await api.get(`/line-items/${id}`);
    return response.data;
  },

  async create(data: LineItemCreate): Promise<LineItem> {
    const response = await api.post('/line-items', data);
    return response.data;
  },

  async update(id: string, data: Partial<LineItemCreate>): Promise<LineItem> {
    const response = await api.put(`/line-items/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/line-items/${id}`);
  },

  async duplicate(id: string): Promise<LineItem> {
    const response = await api.post(`/line-items/${id}/duplicate`);
    return response.data;
  },

  // Notes CRUD
  async listNotes(lineItemId: string): Promise<LineItemNote[]> {
    const response = await api.get(`/line-items/${lineItemId}/notes`);
    return response.data;
  },

  async createNote(lineItemId: string, data: LineItemNoteCreate): Promise<LineItemNote> {
    const response = await api.post(`/line-items/${lineItemId}/notes`, data);
    return response.data;
  },

  async updateNote(lineItemId: string, noteId: string, data: Partial<LineItemNoteCreate>): Promise<LineItemNote> {
    const response = await api.put(`/line-items/${lineItemId}/notes/${noteId}`, data);
    return response.data;
  },

  async deleteNote(lineItemId: string, noteId: string): Promise<void> {
    await api.delete(`/line-items/${lineItemId}/notes/${noteId}`);
  },

  async reorderNotes(lineItemId: string, noteIds: string[]): Promise<void> {
    await api.put(`/line-items/${lineItemId}/notes/reorder`, noteIds);
  },

  async bulkUpdateNotes(lineItemId: string, notes: LineItemNoteCreate[]): Promise<LineItemNote[]> {
    const response = await api.put(`/line-items/${lineItemId}/notes/bulk`, notes);
    return response.data;
  },
};

export default lineItemService;
